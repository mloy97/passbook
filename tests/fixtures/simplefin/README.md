# SimpleFIN fixtures

Hand-written from the [SimpleFIN protocol 2.0 spec](https://www.simplefin.org/protocol.html)
with made-up data. No real accounts. #33 adds responses recorded from SimpleFIN's public
demo alongside these.

- `accounts-v2.json`: two connections, a checking account with a pending charge
  (`posted: 0`), a credit card, no errors.
- `accounts-v2-errors.json`: one connection needing re-authentication (`con.auth`), one
  account with incomplete data (`act.missingdata`), and a deprecated `errors` string.
- `accounts-v1.json`: the older shape, with `org` on each account instead of connections.
