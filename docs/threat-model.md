# Threat model

What PassBook stores, where it goes, and what could go wrong. Written for users deciding
whether to trust it, and for contributors deciding whether a change is safe.

## What's worth protecting

| Asset | Why it matters | Where it lives |
|---|---|---|
| **SimpleFIN access URL** | Read access to every account linked in SimpleFIN Bridge, until disabled there. Can't move money. | Obsidian SecretStorage on the device that connected |
| **Account and transaction data** | Balances and spending history | The data folder in the vault (plain JSON) |
| **Setup token** | One use: whoever claims it first gets an access URL | Only in the settings field while connecting; never stored |

PassBook is read-only. Nothing it stores can move money, and it never writes to a bank.

## Where data goes

- **Network.** Only to SimpleFIN Bridge, over HTTPS, from your device. There's no
  PassBook server and no telemetry. Every request goes through
  `src/providers/obsidian-adapters.ts`, and a test fails if any other file makes network
  calls. Setup tokens and access URLs that aren't HTTPS are refused.
- **Your vault.** The data folder (default `PassBook/`) is ordinary files, so it goes
  wherever your vault goes: Obsidian Sync, Nextcloud, iCloud, Git, backups. That's
  deliberate, because other devices and scripts read it. It isn't encrypted by
  PassBook.
- **`data.json`** (PassBook's settings, synced with the vault): the data folder name,
  the data source, and SimpleFIN's last-sync time. No credentials.
- **Per-device storage** (Obsidian's localStorage, not synced): when the connection was
  last confirmed, whether this device syncs, and recent request times.
- **SecretStorage** (not synced; OS-encrypted since Obsidian 1.11.5; on Linux this
  needs a keyring such as libsecret or kwallet): the access URL.

## Threats and what PassBook does about them

**Someone gets your vault files** (a shared sync folder, a leaked backup, a stolen
laptop without disk encryption). They can read your balances and transactions. They
can't get the access URL from the vault, because it isn't there. *Mitigation:* yours,
not PassBook's. Trust your sync provider, use disk encryption, and keep the data folder
out of anything you share. You can move it with the **Data folder** setting.

**Another plugin in the same vault.** Obsidian plugins all run with the same access.
**SecretStorage isn't isolated per plugin**, so any plugin you install can read the
access URL, as well as the data folder. This is how Obsidian works, not something
PassBook can change. *Mitigation:* only install plugins you trust in a vault with
PassBook connected. If in doubt, disable the access URL in SimpleFIN Bridge and connect
again.

**A leaked access URL.** Whoever holds it can read your linked accounts until you
disable it in SimpleFIN Bridge. It can't be used to move money. *Mitigation:* PassBook
never logs it, never writes it to `data.json` or the vault, sends credentials only in
an `Authorization` header (never in a URL), and **Disconnect** removes it from this
device. Tests check that no file PassBook writes, and nothing `api.v1` returns,
contains it.

**A stolen setup token.** If someone claims your setup token before you do, they get
the access URL. *Mitigation:* when SimpleFIN says a token was already used, PassBook
says so and tells you to disable it in SimpleFIN Bridge.

**Network attackers.** All traffic is HTTPS; PassBook refuses non-HTTPS SimpleFIN
addresses. Obsidian's `requestUrl` does the TLS checking.

**Hostile text from a bank.** Merchant names and descriptions come from banks, through
SimpleFIN.
- PassBook never renders them as HTML: settings and notices use Obsidian's text APIs.
- In CSV exports, text starting with `= + - @` is prefixed with `'` so spreadsheets
  don't run it as a formula.
- The example daily-note script escapes `|` so a description can't break its table.
- Your own templates that insert descriptions into notes should treat them as
  untrusted text, especially if anything later evaluates the note (Dataview JS,
  Templater).

**Exceeding SimpleFIN's limits.** SimpleFIN disables access for apps that keep going
past about 24 requests a day. *Mitigation:* PassBook allows itself 20 per rolling 24
hours and backs off after SimpleFIN warns or refuses.

**Two devices syncing at once.** Devices with their own connections could both write
the data folder. *Mitigation:* **This device syncs** lets you turn syncing off on all
but one, and devices without a connection never sync.

**A compromised PassBook release.** *Mitigation:*
- The plugin has no runtime dependencies; everything is bundled at build time from
  locked versions.
- Release builds run on GitHub Actions with build provenance attestations, which you
  can verify against the source (`gh attestation verify main.js --repo <owner>/<repo>`).
- There's no auto-update outside Obsidian's normal plugin updates, and no remote code.

## Out of scope

- Protecting data from someone with full control of your unlocked computer.
- SimpleFIN Bridge's own security, and the security of the banks behind it.
- Encrypting the data folder. If you need that, put your vault on encrypted storage.

## Reporting a problem

See [SECURITY.md](../SECURITY.md).
