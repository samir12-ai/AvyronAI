/**
 * Task #89 / Phase 4-A — CV-13 ReplayCorpusFreshness metrics.
 *
 * Mounted on /metrics via server/index.ts.
 *
 * Families:
 *   - cv13_replay_cassettes_total{source}             counter (PROCESS-LOCAL:
 *     captures observed since process start, not corpus cardinality —
 *     resets to 0 on restart. For total corpus size, query the
 *     orchestrator_replay_cassettes table directly. The age-of-corpus gauge
 *     cv13_replay_age_max_hours IS DB-derived; this counter is a delta
 *     signal for capture rate, not a stock measurement.)
 *   - cv13_replay_age_max_hours                       gauge
 *   - cv13_replay_recorder_overhead_ratio             gauge (rolling p50, 5min)
 *   - cv13_replay_player_runs_total{outcome}          counter
 *
 * Alarm threshold (operator runbook):
 *   - cv13_replay_age_max_hours > 168 (7d) → corpus is going stale; bump
 *     ORCH_REPLAY_RECORD sample rate or investigate why sampling stopped.
 *   - cv13_replay_recorder_overhead_ratio (rolling p50) > 0.02 → recorder
 *     is exceeding its 2% wall-clock budget; halve the sample rate.
 */

type CounterLabels = Record<string, string>;

class InMemoryCounter {
  private readonly counts = new Map<string, { labels: CounterLabels; value: number }>();
  inc(labels: CounterLabels, by = 1): void {
    const k = labelKey(labels);
    const cur = this.counts.get(k);
    if (cur) cur.value += by;
    else this.counts.set(k, { labels, value: by });
  }
  collect(): Array<{ labels: CounterLabels; value: number }> {
    return Array.from(this.counts.values());
  }
  reset(): void {
    this.counts.clear();
  }
}

class InMemoryGauge {
  private value = 0;
  set(v: number): void {
    this.value = v;
  }
  get(): number {
    return this.value;
  }
  reset(): void {
    this.value = 0;
  }
}

/**
 * Rolling-window p50 overhead ratio. We keep raw samples for the last 5 min
 * and recompute on read. Bounded sample count to keep memory predictable.
 */
class RollingP50 {
  private readonly samples: Array<{ at: number; value: number }> = [];
  private readonly maxSamples = 1024;
  private readonly windowMs = 5 * 60 * 1000;
  observe(value: number, now = Date.now()): void {
    this.samples.push({ at: now, value });
    if (this.samples.length > this.maxSamples) this.samples.shift();
  }
  p50(now = Date.now()): number {
    const fresh = this.samples.filter((s) => now - s.at <= this.windowMs);
    if (fresh.length === 0) return 0;
    const sorted = fresh.map((s) => s.value).sort((a, b) => a - b);
    const mid = Math.floor(sorted.length / 2);
    return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
  }
  reset(): void {
    this.samples.length = 0;
  }
}

function labelKey(labels: CounterLabels): string {
  return Object.keys(labels)
    .sort()
    .map((k) => `${k}=${labels[k]}`)
    .join("|");
}

const cassettesTotal = new InMemoryCounter();
const ageMaxHoursGauge = new InMemoryGauge();
const overheadP50 = new RollingP50();
const playerRunsTotal = new InMemoryCounter();

export function recordCassetteCaptured(source: "production" | "synthetic"): void {
  cassettesTotal.inc({ source });
}

export function setCassetteAgeMaxHours(hours: number): void {
  ageMaxHoursGauge.set(hours);
}

/**
 * Refresh `cv13_replay_age_max_hours` directly from the cassette table.
 * Called from the /metrics scrape path so the gauge is accurate at read
 * time WITHOUT depending on the admin panel being exercised. Bounded:
 * single MIN() query, no row scan. On query failure we leave the
 * previous value in place (a stale gauge is preferable to a 0 reading
 * which would silently signal "fresh corpus").
 */
export async function refreshCassetteAgeFromDb(
  query: (sql: string) => Promise<{ rows: Array<{ oldest: Date | string | null }> }>,
  now: () => number = () => Date.now(),
): Promise<void> {
  try {
    const r = await query(`SELECT MIN(captured_at) AS oldest FROM orchestrator_replay_cassettes`);
    const oldest = r.rows[0]?.oldest;
    if (!oldest) {
      ageMaxHoursGauge.set(0);
      return;
    }
    const oldestMs = new Date(oldest).getTime();
    ageMaxHoursGauge.set(Math.max(0, (now() - oldestMs) / 3_600_000));
  } catch {
    // Intentionally swallow — see helper docstring; stale > zero.
    // eslint-disable-next-line no-console
    console.warn("[cv13-metrics] refreshCassetteAgeFromDb failed; keeping prior gauge value");
  }
}

export function recordRecorderOverheadRatio(ratio: number): void {
  overheadP50.observe(ratio);
}

export function recordPlayerRun(outcome: "PASS" | "FAIL" | "ERROR"): void {
  playerRunsTotal.inc({ outcome });
}

export function _resetCv13MetricsForTests(): void {
  cassettesTotal.reset();
  ageMaxHoursGauge.reset();
  overheadP50.reset();
  playerRunsTotal.reset();
}

/** Test helper — read the rolling p50 overhead ratio. */
export function _getCv13OverheadP50(): number {
  return overheadP50.p50();
}

function escapeLabel(v: string): string {
  return v.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
}

function renderLabels(labels: CounterLabels): string {
  const parts = Object.entries(labels).map(([k, v]) => `${k}="${escapeLabel(v)}"`);
  return parts.length ? `{${parts.join(",")}}` : "";
}

export function renderCv13Metrics(): string {
  const lines: string[] = [];
  lines.push(`# HELP cv13_replay_cassettes_total CV-13: cassettes captured since process start, by source (PROCESS-LOCAL counter; NOT total corpus size — query orchestrator_replay_cassettes for cardinality).`);
  lines.push(`# TYPE cv13_replay_cassettes_total counter`);
  for (const { labels, value } of cassettesTotal.collect()) {
    lines.push(`cv13_replay_cassettes_total${renderLabels(labels)} ${value}`);
  }
  lines.push(`# HELP cv13_replay_age_max_hours CV-13: age in hours of the oldest cassette in the corpus.`);
  lines.push(`# TYPE cv13_replay_age_max_hours gauge`);
  lines.push(`cv13_replay_age_max_hours ${ageMaxHoursGauge.get()}`);
  lines.push(`# HELP cv13_replay_recorder_overhead_ratio CV-13: rolling 5-min p50 of (recorder overhead ms / total run ms). Steady-state expectation: <0.02 at sample:50.`);
  lines.push(`# TYPE cv13_replay_recorder_overhead_ratio gauge`);
  lines.push(`cv13_replay_recorder_overhead_ratio ${overheadP50.p50()}`);
  lines.push(`# HELP cv13_replay_player_runs_total CV-13: replay player runs, by outcome.`);
  lines.push(`# TYPE cv13_replay_player_runs_total counter`);
  for (const { labels, value } of playerRunsTotal.collect()) {
    lines.push(`cv13_replay_player_runs_total${renderLabels(labels)} ${value}`);
  }
  return lines.join("\n");
}
