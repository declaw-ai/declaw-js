# Releasing the TypeScript SDK

This checklist is what you follow to cut a new npm release of
`@declaw/sdk`. It assumes you are on an up-to-date `main`
branch with a clean working tree.

## Prerequisites

- Node.js `>=18` and a package manager (`npm` or `pnpm`).
- An npm account with publish rights on the `@declaw` scope.

```bash
npm login                 # one-time interactive
npm whoami                # verify
```

Or non-interactive via `~/.npmrc`:

```
//registry.npmjs.org/:_authToken=<your-token>
@declaw:registry=https://registry.npmjs.org/
```

## Steps

1. **Bump version + update changelog**

   Edit `package.json`:

   ```json
   "version": "X.Y.Z"
   ```

   Add the new version block at the top of `CHANGELOG.md` following
   the [Keep a Changelog](https://keepachangelog.com/) format. Keep
   breaking changes grouped under `### Changed` and behavior additions
   under `### Added`. Bump the major when breaking the public API
   re-exported from `src/index.ts`.

2. **Verify**

   ```bash
   npm run typecheck    # tsc --noEmit clean
   npm run lint         # eslint clean
   npm run test         # vitest full run
   ```

3. **Build**

   ```bash
   npm run build        # tsup produces dist/
   ls -lh dist/         # expect index.js, index.cjs, index.d.ts, index.d.cts
   ```

   (The `prepublishOnly` hook reruns `typecheck` + `build`, so
   `npm publish` cannot ship stale artifacts.)

4. **Dry-run inspection**

   ```bash
   npm publish --dry-run
   ```

   Confirm the tarball contents — only `dist/`, `CHANGELOG.md`,
   `LICENSE`, `README.md`, and `package.json` should appear. The
   `files` field in `package.json` enforces this.

5. **Publish**

   ```bash
   npm publish --access public
   ```

   `--access public` is required the first time a scoped package is
   published; subsequent versions inherit the setting. Verify on
   <https://www.npmjs.com/package/@declaw/sdk>.

6. **Commit + push**

   ```bash
   git commit -am "release(ts-sdk): vX.Y.Z"
   git push origin main
   ```

   Then publish a snapshot to the public mirror (`declaw-ai/declaw-js`;
   gated by junk/secret scans — the public repo gets one commit with this
   message, never internal history):

   ```bash
   gh workflow run sync-mirror.yml -f component=ts-sdk \
     -f message="release(ts-sdk): vX.Y.Z" && gh run watch
   ```

7. **Tag + release on the public repo**

   Release tags live only on the public mirror (bare `vX.Y.Z` — the
   monorepo carries no SDK tags; its `vX.Y.Z` namespace belongs to the
   platform release series):

   ```bash
   SHA=$(git ls-remote js-public main | cut -f1)
   gh api repos/declaw-ai/declaw-js/git/refs \
     -f ref=refs/tags/vX.Y.Z -f sha=$SHA
   gh release create vX.Y.Z --repo declaw-ai/declaw-js \
     --title "@declaw/sdk vX.Y.Z" \
     --notes "<paste the CHANGELOG block for this version>"
   ```

## Deprecating a bad release

If a version has a serious bug but you don't want to break pinned
users:

```bash
npm deprecate @declaw/sdk@X.Y.Z "use X.Y.Z+1 instead (see CHANGELOG.md)"
```

Unpublishing is only allowed for 72 hours after publish and only if no
other package depends on it — prefer `deprecate` + a patch release.
