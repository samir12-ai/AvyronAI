import { AsyncLocalStorage } from "async_hooks";

/**
 * P-6.12 & Unified Acquisition Authority — Shared Apify actor client.
 *
 * Single transport for ALL Apify platform acquisition.
 * Carried invariants (Seal #5):
 *   F7.1  token via Authorization header, never in URL (+ defensive strip)
 *   F6.7  15s AbortController on every direct Apify HTTP call
 *   F6.12 circuit-breaker gate on the shared "apify" breaker key
 *
 * Unified Acquisition Authority guarantees:
 *   - Immediate persistence of provider_run_id via onRunStarted BEFORE polling begins.
 *   - Resumption of existing in-flight provider_run_id on worker restart or polling timeout
 *     instead of blindly starting a second paid actor run.
 *   - Crash-window reconciliation via GET /acts/{actorId}/runs when a worker crashes
 *     between POST /acts/{actorId}/runs and recording the returned runId.
 *   - Automatic capture of runId, datasetId, actorId, durationMs, and usageUsd across
 *     all adapters via AsyncLocalStorage execution context.
 */

const APIFY_BASE_URL = "https://api.apify.com/v2";
const HTTP_TIMEOUT_MS = 15_000;
const DEFAULT_RUN_BUDGET_MS = 300_000; // actor runtime variance observed 13–315s
const POLL_INTERVAL_MS = 5_000;

export interface ApifyRunData {
  id: string;
  status: string;
  defaultDatasetId: string;
  startedAt?: string;
  finishedAt?: string;
  usageTotalUsd?: number;
}

export interface ActorRunStartedInfo {
  runId: string;
  actorId: string;
  defaultDatasetId?: string;
  reconciledFromCrashWindow?: boolean;
  resumedExistingRun?: boolean;
}

export interface ActorRunResult {
  items: any[];
  runId: string;
  datasetId: string;
  actorId?: string;
  durationMs: number;
  /** Apify-reported usage in USD when present on the run record. */
  usageUsd: number | null;
  resumedExistingRun?: boolean;
  reconciledFromCrashWindow?: boolean;
}

export interface AcquisitionAttemptExecutionContext {
  taskId: string;
  attemptId: string;
  resumeRunId?: string | null;
  reconcileStartedAfterIso?: string | null;
  preserveRunOnPollingTimeout?: boolean;
  onRunStarted?: (info: ActorRunStartedInfo) => Promise<void> | void;
  onRunCompleted?: (result: ActorRunResult) => Promise<void> | void;
  capturedRuns: ActorRunResult[];
  lastStartedRun?: ActorRunStartedInfo;
}

const attemptContextStorage = new AsyncLocalStorage<AcquisitionAttemptExecutionContext>();

export function getActiveAttemptContext(): AcquisitionAttemptExecutionContext | undefined {
  return attemptContextStorage.getStore();
}

export async function runWithAttemptContext<T>(
  ctx: AcquisitionAttemptExecutionContext,
  fn: () => Promise<T>
): Promise<T> {
  return attemptContextStorage.run(ctx, fn);
}

export class ApifyPollingTimeoutError extends Error {
  public readonly runId: string;
  public readonly actorId: string;
  public readonly budgetMs: number;

  constructor(runId: string, actorId: string, budgetMs: number, label: string) {
    super(`Apify run ${runId} (${label}) polling timed out after ${budgetMs / 1000}s; runId preserved for polling resumption`);
    this.name = "ApifyPollingTimeoutError";
    this.runId = runId;
    this.actorId = actorId;
    this.budgetMs = budgetMs;
  }
}

type CustomApifyHttpHandler = (path: string, options: RequestInit) => Promise<any>;
let testHttpHandler: CustomApifyHttpHandler | null = null;
let pollIntervalOverrideMs: number | null = null;

/** Test-only hook for behavioral integration tests. Pass null to restore live HTTP. */
export function setApifyTestHttpHandler(
  handler: CustomApifyHttpHandler | null,
  opts?: { pollIntervalMs?: number | null }
): void {
  testHttpHandler = handler;
  pollIntervalOverrideMs = opts?.pollIntervalMs ?? null;
}

export function getApifyApiKey(): string | null {
  if (process.env.AVYRON_DEMO_MODE === "1") return null;
  if (testHttpHandler) return process.env.APIFY_API_KEY || "test_apify_key_for_behavioral_suite";
  return process.env.APIFY_API_KEY || null;
}

export function isApifyAcquisitionConfigured(): boolean {
  if (process.env.AVYRON_DEMO_MODE === "1") return false;
  if (testHttpHandler) return true;
  return !!getApifyApiKey();
}

/** F7.1 / F6.7 / F6.12 — the only function that talks HTTP to Apify. */
export async function apifyRequest(path: string, options: RequestInit = {}): Promise<any> {
  if (process.env.AVYRON_DEMO_MODE === "1") {
    throw new Error("DEMO_MODE_ACQUISITION_BLOCKED: Live Apify acquisition is disabled in AVYRON_DEMO_MODE.");
  }
  const apiKey = getApifyApiKey();
  if (!apiKey) throw new Error("APIFY_API_KEY not configured");

  const { isBreakerOpen, recordBreakerSuccess, recordBreakerFailure } = await import(
    "../competitive-intelligence/scrape-safety"
  );
  const cb = isBreakerOpen("apify", "default");
  if (cb.open) {
    throw new Error(`BREAKER_OPEN: apify:default (${cb.reason})`);
  }

  // F7.1 — never put the Apify token in the URL; strip any ?token= defensively.
  const cleanedPath = path.replace(/([?&])token=[^&]*(&|$)/g, (_m, lead, tail) =>
    lead === "?" && tail === "" ? "" : lead === "&" && tail === "" ? "" : lead === "?" ? "?" : "&",
  );

  if (testHttpHandler) {
    try {
      const result = await testHttpHandler(cleanedPath, options);
      recordBreakerSuccess("apify", "default");
      return result;
    } catch (err) {
      recordBreakerFailure("apify", "default");
      throw err;
    }
  }

  const url = `${APIFY_BASE_URL}${cleanedPath}`;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), HTTP_TIMEOUT_MS);
  let res: Response;
  try {
    res = await fetch(url, {
      ...options,
      signal: controller.signal,
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
        ...(options.headers || {}),
      },
    });
  } catch (err) {
    recordBreakerFailure("apify", "default");
    throw err;
  } finally {
    clearTimeout(timer);
  }

  if (!res.ok) {
    recordBreakerFailure("apify", "default");
    const body = await res.text();
    throw new Error(`Apify API ${res.status}: ${body.substring(0, 300)}`);
  }

  recordBreakerSuccess("apify", "default");
  return res.json();
}

/**
 * Reconciles the crash window between sending POST /acts/{actorId}/runs and persisting provider_run_id.
 * Queries recent runs for this actor started at or after `startedAfterIso`.
 */
export async function reconcileCrashWindowRun(
  actorId: string,
  startedAfterIso: string
): Promise<ApifyRunData | null> {
  try {
    const afterMs = new Date(startedAfterIso).getTime() - 5_000; // 5s clock-skew tolerance
    if (Number.isNaN(afterMs)) return null;

    const res = await apifyRequest(`/acts/${actorId}/runs?desc=true&limit=5`);
    const items: any[] = Array.isArray(res?.data?.items)
      ? res.data.items
      : Array.isArray(res?.items)
        ? res.items
        : [];

    for (const run of items) {
      if (!run?.id) continue;
      const runStartMs = run.startedAt ? new Date(run.startedAt).getTime() : 0;
      if (runStartMs >= afterMs && (run.status === "RUNNING" || run.status === "READY" || run.status === "SUCCEEDED")) {
        console.log(
          `[ApifyClient] Reconciled crash-window run ${run.id} for actor ${actorId} (status=${run.status}, startedAt=${run.startedAt})`
        );
        return {
          id: run.id,
          status: run.status,
          defaultDatasetId: run.defaultDatasetId || "",
          startedAt: run.startedAt,
          usageTotalUsd: typeof run.usageTotalUsd === "number" ? run.usageTotalUsd : undefined,
        };
      }
    }
  } catch (err: any) {
    console.warn(`[ApifyClient] Crash-window reconciliation check failed for ${actorId}: ${err?.message || err}`);
  }
  return null;
}

async function waitForRun(
  runId: string,
  actorId: string,
  budgetMs: number,
  label: string,
  preserveRunOnPollingTimeout: boolean
): Promise<ApifyRunData> {
  const deadline = Date.now() + budgetMs;
  const pollMs = pollIntervalOverrideMs ?? POLL_INTERVAL_MS;

  while (Date.now() < deadline) {
    const { data } = await apifyRequest(`/actor-runs/${runId}`);
    if (data.status === "SUCCEEDED") return data;
    if (data.status === "FAILED" || data.status === "ABORTED" || data.status === "TIMED-OUT") {
      throw new Error(`Apify run ${runId} (${label}) ended with status: ${data.status}`);
    }
    await new Promise((r) => setTimeout(r, pollMs));
  }

  if (preserveRunOnPollingTimeout) {
    console.warn(
      `[ApifyClient] Run ${runId} (${label}) still running after ${budgetMs / 1000}s poll window; preserving runId for durable poll resumption.`
    );
    throw new ApifyPollingTimeoutError(runId, actorId, budgetMs, label);
  }

  // Legacy non-durable fallback: abort over-budget run server-side
  try {
    await apifyRequest(`/actor-runs/${runId}/abort`, { method: "POST" });
    console.warn(`[ApifyClient] Run ${runId} (${label}) aborted after ${budgetMs / 1000}s budget`);
  } catch (abortErr: any) {
    console.warn(`[ApifyClient] Failed to abort over-budget run ${runId}: ${abortErr.message}`);
  }
  throw new Error(`Apify run ${runId} (${label}) exceeded ${budgetMs / 1000}s budget`);
}

/**
 * Start (or resume) an actor run, persist provider_run_id immediately before polling,
 * wait for completion within budget, and return the dataset items + cost telemetry.
 */
export async function runActorAndGetItems(opts: {
  actorId: string;
  input: Record<string, unknown>;
  budgetMs?: number;
  label?: string;
  resumeRunId?: string | null;
  reconcileStartedAfterIso?: string | null;
  preserveRunOnPollingTimeout?: boolean;
  onRunStarted?: (info: ActorRunStartedInfo) => Promise<void> | void;
}): Promise<ActorRunResult> {
  const { actorId, input } = opts;
  const budgetMs = opts.budgetMs ?? DEFAULT_RUN_BUDGET_MS;
  const label = opts.label ?? actorId;
  const startedAt = Date.now();
  const ctx = getActiveAttemptContext();

  const effectiveResumeRunId = opts.resumeRunId ?? ctx?.resumeRunId ?? null;
  const effectiveReconcileAfter = opts.reconcileStartedAfterIso ?? ctx?.reconcileStartedAfterIso ?? null;
  const preserveRunOnTimeout = opts.preserveRunOnPollingTimeout ?? ctx?.preserveRunOnPollingTimeout ?? true;

  let runId: string | null = null;
  let defaultDatasetId: string | undefined;
  let resumedExistingRun = false;
  let reconciledFromCrashWindow = false;

  // 1. Resume existing provider_run_id if recovering from worker crash or polling timeout
  if (effectiveResumeRunId) {
    runId = effectiveResumeRunId;
    resumedExistingRun = true;
    // Clear resumeRunId on context so subsequent actor calls in a multi-step flow don't reuse it
    if (ctx) ctx.resumeRunId = null;
    console.log(`[ApifyClient] ${label} resuming existing provider_run_id: ${runId}`);
  } else if (effectiveReconcileAfter) {
    // 2. Crash-window reconciliation: check if a run was already started right before crash
    if (ctx) ctx.reconcileStartedAfterIso = null;
    const reconciled = await reconcileCrashWindowRun(actorId, effectiveReconcileAfter);
    if (reconciled) {
      runId = reconciled.id;
      defaultDatasetId = reconciled.defaultDatasetId;
      reconciledFromCrashWindow = true;
    }
  }

  // 3. Otherwise start a new Apify actor run
  if (!runId) {
    const runResponse = await apifyRequest(`/acts/${actorId}/runs`, {
      method: "POST",
      body: JSON.stringify(input),
    });
    runId = runResponse.data.id;
    defaultDatasetId = runResponse.data.defaultDatasetId;
    console.log(`[ApifyClient] ${label} run started: ${runId}`);
  }

  const startedInfo: ActorRunStartedInfo = {
    runId: runId!,
    actorId,
    defaultDatasetId,
    resumedExistingRun,
    reconciledFromCrashWindow,
  };

  if (ctx) {
    ctx.lastStartedRun = startedInfo;
  }

  // IMMEDIATELY persist provider_run_id before polling begins!
  if (opts.onRunStarted) {
    try {
      await opts.onRunStarted(startedInfo);
    } catch (cbErr: any) {
      console.warn(`[ApifyClient] onRunStarted callback warning for ${runId}: ${cbErr?.message || cbErr}`);
    }
  }
  if (ctx?.onRunStarted) {
    try {
      await ctx.onRunStarted(startedInfo);
    } catch (cbErr: any) {
      console.warn(`[ApifyClient] ctx.onRunStarted callback warning for ${runId}: ${cbErr?.message || cbErr}`);
    }
  }

  const completed = await waitForRun(runId!, actorId, budgetMs, label, preserveRunOnTimeout);
  const finalDatasetId = completed.defaultDatasetId || defaultDatasetId || "";
  const items = await apifyRequest(`/datasets/${finalDatasetId}/items?format=json&clean=true`);

  const durationMs = Date.now() - startedAt;
  const usageUsd = typeof completed.usageTotalUsd === "number" ? completed.usageTotalUsd : null;
  console.log(
    `[ApifyClient] ${label} run ${runId} done | items=${Array.isArray(items) ? items.length : 0} | ${Math.round(durationMs / 1000)}s | usage=$${usageUsd ?? "?"}`,
  );

  const result: ActorRunResult = {
    items: Array.isArray(items) ? items : [],
    runId: runId!,
    datasetId: finalDatasetId,
    actorId,
    durationMs,
    usageUsd,
    resumedExistingRun,
    reconciledFromCrashWindow,
  };

  if (ctx) {
    if (!Array.isArray(ctx.capturedRuns)) {
      ctx.capturedRuns = [];
    }
    ctx.capturedRuns.push(result);
    if (ctx.onRunCompleted) {
      try {
        await ctx.onRunCompleted(result);
      } catch (cbErr: any) {
        console.warn(`[ApifyClient] ctx.onRunCompleted callback warning for ${runId}: ${cbErr?.message || cbErr}`);
      }
    }
  }

  return result;
}

/**
 * Connectivity probe for the admin diagnostics endpoint. Verifies the token against /users/me.
 */
export async function testApifyConnectivity(): Promise<{
  ok: boolean;
  provider: "apify";
  detail: string;
}> {
  if (!isApifyAcquisitionConfigured()) {
    return { ok: false, provider: "apify", detail: "APIFY_API_KEY not configured" };
  }
  try {
    const me = await apifyRequest(`/users/me`);
    const username = me?.data?.username || me?.data?.id || "unknown";
    return { ok: true, provider: "apify", detail: `Authenticated as ${username}` };
  } catch (err: any) {
    return { ok: false, provider: "apify", detail: err.message?.substring(0, 200) || "unknown error" };
  }
}
