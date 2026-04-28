# Releasing

`@hhowi/aiglue-core`, `@hhowi/aiglue-client`, and `@hhowi/aiglue-client-vue` are versioned independently per [SemVer](https://semver.org/) and published to npm as scoped public packages. Releases are gated through `.github/workflows/release.yml` so the only manual step in normal operation is pushing a `v*` tag.

## One-time setup (do this first)

These actions touch external services and need maintainer credentials.

The packages live under the maintainer's **personal npm scope** (`@hhowi`) — npm reserves `@<your-username>` automatically for every account, so there is no org to create. If you fork this repo and want to publish under a different scope, search-and-replace `@hhowi/aiglue-` across `packages/*/package.json`, the workflow `--filter` flags, and the READMEs.

1. **Log in to npm CLI** (only needed for the manual fallback below; CI uses a token).

   ```bash
   npm login         # personal account, 2FA required
   ```

2. **Create an automation token and put it in the repo's secrets.**

   - https://www.npmjs.com/settings/{your-username}/tokens → "Generate New Token" → **Granular Access Token** with packages-and-scopes restricted to `@hhowi/*` and Read-and-write permission. (Or "Automation" for the simplest path — it bypasses 2FA in CI.)
   - GitHub repo → Settings → Secrets and variables → Actions → New repository secret → name `NPM_TOKEN`, paste the token.

3. **Sanity-check the publish path.**

   `--access public` is already set in the workflow's publish steps so the scoped packages go out as public. The token's owning npm account is the one whose `@<username>` scope receives the packages.

## Cutting a release

1. **Bump the changed packages.** Each package is versioned independently — only bump what shipped.

   ```bash
   # Example: core minor + client patch, client-vue unchanged.
   pnpm --filter @hhowi/aiglue-core exec npm version minor --no-git-tag-version
   pnpm --filter @hhowi/aiglue-client exec npm version patch --no-git-tag-version
   ```

2. **Move `[Unreleased]` to a versioned section in `CHANGELOG.md`** (or in the per-package CHANGELOG) and date it.

3. **Commit.**

   ```bash
   git add packages/*/package.json CHANGELOG.md packages/*/CHANGELOG.md
   git commit -m "chore(release): @hhowi/aiglue-core X.Y.Z + @hhowi/aiglue-client A.B.C"
   ```

4. **Tag and push.** The tag name is what fires `release.yml`.

   ```bash
   # Use the highest version that shipped — the tag is a release anchor, not a per-package label.
   git tag v0.3.0
   git push origin main
   git push origin v0.3.0
   ```

5. **Watch the workflow.** GitHub → Actions → "Release". On success:
   - npm shows the new versions
   - GitHub Releases gets an auto-generated entry with commit log
   - The published tarball carries [npm provenance](https://docs.npmjs.com/generating-provenance-statements) linking back to this commit

## Pre-release / canary channels

Not configured yet. When needed, add `npm version prerelease --preid=rc` + `--tag rc` flags so consumers must opt into the unstable channel via `npm install @hhowi/aiglue-core@rc`.

## Manual fallback

If the workflow is broken and a release cannot wait, an authenticated maintainer can publish locally:

```bash
pnpm install --frozen-lockfile
pnpm -r build
pnpm -r test
pnpm dlx publint packages/core
pnpm --filter @hhowi/aiglue-core publish --access public
pnpm --filter @hhowi/aiglue-client publish --access public
pnpm --filter @hhowi/aiglue-client-vue publish --access public
```

Each `pnpm publish` will prompt for the npm 2FA OTP. Re-run any package that fails — npm publishes are atomic per package.

## Yanking a bad release

`npm unpublish` is allowed within 24 hours of publish. After that, deprecate instead:

```bash
npm deprecate @hhowi/aiglue-core@0.3.0 "Critical bug; use 0.3.1+"
```

`npm install` still works for the version (existing pinned deployments do not break) but new installs see the warning.
