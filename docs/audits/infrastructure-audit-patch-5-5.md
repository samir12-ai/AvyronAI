# Infrastructure Audit — Patch 5/5 (Final)

**Scope:** Exploration Budget + Gates + SQL Migrations + HTML Templates (30 files)
**Date:** 2026-07-06
**Auditor:** Replit Agent

---

## A) Per-File Verdict Table

### GROUP 1 — `server/exploration-budget/` (2 files)

| File | Category | Verdict | Notes |
|---|---|---|---|
| `server/exploration-budget/routes.ts` | AUTH / TENANT ISOLATION / ERROR DISCLOSURE | ⚠️ MEDIUM | Every route calls `resolveAccountId(req)` (L13) and `assertCampaignBelongsTo(accountId, campaignId)` (L21), with ownership failures routed through `handleOwnershipError` to return a 404 rather than leaking existence of other accounts' campaigns — correct pattern. All DB reads (`businessDataLayer` L27, `strategicPlans` L46, `loadMemoryBlock` L37) scope by **both** `accountId` and `campaignId`. However, the catch block at L72–75 returns raw `err.message` directly to the client. |
| `server/exploration-budget/engine.ts` | BUSINESS LOGIC SAFETY / SILENT FAILURE | ⚠️ MEDIUM | Hard limits enforced: `MIN_EXPLORATION_PCT` (10%) and `MAX_EXPLORATION_PCT` (35%) are clamped in-code (L106, L112) — the budget cannot mathematically exceed these bounds regardless of input. The V2→legacy engine fallback (L62–64) logs a warning before falling back — acceptable degradation, not silent. However, `generateHypothesis`'s bare `catch { return defaultHypothesis(...) }` (L76–78) silently swallows the underlying AI failure with no logging at all, masking a real upstream error behind a synthetic default. Persistence uses `upsertOperationalState` with an `ON CONFLICT` composite-key upsert (`[accountId, campaignId, stateType]`) — the write itself is atomic, but the budget *calculation* happens in-memory beforehand with no transactional lock, so concurrent requests could redundantly recompute (not overspend, since the enforced percentage bounds are stateless clamps, not a cumulative counter). |

### GROUP 2 — `server/gates/` (2 files)

| File | Category | Verdict | Notes |
|---|---|---|---|
| `server/gates/registry.ts` | AUTH / TENANT ISOLATION / GATE ENFORCEMENT | ⚠️ MEDIUM | Defines `requireGates` middleware (autopilot, safety mode, AI budget, feature flags). Does not perform authentication itself — it assumes `resolveAccountId` (called by the wrapping route) has already validated the caller; this is consistent with the rest of the app's middleware-chain pattern rather than a unique gap. Queries are scoped by `accountId` (L12–13) but gates in this file operate on **account-level** state only and do not query campaign-specific data, so campaign-level ownership checks are correctly left to the calling route rather than duplicated here. Gate enforcement itself is unconditional and correct: on any failing gate, `requireGates` returns `403` and calls `return` to halt the middleware chain (L86–89) — no bypass paths or fallback-to-pass-through defaults were found in this file. |
| `server/gates/validate.ts` | INPUT VALIDATION | ✅ PASS | Zod-schema-based request body/query validation middleware for account/campaign-shaped input. No catch blocks, no raw error disclosure, no bare `catch {}` present in this file. |

**Note:** Error-disclosure and bare-`catch{}` findings surfaced during this exploration in `server/routes.ts` (L171, L235) and `server/dashboard-routes.ts` (L71) are **outside the Group 1/2 scope** (they live in general route files, not `server/gates/` or `server/exploration-budget/`) and are noted here only as corroborating evidence that the raw-error-disclosure and silent-catch patterns flagged in Patches 1–4 are systemic rather than confined to any one module.

---

## B) Group 3 & 4 — Batch Verdicts

### GROUP 3 — SQL Migrations (`server/migrations/sql/`, 21 files)

**⚠️ MEDIUM — single batch verdict.**

- **Hardcoded secrets/seed data:** No hardcoded emails, passwords, or API keys found. One static `INSERT INTO divergence_class_routes (...) VALUES` seed statement exists in `028_orchestrator_parity.sql` (L80) — this inserts static routing-classification rows (config data), not credentials or PII.
- **Injection risk if ever templated:** All 21 files are static `.sql` files executed verbatim by the migration runner with no string interpolation present in the files themselves — there is no injection risk *within these files*. (The interpolation risk pattern flagged in Patch 4 belongs to the separate TypeScript migration `001-reassign-default-account-to-founder.ts`, not this SQL directory.)
- **Irreversible operations:** Three files contain `DROP TABLE` statements: `016_account_lifecycle.sql` (L32, `DROP TABLE IF EXISTS account_delete_confirmations`, unconditional in the forward migration) and two files (`027_orchestrator_replay_cassettes.sql` L22, `032_cutover_state_archive.sql` L10) where the `DROP TABLE` appears only inside a **comment** documenting the intended rollback/down-migration command, not as an executed statement — this is the correct documented-rollback pattern. `016`'s drop is unconditional and irreversible with no comment explaining intent; verify this table's contents are genuinely safe to lose before this migration is ever replayed on a populated database.

### GROUP 4 — HTML Templates (`server/templates/`, 5 files)

**✅ PASS — single batch verdict.**

- `pipeline-overlay.html` (the largest, most dynamic template — an admin-facing pipeline/audit dashboard) consistently routes all server-fetched dynamic values through a single `esc()` helper (L174: standard `&<>"'` HTML-entity escaping) before interpolating into `innerHTML` template strings — every dynamic field found during review (`r.id`, `r.campaignId`, `r.trigger`, `b.accountId`, `e.message`, JSON blobs via `JSON.stringify`, etc.) is wrapped in `esc(...)`. No unescaped direct interpolation of server/user-controlled data into `innerHTML` was found.
- `pipeline-overlay-login.html` accepts an admin Bearer JWT pasted by the operator and documents that it is "validated server-side; on success an httpOnly cookie is set" (L37) — consistent with the project's admin-token gating doctrine; no client-side secret storage found in this file.
- `landing-page.html` and `pricing.html` are static marketing pages with no server-side data interpolation — only static `<link>`/`<svg>` references and Google Fonts preconnects (public, non-sensitive URLs).
- `data-deletion.html` contains one external link to Facebook's own settings page (L163, `https://www.facebook.com/settings?tab=applications`) as user-facing instructional copy — not an internal URL or secret.
- No hardcoded API keys, internal service URLs, or secrets found in any of the 5 templates.

---

## C) Top Fixes Prioritized by Severity

1. **[MEDIUM] Log the swallowed AI failure in `exploration-budget/engine.ts` `generateHypothesis`** — L76–78's bare `catch { return defaultHypothesis(...) }` should at minimum `console.error` or use the project's `_logSilentLoad` pattern before returning the default, so a real upstream AI failure isn't indistinguishable from a legitimate default hypothesis.
2. **[MEDIUM] Fix raw error disclosure in `exploration-budget/routes.ts`** — L72–75 returns `err.message` directly to the client; replace with a generic message and keep the detailed `console.error` that's already present.
3. **[LOW] Verify intent behind the unconditional `DROP TABLE` in `016_account_lifecycle.sql`** (L32) — unlike the two other `DROP TABLE` occurrences in this batch (which are rollback comments, not executed statements), this one runs as part of the forward migration with no comment explaining why `account_delete_confirmations` is safe to drop unconditionally; add a comment or confirm the table is always empty/deprecated at this migration point.
4. **[LOW] Consider whether `exploration-budget` calculation should be idempotency-guarded** — not a bug today since the hard 10–35% clamp is a stateless bound rather than a cumulative counter, but if the budget model is ever extended to track cumulative spend, the current read-then-upsert pattern (no transactional lock around the in-memory calculation) would need a lock or atomic increment to stay race-safe.
5. **[INFORMATIONAL] Systemic raw-error-disclosure / bare-catch pattern reconfirmed** — this patch's exploration turned up the same `err.message`-to-client and bare-`catch {}` patterns in `server/routes.ts` and `server/dashboard-routes.ts` already flagged across Patches 1–4; no new remediation needed beyond what's already recommended, but this closes out the pattern as confirmed project-wide rather than isolated to lead-engine/video routes.

---

## D) Explicit Answers

**Q1: Can exploration budget limits be bypassed through concurrent requests or missing validation?**

No — not in the way this could matter for a spending cap. The enforced bounds (`MIN_EXPLORATION_PCT` = 10%, `MAX_EXPLORATION_PCT` = 35%) are **stateless mathematical clamps** applied to each calculation independently, not a cumulative running total that concurrent requests could race to exceed. Even if two requests compute and persist budgets concurrently, each individual result is clamped to the 10–35% range before it's ever written, and the final persisted state is written via an atomic `ON CONFLICT` upsert keyed on `[accountId, campaignId, stateType]`. The only real concurrency effect is wasted redundant computation (two requests both recalculating the same in-memory result), not a bypass of the limit itself. If the budget model is later changed to track cumulative spend across requests (rather than a per-calculation percentage), this would need to be revisited with proper locking.

**Q2: Do HTML templates safely escape user data before rendering?**

Yes, for the one template that renders genuinely dynamic/server-fetched data (`pipeline-overlay.html`) — every interpolated value found during review passes through the shared `esc()` HTML-escaping helper before being inserted into `innerHTML`, including error messages, IDs, and JSON payloads. The other four templates (`landing-page.html`, `pricing.html`, `data-deletion.html`, `pipeline-overlay-login.html`) either contain no dynamic server-side interpolation or handle the one sensitive input (the pasted admin JWT) via a server-side validation + httpOnly-cookie flow rather than client-side rendering, so no XSS vector was found across the batch.

---

## Series Summary — Patches 1–5 Complete

This closes the 5-part Infrastructure Audit series. Highest-severity findings across the full series, for reference:

- **HIGH:** Unauthenticated `/api/generate-image` route (Patch 1).
- **HIGH:** Tenant leak in `strategy-routes.ts` signature-series endpoint, no accountId filter (Patch 2).
- **HIGH:** `landing-page-routes.ts` and `lead-magnet-routes.ts` — zero ownership checks on any CRUD route (Patch 3).
- **HIGH:** `veo-routes.ts` `/api/veo/status` and `/api/veo/video-proxy` unauthenticated (Patch 3).
- **HIGH:** Bare `catch {}` masking a failed integrity check after an irreversible `DELETE` in `001-reassign-default-account-to-founder.ts` (Patch 4).
- **Systemic (all 5 patches):** raw `err.message` disclosure to clients and bare `catch {}` silent failures recur across nearly every server module audited — this is the single most common finding in the entire series and the primary candidate for a project-wide remediation pass (e.g. a shared error-response helper + ESLint rule banning direct `err.message` in `res.json`, mirroring the existing `NO SILENT CATCHES` doctrine already enforced elsewhere in the codebase).
