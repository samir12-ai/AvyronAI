/**
 * Task #64 / Phase 1 — CV-06 (Memory Provenance Verification) metric.
 *
 * One counter family for every memoryStore outcome. Labels:
 *   - outcome:   inserted | updated | blocked | decay
 *   - memoryType: the canonical type tag (e.g. winning_angle, content_distribution)
 *   - engine:    the writing engine name
 *
 * This is the observable rate driving Phase 1's "no direct strategy_memory
 * writes outside memoryStore" enforcement. A non-zero rate on the
 * `engine='(direct)'` label means the ESLint rule has been suppressed
 * somewhere new and the suppression allowlist needs to grow — same operator
 * contract as Seal #15/#16 silent-degradation signals.
 *
 * Wiring follows the same lightweight Counter shape used by
 * server/continuity/metrics.ts (an internal Map keyed by label tuple so the
 * Prometheus exposition surface can iterate it without prom-client). When
 * the project gains a real prom-client, this file is the single swap point.
 */

type Outcome = "inserted" | "updated" | "blocked" | "decay";

interface LabeledCounter {
  inc(labels: { outcome: Outcome; memoryType: string; engine: string }): void;
  collect(): Array<{ outcome: Outcome; memoryType: string; engine: string; value: number }>;
  reset(): void;
}

class InMemoryLabeledCounter implements LabeledCounter {
  readonly name: string;
  private readonly counts = new Map<string, number>();
  constructor(name: string) {
    this.name = name;
  }
  private key(labels: { outcome: Outcome; memoryType: string; engine: string }): string {
    return `${labels.outcome}|${labels.memoryType}|${labels.engine}`;
  }
  inc(labels: { outcome: Outcome; memoryType: string; engine: string }): void {
    const k = this.key(labels);
    this.counts.set(k, (this.counts.get(k) ?? 0) + 1);
  }
  collect(): Array<{ outcome: Outcome; memoryType: string; engine: string; value: number }> {
    return Array.from(this.counts.entries()).map(([k, value]) => {
      const [outcome, memoryType, engine] = k.split("|");
      return { outcome: outcome as Outcome, memoryType, engine, value };
    });
  }
  reset(): void {
    this.counts.clear();
  }
}

export const cv06MemoryWritesTotal: LabeledCounter = new InMemoryLabeledCounter(
  "cv06_memory_writes_total",
);

export function recordMemoryWriteOutcome(outcome: Outcome, memoryType: string, engine: string): void {
  cv06MemoryWritesTotal.inc({ outcome, memoryType, engine });
}

/** Test helper. Not for production use. */
export function _resetCv06MetricsForTests(): void {
  cv06MemoryWritesTotal.reset();
  cv11HallucinationExposureTotal.reset();
}

// ── CV-11 (Hallucination Exposure) ───────────────────────────────────────────
//
// Task #65 / Phase 2 step 9 — baseline hallucination-exposure metric. Counts
// every reinforcement attempt that targeted a decision_id with NO bound
// strategy_memory row (the silent-zero-row class of bug DEC-B fixes). A
// non-zero rate after Phase 2 deploy indicates either (a) the upstream
// writers are still not populating strategy_memory.decision_id, or (b) the
// outcome path is firing for decisions that produced no strategic facts.

type HallucinationKind = "no_bound_row" | "stale_plan" | "missing_source_outcome";

interface HallucinationCounter {
  inc(labels: { kind: HallucinationKind; engine: string }): void;
  collect(): Array<{ kind: HallucinationKind; engine: string; value: number }>;
  reset(): void;
}

class InMemoryHallucinationCounter implements HallucinationCounter {
  private readonly counts = new Map<string, number>();
  inc(labels: { kind: HallucinationKind; engine: string }): void {
    const k = `${labels.kind}|${labels.engine}`;
    this.counts.set(k, (this.counts.get(k) ?? 0) + 1);
  }
  collect(): Array<{ kind: HallucinationKind; engine: string; value: number }> {
    return Array.from(this.counts.entries()).map(([k, value]) => {
      const [kind, engine] = k.split("|");
      return { kind: kind as HallucinationKind, engine, value };
    });
  }
  reset(): void {
    this.counts.clear();
  }
}

export const cv11HallucinationExposureTotal: HallucinationCounter =
  new InMemoryHallucinationCounter();

export function recordHallucinationExposure(kind: HallucinationKind, engine: string): void {
  cv11HallucinationExposureTotal.inc({ kind, engine });
}

/**
 * Prometheus exposition text for the CV-06 metric family. Mounted on the
 * /metrics endpoint in server/index.ts alongside renderMetrics() and
 * renderContinuityMetrics(). Steady-state observation: a non-zero rate
 * on outcome="blocked" is healthy (gate is working); a non-zero rate on
 * any other engine label besides those used by memoryStore callers
 * means the ESLint rule has been suppressed somewhere new.
 */
export function renderCv06Metrics(): string {
  const samples = cv06MemoryWritesTotal.collect();
  const lines: string[] = [];
  lines.push(`# HELP cv06_memory_writes_total CV-06: outcomes of every strategy_memory write attempted through memoryStore.`);
  lines.push(`# TYPE cv06_memory_writes_total counter`);
  for (const s of samples) {
    const labels = `outcome="${s.outcome}",memoryType="${s.memoryType.replace(/"/g, "\\\"")}",engine="${s.engine.replace(/"/g, "\\\"")}"`;
    lines.push(`cv06_memory_writes_total{${labels}} ${s.value}`);
  }
  const cv11 = cv11HallucinationExposureTotal.collect();
  lines.push(`# HELP cv11_hallucination_exposure_total CV-11: reinforcement attempts that referenced a non-existent or stale binding (steady-state expectation = 0).`);
  lines.push(`# TYPE cv11_hallucination_exposure_total counter`);
  for (const s of cv11) {
    const labels = `kind="${s.kind}",engine="${s.engine.replace(/"/g, "\\\"")}"`;
    lines.push(`cv11_hallucination_exposure_total{${labels}} ${s.value}`);
  }
  return lines.join("\n");
}
