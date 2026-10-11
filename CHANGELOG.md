# Changelog

All notable changes to PassBook. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and versions follow
[Semantic Versioning](https://semver.org/): the data schema and `api.v1` are the public
contract, so breaking either means a major version.

## [Unreleased]

## [0.1.0] - 2026-10-10

First release.

### Added

- SimpleFIN Bridge connection: paste a setup token in **Settings → PassBook**.
- **Sync now** fetches accounts, balances and transactions into a ledger in your vault
  (`PassBook/` by default), as documented JSON (schema version 1).
- Pending charges that post under a new ID are replaced, never duplicated; late-posting
  charges are picked up by overlapping sync windows.
- `api.v1` for templates, scripts and other plugins, plus a `passbook:sync-completed`
  event and published type definitions.
- Commands: Connect provider, Export transactions to CSV, Open data folder.
- **This device syncs** setting for vaults used on several devices.
- Demo mode with made-up data, for trying PassBook without an account.
- Stays within SimpleFIN's request limits (20 per day, with backoff).
- Example Templater script for a daily bank note.
- Optional CSV files alongside the JSON (**Also save CSV files**), kept up to date on
  every sync.
- **Folder layout** setting: separate `json/` and `csv/` folders (default), everything
  in one folder, or CSV in a subfolder. Changing it moves PassBook's files. A
  `passbook.json` marker in the data folder records where everything is.
- **Feedback** in settings: report a problem or suggest a feature through a pre-filled
  GitHub form, with an optional diagnostic summary (no personal details). Also
  **PassBook: Copy diagnostic summary**.
- Donation link (Ko-fi) in the manifest, so Obsidian shows a Donate button, and a small
  support card at the top of PassBook's settings.
