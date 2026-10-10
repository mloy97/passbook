# SimpleFIN coverage and freshness

Findings from the owner's first real sync (#4), 2026-10-09. No institution names,
account numbers or amounts, by design. Use this to set expectations in the docs and to
judge design choices that depend on how real data behaves.

## What came through

- **One institution linked, five accounts:** the bank accounts plus three credit cards
  at the same bank. Linking the bank in SimpleFIN Bridge brought the cards along with
  no separate step.
- Every account has a balance, an available balance, a balance timestamp and an
  institution domain.
- **All USD.** Nothing here needs currency handling (#11).
- **494 transactions** from the first sync, 2026-07-13 to 2026-10-08. A 90-day window
  from the sync date reaches back to 2026-07-11, so the history is complete for that
  window.
- Every transaction has a description and a transaction date (`transacted_at`). No
  empty fields, no odd amount formats (always two decimals).

## Freshness

- Balances are as of the sync, so they're current.
- **No pending transactions at all**, across five accounts, one of them very active
  (354 transactions in 90 days). This institution doesn't seem to report pending
  charges through SimpleFIN. PassBook asks for them (`pending=1`); none came back.
- The newest posted transaction was about a day older than the sync. Expect today's
  spending to appear a day or two later, once it posts.
- Posting lags the transaction date by 0 days (median) to 3 days (maximum).

## How the data is shaped

- **Times are really dates.** Every `posted` and `transacted_at` is 11:00 or 12:00 UTC,
  so the bank sends dates and SimpleFIN stamps them midday. PassBook's `date` (the UTC
  day) therefore matches the bank's date for anyone in the Americas or Europe. A user
  far east of UTC would still see the right day, because midday UTC is the same
  calendar day almost everywhere.
- Account IDs and transaction IDs are opaque and stable across syncs.

## Things to watch

- **Two pairs of identical transactions** (same account, date, amount and description,
  different SimpleFIN IDs), both in July. SimpleFIN returned them as separate
  transactions, so PassBook keeps both, correctly. They're either genuine repeat
  purchases or a duplicate upstream; the owner is checking against the bank statement.
  If they're upstream duplicates, PassBook can't tell them apart from real repeats and
  shouldn't try.
- **Pending handling is untested on real data**, since this institution sends none.
  The coverage logic that replaces pending charges (ADR 0002) is covered by unit tests,
  demo mode and SimpleFIN's protocol spec, but not yet by a real bank.

## Implications

- The getting-started guide should say plainly that some banks don't report pending
  charges through SimpleFIN, so recent spending can take a day or two to appear.
- Syncing once a day is enough for this institution; more often gains nothing.
- Other institutions may behave differently. Add a section here if more are linked.
