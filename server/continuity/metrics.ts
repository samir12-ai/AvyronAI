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
    "",
  ].join("\n\n");
}
