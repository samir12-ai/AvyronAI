---
name: Bright Data Web Unlocker proxy syntax
description: Correct username format for Bright Data's Web Unlocker product (port 33335) — country/session support, easy to wrongly assume it's bare-username-only.
---

Bright Data's Web Unlocker product (typically port 33335) supports the SAME
username suffixes as other Bright Data proxy zones:

```
brd-customer-<id>-zone-<zone>-country-<iso2>-session-<sessionId>
```

- `-country-<iso2>` — geo-targets the exit IP. Must be a 2-letter ISO-3166
  code (e.g. `ae`, `us`) — a full country name silently fails to apply.
- `-session-<string>` — pins requests to the same IP for up to ~5 min
  (sticky session). Omit it entirely to get a fresh IP on every request
  (the default rotation mode).

**Why this matters:** it's tempting to special-case "Web Unlocker" as a
different product tier that only accepts the bare
`brd-customer-<id>-zone-<zone>` username (no country/session), because some
Bright Data docs frame Web Unlocker as fully automatic. That assumption is
wrong for the current API — verify against current Bright Data docs before
special-casing a proxy port instead of using the same suffix syntax used
elsewhere.

**How to apply:** any proxy-URL-building code that special-cases a Bright
Data product/port to drop `-country-`/`-session-` should be treated as
suspect — confirm with current docs before trusting an `isWebUnlocker` style
branch that strips proxy targeting options.
