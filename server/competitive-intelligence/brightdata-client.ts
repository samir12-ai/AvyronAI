/**
 * Bright Data Unlocker API client — the ONLY module that talks to
 * api.brightdata.com. Transport layer, nothing else.
 *
 * Contract (per rebuild spec, 2026-07):
 *   POST https://api.brightdata.com/request
 *   Authorization: Bearer <BRIGHT_DATA_API_KEY>
 *   Body: { zone, url, format: "raw", country? }
 *
 *   - format:"raw" returns the target page body directly. NOTE (Phase-4
 *     probe pending): whether the *target site's* HTTP status is propagated
 *     as the API response status is verified live in Phase 4. Until then we
 *     treat the API response status as the effective status. Fallback plan
 *     if raw does not propagate status: format:"json" (carries status field).
 *   - Unlocker-side errors are signalled via the `x-brd-err-code` response
 *     header (e.g. sr_rate_limit on 429). We surface that header verbatim on
 *     the synthesized Response so call-sites can classify without importing
 *     this module.
 *
 * Rules (doctrine D1/B1–B5 + architect rulings):
 *   - ZERO retries here. The proxy-pool-manager owns rotation/backoff and the
 *     orchestrator owns MAX_RETRIES. A retry loop at this layer would
 *     multiply upstream retry budgets.
 *   - Wall-clock AbortController timeout on every call (NO BARE CALLS).
 *   - NEVER log or echo the API key. Errors are sanitized.
 *   - May be imported ONLY by proxy-pool-manager.ts (+ tests). Enforced by
 *     ESLint rule `scraping-transport/no-direct-brightdata-client-import`.
 */

const UNLOCKER_ENDPOINT = "https://api.brightdata.com/request";

// Unlocker requests solve challenges server-side and routinely take longer
// than a raw proxy pass-through. The old 15s per-scraper contract (Seal #5 /
// F6.7) assumed pass-through latency; the Unlocker API needs more headroom.
// Env-tunable, defaults to 60s — same wall-clock ceiling family as the
// AI_*_HARD_TIMEOUT_MS knobs.
export const BRIGHT_DATA_TIMEOUT_MS = parseInt(
  process.env.BRIGHT_DATA_TIMEOUT_MS || "60000",
  10,
);

export class ScrapingUnconfiguredError extends Error {
  readonly code = "SCRAPING_UNCONFIGURED";
  constructor(detail?: string) {
    super(
      `SCRAPING_UNCONFIGURED: Bright Data Unlocker API is not configured${detail ? ` — ${detail}` : ""}. Set BRIGHT_DATA_API_KEY and BRIGHT_DATA_ZONE (Replit Secrets).`,
    );
    this.name = "ScrapingUnconfiguredError";
  }
}

export interface UnlockerRequestOptions {
  apiKey: string;
  zone: string;
  url: string;
  /** ISO-3166 alpha-2, lowercase. Omitted → zone default geo. */
  country?: string | null;
  timeoutMs?: number;
}

export interface UnlockerResult {
  /** Effective HTTP status (API response status; see Phase-4 note above). */
  status: number;
  /** `x-brd-err-code` header when Bright Data signals a transport error. */
  brdErrorCode: string | null;
  /** Target page body (format:"raw"). */
  body: string;
  /**
   * Synthesized Response for scraper compatibility (status + headers + body).
   * `.url`/`.redirected` are NOT meaningful on this object — verified that no
   * scraper call-site reads them.
   */
  response: Response;
  durationMs: number;
}

/** Strips anything that could leak the bearer key out of an error message. */
function sanitizeError(message: string): string {
  return (message || "")
    .replace(/Bearer\s+\S+/gi, "Bearer ***")
    .replace(/[A-Za-z0-9_-]{30,}/g, "***");
}

/**
 * Single Unlocker API request. Throws on network/timeout failure (sanitized
 * message); returns normally for ANY HTTP status (including 4xx/5xx) so the
 * caller can classify blocks explicitly rather than via thrown strings.
 */
export async function unlockerRequest(opts: UnlockerRequestOptions): Promise<UnlockerResult> {
  if (!opts.apiKey || !opts.zone) {
    throw new ScrapingUnconfiguredError("missing apiKey/zone at call time");
  }

  const timeoutMs = opts.timeoutMs ?? BRIGHT_DATA_TIMEOUT_MS;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  const startMs = Date.now();

  const payload: Record<string, string> = {
    zone: opts.zone,
    url: opts.url,
    format: "raw",
  };
  if (opts.country) payload.country = opts.country;

  try {
    const apiRes = await fetch(UNLOCKER_ENDPOINT, {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${opts.apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
      signal: controller.signal,
    });

    const body = await apiRes.text();
    const brdErrorCode =
      apiRes.headers.get("x-brd-err-code") ||
      apiRes.headers.get("x-brd-error-code") ||
      null;

    // Synthesize a Response carrying the effective status + brd headers so
    // scrapers keep their existing `res.status` / `res.text()` shape without
    // ever holding a live network handle from this layer.
    const synthHeaders = new Headers();
    const contentType = apiRes.headers.get("content-type");
    if (contentType) synthHeaders.set("content-type", contentType);
    if (brdErrorCode) synthHeaders.set("x-brd-err-code", brdErrorCode);
    // Response() forbids bodies on 204/304; normalize those to empty-body 200-family passthrough.
    const bodyAllowed = apiRes.status !== 204 && apiRes.status !== 304;
    const response = new Response(bodyAllowed ? body : null, {
      status: apiRes.status,
      headers: synthHeaders,
    });

    return {
      status: apiRes.status,
      brdErrorCode,
      body,
      response,
      durationMs: Date.now() - startMs,
    };
  } catch (err: any) {
    if (err instanceof ScrapingUnconfiguredError) throw err;
    const isAbort = err?.name === "AbortError" || /abort/i.test(err?.message || "");
    const detail = isAbort
      ? `UNLOCKER_TIMEOUT: request exceeded ${timeoutMs}ms wall-clock`
      : `UNLOCKER_NETWORK_ERROR: ${sanitizeError(err?.message || String(err))}`;
    throw new Error(detail);
  } finally {
    clearTimeout(timer);
  }
}
