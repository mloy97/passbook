# Plugin shell, settings, sync and commands

- Lives in: `src/main.ts`, `src/settings/`, `src/sync/`, `src/commands.ts`,
  `src/export/`, `src/feedback/`, `manifest.json`, `styles.css`
- Depends on: [providers](providers.md), [ledger](ledger.md), [API](api.md)
- Last reviewed: Phase 3 (2026-10-09)

## Responsibility

The Obsidian side: plugin lifecycle, the settings tab, the commands, the one sync path
everything shares, and where each piece of data is stored. Business logic stays out of
`main.ts`, which wires pieces together and adapts Obsidian storage to small interfaces.

## How it works

**Load.** `PassBookPlugin.onload()`:

- Reads settings from `data.json`.
- Builds the SimpleFIN provider (over `(req) => this.http(req)`, SecretStorage and a
  `RequestBudget`), the `ConnectionController`, the `LedgerStore` over the data folder,
  and `api.v1`.
- Registers the settings tab and four commands. `sync-now` is in `main.ts`; the rest
  are in `commands.ts`.
- Once the layout is ready, deletes the Phase 1 `sync-cache.json` if it's still there.

Nothing touches the network on load.

**Sync.** `runSync()` is the only way a sync happens. It calls `syncNow()`
(`src/sync/sync-now.ts`):

1. Check connected, and "This device syncs".
2. Load the ledger; pass the saved provider state only if the ledger has data.
3. `provider.fetch()`, then `apply()`.
4. Save the ledger, then the state.

`runSync()` then announces the result to listeners and the workspace. A call while a
sync is running gets the same promise. The **Sync now** command wraps `runSync()` with
notices; `api.v1.sync()` wraps it with nothing.

**Settings.** `PassBookSettingTab` is a thin view:

- SimpleFIN status comes from `ConnectionController` (pure TS, unit-tested).
- **This device syncs** is shown when connected.
- **Data folder** is a text setting.

**Ways to sync.** The command, the ribbon icon (`addRibbonIcon`, whose `aria-label`
`refreshRibbon()` updates after each sync), the settings **Sync now** button and
`api.v1.sync()` all call `runSync()`. On layout ready, `maybeSyncOnStartup()` asks
`shouldSyncOnStartup()` (`src/sync/startup.ts`), which is pure and unit-tested, whether
a sync is due: setting on, last sync older than the chosen hours, and `canSync()`.

**Support card.** `renderSupport()` puts a Ko-fi card first in the tab while the manifest
has a `fundingUrl`. The cup is an inline SVG path (no request); colors are in
`styles.css`.

**Feedback** (`src/feedback/feedback.ts`, settings section and `commands.ts`).
- `PassBookPlugin.diagnostics()` collects versions, settings and counts, plus the last
  sync error, which `runSync()` remembers until the next success.
- `diagnosticSummary()` turns that into text, scrubbing links and token-like strings
  out of error messages.
- `feedbackUrl()` builds a link to `.github/ISSUE_TEMPLATE/1-bug-report.yml` or
  `2-feature-request.yml`, pre-filling the form's `diagnostics` field through a URL
  parameter, and trims to stay under GitHub's URL limit.
- The buttons call `window.open`; PassBook makes no request. `REPO` is the one place
  the repository name lives.

**Commands** (`commands.ts`):

- **Connect provider** opens the settings tab.
- **Export transactions to CSV** writes `<data folder>/exports/…csv` through
  `src/export/csv.ts`.
- **Open data folder** reveals it in the file explorer.

## Data it owns

| Where | What | Syncs between devices? |
|---|---|---|
| `data.json` (`saveData`) | `dataFolder`; `provider` (`simplefin` or `demo`); `layout`; `csv`; `providerState` keyed by provider | Yes |
| Vault-scoped localStorage | `passbook-simplefin-last-verified`, `passbook-sync-device` (`'on'`/`'off'`), `passbook-simplefin-requests` | No |
| SecretStorage | The SimpleFIN access URL | No |
| Data folder | The ledger (see [ledger.md](ledger.md)) and `exports/`. In demo mode, `<folder> (demo)` | Yes |

## Decisions baked in

- `minAppVersion` is 1.11.5, for SecretStorage. #34 asks whether to move to 1.13.
- Per-device facts go in localStorage, because `data.json` syncs.
- Command IDs don't include the plugin ID (store rule).
- One sync path, so every guard (device flag, budget, concurrency) applies to the
  command, the API and any future scheduler alike.
- **Data source.** `activeProvider()` picks SimpleFIN or Demo from `settings.provider`.
  Demo mode reads and writes `<data folder> (demo)`, so made-up data never mixes with
  real data, and switching never deletes anything. Demo ignores the "This device syncs"
  flag, because no bank is involved.

## Traps

- **`saveLocalStorage` clears the entry for any falsy value.** Storing `false`, `0` or
  `''` deletes the key. That's why the sync-device flag is `'on'`/`'off'`; the unit
  mock behaves the same way.
- **Ledger before state.** If saving state fails after the ledger is saved, the next
  sync re-fetches the same window, which is harmless. The reverse could skip one.
- **`plugin.http` is read on every call** on purpose, so e2e specs can replace it after
  load.
- **The plugin folder may not exist** (under wdio-obsidian-service it doesn't). Code
  that writes there must create it.
- **Obsidian internals.** `app.setting` (open the PassBook tab) and the file explorer's
  `revealInFolder` aren't public API. Both are feature-checked, with a notice fallback.
- **Settings re-render in place.** `render()` saves and restores the scroll position of
  the tab and its parent; without that, every switch near the bottom jumps the page to
  the top. Settings actions go through `attempt()`, so a failure shows a notice instead
  of failing silently.
- **Lint rules you can't disable.** `eslint-plugin-obsidianmd` forbids `eslint-disable`
  for some rules, and store review runs the same rules. Hence `mod-warning` added by
  hand on Disconnect, and the settings-search warning until #34.
- **Brand casing.** The sentence-case rule knows PassBook, SimpleFIN and Plaid
  (`eslint.config.mts`). Add new brand names there.
- **Unexpected errors** are logged with `console.error` and shown as "Something went
  wrong". `UserFacingError` subclasses (`ProviderError`, `LedgerReadError`,
  `NotSyncDeviceError`, `InvalidQueryError`) are expected and shown as-is.
