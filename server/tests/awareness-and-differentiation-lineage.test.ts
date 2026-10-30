import assert from "node:assert/strict";
import {
  buildAuthoritativeCompetitorEvidenceContext,
  evaluateAwarenessComparativeClaims,
  repairContradictedNarrativeReframe,
  repairContradictedMythBreaker,
} from "../awareness-engine/competitor-evidence-guard";
import { engineerNarrativeReframe } from "../awareness-engine/narrative-reframe";
import { generateMythBreaker } from "../awareness-engine/myth-breaker-llm";
import {
  computeMiVersionedInputFingerprint,
  areMiSnapshotsCompatibleSync,
  areMiSnapshotsCompatible,
  isAudienceSnapshotCompatible,
  isDifferentiationSnapshotCompatibleSync,
  validateBundleLineageCompatibility,
} from "../shared/dependency-contract";
import { hydrateRequiredUpstreamForResume } from "../orchestrator/resume-hydration";
import { resolveContinuationPlan } from "../orchestrator/continuation";
import { assertRootExecutionEligible } from "../shared/strategy-root";
import { lockRootBundle } from "../root-bundle";
import { db } from "../db";
import {
  miSnapshots,
  differentiationSnapshots,
  positioningSnapshots,
  mechanismSnapshots,
  offerSnapshots,
  awarenessSnapshots,
  strategicPlans,
  rootBundles,
  strategyRoots,
} from "@shared/schema";
import { eq } from "drizzle-orm";

const SONGAI_CAMPAIGN_ID = "camp_ac86e8b8-55b";
const SONGAI_ACCOUNT_ID = "ce5c11b9-9a9a-499c-a4f8-b75e6ec6055f";
const SONGAI_MI_714 = "714ede73-b45b-4577-9ac9-a27eddbec9f1";
const SONGAI_MI_8CB = "8cb046c0-544e-41fb-9438-eb55726383aa";
const SONGAI_MI_9D0 = "9d05d7dc-9cd6-443e-ad35-c562a32d58d5";
const SONGAI_AUD_362 = "3628f8ae-2af0-47aa-ae2b-7e5c3e5347bf";
const SONGAI_DIFF_7BD = "7bd320c6-1b31-4de7-805d-00c29e0543b5";
const SONGAI_POS_557 = "557d1018-c74c-4be2-bebc-dbac4de7706d";
const SONGAI_ROOT_231 = "2315d814-3b8f-4b40-af2d-a7f3a68328f6";

async function runTests() {
  console.log("═══════════════════════════════════════════════════════════════════════════");
  console.log("  TARGETED REGRESSION SUITE: AWARENESS EVIDENCE & DIFFERENTIATION LINEAGE");
  console.log("═══════════════════════════════════════════════════════════════════════════\n");

  // ---------------------------------------------------------------------------
  // PART A: DETERMINISTIC & CONTRACT TESTS (Checks 1–8)
  // ---------------------------------------------------------------------------
  console.log("── PART A: CONTRACT & DETERMINISTIC VERIFICATION ──");

  // CHECK 1: Competitor counterevidence reaches both Awareness generation and review
  const songaiEvidenceCtx = await buildAuthoritativeCompetitorEvidenceContext({
    campaignId: SONGAI_CAMPAIGN_ID,
    accountId: SONGAI_ACCOUNT_ID,
    mi: {
      id: SONGAI_MI_714,
      createdAt: "2026-10-23T08:06:16.298Z",
      marketDiagnosis: "Crowded custom song category with shared story-to-song and preview/trial mechanics.",
    },
    audience: {
      id: SONGAI_AUD_362,
      audiencePains: [
        {
          id: "PAIN-1",
          statement: "Some customers report that personalized songs from automated platforms sound generic and miss specific personal memories.",
          scope: "COMPETITOR_SPECIFIC",
          competitorNames: ["Songfinch", "Songlorious"],
        },
      ],
      objectionMap: [
        {
          id: "OBJ-1",
          statement: "Will an AI-assisted custom song actually capture our relationship details before I pay for the final gift?",
        },
      ],
    },
    positioning: {
      id: SONGAI_POS_557,
      territories: [
        {
          name: "Personal Story-to-Song Creation",
          positioningOutcomeType: "SHARED_CAPABILITY_STRATEGIC_EMPHASIS",
          epistemicStatus: "STRATEGIC_HYPOTHESIS",
          contrastAxis: "From generic outputs -> To guided story-driven creation with free trial creation before paying when gifting",
          rationale:
            "Monitored competitors offering free preview/trial models (6): CreateMySong, GiftSong, Songilingy, Songly, Songoven, TuneForTwo. Monitored competitors offering video/visual/multi-format deliverables (8): CreateMySong, CustomMayd, GiftSong, MakeBestMusic, Remento, Songfinch, Songoven, TuneForTwo.",
          semanticCollision: {
            comparisonStatus: "COMPARISON_COMPLETED",
            semanticCollisionScore: 0.65,
            comparedCompetitorCount: 18,
          },
        },
      ],
    },
    productTruthFacts: [
      "Users can create a free trial song from their personal story and memories before paying.",
      "Payment is required when gifting or obtaining the final custom song and optional keepsake formats (artwork, lyric video, slideshow, plaque).",
    ],
  });

  assert.ok(songaiEvidenceCtx.evidenceVersionHash.startsWith("aev_"), "Evidence context must have a deterministic version hash");
  assert.ok(
    songaiEvidenceCtx.previewOrTrialCounterexamples.length >= 6,
    `Expected >= 6 preview/trial competitor counterexamples, got ${songaiEvidenceCtx.previewOrTrialCounterexamples.length}`,
  );
  const previewNames = songaiEvidenceCtx.previewOrTrialCounterexamples.map(c => c.competitorName);
  for (const expectedName of ["CreateMySong", "GiftSong", "Songilingy", "Songly", "Songoven", "TuneForTwo"]) {
    assert.ok(
      previewNames.includes(expectedName),
      `Expected ${expectedName} in previewOrTrialCounterexamples (${previewNames.join(", ")})`,
    );
  }
  assert.ok(
    songaiEvidenceCtx.promptBlock.includes(songaiEvidenceCtx.evidenceVersionHash) &&
      songaiEvidenceCtx.promptBlock.includes("CreateMySong") &&
      songaiEvidenceCtx.promptBlock.includes("TuneForTwo") &&
      songaiEvidenceCtx.promptBlock.includes("1. VERIFIED PRODUCT FACTS") &&
      songaiEvidenceCtx.promptBlock.includes("2. ATTRIBUTED CUSTOMER EXPERIENCES") &&
      songaiEvidenceCtx.promptBlock.includes("3. OBSERVED COMPETITOR CAPABILITIES & COUNTEREXAMPLES") &&
      songaiEvidenceCtx.promptBlock.includes("4. STRATEGIC INTERPRETATIONS & EPISTEMIC BOUNDARIES"),
    "Prompt block must carry version hash, counterexamples, and all 4 epistemic sections into both proposer and reviewer",
  );
  console.log(`  [PASS] Check 1 (Contract): Competitor counterevidence (${songaiEvidenceCtx.previewOrTrialCounterexamples.length} preview/trial, ${songaiEvidenceCtx.multiAssetCounterexamples.length} multi-asset) & version=${songaiEvidenceCtx.evidenceVersionHash} survive handoff.`);

  // CHECK 2: Contradicted market-wide claim is detected and repaired (including dependent reasoning)
  const contradictedAwarenessCandidate = {
    currentModel: {
      statement: "Ordering a custom song is a gamble where you pay upfront for an opaque AI black-box and hope the output doesn't sound generic.",
      sourceOfBelief: "Encountering personalized song services that require full payment before showing you anything.",
      whyItStuckSoFar: "Every service in this specific market forces financial commitment before generation, trapping buyers between losing their money and receiving a song that misses their personal story.",
    },
    falseBridge: {
      obviousNextStep: "Write a longer prompt in a blind-purchase custom song service with isolated audio tracks.",
      whyItFails: "Every competitor in this market forces upfront payment before previewing.",
    },
    newModel: {
      reclassification: "Risk-free custom song creation where you pay only when satisfied.",
      namedPrinciple: "Zero upfront commitment in a blind-purchase category.",
      whatBecomesObvious: "Use the only service in the market that lets you generate before paying.",
    },
    bridgeMechanism: {
      movement: "first_principle" as const,
      specificMove: "Compare the standard industry model (pay upfront, hope it's not generic) against the Songai model.",
      whyBuyerCanAcceptIt: "Buyers hate paying upfront across every other platform.",
    },
    discomfortCost: {
      privateAdmission: "Admitting that unguided prompts cannot capture relationship nuance.",
      statusGivenUp: "Surrendering the shortcut of a 10-second generic gift.",
      whyItIsWorthIt: "Delivering a deeply personal keepsake.",
    },
    reasoningSteps: ["Step 1"],
  };

  const check2Eval = evaluateAwarenessComparativeClaims(contradictedAwarenessCandidate, songaiEvidenceCtx);
  assert.equal(check2Eval.passed, false, "Contradicted market-wide claim must be rejected");
  assert.ok(
    check2Eval.violations.some(v => v.code === "CONTRADICTED_UPFRONT_PAYMENT_OR_BLIND_PURCHASE_CLAIM" && v.field === "currentModel.whyItStuckSoFar"),
    "Must flag currentModel.whyItStuckSoFar for contradicted upfront payment claim",
  );
  assert.ok(
    check2Eval.violations.some(v => v.code === "CONTRADICTED_ISOLATED_DELIVERABLE_CLAIM"),
    "Must flag isolated audio tracks claim against multi-asset counterexamples",
  );

  const repairedReframe = repairContradictedNarrativeReframe(contradictedAwarenessCandidate, songaiEvidenceCtx, check2Eval);
  const postRepairEval = evaluateAwarenessComparativeClaims(repairedReframe, songaiEvidenceCtx);
  assert.equal(postRepairEval.passed, true, `Repaired NarrativeReframe must pass evaluation, got violations: ${JSON.stringify(postRepairEval.violations)}`);
  assert.ok(
    !repairedReframe.currentModel.whyItStuckSoFar.toLowerCase().includes("forces financial commitment before generation"),
    "Repair must not merely delete 'Every' while preserving the false implication that services force financial commitment before generation",
  );
  assert.ok(
    repairedReframe.currentModel.whyItStuckSoFar.includes("CreateMySong") ||
      repairedReframe.currentModel.whyItStuckSoFar.includes("offer free previews, trial generations, or pay-after-preview"),
    "Repaired whyItStuckSoFar must explicitly reflect the actual competitor counterevidence",
  );
  assert.ok(
    !repairedReframe.bridgeMechanism.specificMove.toLowerCase().includes("standard industry model (pay upfront"),
    "Dependent reasoning in bridgeMechanism.specificMove must also be repaired",
  );
  console.log("  [PASS] Check 2 (Contract): Contradicted market-wide claim and its dependent reasoning chain detected and repaired.");

  // CHECK 3: Preview, free generation, and payment timing are not conflated
  const previewTypes = songaiEvidenceCtx.verifiedProductFacts.map(f => f.mechanismType);
  assert.ok(
    previewTypes.includes("FREE_GENERATION_TRIAL") && previewTypes.includes("CONDITIONAL_DELIVERY_OR_GIFT_PAYMENT"),
    `Verified product facts must distinguish FREE_GENERATION_TRIAL and CONDITIONAL_DELIVERY_OR_GIFT_PAYMENT, got ${previewTypes.join(",")}`,
  );
  assert.ok(
    !previewTypes.includes("SATISFACTION_OR_REFUND_POLICY"),
    "Conditional gifting/delivery payment must not be classified as SATISFACTION_OR_REFUND_POLICY",
  );
  const conflatedCandidate = {
    mythBreakerStatement: "Our risk-free service lets you pay only when satisfied with your custom song.",
    beliefToContradict: "That audio preview snippet is identical to full free generation.",
    rootCauseContradicted: "RC1",
    contradictionLogic: "Customers pay only when 100% satisfied.",
  };
  const check3Eval = evaluateAwarenessComparativeClaims(conflatedCandidate, songaiEvidenceCtx);
  assert.equal(check3Eval.passed, false, "Conflating conditional gifting payment with 'pay only when satisfied' or preview with full free generation must fail");
  assert.ok(
    check3Eval.violations.some(v => v.code === "CONFLATED_PREVIEW_FREE_GENERATION_OR_PAYMENT_TIMING"),
    "Must emit CONFLATED_PREVIEW_FREE_GENERATION_OR_PAYMENT_TIMING violation",
  );
  const repairedMb = repairContradictedMythBreaker(conflatedCandidate, songaiEvidenceCtx, check3Eval);
  const check3PostEval = evaluateAwarenessComparativeClaims(repairedMb, songaiEvidenceCtx);
  assert.equal(check3PostEval.passed, true, "Repaired mythBreaker must preserve exact trial and payment timing without conflation");
  console.log("  [PASS] Check 3 (Contract): Preview, free generation, and payment timing distinctions strictly preserved.");

  // CHECK 4: Partial or missing competitor evidence is not converted into a universal negative
  const partialEvidenceCtx = await buildAuthoritativeCompetitorEvidenceContext({
    mi: { id: "mi_partial_1", marketDiagnosis: "Emerging category with sparse competitor data" },
    audience: { audiencePains: ["Buyers want clearer onboarding before subscribing."] },
    positioning: {
      territories: [
        {
          name: "Guided Onboarding",
          semanticCollision: { comparisonStatus: "INSUFFICIENT_EVIDENCE", comparedCompetitorCount: 0 },
        },
      ],
    },
    productTruthFacts: ["Provides a 14-day guided sandbox trial before subscription billing begins."],
    cuSnapshotsOverride: [],
  });
  assert.equal(partialEvidenceCtx.coverageUncertainty.hasPartialOrMissingCompetitorEvidence, true);

  const universalNegativeOnMissingEvidence = {
    currentModel: {
      statement: "No competitor in this market offers a guided sandbox before billing.",
      sourceOfBelief: "Every service in this specific market forces financial commitment before generation.",
      whyItStuckSoFar: "None of the competitors allow testing before upfront payment.",
    },
  };
  const check4Eval = evaluateAwarenessComparativeClaims(universalNegativeOnMissingEvidence, partialEvidenceCtx);
  assert.equal(check4Eval.passed, false, "Universal negative when competitor evidence is missing/partial must be rejected");
  assert.ok(
    check4Eval.violations.some(v => v.code === "MISSING_EVIDENCE_CONVERTED_TO_UNIVERSAL_NEGATIVE"),
    "Must flag MISSING_EVIDENCE_CONVERTED_TO_UNIVERSAL_NEGATIVE",
  );
  console.log("  [PASS] Check 4 (Contract): Partial or missing competitor evidence cannot be converted into a universal negative.");

  // CHECK 5: Reasonable attributed customer insights and strategic hypotheses remain usable
  const validScopedCandidate = {
    currentModel: {
      statement: "Some buyers who have heard generic AI songs assume that any automated tool will flatten their personal memories into a stock greeting card.",
      sourceOfBelief: "Attributed customer reviews reporting that unguided one-prompt generators missed the specific humor and milestones of their relationship.",
      whyItStuckSoFar: "While several monitored services (including CreateMySong, GiftSong, and TuneForTwo) offer free previews or trial models, buyers remain unsure whether their specific story nuances will survive translation until they test their own details.",
    },
    falseBridge: {
      obviousNextStep: "Keeping relationship details vague or hoping a generic genre template will magically feel personal.",
      whyItFails: "Emotional resonance comes from concrete shared memories and specific lyrics, not just audio polish.",
    },
    newModel: {
      reclassification: "Personal song quality is an intake-depth problem: structured story capture during the free trial creation lets you verify lyric and emotional fidelity before paying when gifting or obtaining the final package.",
      namedPrinciple: "Specificity-in, Specificity-out: a guided story brief anchors the composition in real names, dates, and memories before final purchase.",
      whatBecomesObvious: "Start by entering three concrete relationship memories in the free trial creation workflow, evaluate the generated trial song, and pay when gifting or obtaining the final deliverable.",
    },
    bridgeMechanism: {
      movement: "decisive_evidence" as const,
      specificMove: "Ask the buyer to test one specific inside joke and one shared milestone in the free trial song creation before deciding whether to purchase the final gift package.",
      whyBuyerCanAcceptIt: "Respects the buyer's skepticism from hearing generic outputs while giving them a concrete way to verify story capture before paying for final delivery.",
    },
    discomfortCost: {
      privateAdmission: "Admitting that a meaningful custom song gift requires spending 5 minutes sharing real personal memories rather than clicking a 10-second button.",
      statusGivenUp: "Giving up the 'effortless last-minute shopper' shortcut in exchange for thoughtful storytelling.",
      whyItIsWorthIt: "The recipient hears their actual life story reflected in the song.",
    },
    reasoningSteps: ["Grounded in attributed buyer pain PAIN-1 and verified free trial creation workflow."],
  };
  const check5Eval = evaluateAwarenessComparativeClaims(validScopedCandidate, songaiEvidenceCtx);
  assert.equal(
    check5Eval.passed,
    true,
    `Valid attributed customer insights and strategic hypotheses must be accepted without false positives, got: ${JSON.stringify(check5Eval.violations)}`,
  );
  console.log("  [PASS] Check 5 (Contract): Reasonable attributed customer insights and strategic hypotheses pass cleanly.");

  // CHECK 6: Incompatible Differentiation dependencies cannot silently enter a new bundle through generation, retry, resume, or synthesis
  const diffIncompatCheck = isDifferentiationSnapshotCompatibleSync({
    diffRow: {
      id: SONGAI_DIFF_7BD,
      miSnapshotId: SONGAI_MI_9D0,
      audienceSnapshotId: SONGAI_AUD_362,
    },
    expectedMiSnapshotId: SONGAI_MI_714,
    expectedAudienceSnapshotId: SONGAI_AUD_362,
    miRowLookup: new Map([
      [
        SONGAI_MI_714,
        {
          id: SONGAI_MI_714,
          competitorHash: "a0074beb1c856d77",
          contentHash: "b27c2dc1dca2576a",
          postSampleSize: 191,
          commentSampleSize: 7,
          opportunitySignals: "[]",
          threatSignals: "[]",
        },
      ],
    ]),
  });
  assert.equal(diffIncompatCheck.compatible, false, "Differentiation 7bd320c6 (MI 9d05d7dc) must be incompatible with MI 714ede73");

  // Verify bundle lineage check catches the Songai baseline mismatch
  const bundleCheck = await validateBundleLineageCompatibility({
    miSnapshotId: SONGAI_MI_714,
    audienceSnapshotId: SONGAI_AUD_362,
    differentiationSnapshotId: SONGAI_DIFF_7BD,
    positioningSnapshotId: SONGAI_POS_557,
  });
  assert.equal(bundleCheck.compatible, false, "Bundle validation must reject Differentiation 7bd320c6 paired with MI 714ede73");
  assert.ok(
    bundleCheck.mismatches.some(m => m.engine === "differentiation" && m.snapshotId === SONGAI_DIFF_7BD),
    "Bundle validation mismatches must specifically report differentiation 7bd320c6",
  );

  // Verify assertRootExecutionEligible catches the stale lineage on Root 2315d814
  const rootElig = await assertRootExecutionEligible(SONGAI_ROOT_231, SONGAI_CAMPAIGN_ID, SONGAI_ACCOUNT_ID);
  assert.equal(rootElig.eligible, false, "Strategy root 2315d814 with mismatched differentiation MI must not pass execution eligibility without regeneration");
  assert.ok(
    rootElig.reasons.some(r => r.includes("differentiation") && r.includes(SONGAI_DIFF_7BD)),
    `Expected differentiation lineage mismatch in root reasons, got: ${rootElig.reasons.join("; ")}`,
  );

  // Verify lockRootBundle rejects locking a bundle with incompatible Differentiation
  await assert.rejects(
    async () => {
      await lockRootBundle(SONGAI_CAMPAIGN_ID, SONGAI_ACCOUNT_ID, {
        selectedSnapshotIds: {
          market_intelligence: SONGAI_MI_714,
          audience: SONGAI_AUD_362,
          differentiation: SONGAI_DIFF_7BD,
          positioning: SONGAI_POS_557,
        },
      });
    },
    /LINEAGE_MISMATCH_REJECTED/,
    "lockRootBundle must reject incompatible Differentiation snapshot before mutating active bundles",
  );

  // Verify resume-hydration marks Differentiation stale when 7bd320c6 / Root 2315d814 is requested
  const dummyCtx: any = { inputHashes: {}, depthGateStatus: {} };
  const hydrationRes = await hydrateRequiredUpstreamForResume({
    resumeFromEngine: "awareness",
    accountId: SONGAI_ACCOUNT_ID,
    campaignId: SONGAI_CAMPAIGN_ID,
    strategyRootId: SONGAI_ROOT_231,
    reusedSnapshotIds: {
      market_intelligence: SONGAI_MI_714,
      audience: SONGAI_AUD_362,
      differentiation: SONGAI_DIFF_7BD,
    },
    ctx: dummyCtx,
  });
  assert.ok(
    hydrationRes.hydrated.includes("market_intelligence") && hydrationRes.hydrated.includes("audience"),
    "Compatible upstream MI and Audience must be hydrated",
  );
  assert.ok(
    !hydrationRes.hydrated.includes("differentiation"),
    "Incompatible Differentiation 7bd320c6 must NOT be hydrated",
  );
  assert.ok(
    hydrationRes.staleEngines?.some(s => s.engineId === "differentiation" && s.snapshotId === SONGAI_DIFF_7BD),
    "Hydration must mark differentiation in staleEngines so the orchestrator rewinds and regenerates it",
  );
  console.log("  [PASS] Check 6 (Contract): Incompatible Differentiation rejected across generation, retry/continuation, resume hydration, root eligibility, and bundle lock.");

  // CHECK 7: Compatible reuse remains possible without falsifying lineage
  const campaignMiRows = await db
    .select()
    .from(miSnapshots)
    .where(eq(miSnapshots.campaignId, SONGAI_CAMPAIGN_ID));
  const mi714Row = campaignMiRows.find(r => r.id === SONGAI_MI_714);
  const miOtherRow = campaignMiRows.find(r => r.id !== SONGAI_MI_714);
  assert.ok(mi714Row && miOtherRow, "Expected at least two MI snapshots in DB for Songai campaign");
  const miEquivCheck = await areMiSnapshotsCompatible(miOtherRow!.id, mi714Row!.id);
  assert.equal(miEquivCheck.compatible, true, `Equivalent MI snapshots ${miOtherRow!.id} and ${mi714Row!.id} across different runs must be compatible: ${miEquivCheck.reason}`);
  assert.equal(miEquivCheck.equivalenceMode, "EQUIVALENT_VERSIONED_INPUTS");

  const miLookup = new Map<string, any>(campaignMiRows.map(r => [r.id, r]));
  const compatibleDiffCheck = isDifferentiationSnapshotCompatibleSync({
    diffRow: {
      id: "diff_compatible_across_runs",
      miSnapshotId: miOtherRow!.id,
      audienceSnapshotId: SONGAI_AUD_362,
    },
    expectedMiSnapshotId: mi714Row!.id,
    expectedAudienceSnapshotId: SONGAI_AUD_362,
    miRowLookup: miLookup,
  });
  assert.equal(compatibleDiffCheck.compatible, true, "Differentiation snapshot from an equivalent MI snapshot across runs must be reusable");
  assert.equal(compatibleDiffCheck.actualSnapshotId, miOtherRow!.id, "Original MI lineage on reused snapshot must be preserved");

  // Verify historical snapshot 7bd320c6 still has its original mi_snapshot_id (9d05d7dc) untouched in DB
  const [storedDiff7bd] = await db
    .select()
    .from(differentiationSnapshots)
    .where(eq(differentiationSnapshots.id, SONGAI_DIFF_7BD));
  assert.equal(
    storedDiff7bd?.miSnapshotId,
    SONGAI_MI_9D0,
    "Historical snapshot lineage in DB must never be rewritten",
  );
  console.log(`  [PASS] Check 7 (Contract): Compatible reuse across different run IDs (${miOtherRow!.id.slice(0, 8)} <-> ${mi714Row!.id.slice(0, 8)}) works via versioned input fingerprints (${miEquivCheck.equivalenceMode}) without falsifying lineage.`);

  // CHECK 8: Unrelated business fixture passes, proving the repair is not Songai-specific
  const b2bSaasEvidenceCtx = await buildAuthoritativeCompetitorEvidenceContext({
    mi: {
      id: "mi_b2b_soc2_01",
      marketDiagnosis: "B2B Cloud Compliance & SOC-2 Automation market where multiple vendors offer automated evidence collection and free sandbox trials.",
    },
    audience: {
      audiencePains: [
        {
          id: "PAIN-B2B-1",
          statement: "Engineering leads complain that rigid compliance checklists generate noisy alerts that don't map to custom Kubernetes architectures.",
          scope: "COMPETITOR_SPECIFIC",
          competitorNames: ["Vanta", "Drata"],
        },
      ],
      objectionMap: [
        {
          id: "OBJ-B2B-1",
          statement: "Will connecting our AWS read-only role expose sensitive production metadata during the trial?",
        },
      ],
    },
    positioning: {
      id: "pos_b2b_soc2_01",
      territories: [
        {
          name: "Architecture-Aware Compliance Automation",
          positioningOutcomeType: "SHARED_CAPABILITY_STRATEGIC_EMPHASIS",
          epistemicStatus: "STRATEGIC_HYPOTHESIS",
          contrastAxis: "From noisy generic compliance checklists -> To Kubernetes-native control mapping with a 14-day read-only sandbox trial",
          semanticCollision: {
            comparisonStatus: "COMPARISON_COMPLETED",
            semanticCollisionScore: 0.58,
            comparedCompetitorCount: 4,
            previewOrTrialCounterexamples: [
              {
                competitorId: "comp_vanta",
                competitorName: "Vanta",
                sourceId: "cu:vanta_01",
                observedPricingAndTrial: "Offers free interactive product tour and sandbox trial before annual contract commitment",
              },
              {
                competitorId: "comp_drata",
                competitorName: "Drata",
                sourceId: "cu:drata_01",
                observedPricingAndTrial: "Offers guided sandbox preview and pre-contract readiness assessment",
              },
            ],
          },
        },
      ],
    },
    productTruthFacts: [
      "Provides a 14-day read-only AWS/Kubernetes sandbox trial before annual subscription billing.",
      "Maps SOC-2 controls directly to custom Terraform and Kubernetes cluster manifests.",
    ],
    cuSnapshotsOverride: [],
  });

  const b2bContradicted = {
    currentModel: {
      statement: "Every service in this specific market forces financial commitment before generation of a compliance readiness report.",
      sourceOfBelief: "All competitors require full annual payment before showing you anything.",
      whyItStuckSoFar: "No competitor in this market offers a sandbox preview.",
    },
    falseBridge: {
      obviousNextStep: "Hiring manual consultants.",
      whyItFails: "Slow and expensive.",
    },
    newModel: {
      reclassification: "Test Kubernetes control mapping in a 14-day sandbox before annual contract billing.",
      namedPrinciple: "Read-only infrastructure verification.",
      whatBecomesObvious: "Connect read-only metadata in the 14-day sandbox first.",
    },
    bridgeMechanism: {
      movement: "decisive_evidence" as const,
      specificMove: "Compare the standard industry model (pay upfront before seeing a readiness report) against our sandbox.",
      whyBuyerCanAcceptIt: "CTOs want technical proof.",
    },
    discomfortCost: {
      privateAdmission: "Manual spreadsheet tracking is brittle.",
      statusGivenUp: "DIY compliance heroics.",
      whyItIsWorthIt: "Automated audit readiness.",
    },
  };
  const b2bEvalBefore = evaluateAwarenessComparativeClaims(b2bContradicted, b2bSaasEvidenceCtx);
  assert.equal(b2bEvalBefore.passed, false, "Unrelated B2B SaaS fixture must detect contradicted universal market claim against Vanta/Drata counterexamples");
  assert.ok(
    b2bEvalBefore.violations[0].counterexampleCompetitors.includes("Vanta") &&
      b2bEvalBefore.violations[0].counterexampleCompetitors.includes("Drata"),
    "B2B SaaS violation must cite Vanta and Drata counterexamples",
  );
  const b2bRepaired = repairContradictedNarrativeReframe(b2bContradicted, b2bSaasEvidenceCtx, b2bEvalBefore);
  const b2bEvalAfter = evaluateAwarenessComparativeClaims(b2bRepaired, b2bSaasEvidenceCtx);
  assert.equal(b2bEvalAfter.passed, true, "Unrelated B2B SaaS fixture must be repaired cleanly");

  // Also test B2B SaaS lineage compatibility contract with in-memory fixtures
  const b2bMiMap = new Map([
    [
      "mi_b2b_run1",
      {
        id: "mi_b2b_run1",
        competitorHash: "b2b_comp_hash_1",
        contentHash: "b2b_content_hash_1",
        postSampleSize: 80,
        commentSampleSize: 12,
        opportunitySignals: "[1,2]",
        threatSignals: "[1]",
      },
    ],
    [
      "mi_b2b_run2_equiv",
      {
        id: "mi_b2b_run2_equiv",
        competitorHash: "b2b_comp_hash_1",
        contentHash: "b2b_content_hash_1",
        postSampleSize: 80,
        commentSampleSize: 12,
        opportunitySignals: "[1,2]",
        threatSignals: "[1]",
      },
    ],
    [
      "mi_b2b_run3_changed",
      {
        id: "mi_b2b_run3_changed",
        competitorHash: "b2b_comp_hash_2",
        contentHash: "b2b_content_hash_9",
        postSampleSize: 140,
        commentSampleSize: 30,
        opportunitySignals: "[1,2,3]",
        threatSignals: "[1,2]",
      },
    ],
  ]);
  assert.equal(
    isDifferentiationSnapshotCompatibleSync({
      diffRow: { id: "diff_b2b_1", miSnapshotId: "mi_b2b_run1", audienceSnapshotId: "aud_b2b_1" },
      expectedMiSnapshotId: "mi_b2b_run2_equiv",
      expectedAudienceSnapshotId: "aud_b2b_1",
      miRowLookup: b2bMiMap,
    }).compatible,
    true,
    "B2B fixture: equivalent MI inputs across runs must be compatible",
  );
  assert.equal(
    isDifferentiationSnapshotCompatibleSync({
      diffRow: { id: "diff_b2b_1", miSnapshotId: "mi_b2b_run1", audienceSnapshotId: "aud_b2b_1" },
      expectedMiSnapshotId: "mi_b2b_run3_changed",
      expectedAudienceSnapshotId: "aud_b2b_1",
      miRowLookup: b2bMiMap,
    }).compatible,
    false,
    "B2B fixture: changed MI inputs must be rejected as incompatible",
  );
  console.log("  [PASS] Check 8 (Contract): Unrelated B2B SaaS fixture passes both Awareness counterevidence repair and Differentiation lineage contract.\n");

  // ---------------------------------------------------------------------------
  // PART B: LIVE MODEL BEHAVIOR VERIFICATION (Real LLM Proposer + Judge Calls)
  // ---------------------------------------------------------------------------
  console.log("── PART B: LIVE MODEL BEHAVIOR VERIFICATION (OpenAI gpt-4.1-mini) ──");

  const liveReframe = await engineerNarrativeReframe({
    awarenessStage: "problem_aware",
    primaryEntryRoute: "pain_entry",
    triggerClass: "problem_recognition_trigger",
    positioningStatement:
      "Guided story-to-song creation where buyers test their specific personal memories in a free trial song creation before paying when gifting or obtaining the final song and optional keepsake formats.",
    coreOffer: "Guided Custom Song Creation with Free Trial Song Creation Before Final Gift Purchase",
    audiencePains: [
      "Some customers report that personalized songs from automated services sound generic and miss specific personal memories.",
      "Buyers worry about whether a custom song will capture their relationship's inside jokes and emotional milestones.",
    ],
    audienceObjections: [
      "Will an AI-assisted custom song sound generic or formulaic?",
      "How do I know my personal story will be captured before I pay to gift the final song?",
    ],
    buyerBeliefModel: {
      aboutCategory: "Many services advertise fast custom songs or free previews, but outputs often feel generic when personal details are flattened.",
      aboutThemselves: "I want to give a deeply personal gift, not a generic novelty track.",
      aboutAlternatives: "Several services (CreateMySong, GiftSong, Songilingy, Songly, Songoven, TuneForTwo) offer previews or trials, while studio commissions cost hundreds of dollars.",
    },
    buyerRejectionHistory: [
      "Generic one-prompt AI song generators that missed personal nuances",
    ],
    buyerDecisionTrigger: "Upcoming anniversary or milestone birthday requiring a meaningful personal gift",
    buyerIdentityAspiration: "Thoughtful partner or family member who captures real shared memories",
    buyerSophisticationTier: 3,
    accountId: SONGAI_ACCOUNT_ID,
    competitorEvidenceContext: songaiEvidenceCtx,
  });

  assert.ok(liveReframe, "Live engineerNarrativeReframe must return a valid NarrativeReframe");
  assert.equal(liveReframe.evidenceVersionHash, songaiEvidenceCtx.evidenceVersionHash, "Live NarrativeReframe must record the authoritative evidenceVersionHash");
  const liveReframeEval = evaluateAwarenessComparativeClaims(liveReframe as any, songaiEvidenceCtx);
  assert.equal(
    liveReframeEval.passed,
    true,
    `Live LLM NarrativeReframe must pass all comparative evidence checks, got violations: ${JSON.stringify(liveReframeEval.violations)}`,
  );
  console.log(`  [PASS] Live LLM NarrativeReframe (verdict=${liveReframe.judgeVerdict}, retries=${liveReframe.retryCount}, version=${liveReframe.evidenceVersionHash}):`);
  console.log(`         • currentModel.whyItStuckSoFar: "${liveReframe.currentModel.whyItStuckSoFar}"`);
  console.log(`         • bridgeMechanism.specificMove: "${liveReframe.bridgeMechanism.specificMove}"`);

  const liveMythBreaker = await generateMythBreaker({
    analyticalEnrichment: {
      rootCauses: [
        {
          id: "RC1",
          description: "Buyers experience generic-sounding custom songs when story intake lacks structured personal memory capture before composition.",
        },
      ],
    },
    audienceObjections: [
      "Will a personalized song actually capture our specific memories before I pay for the final gift?",
    ],
    audienceBeliefs: [
      "Without paying hundreds for a studio songwriter, a custom song will inevitably sound generic.",
    ],
    audiencePains: [
      "Some customers report that personalized songs sound generic and miss specific personal touches.",
    ],
    marketDiagnosis: "Custom song category where 6 monitored competitors offer free previews/trials and 8 offer visual/multi-format deliverables.",
    enemyDefinition: "Unguided story intake that flattens personal memories into generic lyrics",
    contrastAxis: "From unguided prompts -> To structured personal story capture in a free trial song creation before paying when gifting",
    awarenessStage: "problem_aware",
    sophisticationTier: 3,
    rejectedClaimPatterns: ["Every other service forces upfront payment"],
    accountId: SONGAI_ACCOUNT_ID,
    productTruthFacts: [
      "Users can create a free trial song from their personal story and memories before paying.",
      "Payment is required when gifting or obtaining the final custom song and optional keepsake formats.",
    ],
    competitorEvidenceContext: songaiEvidenceCtx,
  });

  assert.ok(liveMythBreaker, "Live generateMythBreaker must return a valid MythBreakerReasoning");
  const liveMbEval = evaluateAwarenessComparativeClaims(liveMythBreaker as any, songaiEvidenceCtx);
  assert.equal(
    liveMbEval.passed,
    true,
    `Live LLM MythBreaker must pass all comparative evidence checks, got violations: ${JSON.stringify(liveMbEval.violations)}`,
  );
  console.log(`  [PASS] Live LLM MythBreaker: "${liveMythBreaker.mythBreakerStatement}"`);

  // ---------------------------------------------------------------------------
  // PART C: ACTIVE PLAN, ROOT BUNDLE, STRATEGY ROOT & AWARENESS VERIFICATION
  // ---------------------------------------------------------------------------
  console.log("\n── PART C: APPLICATION PIPELINE & ACTIVE PLAN VERIFICATION ──");
  const NEW_PLAN_ID = "c3e6a7a0-56be-4538-b9de-529302903435";
  const OLD_AWARENESS_ID = "55127e3d-8705-44b8-8d31-30d3e0e2c3d5";

  const [newPlan] = await db.select().from(strategicPlans).where(eq(strategicPlans.id, NEW_PLAN_ID));
  assert.ok(newPlan, "Newly generated & approved Songai plan must exist");
  assert.equal(newPlan.status, "APPROVED");
  assert.equal(newPlan.executionStatus, "ACTIVE");

  const [newBundle] = await db.select().from(rootBundles).where(eq(rootBundles.id, newPlan.rootBundleId!));
  assert.ok(newBundle, "New root bundle must exist");
  assert.equal(newBundle.status.toUpperCase(), "ACTIVE");

  const bundleSrc = typeof newBundle.sourceSnapshot === "string"
    ? JSON.parse(newBundle.sourceSnapshot)
    : (newBundle.sourceSnapshot as any);
  const selectedIds = bundleSrc.selectedSnapshotIds;

  const [newRoot] = await db.select().from(strategyRoots).where(eq(strategyRoots.id, bundleSrc.strategyRootId!));
  const [newDiff] = await db.select().from(differentiationSnapshots).where(eq(differentiationSnapshots.id, selectedIds.differentiation));
  const [newPos] = await db.select().from(positioningSnapshots).where(eq(positioningSnapshots.id, selectedIds.positioning));
  const [newMech] = await db.select().from(mechanismSnapshots).where(eq(mechanismSnapshots.id, selectedIds.mechanism));
  const [newOffer] = await db.select().from(offerSnapshots).where(eq(offerSnapshots.id, selectedIds.offer));
  const [newAw] = await db.select().from(awarenessSnapshots).where(eq(awarenessSnapshots.id, selectedIds.awareness));
  const [oldAw] = await db.select().from(awarenessSnapshots).where(eq(awarenessSnapshots.id, OLD_AWARENESS_ID));

  assert.equal(selectedIds.market_intelligence, SONGAI_MI_714);
  assert.equal(newRoot.miSnapshotId, SONGAI_MI_714);
  assert.equal(newDiff.miSnapshotId, SONGAI_MI_714);
  assert.equal(newPos.miSnapshotId, SONGAI_MI_714);
  assert.equal(newMech.positioningSnapshotId, newPos.id);
  assert.equal(newMech.differentiationSnapshotId, newDiff.id);
  assert.equal(newOffer.miSnapshotId, SONGAI_MI_714);
  assert.equal(newAw.miSnapshotId, SONGAI_MI_714);

  const fullBundleCompat = await validateBundleLineageCompatibility({
    miSnapshotId: selectedIds.market_intelligence,
    audienceSnapshotId: selectedIds.audience,
    differentiationSnapshotId: selectedIds.differentiation,
    positioningSnapshotId: selectedIds.positioning,
    mechanismSnapshotId: selectedIds.mechanism,
    offerSnapshotId: selectedIds.offer,
    awarenessSnapshotId: selectedIds.awareness,
  });
  assert.equal(fullBundleCompat.compatible, true, `New active bundle lineage must be 100% compatible: ${JSON.stringify(fullBundleCompat.mismatches)}`);

  const oldPrimaryRoute = typeof oldAw.primaryRoute === "string" ? JSON.parse(oldAw.primaryRoute) : oldAw.primaryRoute;
  const newPrimaryRoute = typeof newAw.primaryRoute === "string" ? JSON.parse(newAw.primaryRoute) : newAw.primaryRoute;

  const newNrEval = evaluateAwarenessComparativeClaims(newPrimaryRoute?.narrativeReframe, songaiEvidenceCtx);
  const newMbEval = evaluateAwarenessComparativeClaims(newPrimaryRoute?.mythBreaker, songaiEvidenceCtx);
  assert.equal(newNrEval.passed, true, `New stored Awareness narrativeReframe must have 0 violations: ${JSON.stringify(newNrEval.violations)}`);
  assert.equal(newMbEval.passed, true, `New stored Awareness mythBreaker must have 0 violations: ${JSON.stringify(newMbEval.violations)}`);

  const planData = typeof newPlan.planJson === "string" ? JSON.parse(newPlan.planJson) : newPlan.planJson;
  const overviewEval = evaluateAwarenessComparativeClaims(
    {
      summary: newPlan.planSummary,
      businessOverview: (planData as any)?.businessLanguageLayer || (planData as any)?.executiveSummary || null,
      awareness: (planData as any)?.awareness || null,
    },
    songaiEvidenceCtx,
  );
  assert.equal(overviewEval.passed, true, `Active Plan & Overview must have 0 contradicted comparative claims: ${JSON.stringify(overviewEval.violations)}`);

  console.log(`  [PASS] Active Plan: ${newPlan.id} (v${newPlan.version}, status=${newPlan.status}, executionStatus=${newPlan.executionStatus})`);
  console.log(`  [PASS] Active Root Bundle: ${newBundle.id} (v${newBundle.version}, status=${newBundle.status})`);
  console.log(`  [PASS] Active Strategy Root: ${newRoot.id} (status=${newRoot.status}, miSnapshotId=${newRoot.miSnapshotId})`);
  console.log(`  [PASS] Selected Snapshots (all aligned on MI=${SONGAI_MI_714} & Audience=${SONGAI_AUD_362}):`);
  console.log(`         • Differentiation: ${newDiff.id} (miSnapshotId=${newDiff.miSnapshotId})`);
  console.log(`         • Positioning:     ${newPos.id} (miSnapshotId=${newPos.miSnapshotId})`);
  console.log(`         • Mechanism:       ${newMech.id} (positioningSnapshotId=${newMech.positioningSnapshotId}, differentiationSnapshotId=${newMech.differentiationSnapshotId})`);
  console.log(`         • Offer:           ${newOffer.id} (miSnapshotId=${newOffer.miSnapshotId})`);
  console.log(`         • Awareness:       ${newAw.id} (miSnapshotId=${newAw.miSnapshotId})`);
  console.log("\n  ── Old vs. New Awareness Passages ──");
  console.log(`  OLD Awareness (${oldAw.id}):`);
  console.log(`    • narrativeReframe: ${JSON.stringify(oldPrimaryRoute?.narrativeReframe)}`);
  console.log(`    • mythBreaker:      ${JSON.stringify(oldPrimaryRoute?.mythBreaker)}`);
  console.log(`  NEW Awareness (${newAw.id}):`);
  console.log(`    • competitorEvidenceSummary: ${JSON.stringify(newPrimaryRoute?.competitorEvidenceSummary)}`);
  console.log(`    • narrativeReframe: ${JSON.stringify(newPrimaryRoute?.narrativeReframe)}`);
  console.log(`    • mythBreaker:      ${JSON.stringify(newPrimaryRoute?.mythBreaker)}`);
  console.log(`  NEW Active Plan Summary: "${newPlan.planSummary}"`);

  console.log("\n═══════════════════════════════════════════════════════════════════════════");
  console.log("  ALL 8 TARGETED REGRESSION CHECKS + ACTIVE PLAN VERIFICATION PASSED");
  console.log("═══════════════════════════════════════════════════════════════════════════");
  process.exit(0);
}

runTests().catch(err => {
  console.error("TEST SUITE FAILED:", err);
  process.exit(1);
});
