## Goal
Stop remote `main` tracking 6567 `node_modules` files. Local had already removed them; remote still tracked them. Fix via merge + push.

## Constraints & Preferences
- Default clean cutover: migrate callers, remove obsolete code/aliases.
- Push is destructive; verify merge is conflict-free before pushing.
- Preserve the 17 files moved into `tmp/` by the remote "pulizia progetto" commit.

## Progress
### Done
- [x] Confirmed local tip `c1a7520` tree tracks **0** `node_modules`; remote tip `996e77a` tracks **6567**.
- [x] Confirmed `.gitignore` line 2 `node_modules/` ignores the path (`git check-ignore -v node_modules` → `.gitignore:2:node_modules/ node_modules`).
- [x] Tree comparison: remote tip `996e77a` = **6627** files (17 in `tmp/` + 6567 `node_modules`); local tip `c1a7520` = **63** files (17 in `tmp/` + 46 others). Local had ALREADY moved the same 17 files into `tmp/` and already removed `node_modules`.
- [x] Verified no path conflict: **60 files** overlap path-sensitively on both sides (17 of them under `tmp/`); remote's extras beyond the shared 60 are **all** `node_modules`.
- [x] Ran `git merge --no-edit origin/main` → "Merge made by the 'ort' strategy", exit 0, no conflicts.
- [x] Verified merge result: `node_modules` = **0** in HEAD tree AND working tree/index; HEAD is a 2-parent merge commit `f4c64c6` (parents `c1a7520`, `996e77a`).
- [x] `git push origin main` → `996e77a..f4c64c6 main -> main`, exit 0.
- [x] Verified remote: `git ls-remote origin main` → `f4c64c6...`; `git ls-tree -r origin/main | grep node_modules` = **0**; local HEAD == remote HEAD (`f4c64c61c4a58b7e2d1c145caa0ecf1f3e48d4a4`).
- [x] Working tree clean after push.

### In Progress
- (none)

### Pending
- (none)

## Key Decisions
- **Merge instead of force-push**: local already removed `node_modules` and already moved the same 17 files into `tmp/`. Merging remote added only `node_modules`, which local's `.gitignore` excludes, so the merge result equals local's tree with node_modules omitted. Git refused to merge in ignored files, which is the desired outcome. This preserves the remote's 17 `tmp/` moves without touching local work.
- Note: some pathspec/`ls-tree -l` queries were buggy for pathspec/tree forms early on; the decisive test (actual merge + push + remote `ls-tree`) confirms state directly.

## Critical Context
- Local tip: `c1a7520` (before merge); remote tip: `996e77a` "pulizia progetto" (17 files moved into `tmp/`; inherits 6567 `node_modules` from ancestor `eafd006`).
- Merge commit: `f4c64c6` (parents `996e77a` and `c1a7520`).
- `node_modules` count was 6567 tracked files on remote; now 0 everywhere.
- Reproduce/verify: `git ls-tree -r origin/main | grep -c node_modules` → expect 0.

## Next Steps
1. (Done) Confirmed clean working state: working tree clean, merge commit `f4c64c6` atop `c1a7520`/`996e77a`, local HEAD == remote HEAD.
2. (Optional, if asked) Remove the now-empty `tmp/` subtree if it is no longer needed — NOT done unless user requests, since it was part of the remote's "pulizia progetto" commit and removal would alter that history.
