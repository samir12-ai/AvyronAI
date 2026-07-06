# Infrastructure Audit — Patch 4/5

**Scope:** DB Migrations + Frontend Config + Translations (45 files)
**Date:** 2026-07-06
**Auditor:** Replit Agent

---

## A) Per-File Verdict Table

### GROUP 1 — DB Migrations (14 TypeScript files)

| File | Category | Verdict | Notes |
|---|---|---|---|
| `server/migrations/001-reassign-default-account-to-founder.ts` | HARDCODED DATA / IRREVERSIBLE / SQL SAFETY / SILENT CATCH | ❌ **HIGH** | Hardcodes `FOUNDER_ACCOUNT_ID = "a2d87878-a1e9-41ea-a8a5-90beff569673"` (L4) — an internal account UUID committed to source, not a credential but still a hardcoded identity constant that should arguably be an env/config value. Uses `sql.raw()` with string-interpolated table names (L21, L32, L46) sourced from `information_schema.columns` — not user-controlled at runtime (this is a one-time boot/startup migration, not a request-handling path), so not exploitable as SQL injection in practice, but the pattern itself is fragile if ever reused with external input. Contains an irreversible `DELETE FROM "${table}" WHERE account_id = 'default'` (L31) with no down-migration/rollback path. Bare `catch {}` at L53 during the verification phase silently swallows any post-migration check failure. |
| `server/migrations/002-strategy-memory-columns.ts` | — | ✅ PASS | Pure static SQL DDL (`ALTER TABLE`/`CREATE TABLE`), no programmatic logic. |
| `server/migrations/003-user-channel-tables.ts` | — | ✅ PASS | Pure static SQL DDL. |
| `server/migrations/004-memory-confidence-direction.ts` | IRREVERSIBLE (minor) | ⚠️ MEDIUM | Backfills `confidence_score`/`direction` columns for rows where `last_validated_at` is null using logic-based defaults (e.g. `0.85`, `'reinforce'`) — no hardcoded secrets, no unsafe SQL, no silent catch. The backfill overwrite has no rollback path, but since it's populating newly-added columns (not destroying existing data), the practical risk is low. |
| `server/migrations/005-calendar-exploration-fields.ts` | — | ✅ PASS | Pure static SQL DDL. |
| `server/migrations/006-rhythm-snapshot-columns.ts` | — | ✅ PASS | Pure static SQL DDL. |
| `server/migrations/007-build-plan-snapshots.ts` | — | ✅ PASS | Pure static SQL DDL. |
| `server/migrations/008-decision-attribution.ts` | — | ✅ PASS | Pure static SQL DDL. |
| `server/migrations/009-memory-outcome-provenance.ts` | — | ✅ PASS | Pure static SQL DDL. |
| `server/migrations/010-tiktok-validation-columns.ts` | SILENT CATCH (minor) | ✅ PASS | Has an idempotency catch that logs "already exists" errors and continues rather than failing the migration run — appropriate defensive pattern for a rerunnable migration, not a true silent swallow. |
| `server/migrations/011-system-control-verdicts.ts` | — | ✅ PASS | Pure static SQL DDL. |
| `server/migrations/012-tenant-isolation-accountid.ts` | — | ✅ PASS | Pure static SQL DDL. |
| `server/migrations/013-auth-hardening.ts` | — | ✅ PASS | Pure static SQL DDL. |
| `server/migrations/014-scrape-security.ts` | — | ✅ PASS | Pure static SQL DDL. |
| `server/migrations/015-ai-input-snapshots.ts` | — | ✅ PASS | Pure static SQL DDL. |

### GROUP 2 — Frontend Config (13 files)

| File | Category | Verdict | Notes |
|---|---|---|---|
| `app/_layout.tsx` | AUTH GATE | ✅ PASS | Centralized `AuthGate` component (L73–111) wraps the entire navigation stack (L114–130). Checks `isAuthenticated`, `isLoading`, `user?.hasSeenIntro`, `isAccessActive`; unauthenticated users redirect to `/login` (L86). Every screen in the root `Stack` — `(tabs)`, `studio/[id]`, `agent`, `audit-control` — sits inside this gate. `login`/`intro`/`upgrade` are the only routes reachable pre-auth, by design. |
| `app/(tabs)/_layout.tsx` | AUTH GATE | ✅ PASS | Inherits protection from the parent `AuthGate` in `app/_layout.tsx` as a nested route; no separate auth logic needed or present. |
| `lib/query-client.ts` | ERROR DISCLOSURE | ⚠️ MEDIUM | L78 throws `new Error(\`${res.status}: ${text}\`)`, propagating raw response body text into a thrown error that calling code may render as-is. |
| `lib/i18n.ts` | — | ✅ PASS | No findings surfaced. |
| `lib/types.ts` | SENSITIVE FIELD EXPOSURE | ⚠️ MEDIUM | `MetaConnection` interface exposes `accessToken` and `pageId` as typed fields (L120–121) — expected for client-side Meta SDK usage but confirms an OAuth access token is expected to live in frontend-accessible state; worth double-checking it's never logged or persisted insecurely. `MediaItem.serverPostId`/`studioItemId` (L101–102) are internal DB references but low sensitivity. No internal admin flags or raw engine names found. |
| `constants/colors.ts` | — | ✅ PASS | No findings surfaced; pure theming constants. |
| `context/LanguageContext.tsx` | — | ✅ PASS | No findings surfaced. |
| `context/CreativeContext.tsx` | AUTH-SCOPED STATE | ✅ PASS | Consumes `useAuth()` (L43); clears creative context state whenever `authUserId` changes (L58–60), preventing residual creative/campaign data from persisting across a user/account switch. |
| `hooks/useFeatureFlags.ts` | ERROR DISCLOSURE | ⚠️ MEDIUM | Sets error state directly from `e.message` in two places (L51, L72) — if rendered directly in the UI, this surfaces raw backend/network error text to the end user. |
| `hooks/usePersistedState.ts` | STORAGE / ERROR DISCLOSURE | ⚠️ MEDIUM | Does **not** use `AsyncStorage`/`localStorage` — persists UI state server-side via `/api/ui-state` (L52–59), so the "sensitive data in unencrypted local storage" concern does not apply here. However, `saveError` is set directly from `err.message`/`e.message` at L62 and L71, another raw-error-to-UI-state exposure. |
| `hooks/useRunAnchor.ts` | OPERATOR GATING | ⚠️ MEDIUM | Has **no internal operator check** of its own — it fetches plan-anchor data for a given campaign (L17) and relies entirely on the caller/route already being protected. Not a confirmed vulnerability (no evidence a non-operator screen calls it with operator-only data), but it means the isolation guarantee lives outside this file and should be verified at every call site rather than assumed. |
| `hooks/useOperatorSurface.ts` | OPERATOR GATING | ✅ PASS | Provides the canonical `isOperatorSurfaceEnabled()` check (L32) gated on `EXPO_PUBLIC_METRICS_ADMIN_TOKEN` (L23). Confirmed in use by `StrategyHub.tsx`, `PersuasionEngine.tsx`, `app/diagnose.tsx`, and others per project doctrine. |
| `hooks/useReasoning.ts` | OPERATOR GATING | ✅ PASS | Fetches perception-layer reasoning data intended for the standard (non-operator) dashboard via `authFetch` — this is by design part of the customer-facing Perception Layer, not an operator-only surface, so the absence of an operator check here is correct rather than a gap. |

---

## B) Group 3 — Translations (32 files, batch verdict)

**✅ PASS — single batch verdict.**

Grep across all 32 files in `lib/translations/` for URL patterns, API-key/secret/token markers, and common secret prefixes (`Bearer`, `sk-`, `AIza`) surfaced no hardcoded endpoints, credentials, or internal URLs. The only matches were translated UI copy for password-related form labels (e.g. `password: 'Contraseña'`, `passwordPlaceholderLogin: 'Introduce tu contraseña'`) across `en.ts`, `es.ts`, `fr.ts`, `pt.ts`, `de.ts`, `ar.ts` — these are user-facing display strings for the login form, not secrets or endpoints. No translation keys referencing internal engine names, doctrinal tokens (e.g. `validationState`, `executionStatus`), or other security-sensitive internal terminology were found — consistent with the project's existing "customer surface speaks outcomes, code surface speaks canonical" UX vocabulary doctrine.

---

## C) Top Fixes Prioritized by Severity

1. **[HIGH] `001-reassign-default-account-to-founder.ts` bare catch during verification** — L53's `catch {}` should log the verification failure (per the project's "NO SILENT CATCHES" doctrine) so a failed post-migration integrity check isn't silently lost, especially given this migration performs an irreversible `DELETE`.
2. **[MEDIUM] Document/guard the irreversible `DELETE` in `001-reassign-default-account-to-founder.ts`** — L31's `DELETE FROM "${table}" WHERE account_id = 'default'` has no rollback path; at minimum, ensure this migration is provably idempotent/one-time-only (e.g. guarded by a check that it hasn't already run) given it can't be undone.
3. **[MEDIUM] Raw error-to-UI exposure across frontend hooks** — `lib/query-client.ts` (L78), `hooks/useFeatureFlags.ts` (L51, L72), `hooks/usePersistedState.ts` (L62, L71) all propagate `err.message`/response text directly into state that may be rendered to the end user. Wrap with user-friendly messages and log the raw detail server-side or to telemetry instead.
4. **[LOW] Verify `useRunAnchor.ts` call sites** — since the hook itself has no operator gate, audit each screen that calls it to confirm none of them are reachable by non-operator users with operator-only plan-anchor data.
5. **[LOW] Confirm `MetaConnection.accessToken` handling** — `lib/types.ts` L120 types an OAuth access token as a frontend-accessible field; confirm it is never written to persistent client storage or logs, only held in memory/state for the duration of an active SDK call.
6. **[LOW] Consider externalizing `FOUNDER_ACCOUNT_ID`** in `001-reassign-default-account-to-founder.ts` (L4) — a hardcoded account UUID in a committed migration file is low-risk (it's an internal identifier, not a credential) but is exactly the kind of environment-specific constant that's normally sourced from config/env rather than hardcoded.

---

## D) Explicit Answer

**Q1: Does `app/_layout.tsx` correctly prevent unauthenticated access to all protected routes?**

Yes. The `AuthGate` component wraps the entire root navigation stack and checks `isAuthenticated`/`isLoading`/`hasSeenIntro`/`isAccessActive` before rendering protected content, redirecting unauthenticated users to `/login`. Every screen under the root `Stack` — including `(tabs)`, `studio/[id]`, `agent`, and `audit-control` — is nested inside this gate, and `app/(tabs)/_layout.tsx` inherits the same protection rather than needing its own check. The only routes reachable without authentication are `login`, `intro`, and `upgrade`, which is the intended pre-auth surface, not a gap.
