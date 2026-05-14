/**
 * Seal #14 / Track #2 — Supervisor + chain-state classification proofs.
 *
 * Closes the T1-A5 audit finding promoted to BLOCKER (per-chain lag
 * blindness) and proves the heartbeat-stale detector behaves correctly
 * across the four ChainState enum values: HEALTHY / DEGRADED / DEAD /
 * UNKNOWN.
 *
 * Tests:
 *   1. classifyChainState — pure function table-driven cases for every
 *      enum value: introspection_off → UNKNOWN; never_observed →
 *      DEAD; lag<interval → HEALTHY; interval<lag<dead*interval →
 *      DEGRADED; lag>dead*interval → DEAD.
 *   2. Supervisor heartbeat-stale: a continuity_ticks row aged >4h →
 *      schedulerState='DEAD' + CONTINUITY_HEARTBEAT_STALE audit fires.
 *   3. Supervisor chain-lag detection: a chain whose introspect()
 *      returns an aged Date → state classified DEGRADED/DEAD; chain
 *      registry state row written; CONTINUITY_CHAIN_LAG audit fires
 *      ONLY on state transition (not every tick).
 *   4. UNKNOWN chains (introspect=null) are surfaced explicitly in the
 *      chains_unknown counter — no silent suppression.
 */
import { describe, it, expect, beforeEach, vi } from "vitest";

import { classifyChainState } from "../continuity/health-classifier";

describe("Seal #14 / Track #2 — classifyChainState pure logic", () => {
  const now = new Date("2026-05-14T12:00:00Z");

  it("returns UNKNOWN when introspection is not wired", () => {
    const r = classifyChainState({
      now,
      lastObservedRunAt: null,
      expectedIntervalMs: 60_000,
      introspectionAvailable: false,
    });
    expect(r.state).toBe("UNKNOWN");
    expect(r.lagMs).toBeNull();
    expect(r.reason).toContain("introspection_not_wired");
  });

  it("returns DEAD when introspectable but never observed", () => {
    const r = classifyChainState({
      now,
      lastObservedRunAt: null,
      expectedIntervalMs: 60_000,
      introspectionAvailable: true,
    });
    expect(r.state).toBe("DEAD");
    expect(r.reason).toContain("no_observed_run_ever");
  });

  it("returns HEALTHY when lag is within expected interval", () => {
    const lastRun = new Date(now.getTime() - 30_000);
    const r = classifyChainState({
      now,
      lastObservedRunAt: lastRun,
      expectedIntervalMs: 60_000,
      introspectionAvailable: true,
    });
    expect(r.state).toBe("HEALTHY");
    expect(r.lagMs).toBe(30_000);
  });

  it("returns DEGRADED when lag exceeds 1× but under dead-multiplier", () => {
    const lastRun = new Date(now.getTime() - 90_000); // 1.5x
    const r = classifyChainState({
      now,
      lastObservedRunAt: lastRun,
      expectedIntervalMs: 60_000,
      introspectionAvailable: true,
    });
    expect(r.state).toBe("DEGRADED");
  });

  it("returns DEAD when lag exceeds dead-multiplier", () => {
    const lastRun = new Date(now.getTime() - 5 * 60_000); // 5x at default 4x dead
    const r = classifyChainState({
      now,
      lastObservedRunAt: lastRun,
      expectedIntervalMs: 60_000,
      introspectionAvailable: true,
    });
    expect(r.state).toBe("DEAD");
    expect(r.reason).toContain("exceeds_dead");
  });

  it("respects custom degraded/dead multipliers", () => {
    const lastRun = new Date(now.getTime() - 200 * 60_000); // 200x
    const r = classifyChainState({
      now,
      lastObservedRunAt: lastRun,
      expectedIntervalMs: 60_000,
      degradedThresholdMultiplier: 2,
      deadThresholdMultiplier: 1000,
      introspectionAvailable: true,
    });
    expect(r.state).toBe("DEGRADED"); // not DEAD, since lag<1000x interval
  });
});

// ---------------------------------------------------------------------------
// Supervisor end-to-end with mocked DB.
// ---------------------------------------------------------------------------

const dbState: {
  schedulerHeartbeat: Date | null;
  chainStates: Map<string, { lastState: string }>;
  insertedSupervisorTicks: any[];
  upsertedChainStates: any[];
} = {
  schedulerHeartbeat: null,
  chainStates: new Map(),
  insertedSupervisorTicks: [],
  upsertedChainStates: [],
};

const auditLogs: any[] = [];

vi.mock("../db", () => ({
  db: {
    select: (shape?: any) => {
      // continuity_ticks scheduler heartbeat
      if (shape && "tickAt" in shape) {
        return {
          from: () => ({
            orderBy: () => ({
              limit: () =>
                Promise.resolve(
                  dbState.schedulerHeartbeat
                    ? [{ tickAt: dbState.schedulerHeartbeat }]
                    : [],
                ),
            }),
          }),
        };
      }
      // chain_registry_state lookup by chain_id
      if (shape && "lastState" in shape) {
        return {
          from: () => ({
            where: (predicate: any) => ({
              limit: async () => {
                // The supervisor is iterating chains and reading prior
                // state for whichever chain it's currently processing.
                // We track that via __currentChainInFlight, which the
                // mocked introspect functions set BEFORE the supervisor
                // calls loadPriorChainState.
                const lookupId = (globalThis as any).__currentChainInFlight;
                if (!lookupId) return [];
                const found = dbState.chainStates.get(lookupId);
                return found ? [found] : [];
              },
            }),
          }),
        };
      }
      return {
        from: () => ({
          orderBy: () => ({ limit: () => Promise.resolve([]) }),
          where: () => ({ limit: () => Promise.resolve([]) }),
        }),
      };
    },
    insert: (table: any) => {
      const tableName = String(
        table?.[Symbol.for("drizzle:Name")] ?? table?._?.name ?? "",
      );
      if (tableName.includes("chain_registry_state")) {
        let pendingRow: any = null;
        let conflictUpdate: any = null;
        const builder: any = {
          values: (row: any) => {
            pendingRow = row;
            (globalThis as any).__lastChainLookup = row.chainId;
            return builder;
          },
          onConflictDoUpdate: (cfg: any) => {
            conflictUpdate = cfg;
            const existing = dbState.chainStates.get(pendingRow.chainId);
            const newRow = {
              ...pendingRow,
              ...(existing ? cfg.set : {}),
            };
            dbState.chainStates.set(pendingRow.chainId, {
              lastState: newRow.lastState ?? pendingRow.lastState,
            });
            dbState.upsertedChainStates.push(newRow);
            return Promise.resolve(undefined);
          },
        };
        return builder;
      }
      if (tableName.includes("supervisor_ticks")) {
        return {
          values: async (row: any) => {
            dbState.insertedSupervisorTicks.push(row);
          },
        };
      }
      return { values: async () => undefined };
    },
    execute: async () => ({ rows: [] }),
  },
}));

vi.mock("../audit", () => ({
  logAudit: vi.fn(async (accountId: string, eventType: string, payload: any) => {
    auditLogs.push({ accountId, eventType, payload });
  }),
}));

vi.mock("../logger", () => ({
  logger: { info: () => {}, warn: () => {}, error: () => {} },
}));

// Mock the chain registry to control which chains the supervisor checks.
vi.mock("../continuity/chain-registry", async () => {
  const actual: any = await vi.importActual("../continuity/chain-registry");
  return {
    ...actual,
    getChainRegistry: () => [
      {
        chainId: "test_chain_healthy",
        description: "test",
        expectedIntervalMs: 60_000,
        introspect: async () => {
          (globalThis as any).__currentChainInFlight = "test_chain_healthy";
          return new Date(
            ((globalThis as any).__supervisorNowMs ?? Date.now()) - 30_000,
          );
        },
      },
      {
        chainId: "test_chain_dead",
        description: "test",
        expectedIntervalMs: 60_000,
        introspect: async () => {
          (globalThis as any).__currentChainInFlight = "test_chain_dead";
          return new Date(
            ((globalThis as any).__supervisorNowMs ?? Date.now()) - 10 * 60_000,
          );
        },
      },
      {
        chainId: "test_chain_unknown",
        description: "test",
        expectedIntervalMs: 60_000,
        introspect: null,
      },
    ],
  };
});

import { runSupervisorTick, _resetSupervisorState } from "../continuity/supervisor";

beforeEach(() => {
  dbState.schedulerHeartbeat = null;
  dbState.chainStates.clear();
  dbState.insertedSupervisorTicks = [];
  dbState.upsertedChainStates = [];
  auditLogs.length = 0;
  (globalThis as any).__lastChainLookup = null;
  _resetSupervisorState();
});

describe("Seal #14 / Track #2 — supervisor heartbeat-stale", () => {
  it("classifies scheduler as DEAD when last tick is >4h old AND fires CONTINUITY_HEARTBEAT_STALE on transition", async () => {
    const now = new Date("2026-05-14T12:00:00Z");
    dbState.schedulerHeartbeat = new Date(now.getTime() - 5 * 60 * 60 * 1000); // 5h ago
    // Seed prior state as HEALTHY so the supervisor perceives a HEALTHY→DEAD
    // transition. Audit is transition-gated (architect-flagged finding #4)
    // — no priorState (first ever tick) does NOT fire the audit.
    dbState.chainStates.set("_continuity_scheduler_heartbeat", { lastState: "HEALTHY" });
    (globalThis as any).__currentChainInFlight = "_continuity_scheduler_heartbeat";

    const report = await runSupervisorTick({ now, persist: true });
    expect(report.schedulerState).toBe("DEAD");
    expect(
      auditLogs.some((a) => a.eventType === "CONTINUITY_HEARTBEAT_STALE"),
    ).toBe(true);
  });

  it("does NOT fire CONTINUITY_HEARTBEAT_STALE on first-ever DEAD observation (no prior state = no transition)", async () => {
    const now = new Date("2026-05-14T12:00:00Z");
    dbState.schedulerHeartbeat = new Date(now.getTime() - 5 * 60 * 60 * 1000);
    // No prior state seeded → priorState=null → no transition → no audit.

    const report = await runSupervisorTick({ now, persist: true });
    expect(report.schedulerState).toBe("DEAD");
    expect(
      auditLogs.some((a) => a.eventType === "CONTINUITY_HEARTBEAT_STALE"),
    ).toBe(false);
  });

  it("classifies scheduler as HEALTHY when last tick is recent", async () => {
    const now = new Date("2026-05-14T12:00:00Z");
    dbState.schedulerHeartbeat = new Date(now.getTime() - 30 * 60 * 1000); // 30min ago

    const report = await runSupervisorTick({ now, persist: true });
    expect(report.schedulerState).toBe("HEALTHY");
    expect(
      auditLogs.some((a) => a.eventType === "CONTINUITY_HEARTBEAT_STALE"),
    ).toBe(false);
  });
});

describe("Seal #14 / Track #2 — chain registry observation", () => {
  it("classifies the three test chains correctly and writes a supervisor_ticks row", async () => {
    const now = new Date("2026-05-14T12:00:00Z");
    (globalThis as any).__supervisorNowMs = now.getTime();
    dbState.schedulerHeartbeat = new Date(now.getTime() - 30 * 60 * 1000);

    const report = await runSupervisorTick({ now, persist: true });
    expect(report.chainsChecked).toBe(3);
    expect(report.chainsHealthy).toBe(1);
    expect(report.chainsDead).toBe(1);
    expect(report.chainsUnknown).toBe(1);

    const states = Object.fromEntries(
      report.chains.map((c) => [c.chainId, c.state]),
    );
    expect(states.test_chain_healthy).toBe("HEALTHY");
    expect(states.test_chain_dead).toBe("DEAD");
    expect(states.test_chain_unknown).toBe("UNKNOWN");

    // Paper trail row was written.
    expect(dbState.insertedSupervisorTicks.length).toBe(1);
    expect(dbState.insertedSupervisorTicks[0].chainsDead).toBe(1);
  });

  it("emits CONTINUITY_CHAIN_LAG only on state transition (not on every tick)", async () => {
    const now = new Date("2026-05-14T12:00:00Z");
    (globalThis as any).__supervisorNowMs = now.getTime();
    dbState.schedulerHeartbeat = new Date(now.getTime() - 30 * 60 * 1000);

    // First tick: chain has no prior state → no transition → no audit.
    auditLogs.length = 0;
    await runSupervisorTick({ now, persist: true });
    const firstTickLagAudits = auditLogs.filter(
      (a) => a.eventType === "CONTINUITY_CHAIN_LAG",
    );
    expect(firstTickLagAudits.length).toBe(0);

    // Seed prior state as HEALTHY so the next tick perceives a transition.
    dbState.chainStates.set("test_chain_dead", { lastState: "HEALTHY" });

    auditLogs.length = 0;
    await runSupervisorTick({ now, persist: true });
    const secondTickLagAudits = auditLogs.filter(
      (a) => a.eventType === "CONTINUITY_CHAIN_LAG",
    );
    expect(secondTickLagAudits.length).toBeGreaterThanOrEqual(1);
    expect(
      secondTickLagAudits.some(
        (a) => a.payload.details.chainId === "test_chain_dead",
      ),
    ).toBe(true);

    // Third tick with the same DEAD state already recorded → no new audit.
    dbState.chainStates.set("test_chain_dead", { lastState: "DEAD" });
    auditLogs.length = 0;
    await runSupervisorTick({ now, persist: true });
    const thirdTickLagAudits = auditLogs.filter(
      (a) => a.eventType === "CONTINUITY_CHAIN_LAG",
    );
    expect(thirdTickLagAudits.length).toBe(0);
  });
});
