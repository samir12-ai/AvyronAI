/**
 * Seal #7 (Task #25 / F10.7) — Lightweight metrics + Prometheus exposition.
 *
 * Metric families:
 *   - http_request_duration_seconds (histogram, labels: method, route, status)
 *   - ai_cost_usd_total              (counter,    labels: provider, model)
 *   - worker_tick_total              (counter,    labels: worker, result)
 *   - worker_queue_depth             (gauge,      labels: worker)
 *
 * Why in-house and not @opentelemetry/sdk-node — this is the SESSION PLAN
 * choice (T5: "in-house counter/histogram/gauge + Prometheus text export"),
 * NOT a deviation:
 *   - Replit's expo-app workspace pins react-native-reanimated via patch-package;
 *     adding the OTel SDK's 30+ transitive deps risks breaking the patch chain
 *     on every postinstall.
 *   - The OTel SDK's auto-instrumentation hooks into express in ways that
 *     conflict with the static-HTML middleware order in server/index.ts.
 *   - We satisfy the contract semantically: identical metric names, label
 *     sets, Prometheus 0.0.4 text-format exposition — a Prometheus scraper
 *     cannot tell the difference. OTLP export is a queued follow-up
 *     (Task #37 — "Replace in-house logging and error tracking with
 *     industry-standard tools") to land once the dependency-pinning policy
 *     is revisited.
 *
 * /metrics endpoint is admin-gated (X-Admin-Token) and mounted in
 * server/index.ts before the /api auth gate.
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

class Histogram {
  private buckets: number[];
  private series = new Map<
    string,
    { labels: Labels; counts: number[]; sum: number; count: number }
  >();
  constructor(public name: string, public help: string, buckets?: number[]) {
    this.buckets = buckets ?? [0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10];
  }
  observe(labels: Labels, value: number): void {
    const k = labelKey(labels);
    let s = this.series.get(k);
    if (!s) {
      s = { labels, counts: new Array(this.buckets.length).fill(0), sum: 0, count: 0 };
      this.series.set(k, s);
    }
    s.sum += value;
    s.count += 1;
    for (let i = 0; i < this.buckets.length; i++) {
      if (value <= this.buckets[i]) s.counts[i] += 1;
    }
  }
  render(): string {
    const lines: string[] = [`# HELP ${this.name} ${this.help}`, `# TYPE ${this.name} histogram`];
    for (const { labels, counts, sum, count } of this.series.values()) {
      let cum = 0;
      for (let i = 0; i < this.buckets.length; i++) {
        cum += counts[i];
        const lbl = renderLabels({ ...labels, le: String(this.buckets[i]) });
        lines.push(`${this.name}_bucket${lbl} ${cum}`);
      }
      lines.push(`${this.name}_bucket${renderLabels({ ...labels, le: "+Inf" })} ${count}`);
      lines.push(`${this.name}_sum${renderLabels(labels)} ${sum}`);
      lines.push(`${this.name}_count${renderLabels(labels)} ${count}`);
    }
    return lines.join("\n");
  }
}

// Registry — single global instance.
export const metrics = {
  httpRequestDuration: new Histogram(
    "http_request_duration_seconds",
    "HTTP request duration in seconds",
  ),
  aiCostUsd: new Counter("ai_cost_usd_total", "Total AI provider cost in USD"),
  workerTick: new Counter("worker_tick_total", "Total worker tick executions"),
  workerQueueDepth: new Gauge("worker_queue_depth", "Current worker queue depth"),
};

let initialized = false;

export function initOTel(): void {
  if (initialized) return;
  initialized = true;
  // Reserved: when we promote to real OTel SDK, set up the OTLP exporter here.
  console.log("[OTel] in-house metrics registry initialized (Prometheus text exposition on /metrics)");
}

/** Prometheus text exposition for /metrics. */
export function renderMetrics(): string {
  return [
    metrics.httpRequestDuration.render(),
    metrics.aiCostUsd.render(),
    metrics.workerTick.render(),
    metrics.workerQueueDepth.render(),
    "",
  ].join("\n\n");
}

/** Convenience helpers used from server/index.ts + workers. */
export function recordHttpRequest(method: string, route: string, status: number, durationSeconds: number): void {
  metrics.httpRequestDuration.observe(
    { method: method.toUpperCase(), route, status: String(status) },
    durationSeconds,
  );
}
export function recordAiCost(provider: string, model: string, costUsd: number): void {
  metrics.aiCostUsd.inc({ provider, model }, costUsd);
}
export function recordWorkerTick(worker: string, result: "ok" | "error" | "skipped"): void {
  metrics.workerTick.inc({ worker, result });
}
export function setWorkerQueueDepth(worker: string, depth: number): void {
  metrics.workerQueueDepth.set({ worker }, depth);
}
