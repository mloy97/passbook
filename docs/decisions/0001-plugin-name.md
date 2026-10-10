# 0001. Plugin name: PassBook

- Date: 2026-10-09
- Status: accepted
- Issue: none (decided in conversation before the tracker existed)

## Context

The working title "ObsidianFinance" can't ship: community plugin IDs can't contain
"obsidian", and the name can't suggest the plugin is first-party. The ID is permanent
once the plugin is in the community store.

## Decision

The plugin is named **PassBook**, with plugin ID `passbook`. The repo will be renamed to
match.

## Alternatives

- "Bank Sync" / `bank-sync`: descriptive but generic, and easy to confuse with other
  finance plugins.

## Consequences

- When this was decided (2026-10-09), no plugin in the community list
  (`obsidianmd/obsidian-releases/community-plugins.json`, 8,603 entries) used `passbook`
  as its ID or name.
- The ID can't change after store submission, so it has to be applied before the first
  release: in `manifest.json`, the README, `NOTICE` and the repo name.
- Renaming the GitHub repo is an owner action. GitHub redirects the old URL.
