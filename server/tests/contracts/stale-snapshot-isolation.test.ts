import { describe, it, expect } from "vitest";
import { runPositioningEngine } from "../../positioning-engine/engine";

describe("Contract: Stale Snapshot Isolation & Strict Input (Positioning)", () => {
  it("1. Fails closed immediately if painRegistry is empty or missing (POSITIONING_CANONICAL_INPUT_MISSING)", async () => {
    const result = await runPositioningEngine(
      "acc_test",
      "camp_test",
      "mi_snap_1",
      "aud_snap_1",
      undefined,
      "job_test",
      undefined,
      [], // empty pain registry
    );

    expect(result.status).toBe("MISSING_DEPENDENCY");
    expect(result.statusMessage).toContain("POSITIONING_CANONICAL_INPUT_MISSING: painRegistry required");
  });

  it("2. Fails closed if undefined is passed as painRegistry", async () => {
    const result = await runPositioningEngine(
      "acc_test",
      "camp_test",
      "mi_snap_1",
      "aud_snap_1",
      undefined,
      "job_test",
      undefined,
      undefined as any, // missing pain registry
    );

    expect(result.status).toBe("MISSING_DEPENDENCY");
    expect(result.statusMessage).toContain("POSITIONING_CANONICAL_INPUT_MISSING: painRegistry required");
  });
});
