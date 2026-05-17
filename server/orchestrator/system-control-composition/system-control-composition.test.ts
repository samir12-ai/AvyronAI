import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../../system-control/engine", () => ({
  evaluateSystemControl: vi.fn(),
}));

import { evaluateSystemControl } from "../../system-control/engine";
import { composeSystemControl } from "./index";

const baseInput = (overrides: any = {}) => ({
  results: new Map(),
  integrityReport: null,
  celResults: [],
  signalComposition: null,
  sglCoverageSufficient: null,
  ssc: null,
  analyticalEnrichmentPartial: false,
  analyticalEnrichmentReason: null,
  analyticalEnrichmentDownstreamConsumers: 0,
  miGateRejections: [],
  confidenceIntegrityVerdict: null,
  confidenceIntegrityCriticalAbsent: [],
  confidenceIntegrityDegradedEngines: [],
  campaignId: "c1",
  accountId: "a1",
  currentJobId: "job1",
  ...overrides,
});

describe("composeSystemControl", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns frozen verdict on happy path", async () => {
    const verdict = {
      verdict: "PASS",
      executionMode: "live",
      integrityVerdict: "PASS",
      blockReasons: [],
      downgrades: [],
      contradictions: [],
      repairActions: [],
      structuralChecks: [],
    };
    (evaluateSystemControl as any).mockReturnValue(verdict);
    const out = await composeSystemControl(baseInput());
    expect(out.verdict).toBe(verdict);
    expect(out.error).toBeNull();
    expect(Object.isFrozen(out.verdict)).toBe(true);
  });

  it("returns null verdict + error message when evaluateSystemControl throws", async () => {
    (evaluateSystemControl as any).mockImplementation(() => {
      throw new Error("boom");
    });
    const out = await composeSystemControl(baseInput());
    expect(out.verdict).toBeNull();
    expect(out.error).toBe("boom");
  });

  it("invokes commercial overlay before freeze", async () => {
    const verdict: any = { verdict: "PASS", executionMode: "live", integrityVerdict: "PASS", blockReasons: [], downgrades: [], contradictions: [], repairActions: [], structuralChecks: [] };
    (evaluateSystemControl as any).mockReturnValue(verdict);
    const applyCommercialOverlay = vi.fn(async (v: any) => {
      // Must still be mutable here.
      v.commercialJudgement = { verdict: "go" };
    });
    const out = await composeSystemControl(baseInput({ applyCommercialOverlay }));
    expect(applyCommercialOverlay).toHaveBeenCalledTimes(1);
    expect((out.verdict as any).commercialJudgement.verdict).toBe("go");
    expect(Object.isFrozen(out.verdict)).toBe(true);
  });

  it("invokes recovery overlay only on BLOCK", async () => {
    const verdict: any = { verdict: "BLOCK", executionMode: "halt", integrityVerdict: "FAIL", blockReasons: [], downgrades: [], contradictions: [], repairActions: [], structuralChecks: [] };
    (evaluateSystemControl as any).mockReturnValue(verdict);
    const applyRecoveryPlanOverlay = vi.fn(async (v: any) => {
      v.recoveryPlan = { issues: [] };
    });
    await composeSystemControl(baseInput({ applyRecoveryPlanOverlay }));
    expect(applyRecoveryPlanOverlay).toHaveBeenCalledTimes(1);
  });

  it("does NOT invoke recovery overlay on non-BLOCK verdicts", async () => {
    const verdict: any = { verdict: "PASS", executionMode: "live", integrityVerdict: "PASS", blockReasons: [], downgrades: [], contradictions: [], repairActions: [], structuralChecks: [] };
    (evaluateSystemControl as any).mockReturnValue(verdict);
    const applyRecoveryPlanOverlay = vi.fn();
    await composeSystemControl(baseInput({ applyRecoveryPlanOverlay }));
    expect(applyRecoveryPlanOverlay).not.toHaveBeenCalled();
  });

  it("commercial overlay failures are non-fatal — verdict still freezes", async () => {
    const verdict: any = { verdict: "PASS", executionMode: "live", integrityVerdict: "PASS", blockReasons: [], downgrades: [], contradictions: [], repairActions: [], structuralChecks: [] };
    (evaluateSystemControl as any).mockReturnValue(verdict);
    const out = await composeSystemControl(
      baseInput({
        applyCommercialOverlay: async () => {
          throw new Error("overlay-boom");
        },
      }),
    );
    expect(out.verdict).toBe(verdict);
    expect(Object.isFrozen(out.verdict)).toBe(true);
  });
});
