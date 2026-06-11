# Releasing the TypeScript SDK

Checklist for cutting a new npm release of `@declaw/sdk`. It assumes you
are on an up-to-date `main` branch with a clean working tree.

Publishing is automated: pushing a `vX.Y.Z` tag to the public mirror
(`declaw-ai/declaw-js`) triggers `publish.yml` there, which verifies the
tag against `package.json`, runs typecheck/lint/tests, builds, publishes
to npm via Trusted Publishing (OIDC — no token anywhere) with provenance
attestation, and creates a GitHub Release from the CHANGELOG block. The
tag is the release button.

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

2. **Verify locally**

   ```bash
   pnpm run typecheck   # tsc --noEmit clean
   pnpm run lint        # eslint clean
   pnpm test            # vitest full run
   pnpm run build       # tsup produces dist/
   ```

   If you changed dependencies, regenerate `pnpm-lock.yaml`
   (`pnpm install`) — CI installs with `--frozen-lockfile`.

3. **Commit + push**

   ```bash
   git commit -am "release(ts-sdk): vX.Y.Z"
   git push origin main
   ```

4. **Sync the public mirror** (gated by junk/secret scans; the mirror
   gets one commit with this message, never internal history)

   ```bash
   gh workflow run sync-mirror.yml -f component=ts-sdk \
     -f message="release(ts-sdk): vX.Y.Z" && gh run watch
   ```

5. **Tag the mirror — this publishes**

   Release tags live only on the public mirror (bare `vX.Y.Z` — the
   monorepo carries no SDK tags):

   ```bash
   SHA=$(git ls-remote js-public main | cut -f1)
   gh api repos/declaw-ai/declaw-js/git/refs \
     -f ref=refs/tags/vX.Y.Z -f sha=$SHA
   ```

   Watch the publish run
   (`gh run list --repo declaw-ai/declaw-js -w publish.yml`), then
   verify on <https://www.npmjs.com/package/@declaw/sdk>. If it fails,
   nothing was published — fix the cause and `gh run rerun` (the tag
   stays).

## Deprecating a bad release

```bash
npm deprecate @declaw/sdk@X.Y.Z "use X.Y.Z+1 instead (see CHANGELOG.md)"
```

Unpublishing is only allowed for 72 hours after publish and only if no
other package depends on it — prefer `deprecate` + a patch release.

## Manual fallback

If CI is unavailable: `npm publish --access public` with an npm token in
`~/.npmrc` (provenance is not available outside CI), then create the tag
+ GitHub Release by hand.
