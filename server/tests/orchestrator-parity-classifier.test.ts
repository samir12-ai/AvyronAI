/**
 * Task #91 / Phase 4-C — Parity classifier unit tests.
 *
 * Covers:
 *   - Empty divergences → PASS / NONE.
 *   - Single TIMING_ONLY divergence → NOISE.
 *   - Mixed classes → BLOCK precedence (BLOCK > WARN > INFO > NOISE).
 *   - Missing routing entry → RoutingTableIncompleteError (D5).
 */
import { describe, it, expect } from "vitest";
import {
  classifyDivergences,
  RoutingTableIncompleteError,
} from "../orchestrator/replay/parity/classifier";
import { DEFAULT_ROUTING_TABLE } from "../orchestrator/replay/parity/routes";
import type { Divergence } from "../orchestrator/replay/types";

const div = (klass: Divergence["class"], path = "x.y"): Divergence => ({
  class: klass,
  path,
  expected: null,
  actual: null,
});

describe("classifyDivergences", () => {
  it("returns PASS / NONE when no divergences observed", () => {
    const r = classifyDivergences([], DEFAULT_ROUTING_TABLE);
    expect(r.outcome).toBe("PASS");
    expect(r.routedAction).toBe("NONE");
    expect(r.highestClass).toBeNull();
  });

  it("classifies a TIMING_ONLY divergence as NOISE", () => {
    const r = classifyDivergences([div("TIMING_ONLY")], DEFAULT_ROUTING_TABLE);
    expect(r.outcome).toBe("NOISE");
    expect(r.routedAction).toBe("NOISE");
    expect(r.highestClass).toBe("TIMING_ONLY");
  });

  it("escalates to BLOCK when any STRUCTURAL or CANONICAL_FIELD divergence is present", () => {
    const r = classifyDivergences(
      [div("TIMING_ONLY"), div("ORDER"), div("CANONICAL_FIELD", "integrityVerdict")],
      DEFAULT_ROUTING_TABLE,
    );
    expect(r.outcome).toBe("BLOCK");
    expect(r.routedAction).toBe("BLOCK");
    expect(r.highestClass).toBe("CANONICAL_FIELD");
  });

  it("settles at WARN when only BUDGET_LEDGER and DEGRADATION_SURFACE present", () => {
    const r = classifyDivergences(
      [div("BUDGET_LEDGER", "budgetLedger[0]"), div("DEGRADATION_SURFACE", "planPersist.degraded"), div("PROVENANCE")],
      DEFAULT_ROUTING_TABLE,
    );
    expect(r.outcome).toBe("WARN");
    expect(r.routedAction).toBe("WARN");
    expect(["BUDGET_LEDGER", "DEGRADATION_SURFACE"]).toContain(r.highestClass);
  });

  it("throws RoutingTableIncompleteError when a class has no route (D5)", () => {
    const incomplete = { ...DEFAULT_ROUTING_TABLE } as Record<string, "NOISE" | "INFO" | "WARN" | "BLOCK">;
    delete incomplete.CANONICAL_FIELD;
    expect(() =>
      classifyDivergences([div("CANONICAL_FIELD")], incomplete as typeof DEFAULT_ROUTING_TABLE),
    ).toThrow(RoutingTableIncompleteError);
  });
});
