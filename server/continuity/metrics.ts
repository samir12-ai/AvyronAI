/**
 * Seal #13 / Track #1 — Continuity scheduler metrics.
 *
 * Augments the in-house OTel registry (server/observability/otel.ts) with
 * a small set of continuity-specific counters and gauges. Exposed via the
 * existing /metrics endpoint by re-rendering through renderContinuityMetrics()
 * which is concatenated to the registry's text exposition (see otel.ts wiring).
 *
 * All metrics are designed to make operational silence VISIBLE per the
 * Seal #13 doctrine: skips are counted with their reason label, and any
 * non-zero value on continuity_dead_cycles_total or
 * continuity_missed_windows_total surfaces a real failure mode.
 */

type Labels = Record<string, string>;

function labelKey(labels: Labels): string {
  const keys = Object.keys(labels).sort();
  return keys.map((k) => `${k}=${labels[k]}`).join("|");
}

function escapeLabel(v: string): string {
  return v.replace(/\\/g, "\\\\").replace(/"/g, '\\"').replace(/\n/g, "\\n");
}

function renderLabels(labels: Labels): string {
  const parts = Object.entries(labels).map(([k, v]) => `${k}="${escapeLabel(v)}"`);
  return parts.length ? `{${parts.join(",")}}` : "";
}

class Counter {
  private values = new Map<string, { labels: Labels; value: number }>();
  constructor(public name: string, public help: string) {}
  inc(labels: Labels = {}, by = 1): void {
    const k = labelKey(labels);
    const cur = this.values.get(k);
    if (cur) cur.value += by;
    else this.values.set(k, { labels, value: by });
  }
  render(): string {
    const lines: string[] = [`# HELP ${this.name} ${this.help}`, `# TYPE ${this.name} counter`];
    for (const { labels, value } of this.values.values()) {
      lines.push(`${this.name}${renderLabels(labels)} ${value}`);
    }
    return lines.join("\n");
  }
}

class Gauge {
  private values = new Map<string, { labels: Labels; value: number }>();
  constructor(public name: string, public help: string) {}
  set(labels: Labels, value: number): void {
    this.values.set(labelKey(labels), { labels, value });
  }
  render(): string {
    const lines: string[] = [`# HELP ${this.name} ${this.help}`, `# TYPE ${this.name} gauge`];
    for (const { labels, value } of this.values.values()) {
      lines.push(`${this.name}${renderLabels(labels)} ${value}`);
    }
    return lines.join("\n");
  }
}

export const continuityMetrics = {
  ticksTotal: new Counter("continuity_scheduler_ticks_total", "Continuity scheduler ticks"),
  tickDurationMs: new Gauge(
    "continuity_scheduler_last_tick_duration_ms",
    "Wall-clock duration of the most recent continuity tick",
  ),
  lastTickEpochSeconds: new Gauge(
    "continuity_scheduler_last_tick_epoch_seconds",
    "Unix timestamp of the most recent continuity tick (heartbeat freshness)",
  ),
  campaignsScanned: new Counter(
    "continuity_campaigns_scanned_total",
    "Campaigns evaluated across all continuity ticks",
  ),
  runsInvoked: new Counter(
    "continuity_runs_invoked_total",
    "Boss runs invoked by the continuity scheduler",
  ),
  runsSkipped: new Counter(
    "continuity_runs_skipped_total",
    "Boss runs the continuity scheduler chose NOT to invoke (with reason label)",
  ),
  runsFailed: new Counter(
    "continuity_runs_failed_total",
    "Boss runs the continuity scheduler invoked that threw (with reason label)",
  ),
  reanchorsWritten: new Counter(
    "continuity_reanchors_written_total",
    "plan_anchor_resets rows written by the continuity scheduler",
  ),
  missedWindows: new Counter(
    "continuity_missed_windows_total",
    "Eval windows the scheduler observed as never having opened (window_index gap >0)",
  ),
  deadCycles: new Counter(
    "continuity_dead_cycles_total",
    "Active campaigns with no boss_run in DEAD_CYCLE_THRESHOLD_DAYS",
  ),
  schedulerUp: new Gauge(
    "continuity_scheduler_up",
    "1 if the continuity scheduler tick loop is currently scheduled, 0 otherwise",
  ),
  // Seal #14 / Track #2 — multi-replica claim metrics.
  claimsAcquired: new Counter(
    "continuity_window_claims_acquired_total",
    "Per-window claims this replica successfully INSERTed (it owns the work)",
  ),
  claimsLostToOtherReplica: new Counter(
    "continuity_window_claims_lost_other_replica_total",
    "Per-window claims this replica lost to a concurrent replica (ON CONFLICT DO NOTHING)",
  ),
  claimsAlreadyCompleted: new Counter(
    "continuity_window_claims_already_completed_total",
    "Per-window claims short-circuited because a completed claim row already exists",
  ),
  claimsReleasedOnFailure: new Counter(
    "continuity_window_claims_released_total",
    "Per-window claim rows DELETEd because boss_run failed/partial (INVARIANT-RETRY enforcement)",
  ),
  // Seal #14 / Track #2 — supervisor metrics.
  supervisorUp: new Gauge(
    "continuity_supervisor_up",
    "1 if the continuity supervisor tick loop is currently scheduled, 0 otherwise",
  ),
  supervisorTicksTotal: new Counter(
    "continuity_supervisor_ticks_total",
    "Continuity supervisor ticks completed",
  ),
  supervisorLastTickEpochSeconds: new Gauge(
    "continuity_supervisor_last_tick_epoch_seconds",
    "Unix timestamp of the most recent supervisor tick (heartbeat freshness for the supervisor itself)",
  ),
  schedulerHeartbeatAgeMs: new Gauge(
    "continuity_scheduler_heartbeat_age_ms",
    "Milliseconds since the most recent continuity_scheduler tick observed by the supervisor",
  ),
  heartbeatStaleEvents: new Counter(
    "continuity_heartbeat_stale_total",
    "Times the supervisor classified the scheduler as DEAD (CONTINUITY_HEARTBEAT_STALE audits fired)",
  ),
  chainLagMs: new Gauge(
    "continuity_chain_lag_ms",
    "Per-chain milliseconds since last observed successful run (chain label)",
  ),
  chainState: new Gauge(
    "continuity_chain_state",
    "Per-chain classified state (chain + state labels; 1 = currently in this state, set to 0 on transition)",
  ),
  chainLagEvents: new Counter(
    "continuity_chain_lag_events_total",
    "Per-chain state-transition events into DEGRADED/DEAD (chain + state labels)",
  ),
};

export function renderContinuityMetrics(): string {
  return [
    continuityMetrics.ticksTotal.render(),
    continuityMetrics.tickDurationMs.render(),
    continuityMetrics.lastTickEpochSeconds.render(),
    continuityMetrics.campaignsScanned.render(),
    continuityMetrics.runsInvoked.render(),
    continuityMetrics.runsSkipped.render(),
    continuityMetrics.runsFailed.render(),
    continuityMetrics.reanchorsWritten.render(),
    continuityMetrics.missedWindows.render(),
    continuityMetrics.deadCycles.render(),
    continuityMetrics.schedulerUp.render(),
    continuityMetrics.claimsAcquired.render(),
    continuityMetrics.claimsLostToOtherReplica.render(),
    continuityMetrics.claimsAlreadyCompleted.render(),
    continuityMetrics.claimsReleasedOnFailure.render(),
    continuityMetrics.supervisorUp.render(),
    continuityMetrics.supervisorTicksTotal.render(),
    continuityMetrics.supervisorLastTickEpochSeconds.render(),
    continuityMetrics.schedulerHeartbeatAgeMs.render(),
    continuityMetrics.heartbeatStaleEvents.render(),
    continuityMetrics.chainLagMs.render(),
    continuityMetrics.chainState.render(),
    continuityMetrics.chainLagEvents.render(),
    "",
  ].join("\n\n");
}
