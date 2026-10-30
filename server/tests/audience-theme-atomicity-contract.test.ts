import "dotenv/config";
import { describe, it, expect } from "vitest";
import {
  generateSemanticThemeInventoryWithLLM,
  auditThemeInventoryAtomicityWithLLM,
  type TerminalEvidenceClassification,
  type SemanticTheme,
} from "../audience-engine/semantic-reasoner";

describe("Audience Theme Atomicity Contract & Audit Repair", () => {
  const mockClassifiedUnits: TerminalEvidenceClassification[] = [
    {
      evidenceUnitId: "ev-1",
      primaryForm: "PAIN",
      semanticType: "PAIN",
      claim: "Fabric is completely see-through",
      canonicalCompetitorId: "comp-1",
      canonicalBrandName: "BrandA",
      platform: "reddit",
      rawText: "The white fabric is completely see-through, sunlight goes straight through.",
      confidence: 0.95,
      semanticScope: "CATEGORY_RECURRING",
      transferability: "GLOBALLY_TRANSFERABLE_PRODUCT_TRUTH",
      semanticClaims: [
        {
          claimId: "clm-1",
          claimKind: "PROBLEM",
          meaning: "White summer dress fabric lacks opacity and is completely transparent in daylight.",
          confidence: 0.95,
          semanticScope: "CATEGORY_RECURRING",
          transferability: "GLOBALLY_TRANSFERABLE_PRODUCT_TRUTH",
        },
      ],
    },
    {
      evidenceUnitId: "ev-2",
      primaryForm: "PAIN",
      semanticType: "PAIN",
      claim: "Lining is too sheer in sunlight",
      canonicalCompetitorId: "comp-2",
      canonicalBrandName: "BrandB",
      platform: "reddit",
      rawText: "Lining is too sheer in summer dresses, underwear is visible through the skirt.",
      confidence: 0.91,
      semanticScope: "CATEGORY_RECURRING",
      transferability: "GLOBALLY_TRANSFERABLE_PRODUCT_TRUTH",
      semanticClaims: [
        {
          claimId: "clm-2",
          claimKind: "PROBLEM",
          meaning: "Dress lining is insufficiently opaque and fails modesty coverage.",
          confidence: 0.91,
          semanticScope: "CATEGORY_RECURRING",
          transferability: "GLOBALLY_TRANSFERABLE_PRODUCT_TRUTH",
        },
      ],
    },
    {
      evidenceUnitId: "ev-3",
      primaryForm: "PAIN",
      semanticType: "PAIN",
      claim: "Excessive heat and sweating from layering",
      canonicalCompetitorId: "comp-1",
      canonicalBrandName: "BrandA",
      platform: "reddit",
      rawText: "Wearing multiple slips and undershirts in 38C summer heat is unbearable and causes sweating and heat rash.",
      confidence: 0.94,
      semanticScope: "CATEGORY_RECURRING",
      transferability: "GLOBALLY_TRANSFERABLE_PRODUCT_TRUTH",
      semanticClaims: [
        {
          claimId: "clm-3",
          claimKind: "PROBLEM",
          meaning: "Wearing multiple undergarments in high summer heat causes intense sweating and thermal discomfort.",
          confidence: 0.94,
          semanticScope: "CATEGORY_RECURRING",
          transferability: "GLOBALLY_TRANSFERABLE_PRODUCT_TRUTH",
        },
      ],
    },
    {
      evidenceUnitId: "ev-4",
      primaryForm: "PAIN",
      semanticType: "PAIN",
      claim: "Disproportionate fit and gaping neckline",
      canonicalCompetitorId: "comp-3",
      canonicalBrandName: "BrandC",
      platform: "reddit",
      rawText: "The shoulders fit fine but the bust and waist are completely disproportionate, gaping open at the neckline.",
      confidence: 0.92,
      semanticScope: "CATEGORY_RECURRING",
      transferability: "GLOBALLY_TRANSFERABLE_PRODUCT_TRUTH",
      semanticClaims: [
        {
          claimId: "clm-4",
          claimKind: "PROBLEM",
          meaning: "Dresses suffer from disproportionate sizing cuts with loose gaping necklines.",
          confidence: 0.92,
          semanticScope: "CATEGORY_RECURRING",
          transferability: "GLOBALLY_TRANSFERABLE_PRODUCT_TRUTH",
        },
      ],
    },
    {
      evidenceUnitId: "ev-5",
      primaryForm: "PAIN",
      semanticType: "PAIN",
      claim: "Armholes cut too low exposing chest",
      canonicalCompetitorId: "comp-4",
      canonicalBrandName: "BrandD",
      platform: "reddit",
      rawText: "Standard sizing charts are useless for modest wear because the armholes are cut too low exposing the chest.",
      confidence: 0.93,
      semanticScope: "CATEGORY_RECURRING",
      transferability: "GLOBALLY_TRANSFERABLE_PRODUCT_TRUTH",
      semanticClaims: [
        {
          claimId: "clm-5",
          claimKind: "PROBLEM",
          meaning: "Low-cut armholes and loose arm openings expose the torso.",
          confidence: 0.93,
          semanticScope: "CATEGORY_RECURRING",
          transferability: "GLOBALLY_TRANSFERABLE_PRODUCT_TRUTH",
        },
      ],
    },
    {
      evidenceUnitId: "ev-6",
      primaryForm: "PAIN",
      semanticType: "PAIN",
      claim: "Fabric shrinks after laundering",
      canonicalCompetitorId: "comp-2",
      canonicalBrandName: "BrandB",
      platform: "reddit",
      rawText: "Everything shrinks after the first wash even on delicate cycle, losing two inches of length.",
      confidence: 0.96,
      semanticScope: "CATEGORY_RECURRING",
      transferability: "GLOBALLY_TRANSFERABLE_PRODUCT_TRUTH",
      semanticClaims: [
        {
          claimId: "clm-6",
          claimKind: "PROBLEM",
          meaning: "Dress fabric experiences significant shrinkage during washing, causing loss of garment length.",
          confidence: 0.96,
          semanticScope: "CATEGORY_RECURRING",
          transferability: "GLOBALLY_TRANSFERABLE_PRODUCT_TRUTH",
        },
      ],
    },
  ];

  const businessContext = {
    heroProduct: "modest summer dresses",
    businessName: "Sara Boutique",
    market: "Lebanon / Middle East",
    category: "Modest Fashion / Dresses",
  };

  it("auditThemeInventoryAtomicityWithLLM flags over-collapsed umbrella themes", async () => {
    // A single collapsed theme grouping completely distinct friction vectors
    const collapsedThemes: SemanticTheme[] = [
      {
        themeId: "theme-collapsed",
        canonicalMeaning: "Difficulty with modest summer dresses",
        description: "Customers struggle with see-through fabrics, intense sweating from layering, disproportionate fit, and shrinkage after washing.",
        supportingEvidenceUnitIds: ["ev-1", "ev-2", "ev-3", "ev-4", "ev-5", "ev-6"],
        supportingClaimIds: ["clm-1", "clm-2", "clm-3", "clm-4", "clm-5", "clm-6"],
        claimKinds: ["PROBLEM"],
        competitorIds: ["comp-1", "comp-2", "comp-3", "comp-4"],
        platforms: ["reddit"],
        semanticRationale: "Bundled dress problems",
        confidence: 0.93,
      },
    ];

    const auditReport = await auditThemeInventoryAtomicityWithLLM(
      collapsedThemes,
      mockClassifiedUnits,
      businessContext,
      "test-account"
    );

    expect(auditReport.verdict).toBe("OVER_COLLAPSED");
    expect(auditReport.issues.length).toBeGreaterThan(0);
    expect(auditReport.repairFeedback).toBeTruthy();
  }, 45000);

  it("generates atomic themes preserving full evidence and claim lineage across distinct vectors", async () => {
    const result = await generateSemanticThemeInventoryWithLLM(
      mockClassifiedUnits,
      businessContext,
      "test-account"
    );

    // Must not over-collapse into 1 generic theme: distinct problem vectors must produce multiple distinct atomic themes
    expect(result.themes.length).toBeGreaterThanOrEqual(3);

    for (const theme of result.themes) {
      expect(theme.themeId).toBeTruthy();
      expect(theme.canonicalMeaning).toBeTruthy();
      expect(theme.supportingEvidenceUnitIds.length).toBeGreaterThan(0);
      expect(theme.supportingClaimIds.length).toBeGreaterThan(0);

      // Verify every supporting evidence unit ID actually maps back to an input unit
      for (const evId of theme.supportingEvidenceUnitIds) {
        expect(mockClassifiedUnits.some(u => u.evidenceUnitId === evId)).toBe(true);
      }
    }
  }, 60000);

  it("auditThemeInventoryAtomicityWithLLM approves well-separated atomic themes", async () => {
    const atomicThemes: SemanticTheme[] = [
      {
        themeId: "theme-transparency",
        canonicalMeaning: "Fabric Sheerness & Transparency",
        description: "Lightweight summer dress fabrics fail opacity in direct daylight and are excessively sheer and see-through.",
        supportingEvidenceUnitIds: ["ev-1", "ev-2"],
        supportingClaimIds: ["clm-1", "clm-2"],
        claimKinds: ["PROBLEM"],
        competitorIds: ["comp-1", "comp-2"],
        platforms: ["reddit"],
        semanticRationale: "Distinct fabric opacity failure mode",
        confidence: 0.93,
      },
      {
        themeId: "theme-layering-heat",
        canonicalMeaning: "Thermal Discomfort & Perspiration From Layering",
        description: "Wearing multiple slips, camisoles, and base layers in high summer temperatures creates trapped heat and severe sweating.",
        supportingEvidenceUnitIds: ["ev-3"],
        supportingClaimIds: ["clm-3"],
        claimKinds: ["PROBLEM"],
        competitorIds: ["comp-1"],
        platforms: ["reddit"],
        semanticRationale: "Distinct thermal heat & sweating failure mode",
        confidence: 0.94,
      },
      {
        themeId: "theme-fit-proportions",
        canonicalMeaning: "Neckline Gaping & Proportion Inconsistencies",
        description: "Sizing cuts expose necklines and armholes while fitting poorly across bust and waist proportions.",
        supportingEvidenceUnitIds: ["ev-4", "ev-5"],
        supportingClaimIds: ["clm-4", "clm-5"],
        claimKinds: ["PROBLEM"],
        competitorIds: ["comp-3", "comp-4"],
        platforms: ["reddit"],
        semanticRationale: "Distinct fit & proportion mismatch failure mode",
        confidence: 0.92,
      },
      {
        themeId: "theme-wash-shrinkage",
        canonicalMeaning: "Fabric Shrinkage & Garment Shortening",
        description: "Dresses lose critical length and garment coverage after laundering.",
        supportingEvidenceUnitIds: ["ev-6"],
        supportingClaimIds: ["clm-6"],
        claimKinds: ["PROBLEM"],
        competitorIds: ["comp-2"],
        platforms: ["reddit"],
        semanticRationale: "Distinct fabric laundering shrinkage failure mode",
        confidence: 0.96,
      },
    ];

    const auditReport = await auditThemeInventoryAtomicityWithLLM(
      atomicThemes,
      mockClassifiedUnits,
      businessContext,
      "test-account"
    );

    expect(auditReport.verdict).toBe("VALID");
    expect(auditReport.issues.length).toBe(0);
  }, 45000);
});
