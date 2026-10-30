import crypto from "crypto";

/**
 * Canonical Error & Terminal Outcome Contract for Avyron's Unified Acquisition Authority.
 *
 * Enforces Requirement #4 (Intelligent, Bounded Retries):
 * - Distinguishes invalid input/config, missing/unconfigured actor, auth/permission errors,
 *   rate limits/quotas, transient provider errors, timeouts, partial coverage, confirmed empty
 *   sources, and unknown/failed acquisition.
 * - Never retries permanent invalid/config/unsupported/auth errors.
 * - Preserves providerRunId on polling timeouts so worker recovery resumes polling existing runs
 *   instead of blindly starting a new paid run.
 * - Empty arrays or HTTP 200 alone never turn adapter errors into "no content".
 */

export type AcquisitionErrorCode =
  | "NONE"
  | "INVALID_INPUT_OR_CONFIG"
  | "MISSING_ACTOR_OR_UNSUPPORTED"
  | "AUTH_OR_PERMISSION_ERROR"
  | "RATE_LIMIT_OR_QUOTA"
  | "TRANSIENT_PROVIDER_ERROR"
  | "TIMEOUT"
  | "PARTIAL_COVERAGE"
  | "CONFIRMED_EMPTY_SOURCE"
  | "INCONCLUSIVE_ZERO_RESULT"
  | "ACQUISITION_FAILED";

export type TerminalOutcome =
  | "SUCCESS_WITH_CONTENT"
  | "COMPLETE_SUCCESS"
  | "PARTIAL_SUCCESS"
  | "PARTIAL_COVERAGE"
  | "CONFIRMED_EMPTY_SOURCE"
  | "INCONCLUSIVE_ZERO_RESULT"
  | "INSUFFICIENT_COVERAGE"
  | "UNSUPPORTED_CAPABILITY"
  | "MISSING_ACTOR_OR_UNSUPPORTED"
  | "INVALID_INPUT_OR_CONFIG"
  | "AUTH_OR_PERMISSION_ERROR"
  | "RATE_LIMIT_OR_QUOTA"
  | "TIMEOUT"
  | "ACQUISITION_FAILED"
  | "DEFERRED_BUDGET";

export type RetryDecision =
  | "NO_RETRY_SUCCESS"
  | "NO_RETRY_CONFIRMED_EMPTY"
  | "NO_RETRY_INCONCLUSIVE_EMPTY"
  | "NO_RETRY_PERMANENT_ERROR"
  | "NO_RETRY_MAX_ATTEMPTS_EXHAUSTED"
  | "RETRY_BACKOFF_TRANSIENT"
  | "RETRY_BACKOFF_RATE_LIMIT"
  | "RESUME_POLLING_EXISTING_RUN"
  | "DEFER_NEXT_CYCLE";

export interface ClassifiedAcquisitionError {
  errorCode: AcquisitionErrorCode;
  terminalOutcome: TerminalOutcome;
  retryable: boolean;
  retryDecision: RetryDecision;
  preserveProviderRunForPolling: boolean;
  baseBackoffMs: number;
  normalizedMessage: string;
}

export const ACQUISITION_RETRY_POLICY = {
  DEFAULT_MAX_RETRIES: 2, // 1 initial attempt + up to 2 retries = 3 bounded attempts total
  BASE_BACKOFF_MS: 15_000, // 15s -> 30s -> 60s
  RATE_LIMIT_BASE_BACKOFF_MS: 60_000, // 60s -> 120s -> 240s
  TIMEOUT_POLL_BACKOFF_MS: 10_000, // 10s before re-polling existing provider_run_id
  MAX_BACKOFF_MS: 15 * 60 * 1000, // 15 minutes hard cap
  JITTER_RATIO: 0.2, // ±20% jitter
} as const;

export interface ClassifyAcquisitionInput {
  error?: unknown;
  itemsCount?: number;
  isConfirmedEmpty?: boolean;
  isPartialCoverage?: boolean;
  httpStatus?: number | null;
  retryAfterMs?: number | null;
  attemptNumber?: number;
  maxRetries?: number;
  hasProviderRunId?: boolean;
}

/**
 * Classifies an adapter or transport outcome/error into the canonical error contract.
 */
export function classifyAcquisitionError(
  errOrInput: unknown | ClassifyAcquisitionInput,
  opts?: {
    attemptNumber?: number;
    maxRetries?: number;
    hasProviderRunId?: boolean;
    httpStatus?: number;
    retryAfterMs?: number | null;
  }
): ClassifiedAcquisitionError & { errorCode: AcquisitionErrorCode | null; retryAfterMs?: number | null } {
  const isStructured =
    typeof errOrInput === "object" &&
    errOrInput !== null &&
    !(errOrInput instanceof Error) &&
    ("error" in errOrInput ||
      "itemsCount" in errOrInput ||
      "isConfirmedEmpty" in errOrInput ||
      "isPartialCoverage" in errOrInput);

  const structured: ClassifyAcquisitionInput = isStructured
    ? (errOrInput as ClassifyAcquisitionInput)
    : { error: errOrInput };

  // Handle non-error completion outcomes first (only when no error is present!)
  if (!structured.error) {
    const items = structured.itemsCount ?? 0;
    if (structured.isPartialCoverage) {
      return {
        errorCode: "PARTIAL_COVERAGE",
        terminalOutcome: "PARTIAL_COVERAGE",
        retryable: false,
        retryDecision: "NO_RETRY_SUCCESS",
        preserveProviderRunForPolling: false,
        baseBackoffMs: 0,
        normalizedMessage: "Partial coverage acquired",
      };
    }
    if (items === 0) {
      if (structured.isConfirmedEmpty === true) {
        return {
          errorCode: null,
          terminalOutcome: "CONFIRMED_EMPTY_SOURCE",
          retryable: false,
          retryDecision: "NO_RETRY_CONFIRMED_EMPTY",
          preserveProviderRunForPolling: false,
          baseBackoffMs: 0,
          normalizedMessage: "Confirmed empty source",
        };
      }
      return {
        errorCode: "INCONCLUSIVE_ZERO_RESULT",
        terminalOutcome: "INCONCLUSIVE_ZERO_RESULT",
        retryable: false,
        retryDecision: "NO_RETRY_INCONCLUSIVE_EMPTY",
        preserveProviderRunForPolling: false,
        baseBackoffMs: 0,
        normalizedMessage: "Actor returned 0 items without independent confirmation that source is empty",
      };
    }
    return {
      errorCode: null,
      terminalOutcome: "SUCCESS_WITH_CONTENT",
      retryable: false,
      retryDecision: "NO_RETRY_SUCCESS",
      preserveProviderRunForPolling: false,
      baseBackoffMs: 0,
      normalizedMessage: "Success",
    };
  }

  const targetErr = structured.error;
  const rawMessage =
    typeof targetErr === "string"
      ? targetErr
      : targetErr instanceof Error
        ? targetErr.message
        : String(targetErr ?? "Unknown acquisition error");

  const msg = sanitizeLogString(rawMessage);
  const lower = msg.toLowerCase();
  const attemptNumber = structured.attemptNumber ?? opts?.attemptNumber ?? 1;
  const maxRetries = structured.maxRetries ?? opts?.maxRetries ?? ACQUISITION_RETRY_POLICY.DEFAULT_MAX_RETRIES;
  const canRetryMore = attemptNumber <= maxRetries;
  const hasProviderRunId = Boolean(structured.hasProviderRunId ?? opts?.hasProviderRunId);
  const httpStatus = structured.httpStatus ?? opts?.httpStatus ?? undefined;
  const retryAfterMs = structured.retryAfterMs ?? opts?.retryAfterMs ?? null;

  // 1. Missing actor or unsupported capability (PERMANENT - never retry)
  if (
    httpStatus === 404 ||
    lower.includes("apify api 404") ||
    lower.includes("apify http 404") ||
    lower.includes("actor was not found") ||
    lower.includes("not configured") ||
    lower.includes("unsupported_provider") ||
    lower.includes("unsupported_capability") ||
    lower.includes("unsupported_source") ||
    lower.includes("provider_pending") ||
    lower.includes("actor not found") ||
    lower.includes("record-not-found") ||
    lower.includes("no working adapter") ||
    lower.includes("coming_soon")
  ) {
    return {
      errorCode: "MISSING_ACTOR_OR_UNSUPPORTED",
      terminalOutcome: "UNSUPPORTED_CAPABILITY",
      retryable: false,
      retryDecision: "NO_RETRY_PERMANENT_ERROR",
      preserveProviderRunForPolling: false,
      baseBackoffMs: 0,
      normalizedMessage: msg,
      retryAfterMs,
    };
  }

  // 2. Invalid input or schema/config error, including Apify HTTP 400 (PERMANENT - never retry)
  if (
    httpStatus === 400 ||
    lower.includes("apify http 400") ||
    lower.includes("apify api 400") ||
    lower.includes("invalid input") ||
    lower.includes("invalid-input") ||
    lower.includes("invalid_input") ||
    lower.includes("invalid_handle") ||
    lower.includes("invalid_root_url") ||
    lower.includes("source_invalid") ||
    lower.includes("company not found") ||
    lower.includes("profile not found") ||
    lower.includes("page not found") ||
    lower.includes("cross_competitor_attribution_mismatch") ||
    lower.includes("ssrf") ||
    lower.includes("private ip") ||
    lower.includes("schema validation") ||
    lower.includes("missing handle/url") ||
    lower.includes("missing channelurl") ||
    lower.includes("missing target url")
  ) {
    return {
      errorCode: "INVALID_INPUT_OR_CONFIG",
      terminalOutcome: "INVALID_INPUT_OR_CONFIG",
      retryable: false,
      retryDecision: "NO_RETRY_PERMANENT_ERROR",
      preserveProviderRunForPolling: false,
      baseBackoffMs: 0,
      normalizedMessage: msg,
      retryAfterMs,
    };
  }

  // 3. Authentication or permission errors (PERMANENT - never retry)
  if (
    httpStatus === 401 ||
    httpStatus === 403 ||
    lower.includes("apify http 401") ||
    lower.includes("apify api 401") ||
    lower.includes("apify http 403") ||
    lower.includes("apify api 403") ||
    lower.includes("unauthorized") ||
    lower.includes("invalid token") ||
    lower.includes("authentication failed") ||
    lower.includes("permission denied") ||
    lower.includes("private account")
  ) {
    return {
      errorCode: "AUTH_OR_PERMISSION_ERROR",
      terminalOutcome: "AUTH_OR_PERMISSION_ERROR",
      retryable: false,
      retryDecision: "NO_RETRY_PERMANENT_ERROR",
      preserveProviderRunForPolling: false,
      baseBackoffMs: 0,
      normalizedMessage: msg,
      retryAfterMs,
    };
  }

  // 4. Rate limits or quota exhaustion (TRANSIENT with longer backoff)
  if (
    httpStatus === 429 ||
    httpStatus === 402 ||
    lower.includes("429") ||
    lower.includes("rate limit") ||
    lower.includes("rate_limit") ||
    lower.includes("quota") ||
    lower.includes("memory limit") ||
    lower.includes("actor-memory-limit-exceeded") ||
    lower.includes("monthly usage")
  ) {
    return {
      errorCode: "RATE_LIMIT_OR_QUOTA",
      terminalOutcome: "RATE_LIMIT_OR_QUOTA",
      retryable: canRetryMore,
      retryDecision: canRetryMore ? "RETRY_BACKOFF_RATE_LIMIT" : "NO_RETRY_MAX_ATTEMPTS_EXHAUSTED",
      preserveProviderRunForPolling: false,
      baseBackoffMs: ACQUISITION_RETRY_POLICY.RATE_LIMIT_BASE_BACKOFF_MS,
      normalizedMessage: msg,
      retryAfterMs,
    };
  }

  // 5. Polling / execution timeouts (DO NOT blindly start a new provider run if providerRunId exists!)
  if (
    lower.includes("timed out") ||
    lower.includes("timeout") ||
    lower.includes("timed-out") ||
    lower.includes("aborted") ||
    lower.includes("aborterror")
  ) {
    const isRemoteRunTerminalTimeout = lower.includes("ended with status: timed-out") || lower.includes("status=timed-out");
    const shouldResumePolling = hasProviderRunId && !isRemoteRunTerminalTimeout;

    return {
      errorCode: "TIMEOUT",
      terminalOutcome: "TIMEOUT",
      retryable: canRetryMore,
      retryDecision: !canRetryMore
        ? "NO_RETRY_MAX_ATTEMPTS_EXHAUSTED"
        : shouldResumePolling
          ? "RESUME_POLLING_EXISTING_RUN"
          : "RETRY_BACKOFF_TRANSIENT",
      preserveProviderRunForPolling: shouldResumePolling,
      baseBackoffMs: shouldResumePolling
        ? ACQUISITION_RETRY_POLICY.TIMEOUT_POLL_BACKOFF_MS
        : ACQUISITION_RETRY_POLICY.BASE_BACKOFF_MS,
      normalizedMessage: msg,
      retryAfterMs,
    };
  }

  // 6. Transient upstream / network / 5xx / breaker errors
  if (
    (httpStatus && httpStatus >= 500) ||
    lower.includes("500") ||
    lower.includes("502") ||
    lower.includes("503") ||
    lower.includes("504") ||
    lower.includes("breaker_open") ||
    lower.includes("econnreset") ||
    lower.includes("connection reset") ||
    lower.includes("etimedout") ||
    lower.includes("enotfound") ||
    lower.includes("fetch failed") ||
    lower.includes("network")
  ) {
    return {
      errorCode: "TRANSIENT_PROVIDER_ERROR",
      terminalOutcome: "ACQUISITION_FAILED",
      retryable: canRetryMore,
      retryDecision: canRetryMore ? "RETRY_BACKOFF_TRANSIENT" : "NO_RETRY_MAX_ATTEMPTS_EXHAUSTED",
      preserveProviderRunForPolling: false,
      baseBackoffMs: ACQUISITION_RETRY_POLICY.BASE_BACKOFF_MS,
      normalizedMessage: msg,
      retryAfterMs,
    };
  }

  // 7. Default unknown/failed acquisition (bounded retry)
  return {
    errorCode: "ACQUISITION_FAILED",
    terminalOutcome: "ACQUISITION_FAILED",
    retryable: canRetryMore,
    retryDecision: canRetryMore ? "RETRY_BACKOFF_TRANSIENT" : "NO_RETRY_MAX_ATTEMPTS_EXHAUSTED",
    preserveProviderRunForPolling: false,
    baseBackoffMs: ACQUISITION_RETRY_POLICY.BASE_BACKOFF_MS,
    normalizedMessage: msg,
    retryAfterMs,
  };
}

/**
 * Computes bounded exponential backoff with jitter in milliseconds.
 */
export function computeBoundedBackoffMs(
  attemptOrParams:
    | number
    | {
        attemptNumber: number;
        errorCode: AcquisitionErrorCode | null;
        retryAfterMs?: number | null;
        jitterSeed?: string;
      },
  decision?: {
    errorCode?: AcquisitionErrorCode | null;
    retryAfterMs?: number | null;
    baseBackoffMs?: number;
  }
): number {
  const attemptNumber =
    typeof attemptOrParams === "number" ? attemptOrParams : attemptOrParams.attemptNumber;
  const errorCode =
    (typeof attemptOrParams === "number"
      ? decision?.errorCode
      : attemptOrParams.errorCode) || "ACQUISITION_FAILED";
  const retryAfterMs =
    typeof attemptOrParams === "number"
      ? decision?.retryAfterMs
      : attemptOrParams.retryAfterMs;
  const jitterSeed =
    typeof attemptOrParams === "number" ? undefined : attemptOrParams.jitterSeed;

  if (
    errorCode === "INVALID_INPUT_OR_CONFIG" ||
    errorCode === "MISSING_ACTOR_OR_UNSUPPORTED" ||
    errorCode === "AUTH_OR_PERMISSION_ERROR" ||
    errorCode === "CONFIRMED_EMPTY_SOURCE" ||
    errorCode === "INCONCLUSIVE_ZERO_RESULT" ||
    errorCode === "NONE"
  ) {
    return 0;
  }

  if (typeof retryAfterMs === "number" && retryAfterMs > 0) {
    return Math.min(retryAfterMs, ACQUISITION_RETRY_POLICY.MAX_BACKOFF_MS);
  }

  const base =
    errorCode === "RATE_LIMIT_OR_QUOTA"
      ? ACQUISITION_RETRY_POLICY.RATE_LIMIT_BASE_BACKOFF_MS
      : errorCode === "TIMEOUT"
        ? ACQUISITION_RETRY_POLICY.TIMEOUT_POLL_BACKOFF_MS
        : ACQUISITION_RETRY_POLICY.BASE_BACKOFF_MS;

  const exp = Math.max(0, attemptNumber - 1);
  const rawDelay = Math.min(base * Math.pow(2, exp), ACQUISITION_RETRY_POLICY.MAX_BACKOFF_MS);

  // Deterministic or random jitter within ±20%
  let unitRandom = Math.random();
  if (jitterSeed) {
    const hash = crypto.createHash("sha256").update(`${jitterSeed}:${attemptNumber}`).digest();
    unitRandom = hash.readUInt32BE(0) / 0xffffffff;
  }
  const jitterFactor = 1 + (unitRandom * 2 - 1) * ACQUISITION_RETRY_POLICY.JITTER_RATIO;
  return Math.max(1000, Math.round(rawDelay * jitterFactor));
}

const SENSITIVE_KEY_RE = /token|key|secret|password|authorization|cookie|credential|session_id/i;

/**
 * Strips any credential or secret values from an input payload before persisting or logging.
 */
export function sanitizeInputForPersistence(input: unknown): Record<string, unknown> {
  if (!input || typeof input !== "object") return {};
  if (Array.isArray(input)) {
    return { items: input.map((v) => (typeof v === "object" && v !== null ? sanitizeInputForPersistence(v) : v)) };
  }
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(input as Record<string, unknown>)) {
    if (SENSITIVE_KEY_RE.test(k)) {
      out[k] = "[REDACTED]";
    } else if (typeof v === "string") {
      out[k] = sanitizeLogString(v);
    } else if (typeof v === "object" && v !== null) {
      out[k] = Array.isArray(v)
        ? v.map((item) => (typeof item === "object" && item !== null ? sanitizeInputForPersistence(item) : item))
        : sanitizeInputForPersistence(v);
    } else {
      out[k] = v;
    }
  }
  return out;
}

export function sanitizeLogString(str: string): string {
  if (!str) return "";
  return str
    .replace(/([?&](?:token|key|api_key|apiKey|access_token)=)[^&\s]+/gi, "$1[REDACTED]")
    .replace(/(Bearer\s+)[A-Za-z0-9._~+/-]+=*/gi, "$1[REDACTED]")
    .replace(/(apify_api_)[A-Za-z0-9]+/gi, "$1[REDACTED]");
}
