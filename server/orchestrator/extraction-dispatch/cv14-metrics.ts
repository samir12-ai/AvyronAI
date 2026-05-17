/**
 * Task #90 / Phase 4-B — CV-14 ExtractionDriftDetection metrics.
 *
 * Mounted on /metrics via server/index.ts (renderCv14Metrics()).
 *
 * Families:
 *   - cv14_module_extraction_divergences_total{module,severity}
 *         counter — divergences observed in shadow mode. Steady-state
 *         expectation: 0 for any module promoted to `candidate`.
 *   - orch_module_dispatch_total{module,mode,outcome}
 *         counter — total dispatch invocations by module / mode (current,
 *         candidate, shadow) / outcome (current_only, candidate_only,
 *         shadow_match, shadow_diverge_minor|major|fatal).
 *   - cv14_module_candidate_error_total{module}
 *         counter — candidate-only invocations or shadow runs where the
 *         candidate threw. Alarm: any positive rate while mode=candidate.
 *
 * Alarm thresholds (operator runbook):
 *   - cv14_module_extraction_divergences_total{severity="major"} > 0
 *     OR severity="fatal" > 0 in a 5-min window → auto-revert supervisor
 *     flips ORCH_USE_<MODULE> to `current`.
 *   - cv14_module_candidate_error_total > 0 while mode=candidate →
 *     immediate page; the candidate is structurally broken.
 */

type Labels = Record<string, string>;

class InMemoryCounter {
  private readonly counts = new Map<string, { labels: Labels; value: number }>();
  inc(labels: Labels, by = 1): void {
    const k = labelKey(labels);
    const cur = this.counts.get(k);
    if (cur) cur.value += by;
    else this.counts.set(k, { labels, value: by });
  }
  collect(): Array<{ labels: Labels; value: number }> {
    return Array.from(this.counts.values());
  }
  reset(): void {
    this.counts.clear();
  }
}

function labelKey(labels: Labels): string {
  return Object.keys(labels)
    .sort()
    .map((k) => `${k}=${labels[k]}`)
    .join("|");
}

const divergencesTotal = new InMemoryCounter();
const dispatchTotal = new InMemoryCounter();
const candidateErrorTotal = new InMemoryCounter();

export type DispatchOutcome =
  | "current_only"
  | "candidate_only"
  | "shadow_match"
  | "shadow_diverge_minor"
  | "shadow_diverge_major"
  | "shadow_diverge_fatal";

export type DispatchMode = "current" | "candidate" | "shadow";

export type DivergenceSeverity = "minor" | "major" | "fatal";

export function recordDispatch(
  module: string,
  mode: DispatchMode,
  outcome: DispatchOutcome,
): void {
  dispatchTotal.inc({ module, mode, outcome });
}

export function recordDivergence(
  module: string,
  severity: DivergenceSeverity,
): void {
  divergencesTotal.inc({ module, severity });
}

export function recordCandidateError(module: string): void {
  candidateErrorTotal.inc({ module });
}

export function _resetCv14MetricsForTests(): void {
  divergencesTotal.reset();
  dispatchTotal.reset();
  candidateErrorTotal.reset();
}

/** Test helper — read raw collect() output for assertions. */
export function _readCv14Counters() {
  return {
    divergences: divergencesTotal.collect(),
    dispatch: dispatchTotal.collect(),
    candidateError: candidateErrorTotal.collect(),
  };
}

function escapeLabel(v: string): string {
  return v.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
}

function renderLabels(labels: Labels): string {
  const parts = Object.entries(labels).map(([k, v]) => `${k}="${escapeLabel(v)}"`);
  return parts.length ? `{${parts.join(",")}}` : "";
}

export function renderCv14Metrics(): string {
  const lines: string[] = [];
  lines.push(
    `# HELP cv14_module_extraction_divergences_total CV-14: candidate-vs-current divergences observed in shadow mode, by module and severity.`,
  );
  lines.push(`# TYPE cv14_module_extraction_divergences_total counter`);
  for (const { labels, value } of divergencesTotal.collect()) {
    lines.push(`cv14_module_extraction_divergences_total${renderLabels(labels)} ${value}`);
  }
  lines.push(
    `# HELP orch_module_dispatch_total Total orchestrator module dispatch invocations, by module / mode / outcome.`,
  );
  lines.push(`# TYPE orch_module_dispatch_total counter`);
  for (const { labels, value } of dispatchTotal.collect()) {
    lines.push(`orch_module_dispatch_total${renderLabels(labels)} ${value}`);
  }
  lines.push(
    `# HELP cv14_module_candidate_error_total CV-14: candidate implementation threw during dispatch.`,
  );
  lines.push(`# TYPE cv14_module_candidate_error_total counter`);
  for (const { labels, value } of candidateErrorTotal.collect()) {
    lines.push(`cv14_module_candidate_error_total${renderLabels(labels)} ${value}`);
  }
  return lines.join("\n");
}
