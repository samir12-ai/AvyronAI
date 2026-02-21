export type MetaErrorClass = "PERMANENT" | "TEMPORARY";

export interface ClassifiedError {
  classification: MetaErrorClass;
  category: string;
  shouldTransitionMode: boolean;
  suggestedMode?: string;
  retryable: boolean;
}

const PERMANENT_SUBCODES = new Set([458, 460, 463, 467, 492]);

const REVOKED_SUBCODES = new Set([458, 460]);
const EXPIRED_SUBCODES = new Set([463]);

export function classifyMetaError(
  httpStatus: number | null,
  errorCode: number | null,
  errorSubcode: number | null,
  errorMessage: string | null
): ClassifiedError {
  if (httpStatus === 429) {
    return {
      classification: "TEMPORARY",
      category: "RATE_LIMITED",
      shouldTransitionMode: false,
      retryable: true,
    };
  }

  if (httpStatus !== null && httpStatus >= 500) {
    return {
      classification: "TEMPORARY",
      category: "SERVER_ERROR",
      shouldTransitionMode: false,
      retryable: true,
    };
  }

  if (errorCode === 4 || errorCode === 17 || errorCode === 32) {
    return {
      classification: "TEMPORARY",
      category: "RATE_LIMITED",
      shouldTransitionMode: false,
      retryable: true,
    };
  }

  if (errorCode === 2 || errorCode === 1) {
    if (errorSubcode && PERMANENT_SUBCODES.has(errorSubcode)) {
      if (REVOKED_SUBCODES.has(errorSubcode)) {
        return {
          classification: "PERMANENT",
          category: "REVOKED",
          shouldTransitionMode: true,
          suggestedMode: "REVOKED",
          retryable: false,
        };
      }
      if (EXPIRED_SUBCODES.has(errorSubcode)) {
        return {
          classification: "PERMANENT",
          category: "EXPIRED",
          shouldTransitionMode: true,
          suggestedMode: "TOKEN_EXPIRED",
          retryable: false,
        };
      }
    }

    return {
      classification: "TEMPORARY",
      category: "TRANSIENT_API_ERROR",
      shouldTransitionMode: false,
      retryable: true,
    };
  }

  if (errorCode === 190) {
    if (errorSubcode && REVOKED_SUBCODES.has(errorSubcode)) {
      return {
        classification: "PERMANENT",
        category: "REVOKED",
        shouldTransitionMode: true,
        suggestedMode: "REVOKED",
        retryable: false,
      };
    }
    if (errorSubcode && EXPIRED_SUBCODES.has(errorSubcode)) {
      return {
        classification: "PERMANENT",
        category: "EXPIRED",
        shouldTransitionMode: true,
        suggestedMode: "TOKEN_EXPIRED",
        retryable: false,
      };
    }
    return {
      classification: "PERMANENT",
      category: "INVALID_TOKEN",
      shouldTransitionMode: true,
      suggestedMode: "TOKEN_EXPIRED",
      retryable: false,
    };
  }

  if (errorCode === 10 || errorCode === 200 || errorCode === 803) {
    return {
      classification: "PERMANENT",
      category: "PERMISSION_DENIED",
      shouldTransitionMode: true,
      suggestedMode: "PERMISSION_MISSING",
      retryable: false,
    };
  }

  const msg = (errorMessage || "").toLowerCase();
  if (msg.includes("invalid oauth") || msg.includes("session has expired")) {
    return {
      classification: "PERMANENT",
      category: "INVALID_TOKEN",
      shouldTransitionMode: true,
      suggestedMode: "TOKEN_EXPIRED",
      retryable: false,
    };
  }
  if (msg.includes("not authorized") || msg.includes("permission")) {
    return {
      classification: "PERMANENT",
      category: "PERMISSION_DENIED",
      shouldTransitionMode: true,
      suggestedMode: "PERMISSION_MISSING",
      retryable: false,
    };
  }
  if (msg.includes("rate limit") || msg.includes("too many calls")) {
    return {
      classification: "TEMPORARY",
      category: "RATE_LIMITED",
      shouldTransitionMode: false,
      retryable: true,
    };
  }

  if (httpStatus !== null && httpStatus >= 400 && httpStatus < 500) {
    return {
      classification: "PERMANENT",
      category: "CLIENT_ERROR",
      shouldTransitionMode: false,
      retryable: false,
    };
  }

  return {
    classification: "TEMPORARY",
    category: "UNKNOWN",
    shouldTransitionMode: false,
    retryable: true,
  };
}

export function classifyNetworkError(): ClassifiedError {
  return {
    classification: "TEMPORARY",
    category: "NETWORK_ERROR",
    shouldTransitionMode: false,
    retryable: true,
  };
}

interface BackoffState {
  consecutiveTemporaryErrors: number;
  lastBackoffAt: number;
  currentBackoffMs: number;
}

const backoffStates = new Map<string, BackoffState>();

const BASE_BACKOFF_MS = 5000;
const MAX_BACKOFF_MS = 5 * 60 * 1000;
const MAX_CONSECUTIVE_RETRIES = 10;
const COOLDOWN_MS = 30 * 60 * 1000;

export function getBackoffState(accountId: string): BackoffState {
  let state = backoffStates.get(accountId);
  if (!state) {
    state = { consecutiveTemporaryErrors: 0, lastBackoffAt: 0, currentBackoffMs: 0 };
    backoffStates.set(accountId, state);
  }
  return state;
}

export function recordTemporaryError(accountId: string): {
  shouldRetry: boolean;
  backoffMs: number;
  totalErrors: number;
} {
  const state = getBackoffState(accountId);
  state.consecutiveTemporaryErrors++;
  state.lastBackoffAt = Date.now();

  if (state.consecutiveTemporaryErrors > MAX_CONSECUTIVE_RETRIES) {
    return {
      shouldRetry: false,
      backoffMs: 0,
      totalErrors: state.consecutiveTemporaryErrors,
    };
  }

  state.currentBackoffMs = Math.min(
    BASE_BACKOFF_MS * Math.pow(2, state.consecutiveTemporaryErrors - 1),
    MAX_BACKOFF_MS
  );

  const jitter = Math.random() * 1000;
  const backoffMs = state.currentBackoffMs + jitter;

  return {
    shouldRetry: true,
    backoffMs: Math.round(backoffMs),
    totalErrors: state.consecutiveTemporaryErrors,
  };
}

export function recordSuccess(accountId: string): void {
  const state = backoffStates.get(accountId);
  if (state) {
    state.consecutiveTemporaryErrors = 0;
    state.currentBackoffMs = 0;
  }
}

export function isInBackoff(accountId: string): boolean {
  const state = backoffStates.get(accountId);
  if (!state || state.consecutiveTemporaryErrors === 0) return false;

  if (state.consecutiveTemporaryErrors > MAX_CONSECUTIVE_RETRIES) {
    const elapsed = Date.now() - state.lastBackoffAt;
    if (elapsed >= COOLDOWN_MS) {
      state.consecutiveTemporaryErrors = 0;
      state.currentBackoffMs = 0;
      state.lastBackoffAt = 0;
      return false;
    }
    return true;
  }

  const elapsed = Date.now() - state.lastBackoffAt;
  return elapsed < state.currentBackoffMs;
}

export function getBackoffDiagnostics(accountId: string): {
  consecutiveErrors: number;
  currentBackoffMs: number;
  isPaused: boolean;
  maxRetriesExceeded: boolean;
  cooldownRemainingMs: number | null;
} {
  const state = getBackoffState(accountId);
  const paused = isInBackoff(accountId);
  const exceeded = state.consecutiveTemporaryErrors > MAX_CONSECUTIVE_RETRIES;
  let cooldownRemainingMs: number | null = null;
  if (exceeded && paused) {
    const elapsed = Date.now() - state.lastBackoffAt;
    cooldownRemainingMs = Math.max(0, COOLDOWN_MS - elapsed);
  }
  return {
    consecutiveErrors: state.consecutiveTemporaryErrors,
    currentBackoffMs: state.currentBackoffMs,
    isPaused: paused,
    maxRetriesExceeded: exceeded,
    cooldownRemainingMs,
  };
}
