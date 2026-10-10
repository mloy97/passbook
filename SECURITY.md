# Security policy

PassBook handles access to people's bank data, so security reports get priority.

## Reporting a vulnerability

Please report privately, not in a public issue. Use GitHub's
**Security → Report a vulnerability** on this repository, which opens a private
advisory only the maintainers can see.

Include what you found, how to reproduce it, and what an attacker could do with it. You
should get a reply within a week. Fixes for confirmed issues ship as a patch release,
and you'll be credited in the advisory unless you'd rather not be.

## Supported versions

Only the latest release gets security fixes.

## What's in scope

Anything that could expose a SimpleFIN access URL or a user's financial data beyond
what [docs/threat-model.md](docs/threat-model.md) describes. That includes:

- secrets reaching logs, files, `data.json` or `api.v1` results;
- network calls to anywhere other than the user's data provider;
- bank-supplied text being executed or rendered as HTML.

The threat model also lists what's out of scope, such as other plugins reading
SecretStorage, which is how Obsidian works.

## If your access URL may be exposed

Disable it in SimpleFIN Bridge (that stops it working everywhere), then connect PassBook
again with a new setup token.
