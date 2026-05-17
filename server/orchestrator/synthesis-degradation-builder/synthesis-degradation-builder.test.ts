import { describe, it, expect } from "vitest";
import {
  buildSynthesisDegradation,
  applySynthesisDegradation,
} from "./index";

describe("synthesis-degradation-builder", () => {
  it("returns null when no rejections and AEL not partial", () => {
    const out = buildSynthesisDegradation(
      { validationState: "validated" },
      { rejections: [], aelPartial: false, aelPartialReason: "" },
    );
    expect(out).toBeNull();
  });

  it("downgrades to weak on rejections only", () => {
    const out = buildSynthesisDegradation(
      { validationState: "validated" },
      {
        rejections: [{ module: "judge", reason: "no_grounding" } as any],
        aelPartial: false,
        aelPartialReason: "",
      },
    );
    expect(out?.newValidationState).toBe("weak");
    expect(out?.validationStateChanged).toBe(true);
    expect(out?.provenancePatch.commercialReasoningDegraded).toBe(true);
    expect(out?.provenancePatch.aelPartialPropagated).toBe(false);
    expect(out?.attachRejections).toHaveLength(1);
  });

  it("downgrades to weak on AEL partial only", () => {
    const out = buildSynthesisDegradation(
      { validationState: "validated" },
      { rejections: [], aelPartial: true, aelPartialReason: "missing_pains" },
    );
    expect(out?.newValidationState).toBe("weak");
    expect(out?.provenancePatch.aelPartialPropagated).toBe(true);
    expect(out?.provenancePatch.aelPartialReason).toBe("missing_pains");
    expect(out?.attachRejections).toBeUndefined();
  });

  it("keeps 'rejected' when already rejected (never upgrades)", () => {
    const out = buildSynthesisDegradation(
      { validationState: "rejected" },
      {
        rejections: [{ module: "judge", reason: "x" } as any],
        aelPartial: false,
        aelPartialReason: "",
      },
    );
    expect(out?.newValidationState).toBe("rejected");
    expect(out?.validationStateChanged).toBe(false);
  });

  it("marks validationStateChanged=false when already weak", () => {
    const out = buildSynthesisDegradation(
      { validationState: "weak" },
      {
        rejections: [{ module: "judge", reason: "x" } as any],
        aelPartial: false,
        aelPartialReason: "",
      },
    );
    expect(out?.newValidationState).toBe("weak");
    expect(out?.validationStateChanged).toBe(false);
  });

  it("applySynthesisDegradation mutates only the three declared fields", () => {
    const plan: any = { validationState: "validated", unrelated: 42 };
    const outcome = buildSynthesisDegradation(plan, {
      rejections: [{ module: "judge", reason: "x" } as any],
      aelPartial: true,
      aelPartialReason: "missing_pains",
    })!;
    applySynthesisDegradation(plan, outcome);
    expect(plan.validationState).toBe("weak");
    expect(plan.commercialReasoningRejected).toHaveLength(1);
    expect(plan._provenance.commercialReasoningDegraded).toBe(true);
    expect(plan._provenance.aelPartialPropagated).toBe(true);
    expect(plan._provenance.aelPartialReason).toBe("missing_pains");
    expect(plan.unrelated).toBe(42);
  });

  it("logLine matches the orchestrator's PLAN_DEGRADED shape (byte-parity)", () => {
    const out = buildSynthesisDegradation(
      { validationState: "validated" },
      {
        rejections: [{ module: "a", reason: "r1" } as any, { module: "b", reason: "r2" } as any],
        aelPartial: true,
        aelPartialReason: "ignored_in_log",
      },
    );
    expect(out?.logLine).toBe(
      `[Orchestrator] PLAN_DEGRADED | rejections=2 | aelPartial=true | validationState=weak | modules=[a:r1,b:r2]`,
    );
  });
});
