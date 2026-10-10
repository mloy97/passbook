# Build, CI and release

- Lives in: `.github/workflows/`, `scripts/release.mjs`, `esbuild.config.mjs`,
  `version-bump.mjs`, `CHANGELOG.md`, `tests/policy.test.ts`
- Depends on: everything it builds
- Last reviewed: Phase 3 (2026-10-09)

## Responsibility

Turning the source into something users can trust and install: the bundle, the checks
every push runs, and tagged releases with provenance. The steps for people are in
[../releasing.md](../releasing.md); this doc covers how the machinery works.

## How it works

- **Build.** `npm run build` type-checks `src/`, `tests/` and `types/` with `tsc`, then
  esbuild bundles `src/main.ts` into `main.js`. `obsidian`, `electron` and CodeMirror are
  external, everything else is bundled, and there are no runtime dependencies.
- **CI** (`.github/workflows/ci.yml`, every push): build, lint and unit tests on Node 20,
  22 and 24. E2E doesn't run in CI (see Traps).
- **Release** (`.github/workflows/release.yml`), on a tag `x.y.z`:
  1. `scripts/release.mjs check` confirms the tag, `package.json`, `manifest.json`,
     `versions.json` and a `CHANGELOG.md` section all agree.
  2. Lint, test and build.
  3. `actions/attest-build-provenance` attests `main.js`, `manifest.json` and
     `styles.css`.
  4. `gh release create --draft` attaches them, with `release.mjs notes` as the body.

  Run by hand, the workflow is a dry run: the checks and build only, uploaded as an
  artifact.
- **Versions.** `npm version` bumps `package.json`; its `version` script runs
  `version-bump.mjs`, which copies the version into `manifest.json` and adds it to
  `versions.json` with the current `minAppVersion`. `.npmrc` makes the tag `x.y.z`, not
  `vx.y.z`.
- **Policy tests** (`tests/policy.test.ts`) keep the promises in the README true. They
  scan `src/` for network calls outside the adapter, for log lines mentioning secrets,
  and for `innerHTML`, and they check `package.json` for runtime dependencies and the
  README for its disclosures.

## Data it owns

Release assets on GitHub, and attestations in GitHub's attestation store.

## Decisions baked in

- Releases are drafts. Publishing is an owner action, because it's what BRAT and
  Obsidian install.
- Provenance is attested so users can verify a `main.js` came from this repo's
  workflow (`gh attestation verify`).

## Traps

- **Attestations need a public repo** (or GitHub Enterprise). While the repo is
  private, a tag run fails at the attestation step (#23).
- **Obsidian matches the tag to `manifest.json` exactly.** A `v` prefix, or a manifest
  that wasn't bumped, means users never see the update. The check step exists for this.
- **E2E isn't in CI.** wdio-obsidian-service downloads Obsidian, and SecretStorage on
  Linux needs a keyring (libsecret or kwallet), which CI runners don't have. Run
  `npm run test:e2e` locally before a release.
- **action-validator flags `permissions.attestations`.** The permission is real; the
  validator's schema is out of date.
- **`scripts/` and `examples/` are excluded from ESLint.** Scripts are covered by
  `tests/scripts/` and examples by `tests/examples/`.
