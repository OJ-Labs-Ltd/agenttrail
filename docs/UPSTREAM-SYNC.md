# Syncing with upstream

This fork tracks [sodiumsun/agenttrail](https://github.com/sodiumsun/agenttrail). To keep merges small, fork changes avoid renaming or reformatting upstream files and add new files where they can.

## Bring in upstream changes

Do this on a branch, never directly on `dev`.

```sh
git remote add upstream https://github.com/sodiumsun/agenttrail.git   # first time only
git fetch upstream
git switch -c sync/upstream-YYYY-MM-DD dev
git merge upstream/main
```

Resolve conflicts, then check the result the same way CI does:

```sh
cd packages/kitchen
npm ci && npm run build && npm run check && npm test
npm pack && node scripts/check-package.mjs ./agenttrail-kitchen-*.tgz
node --check ../../bin/agenttrail.mjs
```

Open the pull request as usual. The merge commit is the record of what came from upstream; do not squash it.

## CI mirrors upstream's checks

Upstream's `.github/workflows/kitchen.yml` runs only when kitchen paths change. [`fork-checks.yml`](../.github/workflows/fork-checks.yml) runs the same steps on every pull request, so a docs or Map change in the fork cannot break the Kitchen unnoticed.

When a merge changes the steps in `kitchen.yml`, copy the change into `fork-checks.yml`. `packages/kitchen/test/fork.test.mjs` fails until you do. Leave `kitchen.yml` itself as upstream wrote it.

## Things to check after a merge

- `docs/OBSERVABILITY.md` still says what is read and what is sent to the browser.
- Both services still bind `127.0.0.1` and nothing makes an outbound call.
- `package.json` files still have no new dependencies and the package names are unchanged.
- The README section "What OJ Labs changed" still describes the fork accurately.
