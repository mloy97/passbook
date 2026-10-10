# 0003. Ledger storage: files in a vault folder

- Date: 2026-10-10
- Status: accepted
- Issue: #10

## Context

The ledger (accounts and transactions) had to live either in a folder inside the vault or in the plugin's own folder (`.obsidian/plugins/passbook/`). PassBook is a data layer that scripts, templates and other devices read.

## Decision

The ledger is plain files in a configurable folder in the vault, default `PassBook/`. JSON is the source of truth: one file per month for transactions, plus accounts and last-sync files. CSV can be mirrored alongside, and a marker file records the folder layout (#35). The formats are in [schema.md](../schema.md).

## Alternatives

- **The plugin folder:** out of the user's way and harder to damage, but hidden from scripts and search. Whether it syncs depends on each user's sync settings, which breaks the one-sync-device model.

## Consequences

- Other devices get the data through ordinary vault sync and read it without connecting.
- The files are plaintext in the vault, which the threat model and README state plainly.
- Monthly files keep sync churn to the months that changed.
- The folder name is a setting. Changing it doesn't move existing files; changing the layout does (#35).
