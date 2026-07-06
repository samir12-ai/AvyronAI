# Infrastructure Audit — Patch 2/5

**Scope:** Campaign + Strategy + Audit + Autopilot + Business Data + Content DNA + Brand Config routes (20 files)
**Date:** 2026-07-06
**Auditor:** Replit Agent

---

## A) Per-File Verdict Table (Grouped by Scope)

### GROUP 1 — Campaign / Audit / Autopilot (5 files)

| File | Category | Verdict | Notes |
|---|---|---|---|
| `server/campaign-routes.ts` | AUTH & TENANT ISOLATION | ✅ PASS | Most routes use `requireCampaign` middleware, which pairs `selectedCampaignId` with `accountId` (`and(eq(campaignSelections.accountId, accountId), eq(campaignSelections.selectedCampaignId, requestedCampaignId))`, L1056–1057). Routes taking `:campaignId` directly (manual-metrics, retention, iterations) manually pair `campaignId` + `accountId` in `.where(and(...))` (e.g. L436–439). No cross-tenant gap found. |
| `server/campaign-data-layer.ts` | UNBOUNDED QUERIES / SILENT CATCH | ⚠️ MEDIUM | `getCampaignMetrics` (L384–397) selects all revenue/spend/conversion/lead rows for a campaign with no `.limit()` — grows unbounded over campaign lifetime. Two bare catches swallow errors silently: L33 `catch { return "MANUAL"; }`, L52 `catch { return null; }`. Tenant scoping itself is solid — every filter includes `eq(Table.accountId, accountId)`. |
| `server/audit-routes.ts` | ADMIN GATING / ERROR DISCLOSURE | ❌ **HIGH** | No admin-only restriction anywhere in the file — every route (Feed, AI Usage, Gates, Decisions, Jobs) is reachable by any authenticated user, scoped only to their own `accountId`. `errorResponse` helper (L78–80) and its call sites (L153, L270, L428) return raw `err.message` to the client. `safeJsonParse` (L817) has a bare `catch { return str; }`. |
| `server/audit.ts` | LOGGING INTEGRITY | ✅ PASS | `logAudit` (L126–136) requires `accountId` as first param and enforces it on every insert — no way to write an audit row without tenant scoping. |
| `server/autopilot-routes.ts` | AUTH & TENANT ISOLATION | ✅ PASS | `PATCH /api/autopilot/status` (L340) and `POST /api/autopilot/emergency-stop` (L376) both gated by `requireCampaign`. Emergency-stop additionally re-scopes every DB update by `accountId` (L386, L395, L401), preventing a cross-tenant blast radius even if campaign resolution were somehow wrong. `resolveActivePlan` pairs `accountId` + `campaignId` (L55–56). |

### GROUP 2 — Business Data / Content DNA / Brand Config / Strategy (5 files)

| File | Category | Verdict | Notes |
|---|---|---|---|
| `server/business-data-routes.ts` | AUTH & TENANT ISOLATION | ✅ PASS | `assertCampaignBelongsTo(accountId, campaignId)` called before every campaign-scoped read/write (L58, L88), with `handleOwnershipError` short-circuiting the response on failure. All queries pair `campaignId` + `accountId` (L65–68, L119–122). Generic error strings only (L79). Queries use `.limit(1)`. |
| `server/content-dna-routes.ts` | ERROR DISCLOSURE | ⚠️ MEDIUM | Ownership check present (`assertCampaignBelongsTo`, L416) and all context queries pair `accountId` + `campaignId` (L50). **But** two catch blocks leak `err.message` directly to the client: `res.status(500).json({ success: false, error: err.message })` (L406, L428). |
| `server/brand-config-routes.ts` | AUTH & TENANT ISOLATION | ✅ PASS | Account-level resource (no campaign scoping needed). Every query filters strictly by `eq(brandConfig.accountId, accountId)` (L11, L65). Generic error messages only (L74). |
| `server/strategy-routes.ts` | TENANT ISOLATION / ERROR DISCLOSURE | ❌ **HIGH** | `GET /api/strategy/signature-series` (L1010–1012) has **no `requireCampaign`, no `accountId` filter, and no `.limit()`** — it runs `db.select().from(signatureSeries).where(eq(signatureSeries.isActive, true)).orderBy(desc(signatureSeries.createdAt))` and returns every active signature series system-wide to any authenticated caller, regardless of tenant. All other routes on this file correctly use `requireCampaign` (e.g. L59). Separately, `error.message` is leaked to the client at L471. |
| `server/strategy-root-routes.ts` | AUTH & SILENT CATCH | ⚠️ MEDIUM | Ownership enforced structurally — `getActiveRoot(campaignId, accountId)` and downstream engine-snapshot queries pair both IDs (L18, L87, L101) — but there is no explicit `requireCampaign`/`assertCampaignBelongsTo` call at the route entry point itself; correctness currently depends entirely on the internal helper always filtering correctly. Bare catch at L42 (`catch { snapshotBindings[key] = { exists: false }; }`) silently masks snapshot-lookup failures as "doesn't exist." No raw error message reaches the client. |

### GROUP 3 — Strategic Logic / Gating (9 files)

| File | Category | Verdict | Notes |
|---|---|---|---|
| `server/plan-gate.ts` | DATA INTEGRITY (GATING) | ❌ **HIGH** | The route computes a `PASS` / `PASS_WITH_ASSUMPTIONS` / `BLOCKED` verdict (`if (overallScore < 40 \|\| !bizData?.businessType) gate = "BLOCKED"; else if (overallScore < 70 \|\| assumptions.length > 0) gate = "PASS_WITH_ASSUMPTIONS";`) but **only returns this verdict to the caller — it does not itself enforce a server-side lock preventing plan progression** if the caller ignores the verdict. `PASS_WITH_ASSUMPTIONS` also silently backfills missing critical inputs (channel→Instagram L142, goal target→estimated L152, timeline→90 days L156, budget→$300–500/mo L169) rather than blocking outright, which can let genuinely underspecified plans through. |
| `server/goal-math.ts` | DIVIDE-BY-ZERO | ❌ **HIGH** | Multiple unguarded divisions: L124/125 `requiredClosedClients / leadToClientRate` and `requiredQualifiedLeads / qualificationRate` → `Infinity` if either rate is 0; L128 `requiredLeads / conversationToLeadRate`; L130 `requiredClicks / ctr`; L199 `affordableLeads / funnel.requiredLeads`. Only `L190` and `L212` denominators are structurally guaranteed non-zero. A single zero-rate input propagates `Infinity`/`NaN` into downstream budget/lead-volume calculations. Bare catch at L517 (`catch { return null; }`) on JSON parse. |
| `server/decision-attribution.ts` | TENANT ISOLATION | ✅ PASS | `createAttributionEntries` scopes its `recentDecisions` query by both `accountId` and `campaignId` (L127–128). |
| `server/conflict-resolver.ts` | CONCURRENCY SAFETY | ❌ **HIGH** | No transaction, row lock, or optimistic-concurrency check around `logAssumptions`/`detectImplicitAssumptions` — plain `db.insert` (L80) preceded by plain `db.select` (L94, L100). Two concurrent calls (e.g. duplicate requests, retries) can both pass the "does this assumption exist" check and insert duplicate rows. Bare catch at L105 (`catch { return []; }`) on JSON parse. |
| `server/root-bundle.ts` | SILENT CATCH | ⚠️ MEDIUM | Bare catch at L31 (`catch { return null; }`) on JSON parse — no logging. |
| `server/task-composer.ts` | SILENT FAILURES | ⚠️ MEDIUM | Composition failures are silently converted to empty results rather than surfaced: `generateTasksFromPlan` (L20) returns `[]` if `planData.contentDistribution` is missing; `composeTasks` (L167) returns `[]` if `templates.length === 0`; L209 returns `{ hasTasks: false, tasks: [] }` if the plan isn't found. Caller has no way to distinguish "legitimately no tasks" from "composition silently failed." |
| `server/outcome-tracker.ts` | TENANT ISOLATION | ⚠️ MEDIUM | `createAttributionEntries`-equivalent flows are generally accountId+campaignId scoped, but `snapshotPreMetrics` (L162) treats `campaignId` as optional and falls back to account-wide metrics (L169–171) when absent — a caller that omits `campaignId` gets cross-campaign (but same-tenant) data blended in. `resolvePerformanceForEntries` (L23) scopes by `accountId` only, relying on `entryIds` having been correctly pre-filtered upstream. Catch at L412 logs but does not rethrow, effectively still swallowing the failure path silently. |
| `server/ui-state-routes.ts` | SILENT CATCH | ⚠️ MEDIUM | Bare catch at L39 (`catch { parsed = null; }`) on JSON parse — no logging. |
| `server/diagnose/routes.ts` | ADMIN GATING / ERROR DISCLOSURE | ❌ **HIGH** | Route is gated by `requireCampaign` (L526) plus a campaign-ownership check (L534), but there is **no admin check at all** — any user with access to the campaign sees internal diagnostic detail: `validationState`, `planSource`, `signalOrigin` distribution, layer-specific degradation reasons (L574–589). Two bare catches: L123 `catch { return null; }`, L457 `catch { return { planSource: "unknown", fallbackPlanIsolated: false }; }`. |

### GROUP 4 — `server/strategic-core/` (10 files)

| File | Category | Verdict | Notes |
|---|---|---|---|
| `server/strategic-core/audit-logger.ts` | SILENT CATCH | ⚠️ MEDIUM | `logAuditEvent` catch (L39–41) logs to console but does not rethrow or expose the failure to the caller — an audit-log write can fail invisibly to the calling code path. |
| `server/strategic-core/cas-helper.ts` | CONCURRENCY SAFETY | ✅ PASS | Implements optimistic locking (`casUpdateStrategicPlan`) via Drizzle `returning` + version check — the one file in this batch that does concurrency correctly. |
| `server/strategic-core/confirm-routes.ts` | TENANT ISOLATION | ⚠️ MEDIUM | `strategicBlueprints` fetched by `id` alone with no `accountId` predicate (L106, L206): `db.select().from(strategicBlueprints).where(eq(strategicBlueprints.id, id)).limit(1)`. IDs are UUIDs (not sequentially guessable), which limits practical exploitability, but this is not defense-in-depth tenant isolation — a leaked/logged blueprint ID would grant read/edit access regardless of account. |
| `server/strategic-core/execution-routes.ts` | ERROR DISCLOSURE / TENANT ISOLATION / UNBOUNDED QUERIES | ❌ **HIGH** | Same `id`-only blueprint lookup pattern (L291). Four separate catch blocks return raw `err.message` to the client (L424, L439, L517, L554). Four related-item queries (`requiredWork`, `calendarEntries`, `studioItems`, `planApprovals`, L393–396) have no `.limit()`. |
| `server/strategic-core/extraction-routes.ts` | TENANT ISOLATION | ⚠️ MEDIUM | Same `id`-only blueprint lookup pattern (L396) — no `accountId` check before using the blueprint to drive AI synthesis. |
| `server/strategic-core/gate-routes.ts` | TENANT ISOLATION / UNBOUNDED QUERIES | ⚠️ MEDIUM | Same `id`-only blueprint lookup pattern (L193). `blueprintCompetitors` (L215) and `blueprintVersions` (L217, L350) queried without `.limit()`. |
| `server/strategic-core/index.ts` | ROUTE REGISTRATION | ✅ PASS | Pure registration file, no logic to audit. |
| `server/strategic-core/orchestrator-routes.ts` | — | ✅ PASS | No isolation, silent-catch, or unbounded-query issues surfaced. |
| `server/strategic-core/thinking-routes.ts` | TENANT ISOLATION | ⚠️ MEDIUM | Same `id`-only blueprint lookup pattern (L74). |
| `server/strategic-core/validation-routes.ts` | TENANT ISOLATION / ERROR DISCLOSURE | ⚠️ MEDIUM | Same `id`-only blueprint lookup pattern (L92). Error response leaks message detail: `` message: `Validation failed: ${error.message}` `` (L231). |

---

## B) Summary by Category

| Category | Findings | Status |
|---|---|---|
| **AUTH & ROUTE PROTECTION** | `campaign-routes.ts`, `business-data-routes.ts`, `content-dna-routes.ts`, `brand-config-routes.ts`, `autopilot-routes.ts` all consistently gate on `authMiddleware` + campaign/account ownership (`requireCampaign` or `assertCampaignBelongsTo`). `audit-routes.ts` has zero admin-only gating despite exposing gates/decisions/AI-usage/job data. `diagnose/routes.ts` has campaign ownership but no admin check on internal diagnostic detail. `strategy-root-routes.ts` relies on an internal helper rather than an explicit route-level ownership assertion. | ❌ **HIGH** |
| **ERROR DISCLOSURE** | Raw `err.message`/`error.message` reaches the client in: `audit-routes.ts` (L153, L270, L428), `content-dna-routes.ts` (L406, L428), `strategy-routes.ts` (L471), `strategic-core/execution-routes.ts` (4 sites), `strategic-core/validation-routes.ts` (L231). `campaign-routes.ts`, `autopilot-routes.ts`, `business-data-routes.ts`, `brand-config-routes.ts` all use generic messages correctly. | ❌ **HIGH** |
| **UNBOUNDED QUERIES** | `campaign-data-layer.ts` `getCampaignMetrics` has no `.limit()`. `strategy-routes.ts` `signature-series` has no `.limit()` (and no tenant filter — see below). `strategic-core/execution-routes.ts` (4 queries) and `strategic-core/gate-routes.ts` (2 queries) also lack `.limit()`. Audit-log listing routes (`/api/audit/feed`, `/api/audit/decisions`) do correctly cap page size. | ⚠️ MEDIUM |
| **DATA INTEGRITY** | `plan-gate.ts` computes a verdict but does not enforce it server-side, and backfills multiple missing critical inputs under `PASS_WITH_ASSUMPTIONS` rather than blocking. `goal-math.ts` has at least 4 unguarded division sites that can produce `Infinity`/`NaN`. `conflict-resolver.ts` has no transaction/locking around assumption inserts, risking duplicate rows under concurrent calls. `cas-helper.ts` is the sole example of correct optimistic-concurrency handling in this batch. | ❌ **HIGH** |
| **TENANT ISOLATION** | Strong in campaign/business-data/content-dna/brand-config/autopilot routes — every query pairs `accountId` with `campaignId`. **Confirmed leak:** `strategy-routes.ts` `GET /api/strategy/signature-series` returns all active signature series system-wide with no `accountId`/`campaignId` filter at all. **Weaker pattern:** every route in `strategic-core/` (confirm, execution, extraction, gate, thinking, validation) fetches `strategicBlueprints` by `id` alone with no `accountId` check — UUID opacity is the only protection, not an authorization check. `outcome-tracker.ts` blends account-wide metrics when `campaignId` is omitted. | ❌ **HIGH** |
| **SILENT FAILURES** | Bare/near-bare catch blocks found in: `campaign-data-layer.ts` (L33, L52), `audit-routes.ts` `safeJsonParse` (L817), `strategy-root-routes.ts` (L42), `goal-math.ts` (L517), `conflict-resolver.ts` (L105), `root-bundle.ts` (L31), `ui-state-routes.ts` (L39), `diagnose/routes.ts` (L123, L457), `task-composer.ts` (3 silent-empty-result sites), `outcome-tracker.ts` (L412 logs but doesn't rethrow), `strategic-core/audit-logger.ts` (L39–41). This is the single most widespread finding in the batch — 12+ distinct swallow points across 11 files. | ❌ **HIGH** |

---

## C) Top Fixes Prioritized by Severity

1. **[CRITICAL] Tenant isolation leak in `strategy-routes.ts`** — `GET /api/strategy/signature-series` (L1010–1012) must add `requireCampaign` + `accountId`/`campaignId` filtering and a `.limit()`. This is the only confirmed cross-tenant data-return bug in the batch; every other tenant-isolation concern is defense-in-depth, this one is a live leak.
2. **[HIGH] `plan-gate.ts` does not enforce its own verdict** — convert the `BLOCKED` verdict into an actual server-side gate (reject the downstream plan-progression call, not just report a status the client can ignore), and reconsider whether `PASS_WITH_ASSUMPTIONS` should silently backfill channel/budget/timeline/goal defaults versus requiring explicit confirmation.
3. **[HIGH] `goal-math.ts` divide-by-zero guards** — add `denominator > 0` checks (or clamp to a minimum) before all 4 identified division sites (L124, L125, L128, L130, L199) to prevent `Infinity`/`NaN` propagating into budget and lead-volume outputs shown to users.
4. **[HIGH] `audit-routes.ts` admin gating + error disclosure** — add an admin/role check appropriate to what each audit endpoint exposes, and replace `errorResponse`'s raw `err.message` passthrough (L78–80) with generic messages, matching the pattern already used correctly in `campaign-routes.ts`.
5. **[HIGH] `strategic-core/*` blueprint ownership** — add an explicit `accountId` predicate (or an `assertBlueprintBelongsTo` helper mirroring `assertCampaignBelongsTo`) to every `strategicBlueprints` lookup-by-`id` across `confirm-routes.ts`, `execution-routes.ts`, `extraction-routes.ts`, `gate-routes.ts`, `thinking-routes.ts`, `validation-routes.ts` — do not rely on UUID opacity as the authorization boundary.
6. **[HIGH] `conflict-resolver.ts` concurrency** — wrap `logAssumptions`/`detectImplicitAssumptions` in a transaction with an existence check + unique constraint (or reuse the optimistic-locking pattern already proven correct in `cas-helper.ts`) to prevent duplicate-assumption rows under concurrent writes.
7. **[MEDIUM] `diagnose/routes.ts` admin gate** — internal diagnostic fields (`validationState`, `planSource`, `signalOrigin` distribution, degradation reasons) should require an admin/operator check, not just campaign ownership, consistent with the "operator-grade panels gated behind `useOperatorSurface()`" doctrine already in place elsewhere in the app.
8. **[MEDIUM] Error disclosure cleanup** — replace remaining raw `err.message`/`error.message` client responses in `content-dna-routes.ts` (L406, L428), `strategy-routes.ts` (L471), `strategic-core/execution-routes.ts` (4 sites), `strategic-core/validation-routes.ts` (L231) with generic messages + server-side logging of the real error.
9. **[MEDIUM] Silent-catch remediation batch** — replace the 12+ bare/near-bare `catch {}` blocks identified across `campaign-data-layer.ts`, `strategy-root-routes.ts`, `goal-math.ts`, `conflict-resolver.ts`, `root-bundle.ts`, `ui-state-routes.ts`, `diagnose/routes.ts`, `strategic-core/audit-logger.ts` with logged failures (per the project's existing "NO SILENT CATCHES" doctrine — use `console.error("[Component] EVENT_TAG ...")` at minimum).
10. **[MEDIUM] `task-composer.ts` silent-empty-result sites** — distinguish "legitimately no tasks" from "composition failed" by returning an explicit error/degraded flag instead of an indistinguishable empty array in the 3 identified sites (L20, L167, L209).
11. **[LOW] Unbounded queries** — add `.limit()` to `campaign-data-layer.ts` `getCampaignMetrics`, `strategic-core/execution-routes.ts` (4 queries), and `strategic-core/gate-routes.ts` (2 queries) to bound growth as campaign history accumulates.

---

## D) Explicit Answers

**Q1: Can a user access or modify another account's campaign, strategy, or brand config?**

Campaign, business-data, content-DNA, brand-config, and autopilot routes are all correctly scoped by `accountId` — no cross-tenant access found there. However, there is **one confirmed leak**: `GET /api/strategy/signature-series` in `server/strategy-routes.ts` returns every active signature series in the system with no `accountId`/`campaignId` filter at all — any authenticated user can read (not modify) other accounts' signature series data. Separately, every route in `server/strategic-core/` (confirm, execution, extraction, gate, thinking, validation) looks up `strategicBlueprints` by `id` alone with no `accountId` check — this is not a confirmed exploit path (UUIDs aren't guessable), but it is not a real authorization boundary either, so it should not be treated as safe against a leaked/logged blueprint ID.

**Q2: Do any routes expose raw error details to non-admin users?**

Yes. Confirmed raw `err.message`/`error.message` passthrough to the HTTP client in: `audit-routes.ts` (`errorResponse` helper, 3 call sites), `content-dna-routes.ts` (2 sites), `strategy-routes.ts` (1 site), `strategic-core/execution-routes.ts` (4 sites), `strategic-core/validation-routes.ts` (1 site). None of these are gated to admins — they reach any authenticated caller who triggers the error path.

**Q3: Does `plan-gate.ts` correctly block unauthorized plan progression in all cases?**

No. It computes a `PASS` / `PASS_WITH_ASSUMPTIONS` / `BLOCKED` verdict correctly based on `overallScore` and business-data completeness, but the route only *returns* that verdict — it does not itself prevent the caller from proceeding with plan progression if the client-side or downstream logic ignores a `BLOCKED` result. Additionally, `PASS_WITH_ASSUMPTIONS` silently backfills several missing critical inputs (channel, goal target, timeline, budget) rather than requiring explicit user confirmation, which weakens the practical effect of the gate even when it does return `BLOCKED`-adjacent signals.
