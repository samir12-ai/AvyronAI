/**
 * Task #92 / Phase 4-D — Cutover metrics.
 *
 * Counters surfaced on `/metrics`. The traffic-percent gauge reflects
 * the LIVE value of `cutover_state.traffic_percent` (refreshed on every
 * dispatch decision so the gauge cannot drift from the DB).
 *
 * D5: no fallback substitutions — `recordDivergenceAtTraffic` requires
 * a classified `divergence_class` enum value; the caller MUST NOT pass
 * an "unknown" placeholder. Unclassified divergences are a contract
 * violation upstream.
 */

export type CutoverPath = "current" | "candidate";
export type CutoverPersistSite = "initial" | "cas_re_persist" | "single_persist_overlay";
export type CutoverAutoRevertReason =
  | "structural_divergence"
  | "canonical_field_divergence"
  | "candidate_threw";
export type DivergenceClassForMetric =
  | "STRUCTURAL"
  | "CANONICAL_FIELD"
  | "DEGRADATION_SURFACE"
  | "BUDGET_LEDGER"
  | "PROVENANCE"
  | "ORDER"
  | "TIMING_ONLY";

let trafficPercentGauge = 0;
const runsTotal: Record<CutoverPath, number> = { current: 0, candidate: 0 };
const divergenceAtTraffic = new Map<string, number>(); // key = `${percent}|${class}`
const persistCallTotal: Record<CutoverPersistSite, number> = {
  initial: 0,
  cas_re_persist: 0,
  single_persist_overlay: 0,
};
const autoRevertTotal: Record<CutoverAutoRevertReason, number> = {
  structural_divergence: 0,
  canonical_field_divergence: 0,
  candidate_threw: 0,
};

export function setTrafficPercent(percent: number): void {
  trafficPercentGauge = percent;
}

export function recordRun(path: CutoverPath): void {
  runsTotal[path] += 1;
}

export function recordDivergenceAtTraffic(
  trafficPercent: number,
  divergenceClass: DivergenceClassForMetric,
): void {
  const key = `${trafficPercent}|${divergenceClass}`;
  divergenceAtTraffic.set(key, (divergenceAtTraffic.get(key) ?? 0) + 1);
}

export function recordPersistCall(site: CutoverPersistSite): void {
  persistCallTotal[site] += 1;
}

export function recordAutoRevert(reason: CutoverAutoRevertReason): void {
  autoRevertTotal[reason] += 1;
}

/**
 * Test-only snapshot. Reads the in-process counters; production
 * Prometheus exposition uses `renderCutoverMetrics()`.
 */
export function snapshotCutoverMetrics() {
  return {
    trafficPercentGauge,
    runsTotal: { ...runsTotal },
    divergenceAtTraffic: Object.fromEntries(divergenceAtTraffic.entries()),
    persistCallTotal: { ...persistCallTotal },
    autoRevertTotal: { ...autoRevertTotal },
  };
}

/** Test-only reset hook. */
export function _resetCutoverMetricsForTest(): void {
  trafficPercentGauge = 0;
  runsTotal.current = 0;
  runsTotal.candidate = 0;
  divergenceAtTraffic.clear();
  for (const k of Object.keys(persistCallTotal) as CutoverPersistSite[]) {
    persistCallTotal[k] = 0;
  }
  for (const k of Object.keys(autoRevertTotal) as CutoverAutoRevertReason[]) {
    autoRevertTotal[k] = 0;
  }
}

export function renderCutoverMetrics(): string {
  const lines: string[] = [];
  lines.push("# HELP orch_cutover_traffic_percent Current cutover traffic-percent gauge (0..100).");
  lines.push("# TYPE orch_cutover_traffic_percent gauge");
  lines.push(`orch_cutover_traffic_percent ${trafficPercentGauge}`);

  lines.push("# HELP orch_cutover_runs_total Runs dispatched to each cutover path.");
  lines.push("# TYPE orch_cutover_runs_total counter");
  for (const p of ["current", "candidate"] as CutoverPath[]) {
    lines.push(`orch_cutover_runs_total{path="${p}"} ${runsTotal[p]}`);
  }

  lines.push("# HELP orch_cutover_divergence_at_traffic_total Divergence counts bucketed by traffic-percent at observation time.");
  lines.push("# TYPE orch_cutover_divergence_at_traffic_total counter");
  for (const [key, count] of divergenceAtTraffic.entries()) {
    const [pct, cls] = key.split("|");
    lines.push(`orch_cutover_divergence_at_traffic_total{traffic_percent="${pct}",divergence_class="${cls}"} ${count}`);
  }

  lines.push("# HELP orch_persist_call_total persistPlan call count by site — single-persist invariant proof.");
  lines.push("# TYPE orch_persist_call_total counter");
  for (const site of Object.keys(persistCallTotal) as CutoverPersistSite[]) {
    lines.push(`orch_persist_call_total{site="${site}"} ${persistCallTotal[site]}`);
  }

  lines.push("# HELP orch_cutover_auto_revert_total Auto-revert events by reason.");
  lines.push("# TYPE orch_cutover_auto_revert_total counter");
  for (const reason of Object.keys(autoRevertTotal) as CutoverAutoRevertReason[]) {
    lines.push(`orch_cutover_auto_revert_total{reason="${reason}"} ${autoRevertTotal[reason]}`);
  }

  return lines.join("\n") + "\n";
}
