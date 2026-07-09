---
name: Bright Data Unlocker quirks
description: Provider-level behaviors of the Bright Data Unlocker REST API that shape what scraping can and cannot do, plus secret-onboarding failure patterns.
---

# Bright Data Unlocker quirks (observed live, 2026-07)

## Google domains: raw HTML is disabled provider-wide
- Any raw-HTML unlock of a google.com URL returns HTTP 200 + `x-brd-err-code: temporarily_unsupported` and a plain-text body: "This endpoint has been disabled due to low success rate, please add &brd_json=1".
- **Why:** Bright Data routes Google through their SERP parsing infrastructure; raw mode is permanently off, not transient — retries can never succeed.
- **How to apply:** treat this as a structural refusal (own error class, single attempt), never as "no content found". `brd_json=1` on a Maps search/place URL returns place METADATA only (title, rating, reviews_cnt, fid) — no review texts. `https://www.google.com/reviews?fid=...&brd_json=1` returns empty (`[]`) on Web Unlocker zones — review texts require the separate SERP API product/zone.

## Unlocker errors ride on HTTP 200
- Transport-level errors arrive as HTTP 200 with `x-brd-err-code` / `x-brd-error` headers and an error-string body. Never feed such bodies to HTML/JSON extractors; check the header first.

## Zone IP whitelist blocks Replit
- `client_10030` (`ip_forbidden`) means the zone's "Allowed IPs" list is on and the egress IP isn't in it. Replit egress IPs rotate (and differ in deployments) — the fix is to clear/disable the zone's IP allowlist and rely on the Bearer key, not to whitelist one IP. The error message includes a direct dashboard URL to the zone's access params.

## Secret onboarding: detect identical re-pastes
- A user can "re-save" a secret several times without changing it (stale clipboard, or submitting the dialog empty keeps the old value). Verify with a sha256 fingerprint of the env value (never print the value) — identical fp across saves proves the store is unchanged. Env propagation itself is near-instant (verifiable with a throwaway env var). Breaking the loop: direct the user to the Secrets tab where they can SEE the stored value while editing.
