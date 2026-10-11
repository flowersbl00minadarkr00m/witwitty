"""Native MV3 activation, storage, companion and local detector acceptance.

Use Playwright 1.63.0's Chromium. No Chrome API doubles or added host permissions.
The DevTools extension action command invokes Chrome's action and activeTab grant.
Optional --camera checks use a synthetic camera, never the user's hardware.
"""
from __future__ import annotations
import argparse
import html
import json
import os
from pathlib import Path
import subprocess
import tempfile
import time
import traceback
from urllib.request import urlopen
from playwright.sync_api import sync_playwright, expect

ROOT = Path(__file__).resolve().parents[1]
parser = argparse.ArgumentParser()
parser.add_argument('--camera', action='store_true')
parser.add_argument('--artifacts', default=str(ROOT / 'artifacts/native-platform'))
args = parser.parse_args()
artifacts = Path(args.artifacts)
artifacts.mkdir(parents=True, exist_ok=True)
results = []
processes = []
token = 'native-platform-test-pairing-token'


def check(name, condition):
    if not condition:
        raise AssertionError(name)
    results.append({'name': name, 'status': 'PASS'})
    print('PASS', name, flush=True)


def start(script, port, env=None):
    try:
        urlopen(f'http://127.0.0.1:{port}/', timeout=1).close()
    except Exception:
        process = subprocess.Popen(['node', str(ROOT / script)],
                                   stdout=subprocess.DEVNULL, stderr=subprocess.PIPE,
                                   env=env, creationflags=subprocess.CREATE_NO_WINDOW if os.name == 'nt' else 0)
        processes.append(process)
        for _ in range(100):
            if process.poll() is not None:
                raise RuntimeError(process.stderr.read().decode())
            try:
                urlopen(f'http://127.0.0.1:{port}/health' if port == 4317 else f'http://127.0.0.1:{port}/', timeout=1).close()
                return
            except Exception:
                time.sleep(.1)
        raise RuntimeError(f'Local server did not start on port {port}')
    raise RuntimeError(f'Port {port} is already in use. Stop that server before this isolated acceptance run.')


try:
    start('scripts/serve.mjs', 4174)
    start('companion/server.mjs', 4317, {**os.environ, 'WW_MODE': 'mock', 'WW_PAIRING_TOKEN': token})
    article = json.loads(subprocess.check_output(['node', '--input-type=module', '-e',
        "import {ARTICLE} from './v2/dist/fixtures/article.js'; console.log(JSON.stringify(ARTICLE));"],
        cwd=ROOT.parent, encoding='utf-8'))
    fixture = '<!doctype html><html lang="en"><meta charset="utf-8"><title>Native article fixture</title>' \
        '<style>body{font:18px/1.6 system-ui;margin:60px auto;max-width:720px}p{margin:30px 0}</style>' \
        '<article><h1>Native article fixture</h1><section><h2>A record is not a guarantee</h2>' \
        + ''.join(f'<p id="source-{block["id"]}">{html.escape(block["source"])}</p>' for block in article[:3]) \
        + '<p>A <a href="#source-log">quorum</a> is useful in its protocol. Keep <code>commitIndex</code> unchanged.</p>' \
        '<pre><code>apply(entry);</code></pre></section></article></html>'
    csp = "default-src 'self'; script-src 'self' 'wasm-unsafe-eval'; style-src 'self' 'unsafe-inline'; object-src 'none'"
    with sync_playwright() as playwright, tempfile.TemporaryDirectory(prefix='witwitty-native-', ignore_cleanup_errors=True) as profile:
        extension = str(ROOT / 'dist-extension')
        context = playwright.chromium.launch_persistent_context(profile,
            executable_path=os.environ.get('WW_CHROMIUM') or None, channel='chromium', headless=True,
            accept_downloads=True, viewport={'width': 1440, 'height': 1000},
            args=[f'--disable-extensions-except={extension}', f'--load-extension={extension}',
                  '--enable-unsafe-extension-debugging', '--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream'])
        errors = []
        context.on('weberror', lambda error: errors.append(str(error.error)))
        try:
            worker = context.service_workers[0] if context.service_workers else context.wait_for_event('serviceworker')
            extension_id = worker.url.split('/')[2]
            browser_version = context.browser.version
            check('native MV3 service worker loads with the committed extension ID', extension_id == 'acohiiaihcmphpjidgalmghdnnbgfnfl')
            browser_cdp = context.browser.new_browser_cdp_session()

            def action(page):
                page.bring_to_front()
                tabs = browser_cdp.send('Target.getTargets', {'filter': [{'type': 'tab', 'exclude': False}, {'exclude': True}]})['targetInfos']
                target = next(tab['targetId'] for tab in tabs if tab['url'] == page.url)
                browser_cdp.send('Extensions.triggerAction', {'id': extension_id, 'targetId': target})

            def open_controls(page):
                page.locator('[data-ww-owned="hud"] details.dock').evaluate('(dock) => dock.open = true')

            page = context.new_page()
            context.route('**/native-article*', lambda route: route.fulfill(status=200, content_type='text/html',
                headers={'Content-Security-Policy': csp}, body=fixture))
            page.goto('http://127.0.0.1:4174/native-article')
            original = page.locator('article').inner_html()
            check('ordinary page is dormant before native action activation', page.locator('[data-ww-owned="hud"]').count() == 0)
            action(page)
            expect(page.locator('[data-ww-owned="hud"]')).to_have_count(1)
            page.locator('#source-log').click()
            open_controls(page)
            page.get_by_role('button', name='Explain', exact=True).click()
            expect(page.locator('[data-ww-owned="lens"]')).to_have_count(1)
            check('native action grants activeTab and loads the reviewed content runtime under CSP', 'durability' in page.locator('[data-ww-owned="lens"]').inner_text())
            for depth in ['ELI5', 'Plain', 'General', 'Advanced', 'Expert']:
                open_controls(page)
                page.get_by_role('button', name=depth, exact=True).click()
                expect(page.locator('[data-ww-owned="lens"] > div')).to_have_text(article[0]['explain'][depth])
            check('native extension supports all five reviewed depths', True)
            open_controls(page)
            page.get_by_role('button', name='Save', exact=True).click()
            expect(page.locator('[data-ww-owned="hud"] .status')).to_have_text('Saved in this browser.')
            options = context.new_page()
            options.goto(f'chrome-extension://{extension_id}/options.html')
            expect(options.locator('#library article')).to_have_count(1)
            with options.expect_download() as download:
                options.get_by_role('button', name='Export JSON', exact=True).click()
            saved = json.loads(Path(download.value.path()).read_text(encoding='utf-8'))
            check('native trusted storage, options and JSON download retain the explicit save', len(saved) == 1 and saved[0]['depth'] == 'Expert' and saved[0]['original'] == article[0]['source'])
            with options.expect_download() as download:
                options.get_by_role('button', name='Export Markdown', exact=True).click()
            check('native Markdown download contains the saved source and transformation', article[0]['source'] in Path(download.value.path()).read_text(encoding='utf-8'))
            options.locator('#token').fill(token)
            options.locator('#mode').select_option('companion')
            options.get_by_role('button', name='Save settings', exact=True).click()
            expect(options.locator('#status')).to_contain_text('Settings saved locally')
            options.get_by_role('button', name='Check companion', exact=True).click()
            expect(options.locator('#status')).to_contain_text('Companion connected')
            check('native extension origin pairs with the real loopback companion', True)
            open_controls(page)
            page.get_by_role('button', name='Exit', exact=True).click()
            expect(page.locator('[data-ww-owned="hud"]')).to_have_count(0)
            check('native Exit restores the untouched source and fully unmounts', page.locator('article').inner_html() == original)
            action(page)
            expect(page.locator('[data-ww-owned="hud"]')).to_have_count(1)
            page.locator('#source-log').click()
            open_controls(page)
            page.get_by_role('button', name='Explain', exact=True).click()
            expect(page.locator('[data-ww-owned="lens"]')).to_have_count(1)
            check('native content port streams only reviewed companion output', 'durability' in page.locator('[data-ww-owned="lens"]').inner_text())
            open_controls(page)
            page.get_by_role('button', name='Rewrite', exact=True).click()
            expect(page.locator('[data-ww-owned="lens"]')).to_have_attribute('data-mode', 'Rewrite')
            open_controls(page)
            page.get_by_role('button', name='Restore original', exact=True).click()
            expect(page.locator('[data-ww-owned="lens"]')).to_have_count(0)
            check('native companion Rewrite restores byte-identical source DOM', page.locator('article').inner_html() == original)
            page.screenshot(path=str(artifacts / 'native-extension.png'))
            page.goto('http://127.0.0.1:4174/native-article-next')
            expect(page.locator('[data-ww-owned="hud"]')).to_have_count(0)
            sessions = worker.evaluate("async () => (await chrome.storage.session.get('sessions')).sessions")
            check('native navigation revokes the previous article session', not sessions)
            options.locator('#library').get_by_role('button', name='Delete', exact=True).click()
            expect(options.locator('#library article')).to_have_count(0)
            check('native library deletion persists', worker.evaluate("async () => (await chrome.storage.local.get('library')).library.length") == 0)
            context.route('https://mail.google.com/native-article', lambda route: route.fulfill(status=200, content_type='text/html', body=fixture))
            page.goto('https://mail.google.com/native-article')
            action(page)
            expect(page.locator('[data-ww-owned="hud"]')).to_have_count(0)
            check('native activation blocks a sensitive domain without injection', worker.evaluate("async () => !(Object.keys((await chrome.storage.session.get('sessions')).sessions || {}).length)"))
            page_cdp = context.new_cdp_session(options)
            page_cdp.send('ServiceWorker.enable')
            page_cdp.send('ServiceWorker.stopAllWorkers')
            options.reload()
            expect(options.locator('#mode')).to_have_value('companion')
            expect(options.locator('#token')).to_have_value(token)
            expect(options.locator('#library article')).to_have_count(0)
            check('native service-worker restart preserves settings and deletion', True)

            if args.camera:
                check('optional local camera assets are installed', (ROOT / 'dist/vendor/asset-manifest.json').is_file())
                camera = context.new_page()
                camera.goto('http://127.0.0.1:4174/camera.html?session=native-camera-test')
                camera.bring_to_front()
                camera.get_by_role('button', name='Start camera', exact=True).click()
                expect(camera.locator('#camera-status')).to_contain_text('Camera active', timeout=30000)
                expect(camera.locator('#recognized')).to_contain_text('No single stable hand', timeout=10000)
                check('local worker, WASM, model and synthetic video frames run without camera hardware', True)
                camera.get_by_role('button', name='Stop & release camera', exact=True).click()
                check('synthetic camera stop releases tracks', camera.locator('#preview').evaluate('(video) => video.srcObject === null'))
                camera.evaluate('''() => {
                    const original = navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);
                    let first = true;
                    navigator.mediaDevices.getUserMedia = options => first
                        ? (first = false, new Promise((resolve, reject) => { window.rejectOldCamera = reject; }))
                        : original(options);
                }''')
                camera.get_by_role('button', name='Start camera', exact=True).click()
                camera.wait_for_function('() => !!window.rejectOldCamera', timeout=30000)
                camera.get_by_role('button', name='Stop & release camera', exact=True).click()
                camera.get_by_role('button', name='Start camera', exact=True).click()
                expect(camera.locator('#camera-status')).to_contain_text('Camera active', timeout=30000)
                camera.evaluate("() => window.rejectOldCamera(new Error('Old permission request cancelled'))")
                expect(camera.locator('#recognized')).to_contain_text('No single stable hand', timeout=10000)
                check('a stale camera permission failure cannot stop a newer capture session', camera.locator('#preview').evaluate('(video) => video.srcObject?.getTracks().every(track => track.readyState === "live")'))
                camera.get_by_role('button', name='Stop & release camera', exact=True).click()
                camera.close()
                # Extension origin has a different CSP and worker/module path.
                page.set_viewport_size({'width': 1200, 'height': 500})
                page.goto('http://127.0.0.1:4174/native-article-camera')
                action(page)
                expect(page.locator('[data-ww-owned="hud"]')).to_have_count(1)
                open_controls(page)
                with context.expect_page() as popup:
                    page.get_by_role('button', name='Camera', exact=True).click()
                camera = popup.value
                camera.wait_for_load_state()
                camera.bring_to_front()
                camera.get_by_role('button', name='Start camera', exact=True).click()
                expect(camera.locator('#camera-status')).to_contain_text('Camera active', timeout=30000)
                expect(camera.locator('#recognized')).to_contain_text('No single stable hand', timeout=10000)
                check('native extension camera runs its local detector under extension CSP', True)
                target = camera.evaluate("() => chrome.runtime.sendMessage({type: 'CAMERA_TARGET'})")
                receipt = camera.evaluate("session => chrome.runtime.sendMessage({type: 'CAMERA_INTENT', session, intent: {type: 'SET_MODE', mode: 'Explain'}})", target['session'])
                check('native camera action is acknowledged and reports a missing locked target', receipt.get('ok') is True and receipt.get('targetLocked') is False)
                page.evaluate('() => window.scrollTo(0, 0)')
                receipt = camera.evaluate("session => chrome.runtime.sendMessage({type: 'CAMERA_INTENT', session, intent: {type: 'SCROLL', deltaY: 100}})", target['session'])
                check('native camera action reaches the article and actually scrolls it', receipt.get('ok') is True and page.evaluate('() => window.scrollY') > 0)
                expect(camera.locator('#control-status')).to_contain_text('Keep one well-lit hand')
                camera.screenshot(path=str(artifacts / 'camera-control-status.png'))
                camera.locator('#enable-controls').click()
                expect(camera.locator('#enable-controls')).not_to_be_checked()
                check('uncalibrated native camera cannot enable gesture actions', True)
                camera.get_by_role('button', name='Stop & release camera', exact=True).click()
                check('native extension camera stop releases tracks', camera.locator('#preview').evaluate('(video) => video.srcObject === null'))
                # Optional private profile stays outside source and is used only in this disposable browser.
                if os.environ.get('WW_CALIBRATION_AUDIT_FILE'):
                    personal_profile = json.loads(Path(os.environ['WW_CALIBRATION_AUDIT_FILE']).read_text(encoding='utf-8-sig'))
                    camera.evaluate("profile => chrome.runtime.sendMessage({type:'CALIBRATION_SAVE',value:profile})", personal_profile)
                    camera.reload()
                    expect(camera.locator('#calibration-quality')).to_contain_text('30/30 saved examples pass')
                    with camera.expect_download() as personal_download:
                        camera.get_by_role('button', name='Download calibration data', exact=True).click()
                    check('private existing profile loads and exports unchanged after recognition upgrade', json.loads(Path(personal_download.value.path()).read_text()) == personal_profile)
                    camera.screenshot(path=str(artifacts / 'camera-existing-profile.png'), full_page=True)
                # Controlled landmarks isolate classifier/gate/message wiring from physical recognition.
                landmark_fixture = json.loads(subprocess.check_output(['node', '--input-type=module', '-e',
                    "import {syntheticFrame} from './v2/dist/fixtures/gestures.js'; import {features,GESTURES} from './v2/dist/gesture/engine.js'; const frame=syntheticFrame('point',1000); const profile={version:1,handedness:'Right',savedAt:new Date().toISOString(),samples:Object.fromEntries(GESTURES.map((g,i)=>[g,Array.from({length:3},()=>g==='point'?features([frame]):Array.from({length:8},(_,c)=>c===i%8?(i<8?1:-1):0))]))}; console.log(JSON.stringify({frame,profile}));"], cwd=ROOT.parent, encoding='utf-8'))
                saved = camera.evaluate("profile => chrome.runtime.sendMessage({type:'CALIBRATION_SAVE',value:profile})", landmark_fixture['profile'])
                check('native controlled profile persists through the actual calibration storage path', saved.get('ok') is True)
                camera.add_init_script('''window.fixtureFrame = ''' + json.dumps(landmark_fixture['frame']) + ''';
                  window.Worker = class {
                    postMessage(data) {
                      if (data.type === 'init') queueMicrotask(() => this.onmessage?.({data:{type:'ready'}}));
                      if (data.type === 'frame') {
                        window.fixtureFrameCount = (window.fixtureFrameCount ?? 0) + 1;
                        data.bitmap.close();
                        const frame=structuredClone(window.fixtureFrame); frame.at=data.at;
                        queueMicrotask(() => this.onmessage?.({data:{type:'landmarks',frame}}));
                      }
                    }
                    terminate() {}
                  };''')
                camera.reload()
                expect(camera.locator('#calibration-quality')).to_contain_text('Ready.')
                with camera.expect_download() as profile_download:
                    camera.get_by_role('button', name='Download calibration data', exact=True).click()
                downloaded_profile = json.loads(Path(profile_download.value.path()).read_text())
                check('native calibration export contains the saved numeric profile without changing it', downloaded_profile == landmark_fixture['profile'] and set(downloaded_profile) == {'version','handedness','savedAt','samples'})
                camera.locator('#handedness').select_option('Left')
                expect(camera.locator('#handedness')).to_have_value('Right')
                expect(camera.locator('#camera-status')).to_contain_text('profile was kept')
                check('changing hand cannot erase or relabel a saved profile', camera.evaluate("() => chrome.runtime.sendMessage({type:'CALIBRATION_LOAD'})") == landmark_fixture['profile'])
                camera.get_by_role('button', name='Start camera', exact=True).click()
                expect(camera.locator('#camera-status')).to_contain_text('Camera active')
                camera.locator('#record').click()
                expect(camera.locator('#camera-status')).to_contain_text('Get ready')
                expect(camera.locator('#camera-status')).to_contain_text('Recorded point from', timeout=10000)
                updated_profile = camera.evaluate("() => chrome.runtime.sendMessage({type:'CALIBRATION_LOAD'})")
                check('countdown recording saves one repetition through the actual storage path', len(updated_profile['samples']['point']) == 4 and all(updated_profile['samples'][g] == rows for g, rows in landmark_fixture['profile']['samples'].items() if g != 'point'))
                camera.evaluate('''() => {
                  const send = chrome.runtime.sendMessage.bind(chrome.runtime);
                  chrome.runtime.sendMessage = message => message.type === 'CALIBRATION_SAVE' ? Promise.resolve({ok:false}) : send(message);
                }''')
                camera.locator('#record').click()
                expect(camera.locator('#camera-status')).to_contain_text('could not be saved', timeout=10000)
                expect(camera.locator('#calibration-counts')).to_contain_text('point: 4/3')
                check('failed save is reported and does not change the persisted profile', camera.evaluate("() => chrome.runtime.sendMessage({type:'CALIBRATION_LOAD'})") == updated_profile)
                camera.evaluate('() => window.fixtureFrame.hands = 2')
                camera.locator('#record').click()
                expect(camera.locator('#camera-status')).to_contain_text('Recording timed out', timeout=10000)
                check('invalid tracking cannot save a repetition and recording times out', camera.evaluate("() => chrome.runtime.sendMessage({type:'CALIBRATION_LOAD'})") == updated_profile)
                camera.evaluate('() => window.fixtureFrame.hands = 1')
                camera.locator('#enable-controls').check()
                expect(camera.locator('#recognized')).to_contain_text('point')
                expect(camera.locator('#last-action')).to_contain_text('Article received: pointing.')
                check('controlled landmarks pass recognition, dwell and actual article acknowledgment', True)
                camera.screenshot(path=str(artifacts / 'camera-action-received.png'))
                page.reload()
                expect(camera.locator('#last-action')).to_contain_text('Article connection lost.')
                expect(camera.locator('#enable-controls')).not_to_be_checked()
                frame_count = camera.evaluate('() => window.fixtureFrameCount')
                camera.wait_for_function('count => window.fixtureFrameCount >= count + 6', arg=frame_count)
                expect(camera.locator('#last-action')).to_contain_text('Article connection lost.')
                check('stale camera connection disables controls and shows recovery instead of silent failure', True)
                camera.screenshot(path=str(artifacts / 'camera-connection-lost.png'))
                camera.get_by_role('button', name='Stop & release camera', exact=True).click()
                camera.close()
            check('native platform run has no uncaught browser exceptions', not errors)
        finally:
            context.close()
except Exception as error:
    results.append({'name': 'native platform acceptance', 'status': 'FAIL', 'error': str(error)})
    traceback.print_exc()
finally:
    for process in reversed(processes):
        process.terminate()
        process.wait(timeout=5)
    report = {'mode': 'native-Chromium-MV3-real-loopback', 'browser': globals().get('browser_version'),
              'camera': 'synthetic device, local actual inference' if args.camera else 'not requested',
              'results': results, 'passed': sum(item['status'] == 'PASS' for item in results),
              'failed': sum(item['status'] == 'FAIL' for item in results)}
    (artifacts / 'results.json').write_text(json.dumps(report, indent=2) + '\n', encoding='utf-8')
    print(json.dumps({key: report[key] for key in ['mode', 'passed', 'failed']}, indent=2))
raise SystemExit(1 if report['failed'] else 0)
