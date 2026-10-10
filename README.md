# PassBook

Bring your bank and credit card accounts, balances and transactions into your Obsidian
vault, kept up to date in a stable, documented format. PassBook is a data layer: sync
with one command, then build your own notes, daily summaries, dashboards and scripts on
top. No server and no telemetry; it talks directly to your data provider from your
device.

## What it does

- **Syncs your accounts** through [SimpleFIN Bridge](https://bridge.simplefin.org/): link
  your banks there once, paste one setup token into PassBook, and run **Sync now**.
- **Keeps your history correct:** charges that post late are picked up, and pending
  charges are replaced when they post, never duplicated.
- **Stores plain files in your vault:** JSON by default, with optional CSV copies for
  spreadsheets, in the folder layout you choose.
- **Gives scripts and plugins an API** (`api.v1`) with a sync-completed event and
  published TypeScript types.
- **Lets you try everything with made-up data** in demo mode, no account needed.

## Getting started

1. Install PassBook from **Settings → Community plugins → Browse** and enable it.
2. Follow [docs/getting-started.md](docs/getting-started.md): signing up for SimpleFIN
   Bridge, linking banks, and your first sync, with screenshots.

**Try it without an account:** in **Settings → PassBook**, set **Data source** to
**Demo**. PassBook then syncs made-up accounts and transactions into a separate
`PassBook (demo)` folder, with no network use at all.

## Using the data

Your accounts and transactions are plain JSON in the data folder (default
`PassBook/json/`), in the format documented in [docs/schema.md](docs/schema.md). Turn on
**Also save CSV files** in settings to get spreadsheet copies as well (in `PassBook/csv/`
by default). **Folder layout** lets you keep everything in one folder instead. Templates, scripts and
other plugins can read them through PassBook's API, `app.plugins.plugins.passbook.api.v1`,
documented in [docs/api.md](docs/api.md).

### Example: a daily bank note

[`examples/templater/passbook_daily.js`](examples/templater/passbook_daily.js) is a
[Templater](https://github.com/SilentVoid13/Templater) user script. Copy it into your
Templater user scripts folder and add this to your daily-note template:

```
<% await tp.user.passbook_daily() %>
```

Each new daily note then gets something like:

```markdown
## Balances

| Account | Balance | Available |
|---|---:|---:|
| First Bank · Checking | 12,523.50 USD | 12,473.07 |
| First Bank · Rewards Card | -312.99 USD |  |

## New since last sync (2)

| Date | Account | Description | Amount |
|---|---|---|---:|
| 2026-10-09 | Rewards Card | GROCERY MART | -42.50 |
| 2026-10-09 | Checking | PAYROLL *(pending)* | 2,100.00 |
```

The script only reads data. Run **PassBook: Sync now** to fetch new transactions first.

## Network use

PassBook talks only to the data provider you connect, directly from your device. There
is no PassBook server and no telemetry. Every request goes through
[`src/providers/obsidian-adapters.ts`](src/providers/obsidian-adapters.ts).

**SimpleFIN Bridge** (needs a paid SimpleFIN Bridge account, about $15/year):

- `POST` to the claim URL inside your setup token, once, to get an access URL.
- `GET <access URL>/accounts` when you connect (balances only, to check it works) and
  on each sync (accounts, balances and transactions for a date window). A sync of more
  than 90 days makes one request per 90 days.
- At most 20 requests in any 24 hours, below SimpleFIN's limit of about 24, and none for
  an hour after SimpleFIN says to slow down (six hours after a rate warning). SimpleFIN
  disables access for apps that keep going past its limits.

Demo mode makes no network requests at all.

**Feedback buttons.** **Report a problem** and **Suggest a feature** in PassBook's settings
open a pre-filled form on GitHub in your browser. PassBook itself sends nothing. You see
the form, including the optional diagnostic summary (versions, settings and counts, never
names or amounts), and nothing reaches GitHub unless you submit it. **Buy me a coffee**,
at the top of PassBook's settings, opens the developer's Ko-fi page in your browser; the
Ko-fi logo is bundled with PassBook, so showing it makes no request.

## Accounts and payment

Real bank data needs a **SimpleFIN Bridge** account, a paid third-party service (about
$15/year at the time of writing) that PassBook isn't affiliated with. PassBook itself is
free, and demo mode needs no account.

## Privacy

- **No telemetry.** PassBook collects nothing and sends nothing anywhere except the
  requests to SimpleFIN listed above.
- **Your data stays in your vault.** Accounts and transactions are saved as plain JSON in
  the data folder. They go wherever your vault goes (your sync service, your backups),
  and PassBook doesn't encrypt them.
- **The access URL stays on the device that connected.** It's kept in Obsidian's secret
  storage, encrypted by your operating system, and never written to your vault,
  `data.json`, or anything that syncs. Other devices read the synced data instead.
- **Other plugins can read it.** Obsidian doesn't isolate secret storage between
  plugins, so only install plugins you trust in a vault where PassBook is connected.
- **Read-only.** PassBook never moves money or changes anything at your bank.

The full picture, including what could go wrong, is in
[docs/threat-model.md](docs/threat-model.md). To report a security problem, see
[SECURITY.md](SECURITY.md).

## Support

PassBook is free and open source. If it's useful to you, you can
[buy the developer a coffee on Ko-fi](https://ko-fi.com/devmilo).

## Feedback

Found a problem or have an idea? Use **Report a problem** or **Suggest a feature** at the
bottom of **Settings → PassBook**, or [open an issue](../../issues/new/choose).

## Contributing

Building from source, running the tests and the project's ground rules are in
[CONTRIBUTING.md](CONTRIBUTING.md).

## License

Apache 2.0. See [LICENSE](LICENSE) and [NOTICE](NOTICE).
