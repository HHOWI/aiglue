# Releasing

`@aiglue/core`, `@aiglue/client`, and `@aiglue/client-vue` are versioned independently per [SemVer](https://semver.org/) and published to npm as scoped public packages. Releases are gated through `.github/workflows/release.yml` so the only manual step in normal operation is pushing a `v*` tag.

## One-time setup (do this first)

These actions touch external services and need maintainer credentials.

1. **Reserve the `@aiglue` org on npm.**

   ```bash
   npm login         # personal account, 2FA required
   npm org create aiglue
   # If the name is taken, pick another (e.g. @aiglue-tools) and update every package.json + the
   # workflow's --filter / publish commands accordingly.
   ```

2. **Create an automation token and put it in the repo's secrets.**

   - https://www.npmjs.com/settings/{your-username}/tokens → "Generate New Token" → **Automation** (bypasses 2FA, suitable for CI).
   - GitHub repo → Settings → Secrets and variables → Actions → New repository secret → name `NPM_TOKEN`, paste the token.

3. **Verify the workflow has org publish rights.**

   Once the org exists, every package needs `"publishConfig": { "access": "public" }` (already set via `--access public` in the workflow flags) and the token's account needs to be a member of `@aiglue`.

## Cutting a release

1. **Bump the changed packages.** Each package is versioned independently — only bump what shipped.

   ```bash
   # Example: core minor + client patch, client-vue unchanged.
   pnpm --filter @aiglue/core exec npm version minor --no-git-tag-version
   pnpm --filter @aiglue/client exec npm version patch --no-git-tag-version
   ```

2. **Move `[Unreleased]` to a versioned section in `CHANGELOG.md`** (or in the per-package CHANGELOG) and date it.

3. **Commit.**

   ```bash
   git add packages/*/package.json CHANGELOG.md packages/*/CHANGELOG.md
   git commit -m "chore(release): @aiglue/core X.Y.Z + @aiglue/client A.B.C"
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

Not configured yet. When needed, add `npm version prerelease --preid=rc` + `--tag rc` flags so consumers must opt into the unstable channel via `npm install @aiglue/core@rc`.

## Manual fallback

If the workflow is broken and a release cannot wait, an authenticated maintainer can publish locally:

```bash
pnpm install --frozen-lockfile
pnpm -r build
pnpm -r test
pnpm dlx publint packages/core
pnpm --filter @aiglue/core publish --access public
pnpm --filter @aiglue/client publish --access public
pnpm --filter @aiglue/client-vue publish --access public
```

Each `pnpm publish` will prompt for the npm 2FA OTP. Re-run any package that fails — npm publishes are atomic per package.

## Yanking a bad release

`npm unpublish` is allowed within 24 hours of publish. After that, deprecate instead:

```bash
npm deprecate @aiglue/core@0.3.0 "Critical bug; use 0.3.1+"
```

`npm install` still works for the version (existing pinned deployments do not break) but new installs see the warning.
