/**
 * Task #91 / Phase 4-C — CV-15 metrics (reclassified Task #93 / Phase 4-E).
 *
 * Families retained:
 *   - cv15_parity_block_age_hours                  gauge
 *   - orch_parity_run_total{outcome}               counter
 *   - orch_parity_divergence_total{class,module}   counter
 *   - orch_cassette_path_coverage{path_shape,covered} gauge (0|1)
 *
 * Removed (cutover-era):
 *   - cv15_parity_ready{ready}
 *   - orch_module_auto_revert_total{module}
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

let blockAgeHours = 0;
const runTotal = new InMemoryCounter();
const divergenceTotal = new InMemoryCounter();
const pathCoverage = new InMemoryGaugeVec();

export function setParityBlockAgeHours(h: number): void {
  blockAgeHours = h;
}

export function recordParityRun(outcome: string): void {
  runTotal.inc({ outcome });
}

export function recordParityDivergence(divergenceClass: string, moduleId: string | null): void {
  divergenceTotal.inc({ class: divergenceClass, module: moduleId ?? "unknown" });
}

export function setPathCoverage(pathShape: string, covered: boolean): void {
  pathCoverage.set({ path_shape: pathShape, covered: covered ? "true" : "false" }, covered ? 1 : 0);
}

export function _resetCv15MetricsForTests(): void {
  blockAgeHours = 0;
  runTotal.reset();
  divergenceTotal.reset();
  pathCoverage.reset();
}

export function _readCv15Counters() {
  return {
    blockAgeHours,
    runTotal: runTotal.collect(),
    divergenceTotal: divergenceTotal.collect(),
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
  lines.push(`# HELP cv15_parity_block_age_hours CV-15: hours since the most recent BLOCK-classed divergence (informational regression observer signal).`);
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
  lines.push(`# HELP orch_cassette_path_coverage CV-15: 1 if the path-shape has ≥ minPerPathShape cassettes within the freshness window.`);
  lines.push(`# TYPE orch_cassette_path_coverage gauge`);
  for (const { labels, value } of pathCoverage.collect()) {
    lines.push(`orch_cassette_path_coverage${renderLabels(labels)} ${value}`);
  }
  return lines.join("\n");
}
