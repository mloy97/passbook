# Codebase

How this project's code actually works. Start here, then read the subsystem you need.

Each doc below covers one part of the system: what it's responsible for, how it works,
where it lives, and what will bite you. Updated at the end of every phase.

| Subsystem | Lives in | What it does |
|---|---|---|
| [Providers](providers.md) | `src/providers/` | The provider interface and SimpleFIN: claiming tokens, fetching windows, coverage, request limits |
| [Ledger](ledger.md) | `src/ledger/` | The stored accounts and transactions: applying syncs, coverage removals, the data-folder files |
| [Public API](api.md) | `src/api/`, `types/`, `examples/` | `api.v1`, the sync-completed event, published types and the reference example |
| [Plugin shell, settings, sync and commands](plugin.md) | `src/main.ts`, `src/settings/`, `src/sync/`, `src/commands.ts` | Lifecycle, settings, the one sync path, commands, and where each piece of data is stored |
| [Build, CI and release](release.md) | `.github/workflows/`, `scripts/` | Bundling, CI, tagged releases with provenance, and the policy tests |
| [Testing](testing.md) | `tests/`, `wdio.conf.mts` | Unit tests with an `obsidian` mock; end-to-end tests in real Obsidian with screenshots |

System overview and constraints: [../architecture.md](../architecture.md). Public formats:
[../schema.md](../schema.md) and [../api.md](../api.md).
