/**
 * Validation-session loop guard — Task #68 / Phase 5 Step 6
 * (also targeted by Task #66 Phase 3; merged into Task #68 ownership).
 *
 * Owner: System Control (the verdict-and-loop authority layer). Prior to
 * Task #68 this lived in `server/engine-hardening/index.ts` next to
 * sanitization helpers, which violated single-owner doctrine: a loop guard
 * is a system-level enforcement primitive, not an engine-shape utility.
 *
 * Implementation moved here verbatim; `server/engine-hardening/index.ts`
 * re-exports `checkValidationSession` for back-compat (20+ call sites do
 * not need to be touched in this PR). New code MUST import from
 * `@/system-control/validation-session` directly. The engine-hardening
 * re-export is sunset-tracked in `replit.md` and removed in a follow-up
 * pass once all callers migrate.
 *
 * Doctrine alignment:
 *   - D2: validation-session ownership is now a single canonical concern.
 *   - D5: `allowed=false` returns a typed warning, never a silent block.
 *
 * Behavior is preserved bit-for-bit (5-minute TTL, 2-call ceiling per
 * engine per session) — ownership change only, no policy change.
 */

import type { ValidationSession } from "../engine-hardening/types";

const activeSessions = new Map<string, ValidationSession>();
const SESSION_TTL_MS = 5 * 60 * 1000;

// Phase 6 / Task #69 step 8 — eviction telemetry. Operator-visible counter
// for TTL-evicted validation sessions. A sustained zero with non-zero
// session creates indicates sessions never reach TTL (they finish first =
// healthy); a sustained spike indicates orchestrator runs are exceeding the
// 5-minute ceiling and silently being torn down mid-flight.
const _validationSessionEvictions = { ttl: 0 };
export function _getValidationSessionStats(): { active: number; ttlEvictions: number; ttlMs: number } {
  return { active: activeSessions.size, ttlEvictions: _validationSessionEvictions.ttl, ttlMs: SESSION_TTL_MS };
}

function cleanExpiredSessions(): void {
  const now = Date.now();
  for (const [key, session] of activeSessions.entries()) {
    if (now - session.createdAt > SESSION_TTL_MS) {
      activeSessions.delete(key);
      _validationSessionEvictions.ttl++;
    }
  }
}

/**
 * Returns `{ allowed: true }` when the engine may safely run inside the
 * validation session, or `{ allowed: false, warning }` when the per-session
 * per-engine ceiling has been reached (revalidation loop guard).
 *
 * `sessionId === undefined` is treated as "not inside a validation session"
 * and always returns `allowed: true`.
 */
export function checkValidationSession(
  sessionId: string | undefined,
  engineName: string,
  campaignId: string,
  maxCallsPerEngine: number = 2,
): { allowed: boolean; warning: string | null } {
  if (!sessionId) {
    return { allowed: true, warning: null };
  }

  cleanExpiredSessions();

  const key = `${sessionId}_${campaignId}`;
  let session = activeSessions.get(key);
  if (!session) {
    session = {
      sessionId,
      campaignId,
      engineCalls: {},
      createdAt: Date.now(),
    };
    activeSessions.set(key, session);
  }

  const currentCalls = session.engineCalls[engineName] || 0;
  if (currentCalls >= maxCallsPerEngine) {
    return {
      allowed: false,
      warning: `Revalidation loop detected: ${engineName} already called ${currentCalls} time(s) in session ${sessionId} — blocking to prevent infinite loop`,
    };
  }

  session.engineCalls[engineName] = currentCalls + 1;
  return { allowed: true, warning: null };
}

/** Test-only — reset the in-memory session map between scenarios. */
export function _resetValidationSessionsForTest(): void {
  activeSessions.clear();
}
