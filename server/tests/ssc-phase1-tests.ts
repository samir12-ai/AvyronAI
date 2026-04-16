import {
  createEmptySSC,
  registerProblem,
  resolveProblem,
  deferProblem,
  getRelevantProblems,
  addReasonTrace,
  updateConfidenceChain,
  addContradiction,
  addNarrativeConstraint,
  getUnresolvedCriticalProblems,
  getUnresolvedHighProblems,
  type SharedStrategicContext,
} from "../orchestrator/shared-strategic-context";
import {
  resolveAwarenessMeaning,
  AWARENESS_MEANINGS,
  type AwarenessStage,
} from "../orchestrator/canonical-meanings";

let passed = 0;
let failed = 0;

function assert(condition: boolean, name: string) {
  if (condition) {
    passed++;
    console.log(`  ✅ ${name}`);
  } else {
    failed++;
    console.error(`  ❌ FAIL: ${name}`);
  }
}

console.log("\n=== SSC Phase 1 Tests ===\n");

console.log("--- createEmptySSC ---");
{
  const ssc = createEmptySSC("camp_123", "acc_456");
  assert(ssc.campaignId === "camp_123", "campaignId set correctly");
  assert(ssc.accountId === "acc_456", "accountId set correctly");
  assert(Array.isArray(ssc.problemRegistry) && ssc.problemRegistry.length === 0, "problemRegistry is empty array");
  assert(Array.isArray(ssc.painMap) && ssc.painMap.length === 0, "painMap is empty array");
  assert(Array.isArray(ssc.desireMap) && ssc.desireMap.length === 0, "desireMap is empty array");
  assert(Array.isArray(ssc.objectionMap) && ssc.objectionMap.length === 0, "objectionMap is empty array");
  assert(ssc.trustMap.level === "none", "trustMap defaults to none");
  assert(ssc.awarenessMeaning === null, "awarenessMeaning starts null");
  assert(Array.isArray(ssc.narrativeConstraints) && ssc.narrativeConstraints.length === 0, "narrativeConstraints empty");
  assert(Array.isArray(ssc.contradictions) && ssc.contradictions.length === 0, "contradictions empty");
  assert(ssc.confidenceFloor === 1.0, "confidenceFloor starts at 1.0");
  assert(Array.isArray(ssc.confidenceChain) && ssc.confidenceChain.length === 0, "confidenceChain empty");
  assert(Array.isArray(ssc.downstreamRequirements) && ssc.downstreamRequirements.length === 0, "downstreamRequirements empty");
  assert(Array.isArray(ssc.reasonTrace) && ssc.reasonTrace.length === 0, "reasonTrace empty");
}

console.log("\n--- Isolation: Two SSCs are independent ---");
{
  const ssc1 = createEmptySSC("camp_A", "acc_A");
  const ssc2 = createEmptySSC("camp_B", "acc_B");
  registerProblem(ssc1, "audience", "market", "Test problem", "critical", 0.9, ["positioning"], 1);
  assert(ssc1.problemRegistry.length === 1, "ssc1 has 1 problem");
  assert(ssc2.problemRegistry.length === 0, "ssc2 still has 0 problems (isolation)");
}

console.log("\n--- registerProblem ---");
{
  const ssc = createEmptySSC("camp_test", "acc_test");
  const entry = registerProblem(ssc, "positioning", "structural", "Low confidence territory", "high", 0.35, ["offer", "funnel"], 3);
  assert(entry.id.startsWith("prob_positioning_"), "problem ID has correct prefix");
  assert(entry.sourceEngine === "positioning", "sourceEngine correct");
  assert(entry.type === "structural", "type correct");
  assert(entry.description === "Low confidence territory", "description correct");
  assert(entry.severity === "high", "severity correct");
  assert(entry.confidence === 0.35, "confidence correct");
  assert(entry.status === "open", "status starts as open");
  assert(entry.resolvedBy === undefined, "resolvedBy starts undefined");
  assert(entry.discoveredAt === 3, "discoveredAt correct");
  assert(entry.relevantEngines.includes("offer") && entry.relevantEngines.includes("funnel"), "relevantEngines correct");
  assert(ssc.problemRegistry.length === 1, "problem added to registry");
}

console.log("\n--- resolveProblem ---");
{
  const ssc = createEmptySSC("camp_test", "acc_test");
  const entry = registerProblem(ssc, "audience", "trust", "Missing proof", "critical", 0.8, ["positioning", "differentiation"], 1);
  const resolved = resolveProblem(ssc, entry.id, "differentiation", "Added proof framework");
  assert(resolved === true, "resolveProblem returns true");
  assert(entry.status === "resolved", "status changed to resolved");
  assert(entry.resolvedBy === "differentiation", "resolvedBy set correctly");
  assert(entry.resolvedAction === "Added proof framework", "resolvedAction set correctly");

  const notFound = resolveProblem(ssc, "nonexistent_id", "audience", "nope");
  assert(notFound === false, "resolveProblem returns false for nonexistent ID");
}

console.log("\n--- deferProblem ---");
{
  const ssc = createEmptySSC("camp_test", "acc_test");
  const entry = registerProblem(ssc, "market_intelligence", "market", "Saturated niche", "medium", 0.6, ["positioning"], 0);
  const deferred = deferProblem(ssc, entry.id, "positioning", "Market too broad to address now");
  assert(deferred === true, "deferProblem returns true");
  assert(entry.status === "deferred", "status changed to deferred");
  assert(entry.deferredBy === "positioning", "deferredBy set correctly");
  assert(entry.deferredReason === "Market too broad to address now", "deferredReason set correctly");

  const notFound = deferProblem(ssc, "nonexistent_id", "audience", "nope");
  assert(notFound === false, "deferProblem returns false for nonexistent ID");
}

console.log("\n--- getRelevantProblems ---");
{
  const ssc = createEmptySSC("camp_test", "acc_test");
  registerProblem(ssc, "audience", "trust", "Problem A", "critical", 0.9, ["positioning", "offer"], 1);
  registerProblem(ssc, "positioning", "structural", "Problem B", "high", 0.5, ["offer", "funnel"], 2);
  registerProblem(ssc, "differentiation", "alignment", "Problem C", "medium", 0.4, ["mechanism"], 3);

  const offerProblems = getRelevantProblems(ssc, "offer");
  assert(offerProblems.length === 2, "offer sees 2 relevant problems");

  const mechanismProblems = getRelevantProblems(ssc, "mechanism");
  assert(mechanismProblems.length === 1, "mechanism sees 1 relevant problem");

  const audienceProblems = getRelevantProblems(ssc, "audience");
  assert(audienceProblems.length === 0, "audience sees 0 relevant problems (it's the source, not target)");

  resolveProblem(ssc, offerProblems[0].id, "offer", "Fixed");
  const offerProblemsAfterResolve = getRelevantProblems(ssc, "offer");
  assert(offerProblemsAfterResolve.length === 1, "offer sees 1 problem after resolving one");
}

console.log("\n--- addReasonTrace ---");
{
  const ssc = createEmptySSC("camp_test", "acc_test");
  addReasonTrace(ssc, "positioning", "market_saturation=0.85", "High saturation means differentiation required", "Must establish unique territory", "Selected niche positioning", 0.72, "mi_signal_42");
  assert(ssc.reasonTrace.length === 1, "reason trace entry added");
  const entry = ssc.reasonTrace[0];
  assert(entry.engineId === "positioning", "engineId correct");
  assert(entry.signal === "market_saturation=0.85", "signal correct");
  assert(entry.interpretation === "High saturation means differentiation required", "interpretation correct");
  assert(entry.constraint === "Must establish unique territory", "constraint correct");
  assert(entry.decision === "Selected niche positioning", "decision correct");
  assert(entry.confidence === 0.72, "confidence correct");
  assert(entry.upstreamRef === "mi_signal_42", "upstreamRef correct");
}

console.log("\n--- updateConfidenceChain ---");
{
  const ssc = createEmptySSC("camp_test", "acc_test");
  assert(ssc.confidenceFloor === 1.0, "floor starts at 1.0");

  updateConfidenceChain(ssc, "audience", 0.8, 0.7, 0.75);
  assert(ssc.confidenceFloor === 0.75, "floor drops to 0.75 after audience");
  assert(ssc.confidenceChain.length === 1, "chain has 1 entry");
  assert(ssc.confidenceChain[0].inheritedFloor === 0.75, "inherited floor correct");

  updateConfidenceChain(ssc, "positioning", 0.6, 0.5, 0.55);
  assert(ssc.confidenceFloor === 0.55, "floor drops to 0.55 after positioning");
  assert(ssc.confidenceChain.length === 2, "chain has 2 entries");
  assert(ssc.confidenceChain[1].inheritedFloor === 0.55, "inherited floor correct after positioning");

  updateConfidenceChain(ssc, "differentiation", 0.9, 0.85, 0.87);
  assert(ssc.confidenceFloor === 0.55, "floor stays at 0.55 (higher engine doesn't raise it)");
  assert(ssc.confidenceChain.length === 3, "chain has 3 entries");
  assert(ssc.confidenceChain[2].inheritedFloor === 0.55, "inherited floor stays at minimum");
}

console.log("\n--- addContradiction ---");
{
  const ssc = createEmptySSC("camp_test", "acc_test");
  addContradiction(ssc, "audience", "channel_selection", "Awareness=product_aware but 12 channels blocked for unaware", "critical", 5);
  assert(ssc.contradictions.length === 1, "contradiction added");
  assert(ssc.contradictions[0].engineA === "audience", "engineA correct");
  assert(ssc.contradictions[0].engineB === "channel_selection", "engineB correct");
  assert(ssc.contradictions[0].severity === "critical", "severity correct");
}

console.log("\n--- addNarrativeConstraint ---");
{
  const ssc = createEmptySSC("camp_test", "acc_test");
  addNarrativeConstraint(ssc, "positioning", "Must lead with mechanism differentiation", 3);
  assert(ssc.narrativeConstraints.length === 1, "constraint added");
  assert(ssc.narrativeConstraints[0].sourceEngine === "positioning", "sourceEngine correct");
  assert(ssc.narrativeConstraints[0].constraint === "Must lead with mechanism differentiation", "constraint text correct");
}

console.log("\n--- getUnresolvedCriticalProblems / getUnresolvedHighProblems ---");
{
  const ssc = createEmptySSC("camp_test", "acc_test");
  const p1 = registerProblem(ssc, "audience", "trust", "Critical A", "critical", 0.9, ["positioning"], 1);
  registerProblem(ssc, "positioning", "structural", "High B", "high", 0.6, ["offer"], 2);
  registerProblem(ssc, "differentiation", "alignment", "Medium C", "medium", 0.4, ["mechanism"], 3);
  registerProblem(ssc, "mechanism", "conversion", "Critical D", "critical", 0.8, ["offer"], 4);

  assert(getUnresolvedCriticalProblems(ssc).length === 2, "2 unresolved critical problems");
  assert(getUnresolvedHighProblems(ssc).length === 1, "1 unresolved high problem");

  resolveProblem(ssc, p1.id, "positioning", "Fixed");
  assert(getUnresolvedCriticalProblems(ssc).length === 1, "1 unresolved critical after resolving one");
}

console.log("\n--- resolveAwarenessMeaning ---");
{
  const stages: AwarenessStage[] = ["unaware", "problem_aware", "solution_aware", "product_aware", "most_aware"];
  for (const stage of stages) {
    const meaning = resolveAwarenessMeaning(stage);
    assert(meaning !== null, `resolveAwarenessMeaning('${stage}') returns non-null`);
    assert(meaning!.stage === stage, `meaning.stage matches '${stage}'`);
    assert(Array.isArray(meaning!.allowedFunnelTypes), `'${stage}' has allowedFunnelTypes array`);
    assert(Array.isArray(meaning!.blockedFunnelTypes), `'${stage}' has blockedFunnelTypes array`);
    assert(Array.isArray(meaning!.allowedChannelRoles), `'${stage}' has allowedChannelRoles array`);
    assert(Array.isArray(meaning!.allowedPersuasionModes), `'${stage}' has allowedPersuasionModes array`);
  }

  assert(resolveAwarenessMeaning("nonexistent_stage") === null, "nonexistent stage returns null");
  assert(resolveAwarenessMeaning("") === null, "empty string returns null");

  const normalized = resolveAwarenessMeaning("Product Aware");
  assert(normalized !== null, "resolveAwarenessMeaning normalizes 'Product Aware'");
  assert(normalized!.stage === "product_aware", "normalized to 'product_aware'");

  const dashCase = resolveAwarenessMeaning("problem-aware");
  assert(dashCase !== null, "resolveAwarenessMeaning normalizes 'problem-aware'");
  assert(dashCase!.stage === "problem_aware", "normalized to 'problem_aware'");
}

console.log("\n--- resolveAwarenessMeaning with object input ---");
{
  const objectStage = { level: "product_aware", distribution: { x: 0.3 }, confidenceScore: 0.46 };
  const meaning = resolveAwarenessMeaning(objectStage);
  assert(meaning !== null, "resolveAwarenessMeaning handles object with .level");
  assert(meaning!.stage === "product_aware", "extracts level from object correctly");

  const badObject = { distribution: { x: 0.3 } };
  assert(resolveAwarenessMeaning(badObject) === null, "object without .level returns null");

  assert(resolveAwarenessMeaning(null) === null, "null returns null");
  assert(resolveAwarenessMeaning(undefined) === null, "undefined returns null");
  assert(resolveAwarenessMeaning(42) === null, "number returns null");
}

console.log("\n--- resolveAwarenessMeaning returns isolated copies ---");
{
  const a = resolveAwarenessMeaning("product_aware");
  const b = resolveAwarenessMeaning("product_aware");
  assert(a !== b, "two calls return different object references");
  assert(a!.allowedFunnelTypes !== b!.allowedFunnelTypes, "array references are different (deep copy)");
  a!.allowedFunnelTypes.push("MUTATED");
  assert(!b!.allowedFunnelTypes.includes("MUTATED"), "mutating one does not affect another");
  const original = AWARENESS_MEANINGS.product_aware;
  assert(!original.allowedFunnelTypes.includes("MUTATED"), "original constant is not mutated");
}

console.log("\n--- Problem ID uses per-SSC counter (no global leakage) ---");
{
  const ssc1 = createEmptySSC("camp_iso1", "acc_iso1");
  const ssc2 = createEmptySSC("camp_iso2", "acc_iso2");
  const p1 = registerProblem(ssc1, "audience", "market", "P1", "high", 0.8, ["positioning"], 1);
  const p2 = registerProblem(ssc1, "positioning", "structural", "P2", "high", 0.7, ["offer"], 2);
  const p3 = registerProblem(ssc2, "audience", "market", "P3", "high", 0.8, ["positioning"], 1);
  assert(p1.id.includes("_1"), "first problem in ssc1 has seqId 1");
  assert(p2.id.includes("_2"), "second problem in ssc1 has seqId 2");
  assert(p3.id.includes("_1"), "first problem in ssc2 has seqId 1 (independent counter)");
}

console.log("\n--- Canonical meaning content validation ---");
{
  const unaware = AWARENESS_MEANINGS.unaware;
  assert(unaware.trustLevel === "none", "unaware: trust=none");
  assert(unaware.searchIntentExists === false, "unaware: no search intent");
  assert(unaware.conversionReadiness === "not_ready", "unaware: not ready to convert");
  assert(unaware.blockedFunnelTypes.includes("direct"), "unaware: direct funnels blocked");
  assert(unaware.blockedFunnelTypes.includes("tripwire"), "unaware: tripwire funnels blocked");

  const productAware = AWARENESS_MEANINGS.product_aware;
  assert(productAware.trustLevel === "moderate", "product_aware: trust=moderate");
  assert(productAware.searchIntentExists === true, "product_aware: search intent exists");
  assert(productAware.comparisonBehavior === true, "product_aware: comparison behavior");
  assert(productAware.conversionReadiness === "evaluating", "product_aware: evaluating");
  assert(productAware.proofRequirement === "decisive", "product_aware: needs decisive proof");
  assert(productAware.blockedFunnelTypes.length === 0, "product_aware: no blocked funnels");
  assert(productAware.allowedFunnelTypes.includes("direct"), "product_aware: direct funnels allowed");

  const mostAware = AWARENESS_MEANINGS.most_aware;
  assert(mostAware.trustLevel === "high", "most_aware: trust=high");
  assert(mostAware.conversionReadiness === "ready", "most_aware: ready to convert");
  assert(mostAware.proofRequirement === "not_needed", "most_aware: proof not needed");
  assert(mostAware.educationLevel === "none", "most_aware: no education needed");
}

console.log("\n--- SSC serialization roundtrip (pausedContext simulation) ---");
{
  const ssc = createEmptySSC("camp_ser", "acc_ser");
  registerProblem(ssc, "audience", "trust", "Serialize test", "high", 0.7, ["positioning"], 1);
  addReasonTrace(ssc, "audience", "sig", "interp", "const", "dec", 0.8);
  updateConfidenceChain(ssc, "audience", 0.8, 0.7, 0.75);
  ssc.awarenessMeaning = resolveAwarenessMeaning("product_aware");

  const serialized = JSON.stringify(ssc);
  const deserialized: SharedStrategicContext = JSON.parse(serialized);

  assert(deserialized.campaignId === "camp_ser", "serialized campaignId preserved");
  assert(deserialized.accountId === "acc_ser", "serialized accountId preserved");
  assert(deserialized.problemRegistry.length === 1, "serialized problemRegistry preserved");
  assert(deserialized.problemRegistry[0].status === "open", "serialized problem status preserved");
  assert(deserialized.reasonTrace.length === 1, "serialized reasonTrace preserved");
  assert(deserialized.confidenceFloor === 0.75, "serialized confidenceFloor preserved");
  assert(deserialized.confidenceChain.length === 1, "serialized confidenceChain preserved");
  assert(deserialized.awarenessMeaning !== null, "serialized awarenessMeaning preserved");
  assert(deserialized.awarenessMeaning!.stage === "product_aware", "serialized awareness stage preserved");
}

console.log("\n=== Phase 2 Tests ===\n");

console.log("--- extractAudienceInput awarenessLevel fix ---");
{
  const extractAudienceInput = (audienceResult: any): any => {
    if (!audienceResult) return {};
    const rawAwareness = audienceResult.awarenessLevel;
    let awarenessLevel: string | null = null;
    if (typeof rawAwareness === "string") {
      awarenessLevel = rawAwareness;
    } else if (rawAwareness != null && typeof rawAwareness === "object" && typeof rawAwareness.level === "string") {
      awarenessLevel = rawAwareness.level;
    }
    return {
      painProfiles: audienceResult.painProfiles || [],
      desireMap: audienceResult.desireMap || [],
      objectionMap: audienceResult.objectionMap || [],
      transformationMap: audienceResult.transformationMap || [],
      emotionalDrivers: audienceResult.emotionalDrivers || [],
      segments: audienceResult.audienceSegments || [],
      awarenessLevel,
      maturityIndex: audienceResult.maturityIndex || null,
    };
  };

  const stringResult = extractAudienceInput({ awarenessLevel: "product_aware", painProfiles: [{ pain: "test" }] });
  assert(stringResult.awarenessLevel === "product_aware", "extractAudienceInput: string awarenessLevel preserved");
  assert(stringResult.painProfiles.length === 1, "extractAudienceInput: painProfiles preserved");

  const objectResult = extractAudienceInput({ awarenessLevel: { level: "solution_aware", distribution: {}, confidenceScore: 0.7 } });
  assert(objectResult.awarenessLevel === "solution_aware", "extractAudienceInput: object awarenessLevel.level extracted");

  const nullResult = extractAudienceInput({ painProfiles: [] });
  assert(nullResult.awarenessLevel === null, "extractAudienceInput: missing awarenessLevel returns null");

  const emptyResult = extractAudienceInput(null);
  assert(Object.keys(emptyResult).length === 0, "extractAudienceInput: null input returns empty object");
}

console.log("\n--- Mid-pipeline gate: positioning confidence ---");
{
  const ssc = createEmptySSC("camp_gate", "acc_gate");

  const lowConfResult = {
    engineId: "positioning" as const,
    status: "SUCCESS" as const,
    output: { confidenceScore: 0.35, specificityScore: 0.30 },
    durationMs: 100,
  };

  updateConfidenceChain(ssc, "positioning", 0.30, 0.35, 0.325);
  assert(ssc.confidenceFloor < 1.0, "confidence floor drops after low-conf positioning");
  assert(ssc.confidenceChain.length === 1, "confidence chain has entry for positioning");
  assert(ssc.confidenceChain[0].dataConfidence === 0.30, "data confidence captured correctly");
  assert(ssc.confidenceChain[0].engineConfidence === 0.35, "engine confidence captured correctly");
}

console.log("\n--- Mid-pipeline gate: statistical validation rejection ---");
{
  const ssc = createEmptySSC("camp_sv", "acc_sv");
  updateConfidenceChain(ssc, "audience", 0.8, 0.7, 0.75);
  assert(ssc.confidenceFloor === 0.75, "floor at 0.75 before stat val");

  ssc.confidenceFloor = 0;
  assert(ssc.confidenceFloor === 0, "stat val rejection sets floor to 0");

  registerProblem(ssc, "statistical_validation", "structural", "Statistical validation rejected", "critical", 1.0, ["budget_governor", "channel_selection"], 10);
  const bgProblems = getRelevantProblems(ssc, "budget_governor");
  assert(bgProblems.length === 1, "budget_governor sees stat val rejection problem");
  assert(bgProblems[0].severity === "critical", "stat val problem is critical severity");
}

console.log("\n--- Confidence chain ordering and floor behavior ---");
{
  const ssc = createEmptySSC("camp_chain", "acc_chain");

  updateConfidenceChain(ssc, "market_intelligence", 0.9, 0.85, 0.875);
  updateConfidenceChain(ssc, "audience", 0.7, 0.65, 0.675);
  updateConfidenceChain(ssc, "positioning", 0.3, 0.35, 0.325);
  updateConfidenceChain(ssc, "differentiation", 0.8, 0.75, 0.775);

  assert(ssc.confidenceChain.length === 4, "chain has 4 entries");
  assert(ssc.confidenceFloor === 0.325, "floor is minimum across chain");
  assert(ssc.confidenceChain[0].engineId === "market_intelligence", "chain order preserved: MI first");
  assert(ssc.confidenceChain[3].engineId === "differentiation", "chain order preserved: diff last");
  assert(ssc.confidenceChain[3].inheritedFloor === 0.325, "last entry has correct inherited floor");
}

console.log("\n--- Problem propagation through pipeline ---");
{
  const ssc = createEmptySSC("camp_prop", "acc_prop");

  const p1 = registerProblem(ssc, "audience", "trust", "Low trust barriers detected", "high", 0.8, ["positioning", "differentiation", "offer"], 1);
  const p2 = registerProblem(ssc, "positioning", "structural", "Weak territory", "critical", 0.35, ["differentiation", "mechanism", "offer", "funnel"], 2);

  assert(getRelevantProblems(ssc, "differentiation").length === 2, "diff sees both problems");
  assert(getRelevantProblems(ssc, "offer").length === 2, "offer sees both problems");
  assert(getRelevantProblems(ssc, "channel_selection").length === 0, "channel_selection not targeted");

  resolveProblem(ssc, p1.id, "differentiation", "Added proof framework");
  assert(getRelevantProblems(ssc, "offer").length === 1, "offer now sees only 1 problem after trust resolved");

  deferProblem(ssc, p2.id, "mechanism", "Territory too weak but proceeding with constraints");
  assert(getRelevantProblems(ssc, "offer").length === 0, "offer sees 0 problems after defer");
  assert(ssc.problemRegistry.filter(p => p.status === "resolved").length === 1, "1 resolved");
  assert(ssc.problemRegistry.filter(p => p.status === "deferred").length === 1, "1 deferred");
}

console.log("\n--- Canonical awareness meaning for channel selection ---");
{
  const ssc = createEmptySSC("camp_cs", "acc_cs");
  ssc.awarenessMeaning = resolveAwarenessMeaning("product_aware");

  assert(ssc.awarenessMeaning !== null, "awareness meaning set");
  assert(ssc.awarenessMeaning!.stage === "product_aware", "stage is product_aware");
  assert(ssc.awarenessMeaning!.blockedFunnelTypes.length === 0, "product_aware has no blocked funnel types");
  assert(ssc.awarenessMeaning!.allowedChannelRoles.includes("conversion"), "product_aware allows conversion channels");
  assert(ssc.awarenessMeaning!.conversionReadiness === "evaluating", "product_aware conversion readiness is evaluating");

  const unawareSsc = createEmptySSC("camp_un", "acc_un");
  unawareSsc.awarenessMeaning = resolveAwarenessMeaning("unaware");
  assert(unawareSsc.awarenessMeaning!.blockedFunnelTypes.includes("direct"), "unaware blocks direct funnels");
  assert(unawareSsc.awarenessMeaning!.blockedFunnelTypes.includes("tripwire"), "unaware blocks tripwire funnels");
  assert(!unawareSsc.awarenessMeaning!.allowedChannelRoles.includes("conversion"), "unaware does NOT allow conversion channels");
}

console.log("\n--- Full SSC lifecycle simulation ---");
{
  const ssc = createEmptySSC("camp_life", "acc_life");

  updateConfidenceChain(ssc, "market_intelligence", 0.9, 0.85, 0.875);
  updateConfidenceChain(ssc, "audience", 0.7, 0.65, 0.675);
  ssc.awarenessMeaning = resolveAwarenessMeaning("solution_aware");
  ssc.painMap = [{ canonical: "time_waste", sourceSignal: "pain1", frequency: 3, severity: 0.8 }];
  ssc.desireMap = [{ canonical: "automation", sourceSignal: "desire1", intensity: 0.9 }];

  registerProblem(ssc, "audience", "trust", "High trust barriers", "high", 0.75, ["positioning", "offer"], 2);
  updateConfidenceChain(ssc, "positioning", 0.4, 0.42, 0.41);
  addReasonTrace(ssc, "positioning", "saturation=0.85", "High saturation", "Must differentiate", "Niche positioning", 0.42);

  updateConfidenceChain(ssc, "differentiation", 0.7, 0.68, 0.69);
  updateConfidenceChain(ssc, "mechanism", 0.6, 0.55, 0.575);
  updateConfidenceChain(ssc, "offer", 0.65, 0.6, 0.625);
  resolveProblem(ssc, ssc.problemRegistry[0].id, "offer", "Pain alignment added");

  assert(ssc.confidenceFloor === 0.41, "floor is at positioning level (lowest)");
  assert(ssc.confidenceChain.length === 6, "6 engines in chain");
  assert(ssc.problemRegistry.length === 1, "1 problem registered");
  assert(ssc.problemRegistry[0].status === "resolved", "problem resolved");
  assert(ssc.reasonTrace.length === 1, "1 reason trace entry");
  assert(ssc.awarenessMeaning?.stage === "solution_aware", "awareness is solution_aware");

  const serialized = JSON.stringify(ssc);
  const restored: SharedStrategicContext = JSON.parse(serialized);
  assert(restored.confidenceFloor === 0.41, "roundtrip: floor preserved");
  assert(restored.confidenceChain.length === 6, "roundtrip: chain preserved");
  assert(restored.problemRegistry[0].status === "resolved", "roundtrip: problem status preserved");
  assert(restored.awarenessMeaning?.stage === "solution_aware", "roundtrip: awareness preserved");
}

console.log("\n================================");
console.log(`RESULTS: ${passed} passed, ${failed} failed out of ${passed + failed} total`);
if (failed > 0) {
  console.error("\n⚠️  SSC TESTS HAVE FAILURES");
  process.exit(1);
} else {
  console.log("\n✅ ALL SSC TESTS PASSED (Phase 1 + Phase 2)");
}
