# Public API

- Lives in: `src/api/v1.ts`, `types/passbook-api.d.ts`, `examples/`
- Depends on: [ledger](ledger.md), the sync in [plugin](plugin.md)
- Last reviewed: Phase 2 (2026-10-09)

## Responsibility

`api.v1`: the stable surface templates, scripts and other plugins use. The user-facing
reference is [../api.md](../api.md); this doc covers how it's built. It reads the ledger
and triggers syncs. It never reaches providers, secrets or HTTP.

## How it works

- `createApiV1(deps, listeners)` builds a frozen object over two functions:
  - `load()`: the ledger, re-read from the data folder on every call.
  - `sync()`: `plugin.runSync()`.
- `main.ts` exposes it as `plugin.api.v1`, so users reach it at
  `app.plugins.plugins.passbook.api.v1`.
- Reads filter and sort the ledger maps and return JSON deep copies.
- `sync()` maps the internal `SyncSummary` to the public `SyncResult` (`toSyncResult`),
  turning issues into plain strings.
- After a successful sync, `PassBookPlugin.announce()` calls every `onSyncCompleted`
  listener (a throwing listener is logged and skipped), then triggers the workspace
  event `passbook:sync-completed`.
- `types/passbook-api.d.ts` restates the types with no imports, so users can copy one
  file. `tests/api/types.test.ts` asserts it's identical to the source types, and fails
  `npm run build` if not.
- `examples/templater/passbook_daily.js` is the reference consumer, loaded as CommonJS
  in `tests/examples/`.

## Data it owns

None. The listener set lives on the plugin and is cleared on unload.

## Decisions baked in

- Reads go to disk every time, not to a cache. That's simple and correct on devices
  that receive data through file sync and never run a sync. The data is a few files of
  JSON.
- v1 only grows. Removing or retyping anything means `api.v2` next to it, plus a major
  release ([../releasing.md](../releasing.md)).

## Traps

- **Changing a schema type changes the public API.** `Account` and `Transaction` in
  `src/ledger/schema.ts` *are* the API types. The drift test will make you update the
  `.d.ts`; it won't stop you breaking users. Only add optional fields.
- **Events are local.** `onSyncCompleted` and the workspace event fire only on the
  device that ran the sync. Other devices learn about new data by reading.
- **The example file is CommonJS** because Templater user scripts are.
  `examples/package.json` says so, since the repo root is `"type": "module"`. Don't
  convert it to `import`/`export`.
- `getTransactions` date filters compare `YYYY-MM-DD` strings on the UTC-based `date`
  field. A `Date` argument is converted to its UTC day, not local time.
