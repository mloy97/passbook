# Testing

- Lives in: `tests/`, `vitest.config.ts`, `wdio.conf.mts`, `tests/e2e/`
- Depends on: everything
- Last reviewed: Phase 3 (2026-10-09)

## Responsibility

Two layers: fast unit tests that run anywhere (`npm test`), and end-to-end tests that
launch real Obsidian and take screenshots (`npm run test:e2e`). The commands are in
[CONTRIBUTING.md](../../CONTRIBUTING.md).

## How it works

**Unit (vitest).** The `obsidian` npm package has types but no runtime code, so
`vitest.config.ts` aliases `obsidian` to `tests/mocks/obsidian.ts`.

- That mock provides `Plugin`, `PluginSettingTab`, `Setting`, `Notice` (which records
  what was shown) and `normalizePath`.
- `tests/mocks/app.ts` is a map-backed `App`. It copies the real one's quirks on
  purpose:
  - the vault adapter refuses to write into a folder that doesn't exist;
  - `rename` refuses to overwrite;
  - `saveLocalStorage` clears the key for falsy values;
  - folders show up as `TFolder` in `getAbstractFileByPath`.

  It also records workspace events and fake leaves.
- `tests/mocks/files.ts` is an in-memory `Files` for ledger tests. It records the order
  of writes.
- Providers are tested with `tests/providers/fakes.ts`. `fakeHttp(...)` answers
  requests in order and records them; passing an `Error` simulates "no response".
  `fakeSecrets()` enforces SecretStorage's ID format.
- SimpleFIN fixtures are in `tests/fixtures/simplefin/` (made up, from the spec).
- `tests/fixtures/export/transactions.csv` is a byte-exact golden file. It's marked
  `-text` in `.gitattributes` so git leaves its CRLFs alone.
- `tests/api/types.test.ts` is a type-level test: it fails `tsc` (`npm run build`), not
  vitest, when the published `.d.ts` drifts.
- `tests/examples/` loads `examples/` files as CommonJS, like Templater.
- `tests/providers/contract.test.ts` runs the same provider contract against every
  provider.
- `tests/policy.test.ts` checks the source against the README's promises (see
  [release.md](release.md)).
- `tests/scripts/` tests the release script.

**End to end (wdio-obsidian-service).**

- `wdio.conf.mts` runs every `tests/e2e/specs/*.e2e.ts` on Obsidian at `minAppVersion`
  (`earliest`) and `latest` on desktop, plus `latest` with phone-width emulation.
- Builds download to `.obsidian-cache/`.
- Each run gets a fresh copy of `tests/e2e/vaults/simple`.
- Specs fake the network by replacing `plugin.http` from inside Obsidian
  (`browser.executeObsidian`). Everything else is real: provider, controller,
  SecretStorage, ledger files, settings UI, commands, notices and `api.v1`.
- `demo.e2e.ts` runs demo mode in its own fresh Obsidian, with `plugin.http` set to
  fail on any call.
- `settings.e2e.ts` walks a whole session in order: connect, toggle, check, sync, rewrite,
  API, palette, export, data folder, disconnect. Later tests depend on earlier ones;
  read it top to bottom.
- Screenshots land in `screenshots/<version>[-mobile]-<step>.png`, plus a `FAILED-`
  shot for any failing test.

## Data it owns

- `screenshots/` and `.obsidian-cache/`: local only. Both are gitignored.

## Decisions baked in

- Specs run against the earliest supported Obsidian, not only the latest, because
  `minAppVersion` is a promise to users.
- The e2e specs have their own `tests/e2e/tsconfig.json` (wdio and mocha globals) and
  are type-checked by `npm run test:e2e`, not by `npm run build` or ESLint.

## Traps

- **Obsidian 1.14+ desktop opens settings in a pop-out window**, which WebDriver can't
  see. `openSettings()` in the spec sets `app.setting.shouldUsePopout = () => false`.
  Without it, every settings test fails on `latest` and passes on `earliest`.
- **The e2e tsconfig needs `"exclude": []`.** It extends the root tsconfig, which
  excludes `tests/e2e`. Without the override, `tsc -p tests/e2e` type-checks nothing
  and reports success.
- **mocha must match WebdriverIO's version** (10.8.2). A newer top-level mocha loads
  but has no `describe` at runtime.
- **Code inside `browser.executeObsidian` runs in Obsidian**, not Node. It can't use
  variables from the spec file; pass them as arguments.
- **Unit tests passing doesn't mean it works in Obsidian.** Two bugs got past the unit
  tests because the mock was kinder than Obsidian: the missing plugin folder, and
  `saveLocalStorage(key, false)` silently storing nothing. When e2e finds a gap like
  that, fix the mock too.
- **Phone-width clicks during animations are lost.** Wait for `waitForClickable()` and
  a short pause before clicking in the settings sheet.
- **Real SimpleFIN responses are not tested yet** (#33). The demo token needs a
  permission the agent didn't have.
