/**
 * Phase 3 (Task #66) — Canonical integrity-verdict boundary helper.
 *
 * D2 + D5 doctrine: every read of the integrity verdict on a live
 * decision path MUST resolve through this helper. The contract-registry
 * entry `INTEGRITY_CONTRACT.integrityVerdict` is the canonical field
 * name (`z.enum(["PASS","PARTIAL","FAIL"])`); `overallStatus` is a
 * legacy field retained for FE back-compat (per registry's
 * `legacyPaths`). D4 forbids legacy fields from satisfying verdict
 * contracts, so this helper reads `integrityVerdict` ONLY — if the
 * canonical field is absent, the result is `CONTRACT_INCOMPLETE`, never
 * a silent fallback to `overallStatus`.
 *
 * Why a sibling helper instead of `requireContractField`:
 *   `requireContractField` expects a `Map<EngineId, EngineStepResult>`
 *   (the orchestrator's per-job result aggregate). `IntegrityReport` is
 *   passed to system-control as a flat typed object on
 *   `SystemControlInput.integrityReport`, not embedded in that Map. The
 *   sibling helper enforces the SAME contract semantics (canonical
 *   field name, enum validation, INCOMPLETE on miss) against the typed
 *   object surface — fully consistent with D2/D5.
 *
 * Authority: system-control is the SOLE owner of integrity-verdict
 * downgrade/block decisions. Other modules consume the helper's typed
 * result; they MUST NOT redefine the {PASS|PARTIAL|FAIL} enum locally
 * or branch on legacy field names.
 */

import type { IntegrityReport } from "../system-integrity/types";

export type IntegrityVerdict = "PASS" | "PARTIAL" | "FAIL";

export type IntegrityVerdictResult =
  | { status: "OK"; value: IntegrityVerdict }
  | { status: "INCOMPLETE"; reason: string };

const ALLOWED_VERDICTS: readonly IntegrityVerdict[] = ["PASS", "PARTIAL", "FAIL"];

/**
 * Canonical boundary read for `integrityVerdict`. Returns a discriminated
 * union — callers MUST handle every branch (D5: no silent substitution).
 *
 * Resolution order (D4 — legacy field MAY NOT satisfy the contract):
 *   1. `report.integrityVerdict` — canonical field per
 *      INTEGRITY_CONTRACT in `server/orchestrator/contract-registry/registry.ts`.
 *   2. Otherwise → `INCOMPLETE`. The legacy `report.overallStatus` is
 *      NOT consulted for verdict satisfaction.
 *
 * `INCOMPLETE` is also returned when:
 *   - `report` is null/undefined (no integrity run available)
 *   - `report.integrityVerdict` is present but not a member of the
 *     canonical enum {PASS|PARTIAL|FAIL}
 *
 * On `INCOMPLETE`, live reasoning MUST be blocked at the call site (the
 * upstream collector — `collectBlockReasons`, structural-check writer, or
 * contradiction detector — is responsible for translating that into the
 * correct verdict shape for its surface).
 */
export function requireIntegrityVerdict(
  report: IntegrityReport | null | undefined,
): IntegrityVerdictResult {
  if (!report) {
    return { status: "INCOMPLETE", reason: "integrity_report_missing" };
  }
  // D4: read the canonical field name only. The integrity engine writes
  // both fields during the transition window (see integrity-engine/engine.ts
  // line 742 — `integrityVerdict: overallStatus`), so this is a behavior
  // change only for reports that omit the canonical field, which is the
  // exact INCOMPLETE case the contract requires us to flag.
  const raw = (report as { integrityVerdict?: unknown }).integrityVerdict;
  if (typeof raw !== "string") {
    return { status: "INCOMPLETE", reason: "integrity_verdict_canonical_field_missing" };
  }
  if (!ALLOWED_VERDICTS.includes(raw as IntegrityVerdict)) {
    return { status: "INCOMPLETE", reason: `integrity_verdict_out_of_enum:${raw}` };
  }
  return { status: "OK", value: raw as IntegrityVerdict };
}

/**
 * Convenience predicate built atop `requireIntegrityVerdict`. Returns
 * `true` ONLY when the verdict resolves to the supplied value. A
 * `CONTRACT_INCOMPLETE` resolution returns `false` — never silently
 * promoted to a match. Callers that need the asymmetry "is-not-FAIL"
 * MUST use the explicit form via `requireIntegrityVerdict` so the
 * INCOMPLETE branch is visible at the site.
 */
export function integrityVerdictEquals(
  report: IntegrityReport | null | undefined,
  expected: IntegrityVerdict,
): boolean {
  const r = requireIntegrityVerdict(report);
  return r.status === "OK" && r.value === expected;
}
