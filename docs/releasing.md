# Releasing

Releases are built by GitHub Actions (`.github/workflows/release.yml`) from a version
tag, with build provenance. Nobody builds a release on their own machine.

## Versioning

Semantic versioning, with the public contract being the data schema
([schema.md](schema.md)) and `api.v1` ([api.md](api.md)):

- **Patch** (0.1.1): fixes, nothing new for users or API callers.
- **Minor** (0.2.0): new features, new optional fields, new API methods.
- **Major** (1.0.0, 2.0.0): anything that breaks the schema or `api.v1`. Needs a
  migration and `api.v2` alongside v1.

Raising `minAppVersion` is at least a minor release. Note it in the changelog.

## Steps

1. Move the **[Unreleased]** entries in `CHANGELOG.md` under a new
   `## [x.y.z] - YYYY-MM-DD` heading. Commit.
2. `npm version patch|minor|major`. This bumps `package.json`, runs
   `version-bump.mjs` to update `manifest.json` and `versions.json`, commits, and tags
   `x.y.z` (no `v`; `.npmrc` sets that).
3. `node scripts/release.mjs check x.y.z` to confirm everything agrees.
4. `git push --follow-tags`.
5. The workflow checks the versions and changelog, lints, tests, builds, attests
   `main.js`, `manifest.json` and `styles.css`, and opens a **draft** release with the
   changelog section as notes.
6. Look over the draft on GitHub and publish it. Publishing is an owner action: it's
   what BRAT and Obsidian install from.

To check the workflow without releasing, run it by hand (**Actions → Release → Run
workflow**). It does everything except the attestation and the release, and uploads
the built files as an artifact.

## Verifying a release

Anyone can check that a release's files were built from this repository by its
workflow:

```sh
gh attestation verify main.js --repo <owner>/<repo>
```
