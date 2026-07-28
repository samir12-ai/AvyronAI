/**
 * P-6.12 — Shared Apify actor client for the acquisition layer.
 *
 * Single transport for ALL platform acquisition (Bright Data retired
 * 2026-07-28; see .local/validation/p6.12-apify-migration.md). Generalizes
 * the proven apifyFetch/waitForRun pattern from tiktok-apify-scraper.ts /
 * instagram-apify-scraper.ts (those files keep their local copies because
 * they are source-tripwired in server/tests/scrape-security.test.ts).
 *
 * Carried invariants (Seal #5):
 *   F7.1  token via Authorization header, never in URL (+ defensive strip)
 *   F6.7  15s AbortController on every direct Apify HTTP call
 *   F6.12 circuit-breaker gate on the shared "apify" breaker key
 */

const APIFY_BASE_URL = "https://api.apify.com/v2";
const HTTP_TIMEOUT_MS = 15_000;
const DEFAULT_RUN_BUDGET_MS = 300_000; // actor runtime variance observed 13–315s
const POLL_INTERVAL_MS = 5_000;

export function getApifyApiKey(): string | null {
  return process.env.APIFY_API_KEY || null;
}

export function isApifyAcquisitionConfigured(): boolean {
  return !!getApifyApiKey();
}

export interface ApifyRunData {
  id: string;
  status: string;
  defaultDatasetId: string;
  usageTotalUsd?: number;
}

/** F7.1 / F6.7 / F6.12 — the only function that talks HTTP to Apify. */
export async function apifyRequest(path: string, options: RequestInit = {}): Promise<any> {
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

async function waitForRun(runId: string, budgetMs: number, label: string): Promise<ApifyRunData> {
  const deadline = Date.now() + budgetMs;

  while (Date.now() < deadline) {
    const { data } = await apifyRequest(`/actor-runs/${runId}`);
    if (data.status === "SUCCEEDED") return data;
    if (data.status === "FAILED" || data.status === "ABORTED" || data.status === "TIMED-OUT") {
      throw new Error(`Apify run ${runId} (${label}) ended with status: ${data.status}`);
    }
    await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));
  }

  // Budget exhausted client-side: abort the run server-side so we do not keep
  // paying for a run nobody will read (double-billing on watchdog abandonment).
  try {
    await apifyRequest(`/actor-runs/${runId}/abort`, { method: "POST" });
    console.warn(`[ApifyClient] Run ${runId} (${label}) aborted after ${budgetMs / 1000}s budget`);
  } catch (abortErr: any) {
    console.warn(`[ApifyClient] Failed to abort over-budget run ${runId}: ${abortErr.message}`);
  }
  throw new Error(`Apify run ${runId} (${label}) exceeded ${budgetMs / 1000}s budget`);
}

export interface ActorRunResult {
  items: any[];
  runId: string;
  datasetId: string;
  durationMs: number;
  /** Apify-reported usage in USD when present on the run record. */
  usageUsd: number | null;
}

/**
 * Start an actor run, wait for completion within budget, and return the
 * dataset items. `actorId` uses Apify path form, e.g. "apify~instagram-comment-scraper".
 */
export async function runActorAndGetItems(opts: {
  actorId: string;
  input: Record<string, unknown>;
  budgetMs?: number;
  label?: string;
}): Promise<ActorRunResult> {
  const { actorId, input } = opts;
  const budgetMs = opts.budgetMs ?? DEFAULT_RUN_BUDGET_MS;
  const label = opts.label ?? actorId;
  const startedAt = Date.now();

  const runResponse = await apifyRequest(`/acts/${actorId}/runs`, {
    method: "POST",
    body: JSON.stringify(input),
  });
  const runId: string = runResponse.data.id;
  console.log(`[ApifyClient] ${label} run started: ${runId}`);

  const completed = await waitForRun(runId, budgetMs, label);
  const items = await apifyRequest(`/datasets/${completed.defaultDatasetId}/items?format=json&clean=true`);

  const durationMs = Date.now() - startedAt;
  const usageUsd = typeof completed.usageTotalUsd === "number" ? completed.usageTotalUsd : null;
  console.log(
    `[ApifyClient] ${label} run ${runId} done | items=${Array.isArray(items) ? items.length : 0} | ${Math.round(durationMs / 1000)}s | usage=$${usageUsd ?? "?"}`,
  );

  return {
    items: Array.isArray(items) ? items : [],
    runId,
    datasetId: completed.defaultDatasetId,
    durationMs,
    usageUsd,
  };
}

/**
 * Connectivity probe for the admin diagnostics endpoint (replaces the retired
 * Bright Data testScrapingConnectivity). Verifies the token against /users/me.
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
