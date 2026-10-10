# Data schema, version 1

This is PassBook's public contract. `api.v1` returns these shapes, and the files in the
data folder hold them. A breaking change needs schema version 2, a major plugin
release, and a migration. Adding an optional field is not breaking.

Types: `string`, `string | null` (always present, may be null), and fields marked
*optional* (may be missing). Times are ISO 8601 in UTC (`2026-10-09T12:00:00.000Z`).
Dates are `YYYY-MM-DD`.

## Account

| Field | Type | Meaning |
|---|---|---|
| `id` | string | Stable, opaque ID. Don't parse it. |
| `name` | string | The account's name at the institution, e.g. "Everyday Checking". |
| `institution` | string | The institution or connection name, e.g. "First Example Bank". |
| `institutionDomain` | string \| null | The institution's domain, when known. |
| `currency` | string | ISO 4217 code such as `USD`, or a URL for a provider-defined currency. |
| `balance` | string | Current balance as a decimal string, e.g. `"1523.07"`. For credit cards this is usually negative (money owed). |
| `availableBalance` | string \| null | Available balance, when the institution reports one. |
| `balanceAsOf` | string (time) | When the institution says the balance was true. |
| `lastSyncedAt` | string (time) | The last sync in which this account appeared. |

## Balance

`getBalances()` returns one per account. It's a convenience view of the Account fields.

| Field | Type |
|---|---|
| `accountId` | string |
| `balance` | string |
| `availableBalance` | string \| null |
| `currency` | string |
| `asOf` | string (time) |

## Transaction

| Field | Type | Meaning |
|---|---|---|
| `id` | string | Stable, opaque ID. Don't parse it. A pending transaction may be replaced by a posted one with a different ID (see below). |
| `accountId` | string | The `Account.id` it belongs to. |
| `amount` | string | Decimal string. **Positive is money into the account**, negative is money out. |
| `currency` | string | Same as the account's. |
| `description` | string | As the institution wrote it, e.g. `"GROCERY MART #12"`. |
| `status` | `"pending"` \| `"posted"` | |
| `date` | string (date) | The day it belongs to: the posted date, else the transaction date, else the day PassBook first saw it. Filters and file names use this. |
| `postedAt` | string (time) \| null | When it posted. `null` while pending. |
| `transactedAt` | string (time) \| null | When it happened, if the institution says. |
| `firstSeenAt` | string (time) | When PassBook first saw it. |
| `updatedAt` | string (time) | When PassBook last changed it. |

### Pending transactions

Banks often give a pending charge one ID and the posted charge another. PassBook doesn't
guess which posted charge replaced which pending one. When a sync shows a pending charge
is gone, it's removed, and the posted charge appears as a new transaction. Code that
remembers transaction IDs should expect pending IDs to disappear.

### Amounts

Amounts are decimal strings, never floats, so `"0.10"` stays exact. Convert with care:
`Number(amount)` is fine for display, but add up money in cents or with a decimal
library. No currency conversion happens anywhere.

## Files in the data folder

The data folder (default `PassBook/`, set in PassBook's settings) is plain files that
sync with the vault. Prefer `api.v1`, which reads them for you. They're documented for
scripts that run without Obsidian.

### Where things are: `passbook.json`

After the first sync, the top of the data folder has a small marker saying where
everything is:

```json
{ "schemaVersion": 1, "layout": "split", "json": "json/", "csv": "csv/" }
```

`json` and `csv` are folders relative to the data folder (`""` means the data folder
itself). `csv` is `null` when CSV files are off. **Read the marker rather than assuming
a layout:** people can change it, and PassBook moves its files when they do. A data
folder with JSON at its top and no marker predates layouts; read it as `flat`.

| Layout (setting) | `layout` | JSON in | CSV in |
|---|---|---|---|
| Separate JSON and CSV folders (default) | `split` | `PassBook/json/` | `PassBook/csv/` |
| Everything in one folder | `flat` | `PassBook/` | `PassBook/` |
| CSV in a subfolder | `csv-subfolder` | `PassBook/` | `PassBook/csv/` |

### JSON files (always written; the source of truth)

| File | Contents |
|---|---|
| `accounts.json` | `{ "schemaVersion": 1, "accounts": Account[] }` |
| `transactions/YYYY-MM.json` | `{ "schemaVersion": 1, "month": "YYYY-MM", "transactions": Transaction[] }`, by `date` |
| `sync.json` | `{ "schemaVersion": 1, "lastSync": { "at": time, "newTransactionIds": string[] } \| null }` |

Each JSON file carries `schemaVersion`. A reader that finds a version it doesn't know
should stop rather than guess.

### CSV files (when **Also save CSV files** is on)

A spreadsheet-friendly mirror of the JSON, rewritten from it on every sync. RFC 4180:
comma-separated, a header row, CRLF line endings, UTF-8. Text that starts with
`= + - @` is prefixed with `'` so spreadsheets don't treat it as a formula. Empty cells
mean null.

`accounts.csv`, one row per account:

`institution, name, balance, available_balance, currency, balance_as_of, last_synced_at, institution_domain, account_id`

`transactions/YYYY-MM.csv`, one row per transaction in that month:

`date, account, institution, description, amount, currency, status, posted_at, transacted_at, first_seen_at, updated_at, account_id, transaction_id`

`account` and `institution` repeat the account's names so a month file reads on its own.
New columns are only ever added at the end. The **Export transactions to CSV** command
uses the same transaction columns, in a single file.

### Rules

- PassBook rewrites these files on every sync. Don't edit them: changes are
  overwritten, and a malformed JSON file stops PassBook from reading the data folder
  until it's fixed. CSV files are never read back, so editing one only loses the edit.
- Turning CSV off leaves existing CSV files in place; PassBook just stops updating them.
- Changing the layout moves PassBook's own files (the JSON, the CSV and nothing else)
  on the device that syncs, then updates the marker.
- Other files you keep in the data folder are never touched.
