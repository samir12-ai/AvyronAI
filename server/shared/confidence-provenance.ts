/**
 * Confidence Provenance Layer (T3.A — Runtime Truth Track, May 2026)
 *
 * Doctrine: D5 of the Semantic Contract Hardening doctrine — "Missing
 * canonical → CONTRACT_INCOMPLETE. Never silently substitute another
 * field." The pre-T3.A pipeline used `?? 0.5` defaults across orchestrator
 * confidence reads, which made absent / failed engine outputs look
 * "moderately confident" (0.5 sits exactly above the system-control
 * positioning hard-gate of 0.40 and below the spread threshold of 0.50,
 * effectively bypassing both gates).
 *
 * This module decouples the *value* of an engine confidence read from its
 * *provenance*: the same numeric 0.5 can mean very different things
 * depending on whether it came from observed evidence, an inferred
 * synthesis, an engine-internal default floor, or a missing field.
 *
 * Callers must:
 *  - use `inspectEngineConfidence` instead of inlining `?? 0.5` defaults,
 *  - record per-engine provenance via `EngineConfidenceProvenanceEntry`,
 *  - and surface the run's verdict via `summarizeConfidenceIntegrity`.
 *
 * Numeric back-compat: `extractEngineConfidence` (orchestrator) keeps its
 * { dataConfidence, engineConfidence, combined } numeric return shape,
 * but absent values now collapse to **0** (not 0.5). This makes the
 * pre-existing system-control gates (positioning ≥ 0.40, combined-spread
 * ≤ 0.50, confidence-chain floor) actually fire on degraded engines
 * instead of being bypassed by the synthetic 0.5.
 */

export type ConfidenceProvenance =
  | "direct_evidence"      // value emitted from observed/measured engine data
  | "inferred_synthesis"   // value derived from inferred/synthesized signals
  | "default_floor"        // engine emitted a default due to insufficient inputs
  | "absent";              // no confidence field present at all

export interface ConfidenceWithProvenance {
  value: number | null;
  provenance: ConfidenceProvenance;
  reason?: string;
  sourceField?: string;
}

export interface EngineConfidenceProvenanceEntry {
  engineId: string;
  dataConfidence: ConfidenceWithProvenance;
  engineConfidence: ConfidenceWithProvenance;
  /** Worst-of(data, engine) — the conservative provenance for this engine. */
  combinedProvenance: ConfidenceProvenance;
  capturedAt: number;
}

interface FieldSpec {
  path: string;
  provenance: ConfidenceProvenance;
}

interface EngineFieldMap {
  /** Where to read engine-logic confidence from, in priority order. */
  engineFields: FieldSpec[];
  /** Where to read data-grounding confidence from, in priority order. */
  dataFields: FieldSpec[];
  /** Optional: nested root re-entry (e.g., MI uses output.output). */
  nestedRoot?: string;
}

const ENGINE_CONFIDENCE_MAP: Record<string, EngineFieldMap> = {
  market_intelligence: {
    nestedRoot: "output",
    engineFields: [
      { path: "confidence.overall", provenance: "direct_evidence" },
      { path: "overallConfidence", provenance: "direct_evidence" },
      { path: "confidenceScore", provenance: "direct_evidence" },
    ],
    dataFields: [
      { path: "dataReliability.overallScore", provenance: "direct_evidence" },
      { path: "confidence.factors.dataCompleteness", provenance: "direct_evidence" },
    ],
  },
  audience: {
    engineFields: [
      { path: "confidenceScore", provenance: "direct_evidence" },
      { path: "dataReliability.overallReliability", provenance: "inferred_synthesis" },
    ],
    dataFields: [
      { path: "dataReliability.overallReliability", provenance: "direct_evidence" },
      { path: "dataReliability.score", provenance: "direct_evidence" },
    ],
  },
  positioning: {
    engineFields: [
      { path: "engineConfidence", provenance: "direct_evidence" },
      { path: "confidenceScore", provenance: "direct_evidence" },
    ],
    dataFields: [
      { path: "dataConfidence", provenance: "direct_evidence" },
      { path: "specificityScore", provenance: "inferred_synthesis" },
    ],
  },
  differentiation: {
    engineFields: [
      { path: "confidenceScore", provenance: "direct_evidence" },
      { path: "confidence", provenance: "direct_evidence" },
    ],
    dataFields: [
      { path: "celDepthCompliance.causalDepthScore", provenance: "direct_evidence" },
    ],
  },
  mechanism: {
    engineFields: [{ path: "confidenceScore", provenance: "direct_evidence" }],
    dataFields: [{ path: "celDepthCompliance.causalDepthScore", provenance: "direct_evidence" }],
  },
  offer: {
    engineFields: [
      { path: "offerStrengthScore", provenance: "direct_evidence" },
      { path: "confidenceScore", provenance: "direct_evidence" },
    ],
    dataFields: [
      { path: "proofLayer.proofStrength", provenance: "direct_evidence" },
      { path: "proofStrength", provenance: "direct_evidence" },
    ],
  },
  awareness: {
    engineFields: [
      { path: "primaryRoute.awarenessStrengthScore", provenance: "direct_evidence" },
      { path: "confidenceScore", provenance: "direct_evidence" },
    ],
    dataFields: [],
  },
  funnel: {
    engineFields: [
      { path: "funnelStrengthScore", provenance: "direct_evidence" },
      { path: "confidenceScore", provenance: "direct_evidence" },
    ],
    dataFields: [
      { path: "trustPathAnalysis.score", provenance: "direct_evidence" },
      { path: "trustPathScore", provenance: "direct_evidence" },
    ],
  },
  integrity: {
    engineFields: [{ path: "overallIntegrityScore", provenance: "direct_evidence" }],
    dataFields: [],
  },
  persuasion: {
    // Field-drift repair (2026-07): the persuasion engine never emits a
    // top-level `confidenceScore` — its real engine confidence lives at
    // `primaryRoute.persuasionStrengthScore` (mirrors awareness, which reads
    // `primaryRoute.awarenessStrengthScore`). Reading only `confidenceScore`
    // collapsed engineConfidence to 0 and dragged combined to ~0.39,
    // tripping the 0.50 confidence-spread gate on healthy runs.
    engineFields: [
      { path: "primaryRoute.persuasionStrengthScore", provenance: "direct_evidence" },
      { path: "confidenceScore", provenance: "direct_evidence" },
    ],
    dataFields: [{ path: "celDepthCompliance.causalDepthScore", provenance: "direct_evidence" }],
  },
  statistical_validation: {
    engineFields: [
      { path: "claimConfidenceScore", provenance: "direct_evidence" },
      { path: "confidenceScore", provenance: "direct_evidence" },
    ],
    dataFields: [{ path: "dataReliability.overallScore", provenance: "direct_evidence" }],
  },
  budget_governor: {
    engineFields: [{ path: "confidenceScore", provenance: "direct_evidence" }],
    dataFields: [],
  },
  channel_selection: {
    engineFields: [{ path: "confidenceScore", provenance: "direct_evidence" }],
    dataFields: [],
  },
  iteration: {
    engineFields: [{ path: "confidenceScore", provenance: "direct_evidence" }],
    dataFields: [],
  },
  retention: {
    engineFields: [{ path: "confidenceScore", provenance: "direct_evidence" }],
    dataFields: [],
  },
};

function readPath(obj: any, path: string): any {
  if (obj === null || obj === undefined) return undefined;
  const parts = path.split(".");
  let cur: any = obj;
  for (const p of parts) {
    if (cur === null || cur === undefined) return undefined;
    cur = cur[p];
  }
  return cur;
}

function readFieldList(output: any, fields: FieldSpec[]): ConfidenceWithProvenance {
  for (const f of fields) {
    const v = readPath(output, f.path);
    if (typeof v === "number" && !Number.isNaN(v) && Number.isFinite(v)) {
      return { value: v, provenance: f.provenance, sourceField: f.path };
    }
  }
  return { value: null, provenance: "absent" };
}

/**
 * Inspect an engine's output and return both engine-logic and data-grounding
 * confidence values along with their provenance. Never returns a synthetic
 * 0.5 — absent fields surface as { value: null, provenance: "absent" }.
 *
 * For the orchestrator, the numeric back-compat shape is computed by
 * `toExtractedConfidenceShape()` below, which collapses null → 0.
 */
export function inspectEngineConfidence(
  engineId: string,
  output: any,
): { engine: ConfidenceWithProvenance; data: ConfidenceWithProvenance } {
  if (output === null || output === undefined) {
    return {
      engine: { value: null, provenance: "absent", reason: "no_output" },
      data: { value: null, provenance: "absent", reason: "no_output" },
    };
  }

  const map = ENGINE_CONFIDENCE_MAP[engineId];
  if (!map) {
    const eng = readFieldList(output, [{ path: "confidenceScore", provenance: "direct_evidence" }]);
    return { engine: eng, data: { ...eng } };
  }

  // Some engines (e.g., MI) wrap their real payload under output.output
  const looker = map.nestedRoot ? (output[map.nestedRoot] ?? output) : output;

  const eng = readFieldList(looker, map.engineFields);

  // Engine-logic confidence may also live at the wrapper root (e.g.,
  // MI's overallConfidence/confidenceScore) when the nested root is absent.
  let engineFinal = eng;
  if (eng.value === null && map.nestedRoot && looker !== output) {
    const wrapperEng = readFieldList(output, map.engineFields);
    if (wrapperEng.value !== null) engineFinal = wrapperEng;
  }

  let data = readFieldList(looker, map.dataFields);
  if (data.provenance === "absent" && engineFinal.value !== null) {
    // Mirror engine confidence into data slot, but tag it as inferred so the
    // verdict can downgrade — we did not actually read data-grounding signal.
    data = {
      value: engineFinal.value,
      provenance: "inferred_synthesis",
      reason: "mirrored_from_engine_confidence",
    };
  }

  return { engine: engineFinal, data };
}

/**
 * Worst-case combination order: absent > default_floor > inferred_synthesis
 * > direct_evidence. Used to summarise per-engine provenance into a single
 * conservative tag.
 */
export function combineProvenance(
  a: ConfidenceProvenance,
  b: ConfidenceProvenance,
): ConfidenceProvenance {
  const rank: Record<ConfidenceProvenance, number> = {
    absent: 4,
    default_floor: 3,
    inferred_synthesis: 2,
    direct_evidence: 1,
  };
  return rank[a] >= rank[b] ? a : b;
}

/**
 * Numeric back-compat shape consumed by the orchestrator's
 * `extractEngineConfidence`. Absent values collapse to 0 (not 0.5). The
 * provenance entry is returned alongside so the caller can persist it
 * into a per-run provenance log.
 */
export function toExtractedConfidenceShape(
  engineId: string,
  output: any,
): {
  numeric: { dataConfidence: number; engineConfidence: number; combined: number };
  provenance: EngineConfidenceProvenanceEntry;
} {
  const inspected = inspectEngineConfidence(engineId, output);
  const dataNum = inspected.data.value === null ? 0 : Math.max(0, Math.min(1, inspected.data.value));
  const engNum = inspected.engine.value === null ? 0 : Math.max(0, Math.min(1, inspected.engine.value));
  const combined = (dataNum + engNum) / 2;
  return {
    numeric: { dataConfidence: dataNum, engineConfidence: engNum, combined },
    provenance: {
      engineId,
      dataConfidence: inspected.data,
      engineConfidence: inspected.engine,
      combinedProvenance: combineProvenance(inspected.data.provenance, inspected.engine.provenance),
      capturedAt: Date.now(),
    },
  };
}

export type ConfidenceIntegrityVerdict = "COMPLETE" | "DEGRADED" | "INCOMPLETE";

export interface ConfidenceIntegritySummary {
  verdict: ConfidenceIntegrityVerdict;
  totalEngines: number;
  byProvenance: {
    direct_evidence: number;
    inferred_synthesis: number;
    default_floor: number;
    absent: number;
  };
  absentEngines: string[];
  defaultFloorEngines: string[];
  inferredSynthesisEngines: string[];
  /** Engines whose absence forced the verdict to INCOMPLETE. */
  criticalAbsentEngines: string[];
}

/**
 * Engines whose confidence absence makes the run INCOMPLETE. These are the
 * engines whose outputs feed live-decision gates in build-plan-layer and
 * system-control. An absent confidence on any of these means downstream
 * gates were bypassed by the pre-T3.A 0.5-default behaviour.
 */
export const CONFIDENCE_CRITICAL_ENGINES: ReadonlySet<string> = new Set([
  "market_intelligence",
  "audience",
  "positioning",
  "offer",
  "funnel",
  "integrity",
]);

export function summarizeConfidenceIntegrity(
  entries: EngineConfidenceProvenanceEntry[],
): ConfidenceIntegritySummary {
  const summary: ConfidenceIntegritySummary = {
    verdict: "COMPLETE",
    totalEngines: entries.length,
    byProvenance: {
      direct_evidence: 0,
      inferred_synthesis: 0,
      default_floor: 0,
      absent: 0,
    },
    absentEngines: [],
    defaultFloorEngines: [],
    inferredSynthesisEngines: [],
    criticalAbsentEngines: [],
  };

  for (const e of entries) {
    summary.byProvenance[e.combinedProvenance]++;
    if (e.combinedProvenance === "absent") {
      summary.absentEngines.push(e.engineId);
      if (CONFIDENCE_CRITICAL_ENGINES.has(e.engineId)) {
        summary.criticalAbsentEngines.push(e.engineId);
      }
    } else if (e.combinedProvenance === "default_floor") {
      summary.defaultFloorEngines.push(e.engineId);
    } else if (e.combinedProvenance === "inferred_synthesis") {
      summary.inferredSynthesisEngines.push(e.engineId);
    }
  }

  if (summary.criticalAbsentEngines.length > 0) {
    summary.verdict = "INCOMPLETE";
  } else if (
    summary.absentEngines.length > 0 ||
    summary.defaultFloorEngines.length > 0 ||
    summary.inferredSynthesisEngines.length > 0
  ) {
    summary.verdict = "DEGRADED";
  }

  return summary;
}
