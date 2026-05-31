# AI Layer Audit Report

Date: 2026-05-24
Scope: 12 files across AI Client, Narrative Layer, AI Overlay Pipeline, and Audience Engine LLM files
Auditor: Manual code review + architect subagent verification

---

## Files Audited

- `server/ai-client.ts` (524 lines)
- `server/narrative-layer.ts` (536 lines)
- `server/pipeline/ai-overlay/client.ts` (200 lines)
- `server/pipeline/ai-overlay/assemble.ts` (181 lines)
- `server/pipeline/ai-overlay/competitor.ts` (191 lines)
- `server/pipeline/ai-overlay/dna.ts` (143 lines)
- `server/pipeline/ai-overlay/explanation.ts` (94 lines)
- `server/pipeline/ai-overlay/q2-reasoning.ts` (248 lines)
- `server/pipeline/ai-overlay/types.ts` (53 lines)
- `server/pipeline/ai-overlay/user-interpretation.ts` (153 lines)
- `server/audience-engine/sophistication-llm.ts` (227 lines)
- `server/audience-engine/buyer-psychology.ts` (365 lines)

---

## Overall Verdict: PASS (with noted gaps)

The AI layer is well-architected with centralized client, budget enforcement, replay recording, and strict-mock interception. The AI Overlay pipeline is particularly well-designed with fail-closed validation, deterministic parameters, and clear separation from policy paths. However, there are gaps in Zod validation, narrative layer error handling, and engine-level LLM response validation.

---

## AI Client (`server/ai-client.ts`) — Centralized Architecture

| Question | Answer |
|---|---|
| **Which AI model?** | Dual-provider: OpenAI (GPT-4.1, GPT-4o, GPT-4o-mini, GPT-5) + Google Gemini (1.5 Pro, 1.5 Flash, 2.0 Flash, 2.5 Flash) |
| **Configurable per call?** | Yes — every caller passes `model` string. `PRIMARY_CHAT_MODEL = "gpt-4.1"` is the default. |
| **Timeouts?** | OpenAI: `HARD_TIMEOUT_MS = 45s` (client-level). Gemini: `AI_GEMINI_HARD_TIMEOUT_MS` env var (default 60s) with `AbortController` + `Promise.race` (Seal #16). |
| **Response validation?** | No — `aiChat` returns raw `ChatCompletion`. Validation is caller's responsibility. |
| **Bare LLM calls?** | None — all calls go through `aiChat`/`aiGemini`. |
| **Token limits?** | `DEFAULT_MAX_TOKENS = 800`. Per-call callers set `max_tokens`. Budget enforcement caps weekly spend at 500K tokens. |
| **Error handling?** | `AICallError` with codes: `AI_TIMEOUT`, `AI_BUDGET_EXCEEDED`, `AI_CALL_FAILED`, `MISSING_MAX_TOKENS`. Budget reconciliation in `finally` block. |

**Key strengths:**
- Budget enforcement via `pg_advisory_lock` + weekly token quota
- Cost estimation per model (`MODEL_COST_USD_PER_1K_TOKENS`)
- Replay cassette integration (`recordReplayLlmCall`) for deterministic testing
- Strict-mock short-circuit for hermetic replay runs
- Operations Guardian outcome recording (`recordAICallOutcome`)

**Notable gaps:**
- `catch {}` on budget reconciliation (`ai-client.ts:261`) — silent failure
- `catch {}` on `getWeeklyTokenUsage` (`ai-client.ts:520`) — silent failure
- `as any` cast on `response_format` and `payload` in `aiChat` call

---

## Narrative Layer (`server/narrative-layer.ts`)

| Question | Answer |
|---|---|
| **Which AI model?** | `gpt-4o-mini` (hardcoded at line 404) |
| **Configurable per call?** | No — hardcoded. Env flag `EXPO_PUBLIC_NARRATIVE_LLM_V2` only toggles on/off. |
| **Timeouts?** | Inherits `aiChat` default (45s). No per-call override. |
| **Response validation?** | Manual grounding gate (4 checks: keys present, quoted strings anchored, capitalized runs anchored, single-cap mid-sentence anchored). No Zod. |
| **Bare LLM calls?** | None — goes through `aiChat`. |
| **Token limits?** | `max_tokens: 600` |
| **Error handling?** | `try/catch` around LLM call — falls back to template mode (`llm_v2_failed_template_fallback`) on any error. |

**Key strengths:**
- Grounding gate rejects hallucinated territories/mechanisms (CLP-02 / P1)
- `oneLiner` is ALWAYS synthesized from validated steps — model's free-text headline discarded
- Template fallback is safe (never returns empty)
- `narrativeMode` field tracks which path produced the output

**Notable gaps:**
- `safeP` helper (`narrative-layer.ts:40`) has bare `catch` — silent parse failure
- `JSON.parse` at line 414 has no try/catch — unhandled exception if LLM returns non-JSON
- `.catch(() => [])` on DB queries (lines 152, 162, 173, 184, 195) — silent failures
- `catch {}` on AEL snapshot read (line 213) — completely silent

---

## AI Overlay Pipeline (`server/pipeline/ai-overlay/`)

| Question | Answer |
|---|---|
| **Which AI model?** | `PRIMARY_CHAT_MODEL` (`gpt-4.1`) — hardcoded in `client.ts` |
| **Configurable per call?** | No — all overlays use the same model. Only `maxTokens` varies per overlay. |
| **Timeouts?** | `DEFAULT_TIMEOUT_MS = 20s` (hardcoded in `client.ts`) |
| **Response validation?** | Yes — every overlay supplies a `validate(parsed)` function. Returns `null` on schema violation → `error` envelope. |
| **Bare LLM calls?** | None — all go through `runOverlay` → `aiChat`. |
| **Token limits?** | Varies by overlay: explanation=500, dna=600, user-interpretation=700, q2-reasoning=700, competitor=800 |
| **Error handling?** | `runOverlay` catches ALL errors and returns `error` envelope with reason code. Never throws. |

**Key strengths:**
- `runOverlay` is a fail-closed wrapper: any failure → `error` envelope, rule-based output continues unchanged
- Deterministic params: `temperature=0`, `seed=7`, `response_format={type:"json_object"}`
- Traceability: every envelope carries model_id, prompt_version, prompt_fingerprint, response_fingerprint, latency_ms
- Default-disabled: `PIPELINE_AI_OVERLAY_ENABLED` env flag must be `"true"`
- Strict validation in every overlay: type guards, enum checks, length limits, forbidden-pattern regexes
- `q2-reasoning` overlay has advanced validation: forbidden scoring language, forbidden recommendation language, theme token allowlist, reason code allowlist

**Notable gaps:**
- `parsed as any` / `parsed as Record<string, unknown>` in every validator — type safety bypassed
- `validate` functions return `null` on failure but the caller doesn't distinguish between "parse failed" vs "schema invalid" — both map to `error` envelope
- No Zod schemas — all validation is manual type guards

---

## Engine LLM Calls (Audience Engine)

### Sophistication LLM (`server/audience-engine/sophistication-llm.ts`)

| Question | Answer |
|---|---|
| **Model** | `gpt-4.1-mini` (hardcoded) |
| **Token limit** | `max_tokens: 2200` |
| **Temperature** | `0.2` |
| **Validation** | Manual type guards after `JSON.parse`. No Zod. |
| **Error handling** | Falls back to `FALLBACK_TIER = 2` on any error. Logs with `console.error`. |

**Notable gaps:**
- `JSON.parse` on LLM response (line ~180) with no try/catch — unhandled exception possible
- `parsed as any` in validation — type safety bypassed
- No grounding gate — LLM could invent tiers or evidence

### Buyer Psychology (`server/audience-engine/buyer-psychology.ts`)

| Question | Answer |
|---|---|
| **Model** | `gpt-4.1-mini` (hardcoded) |
| **Token limit** | Designer: 1800, Judge: 400 |
| **Temperature** | Designer: 0.3, Judge: 0.1, Retry: 0.25 |
| **Validation** | Designer output parsed with `JSON.parse`. Hostile judge validates structure. Manual type guards. No Zod. |
| **Error handling** | Returns `null` on failure → engine continues with legacy output. Safe fallback. |

**Notable gaps:**
- `JSON.parse` on designer output (line 220) with no try/catch
- `parsed as any` in validation
- `judgeVerdict` typed as `"ACCEPTED" | "REJECTED" | "NOT_RUN"` but validated via string comparison, not strict enum

---

## AI Call Footprint Summary

| Module | Model | Tokens | Temp | Timeout | Validation | Notes |
|---|---|---|---|---|---|---|
| ai-client (default) | Caller-defined | 800 | Caller-defined | 45s | None | Budget enforcement, replay, mock |
| ai-overlay (all) | gpt-4.1 | 500-800 | 0 | 20s | Manual type guards | Fail-closed envelopes |
| narrative-layer | gpt-4o-mini | 600 | 0.4 | 45s | Grounding gate (4 checks) | Template fallback on failure |
| sophistication-llm | gpt-4.1-mini | 2200 | 0.2 | 45s | Manual type guards | Tier fallback on failure |
| buyer-psychology | gpt-4.1-mini | 1800/400 | 0.3/0.1 | 45s | Designer + Judge | Returns null on failure |
| positioning engine | Caller-defined | Varies | Varies | 45s | Varies | See engine audit |
| differentiation engine | Caller-defined | Varies | Varies | 45s | Varies | See engine audit |
| mechanism engine | Caller-defined | Varies | Varies | 45s | Varies | See engine audit |
| offer engine | Caller-defined | Varies | Varies | 45s | Varies | See engine audit |

---

## System Type: Manual Code System

The AI system is **manual code**, not an autonomous AI system. Key evidence:

1. **Explicit design principle**: Every overlay module is locked with a comment: *"AI improves understanding. The system still owns the decision."* (Samir 2026-04-23)
2. **No AI-driven policy**: The boss verdict path is explicitly forbidden from importing AI overlay modules. Verdicts are rule-based.
3. **Fail-closed architecture**: AI overlays return `error` envelopes on failure; rule-based output continues unchanged.
4. **Deterministic parameters**: `temperature=0`, `seed=7`, `json_object` format — all designed for reproducibility, not creativity.
5. **Validation gates**: Every overlay has a `validate()` function that rejects non-conforming output.
6. **Grounding enforcement**: Narrative layer has a 4-check grounding gate that rejects hallucinated territories/mechanisms.
7. **Budget enforcement**: Per-account weekly token quotas with `pg_advisory_lock`.

The AI is used as a **semantic enricher** (translation, explanation, interpretation) on top of rule-based engine outputs. It never makes decisions, never changes verdicts, and never writes to operational state.

---

## AI Layer Doctrine Check Summary

| Rule | Status |
|---|---|
| D1 (no semantic fallback) | OK — AI overlays never fallback on canonical fields |
| D2/D3 (canonical fields, strict enums) | OK — `AIOverlayStatus` is strict enum (`ok|disabled|error`) |
| D5 (CONTRACT_INCOMPLETE) | OK — no direct fallback on canonical fields |
| No silent catches | **FAIL** — `safeP` bare catch, narrative layer DB `.catch(()=>[])`, `catch {}` on AEL read |
| No bare LLM calls | OK — all calls through `aiChat`/`aiGemini` |
| Evidence Integrity Filter | OK — grounding gate + validation functions enforce evidence anchoring |
| B1-B5 beta safety | OK — truthfulness prioritized (grounding gate rejects hallucinations), visibility good (error envelopes), safe degradation (template fallback) |

---

## AI Layer Recommendations

1. **Add Zod schemas to all AI overlay validators** — replace manual type guards with structured schemas. This is the single highest-ROI improvement for the AI layer.
2. **Fix `safeP` bare catch** — replace with `console.error("[NarrativeLayer] JSON_PARSE_FAILED", err)`.
3. **Fix narrative layer DB query `.catch(()=>[])`** — at minimum log the error; better: propagate as degraded mode.
4. **Add `try/catch` around `JSON.parse` in narrative layer** — currently unhandled at line 414.
5. **Add `try/catch` around `JSON.parse` in sophistication-llm** — currently unhandled.
6. **Add `try/catch` around `JSON.parse` in buyer-psychology** — currently unhandled.
7. **Consider model registry** — hardcoded model names (`gpt-4.1-mini`, `gpt-4o-mini`) scattered across files. Centralize in `ai-client.ts` or a config file.
