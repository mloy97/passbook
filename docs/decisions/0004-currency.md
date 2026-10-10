# 0004. Currency: store as given, no conversion

- Date: 2026-10-10
- Status: accepted
- Issue: #11

## Context

Accounts can be in currencies other than USD. Schema v1 had to fix how amounts and currencies are represented, and it's a public contract.

## Decision

Amounts are stored exactly as the provider sends them, as decimal strings (never floats), with an ISO 4217 code (or a provider's currency URL) on every account and transaction. PassBook never converts between currencies.

## Alternatives

- **Also convert to a base currency:** totals across currencies would just work, but it needs an exchange-rate source. That's a new network call to disclose, and rates that go stale.
- **USD only:** simplest, but excludes everyone outside the US.

## Consequences

- Anything that adds up money across accounts in different currencies has to convert it itself.
- Conversion could be added later as an optional field without breaking schema v1.
- The owner's real data (#4) is all USD, so nothing is lost today.
