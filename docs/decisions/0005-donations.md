# 0005. Donations through Ko-fi

- Date: 2026-10-10
- Status: accepted
- Issue: #39

## Context

The owner wants to accept donations. Obsidian shows a **Donate** button for plugins whose manifest has a `fundingUrl`, and the store rules require it to point to the developer.

## Decision

Donations go to [ko-fi.com/devmilo](https://ko-fi.com/devmilo), a general page for all of the developer's projects. It's set as `fundingUrl` in `manifest.json`, shown as a small support card at the top of PassBook's settings (Ko-fi's cup logo bundled, in Ko-fi's color), and linked from the README.

## Alternatives

- **GitHub Sponsors:** no platform fee, but donors need a GitHub account.
- **Buy Me a Coffee:** takes a percentage.
- **Patreon:** higher fees, and built for memberships rather than a utility plugin.

## Consequences

- Donors need no account; one less service to manage.
- Settings show the support card only while the manifest has a `fundingUrl`, so removing it from the manifest removes both.
- The card stays quiet: no popups, counters or repeated prompts, in line with Obsidian's policy against spammy patterns.
- The logo is an inline SVG (Simple Icons, CC0; Ko-fi permits its marks for promoting your page), so it adds no network request.
