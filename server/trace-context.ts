/**
 * Seal #7 (Task #25 / F10.6) — Per-request trace context.
 *
 * AsyncLocalStorage-backed traceId so every log line, AI client call, and
 * worker tick can self-tag without threading req through every function.
 *
 * Workers that run outside an HTTP request lifecycle should mint their own
 * traceId at tick start: `traceContext.run({ traceId }, () => doWork())`.
 */
import { AsyncLocalStorage } from "node:async_hooks";

export interface TraceStore {
  traceId: string;
  /** Optional account scope — populated by /api auth middleware after JWT decode. */
  accountId?: string;
}

export const traceContext = new AsyncLocalStorage<TraceStore>();

/** Mint a fresh traceId — used by workers and tests. */
export function mintTraceId(prefix = "tr"): string {
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
}
