# Providers

- Lives in: `src/providers/`
- Depends on: nothing in PassBook. Only `obsidian-adapters.ts` imports `obsidian`.
- Last reviewed: Phase 3 (2026-10-09)

## Responsibility

Turning a data provider's API into one shape: connections, accounts with balances,
transactions, and what changed since the last fetch. The provider layer owns the
provider's credentials and its sync bookkeeping. It doesn't store transactions, decide
what users see, or talk to Obsidian beyond HTTP and SecretStorage.

There are two providers: SimpleFIN (real data) and Demo (made-up data). Plaid
(Phase 4) would plug into the same interface.

## How it works

The interface is `src/providers/types.ts`. ADR 0002 explains it.

**Connecting** (SimpleFIN, `simplefin.ts`):

1. The settings tab calls `SimpleFinProvider.connect(token)`.
2. `decodeSetupToken` base64-decodes the token to a claim URL, refusing anything that
   isn't HTTPS.
3. `claimSetupToken` POSTs to the claim URL. The body of a 200 is the access URL; a 403
   means the token is used or unknown.
4. The access URL goes into SecretStorage (`passbook-simplefin-access-url`), **then**
   `verify()` makes one `balances-only` request.

**Fetching** (from "Sync now", via `FetchRequest`):

1. `planWindows` turns the saved state (`{ lastEnd }`) into date windows. A first sync
   goes back `initialDays` (90). Later syncs start 5 days before `lastEnd`. Windows are
   at most 90 days, oldest first.
2. Each window is one `GET <base>/accounts?version=2&start-date&end-date&pending=1`.
   `parseAccessUrl` strips the credentials from the access URL into a Basic auth header.
3. `parseAccountSet` maps the JSON:
   - Pending (`posted: 0` or `pending: true`) becomes `postedAt: null`.
   - Amounts stay as the provider's strings.
   - Protocol v1 `org` objects become connections.
   - `errlist` entries become `issues`.
4. Coverage: every account that came back in full gets `{ accountId, start, end }` for
   that window. Accounts with an `act.*` error or an unreadable transaction get none,
   and neither do accounts whose connection had a `con.*` error.
5. Results from all windows are merged (newest balances win, transactions de-duplicated
   by account and ID) and returned with the new state `{ lastEnd: now }`.

Failures that stop a fetch throw `ProviderError` with a `kind` and a message written for
users. The UI shows the message as-is.

**Demo** (`demo.ts`) needs no connection and takes no `Http`, so it can't make a
network call. `fetch()` generates data as a pure function of the date:

- three accounts at two made-up institutions;
- recurring merchants on fixed schedules, keyed to days since 2000-01-01, with small
  day-to-day variation;
- balances that are the running total.

Charges from the last two days are pending under a `p-` ID. Once older, they come back
posted under a `t-` ID, so the ledger's coverage-based replacement runs exactly as it
does for a real bank. It claims coverage for the whole requested window.

## Data it owns

- **SecretStorage** `passbook-simplefin-access-url`: the access URL. Per device, OS
  encrypted, never synced. An empty string means disconnected.
- **Provider state** (`FetchResult.state`): `{ lastEnd }` for SimpleFIN. The provider
  creates it, but the sync stores it in `data.json` (see [plugin.md](plugin.md)).
- **Request log** in localStorage `passbook-simplefin-requests`: recent request times
  and any pause.

## Decisions baked in

- [ADR 0002](../decisions/0002-provider-interface.md): one `fetch()` for both window
  and cursor providers; coverage instead of pending-to-posted matching; opaque provider
  state; connecting stays outside the interface.
- All HTTP goes through the injected `Http` function. The plugin passes
  `(req) => plugin.http(req)`, which wraps `requestUrl` with `throw: false`. Tests and
  e2e specs swap it out.

## Traps

- **Coverage is how removals happen.** The ledger (#13) will delete anything inside a
  covered window that's missing from the result. Claiming coverage for an account whose
  listing was partial would delete real transactions. When in doubt, withhold it.
- **Same transaction ID, two accounts.** SimpleFIN IDs are unique only within an
  account. Always key by account and ID together.
- **`end-date` is exclusive** in SimpleFIN, which matches coverage's `[start, end)`.
  Don't "fix" an off-by-one that isn't there.
- **Store before verify.** `connect()` saves the access URL before checking it on
  purpose: the setup token is already spent, and losing the URL to a network blip would
  force the user to make a new token.
- **SecretStorage has no delete.** `disconnect()` writes `''`, and `isConnected()`
  treats an empty value as disconnected.
- **Request budget** (`budget.ts`). SimpleFIN disables tokens that keep going past
  about 24 requests a day, so `RequestBudget` allows 20 per rolling 24 hours.
  - `fetch()` checks the whole window count up front, so a backfill never stops
    halfway.
  - Every `/accounts` request (including `verify()`) is checked and recorded *before*
    it's sent, so failed requests count too.
  - A 429 pauses requests for an hour; a rate warning in the response pauses them for
    six hours.
  - The log is per device (localStorage). Raising the limit is a one-line change that
    risks users' tokens; don't.
- Test fixtures are written from the protocol spec, not recorded (#33).
- Coverage is consumed by the ledger; see [ledger.md](ledger.md) for exactly what it
  deletes.
- **Every provider must pass `tests/providers/contract.test.ts`.** A new provider adds
  one line to its `PROVIDERS` list.
- **Demo output must stay a pure function of the date.** Using `Math.random()` or the
  current time inside it would make repeated syncs disagree, and the ledger would churn
  transactions.
