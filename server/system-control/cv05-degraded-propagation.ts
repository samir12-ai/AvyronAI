/**
 * Phase 3 (Task #66) — CV-05 degraded-propagation auditor.
 *
 * Doctrine: every degraded/partial source (AEL partial, integrity
 * PARTIAL, confidence-integrity DEGRADED, signal-lineage unknown
 * dominant, MI snapshot stale/rejected) MUST reach the
 * `SystemControlVerdict` either as a `Downgrade` row or as a `BlockReason`.
 * A degraded source that surfaces NEITHER is a silent-degradation
 * regression — the operator can't see it and downstream consumers may
 * treat the run as healthy.
 *
 * This auditor runs at the end of `evaluateSystemControl()` and emits a
 * single `[CV-05]` log line whenever a known degraded source is detected
 * upstream of system-control but produced no verdict-surface row. It
 * does NOT mutate the verdict — it only surfaces drift so a future
 * tightening can be tracked from real failures, not from theory.
 *
 * Operator signal — steady-state expectation = absent. Appearance of
 * `[CV-05] DEGRADED_NOT_PROPAGATED` is the alarm.
 */

import type { SystemControlInput, SystemControlVerdict } from "./types";
import { requireIntegrityVerdict } from "./integrity-verdict";

export interface Cv05AuditFinding {
  source:
    | "integrity_partial"
    | "ael_partial"
    | "confidence_integrity_degraded"
    | "confidence_integrity_incomplete"
    | "signal_lineage_unknown_dominant"
    | "mi_gate_rejections";
  detail: string;
}

export interface Cv05AuditResult {
  findings: Cv05AuditFinding[];
  propagated: boolean;
}

/**
 * Canonical mapping: degraded-source identifier → the verdict-surface
 * codes that satisfy "this source was propagated". A finding fires
 * when none of the listed codes are present on the verdict.
 */
interface PropagationRule {
  source: Cv05AuditFinding["source"];
  blockCodes: readonly string[];
  downgradeCodes: readonly string[];
  detect: (input: SystemControlInput) => string | null;
}

function hasAnyBlock(verdict: SystemControlVerdict, codes: readonly string[]): boolean {
  return verdict.blockReasons.some((b) => codes.includes(b.code));
}

function hasAnyDowngrade(verdict: SystemControlVerdict, codes: readonly string[]): boolean {
  return verdict.downgrades.some((d) => codes.includes(d.code));
}

const PROPAGATION_RULES: readonly PropagationRule[] = [
  {
    source: "integrity_partial",
    blockCodes: [],
    downgradeCodes: ["INTEGRITY_PARTIAL"],
    detect: (input) => {
      const ivr = requireIntegrityVerdict(input.integrityReport);
      return ivr.status === "OK" && ivr.value === "PARTIAL"
        ? "integrity report=PARTIAL but verdict carries no INTEGRITY_PARTIAL downgrade"
        : null;
    },
  },
  {
    source: "ael_partial",
    blockCodes: ["ANALYTICAL_ENRICHMENT_BLOCKED", "ANALYTICAL_ENRICHMENT_PARTIAL"],
    downgradeCodes: ["ANALYTICAL_ENRICHMENT_DEGRADED"],
    detect: (input) =>
      input.analyticalEnrichmentPartial === true
        ? `AEL partial=true (reason=${input.analyticalEnrichmentReason || "n/a"}) but no verdict-surface row`
        : null,
  },
  {
    source: "confidence_integrity_degraded",
    blockCodes: [],
    downgradeCodes: ["CONFIDENCE_INTEGRITY_DEGRADED"],
    detect: (input) =>
      input.confidenceIntegrityVerdict === "DEGRADED"
        ? `confidenceIntegrityVerdict=DEGRADED but no CONFIDENCE_INTEGRITY_DEGRADED downgrade (degraded engines: ${(input.confidenceIntegrityDegradedEngines || []).join(",") || "none"})`
        : null,
  },
  {
    source: "confidence_integrity_incomplete",
    blockCodes: ["CONFIDENCE_INTEGRITY_INCOMPLETE"],
    downgradeCodes: [],
    detect: (input) =>
      input.confidenceIntegrityVerdict === "INCOMPLETE"
        ? `confidenceIntegrityVerdict=INCOMPLETE but no CONFIDENCE_INTEGRITY_INCOMPLETE block (critical-absent: ${(input.confidenceIntegrityCriticalAbsent || []).join(",") || "none"})`
        : null,
  },
  {
    source: "signal_lineage_unknown_dominant",
    blockCodes: ["SIGNAL_LINEAGE_UNKNOWN_DOMINANT"],
    downgradeCodes: ["LINEAGE_UNTRUSTED"],
    detect: (input) =>
      input.signalCompositionUnknownThresholdHit === true
        ? "signalCompositionUnknownThresholdHit=true but no verdict-surface row"
        : null,
  },
  {
    source: "mi_gate_rejections",
    blockCodes: ["MI_GATE_REJECTED"],
    downgradeCodes: [],
    detect: (input) =>
      (input.miGateRejections?.length ?? 0) > 0
        ? `miGateRejections=${input.miGateRejections!.length} but no MI_GATE_REJECTED block`
        : null,
  },
];

/**
 * Returns the list of degraded sources that did NOT surface as either a
 * downgrade or a block on the produced verdict. Empty list = clean run.
 */
export function auditCv05DegradedPropagation(
  input: SystemControlInput,
  verdict: SystemControlVerdict,
): Cv05AuditResult {
  const findings: Cv05AuditFinding[] = [];

  for (const rule of PROPAGATION_RULES) {
    const detail = rule.detect(input);
    if (detail === null) continue;
    const propagated =
      hasAnyBlock(verdict, rule.blockCodes) || hasAnyDowngrade(verdict, rule.downgradeCodes);
    if (!propagated) {
      findings.push({ source: rule.source, detail });
    }
  }

  const result: Cv05AuditResult = {
    findings,
    propagated: findings.length === 0,
  };

  if (findings.length > 0) {
    const summary = findings.map((f) => `${f.source}: ${f.detail}`).join(" | ");
    console.warn(
      `[CV-05] DEGRADED_NOT_PROPAGATED | count=${findings.length} | findings=${summary} | ` +
        `verdict=${verdict.verdict} mode=${verdict.executionMode}`,
    );
  }

  return result;
}
