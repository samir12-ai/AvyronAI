/**
 * Task #71 / Phase 8 — Unified operator-surface gate.
 *
 * Consolidates the four independent `*Enabled()` predicates that previously
 * each re-derived the same `EXPO_PUBLIC_METRICS_ADMIN_TOKEN` check:
 *   - continuityPanelEnabled()  (hooks/useContinuityPanel.ts)
 *   - operationsPanelEnabled()  (hooks/useOperationsPanel.ts)
 *   - operatorNoticesEnabled()  (hooks/useOperatorNotices.ts)
 *   - (implicit gate on Market DB / Orchestrator / Signal Flow / AEL Debug /
 *      System Integrity panels — previously ungated)
 *
 * Doctrine notes:
 *   D2 — raw `process.env.EXPO_PUBLIC_METRICS_ADMIN_TOKEN` stays the canonical
 *        source of truth; this hook only exposes a derived boolean.
 *   D5 — no silent coercion: when the env var is unset OR empty string, the
 *        surface is `false`. There is no "probably operator" inference path.
 *
 * Customer builds DO NOT ship with this env var set, so the entire operator
 * surface (5 admin panels + 3 admin-token query hooks) self-disables.
 */

function readAdminToken(): string | null {
  const raw = process.env.EXPO_PUBLIC_METRICS_ADMIN_TOKEN;
  return typeof raw === "string" && raw.length > 0 ? raw : null;
}

/**
 * Single canonical predicate for "is this an operator build?". The four
 * legacy `*Enabled()` helpers now delegate here so a future change to the
 * gating rule has exactly one site to update.
 */
export function isOperatorSurfaceEnabled(): boolean {
  return readAdminToken() !== null;
}

/**
 * Hook-shaped wrapper for components that want to gate JSX. Returning an
 * object (not a bare boolean) leaves room to surface the token itself or
 * additional capability flags in a later seal without breaking call sites.
 */
export function useOperatorSurface(): { enabled: boolean } {
  return { enabled: isOperatorSurfaceEnabled() };
}
