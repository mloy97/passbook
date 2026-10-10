# Architecture

PassBook is an Obsidian community plugin that pulls bank and credit card data
(accounts, balances, transactions) into the vault in a stable, documented format, so
people's notes, templates, scripts and other plugins can build on it. It's a data
layer, not a budgeting app: no dashboards, no categories, no opinions about note
layout. Existing finance plugins are full budgeting apps; the gap is a dependable data
source.

Settled decisions: [decisions/](decisions/).

## Shape

```
 provider (SimpleFIN, later Plaid, Demo)      one interface, ADR 0002
        │  accounts, balances, transactions
        ▼
 sync engine ──► ledger                       plugin-owned storage keyed by transaction ID
                   │
                   ▼
            api.v1 + "sync completed" event   public, versioned contract
                   │
                   ▼
   commands · users' Templater scripts · other plugins
```

- **Providers** turn a provider's API into one normalized shape. Nothing downstream of
  the provider layer knows which provider is in use. The interface covers two sync
  models: a date window plus de-duplication (SimpleFIN) and a cursor per Item (Plaid).
  It also covers optional capabilities (card statements, connection repair) and one
  transaction shape for pending, modified and removed transactions.
- **Ledger** stores transactions by ID and updates them in place as they post, change
  or disappear. Overlapping sync windows mean late-posting charges are never missed
  or duplicated.
- **`api.v1`** is the public surface: `sync()`, `getAccounts()`, `getBalances()`,
  `getTransactions({ since, until, accountId })`, `getNewSinceLastSync()`, plus a
  "sync completed" event. It never exposes secrets.

## Constraints

- **Serverless.** No backend, ever. The plugin talks directly to the data provider from
  the user's machine via Obsidian's `requestUrl`.
- **Providers behind one interface.** SimpleFIN first. Plaid is an optional later
  provider; file import (CSV/OFX/QFX) is possible after that.
- **Secrets in Obsidian SecretStorage only** (`minAppVersion` ≥ 1.11.5, OS-encrypted,
  not synced). `data.json` holds no credentials. One designated sync device holds
  secrets and pulls; other devices read the synced data.
- **Read-only.** The plugin never moves money or writes anything back to a bank.
- **SimpleFIN limits:** at most 24 requests a day and 90 days per request.
- **Community store rules** ([developer policies](https://docs.obsidian.md/Developer+policies),
  [submission requirements](https://docs.obsidian.md/Plugins/Releasing/Submission+requirements+for+plugins)):
  - the plugin ID can't contain "obsidian", and the name can't suggest it's first-party
    (hence PassBook / `passbook`, ADR 0001)
  - the README discloses every remote service used and why, plus required accounts
    and paid access
  - no client-side telemetry
- **Obsidian plugin conventions:** TypeScript, esbuild, `manifest.json`, `versions.json`
  and `styles.css` at the repo root; `main.js` is a build artifact. Minimal
  dependencies.
- **Stable public surface.** The data schema and `api.v1` are versioned. Breaking
  changes need a major version and a migration.
- **Repo hygiene.** Real credentials never go in the repo, not even in an ignored `.env`:
  tests use made-up fixtures and a fake HTTP layer.

## Out of scope

- Budgeting, categorization, dashboards or charts (users build these on the API)
- Bank-note or digest formats (the owner's scripts, not the plugin)
- Writing anything back to a bank
- A backend server or webhooks
- Teller (needs client certificates, which `requestUrl` can't send)
