"""Native localhost browser E2E; --offline uses the documented platform-boundary harness.
The offline harness does NOT prove browser origin policy, actual extension APIs, or hardware.
Both modes exercise real Chromium DOM, layout, events and the compiled shared implementation.
"""
from __future__ import annotations
import argparse
import hashlib
import json
import os
from pathlib import Path
import re
import shutil
import subprocess
import sys
import time
import traceback
from urllib.request import urlopen
from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parents[1]
parser = argparse.ArgumentParser()
parser.add_argument('--offline', action='store_true')
parser.add_argument('--artifacts', default=str(ROOT / 'artifacts/browser'))
args = parser.parse_args()
ARTIFACTS = Path(args.artifacts); ARTIFACTS.mkdir(parents=True, exist_ok=True)
results = []
server = None
if args.offline:
    subprocess.run(['node', str(ROOT / 'scripts/fixture-bundle.mjs')], check=True)
    subprocess.run(['node', str(ROOT / 'scripts/fixture-bundle.mjs'), '--camera'], check=True)
else:
    try:
        urlopen('http://127.0.0.1:4174/', timeout=1).close()
    except Exception:
        server = subprocess.Popen(['node', str(ROOT / 'scripts/serve.mjs')], stdout=subprocess.DEVNULL, stderr=subprocess.PIPE)
        for _ in range(30):
            try:
                urlopen('http://127.0.0.1:4174/', timeout=1).close(); break
            except Exception:
                time.sleep(.1)


def expect(condition, message):
    if not condition:
        raise AssertionError(message)


def run(name, operation):
    try:
        operation()
        results.append({'name': name, 'status': 'PASS'})
        print('PASS', name, flush=True)
    except Exception as error:
        results.append({'name': name, 'status': 'FAIL', 'error': str(error)})
        print('FAIL', name, str(error), flush=True)
        traceback.print_exc()


with sync_playwright() as playwright:
    browser = playwright.chromium.launch(executable_path=os.environ.get('WW_CHROMIUM') or shutil.which('chromium') or None,
                                         headless=True, args=['--no-sandbox'])

    def new_page(width=1440, height=1000):
        page = browser.new_page(viewport={'width': width, 'height': height}, reduced_motion='reduce')
        page.set_default_timeout(4000)
        errors = []
        page.on('pageerror', lambda error: errors.append(str(error)))
        requests = []
        page.on('request', lambda request: requests.append(request.url))
        if args.offline:
            page.expose_function('__wwDigest', lambda data: list(hashlib.sha256(bytes(data)).digest()))
            html = ROOT.joinpath('index.html').read_text()
            html = re.sub(r'<script[^>]*>.*?</script>', '', html, flags=re.S)
            html = re.sub(r'<link[^>]*>', '', html)
            page.set_content(html)
            page.add_style_tag(content=ROOT.joinpath('demo.css').read_text())
            page.add_script_tag(content=ROOT.joinpath('artifacts/offline-fixture.js').read_text())
        else:
            page.goto('http://127.0.0.1:4174/', wait_until='networkidle')
        page.wait_for_function('() => !!window.witwitty')
        page.evaluate("() => { window.wwLoad = async path => window.wwModules ? window.wwModules(path) : import('./' + path); }")
        return page, errors, requests

    def settled(page):
        page.evaluate('window.witwitty.settled()')

    def state(page):
        return page.evaluate('({phase:witwitty.state.phase,scope:witwitty.state.scope,depth:witwitty.state.depth,mode:witwitty.state.mode,target:witwitty.state.targetId,progress:witwitty.state.progress,failure:witwitty.state.failure})')

    def hud_open(page):
        page.locator('[data-ww-owned="hud"] details.dock').first.evaluate('(element) => element.open = true')

    def activate_lock(page):
        page.get_by_role('button', name='Activate WitWitty', exact=True).click()
        page.locator('#source-log').click()
        expect(state(page)['target'] == 'paragraph-0', 'Mouse did not lock the semantic paragraph')
        hud_open(page)

    def command(page, action):
        page.evaluate('(intent) => witwitty.dispatch(intent)', action)
        settled(page)

    def test_initial():
        page, errors, requests = new_page()
        expect('WitWitty 2.0' in page.title(), 'Incorrect document title')
        expect(page.locator('#reading p').count() >= 6, 'Article did not render')
        expect(state(page)['phase'] == 'inactive', 'Reader must start inactive')
        expect(not any(not url.startswith('http://127.0.0.1:4174') for url in requests), 'Default experience made an external request')
        expect(not errors, f'Console errors: {errors}')
        page.screenshot(path=str(ARTIFACTS / 'desktop-initial.png'))
        page.close()
    run('initial page, meaningful content, dormant state, no external requests', test_initial)

    def canonical_mouse():
        page, errors, _ = new_page()
        original = page.locator('#reading').inner_html()
        activate_lock(page)
        page.get_by_role('button', name='Explain', exact=True).click(); settled(page)
        expect(state(page)['phase'] == 'lens_active', 'Explain did not approve')
        outputs = []
        for depth in ['ELI5', 'Plain', 'General', 'Advanced', 'Expert']:
            hud_open(page); page.get_by_role('button', name=depth, exact=True).click(); settled(page)
            expect(state(page)['depth'] == depth, 'Depth state mismatch')
            outputs.append(page.locator('[data-ww-owned="lens"]').inner_text())
        expect(len(set(outputs)) == 5, 'Depths did not produce distinct curated output')
        hud_open(page)
        for expected_scope in ['Sentence', 'Term']:
            page.get_by_role('button', name='Zoom in one semantic level').click(); settled(page)
            expect(state(page)['scope'] == expected_scope, 'Zoom skipped a semantic level')
        for expected_scope in ['Sentence', 'Paragraph', 'Section', 'Document']:
            hud_open(page); page.get_by_role('button', name='Zoom out one semantic level').click(); settled(page)
            expect(state(page)['scope'] == expected_scope, 'Outward zoom skipped a semantic level')
        code = page.locator('#reading pre').inner_html()
        equation = page.locator('#reading [data-equation]').inner_html()
        hud_open(page); page.get_by_role('button', name='Rewrite', exact=True).click(); settled(page)
        current = state(page)
        expect(current['scope'] == 'Document' and current['depth'] == 'Expert' and current['mode'] == 'Rewrite', 'Mode switch lost context')
        expect(current['progress']['approved'] >= 6 and current['progress']['failed'] == 0, 'Progressive document rewrite failed')
        expect(page.locator('#reading pre').inner_html() == code, 'Code was rewritten')
        expect(page.locator('#reading [data-equation]').inner_html() == equation, 'Equation was rewritten')
        hud_open(page); page.get_by_role('button', name='Restore original', exact=True).click()
        expect(page.locator('#reading').inner_html() == original, 'Restore did not recover byte-identical article HTML')
        expect(not errors, f'Console errors: {errors}'); page.close()
    run('mouse canonical journey: five depths, five scopes, mode preservation, progressive rewrite, exact restore', canonical_mouse)

    def keyboard_path():
        page, errors, _ = new_page()
        original = page.locator('#reading').inner_html()
        page.keyboard.press('Alt+w'); page.keyboard.press('n'); page.keyboard.press('Enter'); page.keyboard.press('e'); settled(page)
        expect(state(page)['phase'] == 'lens_active', 'Keyboard did not explain')
        page.keyboard.press('ArrowLeft'); settled(page); expect(state(page)['depth'] == 'Plain', 'Keyboard depth failed')
        page.keyboard.press(']'); settled(page); expect(state(page)['scope'] == 'Sentence', 'Keyboard zoom failed')
        page.keyboard.press('w'); settled(page); expect(state(page)['mode'] == 'Rewrite', 'Keyboard mode failed')
        page.keyboard.press('r'); expect(page.locator('#reading').inner_html() == original, 'Keyboard restore mismatch')
        expect(not errors, f'Console errors: {errors}'); page.close()
    run('keyboard acquisition and action parity with reference controls', keyboard_path)

    def replay_path():
        page, errors, _ = new_page()
        original = page.locator('#reading').inner_html()
        visited = page.evaluate("""async () => {
          const scopes=new Set(), depths=new Set(); const off=witwitty.subscribe(s=>{scopes.add(s.scope);depths.add(s.depth)});
          const {canonicalReplay}=await wwLoad('browser/replay.js'); await canonicalReplay(witwitty,new AbortController().signal,0); off();
          return {scopes:[...scopes],depths:[...depths],phase:witwitty.state.phase};
        }""")
        expect(len(visited['scopes']) == 5 and len(visited['depths']) == 5, f'Replay coverage incomplete: {visited}')
        expect(visited['phase'] == 'restored', 'Replay did not end with restore')
        expect(page.locator('#reading').inner_html() == original, 'Replay restore mismatch')
        # Replay is repeatable from its final state, not only from a fresh clone.
        page.evaluate("async()=>{const {canonicalReplay}=await wwLoad('browser/replay.js');await canonicalReplay(witwitty,new AbortController().signal,0)}")
        expect(page.locator('#reading').inner_html() == original, 'Second replay changed original')
        expect(not errors, f'Console errors: {errors}'); page.close()
    run('recorded gestures cover canonical journey and repeat without mouse/hardware', replay_path)

    def retain_rejected():
        page, errors, _ = new_page(); activate_lock(page)
        command(page, {'type': 'SET_MODE', 'mode': 'Explain'})
        approved = page.locator('[data-ww-owned="lens"]').inner_html()
        page.evaluate("witwitty.scenario='reject'")
        command(page, {'type': 'CHANGE_DEPTH', 'depth': 'Expert'})
        expect(page.locator('[data-ww-owned="lens"]').inner_html() == approved, 'Rejected replacement overwrote approved lens')
        expect('Previous approved lens retained' in state(page)['failure'], 'Retention status is misleading')
        expect(not errors, f'Console errors: {errors}'); page.close()
    run('rejected replacement retains previous approved lens without flashing a draft', retain_rejected)

    for scenario in ['reject', 'malformed', 'model-timeout', 'review-timeout']:
        def failure_case(scenario=scenario):
            page, errors, _ = new_page(); original = page.locator('#reading').inner_html(); activate_lock(page)
            page.evaluate('(scenario)=>witwitty.scenario=scenario', scenario)
            command(page, {'type': 'SET_MODE', 'mode': 'Rewrite'})
            expect(page.locator('[data-ww-owned="lens"]').count() == 0, 'Unapproved output rendered')
            expect(page.locator('#reading').inner_html() == original, 'Failure mutated source')
            expect(state(page)['progress']['failed'] == 1, 'Failure was not explicit')
            expect(not errors, f'Console errors: {errors}'); page.close()
        run(f'browser failure injection: {scenario}', failure_case)

    def corrective_retry():
        page, errors, _ = new_page(); activate_lock(page); page.evaluate("witwitty.scenario='retry'")
        command(page, {'type': 'SET_MODE', 'mode': 'Explain'})
        attempt = page.evaluate('Object.values(witwitty.state.activeLens.blocks)[0].provenance.attempt')
        expect(attempt == 2, 'Corrective retry did not approve second attempt')
        expect(not errors, f'Console errors: {errors}'); page.close()
    run('browser corrective retry approves exactly the second attempt', corrective_retry)

    def partial_progress():
        page, errors, _ = new_page(); activate_lock(page); command(page, {'type': 'ZOOM_OUT'}); command(page, {'type': 'ZOOM_OUT'})
        original = page.locator('#reading').inner_html(); page.evaluate("witwitty.scenario='partial'")
        command(page, {'type': 'SET_MODE', 'mode': 'Rewrite'}); progress = state(page)['progress']
        expect(progress['approved'] > 0 and progress['failed'] > 0, f'Expected independently mixed outcomes: {progress}')
        expect(page.locator('[data-ww-owned="lens"]').count() == progress['approved'], 'Rejected block became visible')
        command(page, {'type': 'RESTORE'}); expect(page.locator('#reading').inner_html() == original, 'Partial restore mismatch')
        expect(not errors, f'Console errors: {errors}'); page.close()
    run('partial document rewrite preserves failed blocks and restores exactly', partial_progress)

    def cancellation():
        page, errors, _ = new_page(); original = page.locator('#reading').inner_html(); activate_lock(page)
        page.evaluate("witwitty.scenario='model-timeout';witwitty.dispatch({type:'SET_MODE',mode:'Explain'});witwitty.dispatch({type:'RESTORE'})")
        settled(page); page.wait_for_timeout(450)
        expect(state(page)['phase'] == 'restored', 'Stale generation revived cancelled state')
        expect(page.locator('#reading').inner_html() == original, 'Stale generation painted after restore')
        expect(not errors, f'Console errors: {errors}'); page.close()
    run('cancellation and stale completion cannot revive a restored lens', cancellation)

    def mutation():
        page, errors, _ = new_page(); activate_lock(page); command(page, {'type': 'SET_MODE', 'mode': 'Explain'})
        page.locator('#source-log').evaluate('(element)=>element.firstChild.data += " Updated locally."')
        page.wait_for_timeout(180)
        expect(state(page)['target'] is None and page.locator('[data-ww-owned="lens"]').count() == 0, 'Source mutation did not invalidate lens')
        expect(page.evaluate('witwitty.index.incrementalUpdates') >= 1, 'Text mutation rebuilt everything instead of incremental update')
        expect('Updated locally.' in page.evaluate('witwitty.index.get("paragraph-0").text'), 'Updated source missing in semantic index')
        page.locator('#source-log').click(); command(page, {'type': 'SET_MODE', 'mode': 'Explain'}); page.locator('#source-log').evaluate('(element)=>element.remove()')
        page.wait_for_timeout(180)
        expect(state(page)['target'] is None, 'Disappearing target stayed locked')
        expect(page.locator('[data-ww-owned="lens"]').count() == 0, 'Disappearing target retained orphan lens')
        expect(not errors, f'Console errors: {errors}'); page.close()
    run('incremental DOM changes and disappearing targets invalidate stale work', mutation)

    def sensitive_form():
        page, errors, _ = new_page(); activate_lock(page)
        page.evaluate('()=>{const input=document.createElement("input");input.type="password";document.body.append(input)}')
        command(page, {'type': 'SET_MODE', 'mode': 'Explain'})
        expect(state(page)['phase'] == 'failed' and 'Sensitive form' in state(page)['failure'], 'Dynamic privacy guard failed')
        expect(page.locator('[data-ww-owned="lens"]').count() == 0, 'Sensitive page got transformed')
        expect(not errors, f'Console errors: {errors}'); page.close()
    run('new sensitive form blocks generation even after earlier activation', sensitive_form)

    def dom_semantics():
        page, errors, _ = new_page()
        outcome = page.evaluate("""async () => {
          const {SemanticIndex,chooseRoot}=await wwLoad('core/semantic.js');
          const root=document.createElement('article');root.id='edge-fixture';
          root.innerHTML='<h1>Fixture</h1><section><h2>Part A</h2><p>Dr. Lee uses <em>3.14</em> units. A <a href="#">quorum</a> matters.</p><ul><li>First item.</li><li>Second item <code>count()</code>.</li></ul><blockquote><p>Quoted sentence.</p></blockquote><pre><code>doNotRewrite(3);</code></pre><p data-equation="true">x + y = z</p><table><tr><td><p>Excluded table.</p></td></tr></table><p contenteditable="true">Private edit.</p></section><section><h2>Part B</h2><p>Nested <strong>meaning</strong> stays intact.</p></section>';
          document.body.append(root);const index=new SemanticIndex(root);const nodes=[...index.nodes.values()];
          const parents=nodes.filter(n=>n.parent).every(n=>['Document','Section','Paragraph','Sentence','Term'].indexOf(n.scope)-['Document','Section','Paragraph','Sentence','Term'].indexOf(index.get(n.parent).scope)===1);
          const plans=index.plans('document','Rewrite');const editable=plans.flatMap(p=>p.segments.map(s=>s.text)).join('|');
          const first=nodes.find(n=>n.scope==='Paragraph');const selected=nodes.find(n=>n.scope==='Term'&&n.text==='quorum');
          const range=document.createRange();range.setStart(selected.parts.find(p=>p.end>selected.start).node,selected.start-selected.parts.find(p=>p.end>selected.start).start);range.setEnd(selected.parts.find(p=>p.end>=selected.end).node,selected.end-selected.parts.find(p=>p.end>=selected.end).start);
          const selection=getSelection();selection.removeAllRanges();selection.addRange(range);const snapped=index.fromSelection(selection);selection.removeAllRanges();
          const counts={paragraphs:nodes.filter(n=>n.scope==='Paragraph').length,sentences:nodes.filter(n=>n.scope==='Sentence'&&n.paragraphId===first.id).length};
          const exact=snapped?.text;const levels=new Set(nodes.map(n=>n.scope)).size;root.remove();
          const chosen=chooseRoot(document).tagName;
          return {parents,levels,editable,exact,counts,chosen};
        }""")
        expect(outcome['parents'] and outcome['levels'] == 5, f'Hierarchy invalid: {outcome}')
        expect(outcome['counts']['paragraphs'] == 7 and outcome['counts']['sentences'] == 2, f'Duplicate or missing semantic blocks: {outcome}')
        for excluded in ['doNotRewrite', 'count()', 'x + y', 'Excluded table', 'Private edit']:
            expect(excluded not in outcome['editable'], f'Protected text eligible for rewrite: {excluded}')
        expect(outcome['exact'] == 'quorum', 'Text selection did not snap to exact term across inline markup')
        expect(outcome['chosen'] == 'ARTICLE', 'Root selection failed to prioritize article')
        expect(not errors, f'Console errors: {errors}'); page.close()
    run('semantic DOM fixture: strict hierarchy, abbreviations, lists, quotations, inline markup and protections', dom_semantics)

    def snap_and_anchor():
        page, errors, _ = new_page()
        result = page.evaluate("""async()=>{
          const {SemanticIndex}=await wwLoad('core/semantic.js');const root=document.createElement('article');
          root.innerHTML='<h2>Snap</h2><p style="position:fixed;left:10px;top:10px;width:150px;height:30px">First choice.</p><p style="position:fixed;left:10px;top:10px;width:150px;height:30px">Second choice.</p>';
          document.body.append(root);const index=new SemanticIndex(root);const a=index.snap({x:30,y:20},'Paragraph');const b=index.snap({x:30,y:20},'Paragraph');
          const selected=a.node?.text;const stable=a.node?.id===b.node?.id;const explanation=index.history.at(-1).candidates[0].reason;
          const paragraph=index.get(a.node.id), sentence=index.get(paragraph.children[0]), last=index.get(sentence.children.at(-1));
          const inward=index.zoom(paragraph.id,'in',{paragraphId:paragraph.id,offset:last.start});const term=index.zoom(inward.id,'in',{paragraphId:paragraph.id,offset:last.start});
          root.remove();return {selected,stable,explanation,term:term.text,last:last.text};
        }""")
        expect(result['selected'] == 'First choice.' and result['stable'], 'Snap ties not deterministic')
        expect(result['explanation'] and result['term'] == result['last'], 'Snap reasoning or anchor-guided zoom failed')
        expect(not errors, f'Console errors: {errors}'); page.close()
    run('spatial snapping ties are inspectable and zoom follows the original anchor', snap_and_anchor)

    def preservation():
        page, errors, _ = new_page(); original = page.locator('#reading').inner_html()
        page.evaluate("window.linkEvents=0;document.querySelector('#reading a').addEventListener('click',event=>{event.preventDefault();window.linkEvents++})")
        activate_lock(page); command(page, {'type': 'ZOOM_OUT'}); command(page, {'type': 'ZOOM_OUT'}); command(page, {'type': 'SET_MODE', 'mode': 'Rewrite'})
        expect(page.locator('[data-ww-owned="lens"] a').count() == 1, 'Rewrite lost structural link')
        expect(page.locator('[data-ww-owned="lens"] code').count() >= 1, 'Rewrite lost protected inline code')
        command(page, {'type': 'RESTORE'}); expect(page.locator('#reading').inner_html() == original, 'Markup not restored exactly')
        page.locator('#reading a').click(); expect(page.evaluate('window.linkEvents') == 1, 'Original event listener was destroyed')
        expect(not errors, f'Console errors: {errors}'); page.close()
    run('reversible renderer preserves links, code, exact source DOM and original event listeners', preservation)

    def library_and_debug():
        page, errors, _ = new_page(); activate_lock(page); command(page, {'type': 'SET_MODE', 'mode': 'Explain'}); hud_open(page)
        page.get_by_role('button', name='Save', exact=True).click(); page.wait_for_timeout(30)
        page.get_by_role('button', name='Library', exact=True).click()
        expect(page.get_by_text('Reopen source', exact=True).count() == 1, 'Saved item not displayed')
        page.get_by_role('button', name='Delete', exact=True).click(); page.wait_for_timeout(30)
        expect(page.get_by_text('Nothing saved yet. Approve a lens, then choose Save.', exact=True).count() == 1, 'Saved item not deleted')
        page.get_by_role('button', name='Close', exact=True).click(); hud_open(page); page.get_by_role('button', name='Inspect', exact=True).click()
        trace = page.locator('[data-ww-owned="hud"] dialog pre').inner_text()
        expect('paragraph-0' in trace and 'reviewer' in trace and 'cache' in trace, 'Debug trace missing internals')
        expect('A replicated log records' not in trace, 'Debug export leaked source text')
        expect(not errors, f'Console errors: {errors}'); page.close()
    run('explicit local save, library deletion and redacted debug/provenance surface', library_and_debug)

    def offline_companion():
        page, errors, _ = new_page(); activate_lock(page)
        page.evaluate("async()=>{await witwitty.setTransport({health:async()=>{throw Error('offline')},transform:async()=>{throw Error('must not run')}})}")
        command(page, {'type': 'SET_MODE', 'mode': 'Explain'}); expect('Companion unavailable' in state(page)['failure'], 'Companion offline was hidden')
        command(page, {'type': 'ZOOM_IN'}); expect(state(page)['scope'] == 'Sentence', 'Offline state disabled deterministic navigation')
        expect(not errors, f'Console errors: {errors}'); page.close()
    run('companion offline leaves deterministic selection and zoom usable', offline_companion)

    def extension_reference():
        page, errors, _ = new_page(); original = page.locator('#reading').inner_html()
        page.evaluate("""() => {window.chrome={runtime:{id:'fixture-extension',getURL:p=>'chrome-extension://fixture/'+p,sendMessage:async m=>{if(m.type==='CONFIG')return {mode:'fixture'};if(m.type==='LIBRARY_LOAD')return [];return {ok:true}},onMessage:{addListener:()=>{},removeListener:()=>{}}}}}""")
        page.evaluate("async()=>{const content=await wwLoad('extension/content.js');await content.activate()}")
        page.locator('#source-log').click(); page.get_by_role('button', name='Explain', exact=True).click()
        page.wait_for_selector('[data-ww-owned="lens"]')
        expect('durability' in page.locator('[data-ww-owned="lens"]').inner_text(), 'Extension did not share fixture transformation engine')
        page.evaluate("async()=>{const content=await wwLoad('extension/content.js');await content.activate()}")
        expect(page.locator('#reading').inner_html() == original, 'Extension deactivation did not restore source')
        expect(not errors, f'Console errors: {errors}'); page.close()
    run('extension content integration uses shared semantic engine and renderer (Chrome API test double)', extension_reference)

    for width, height, theme in [(1440, 1000, 'dark'), (390, 844, 'dark'), (390, 844, 'light')]:
        def visual_case(width=width, height=height, theme=theme):
            page, errors, _ = new_page(width, height)
            if theme == 'light': page.get_by_role('button', name='Light', exact=True).click()
            activate_lock(page); command(page, {'type': 'SET_MODE', 'mode': 'Explain'})
            # Compact HUD is the ordinary reading state; expanded state is also tested for overflow.
            hud_open(page)
            geometry = page.locator('[data-ww-owned="hud"] details.dock').evaluate('(element)=>({left:element.getBoundingClientRect().left,right:element.getBoundingClientRect().right,width:element.scrollWidth,client:element.clientWidth})')
            expect(geometry['left'] >= 0 and geometry['right'] <= width + 1 and geometry['width'] <= geometry['client'] + 1, f'HUD overflow: {geometry}')
            page.screenshot(path=str(ARTIFACTS / f'{theme}-{width}-expanded.png'))
            page.locator('[data-ww-owned="hud"] details.dock').evaluate('(element)=>element.open=false')
            expect(page.evaluate('document.documentElement.scrollWidth<=innerWidth+1'), 'Page horizontal overflow')
            page.screenshot(path=str(ARTIFACTS / f'{theme}-{width}-reading.png'))
            expect(not errors, f'Console errors: {errors}'); page.close()
        run(f'visual and responsive QA {width}x{height} {theme}', visual_case)


    def coherent_overviews():
        page, errors, _ = new_page(); original = page.locator('#reading').inner_html()
        activate_lock(page); command(page, {'type': 'ZOOM_OUT'}); command(page, {'type': 'SET_MODE', 'mode': 'Explain'})
        overview = page.locator('[data-overview="true"]')
        expect(overview.count() == 1, 'Section overview missing')
        expect('Fixture preview' not in overview.inner_text(), 'Curated section received a generic fallback')
        command(page, {'type': 'ZOOM_OUT'})
        expect(overview.count() == 1 and 'local evidence' in overview.inner_text(), 'Coherent main-argument overview missing')
        expect(page.locator('[data-ww-owned="lens"]').count() == state(page)['progress']['approved'], 'Overview and block results collided')
        source = page.evaluate('witwitty.savedItem().original')
        expect(source.count('A replicated log records') == 1, 'Saving duplicated overview source')
        page.screenshot(path=str(ARTIFACTS / 'document-overview.png'))
        command(page, {'type': 'RESTORE'}); expect(page.locator('#reading').inner_html() == original, 'Overview restore mismatch')
        expect(not errors, f'Console errors: {errors}'); page.close()
    run('reviewed section/document overview plus progressive detail, single-copy save and exact restore', coherent_overviews)

    def bounded_index():
        page, errors, _ = new_page()
        result = page.evaluate("""async()=>{
          const {SemanticIndex}=await wwLoad('core/semantic.js');
          const root=document.createElement('article'); const huge=document.createElement('p'); huge.textContent='word '.repeat(4000);
          const regular=document.createElement('p');regular.textContent='This eligible paragraph remains selectable.';root.append(huge,regular);document.body.append(root);
          const index=new SemanticIndex(root);const result={limited:index.limited,paragraphs:index.paragraphs(index.rootId).length,first:index.paragraphs(index.rootId)[0].text};
          root.remove();return result;
        }""")
        expect(result['limited'] and result['paragraphs'] == 1 and 'eligible' in result['first'], 'Oversized blocks were not bounded')
        expect(not errors, f'Console errors: {errors}');page.close()
    run('oversized semantic blocks are omitted explicitly without losing eligible following text', bounded_index)

    def bounded_work():
        page, errors, _ = new_page()
        result = page.evaluate("""async()=>{const {SemanticIndex}=await wwLoad('core/semantic.js');const root=document.createElement('article');
          for(let i=0;i<501;i++){const p=document.createElement('p');p.textContent='An eligible sentence.';root.append(p);}document.body.append(root);
          const index=new SemanticIndex(root);let rejected=false;try{index.plans('document','Rewrite')}catch(error){rejected=error.message.includes('500-block')};root.remove();return rejected;
        }""")
        expect(result, 'Work limit silently truncated the document');expect(not errors, f'Console errors: {errors}');page.close()
    run('oversized work scope fails explicitly rather than silently rewriting a prefix', bounded_work)

    def extension_exit():
        page, errors, _ = new_page(); original = page.locator('#reading').inner_html()
        page.evaluate("""()=>{window.wwMessages=[];window.chrome={runtime:{id:'fixture-extension',getURL:p=>'chrome-extension://fixture/'+p,sendMessage:async m=>{wwMessages.push(m);return m.type==='CONFIG'?{mode:'fixture'}:{ok:true}},onMessage:{addListener:()=>{},removeListener:()=>{}}}}}""")
        page.evaluate("async()=>{const content=await wwLoad('extension/content.js');await content.activate()}")
        page.locator('#source-log').click();page.get_by_role('button',name='Explain',exact=True).click();page.wait_for_selector('[data-ww-owned="lens"]')
        page.get_by_role('button',name='Exit',exact=True).click()
        expect(page.locator('[data-ww-owned="hud"]').count()==1, 'Extension HUD did not fully unmount; the remaining one is the inactive demo HUD')
        expect(page.evaluate("wwMessages.some(m=>m.type==='END_SESSION')"), 'Exit did not revoke background authorization')
        expect(page.locator('#reading').inner_html()==original, 'Exit did not restore original')
        page.evaluate("async()=>{const content=await wwLoad('extension/content.js');await content.activate()}")
        page.keyboard.press('Alt+w');page.wait_for_timeout(30)
        expect(page.locator('[data-ww-owned="hud"]').count()==1, 'Keyboard deactivation left extension listener/HUD runtime active')
        expect(not errors, f'Console errors: {errors}');page.close()
    run('extension HUD Exit and keyboard deactivation perform full teardown and revoke session', extension_exit)

    def camera_surface():
        page=browser.new_page(viewport={'width':520,'height':960}); errors=[]; page.on('pageerror',lambda error:errors.append(str(error)))
        if args.offline:
            page.expose_function('__wwDigest',lambda data:list(hashlib.sha256(bytes(data)).digest()))
            html=ROOT.joinpath('camera.html').read_text();html=re.sub(r'<script[^>]*>.*?</script>','',html,flags=re.S);html=re.sub(r'<link[^>]*>','',html)
            page.set_content(html);page.add_style_tag(content=ROOT.joinpath('camera.css').read_text())
            page.evaluate("()=>{window.fetch=async()=>new Response('',{status:404});}")
            page.add_script_tag(content=ROOT.joinpath('artifacts/offline-camera.js').read_text())
        else:
            page.route('**/vendor/asset-manifest.json',lambda route:route.fulfill(status=404,body=''))
            page.goto('http://127.0.0.1:4174/camera.html',wait_until='networkidle')
        expect(page.locator('#gesture option').count()==10, 'Calibration vocabulary incomplete')
        page.get_by_role('button',name='Record one repetition',exact=True).click()
        expect('Start the camera before recording' in page.locator('#camera-status').inner_text(), 'Calibration recorded without camera')
        page.get_by_role('button',name='Start camera',exact=True).click()
        page.wait_for_function("() => document.querySelector('#camera-status').textContent.includes('assets are missing')")
        expect(page.locator('#start-camera').is_enabled(), 'Failed setup left start control disabled')
        expect(not page.locator('#enable-controls').is_checked(), 'Camera controls enabled after setup failed')
        page.get_by_role('button',name='Reset full calibration',exact=True).click()
        expect('0/3' in page.locator('#calibration-counts').inner_text(), 'Profile reset not reflected in UI')
        page.screenshot(path=str(ARTIFACTS/'camera-studio.png'))
        expect(not errors,f'Console errors: {errors}');page.close()
    run('camera/calibration UI, ten gestures, zero-frame initial state and recoverable missing-asset failure',camera_surface)

    browser.close()

if server:
    server.terminate()
    server.wait(timeout=5)
report = {'mode': 'offline-DOM-platform-boundary-harness' if args.offline else 'native-localhost-browser',
          'browser_plugin': 'not available; Python Playwright used', 'results': results,
          'passed': sum(result['status'] == 'PASS' for result in results), 'failed': sum(result['status'] == 'FAIL' for result in results)}
ARTIFACTS.joinpath('results.json').write_text(json.dumps(report, indent=2) + '\n')
print(json.dumps({key: report[key] for key in ['mode', 'passed', 'failed']}, indent=2))
sys.exit(1 if report['failed'] else 0)
