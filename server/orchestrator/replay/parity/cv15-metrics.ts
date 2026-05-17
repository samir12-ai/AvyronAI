/**
 * Task #91 / Phase 4-C — CV-15 OrchestratorParityGate metrics.
 *
 * Families:
 *   - cv15_parity_ready{ready="true"|"false"}      gauge (0|1)
 *   - cv15_parity_block_age_hours                  gauge
 *   - orch_parity_run_total{outcome}               counter
 *   - orch_parity_divergence_total{class,module}   counter
 *   - orch_module_auto_revert_total{module}        counter
 *   - orch_cassette_path_coverage{path_shape,covered} gauge (0|1)
 *
 * Mounted on /metrics via server/index.ts (renderCv15Metrics()).
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

class InMemoryGaugeVec {
  private readonly values = new Map<string, { labels: Labels; value: number }>();
  set(labels: Labels, value: number): void {
    this.values.set(labelKey(labels), { labels, value });
  }
  collect(): Array<{ labels: Labels; value: number }> {
    return Array.from(this.values.values());
  }
  reset(): void {
    this.values.clear();
  }
}

function labelKey(labels: Labels): string {
  return Object.keys(labels)
    .sort()
    .map((k) => `${k}=${labels[k]}`)
    .join("|");
}

const parityReady = new InMemoryGaugeVec();
let blockAgeHours = 0;
const runTotal = new InMemoryCounter();
const divergenceTotal = new InMemoryCounter();
const autoRevertTotal = new InMemoryCounter();
const pathCoverage = new InMemoryGaugeVec();

export function setParityReady(ready: boolean): void {
  parityReady.set({ ready: "true" }, ready ? 1 : 0);
  parityReady.set({ ready: "false" }, ready ? 0 : 1);
}

export function setParityBlockAgeHours(h: number): void {
  blockAgeHours = h;
}

export function recordParityRun(outcome: string): void {
  runTotal.inc({ outcome });
}

export function recordParityDivergence(divergenceClass: string, moduleId: string | null): void {
  divergenceTotal.inc({ class: divergenceClass, module: moduleId ?? "unknown" });
}

export function recordAutoRevert(moduleId: string): void {
  autoRevertTotal.inc({ module: moduleId });
}

export function setPathCoverage(pathShape: string, covered: boolean): void {
  pathCoverage.set({ path_shape: pathShape, covered: covered ? "true" : "false" }, covered ? 1 : 0);
}

export function _resetCv15MetricsForTests(): void {
  parityReady.reset();
  blockAgeHours = 0;
  runTotal.reset();
  divergenceTotal.reset();
  autoRevertTotal.reset();
  pathCoverage.reset();
}

export function _readCv15Counters() {
  return {
    parityReady: parityReady.collect(),
    blockAgeHours,
    runTotal: runTotal.collect(),
    divergenceTotal: divergenceTotal.collect(),
    autoRevertTotal: autoRevertTotal.collect(),
    pathCoverage: pathCoverage.collect(),
  };
}

function escapeLabel(v: string): string {
  return v.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
}

function renderLabels(labels: Labels): string {
  const parts = Object.entries(labels).map(([k, v]) => `${k}="${escapeLabel(v)}"`);
  return parts.length ? `{${parts.join(",")}}` : "";
}

export function renderCv15Metrics(): string {
  const lines: string[] = [];
  lines.push(`# HELP cv15_parity_ready CV-15: 1 if the parity gate is green (ready for Phase 4-D cutover), else 0.`);
  lines.push(`# TYPE cv15_parity_ready gauge`);
  for (const { labels, value } of parityReady.collect()) {
    lines.push(`cv15_parity_ready${renderLabels(labels)} ${value}`);
  }
  lines.push(`# HELP cv15_parity_block_age_hours CV-15: hours since the most recent BLOCK-classed divergence (large value when no recent BLOCK).`);
  lines.push(`# TYPE cv15_parity_block_age_hours gauge`);
  lines.push(`cv15_parity_block_age_hours ${blockAgeHours}`);
  lines.push(`# HELP orch_parity_run_total CV-15: parity replay runs by outcome.`);
  lines.push(`# TYPE orch_parity_run_total counter`);
  for (const { labels, value } of runTotal.collect()) {
    lines.push(`orch_parity_run_total${renderLabels(labels)} ${value}`);
  }
  lines.push(`# HELP orch_parity_divergence_total CV-15: divergences observed by class and (best-effort) module attribution.`);
  lines.push(`# TYPE orch_parity_divergence_total counter`);
  for (const { labels, value } of divergenceTotal.collect()) {
    lines.push(`orch_parity_divergence_total${renderLabels(labels)} ${value}`);
  }
  lines.push(`# HELP orch_module_auto_revert_total CV-15: per-module auto-revert events fired by the parity gate.`);
  lines.push(`# TYPE orch_module_auto_revert_total counter`);
  for (const { labels, value } of autoRevertTotal.collect()) {
    lines.push(`orch_module_auto_revert_total${renderLabels(labels)} ${value}`);
  }
  lines.push(`# HELP orch_cassette_path_coverage CV-15: 1 if the path-shape has ≥ minPerPathShape cassettes within the freshness window.`);
  lines.push(`# TYPE orch_cassette_path_coverage gauge`);
  for (const { labels, value } of pathCoverage.collect()) {
    lines.push(`orch_cassette_path_coverage${renderLabels(labels)} ${value}`);
  }
  return lines.join("\n");
}
