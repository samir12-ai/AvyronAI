# AI Layer Audit Report — Contract Registry + System Control + Memory System (34 Files)

Date: 2026-06-02
Scope: 34 files across contract-registry, system-control, system-integrity, memory-system, memory-mutation
Auditor: Manual code review + targeted grep
Mode: Findings only (no fixes)

---

## File Count

| Group | Files |
|---|---|
| Contract Registry (`server/orchestrator/contract-registry/`) | 7 |
| System Control (`server/system-control/`) | 17 |
| System Integrity (`server/system-integrity/`) | 3 |
| Memory System (`server/memory-system/`) | 8 |
| Memory Mutation (`server/memory-mutation/`) | 1 (engine.ts) |
| **Total** | **36 files reviewed** (34 requested + types/index siblings) |

---

## Overall Verdict: PASS (with minor findings)

This is the most hardened layer audited so far. Routes use **generic error messages** (no internal disclosure), all `JSON.parse` calls are **guarded**, queries are **limited or capped**, and doctrine D1/D3/D5 hold. The findings are LOW-severity hygiene items.

---

## Doctrine Check Summary

| Rule | Status | Notes |
|---|---|---|
| D1 (no semantic fallback) | PASS | All `?? `/`||` on canonical fields resolve to `null` (D5 sentinel), never a fabricated verdict. |
| D3 (strict z.enum) | PASS | No `z.string()` on verdict fields in any `types.ts`. Verdict unions are string-literal types. |
| D5 (CONTRACT_INCOMPLETE) | PASS | Missing canonical → `null`. `validationState ?? null`, `integrityVerdict ?? null` are explicit sentinels. |
| Internal error disclosure | PASS | All routes return generic strings ("Failed to fetch verdicts", etc.). Raw `err.message` only goes to `console.error`. |
| Unguarded JSON.parse | PASS | Every `JSON.parse` is wrapped in try/catch with a typed fallback. |
| Input validation on routes | PASS | `assertCampaignBelongsTo` ownership gate + `Math.min(parseInt(limit), 100)` cap. All GET, no body. |
| Silent catches | PASS (1 finding) | One true `catch {}` (system-judgement.ts:210). |
| No bare LLM calls | PASS | All `aiChat` calls carry `accountId` + `endpoint`; retries log `RETRY_FAILED`. |
| State finalization | PASS | Memory writes return typed `MemoryWriteResult`; mutation returns log entry id even on degraded skip. |

---

## Findings

### MEDIUM

**M1. MEDIUM** `server/system-control/system-judgement.ts:210` — **Silent catch**.
- `} catch {}` on the inner judge-retry `aiChat` call.
- If the second judge call (line 207) throws, the failure is swallowed; `verdict` keeps its prior value with no trace.
- Note: the OUTER retry catch (line 212) does log `RETRY_FAILED`, so this is partial coverage — but the inner judge call has no logging.
- Fix: Add `console.warn("[SystemJudgement] JUDGE_RETRY_FAILED | ...")`.

### LOW

**L1. LOW** `server/memory-mutation/engine.ts:374-385` — **Unbounded query**.
- `runMemoryMutation` selects all `strategyMemory` rows for the campaign with no `.limit()` (`.orderBy(desc(createdAt))` only).
- Campaign-scoped, so bounded in practice, but a campaign with thousands of memory rows loads them all into memory for in-process filtering/decay.
- Risk: Low — scoped by `(accountId, campaignId)`.

**L2. LOW** `server/memory-mutation/engine.ts:610-619` — **Unbounded query**.
- `getMemoryHealth` selects all `strategyMemory` rows for the campaign with no `.limit()`.
- Same pattern as L1 — campaign-scoped but unbounded.
- Risk: Low.

**L3. LOW** `server/system-control/structural-checks.ts:249` — `as any` on CEL result.
- `(c as any).passed === false || (c as any).overallPassed === false`.
- `celResults` is a polymorphic union (two possible result shapes). Cast bridges the shape difference. Not a canonical decision field, but reads a pass/fail discriminator.
- Fix: Optional — define a `ComplianceLike` union type with both `passed` and `overallPassed`.

**L4. LOW** `server/system-control/structural-checks.ts:364,625` — `as any` on engine output.
- Line 364: `(result.output as any)?._provenance` — provenance breadcrumb access.
- Line 625: `const output = offerResult.output as any | null` — offer engine output.
- These are polymorphic engine-result fields, same pattern as the orchestrator snapshot paths. Not canonical verdicts.

**L5. LOW** `server/system-control/repair-actions.ts:320-321,385-386` — `as any` on SSC mutation.
- `(ssc as any)._systemControlRepairs ??= []` then `.push(...)`.
- Attaches an audit-trail breadcrumb to the SSC. The field is not on the typed `SharedStrategicContext` interface, hence the cast. Non-canonical (audit metadata).
- Fix: Optional — add `_systemControlRepairs?` to the SSC type.

**L6. LOW** `server/system-control/routes.ts:293` — `as any[]` on stored verdict field.
- `const checks: any[] = (verdictRecord?.structuralChecks as any[]) || [];`
- `structuralChecks` is a JSON column deserialized to `any`. The `|| []` is a defensive default on an array (not a verdict), acceptable.
- Fix: Optional — type as `StructuralCheck[]`.

**L7. LOW** `server/system-control/full-report.ts:138` — `as any` on snapshot field.
- `(parseJson(snap.enemyDefinition, snap.enemyDefinition) as any)?.summary`.
- Deserialized JSON snapshot field; polymorphic. Non-canonical (display summary).

**L8. LOW** `server/orchestrator/contract-registry/helpers.ts:79` — `as any` in path walker.
- `cur = cur[seg as any]` inside `resolvePath`. `seg` is `string | number` indexing an `unknown`. The cast is structurally necessary for dynamic path resolution. Pure function, no canonical write.

**L9. LOW** `server/orchestrator/contract-registry/helpers.ts:412` — `as any` on provenance.
- `(result.output as any)?._provenance` — same provenance-access pattern as L4. Non-canonical.

**L10. LOW** `server/memory-system/manager.ts:205` — `as any` on Set membership.
- `NON_STRATEGIC_MEMORY_TYPES_SET.has(slot.memoryType as any)`.
- `slot.memoryType` is a narrower string-literal type than the Set's element type. Cast is benign (membership test only).

### DOCUMENTED / NON-VIOLATIONS (verified, not findings)

**N1.** `server/system-control/full-report.ts:302` — `validationState: result?.validationState ?? null`.
- `?? null` is the D5 CONTRACT_INCOMPLETE sentinel, NOT a semantic substitution. **Compliant.**

**N2.** `server/system-control/structural-checks.ts:567` — `output?.validationState ?? output?.result?.validationState ?? null`.
- Reads the canonical field from two known shape locations, then falls to `null`. No fabricated verdict. **Compliant.**

**N3.** `server/system-control/validation-verdict.ts:87` — `input.integrityVerdict ?? null`.
- `?? null` sentinel. **Compliant.**

**N4.** Guarded JSON.parse helpers — all verified inside try/catch with typed fallback:
- `full-report.ts:43` `parseJsonField` → `catch { return fallback }`
- `routes.ts:45` `parseJsonField` → `catch { return fallback }`
- `recovery-intelligence.ts:450` `safeJsonParse` → `catch { return null }`
- `system-judgement.ts:149` `safeJson` → `catch { return null }`
- `memory-mutation/engine.ts:331` → `catch` logs `SNAPSHOT_PARSE_FAILED` then breaks.
- **All compliant — no unguarded JSON.parse in this layer.**

**N5.** `server/orchestrator/contract-registry/audit.ts` — Contract audit "must NEVER throw" by design; internal exceptions caught and logged as `AUDIT_INTERNAL_ERROR`. This is intentional fail-open for a shadow-phase observer (`ENFORCE_ENGINE_CONTRACTS=false` default). **Compliant with B5 (continuity).**

---

## Route Hardening Assessment

| Route | Ownership Gate | Limit Cap | Error Disclosure | Verdict |
|---|---|---|---|---|
| `GET /api/system-control/verdicts/:campaignId` | `assertCampaignBelongsTo` | `Math.min(limit, 100)` | Generic | PASS |
| `GET /api/system-control/latest/:campaignId` | `assertCampaignBelongsTo` | `.limit(1)` | Generic | PASS |
| `GET /api/system-control/stats/:campaignId` | `assertCampaignBelongsTo` | `.limit(100)` | Generic | PASS |
| `GET /api/system-control/recovery/:campaignId` | `assertCampaignBelongsTo` | `.limit(1)` | Generic | PASS |
| `GET /api/system-control/run-truthfulness/:campaignId` | `assertCampaignBelongsTo` | `.limit(1)` | Generic | PASS |
| `GET /api/system-integrity/:campaignId` | `assertCampaignBelongsTo` + per-tenant cache key | in-memory Map | Generic (`INTERNAL_ERROR`) | PASS |

All routes:
- Use `authMiddleware` + `resolveAccountId(req)`.
- Use `handleOwnershipError` to return 404 (not 403) — prevents campaign-ID existence probing (documented at system-integrity/routes.ts:24).
- Log raw error to `console.error`, return generic message to client.

---

## State Finalization Assessment

| File | Pattern | Verdict |
|---|---|---|
| `memory-system/store.ts` | `upsertByFingerprint` returns typed `MemoryWriteResult` (allowed/rowId/reason). Policy + planId + contradiction gates all return explicit reasons. | PASS |
| `memory-mutation/engine.ts` | Degradation guard returns `logEntryId: "degraded-skip"` on skip; mutation always returns a summary + log id. Scrape-health parse failures logged. | PASS |
| `system-control/system-judgement.ts` | Retry loop logs `RETRY_FAILED`; final `REJECTED` returns `null` (D5). | PASS (1 inner silent catch — M1) |
| `system-control/recovery-intelligence.ts` | `safeJsonParse` returns `null`; LLM disease parse validated against `VALID_DISEASES` allowlist. | PASS |
| `contract-registry/audit.ts` | Never throws — fail-open shadow observer by design. | PASS |
| `system-integrity/routes.ts` | `if (!res.headersSent)` guard before 500 — prevents double-send hang. | PASS |

---

## Cross-Group Comparison

| Group | Files | Silent Catches | Unguarded JSON.parse | Internal Error Disclosure | Unbounded Queries | as any (canonical) | D1/D3/D5 |
|---|---|---|---|---|---|---|---|
| Contract Registry | 7 | 0 | 0 | n/a (no routes) | 0 | 0 | PASS |
| System Control | 17 | 1 | 0 | 0 | 0 | 0 | PASS |
| System Integrity | 3 | 0 | 0 | 0 | 0 (in-memory Map) | 0 | PASS |
| Memory System | 8 | 0 | 0 | n/a (no routes) | 0 | 0 | PASS |
| Memory Mutation | 1 | 0 | 0 | n/a | 2 | 0 | PASS |

---

## Recommendations

1. **Add logging to inner judge-retry catch** (M1) — `system-judgement.ts:210` should log `JUDGE_RETRY_FAILED` for parity with the outer retry catch.
2. **Add `.limit()` to memory-mutation reads** (L1, L2) — `runMemoryMutation` and `getMemoryHealth` load all campaign memory rows; cap or paginate for very large campaigns.
3. **Optional typing improvements** (L3-L10) — define union/interface types for polymorphic engine outputs (`ComplianceLike`, `_provenance`, `_systemControlRepairs`) to retire the `as any` casts. None affect canonical decisions.

---

*Report generated by manual code review + targeted grep across 34 requested files. No critical or high-severity findings. This layer is notably more hardened than the orchestrator routes layer (zero internal error disclosure, zero unguarded JSON.parse).*
