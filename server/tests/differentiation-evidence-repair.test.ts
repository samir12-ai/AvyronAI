import { beforeEach, describe, expect, it, vi } from "vitest";

const { mockAiChat, dbMutationGuard } = vi.hoisted(() => ({
  mockAiChat: vi.fn(),
  dbMutationGuard: vi.fn(() => {
    throw new Error("SHARED_STORAGE_MUTATION_FORBIDDEN: Offline tests must not mutate shared database state.");
  }),
}));

vi.mock("../ai-client", () => ({
  aiChat: mockAiChat,
}));

vi.mock("../db", () => ({
  db: {
    insert: dbMutationGuard,
    update: dbMutationGuard,
    delete: dbMutationGuard,
    execute: dbMutationGuard,
    transaction: dbMutationGuard,
  },
}));

import {
  runDifferentiationEngine,
  computeCandidateApprovalFingerprint,
  extractCandidateEvidenceDependencies,
  finalizeComparisonBaselineOnlyDefect,
} from "../differentiation-engine/engine";
import {
  judgeDifferentiation,
  validateCandidateComparisonAndScopeDeterministically,
} from "../differentiation-engine/judge";
import { selectEvidence } from "../audience-engine/evidence-selector";
import { buildAudiencePainRegistry } from "../shared/audience-pain-registry";
import { shouldBlockDownstream } from "../orchestrator/priority-matrix";
import { computeProductTruthFingerprint } from "../shared/product-dna";

const ACCOUNT_ID = "35ff3654-456f-409d-b3b0-d0d261945a32";
const CAMPAIGN_ID = "camp_04ab10b0-a42";
const OFFERING_ID = "off_4e78386f-0";
const JOB_ID = "orch_1792045601277_4sgp65";
const SNAPSHOT_ID = "3c6fc355-bcca-4dd2-84ad-55622ba24930";

/**
 * Exact 15 canonical Product Truth facts from incident run orch_1792045601277_4sgp65
 * (Baklawati Antep Fistikli Kadayifli Karisik Tatli Kutusu 400g -> fingerprint pt_7703d7186724da80).
 */
const BAKLAWATI_15_FACTS = [
  {
    productTruthFactId: "fact_cap_0",
    fact: "Handcrafted traditional Gaziantep baklava and kadayif assortment produced daily in Gaziantep",
    factType: "CAPABILITY" as const,
    confidence: 0.92,
    campaignOfferingId: OFFERING_ID,
    accountId: ACCOUNT_ID,
    snapshotId: SNAPSHOT_ID,
  },
  {
    productTruthFactId: "fact_cap_1",
    fact: "Contains first-harvest Boz Antep pistachios (Boz iç fıstık) and 100% pure clarified sheep-milk butter (sade yağ)",
    factType: "CAPABILITY" as const,
    confidence: 0.92,
    campaignOfferingId: OFFERING_ID,
    accountId: ACCOUNT_ID,
    snapshotId: SNAPSHOT_ID,
  },
  {
    productTruthFactId: "fact_cap_2",
    fact: "Assorted 400g gift box combining multiple pistachio baklava and kadayif varieties",
    factType: "CAPABILITY" as const,
    confidence: 0.92,
    campaignOfferingId: OFFERING_ID,
    accountId: ACCOUNT_ID,
    snapshotId: SNAPSHOT_ID,
  },
  {
    productTruthFactId: "fact_cap_3",
    fact: "Sweetened with natural beet sugar syrup without glucose syrup or artificial corn sweeteners",
    factType: "CAPABILITY" as const,
    confidence: 0.92,
    campaignOfferingId: OFFERING_ID,
    accountId: ACCOUNT_ID,
    snapshotId: SNAPSHOT_ID,
  },
  {
    productTruthFactId: "fact_cap_4",
    fact: "Stone-oven baked thin phyllo layers rolled by master baklava artisans (usta ellerden)",
    factType: "CAPABILITY" as const,
    confidence: 0.92,
    campaignOfferingId: OFFERING_ID,
    accountId: ACCOUNT_ID,
    snapshotId: SNAPSHOT_ID,
  },
  {
    productTruthFactId: "fact_del_0",
    fact: "Same-day dispatch from Gaziantep production facility in protective sealed gift box packaging",
    factType: "DELIVERY_MECHANISM" as const,
    confidence: 0.9,
    campaignOfferingId: OFFERING_ID,
    accountId: ACCOUNT_ID,
    snapshotId: SNAPSHOT_ID,
  },
  {
    productTruthFactId: "fact_del_1",
    fact: "Direct-to-consumer nationwide courier delivery across Turkey",
    factType: "DELIVERY_MECHANISM" as const,
    confidence: 0.9,
    campaignOfferingId: OFFERING_ID,
    accountId: ACCOUNT_ID,
    snapshotId: SNAPSHOT_ID,
  },
  {
    productTruthFactId: "fact_prf_0",
    fact: "Authentic Gaziantep regional ingredients (Antep pistachio and Urfa/Gaziantep clarified butter)",
    factType: "PROOF" as const,
    confidence: 0.88,
    campaignOfferingId: OFFERING_ID,
    accountId: ACCOUNT_ID,
    snapshotId: SNAPSHOT_ID,
  },
  {
    productTruthFactId: "fact_prf_1",
    fact: "No artificial preservatives, coloring agents, or glucose syrup used in production",
    factType: "PROOF" as const,
    confidence: 0.88,
    campaignOfferingId: OFFERING_ID,
    accountId: ACCOUNT_ID,
    snapshotId: SNAPSHOT_ID,
  },
  {
    productTruthFactId: "fact_pri_0",
    fact: "400g assorted box format positioned for personal tasting, household sharing, or gifting",
    factType: "PRICING_FACT" as const,
    confidence: 0.85,
    campaignOfferingId: OFFERING_ID,
    accountId: ACCOUNT_ID,
    snapshotId: SNAPSHOT_ID,
  },
  {
    productTruthFactId: "fact_diff_0",
    fact: "Combines both baklava and kadayif specialties with high Antep pistachio density in a single 400g box",
    factType: "CAPABILITY" as const,
    confidence: 0.9,
    campaignOfferingId: OFFERING_ID,
    accountId: ACCOUNT_ID,
    snapshotId: SNAPSHOT_ID,
  },
  {
    productTruthFactId: "fact_diff_1",
    fact: "Daily fresh batch preparation shipped directly from the point of origin in Gaziantep",
    factType: "CAPABILITY" as const,
    confidence: 0.9,
    campaignOfferingId: OFFERING_ID,
    accountId: ACCOUNT_ID,
    snapshotId: SNAPSHOT_ID,
  },
  {
    productTruthFactId: "fact_use_0",
    fact: "Holiday, hospitality, and special-occasion dessert gifting",
    factType: "CAPABILITY" as const,
    confidence: 0.88,
    campaignOfferingId: OFFERING_ID,
    accountId: ACCOUNT_ID,
    snapshotId: SNAPSHOT_ID,
  },
  {
    productTruthFactId: "fact_use_1",
    fact: "Tea and coffee accompaniment for families seeking authentic Antep desserts at home",
    factType: "CAPABILITY" as const,
    confidence: 0.88,
    campaignOfferingId: OFFERING_ID,
    accountId: ACCOUNT_ID,
    snapshotId: SNAPSHOT_ID,
  },
  {
    productTruthFactId: "fact_anch_0",
    fact: "Antep Fistikli Kadayifli Karisik Tatli Kutusu 400g — assorted Gaziantep pistachio baklava and kadayif box",
    factType: "CAPABILITY" as const,
    confidence: 0.95,
    campaignOfferingId: OFFERING_ID,
    accountId: ACCOUNT_ID,
    snapshotId: SNAPSHOT_ID,
  },
];

function buildPassJudgeResponse(rationale = "SYNTHETIC_MOCK_JUDGE: All assessments pass.") {
  return {
    choices: [
      {
        message: {
          content: JSON.stringify({
            valid: true,
            assessmentsCompleted: true,
            assessmentDetails: {
              productFactualSupport: true,
              competitiveFactualSupport: true,
              audienceLaneRelevance: true,
              commercialMeaningfulness: true,
              strategicRoleValidity: true,
              evidenceCompleteness: true,
            },
            defects: [],
            overallVerdictRationale: rationale,
          }),
        },
      },
    ],
  };
}

describe("Differentiation Evidence & Targeted Repair Verification (Cases A–N + Incident Reproduction)", () => {
  let fetchSpy: any;

  beforeEach(() => {
    mockAiChat.mockReset();
    dbMutationGuard.mockClear();
    fetchSpy = vi.spyOn(globalThis, "fetch").mockImplementation(async () => {
      throw new Error("OUTBOUND_NETWORK_CALL_FORBIDDEN: Offline tests must not make live network requests.");
    });
  });

  it("Case A: Duplicate fact references are normalized before judging and duplicate-only Judge complaints are stripped", async () => {
    const painId = "pain_dup_facts";
    // Mock 1: Proposer returns duplicate productTruthFactIds and duplicate customerEvidenceIds
    mockAiChat.mockResolvedValueOnce({
      choices: [
        {
          message: {
            content: JSON.stringify({
              differentiations: [
                {
                  differentiationId: "cand_case_a",
                  corePainIds: [painId, painId],
                  differentiationClaim:
                    "Handcrafted in Gaziantep using first-harvest Boz Antep pistachios and pure clarified sheep-milk butter.",
                  distinctiveProperty: "Gaziantep First-Harvest Boz Pistachio & Pure Clarified Butter Craft",
                  buyerValue:
                    "Gives dessert buyers confidence in authentic regional ingredients and daily Gaziantep preparation.",
                  productTruthFactIds: ["fact_cap_0", "fact_cap_1", "fact_cap_0", "fact_cap_1"],
                  comparisonBaseline: {
                    statement:
                      "Strategic market emphasis focused on verified Gaziantep ingredient provenance [fact_cap_0, fact_cap_1] to address buyer ingredient concerns.",
                    miAuthorityIds: [],
                    customerEvidenceIds: [],
                    competitorIds: [],
                    evidenceBasisType: "STRATEGIC_MARKET_EMPHASIS",
                  },
                  proofBoundary: "Grounded in verified ingredient and daily Gaziantep production facts.",
                  strategicForm: "STRATEGIC_MARKET_EMPHASIS",
                },
              ],
              painDispositions: [{ painId, disposition: "ACCEPTED_DIFFERENTIATION", differentiationId: "cand_case_a" }],
            }),
          },
        },
      ],
    });

    // Mock 2 (SYNTHETIC_MOCK_JUDGE): Judge complains solely about duplicate fact IDs even after normalization
    mockAiChat.mockResolvedValueOnce({
      choices: [
        {
          message: {
            content: JSON.stringify({
              valid: false,
              assessmentsCompleted: true,
              assessmentDetails: {
                productFactualSupport: true,
                competitiveFactualSupport: false,
                audienceLaneRelevance: true,
                commercialMeaningfulness: true,
                strategicRoleValidity: true,
                evidenceCompleteness: true,
              },
              defects: [
                {
                  differentiationId: "cand_case_a",
                  code: "SPECIFICITY_LACKING",
                  reason: "Candidate cites repetition of the same fact ID multiple times without additional distinct proof.",
                  rejectedFields: ["productTruthFactIds"],
                  fixDirective: "Remove duplicate fact IDs.",
                },
              ],
              overallVerdictRationale: "SYNTHETIC_MOCK_JUDGE: Rejected solely for duplicate fact ID citation.",
            }),
          },
        },
      ],
    });

    const result = await runDifferentiationEngine(
      { competitors: [], dominance: [] },
      {
        painRegistry: [
          {
            painId,
            classification: "CORE_PURCHASE",
            canonical: "Uncertainty about authentic pistachio ingredients in boxed baklava",
            productTruthFactIds: ["fact_cap_0", "fact_cap_1"],
          },
        ],
        productTruthFacts: BAKLAWATI_15_FACTS,
      },
      {},
      {
        accountId: ACCOUNT_ID,
        campaignId: CAMPAIGN_ID,
        campaignOfferingId: OFFERING_ID,
        productTruthSnapshotId: SNAPSHOT_ID,
      }
    );

    expect(result.status).toBe("SUCCESS");
    expect(result.differentiations).toHaveLength(1);
    expect(result.differentiations[0].productTruthFactIds).toEqual(["fact_cap_0", "fact_cap_1"]);
    expect(result.differentiations[0].corePainIds).toEqual([painId]);
    // Verify Proposer->Judge inspectable call args saw deduplicated productTruthFactIds
    const judgePromptArg = mockAiChat.mock.calls[1][0].messages[0].content as string;
    expect(judgePromptArg).toContain('"productTruthFactIds": [\n        "fact_cap_0",\n        "fact_cap_1"\n      ]');
    expect(mockAiChat).toHaveBeenCalledTimes(2); // No unnecessary repair round triggered
  });

  it("Case B: Ordinary grounded product descriptions and faithful paraphrases pass without verbatim wording", async () => {
    const painId = "pain_paraphrase";
    mockAiChat
      .mockResolvedValueOnce({
        choices: [
          {
            message: {
              content: JSON.stringify({
                differentiations: [
                  {
                    differentiationId: "cand_case_b",
                    corePainIds: [painId],
                    // Paraphrases fact_cap_1 + fact_cap_3 + fact_del_0 without copying exact strings
                    differentiationClaim:
                      "Prepared daily in Gaziantep with first-harvest Antep pistachios, pure sheep-milk butter, and natural beet sugar syrup rather than glucose sweeteners.",
                    distinctiveProperty: "Beet-Sugar & Clarified Sheep-Butter Gaziantep Assortment",
                    buyerValue:
                      "Allows households and gift buyers to serve traditional stone-oven baked baklava and kadayif dispatched directly from Gaziantep.",
                    productTruthFactIds: ["fact_cap_1", "fact_cap_3", "fact_del_0"],
                    comparisonBaseline: {
                      statement:
                        "Strategic market emphasis highlighting verified beet-sugar sweetening and Gaziantep origin dispatch [fact_cap_1, fact_cap_3, fact_del_0].",
                      miAuthorityIds: [],
                      customerEvidenceIds: [],
                      competitorIds: [],
                      evidenceBasisType: "STRATEGIC_MARKET_EMPHASIS",
                    },
                    proofBoundary: "Supported by verified ingredient and dispatch facts; does not claim transit-time guarantees.",
                    strategicForm: "STRATEGIC_MARKET_EMPHASIS",
                  },
                ],
                painDispositions: [{ painId, disposition: "ACCEPTED_DIFFERENTIATION", differentiationId: "cand_case_b" }],
              }),
            },
          },
        ],
      })
      .mockResolvedValueOnce(buildPassJudgeResponse("SYNTHETIC_MOCK_JUDGE: Faithful paraphrase accepted."));

    const result = await runDifferentiationEngine(
      { competitors: [], dominance: [] },
      {
        painRegistry: [
          {
            painId,
            classification: "CORE_PURCHASE",
            canonical: "Buyers want traditional ingredients without glucose syrup",
            productTruthFactIds: ["fact_cap_1", "fact_cap_3", "fact_del_0"],
          },
        ],
        productTruthFacts: BAKLAWATI_15_FACTS,
      },
      {},
      {
        accountId: ACCOUNT_ID,
        campaignId: CAMPAIGN_ID,
        campaignOfferingId: OFFERING_ID,
        productTruthSnapshotId: SNAPSHOT_ID,
      }
    );

    expect(result.status).toBe("SUCCESS");
    expect(result.differentiations).toHaveLength(1);
    expect(result.differentiations[0].differentiationId).toBe("cand_case_b");
  });

  it("Case C: Unsupported guarantees (e.g. guaranteed moistness, mold prevention, freshness on arrival) are rejected even when 2+ valid fact IDs are cited", async () => {
    const input: any = {
      lineage: {
        accountId: ACCOUNT_ID,
        campaignId: CAMPAIGN_ID,
        jobId: JOB_ID,
        audienceSnapshotId: "aud_1",
        miSnapshotId: "mi_1",
        campaignOfferingId: OFFERING_ID,
        productTruthSnapshotId: SNAPSHOT_ID,
      },
      corePains: [],
      ourProductFacts: BAKLAWATI_15_FACTS,
      productTruth: BAKLAWATI_15_FACTS,
      miFacts: [],
      competitiveAuthority: [],
      customerEvidence: [],
      strategicLanes: [],
      marketContext: {},
    };

    const overclaimingCandidate: any = {
      differentiationId: "cand_case_c",
      corePainIds: ["pain_1"],
      differentiationClaim:
        "Daily Gaziantep production and sealed gift packaging guarantee moistness, mold prevention, and guaranteed freshness on arrival.",
      distinctiveProperty: "Guaranteed Freshness & Mold Prevention System",
      buyerValue: "Guarantees superior taste and zero syrupy sogginess on every delivery.",
      productTruthFactIds: ["fact_cap_0", "fact_del_0", "fact_diff_1"],
      comparisonBaseline: {
        statement: "Strategic market emphasis on daily production [fact_cap_0, fact_del_0].",
        miAuthorityIds: [],
        customerEvidenceIds: [],
        competitorIds: [],
        evidenceBasisType: "STRATEGIC_MARKET_EMPHASIS",
      },
      proofBoundary: "Backed by daily production.",
      strategicForm: "STRATEGIC_MARKET_EMPHASIS",
    };

    // Even if the LLM Judge mistakenly says valid: true, deterministic validation catches the unsupported material guarantee
    mockAiChat.mockResolvedValueOnce(
      buildPassJudgeResponse("SYNTHETIC_MOCK_JUDGE: Mistakenly approved guarantee.")
    );

    const judgeOut = await judgeDifferentiation(input, [overclaimingCandidate]);
    expect(judgeOut.valid).toBe(false);
    expect(judgeOut.assessmentDetails.productFactualSupport).toBe(false);
    expect(judgeOut.defects.some((d) => d.code === "PRODUCT_TRUTH_UNSUPPORTED")).toBe(true);
  });

  it("Case D: A competitor-linked customer review supports an attributed comparison even when comparisonBaseline.miAuthorityIds is empty", async () => {
    const painId = "pain_dry_baklava";
    const compReviewEv = {
      customerEvidenceId: "cev_rev_comp_koall_01",
      rawEvidenceUids: ["EV-301"],
      painIds: [painId],
      origin: "COMPETITOR_REVIEW" as const,
      actorType: "CUSTOMER" as const,
      platform: "google_reviews",
      author: "user_ahmet",
      verbatimText: "I ordered a box of pistachio baklava from Karaköy Güllüoğlu and it arrived dry with very little syrup.",
      competitorId: "comp_karakoy_gulluoglu",
      competitorName: "Karaköy Güllüoğlu",
      isAllegation: false,
      accountId: ACCOUNT_ID,
      campaignId: CAMPAIGN_ID,
      campaignOfferingId: OFFERING_ID,
    };

    mockAiChat
      .mockResolvedValueOnce({
        choices: [
          {
            message: {
              content: JSON.stringify({
                differentiations: [
                  {
                    differentiationId: "cand_case_d",
                    corePainIds: [painId],
                    differentiationClaim:
                      "Prepared daily in Gaziantep with natural beet sugar syrup and dispatched same-day in sealed gift packaging.",
                    distinctiveProperty: "Same-Day Gaziantep Dispatch & Natural Beet Sugar Syrup",
                    buyerValue:
                      "Addresses buyer concerns about receiving dry pastries by pairing daily stone-oven baking with direct origin dispatch.",
                    productTruthFactIds: ["fact_cap_0", "fact_cap_3", "fact_del_0"],
                    comparisonBaseline: {
                      statement:
                        "A customer reviewing Karaköy Güllüoğlu [cev_rev_comp_koall_01] reported receiving pistachio baklava that arrived dry with very little syrup.",
                      miAuthorityIds: [],
                      customerEvidenceIds: ["cev_rev_comp_koall_01"],
                      competitorIds: ["comp_karakoy_gulluoglu"],
                      evidenceBasisType: "COMPETITOR_CUSTOMER_VOICE",
                    },
                    proofBoundary:
                      "Reflects an attributed customer review [cev_rev_comp_koall_01] rather than a universal competitor characteristic.",
                    strategicForm: "DOCUMENTED_COMPARATIVE_CONTRAST",
                  },
                ],
                painDispositions: [{ painId, disposition: "ACCEPTED_DIFFERENTIATION", differentiationId: "cand_case_d" }],
              }),
            },
          },
        ],
      })
      // Even if a legacy-style Judge response complains solely that miAuthorityIds is empty, the guard preserves the valid competitor-linked customer voice
      .mockResolvedValueOnce({
        choices: [
          {
            message: {
              content: JSON.stringify({
                valid: false,
                assessmentsCompleted: true,
                assessmentDetails: {
                  productFactualSupport: true,
                  competitiveFactualSupport: false,
                  audienceLaneRelevance: true,
                  commercialMeaningfulness: true,
                  strategicRoleValidity: true,
                  evidenceCompleteness: true,
                },
                defects: [
                  {
                    differentiationId: "cand_case_d",
                    code: "MI_BASELINE_UNSUPPORTED",
                    reason: "comparisonBaseline names Karaköy Güllüoğlu while miAuthorityIds is empty.",
                    rejectedFields: ["comparisonBaseline.statement"],
                    fixDirective: "Populate miAuthorityIds or remove competitor name.",
                  },
                ],
                overallVerdictRationale: "SYNTHETIC_MOCK_JUDGE: Rejected because miAuthorityIds is empty.",
              }),
            },
          },
        ],
      });

    const result = await runDifferentiationEngine(
      { competitors: [{ id: "comp_karakoy_gulluoglu", name: "Karaköy Güllüoğlu" }], dominance: [] },
      {
        painRegistry: [
          {
            painId,
            classification: "CORE_PURCHASE",
            canonical: "Customers worry about baklava arriving dry after shipping",
            evidenceUids: ["EV-301"],
            productTruthFactIds: ["fact_cap_0", "fact_cap_3", "fact_del_0"],
          },
        ],
        productTruthFacts: BAKLAWATI_15_FACTS,
        customerEvidence: [compReviewEv],
      },
      {},
      {
        accountId: ACCOUNT_ID,
        campaignId: CAMPAIGN_ID,
        campaignOfferingId: OFFERING_ID,
        productTruthSnapshotId: SNAPSHOT_ID,
        customerEvidence: [compReviewEv],
      }
    );

    expect(result.status).toBe("SUCCESS");
    expect(result.differentiations).toHaveLength(1);
    expect(result.differentiations[0].comparisonBaseline.miAuthorityIds).toEqual([]);
    expect(result.differentiations[0].comparisonBaseline.customerEvidenceIds).toEqual(["cev_rev_comp_koall_01"]);
    expect(result.differentiations[0].comparisonBaseline.competitorIds).toEqual(["comp_karakoy_gulluoglu"]);
    expect(result.differentiations[0].comparisonBaseline.evidenceBasisType).toBe("COMPETITOR_CUSTOMER_VOICE");
  });

  it("Case E: Existing competitor association and canonical evidence identity are preserved across Audience selector/registry and restored when lost in handoff", async () => {
    // 1. Verify selectEvidence preserves canonicalEvidenceId, competitorId, competitorName, author, url, rawEvidenceReference
    const selectionResult = await selectEvidence([
      {
        id: "rev_row_99",
        canonicalEvidenceId: "cev_rev_99aabbccddeeff00",
        origin: "COMPETITOR_REVIEW",
        text: "Ordered the 500g box from Competitor Alpha and the syrup had crystallized completely.",
        source: "review",
        competitor: "Competitor Alpha",
        actualCompetitorId: "comp_alpha_id",
        competitorName: "Competitor Alpha",
        platform: "trustpilot",
        author: "verified_buyer_1",
        url: "https://example.com/reviews/99",
        rawEvidenceReference: { table: "ci_competitor_reviews", id: "rev_row_99" },
      },
    ]);

    expect(selectionResult.selectedUnits).toHaveLength(1);
    const unit = selectionResult.selectedUnits[0];
    expect(unit.canonicalEvidenceId).toBe("cev_rev_99aabbccddeeff00");
    expect(unit.competitorId).toBe("comp_alpha_id");
    expect(unit.competitorName).toBe("Competitor Alpha");
    expect(unit.author).toBe("verified_buyer_1");

    // 2. Verify buildAudiencePainRegistry preserves canonical cev_* ID rather than degrading to ext:ev-1
    const registry = buildAudiencePainRegistry(
      [
        {
          painId: "pain_crystallized",
          canonical: "Syrup crystallization in shipped baklava",
          classification: "CORE_PURCHASE",
          productFit: "ELIGIBLE",
          eligible: true,
          evidenceUids: [unit.id],
        },
      ],
      { accountId: ACCOUNT_ID, campaignId: CAMPAIGN_ID, audienceSnapshotId: "aud_snap_e" },
      {
        [unit.id]: {
          evidenceUid: unit.id,
          canonicalEvidenceId: unit.canonicalEvidenceId,
          origin: unit.origin,
          sourceType: "review",
          sourceIdentity: unit.platform || "trustpilot",
          author: unit.author,
          verbatimText: unit.text,
          competitorId: unit.competitorId,
          competitorName: unit.competitorName,
          rawEvidenceReference: unit.rawEvidenceReference,
        },
      }
    );

    expect(registry[0].materiality?.evidence[0]?.canonicalEvidenceId).toBe("cev_rev_99aabbccddeeff00");
    expect(registry[0].materiality?.evidence[0]?.competitorId).toBe("comp_alpha_id");

    // 3. Verify runDifferentiationEngine restores competitor association even if painRegistry materiality lost competitorId during a legacy handoff
    const strippedPain = {
      painId: "pain_crystallized",
      classification: "CORE_PURCHASE",
      canonical: "Syrup crystallization in shipped baklava",
      evidenceUids: ["EV-1"],
      materiality: {
        painId: "pain_crystallized",
         backingRecordCount: 1,
        uniqueSourceCount: 1,
        uniqueAuthorCount: 1,
        uniquePlatformCount: 1,
        materialityScore: 0.7,
        gateStatus: "PASS",
        gateReasons: [],
        evidence: [
          {
            evidenceUid: "EV-1",
            canonicalEvidenceId: "ext:ev-1", // Degraded ID from legacy handoff
            sourceType: "review",
            sourceIdentity: "trustpilot",
            verbatimText: "Ordered the 500g box from Competitor Alpha and the syrup had crystallized completely.",
            // competitorId intentionally missing on the pain record
          },
        ],
      },
    };

    mockAiChat
      .mockResolvedValueOnce({
        choices: [
          {
            message: {
              content: JSON.stringify({
                differentiations: [
                  {
                    differentiationId: "cand_case_e",
                    corePainIds: ["pain_crystallized"],
                    differentiationClaim:
                      "Sweetened with natural beet sugar syrup and baked daily in Gaziantep.",
                    distinctiveProperty: "Natural Beet Sugar Syrup Formulation",
                    buyerValue: "Provides traditional beet-sugar sweetening without glucose syrup.",
                    productTruthFactIds: ["fact_cap_3", "fact_prf_1"],
                    comparisonBaseline: {
                      statement:
                        "A customer reviewing Competitor Alpha [cev_rev_99aabbccddeeff00] reported that the syrup in their 500g box had crystallized.",
                      miAuthorityIds: [],
                      customerEvidenceIds: ["EV-1"], // Proposer cites EV-1; engine normalizes to cev_rev_99aabbccddeeff00 and restores comp_alpha_id
                      competitorIds: [],
                      evidenceBasisType: "COMPETITOR_CUSTOMER_VOICE",
                    },
                    proofBoundary: "Attributed customer review [cev_rev_99aabbccddeeff00].",
                    strategicForm: "DOCUMENTED_COMPARATIVE_CONTRAST",
                  },
                ],
                painDispositions: [
                  { painId: "pain_crystallized", disposition: "ACCEPTED_DIFFERENTIATION", differentiationId: "cand_case_e" },
                ],
              }),
            },
          },
        ],
      })
      .mockResolvedValueOnce(buildPassJudgeResponse("SYNTHETIC_MOCK_JUDGE: Restored competitor customer voice accepted."));

    const diffRes = await runDifferentiationEngine(
      { competitors: [{ id: "comp_alpha_id", name: "Competitor Alpha" }], dominance: [] },
      {
        painRegistry: [strippedPain],
        productTruthFacts: BAKLAWATI_15_FACTS,
      },
      {},
      {
        accountId: ACCOUNT_ID,
        campaignId: CAMPAIGN_ID,
        campaignOfferingId: OFFERING_ID,
        productTruthSnapshotId: SNAPSHOT_ID,
        // Pinned canonical customer voice from the run restores the lost association
        customerEvidence: [
          {
            evidenceId: "cev_rev_99aabbccddeeff00",
            origin: "COMPETITOR_REVIEW",
            competitorId: "comp_alpha_id",
            competitorName: "Competitor Alpha",
            platform: "trustpilot",
            author: "verified_buyer_1",
            text: "Ordered the 500g box from Competitor Alpha and the syrup had crystallized completely.",
            rawEvidenceReference: { table: "ci_competitor_reviews", id: "rev_row_99" },
          },
        ],
      }
    );

    expect(diffRes.status).toBe("SUCCESS");
    expect(diffRes.differentiations[0].comparisonBaseline.customerEvidenceIds).toEqual(["cev_rev_99aabbccddeeff00"]);
    expect(diffRes.differentiations[0].comparisonBaseline.competitorIds).toEqual(["comp_alpha_id"]);
  });

  it("Case F: An unattributed market voice review does not acquire a fabricated competitor association", () => {
    const input: any = {
      lineage: {
        accountId: ACCOUNT_ID,
        campaignId: CAMPAIGN_ID,
        jobId: JOB_ID,
        audienceSnapshotId: "aud_1",
        miSnapshotId: "mi_1",
        campaignOfferingId: OFFERING_ID,
        productTruthSnapshotId: SNAPSHOT_ID,
      },
      corePains: [],
      ourProductFacts: BAKLAWATI_15_FACTS,
      productTruth: BAKLAWATI_15_FACTS,
      miFacts: [],
      competitiveAuthority: [],
      customerEvidence: [
        {
          customerEvidenceId: "cev_mar_76f74860f039611d",
          rawEvidenceUids: ["EV-201", "EV-206"],
          painIds: ["seg_b7f81ee40135451f_seg_1_pain_4"],
          origin: "MARKET_VOICE",
          actorType: "CUSTOMER",
          platform: "reddit",
          author: "lamorie",
          verbatimText: "It's a pretty box, and I'm a sucker for good packaging. The baklava itself was dry and flavorless.",
          // No competitorId — unattributed r/traderjoes market voice
          isAllegation: false,
          accountId: ACCOUNT_ID,
          campaignId: CAMPAIGN_ID,
          campaignOfferingId: OFFERING_ID,
        },
      ],
      strategicLanes: [],
      marketContext: {},
    };

    const fabricatedAttributionCand: any = {
      differentiationId: "cand_case_f",
      corePainIds: ["seg_b7f81ee40135451f_seg_1_pain_4"],
      differentiationClaim: "Prepared daily in Gaziantep with first-harvest Antep pistachios.",
      distinctiveProperty: "Daily Gaziantep Preparation",
      buyerValue: "Provides fresh-baked Gaziantep assortment.",
      productTruthFactIds: ["fact_cap_0", "fact_cap_1"],
      comparisonBaseline: {
        statement:
          "Customers reviewing Competitor X [cev_mar_76f74860f039611d] reported that its baklava was dry and flavorless.",
        miAuthorityIds: [],
        customerEvidenceIds: ["cev_mar_76f74860f039611d"],
        competitorIds: ["comp_fabricated_x"],
        evidenceBasisType: "COMPETITOR_CUSTOMER_VOICE",
      },
      proofBoundary: "Grounded in customer review.",
      strategicForm: "DOCUMENTED_COMPARATIVE_CONTRAST",
    };

    const defects = validateCandidateComparisonAndScopeDeterministically(input, fabricatedAttributionCand);
    expect(defects.some((d) => d.code === "COMPETITIVE_SCOPE_OVERCLAIM")).toBe(true);
    expect(defects.map((d) => d.reason).join(" ")).toMatch(/unattributed|no verified competitor association/i);
  });

  it("Case G: A customer ingredient-substitution allegation must remain an attributed customer allegation unless independent evidence establishes the ingredient fact", () => {
    const input: any = {
      lineage: {
        accountId: ACCOUNT_ID,
        campaignId: CAMPAIGN_ID,
        jobId: JOB_ID,
        audienceSnapshotId: "aud_1",
        miSnapshotId: "mi_1",
        campaignOfferingId: OFFERING_ID,
        productTruthSnapshotId: SNAPSHOT_ID,
      },
      corePains: [],
      ourProductFacts: BAKLAWATI_15_FACTS,
      productTruth: BAKLAWATI_15_FACTS,
      miFacts: [],
      competitiveAuthority: [],
      customerEvidence: [
        {
          customerEvidenceId: "cev_mar_5c2dd352d6b1da7d",
          rawEvidenceUids: ["EV-211"],
          painIds: ["pain_allegation"],
          origin: "COMPETITOR_COMMENT",
          actorType: "CUSTOMER",
          platform: "reddit",
          author: "just_a_femboii",
          verbatimText:
            "Marketlerde gördüğüm plastik paketteki baklavayı denedim, fıstık yerine yeşil bezelye püresini kakalamışlar.",
          competitorId: "comp_packaged_brand",
          competitorName: "Packaged Brand X",
          productOrVariantScope: "supermarket plastic-packaged baklava variant",
          isAllegation: true,
          accountId: ACCOUNT_ID,
          campaignId: CAMPAIGN_ID,
          campaignOfferingId: OFFERING_ID,
        },
      ],
      strategicLanes: [],
      marketContext: {},
    };

    // 1. Stating the allegation as an established competitor ingredient fact is REJECTED
    const unattributedFactCand: any = {
      differentiationId: "cand_case_g_bad",
      corePainIds: ["pain_allegation"],
      differentiationClaim: "Uses genuine first-harvest Boz Antep pistachios [fact_cap_1].",
      distinctiveProperty: "First-Harvest Boz Antep Pistachio Content",
      buyerValue: "Authentic Antep pistachio content.",
      productTruthFactIds: ["fact_cap_1", "fact_prf_0"],
      comparisonBaseline: {
        statement:
          "Packaged Brand X uses green pea puree instead of real pistachios in its supermarket plastic-packaged baklava variant [cev_mar_5c2dd352d6b1da7d].",
        miAuthorityIds: [],
        customerEvidenceIds: ["cev_mar_5c2dd352d6b1da7d"],
        competitorIds: ["comp_packaged_brand"],
        evidenceBasisType: "COMPETITOR_CUSTOMER_VOICE",
      },
      proofBoundary: "Based on [cev_mar_5c2dd352d6b1da7d].",
      strategicForm: "DOCUMENTED_COMPARATIVE_CONTRAST",
    };

    const badDefects = validateCandidateComparisonAndScopeDeterministically(input, unattributedFactCand);
    expect(badDefects.some((d) => d.code === "COMPETITIVE_SCOPE_OVERCLAIM" || d.code === "UNSUPPORTED_NEGATIVE_CLAIM")).toBe(true);

    // 2. Framing it as an attributed customer allegation within the variant scope is ACCEPTED
    const attributedAllegationCand: any = {
      ...unattributedFactCand,
      differentiationId: "cand_case_g_good",
      comparisonBaseline: {
        statement:
          "A customer reviewing Packaged Brand X's supermarket plastic-packaged baklava variant [cev_mar_5c2dd352d6b1da7d] alleged that green pea puree was substituted for pistachio.",
        miAuthorityIds: [],
        customerEvidenceIds: ["cev_mar_5c2dd352d6b1da7d"],
        competitorIds: ["comp_packaged_brand"],
        evidenceBasisType: "COMPETITOR_CUSTOMER_VOICE",
      },
    };

    const goodDefects = validateCandidateComparisonAndScopeDeterministically(input, attributedAllegationCand);
    expect(goodDefects).toHaveLength(0);
  });

  it("Case H: One complaint or a variant-scoped review does not silently become a competitor-wide or market-wide claim", () => {
    const input: any = {
      lineage: {
        accountId: ACCOUNT_ID,
        campaignId: CAMPAIGN_ID,
        jobId: JOB_ID,
        audienceSnapshotId: "aud_1",
        miSnapshotId: "mi_1",
        campaignOfferingId: OFFERING_ID,
        productTruthSnapshotId: SNAPSHOT_ID,
      },
      corePains: [],
      ourProductFacts: BAKLAWATI_15_FACTS,
      productTruth: BAKLAWATI_15_FACTS,
      miFacts: [],
      competitiveAuthority: [],
      customerEvidence: [
        {
          customerEvidenceId: "cev_single_variant_01",
          rawEvidenceUids: ["EV-401"],
          painIds: ["pain_variant"],
          origin: "COMPETITOR_REVIEW",
          actorType: "CUSTOMER",
          platform: "google_reviews",
          author: "single_reviewer",
          verbatimText: "Marketlerde gördüğüm plastik paketteki baklava kuruydu.",
          competitorId: "comp_brand_y",
          competitorName: "Brand Y",
          productOrVariantScope: "supermarket plastic-packaged baklava variant",
          isAllegation: false,
          accountId: ACCOUNT_ID,
          campaignId: CAMPAIGN_ID,
          campaignOfferingId: OFFERING_ID,
        },
      ],
      strategicLanes: [],
      marketContext: {},
    };

    const universalOverclaimCand: any = {
      differentiationId: "cand_case_h",
      corePainIds: ["pain_variant"],
      differentiationClaim: "Daily fresh batch preparation shipped directly from Gaziantep [fact_diff_1].",
      distinctiveProperty: "Daily Gaziantep Batch Preparation",
      buyerValue: "Provides freshly baked Gaziantep baklava.",
      productTruthFactIds: ["fact_diff_1", "fact_cap_0"],
      comparisonBaseline: {
        statement:
          "Brand Y always sells dry baklava across every product in its catalog [cev_single_variant_01].",
        miAuthorityIds: [],
        customerEvidenceIds: ["cev_single_variant_01"],
        competitorIds: ["comp_brand_y"],
        evidenceBasisType: "COMPETITOR_CUSTOMER_VOICE",
      },
      proofBoundary: "Customer review [cev_single_variant_01].",
      strategicForm: "DOCUMENTED_COMPARATIVE_CONTRAST",
    };

    const defects = validateCandidateComparisonAndScopeDeterministically(input, universalOverclaimCand);
    expect(defects.some((d) => d.code === "COMPETITIVE_SCOPE_OVERCLAIM")).toBe(true);
  });

  it("Case I: Evidence about another product/offering, account, campaign, or excluded manifest row cannot silently support the candidate", async () => {
    const painId = "pain_isolation";
    // Cross-account, cross-offering, and non-manifest customer evidence items
    const crossAccountEv = {
      customerEvidenceId: "cev_other_account",
      verbatimText: "Cross account review text",
      accountId: "other_account_999",
      campaignId: CAMPAIGN_ID,
      campaignOfferingId: OFFERING_ID,
      rawEvidenceReference: { table: "market_voice_evidence", id: "mve_allowed_1" },
    };
    const crossOfferingEv = {
      customerEvidenceId: "cev_other_offering",
      verbatimText: "Cross offering review text",
      accountId: ACCOUNT_ID,
      campaignId: CAMPAIGN_ID,
      campaignOfferingId: "off_different_product_999",
      rawEvidenceReference: { table: "market_voice_evidence", id: "mve_allowed_1" },
    };
    const excludedFromManifestEv = {
      customerEvidenceId: "cev_excluded_manifest",
      verbatimText: "Newer unpinned market voice row outside frozen manifest",
      accountId: ACCOUNT_ID,
      campaignId: CAMPAIGN_ID,
      campaignOfferingId: OFFERING_ID,
      rawEvidenceReference: { table: "market_voice_evidence", id: "mve_not_in_manifest_999" },
    };

    // Also test cross-offering Product Truth fact rejection in deterministic validator
    const crossOfferingFactInput: any = {
      lineage: {
        accountId: ACCOUNT_ID,
        campaignId: CAMPAIGN_ID,
        jobId: JOB_ID,
        audienceSnapshotId: "aud_1",
        miSnapshotId: "mi_1",
        campaignOfferingId: OFFERING_ID,
        productTruthSnapshotId: SNAPSHOT_ID,
      },
      corePains: [],
      ourProductFacts: [
        ...BAKLAWATI_15_FACTS,
        {
          productTruthFactId: "fact_wrong_offering",
          fact: "2kg bulk catering tray",
          factType: "CAPABILITY",
          confidence: 0.9,
          campaignOfferingId: "off_other_999",
          accountId: ACCOUNT_ID,
          snapshotId: SNAPSHOT_ID,
        },
      ],
      productTruth: [],
      miFacts: [],
      competitiveAuthority: [],
      customerEvidence: [],
      strategicLanes: [],
      marketContext: {},
    };

    const crossFactCand: any = {
      differentiationId: "cand_cross_fact",
      corePainIds: [painId],
      differentiationClaim: "2kg bulk catering tray [fact_wrong_offering].",
      distinctiveProperty: "Bulk Tray",
      buyerValue: "Catering format.",
      productTruthFactIds: ["fact_wrong_offering"],
      comparisonBaseline: {
        statement: "Strategic market emphasis [fact_wrong_offering].",
        miAuthorityIds: [],
        customerEvidenceIds: [],
        competitorIds: [],
        evidenceBasisType: "STRATEGIC_MARKET_EMPHASIS",
      },
      proofBoundary: "Fact.",
      strategicForm: "STRATEGIC_MARKET_EMPHASIS",
    };

    const factDefects = validateCandidateComparisonAndScopeDeterministically(crossOfferingFactInput, crossFactCand);
    expect(factDefects.some((d) => d.code === "LINEAGE_REFERENCE_INVALID")).toBe(true);

    // Now verify runDifferentiationEngine filters out cross-account, cross-offering, and non-manifest customer evidence
    mockAiChat
      .mockResolvedValueOnce({
        choices: [
          {
            message: {
              content: JSON.stringify({
                differentiations: [
                  {
                    differentiationId: "cand_case_i",
                    corePainIds: [painId],
                    differentiationClaim: "Handcrafted daily in Gaziantep [fact_cap_0].",
                    distinctiveProperty: "Daily Gaziantep Craft",
                    buyerValue: "Fresh daily production.",
                    productTruthFactIds: ["fact_cap_0"],
                    comparisonBaseline: {
                      statement: "Citing excluded evidence [cev_excluded_manifest].",
                      miAuthorityIds: [],
                      customerEvidenceIds: ["cev_excluded_manifest"],
                      competitorIds: [],
                      evidenceBasisType: "UNATTRIBUTED_MARKET_VOICE",
                    },
                    proofBoundary: "Fact.",
                    strategicForm: "STRATEGIC_MARKET_EMPHASIS",
                  },
                ],
                painDispositions: [{ painId, disposition: "ACCEPTED_DIFFERENTIATION", differentiationId: "cand_case_i" }],
              }),
            },
          },
        ],
      })
      .mockResolvedValueOnce(buildPassJudgeResponse("SYNTHETIC_MOCK_JUDGE"))
      // Repair also tries to cite cross-account evidence
      .mockResolvedValueOnce({
        choices: [
          {
            message: {
              content: JSON.stringify({
                differentiations: [
                  {
                    differentiationId: "cand_case_i",
                    corePainIds: [painId],
                    differentiationClaim: "Handcrafted daily in Gaziantep [fact_cap_0].",
                    distinctiveProperty: "Daily Gaziantep Craft",
                    buyerValue: "Fresh daily production.",
                    productTruthFactIds: ["fact_cap_0"],
                    comparisonBaseline: {
                      statement: "Citing cross-account evidence [cev_other_account].",
                      miAuthorityIds: [],
                      customerEvidenceIds: ["cev_other_account"],
                      competitorIds: [],
                      evidenceBasisType: "UNATTRIBUTED_MARKET_VOICE",
                    },
                    proofBoundary: "Fact.",
                    strategicForm: "STRATEGIC_MARKET_EMPHASIS",
                  },
                ],
                painDispositions: [{ painId, disposition: "ACCEPTED_DIFFERENTIATION", differentiationId: "cand_case_i" }],
              }),
            },
          },
        ],
      })
      .mockResolvedValueOnce(buildPassJudgeResponse("SYNTHETIC_MOCK_JUDGE"));

    const res = await runDifferentiationEngine(
      { competitors: [], dominance: [] },
      {
        painRegistry: [{ painId, classification: "CORE_PURCHASE", canonical: "Quality concern" }],
        productTruthFacts: BAKLAWATI_15_FACTS,
      },
      {},
      {
        accountId: ACCOUNT_ID,
        campaignId: CAMPAIGN_ID,
        campaignOfferingId: OFFERING_ID,
        productTruthSnapshotId: SNAPSHOT_ID,
        customerEvidence: [crossAccountEv, crossOfferingEv, excludedFromManifestEv],
        evidenceManifest: {
          includedMarketVoiceIds: ["mve_allowed_1"],
        },
      }
    );

    // Proposer prompt must have 0 customerEvidence items because all 3 violated account/offering/manifest boundaries
    const proposerPrompt = mockAiChat.mock.calls[0][0].messages[0].content as string;
    expect(proposerPrompt).not.toContain("cev_other_account");
    expect(proposerPrompt).not.toContain("cev_other_offering");
    expect(proposerPrompt).not.toContain("cev_excluded_manifest");
    expect(res.differentiations[0]?.comparisonBaseline.customerEvidenceIds).not.toContain("cev_other_account");
  });

  it("Case J & Case K: A candidate with only a defective comparisonBaseline.statement survives targeted repair without unrelated changes, and neutralizing a baseline strips dependent superiority", () => {
    const canonicalInput: any = {
      lineage: {
        accountId: ACCOUNT_ID,
        campaignId: CAMPAIGN_ID,
        jobId: JOB_ID,
        audienceSnapshotId: "aud_1",
        miSnapshotId: "mi_1",
        campaignOfferingId: OFFERING_ID,
        productTruthSnapshotId: SNAPSHOT_ID,
      },
      corePains: [
        {
          painId: "pain_j",
          canonicalPain: "Concerns about dry texture and artificial sweeteners in boxed baklava",
          productTruthFactIds: ["fact_cap_0", "fact_cap_1", "fact_cap_3"],
          customerEvidenceIds: ["cev_mar_76f74860f039611d"],
        },
      ],
      ourProductFacts: BAKLAWATI_15_FACTS,
      productTruth: BAKLAWATI_15_FACTS,
      miFacts: [],
      competitiveAuthority: [],
      customerEvidence: [
        {
          customerEvidenceId: "cev_mar_76f74860f039611d",
          rawEvidenceUids: ["EV-201"],
          painIds: ["pain_j"],
          origin: "MARKET_VOICE",
          actorType: "CUSTOMER",
          platform: "reddit",
          author: "lamorie",
          verbatimText: "It's a pretty box, and I'm a sucker for good packaging. The baklava itself was dry and flavorless.",
          isAllegation: false,
          accountId: ACCOUNT_ID,
          campaignId: CAMPAIGN_ID,
          campaignOfferingId: OFFERING_ID,
        },
      ],
      strategicLanes: [],
      marketContext: {},
    };

    const candidateWithDisclaimerTrapAndSuperiority: any = {
      differentiationId: "cand_jk",
      corePainIds: ["pain_j"],
      differentiationClaim:
        "Unlike competitors who sell dry, glucose-heavy pastries, our 400g assortment is handcrafted daily in Gaziantep with first-harvest Boz Antep pistachios, pure clarified sheep-milk butter, and natural beet sugar syrup.",
      distinctiveProperty: "Gaziantep Daily Stone-Oven Baking with Natural Beet Sugar Syrup",
      buyerValue:
        "Gives buyers verified ingredient transparency and authentic Gaziantep craftsmanship, unlike competitors that cut corners.",
      productTruthFactIds: ["fact_cap_0", "fact_cap_1", "fact_cap_3"],
      comparisonBaseline: {
        statement:
          "Customer feedback highlights dissatisfaction with dry, flavorless baklava in attractive boxes, though specific competitor practices are not verified.",
        miAuthorityIds: [],
        customerEvidenceIds: [],
        competitorIds: [],
        evidenceBasisType: "STRATEGIC_MARKET_EMPHASIS",
      },
      proofBoundary: "Grounded in verified Gaziantep production and ingredient facts [fact_cap_0, fact_cap_1, fact_cap_3].",
      strategicForm: "STRATEGIC_MARKET_EMPHASIS",
    };

    const baselineOnlyDefect = [
      {
        differentiationId: "cand_jk",
        code: "COMPETITIVE_SCOPE_OVERCLAIM" as const,
        reason: "comparisonBaseline.statement summarizes competitor/market complaints with an unverified disclaimer and empty citations.",
        rejectedFields: ["comparisonBaseline.statement"],
        fixDirective: "Cite canonical customerEvidenceIds without competitor attribution or use neutral strategic emphasis.",
      },
    ];

    const repaired = finalizeComparisonBaselineOnlyDefect(
      candidateWithDisclaimerTrapAndSuperiority,
      baselineOnlyDefect,
      canonicalInput
    );

    expect(repaired).not.toBeNull();
    // Case J: Unrelated accepted fields (differentiationId, distinctiveProperty, productTruthFactIds, proofBoundary) are preserved intact
    expect(repaired!.differentiationId).toBe("cand_jk");
    expect(repaired!.distinctiveProperty).toBe(candidateWithDisclaimerTrapAndSuperiority.distinctiveProperty);
    expect(repaired!.productTruthFactIds).toEqual(["fact_cap_0", "fact_cap_1", "fact_cap_3"]);
    expect(repaired!.proofBoundary).toBe(candidateWithDisclaimerTrapAndSuperiority.proofBoundary);
    expect(repaired!.comparisonBaseline.customerEvidenceIds).toEqual(["cev_mar_76f74860f039611d"]);
    expect(repaired!.comparisonBaseline.evidenceBasisType).toBe("UNATTRIBUTED_MARKET_VOICE");
    expect(repaired!.targetedBaselineRepairAudit?.resolutionMode).toBe("NARROWED_UNATTRIBUTED_CONCERN");

    // Case K: Dependent comparative superiority clauses ("Unlike competitors who...") were stripped when moving to non-competitor baseline
    expect(repaired!.differentiationClaim).not.toMatch(/unlike competitors/i);
    expect(repaired!.buyerValue).not.toMatch(/unlike competitors/i);
    expect(repaired!.differentiationClaim).toContain("Our 400g assortment is handcrafted daily in Gaziantep");
  });

  it("Case L: Unchanged approved candidates remain accepted under the same evidence/context fingerprint without being re-judged or overturned", async () => {
    const pain1 = "pain_locked_1";
    const pain2 = "pain_new_2";

    // First run produces an approved candidate for pain1
    mockAiChat
      .mockResolvedValueOnce({
        choices: [
          {
            message: {
              content: JSON.stringify({
                differentiations: [
                  {
                    differentiationId: "cand_locked_1",
                    corePainIds: [pain1],
                    differentiationClaim:
                      "Handcrafted daily in Gaziantep with first-harvest Boz Antep pistachios and pure sheep-milk butter.",
                    distinctiveProperty: "First-Harvest Boz Pistachio & Sheep-Milk Butter Craft",
                    buyerValue: "Provides verified regional ingredient authenticity for gift buyers.",
                    productTruthFactIds: ["fact_cap_0", "fact_cap_1"],
                    comparisonBaseline: {
                      statement:
                        "Strategic market emphasis anchored on verified Gaziantep ingredients [fact_cap_0, fact_cap_1].",
                      miAuthorityIds: [],
                      customerEvidenceIds: [],
                      competitorIds: [],
                      evidenceBasisType: "STRATEGIC_MARKET_EMPHASIS",
                    },
                    proofBoundary: "Verified ingredient and production facts.",
                    strategicForm: "STRATEGIC_MARKET_EMPHASIS",
                  },
                ],
                painDispositions: [{ painId: pain1, disposition: "ACCEPTED_DIFFERENTIATION", differentiationId: "cand_locked_1" }],
              }),
            },
          },
        ],
      })
      .mockResolvedValueOnce(buildPassJudgeResponse("SYNTHETIC_MOCK_JUDGE: Approved cand_locked_1."));

    const run1 = await runDifferentiationEngine(
      { competitors: [], dominance: [] },
      {
        painRegistry: [{ painId: pain1, classification: "CORE_PURCHASE", canonical: "Ingredient authenticity" }],
        productTruthFacts: BAKLAWATI_15_FACTS,
      },
      {},
      {
        accountId: ACCOUNT_ID,
        campaignId: CAMPAIGN_ID,
        campaignOfferingId: OFFERING_ID,
        productTruthSnapshotId: SNAPSHOT_ID,
      }
    );

    expect(run1.status).toBe("SUCCESS");
    const approvedCand1 = run1.differentiations[0];
    expect(approvedCand1.approvalFingerprint).toMatch(/^diff_fp_/);
    expect(approvedCand1.evidenceDependencyIds).toEqual(["pt:fact_cap_0", "pt:fact_cap_1"]);

    // Second run under the same evidence snapshot supplies previouslyApprovedCandidates=[approvedCand1]
    mockAiChat.mockReset();
    mockAiChat.mockResolvedValueOnce({
      choices: [
        {
          message: {
            content: JSON.stringify({
              differentiations: [
                {
                  ...approvedCand1,
                },
              ],
              painDispositions: [{ painId: pain1, disposition: "ACCEPTED_DIFFERENTIATION", differentiationId: "cand_locked_1" }],
            }),
          },
        },
      ],
    });

    const run2 = await runDifferentiationEngine(
      { competitors: [], dominance: [] },
      {
        painRegistry: [{ painId: pain1, classification: "CORE_PURCHASE", canonical: "Ingredient authenticity" }],
        productTruthFacts: BAKLAWATI_15_FACTS,
      },
      {},
      {
        accountId: ACCOUNT_ID,
        campaignId: CAMPAIGN_ID,
        campaignOfferingId: OFFERING_ID,
        productTruthSnapshotId: SNAPSHOT_ID,
        previouslyApprovedCandidates: [approvedCand1],
      }
    );

    expect(run2.status).toBe("SUCCESS");
    expect(run2.differentiations).toHaveLength(1);
    expect(run2.differentiations[0].approvalFingerprint).toBe(approvedCand1.approvalFingerprint);
    // Judge LLM was NOT called again for the unchanged pre-approved candidate (only 1 Proposer call)
    expect(mockAiChat).toHaveBeenCalledTimes(1);
  });

  it("Case M: Genuine unresolved material claims remain rejected with failureCategory=SEMANTIC_REJECTION, distinct from MISSING_EVIDENCE_HANDOFF and TECHNICAL_EXECUTION_FAILURE", async () => {
    const painId = "pain_unresolved_material";

    // Round 1 Proposer invents an unsupported clinical health claim
    mockAiChat
      .mockResolvedValueOnce({
        choices: [
          {
            message: {
              content: JSON.stringify({
                differentiations: [
                  {
                    differentiationId: "cand_case_m",
                    corePainIds: [painId],
                    differentiationClaim:
                      "Clinically proven low-glycemic diabetic-safe baklava that guarantees zero blood sugar spike.",
                    distinctiveProperty: "Clinically Proven Zero-Glycemic Formula",
                    buyerValue: "Guarantees safe consumption for diabetic buyers.",
                    productTruthFactIds: ["fact_cap_3"],
                    comparisonBaseline: {
                      statement: "Strategic market emphasis on natural beet sugar [fact_cap_3].",
                      miAuthorityIds: [],
                      customerEvidenceIds: [],
                      competitorIds: [],
                      evidenceBasisType: "STRATEGIC_MARKET_EMPHASIS",
                    },
                    proofBoundary: "Natural beet sugar.",
                    strategicForm: "STRATEGIC_MARKET_EMPHASIS",
                  },
                ],
                painDispositions: [{ painId, disposition: "ACCEPTED_DIFFERENTIATION", differentiationId: "cand_case_m" }],
              }),
            },
          },
        ],
      })
      // Round 1 Judge rejects PRODUCT_TRUTH_UNSUPPORTED on differentiationClaim
      .mockResolvedValueOnce({
        choices: [
          {
            message: {
              content: JSON.stringify({
                valid: false,
                assessmentsCompleted: true,
                assessmentDetails: {
                  productFactualSupport: false,
                  competitiveFactualSupport: true,
                  audienceLaneRelevance: true,
                  commercialMeaningfulness: true,
                  strategicRoleValidity: true,
                  evidenceCompleteness: true,
                },
                defects: [
                  {
                    differentiationId: "cand_case_m",
                    code: "PRODUCT_TRUTH_UNSUPPORTED",
                    reason: "Clinical diabetic-safe and zero blood sugar spike guarantees are absent from ourProductFacts.",
                    rejectedFields: ["differentiationClaim", "distinctiveProperty", "buyerValue"],
                    fixDirective: "Remove clinical/diabetic guarantees or mark NO_SUPPORTED_DIFFERENTIATION.",
                  },
                ],
                overallVerdictRationale: "SYNTHETIC_MOCK_JUDGE: Materially unsupported medical claim.",
              }),
            },
          },
        ],
      })
      // Repair still retains the unsupported material guarantee
      .mockResolvedValueOnce({
        choices: [
          {
            message: {
              content: JSON.stringify({
                differentiations: [
                  {
                    differentiationId: "cand_case_m",
                    corePainIds: [painId],
                    differentiationClaim:
                      "Diabetic-friendly baklava that guarantees zero blood sugar spikes using beet sugar.",
                    distinctiveProperty: "Zero-Spike Beet Sugar Baklava",
                    buyerValue: "Guaranteed blood sugar safety.",
                    productTruthFactIds: ["fact_cap_3"],
                    comparisonBaseline: {
                      statement: "Strategic market emphasis on natural beet sugar [fact_cap_3].",
                      miAuthorityIds: [],
                      customerEvidenceIds: [],
                      competitorIds: [],
                      evidenceBasisType: "STRATEGIC_MARKET_EMPHASIS",
                    },
                    proofBoundary: "Natural beet sugar.",
                    strategicForm: "STRATEGIC_MARKET_EMPHASIS",
                  },
                ],
                painDispositions: [{ painId, disposition: "ACCEPTED_DIFFERENTIATION", differentiationId: "cand_case_m" }],
              }),
            },
          },
        ],
      })
      // Round 2 Judge rejects PRODUCT_TRUTH_UNSUPPORTED again
      .mockResolvedValueOnce({
        choices: [
          {
            message: {
              content: JSON.stringify({
                valid: false,
                assessmentsCompleted: true,
                assessmentDetails: {
                  productFactualSupport: false,
                  competitiveFactualSupport: true,
                  audienceLaneRelevance: true,
                  commercialMeaningfulness: true,
                  strategicRoleValidity: true,
                  evidenceCompleteness: true,
                },
                defects: [
                  {
                    differentiationId: "cand_case_m",
                    code: "PRODUCT_TRUTH_UNSUPPORTED",
                    reason: "Still claims diabetic blood-sugar guarantees not in ourProductFacts.",
                    rejectedFields: ["differentiationClaim", "buyerValue"],
                    fixDirective: "Reject candidate.",
                  },
                ],
                overallVerdictRationale: "SYNTHETIC_MOCK_JUDGE: Still unsupported in Round 2.",
              }),
            },
          },
        ],
      });

    const semanticRes = await runDifferentiationEngine(
      { competitors: [], dominance: [] },
      {
        painRegistry: [{ painId, classification: "CORE_PURCHASE", canonical: "Desire for diabetic-safe dessert" }],
        productTruthFacts: BAKLAWATI_15_FACTS,
      },
      {},
      {
        accountId: ACCOUNT_ID,
        campaignId: CAMPAIGN_ID,
        campaignOfferingId: OFFERING_ID,
        productTruthSnapshotId: SNAPSHOT_ID,
      }
    );

    expect(semanticRes.status).toBe("FAILED");
    expect(semanticRes.errorCode).toBe("NO_SUPPORTED_DIFFERENTIATION");
    expect(semanticRes.failureCategory).toBe("SEMANTIC_REJECTION");
    expect(semanticRes.differentiations).toHaveLength(0);
    expect(semanticRes.painDispositions[0].disposition).toBe("NO_SUPPORTED_DIFFERENTIATION");

    // Verify MISSING_EVIDENCE_HANDOFF is distinct when Product Truth is empty
    const handoffRes = await runDifferentiationEngine(
      { competitors: [], dominance: [] },
      {
        painRegistry: [{ painId, classification: "CORE_PURCHASE", canonical: "Some pain" }],
        productTruthFacts: [],
      },
      {}
    );
    expect(handoffRes.status).toBe("FAILED");
    expect(handoffRes.errorCode).toBe("PRODUCT_TRUTH_MISSING");
    expect(handoffRes.failureCategory).toBe("MISSING_EVIDENCE_HANDOFF");
  });

  it("Synthetic Incident Reproduction (orch_1792045601277_4sgp65) + Case N: Two-round Baklawati 400g incident recovers both candidates within the 4-call budget and passes orchestration authoritative-output checks", async () => {
    /**
     * Clearly labeled synthetic reproduction of incident run orch_1792045601277_4sgp65:
     * - Offering: Baklawati 400g (off_4e78386f-0)
     * - Canonical Product Truth: 15 facts, fingerprint pt_7703d7186724da80
     * - Candidate 1 (46dc2efa-6b4c-4126-b745-52c46f8555dd): Pain seg_b7f81ee40135451f_seg_1_pain_3_split_1 (EV-211, EV-212, EV-213)
     * - Candidate 2 (0d7a1bef-b6f1-4b75-b024-f1201c5c7c15): Pain seg_b7f81ee40135451f_seg_1_pain_4 (EV-201, EV-206 HTML-encoded duplicate)
     * - Note: Judge responses below are SYNTHETIC MOCKED JUDGE RESPONSES reproducing the exact Round 1 and Round 2 defect structure recorded in the incident.
     */
    const fp = computeProductTruthFingerprint({
      campaignOfferingId: OFFERING_ID,
      snapshotId: SNAPSHOT_ID,
      facts: BAKLAWATI_15_FACTS,
    });
    expect(fp).toMatch(/^pt_[0-9a-f]{16}$/);

    const pain1Id = "seg_b7f81ee40135451f_seg_1_pain_3_split_1";
    const pain2Id = "seg_b7f81ee40135451f_seg_1_pain_4";
    const cand1Id = "46dc2efa-6b4c-4126-b745-52c46f8555dd";
    const cand2Id = "0d7a1bef-b6f1-4b75-b024-f1201c5c7c15";

    const incidentCustomerVoice = [
      {
        evidenceId: "cev_mar_5c2dd352d6b1da7d",
        origin: "MARKET_VOICE",
        platform: "reddit",
        author: "just_a_femboii",
        url: "https://www.reddit.com/r/raresnacksTR/comments/1x0xs0f/güllüoğlu_antep_fıstıklı_baklava/",
        text: "Marketlerde gördüğüm plastik paketteki baklavayı denedim, fıstık yerine yeşil bezelye püresini kakalamışlar, şerbeti de genzi yakıyor.",
        rawEvidenceReference: { table: "market_voice_evidence", id: "mve_28771b8c411e90e4" },
        accountId: ACCOUNT_ID,
        campaignId: CAMPAIGN_ID,
        campaignOfferingId: OFFERING_ID,
      },
      {
        evidenceId: "cev_mar_77da6ae48f2a3b33",
        origin: "MARKET_VOICE",
        platform: "reddit",
        author: "kirchoff01",
        url: "https://www.reddit.com/r/raresnacksTR/comments/1x0xs0f/güllüoğlu_antep_fıstıklı_baklava/",
        text: "Ucuz paketli baklavalarda gerçek Antep fıstığı bulmak imkansız hale geldi, glikoz şurubu basıyorlar.",
        rawEvidenceReference: { table: "market_voice_evidence", id: "mve_1436592802119538" },
        accountId: ACCOUNT_ID,
        campaignId: CAMPAIGN_ID,
        campaignOfferingId: OFFERING_ID,
      },
      {
        evidenceId: "cev_mar_171aef9951efa022",
        origin: "MARKET_VOICE",
        platform: "reddit",
        author: "just_a_femboii",
        url: "https://www.reddit.com/r/raresnacksTR/comments/1x0xs0f/güllüoğlu_antep_fıstıklı_baklava/",
        text: "Kutusu güzel görünse de içindeki fıstık oranı çok düşük ve bayat çıkıyor.",
        rawEvidenceReference: { table: "market_voice_evidence", id: "mve_eb4cce14270b3f41" },
        accountId: ACCOUNT_ID,
        campaignId: CAMPAIGN_ID,
        campaignOfferingId: OFFERING_ID,
      },
      {
        evidenceId: "cev_mar_76f74860f039611d",
        origin: "MARKET_VOICE",
        platform: "reddit",
        author: "lamorie",
        url: "https://www.reddit.com/r/traderjoes/comments/1oswd6m/comment/npix1a4/",
        text: "It's a pretty box, and I'm a sucker for good packaging. The baklava itself was dry and flavorless.",
        rawEvidenceReference: { table: "market_voice_evidence", id: "mve_d7a1e9be44ccf3cc" },
        accountId: ACCOUNT_ID,
        campaignId: CAMPAIGN_ID,
        campaignOfferingId: OFFERING_ID,
      },
      {
        // HTML-entity-encoded duplicate (EV-206) of EV-201
        evidenceId: "cev_mar_57b9b7db413beaf2",
        origin: "MARKET_VOICE",
        platform: "reddit",
        author: "lamorie",
        url: "https://www.reddit.com/r/traderjoes/comments/1oswd6m/comment/npix1a4/",
        text: "It&#39;s a pretty box, and I&#39;m a sucker for good packaging. The baklava itself was dry and flavorless.",
        rawEvidenceReference: { table: "market_voice_evidence", id: "mve_4809edbc5feeb6e6" },
        accountId: ACCOUNT_ID,
        campaignId: CAMPAIGN_ID,
        campaignOfferingId: OFFERING_ID,
      },
    ];

    const painRegistry = [
      {
        painId: pain1Id,
        classification: "CORE_PURCHASE",
        canonical:
          "Skepticism toward boxed baklava quality due to counterfeit pistachio fillers and harsh glucose syrup",
        evidenceUids: ["EV-211", "EV-212", "EV-213"],
        productTruthFactIds: ["fact_cap_0", "fact_cap_1", "fact_cap_3", "fact_prf_0", "fact_prf_1"],
        materiality: {
          painId: pain1Id,
          backingRecordCount: 3,
          uniqueSourceCount: 1,
          uniqueAuthorCount: 2,
          uniquePlatformCount: 1,
          materialityScore: 0.82,
          gateStatus: "PASS",
          gateReasons: [],
          evidence: [
            {
              evidenceUid: "EV-211",
              canonicalEvidenceId: "ext:ev-211",
              sourceType: "market_voice",
              sourceIdentity: "reddit",
              author: "just_a_femboii",
              verbatimText: incidentCustomerVoice[0].text,
            },
            {
              evidenceUid: "EV-212",
              canonicalEvidenceId: "ext:ev-212",
              sourceType: "market_voice",
              sourceIdentity: "reddit",
              author: "kirchoff01",
              verbatimText: incidentCustomerVoice[1].text,
            },
            {
              evidenceUid: "EV-213",
              canonicalEvidenceId: "ext:ev-213",
              sourceType: "market_voice",
              sourceIdentity: "reddit",
              author: "just_a_femboii",
              verbatimText: incidentCustomerVoice[2].text,
            },
          ],
        },
      },
      {
        painId: pain2Id,
        classification: "CORE_PURCHASE",
        canonical:
          "Disappointment when attractive gift boxes contain dry, stale, or flavorless baklava",
        evidenceUids: ["EV-201", "EV-206"],
        productTruthFactIds: ["fact_cap_0", "fact_cap_2", "fact_del_0", "fact_diff_0", "fact_diff_1"],
        materiality: {
          painId: pain2Id,
          backingRecordCount: 2,
          uniqueSourceCount: 1,
          uniqueAuthorCount: 1,
          uniquePlatformCount: 1,
          materialityScore: 0.75,
          gateStatus: "PASS",
          gateReasons: [],
          evidence: [
            {
              evidenceUid: "EV-201",
              canonicalEvidenceId: "ext:ev-201",
              sourceType: "market_voice",
              sourceIdentity: "reddit",
              author: "lamorie",
              verbatimText: incidentCustomerVoice[3].text,
            },
            {
              evidenceUid: "EV-206",
              canonicalEvidenceId: "ext:ev-206",
              sourceType: "market_voice",
              sourceIdentity: "reddit",
              author: "lamorie",
              verbatimText: incidentCustomerVoice[4].text,
            },
          ],
        },
      },
    ];

    // Call 1: Proposer Round 1 (introduces sensory/freshness guarantees in differentiationClaim & buyerValue)
    mockAiChat.mockResolvedValueOnce({
      choices: [
        {
          message: {
            content: JSON.stringify({
              differentiations: [
                {
                  differentiationId: cand1Id,
                  corePainIds: [pain1Id],
                  differentiationClaim:
                    "Handcrafted in Gaziantep with first-harvest Boz Antep pistachios, pure clarified sheep-milk butter, and natural beet sugar syrup—guaranteeing superior flavor and zero throat-burning sweetness.",
                  distinctiveProperty: "First-Harvest Boz Antep Pistachio & Pure Clarified Butter Formulation",
                  buyerValue:
                    "Guarantees authentic Antep taste and eliminates artificial filler anxiety for discerning dessert buyers.",
                  productTruthFactIds: ["fact_cap_1", "fact_cap_3", "fact_prf_0", "fact_prf_1"],
                  comparisonBaseline: {
                    statement: "Strategic market emphasis on verified Gaziantep ingredients [fact_cap_1, fact_cap_3].",
                    miAuthorityIds: [],
                    customerEvidenceIds: [],
                    competitorIds: [],
                    evidenceBasisType: "STRATEGIC_MARKET_EMPHASIS",
                  },
                  proofBoundary: "Verified ingredient facts [fact_cap_1, fact_cap_3, fact_prf_0, fact_prf_1].",
                  strategicForm: "STRATEGIC_MARKET_EMPHASIS",
                },
                {
                  differentiationId: cand2Id,
                  corePainIds: [pain2Id],
                  differentiationClaim:
                    "Daily Gaziantep batch preparation and same-day sealed gift-box dispatch guarantee moistness and freshness on arrival.",
                  distinctiveProperty: "Daily Gaziantep Batch & Same-Day Dispatch",
                  buyerValue: "Guarantees every 400g gift box arrives moist, crisp, and never dry.",
                  productTruthFactIds: ["fact_cap_0", "fact_del_0", "fact_diff_1"],
                  comparisonBaseline: {
                    statement: "Strategic market emphasis on daily production and same-day dispatch [fact_cap_0, fact_del_0].",
                    miAuthorityIds: [],
                    customerEvidenceIds: [],
                    competitorIds: [],
                    evidenceBasisType: "STRATEGIC_MARKET_EMPHASIS",
                  },
                  proofBoundary: "Verified production and dispatch facts [fact_cap_0, fact_del_0, fact_diff_1].",
                  strategicForm: "STRATEGIC_MARKET_EMPHASIS",
                },
              ],
              painDispositions: [
                { painId: pain1Id, disposition: "ACCEPTED_DIFFERENTIATION", differentiationId: cand1Id },
                { painId: pain2Id, disposition: "ACCEPTED_DIFFERENTIATION", differentiationId: cand2Id },
              ],
            }),
          },
        },
      ],
    });

    // Call 2: SYNTHETIC MOCKED JUDGE ROUND 1 (reproducing Round 1 rejection of unsupported guarantees/sensory outcomes)
    mockAiChat.mockResolvedValueOnce({
      choices: [
        {
          message: {
            content: JSON.stringify({
              valid: false,
              assessmentsCompleted: true,
              assessmentDetails: {
                productFactualSupport: false,
                competitiveFactualSupport: true,
                audienceLaneRelevance: true,
                commercialMeaningfulness: true,
                strategicRoleValidity: true,
                evidenceCompleteness: true,
              },
              defects: [
                {
                  differentiationId: cand1Id,
                  code: "PRODUCT_TRUTH_UNSUPPORTED",
                  reason:
                    "SYNTHETIC_MOCK_JUDGE_R1: Candidate claims 'guaranteeing superior flavor and zero throat-burning sweetness', which overstates verified ingredient facts.",
                  rejectedFields: ["differentiationClaim", "buyerValue"],
                  fixDirective:
                    "Narrow differentiationClaim and buyerValue to verified Boz Antep pistachio, clarified sheep-milk butter, and natural beet sugar syrup facts without sensory guarantees.",
                },
                {
                  differentiationId: cand2Id,
                  code: "PRODUCT_TRUTH_UNSUPPORTED",
                  reason:
                    "SYNTHETIC_MOCK_JUDGE_R1: Candidate claims 'guarantee moistness and freshness on arrival', which is not established by daily production and same-day dispatch facts.",
                  rejectedFields: ["differentiationClaim", "buyerValue"],
                  fixDirective:
                    "Describe daily Gaziantep batch preparation and same-day sealed gift-box dispatch without guaranteeing arrival moisture.",
                },
              ],
              overallVerdictRationale:
                "SYNTHETIC_MOCK_JUDGE_R1: Both candidates overstate Product Truth with sensory/arrival guarantees.",
            }),
          },
        },
      ],
    });

    // Call 3: Repair Round (fixes differentiationClaim and buyerValue, but introduces the incident's customer-complaint summaries + "though specific competitor details are unverified" into comparisonBaseline.statement with empty miAuthorityIds)
    mockAiChat.mockResolvedValueOnce({
      choices: [
        {
          message: {
            content: JSON.stringify({
              differentiations: [
                {
                  differentiationId: cand1Id,
                  corePainIds: [pain1Id],
                  differentiationClaim:
                    "Handcrafted in Gaziantep using first-harvest Boz Antep pistachios, 100% pure clarified sheep-milk butter, and natural beet sugar syrup without glucose syrup or artificial sweeteners.",
                  distinctiveProperty: "First-Harvest Boz Antep Pistachio & Beet-Sugar Formulation",
                  buyerValue:
                    "Gives buyers clear ingredient provenance—real Gaziantep pistachios, clarified sheep-milk butter, and beet sugar syrup—when choosing a 400g assorted box.",
                  productTruthFactIds: ["fact_cap_1", "fact_cap_3", "fact_prf_0", "fact_prf_1"],
                  comparisonBaseline: {
                    statement:
                      "Customer discussions highlight frustration with packaged baklava using pea puree fillers and harsh glucose syrup, though specific competitor details are unverified.",
                    miAuthorityIds: [],
                    customerEvidenceIds: [],
                    competitorIds: [],
                    evidenceBasisType: "STRATEGIC_MARKET_EMPHASIS",
                  },
                  proofBoundary:
                    "Establishes verified ingredient composition and Gaziantep origin [fact_cap_1, fact_cap_3, fact_prf_0, fact_prf_1]; does not claim independent lab testing of third-party brands.",
                  strategicForm: "STRATEGIC_MARKET_EMPHASIS",
                },
                {
                  differentiationId: cand2Id,
                  corePainIds: [pain2Id],
                  differentiationClaim:
                    "Prepared in daily fresh batches by master artisans in Gaziantep and dispatched same-day in protective sealed 400g gift packaging combining baklava and kadayif varieties.",
                  distinctiveProperty: "Daily Gaziantep Batch Preparation & Same-Day Origin Dispatch",
                  buyerValue:
                    "Supports gift and household buyers seeking authentic Gaziantep baklava and kadayif prepared daily and shipped directly from the production facility.",
                  productTruthFactIds: ["fact_cap_0", "fact_cap_2", "fact_del_0", "fact_diff_0", "fact_diff_1"],
                  comparisonBaseline: {
                    statement:
                      "Buyers report disappointment with attractive gift boxes containing dry, flavorless baklava, though specific competitor practices are not verified.",
                    miAuthorityIds: [],
                    customerEvidenceIds: [],
                    competitorIds: [],
                    evidenceBasisType: "STRATEGIC_MARKET_EMPHASIS",
                  },
                  proofBoundary:
                    "Establishes daily Gaziantep batch preparation and same-day sealed dispatch [fact_cap_0, fact_del_0, fact_diff_1]; does not guarantee transit conditions.",
                  strategicForm: "STRATEGIC_MARKET_EMPHASIS",
                },
              ],
              painDispositions: [
                { painId: pain1Id, disposition: "ACCEPTED_DIFFERENTIATION", differentiationId: cand1Id },
                { painId: pain2Id, disposition: "ACCEPTED_DIFFERENTIATION", differentiationId: cand2Id },
              ],
            }),
          },
        },
      ],
    });

    // Call 4: SYNTHETIC MOCKED JUDGE ROUND 2 (reproducing the exact Round 2 state where productFactualSupport=true, audienceLaneRelevance=true, commercialMeaningfulness=true, strategicRoleValidity=true, and comparisonBaseline.statement is the ONLY rejected field for both candidates)
    mockAiChat.mockResolvedValueOnce({
      choices: [
        {
          message: {
            content: JSON.stringify({
              valid: false,
              assessmentsCompleted: true,
              assessmentDetails: {
                productFactualSupport: true,
                competitiveFactualSupport: false,
                audienceLaneRelevance: true,
                commercialMeaningfulness: true,
                strategicRoleValidity: true,
                evidenceCompleteness: false,
              },
              defects: [
                {
                  differentiationId: cand1Id,
                  code: "COMPETITIVE_SCOPE_OVERCLAIM",
                  reason:
                    "SYNTHETIC_MOCK_JUDGE_R2: comparisonBaseline.statement summarizes competitor/market complaints with 'though specific competitor details are unverified' while miAuthorityIds is empty.",
                  unsupportedStatement:
                    "Customer discussions highlight frustration with packaged baklava using pea puree fillers and harsh glucose syrup, though specific competitor details are unverified.",
                  rejectedFields: ["comparisonBaseline.statement"],
                  fixDirective:
                    "Attach canonical customerEvidenceIds or rewrite comparisonBaseline.statement as neutral STRATEGIC_MARKET_EMPHASIS.",
                },
                {
                  differentiationId: cand2Id,
                  code: "COMPETITIVE_SCOPE_OVERCLAIM",
                  reason:
                    "SYNTHETIC_MOCK_JUDGE_R2: comparisonBaseline.statement summarizes market complaints with 'though specific competitor practices are not verified' while miAuthorityIds is empty.",
                  unsupportedStatement:
                    "Buyers report disappointment with attractive gift boxes containing dry, flavorless baklava, though specific competitor practices are not verified.",
                  rejectedFields: ["comparisonBaseline.statement"],
                  fixDirective:
                    "Attach canonical customerEvidenceIds or rewrite comparisonBaseline.statement as neutral STRATEGIC_MARKET_EMPHASIS.",
                },
              ],
              overallVerdictRationale:
                "SYNTHETIC_MOCK_JUDGE_R2: Product factual support and buyer value are now grounded, but comparisonBaseline.statement remains rejected for both candidates.",
            }),
          },
        },
      ],
    });

    const incidentResult = await runDifferentiationEngine(
      { competitors: [], dominance: [] },
      {
        painRegistry,
        productTruthFacts: BAKLAWATI_15_FACTS,
        customerEvidence: incidentCustomerVoice,
      },
      {},
      {
        accountId: ACCOUNT_ID,
        campaignId: CAMPAIGN_ID,
        jobId: JOB_ID,
        audienceSnapshotId: "aud_snap_incident",
        miSnapshotId: "mi_snap_incident",
        campaignOfferingId: OFFERING_ID,
        productTruthSnapshotId: SNAPSHOT_ID,
        productTruthFingerprint: fp,
        customerEvidence: incidentCustomerVoice,
        evidenceManifest: {
          includedMarketVoiceIds: [
            "mve_28771b8c411e90e4",
            "mve_1436592802119538",
            "mve_eb4cce14270b3f41",
            "mve_d7a1e9be44ccf3cc",
            "mve_4809edbc5feeb6e6",
          ],
        },
      }
    );

    // Verify both candidates were recovered via targeted field-level repair without exceeding the 4-call LLM budget
    expect(mockAiChat).toHaveBeenCalledTimes(4);
    expect(incidentResult.status).toBe("SUCCESS");
    expect(incidentResult.differentiations).toHaveLength(2);
    expect(incidentResult.productTruthFingerprint).toBe(fp);
    expect(incidentResult.evidenceManifestFingerprint).toMatch(/^em_/);

    const rec1 = incidentResult.differentiations.find((d) => d.differentiationId === cand1Id)!;
    const rec2 = incidentResult.differentiations.find((d) => d.differentiationId === cand2Id)!;
    expect(rec1).toBeDefined();
    expect(rec2).toBeDefined();

    // Candidate 1 cites the 3 canonical customerEvidenceIds from the Reddit thread, preserves allegation & variant scope framing, and removes the disclaimer trap
    expect(rec1.comparisonBaseline.customerEvidenceIds).toEqual([
      "cev_mar_5c2dd352d6b1da7d",
      "cev_mar_77da6ae48f2a3b33",
      "cev_mar_171aef9951efa022",
    ]);
    expect(rec1.comparisonBaseline.statement).toContain("supermarket plastic-packaged baklava variant");
    expect(rec1.comparisonBaseline.statement).toContain("allegations");
    expect(rec1.comparisonBaseline.statement).not.toMatch(/specific competitor details are unverified/i);
    expect(rec1.targetedBaselineRepairAudit?.verifiedDeterministically).toBe(true);

    // Candidate 2 deduplicated EV-201 & EV-206 (HTML entity &#39; vs ') into a single canonical customerEvidenceId
    expect(rec2.comparisonBaseline.customerEvidenceIds).toEqual(["cev_mar_76f74860f039611d"]);
    expect(rec2.comparisonBaseline.statement).not.toMatch(/specific competitor practices are not verified/i);
    expect(rec2.targetedBaselineRepairAudit?.verifiedDeterministically).toBe(true);

    // Case N: Verify repaired production Differentiation output passes orchestration's authoritative-output checks and reaches the next stage
    const stepResult = {
      engineId: "differentiation" as const,
      status: incidentResult.status as "SUCCESS",
      output: incidentResult,
      durationMs: incidentResult.executionTimeMs,
    };
    expect(shouldBlockDownstream(stepResult)).toBe(false);
    const diffCountForPositioningAndMechanism =
      (incidentResult.differentiations?.length ?? 0) || (incidentResult.pillars?.length ?? 0);
    expect(diffCountForPositioningAndMechanism).toBe(2);
    expect(incidentResult.pillars).toHaveLength(2);
    expect(incidentResult.claimStructures).toHaveLength(2);
    expect(incidentResult.proofArchitecture?.length).toBeGreaterThan(0);
    expect(incidentResult.painDispositions.every((pd) => pd.disposition === "ACCEPTED_DIFFERENTIATION")).toBe(true);

    // Assert zero outbound network calls and zero shared-storage mutations
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(dbMutationGuard).not.toHaveBeenCalled();
  });
});
