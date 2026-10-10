# Ledger

- Lives in: `src/ledger/`, `src/export/csv.ts`
- Depends on: [providers](providers.md) (the `FetchResult` shape)
- Last reviewed: #35, CSV and folder layouts (2026-10-09)

## Responsibility

PassBook's own copy of accounts and transactions, kept correct as transactions post,
change and disappear, and stored as the public schema ([../schema.md](../schema.md)):
JSON as the source of truth, an optional CSV mirror, in one of three folder layouts.
It decides which transactions exist and what's new. It doesn't fetch anything or know
which device it's on.

## How it works

`syncNow` (`src/sync/sync-now.ts`) drives it:

1. `LedgerStore.relayout()` first moves PassBook's files into the configured layout
   (see "Layouts" below). Usually there's nothing to move.
2. `LedgerStore.load()` (`store.ts`) reads the JSON from wherever the marker says it
   is:
   - `accounts.json`
   - every `transactions/YYYY-MM.json`
   - `sync.json`

   Each file must carry `schemaVersion: 1`. A missing or unknown version, or invalid
   JSON, throws `LedgerReadError` with a message for users.
3. `apply(data, result, provider, now)` (`ledger.ts`) mutates the data in place:
   - **IDs.** Ledger IDs namespace provider IDs: `simplefin:<connection>:<account>` for
     accounts, and `<account id>:<provider transaction id>` for transactions.
   - **Upserts.** New transactions get `firstSeenAt = now`. Changed ones keep
     `firstSeenAt` and get a new `updatedAt`; unchanged ones aren't touched.
   - **Dates.** `date` is the UTC day of `postedAt`, else `transactedAt`, else
     `firstSeenAt`.
   - **Removals.** Explicit removals are deleted. Then coverage: within each covered
     window, a posted transaction whose `postedAt` falls inside and that the result
     didn't list is deleted. For pending transactions, any coverage of the account
     counts, because pending charges come back on every listing until they post or
     vanish.
   - It returns new, updated and removed IDs plus the **dirty months**: the old and new
     month of everything that changed.
4. `LedgerStore.save(data, dirtyMonths)` rewrites only those month files (deleting
   empty ones), plus their CSV when CSV is on (`src/export/csv.ts`). Then it writes
   `accounts.json` (and `accounts.csv`), then `sync.json`, then the `passbook.json`
   marker.
5. File I/O goes through the `Files` interface. In the plugin that's `obsidianFiles`
   (`obsidian-files.ts`), which writes `path.tmp`, removes `path`, then renames. Reads
   fall back to `path.tmp` if `path` is missing.

**Layouts** (`layout.ts`). `split` (default) puts JSON in `json/` and CSV in `csv/`;
`flat` puts everything at the top; `csv-subfolder` puts JSON at the top and CSV in
`csv/`.

- `passbook.json` records the layout of the files *on disk*, and readers
  (`currentLayout()`) follow it, not the setting.
- `relayout()` sweeps every place each kind of file can live (`CANDIDATE_DIRS`) and
  moves PassBook-named files into the target: write the copy, then remove the
  original. It then removes folders the move emptied and writes the marker.
- Because it sweeps rather than trusting the marker, it finishes interrupted moves and
  survives a change of mind mid-move.
- Only the device that may write (sync device, or demo mode) calls it:
  `PassBookPlugin.setLayout()` and the start of every sync. Other devices save the
  setting and keep reading via the marker until the sync device moves the files.

**CSV mirror.** Turning CSV on calls `writeAllCsv()` (`PassBookPlugin.setCsv()`). After
that, every `save()` keeps the CSV of changed months current. CSV is never read back.

## Data it owns

The data folder (setting `dataFolder`, default `PassBook/`), synced with the vault:

- `passbook.json`: the marker, at the top, saying where the rest is.
- JSON (in `json/` by default): `accounts.json`, `transactions/YYYY-MM.json`, and
  `sync.json`, the last sync's time and new IDs, which is what `getNewSinceLastSync`
  reads on any device.
- CSV when on (in `csv/` by default): `accounts.csv`, `transactions/YYYY-MM.csv`.

Formats are in [../schema.md](../schema.md). `exports/` in the same folder belongs to
the Export command, not the ledger.

## Decisions baked in

- [ADR 0002](../decisions/0002-provider-interface.md): coverage instead of matching
  pending charges to posted ones.
- JSON in a vault folder, one file per month: the fallback answer to #10. It keeps
  Nextcloud churn to the months that changed.
- Amounts stay as the provider's decimal strings: the fallback answer to #11.

## Traps

- **Readers must follow the marker, not the setting.** The setting is synced
  `data.json` and can change on any device; the files only move on the sync device.
  Between the two, the setting and the disk disagree.
- **Moves only touch PassBook-named files** (`accounts.json`, `sync.json`,
  `accounts.csv`, `transactions/YYYY-MM.(json|csv)`). Widening the patterns could
  sweep a user's own files into another folder.
- **Obsidian 1.14's `adapter.rmdir(path, false)` fails on empty folders** (EISDIR).
  `removeFolderIfEmpty` checks the folder is empty, then calls it with `recursive: true`.
- **A fresh install writes no marker** until its first save, so a failed first sync
  doesn't leave an empty data folder behind.
- **Coverage deletes.** A provider that claims coverage for a partial listing would
  wipe real transactions. The guard is in the provider, which withholds coverage on
  errors, not here.
- **The first sync ignores saved provider state** when the ledger has no data for that
  provider (`hasProviderData`). Otherwise a new data folder, or deleted data, would
  only get the last 5 days.
- **`sync.json` is written last** so another device never sees a "last sync" whose
  transactions haven't landed. Other devices still receive files in whatever order
  their sync client picks, so a reader can briefly see a mix of old and new files.
- **Moving between months.** A transaction that posts in a different month from its
  pending date moves files. That's why both months are marked dirty.
- **Adapter, not Vault API.** Writes use `vault.adapter` because rename-into-place
  needs it, and the vault's index can lag behind files PassBook just wrote. Code that
  needs a `TFile` for these files may get `null` right after a sync.
- **Don't edit the files by hand.** The next sync overwrites them. A malformed file
  stops all reads until it's fixed, which is deliberate: guessing would be worse.
