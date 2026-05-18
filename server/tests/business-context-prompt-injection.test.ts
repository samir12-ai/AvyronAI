/**
 * Phase 4-B-prep — Business Context Layer prompt-injection + floor-parity.
 *
 * Covers user's remaining requirements:
 *   3. the LLM prompt receives the business profile BEFORE the evidence
 *   6. deterministic floor still wins if integrity gates fail
 *
 * Strategy: spy on the LLM call boundary (callCommercialReasoner) to
 * inspect the exact prompt text the model would see, without making any
 * real API calls. For floor-parity, force a Zod-rejected response and
 * assert the interpreter falls back to the deterministic floor regardless
 * of whether a profile was injected.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

const callSpy = vi.fn();

vi.mock("../commercial-reasoning/llm-call", async () => {
  const actual = await vi.importActual<typeof import("../commercial-reasoning/llm-call")>(
    "../commercial-reasoning/llm-call",
  );
  return {
    ...actual,
    callCommercialReasoner: (...args: unknown[]) => callSpy(...args),
  };
});

// Skip the real DB load so we run hermetically.
vi.mock("../commercial-reasoning/business-context-layer", async () => {
  const actual = await vi.importActual<typeof import("../commercial-reasoning/business-context-layer")>(
    "../commercial-reasoning/business-context-layer",
  );
  return {
    ...actual,
    loadBusinessProfileFor: vi.fn(async () =>
      actual.buildBusinessProfile({ industry: "test_industry", businessData: null }),
    ),
  };
});

import { interpretAwarenessDepth } from "../commercial-reasoning/awareness-depth-interpreter";
import {
  buildBusinessProfile,
  type BusinessProfile,
} from "../commercial-reasoning/business-context-layer";
import {
  EMPTY_ANALYTICAL_PACKAGE,
  type AnalyticalPackage,
} from "../analytical-enrichment-layer/types";

const ORIGINAL_ENABLED = process.env.COMMERCIAL_REASONER_ENABLED;
const ORIGINAL_ALLOWLIST = process.env.COMMERCIAL_REASONER_ALLOWED_INDUSTRIES;
const ORIGINAL_CURRENT = process.env.COMMERCIAL_REASONER_CURRENT_INDUSTRY;

beforeEach(() => {
  callSpy.mockReset();
  process.env.COMMERCIAL_REASONER_ENABLED = "1";
  delete process.env.COMMERCIAL_REASONER_ALLOWED_INDUSTRIES;
  delete process.env.COMMERCIAL_REASONER_CURRENT_INDUSTRY;
});

afterEach(() => {
  if (ORIGINAL_ENABLED === undefined) delete process.env.COMMERCIAL_REASONER_ENABLED;
  else process.env.COMMERCIAL_REASONER_ENABLED = ORIGINAL_ENABLED;
  if (ORIGINAL_ALLOWLIST === undefined) delete process.env.COMMERCIAL_REASONER_ALLOWED_INDUSTRIES;
  else process.env.COMMERCIAL_REASONER_ALLOWED_INDUSTRIES = ORIGINAL_ALLOWLIST;
  if (ORIGINAL_CURRENT === undefined) delete process.env.COMMERCIAL_REASONER_CURRENT_INDUSTRY;
  else process.env.COMMERCIAL_REASONER_CURRENT_INDUSTRY = ORIGINAL_CURRENT;
});

function makeAel(): AnalyticalPackage {
  return {
    ...EMPTY_ANALYTICAL_PACKAGE,
    root_causes: [
      {
        surfaceSignal: "drop-off at pricing page",
        deepCause: "tier names do not match the buyer's value model",
        causalReasoning: "buyers can't map tier features to outcomes they care about",
        sourceData: "ig comments + landing analytics",
        confidenceLevel: "high",
      },
    ],
  };
}

function makeSaasProfile(): BusinessProfile {
  return buildBusinessProfile({
    industry: "b2b_saas",
    businessData: {
      id: "bd",
      campaignId: "c",
      accountId: "a",
      businessLocation: "US",
      businessType: "Software (SaaS)",
      coreOffer: "Revenue ops automation platform",
      priceRange: "$1,500 / month",
      targetAudienceAge: "32-48",
      targetAudienceSegment: "VP RevOps at B2B SaaS",
      monthlyBudget: "8000",
      funnelObjective: "lead_generation",
      primaryConversionChannel: "demo_booking",
      productCategory: "Revenue ops platform",
      coreProblemSolved: null,
      uniqueMechanism: null,
      strategicAdvantage: null,
      targetDecisionMaker: "VP RevOps (committee)",
      goalTarget: "",
      goalTimeline: "",
      goalDescription: "",
      createdAt: new Date(),
      updatedAt: new Date(),
    },
  });
}

describe("BCL prompt injection — REQ-3 + REQ-6", () => {
  it("REQ-3: business profile is rendered into the user prompt BEFORE the evidence corpus", async () => {
    callSpy.mockResolvedValue({
      raw: "{}",
      parsed: {}, // will fail Zod, but that's fine — we only inspect the prompt
      tokensUsed: 100,
      latencyMs: 10,
    });

    await interpretAwarenessDepth({
      accountId: "acct",
      campaignId: "camp",
      runId: "run",
      ael: makeAel(),
      awarenessRouteSourceTexts: ["proof-led entry", "third-party validation"],
      businessProfile: makeSaasProfile(),
    });

    expect(callSpy).toHaveBeenCalledTimes(1);
    const args = callSpy.mock.calls[0][0] as { systemPrompt: string; userPrompt: string };

    // System prompt must instruct the model to read the profile first.
    expect(args.systemPrompt).toMatch(/BUSINESS PROFILE/);
    expect(args.systemPrompt).toMatch(/READ THE BUSINESS PROFILE FIRST/);

    // User prompt order: profile block appears BEFORE evidence corpus.
    const profileIdx = args.userPrompt.indexOf("BUSINESS PROFILE");
    const evidenceIdx = args.userPrompt.indexOf("EVIDENCE CORPUS");
    expect(profileIdx).toBeGreaterThan(-1);
    expect(evidenceIdx).toBeGreaterThan(-1);
    expect(profileIdx).toBeLessThan(evidenceIdx);

    // Profile content actually present.
    expect(args.userPrompt).toMatch(/"business_model":\s*"saas"/);
    expect(args.userPrompt).toMatch(/"reasoning_framework"/);
    expect(args.userPrompt).toMatch(/primaryLevers/);
  });

  it("REQ-3b: when caller omits profile, interpreter loads one and still injects it before evidence", async () => {
    callSpy.mockResolvedValue({ raw: "{}", parsed: {}, tokensUsed: 1, latencyMs: 1 });

    await interpretAwarenessDepth({
      accountId: "acct",
      campaignId: "camp",
      runId: "run",
      ael: makeAel(),
      awarenessRouteSourceTexts: ["proof-led entry"],
      // businessProfile omitted on purpose
    });

    const args = callSpy.mock.calls[0][0] as { userPrompt: string };
    expect(args.userPrompt.indexOf("BUSINESS PROFILE")).toBeLessThan(
      args.userPrompt.indexOf("EVIDENCE CORPUS"),
    );
    // The mocked loader returns a stub profile keyed to "test_industry".
    expect(args.userPrompt).toMatch(/"industry":\s*"test_industry"/);
  });

  it("REQ-6: deterministic floor still wins when the LLM response fails the Zod gate, even WITH a profile", async () => {
    // Force a Zod rejection by returning a parsed-but-invalid object.
    callSpy.mockResolvedValue({
      raw: "{}",
      parsed: { depthAssessment: "not_a_real_enum_value" },
      tokensUsed: 1,
      latencyMs: 1,
    });

    const result = await interpretAwarenessDepth({
      accountId: "acct",
      campaignId: "camp",
      runId: "run",
      ael: makeAel(),
      awarenessRouteSourceTexts: ["proof-led entry"],
      businessProfile: makeSaasProfile(),
    });

    expect(result.fellBackTo).toBe("deterministic_floor");
    expect(result.gateDecision.reason).toBe("commercial_reasoner_zod_rejected");
    // Floor result remains the source of truth for allow.
    expect(result.gateDecision.allow).toBe(result.deterministicFloor.passed);
    // Profile injection does NOT prevent the floor fallback — the integrity
    // envelope still has final authority.
  });

  it("loadBusinessProfileFor is non-fatal when the DB query throws (returns slug-only profile)", async () => {
    const bcl = await vi.importActual<typeof import("../commercial-reasoning/business-context-layer")>(
      "../commercial-reasoning/business-context-layer",
    );
    // Sabotage the db client used inside loadBusinessProfileFor.
    const dbMod = await import("../db");
    const originalSelect = dbMod.db.select;
    (dbMod.db as unknown as { select: () => never }).select = () => {
      throw new Error("simulated DB outage");
    };
    try {
      const profile = await bcl.loadBusinessProfileFor({
        accountId: "acct-x",
        campaignId: "camp-x",
        industry: "b2b_saas",
      });
      expect(profile.industry).toBe("b2b_saas");
      // No row available — must NOT throw, must mark fields unknown.
      expect(profile.inputSources.manualUserData).toBe(false);
      expect(profile.unknownFields.length).toBeGreaterThan(0);
      // Slug still drives a real lens (not "Generic").
      expect(profile.businessModel).toBe("saas");
    } finally {
      (dbMod.db as unknown as { select: typeof originalSelect }).select = originalSelect;
    }
  });

  it("REQ-6b: deterministic floor wins on LLM timeout regardless of profile", async () => {
    const { CommercialReasonerTimeoutError } = await import("../commercial-reasoning/llm-call");
    callSpy.mockRejectedValue(new CommercialReasonerTimeoutError(1000));

    const result = await interpretAwarenessDepth({
      accountId: "acct",
      campaignId: "camp",
      runId: "run",
      ael: makeAel(),
      awarenessRouteSourceTexts: ["proof-led entry"],
      businessProfile: makeSaasProfile(),
    });
    expect(result.fellBackTo).toBe("deterministic_floor");
    expect(result.gateDecision.reason).toBe("commercial_reasoner_wall_clock_timeout");
  });
});
