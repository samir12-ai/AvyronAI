---
name: Bright Data 407 auth failure isolation
description: How to tell whether a Bright Data proxy 407 (Proxy Authentication Required) is caused by app code vs the account/credentials themselves.
---

When every scraping stage (WEB_API, HTML_PARSE, HEADLESS_RENDER, TikTok) fails instantly (duration=0ms) with a generic `TypeError: fetch failed`, don't assume the app's username-building logic is at fault. Node's `fetch` collapses the real cause into `error.cause`, which itself often wraps another `.cause` — walk the full chain (`error.cause.cause.message` etc.) before concluding anything.

Isolate the layer by testing the proxy directly with `undici`'s `ProxyAgent`, once with the exact app-built username (e.g. `<user>-country-<cc>-session-<id>`) and once with the **bare** username/password straight from env vars, no suffixes at all. If both fail identically with `Proxy response (407) !== 200 when HTTP Tunneling`, the failure is upstream of any app code — it's the Bright Data account/credentials/zone itself (expired trial, suspended account, wrong zone type for the port, revoked password), not a bug in session/country-suffix construction.

**Why:** saved real debugging time — a prior session had just fixed genuine username-format bugs (missing `-session-`/`-country-` suffixes) and it was tempting to assume a subsequent 407 was another instance of the same bug class. It wasn't; the credentials were being rejected outright regardless of format.

**How to apply:** when Bright Data (or any residential-proxy vendor) scraping fails with opaque `fetch failed` errors after a code fix, always run the bare-credential isolation test first. If it 407s too, stop debugging app code and tell the user to check the provider dashboard (account status, zone active/expired, password reset) — no further code change will fix it.
