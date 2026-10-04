# Continue WitWitty 2.0 without rebuilding what is already done

You are continuing an implemented WitWitty 2.0 change, not starting from an empty idea. The handoff contains additive source, a patch, compiled mock-demo/extension artifacts, verification logs and a prepared PR body. Read `v2/README.md`, `v2/docs/decisions.md`, `v2/docs/verification.md`, and `v2/docs/handoff.md` first.

Repository: `https://github.com/flowersbl00minadarkr00m/witwitty`
Default base: `master`
Inspected starting commit: `fdc2a3c24fa62aaa76b1a3a03c8af07e16dc0b94`
Intended branch: `feat/witwitty-2-spatial-lens`

The previous environment could read GitHub but branch creation returned HTTP 403. Do not assume a remote branch or PR was created. Inspect current branches/PRs before creating duplicates. Do not merge the implementation into master.

## Apply safely

Use an actual full repository checkout. Check `git status`, remote URL, current base and existing `v2/` files first. Do not discard local edits, force-push, overwrite a newer implementation, reset the user's work or add provider credentials. Fetch the current `master`; the patch adds new paths only. A new `v2/` already present is a conflict requiring reconciliation, not permission to overwrite it.

For a clean checkout without those new paths, use this sequence, replacing the patch path with its actual location:

```sh
git fetch origin
git switch -c feat/witwitty-2-spatial-lens origin/master
git apply --check /ACTUAL/PATH/witwitty-2.patch
git apply /ACTUAL/PATH/witwitty-2.patch
```

Alternatively the handoff supplies a mailbox patch preserving local logical commits; choose **one** method, not both. Apply with `git am /ACTUAL/PATH/witwitty-2-commits.mbox` only after checking the patch contents and clean worktree. The local implementation history was an additive workspace, not a clone of master, so do not push that workspace's unrelated root history.

## Verify and finish the PR

Build and run the exact checks from `verification.md`. The previous result was 235 passing Node tests and 28 passing browser flows in a documented offline DOM harness. Your acceptance target is the normal native-localhost E2E path, plus actual extension loading where available. Do not relabel offline or SDK-double evidence as native browser testing. Add regressions for any real-platform issue you fix.

Keep the parallel input-adapter architecture. Models do not choose semantic scope. No unreviewed text reaches the DOM. Do not move model keys into browser storage. Do not remove fail-closed quantity/segment/review guards merely to get a provider output accepted.

Inspect the diff, stage only the intended additions/changes, and commit logically. Push the feature branch. Open or update the PR against `master` using `v2/docs/PR.md` as the body, updating verification and publication status to actual results. Wait for/read CI and fix attributable failures. Do not claim a successful PR or test result without its actual output.

For the plain `git apply` route, the publication commands after verification are:

```sh
git add v2 .github/workflows/witwitty-v2.yml
git commit -m "feat: add WitWitty 2.0 shared spatial reading implementation"
git push -u origin feat/witwitty-2-spatial-lens
gh pr create --base master --head feat/witwitty-2-spatial-lens --title "WitWitty 2.0: shared spatial reading engine, demo, extension and companion" --body-file v2/docs/PR.md
```

Use the available GitHub integration instead of `gh` when appropriate. If publication is still denied, report the exact error and preserve the complete local work. Do not bypass organizational access controls or ask the user to paste a token into chat.

Only after the native reference path is healthy should Henry need to approve webcam permissions, calibrate gestures, supply real model/Jev credentials locally, and judge physical/visual quality. End with a precise complete / built-needs-local / needs-credential / needs-human-judgment / not-built handoff.
