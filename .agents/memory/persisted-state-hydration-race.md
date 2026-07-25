---
name: Persisted UI-state hydration race
description: Screens with async server-hydrated persisted UI state clobber any state set at mount time (deep links, params) when hydration resolves.
---

Some screens hydrate persisted UI state (active tab, form fields) asynchronously from the server ~1–2s after mount, then reset local state to the hydrated values.

**Rule:** any mount-time state assignment (deep-link `?tab=` params, navigation intents) must survive that reset — record the intent in a ref and have the hydration effect consume the intent instead of applying the persisted value.

**Why:** a deep-link effect fires before hydration resolves; the hydration effect then overwrites the deep-linked value, and the deep-link effect never re-fires (params unchanged). E2E tests miss it unless the target screen is cold (never mounted that session) — warm-path tests pass while the cold path regresses.

**How to apply:** when adding param-driven state to a screen using a persisted-state hook, check for a hydration effect that calls `set*(ps.*)`; if present, gate it behind an unconsumed-intent ref. Verify with a cold-path e2e: fresh session, navigate via the deep link WITHOUT visiting the screen first, then wait a few seconds and assert no snap-back.
