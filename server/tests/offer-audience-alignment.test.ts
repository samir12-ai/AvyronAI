import { describe, expect, it } from "vitest";
import { validateOfferAlignment } from "../offer-engine/engine";
import { checkOfferAudienceMisalignment } from "../system-control/structural-checks";

const differentiation = {
  pillars: [],
  mechanismFraming: { supported: false, type: "none" },
  mechanismCore: null,
  authorityMode: null,
  claimStructures: [],
  proofArchitecture: [],
  confidenceScore: null,
};

const audience = {
  audiencePains: [{ canonical: "cost and affordability concerns" }],
  desireMap: {},
  objectionMap: {},
  emotionalDrivers: [],
  maturityIndex: null,
  awarenessLevel: null,
  audienceSegments: [],
};

function offer(outcome: string, name = "Reduce cost and affordability concerns") {
  return {
    offerName: name,
    coreOutcome: outcome,
    mechanismDescription: "A transparent pricing review method",
    deliverables: ["Pricing barrier review"],
  } as any;
}

describe("Offer audience alignment contract", () => {
  it("rejects a title-aligned offer whose core outcome drifts to a neighboring symptom", () => {
    const result = validateOfferAlignment(
      offer("Resolve refund and access workflow complexity that causes purchase hesitation"),
      differentiation,
      audience,
    );

    expect(result.aligned).toBe(false);
    expect(result.failures.join(" ")).toContain('"outcome" field itself');
  });

  it("accepts an outcome that directly names the primary audience pain", () => {
    const result = validateOfferAlignment(
      offer("Reduce cost and affordability concerns by making pricing value and purchase risk transparent"),
      differentiation,
      audience,
    );

    expect(result.aligned).toBe(true);
  });

  it("keeps System Control blocking a genuine failed Offer alignment", () => {
    const results = new Map<any, any>([["offer", {
      status: "SUCCESS",
      output: {
        structuralWarnings: [],
        layerDiagnostics: {
          offerAlignmentValidation: { aligned: false },
          integrityChecks: { painAligned: false },
        },
      },
    }]]);

    const check = checkOfferAudienceMisalignment(results);
    expect(check.status).toBe("FAIL");
    expect(check.details).toContain("does not address audience pains");
  });

  it("exposes a durable diagnostic shape for the snapshot persistence boundary", () => {
    const validation = validateOfferAlignment(
      offer("Resolve refund and access workflow complexity that causes purchase hesitation"),
      differentiation,
      audience,
    );
    const primaryPain = "cost and affordability concerns";
    const persistedDiagnostics = {
      offerAlignmentValidation: validation,
      integrityChecks: { painAligned: false },
      audienceAlignmentContract: {
        primaryAudiencePain: primaryPain,
        primaryPainWords: ["cost", "affordability", "concerns"],
        coreOutcomeAligned: false,
        finalValidatorAligned: validation.aligned,
        failedRules: validation.failures,
      },
    };

    expect(JSON.parse(JSON.stringify(persistedDiagnostics))).toMatchObject({
      offerAlignmentValidation: { aligned: false },
      integrityChecks: { painAligned: false },
      audienceAlignmentContract: {
        primaryAudiencePain: primaryPain,
        coreOutcomeAligned: false,
        finalValidatorAligned: false,
      },
    });
  });
});