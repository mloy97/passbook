# api.v1

PassBook's API for templates, scripts and other plugins. It returns the shapes in
[schema.md](schema.md). It's versioned: v1 only ever gains things, and anything breaking
would be `api.v2` alongside it.

```js
const passbook = app.plugins.plugins.passbook?.api.v1;
if (!passbook) throw new Error('PassBook is not installed or not enabled');
```

`app.plugins` isn't in Obsidian's published types, but it's the standard way for
plugins to reach each other. Type definitions for TypeScript projects are in
[`types/passbook-api.d.ts`](../types/passbook-api.d.ts); copy the file.

Every method is async. Reads come from the data folder, so they work on every device the
vault syncs to, including ones that never sync with the bank themselves. Results are
copies, so changing them changes nothing in PassBook. Nothing in the API can return a
credential.

## Methods

| Method | Returns |
|---|---|
| `getAccounts()` | `Account[]`, sorted by institution and name |
| `getBalances()` | `Balance[]`, one per account |
| `getTransactions(query?)` | `Transaction[]`, oldest first |
| `getNewSinceLastSync()` | `Transaction[]` first seen in the most recent sync, from whichever device ran it |
| `getLastSync()` | `{ at, newTransactionIds }` or `null` before the first sync |
| `sync()` | Runs a sync and resolves with a `SyncResult`. Rejects with a readable `Error` when it can't: not connected, not the sync device, or over the request limit. A call during a running sync gets that sync's result. |
| `onSyncCompleted(listener)` | Calls `listener(result)` after each successful sync on this device. Returns a function that unsubscribes. |
| `version`, `schemaVersion` | `1` and `1` |

### `getTransactions(query)`

All fields are optional and combine with AND.

| Field | Meaning |
|---|---|
| `since` | Earliest `date` to include: `"2026-10-01"`, an ISO time (its date part), or a `Date` (its UTC day) |
| `until` | Latest `date` to include, same formats. Inclusive. |
| `accountId` | Only this account |
| `status` | `"pending"` or `"posted"` |

A malformed date rejects with an error rather than returning nothing.

### `SyncResult`

```ts
{
  at: string;                  // ISO time
  accounts: number;            // accounts in this sync
  newTransactions: number;
  updatedTransactions: number;
  removedTransactions: number; // includes pending charges replaced by posted ones
  newTransactionIds: string[];
  problems: string[];          // readable; e.g. a bank that needs you to sign in again
}
```

## The sync-completed event

Besides `onSyncCompleted`, PassBook triggers a workspace event, which other plugins can
register so it's cleaned up when they unload:

```ts
this.registerEvent(
  this.app.workspace.on('passbook:sync-completed', (result: PassBookSyncResult) => { … }),
);
```

Both fire only on the device that ran the sync, after the data folder is written. Other
devices see the new data through file sync; read it with the methods above.

## Example: today's balances in a Templater template

```js
<%*
const passbook = app.plugins.plugins.passbook?.api.v1;
const balances = await passbook.getBalances();
const accounts = Object.fromEntries((await passbook.getAccounts()).map((a) => [a.id, a]));
for (const b of balances) {
  tR += `- ${accounts[b.accountId].name}: ${b.balance} ${b.currency}\n`;
}
%>
```
