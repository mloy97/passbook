# 0002. Provider interface

- Date: 2026-10-09
- Status: accepted (owner review, 2026-10-10)
- Issue: #3

## Context

PassBook gets data from SimpleFIN now and maybe Plaid later (Phase 4), plus a demo
provider for people without an account (#20). Nothing downstream of the provider layer
may know which one is in use. The two real providers differ in ways that matter:

| | SimpleFIN | Plaid |
|---|---|---|
| Change model | Date window: `GET /accounts?start-date&end-date`, at most 90 days per request ([developer guide](https://beta-bridge.simplefin.org/info/developers)) | Cursor per Item: `/transactions/sync` returns `added`, `modified`, `removed` |
| Removals | Never reported; a transaction just stops appearing | Explicit `removed` list |
| Pending to posted | Not specified whether the ID survives ([protocol](https://www.simplefin.org/protocol.html)) | Posted transaction has a new ID and `pending_transaction_id` |
| Card statements | No | Liabilities |
| Partial failure | `errlist` entries per connection or account, alongside data | Per-Item errors |
| Limits | About 24 requests/day, or the token gets disabled | Unlimited on Trial Items |

## Decision

The interface is `src/providers/types.ts`. That file is the source of truth; this ADR
explains it.

**One fetch, two change models.** `fetch()` returns upserts plus two ways of saying what
went away:

- `removed`: explicit removals, for cursor providers.
- `coverage`: for window providers, "this is everything for account A between start
  and end". The ledger treats anything it holds for A in that window, and not in the
  result, as removed.

Coverage is what makes SimpleFIN safe without guessing about IDs. A pending charge that
posts under a new ID, or disappears, is handled by the same rule as a deleted one. The
provider only claims coverage for windows it actually fetched. It claims none for an
account with an `act.missingdata` or `act.failed` error, so a bad fetch can't wipe
history. `replacesId` carries Plaid's `pending_transaction_id` when it exists, but
nothing depends on it.

**Provider-owned sync state.** Window bookkeeping (last window end, 5-day overlap,
request counts) and Plaid cursors are different shapes. Each provider returns an opaque,
JSON-serializable `state`, and gets it back on the next fetch. The engine stores it in
`data.json` and never looks inside, so it must never contain a secret.

**Capabilities are flags plus optional methods.** `capabilities.cardStatements` and
`capabilities.connectionRepair` say whether `getCardStatements()` and
`repairConnection()` exist. `syncModel` and `pending` are informational for the UI.

**Connecting isn't in the interface.** Pasting a SimpleFIN setup token and running Plaid
Hosted Link have nothing in common, so each provider exposes its own connect function
to its own settings UI. The interface starts where a provider is connected:
`isConnected()`, `verify()`, `fetch()`, `disconnect()`.

**Errors.** Failures that stop a fetch throw `ProviderError` with one of a small set of
kinds (`setup-token`, `auth`, `payment-required`, `rate-limit`, `network`,
`bad-response`, `not-connected`), so the UI can explain every case without knowing the
provider. Problems that leave the rest of the data usable, such as one bank needing
re-authentication or a rate-limit warning, come back in `issues`.

**Secrets.** A provider gets a `SecretStore` (a thin wrapper over
`app.secretStorage`) and reads and writes only its own IDs. It never returns a secret,
and nothing outside the provider reads one. SecretStorage has no delete, so
`disconnect()` overwrites the entry with an empty string, and an empty value counts as
not connected.

**Network.** A provider makes every request through an injected `Http` function, which
wraps `requestUrl` in the plugin and is faked in tests. One wrapper also means one place
to check against the README's network disclosure.

**Boundary formats.** Amounts are the provider's decimal strings, positive meaning money
in. Times are ISO 8601 UTC strings. IDs are provider-scoped (account within connection,
transaction within account), and the engine namespaces them. The public schema (#12)
decides what users see; this boundary only avoids losing information.

## Alternatives

- **`transactionsSince(date)` returning a flat list** (the shape suggested in the
  initial research). This can't express removals, so SimpleFIN pending charges that
  post under new IDs would duplicate.
- **Separate window and cursor interfaces.** That pushes the difference into the sync
  engine, which then has to know which provider it's talking to.
- **Matching pending to posted by amount, date and description.** It's fragile, and
  unnecessary once coverage handles disappearances.

## Consequences

- The ledger (#13) must apply `coverage` per account and window. It must never infer a
  removal outside a covered window.
- A window provider must overlap its windows (SimpleFIN's guide recommends about 5 days)
  and split anything longer than 90 days into several requests. Each request counts
  against the daily limit (#14).
- Adding Plaid is a new provider, not an interface change.
- Changing this interface after `api.v1` ships doesn't break users, because the API
  sits on the ledger, not on providers. It's still worth getting right now.
