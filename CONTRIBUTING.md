# Contributing

Thanks for helping with PassBook. Bug reports and ideas are easiest through
**Settings → PassBook → Feedback** in Obsidian, which opens a pre-filled form here. This
page is for working on the code.

## Setup

Requires Node.js 20 or later.

```sh
npm install
npm run build   # type-check src/, tests/ and types/, then bundle main.js
npm run dev     # rebuild on every change
```

To try a build, copy `main.js`, `manifest.json` and `styles.css` into
`<a test vault>/.obsidian/plugins/passbook/`, then enable PassBook under
**Settings → Community plugins**. Use a vault you don't mind experimenting in, and
**Data source → Demo** unless you're testing the bank connection itself.

## Checks

| Command | What it does |
|---|---|
| `npm test` | Unit tests (vitest). One file: `npx vitest run tests/main.test.ts`. By name: `npx vitest run -t "loads"`. |
| `npm run lint` | ESLint with `eslint-plugin-obsidianmd`, the rules Obsidian's review uses. |
| `npm run test:e2e` | End-to-end tests in real Obsidian ([wdio-obsidian-service](https://github.com/jesse-r-s-hines/wdio-obsidian-service)): the oldest supported version, the latest, and an emulated phone-width window. Screenshots land in `screenshots/`; look at them. One version only: `OBSIDIAN_VERSIONS=latest/latest OBSIDIAN_MOBILE_VERSIONS=" " npm run test:e2e`. |

The `obsidian` npm package is types only, so unit tests use `tests/mocks/obsidian.ts`
(aliased in `vitest.config.ts`). End-to-end specs fake the network by replacing
`plugin.http` inside Obsidian. Tests never use real bank credentials.

## Ground rules

- **No server, no telemetry.** All network use goes through
  `src/providers/obsidian-adapters.ts` and is listed in the README;
  `tests/policy.test.ts` enforces it.
- **Secrets only in Obsidian's secret storage**, never in `data.json` or the vault.
- **Read-only.** PassBook never changes anything at a bank.
- **The data schema and `api.v1` are a public contract** ([docs/schema.md](docs/schema.md),
  [docs/api.md](docs/api.md)). Add optional fields freely; anything breaking needs a
  major version and a migration.

## Where things are

- [docs/architecture.md](docs/architecture.md): how the system fits together.
- [docs/codebase/](docs/codebase/README.md): one doc per subsystem, including the traps.
- [docs/decisions/](docs/decisions/): why things are the way they are.
- [docs/releasing.md](docs/releasing.md): how releases are made.
