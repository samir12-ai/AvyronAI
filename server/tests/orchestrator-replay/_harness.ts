/**
 * Task #89 / Phase 4-A — hermetic harness for orchestrator-replay tests.
 *
 * Conventions inherited from Seal #18 / server/tests/lifecycle/_harness.ts:
 *   HERMETIC          — no network / no real DB. The `pool` import in
 *                       recorder.ts is vi.mock-ed at test entry so
 *                       `finalize()` runs without touching PG.
 *   DETERMINISTIC-CLOCK — every recorder is constructed with an injected
 *                       `now()` returning a controlled monotonic clock.
 *   NO-FLAKES         — replay-flake-check.sh runs the suite 100×; any
 *                       single failure is a doctrine violation.
 *   STATE-NOT-LOGS    — assertions go against returned cassette state,
 *                       NOT against console output.
 */
import { vi } from "vitest";

// pool mock — captures INSERT calls without touching PG.
export const __pgCalls: Array<{ sql: string; params: unknown[] }> = [];
export function _resetPgCalls(): void {
  __pgCalls.length = 0;
}

vi.mock("../../db", () => ({
  pool: {
    query: vi.fn(async (sql: string, params: unknown[] = []) => {
      __pgCalls.push({ sql, params });
      return { rows: [] };
    }),
  },
  db: {},
}));

// logger mock — silent (Seal #18 STATE-NOT-LOGS).
vi.mock("../../logger", () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}));

export class FakeClock {
  private t: number;
  constructor(start = 1_700_000_000_000) {
    this.t = start;
  }
  now = (): number => this.t;
  advance(ms: number): void {
    this.t += ms;
  }
}
