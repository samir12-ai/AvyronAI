import { aiChat } from "../ai-client";

export type RiskSeverity = "low" | "moderate" | "high" | "critical";

export interface TrustTransferDesign {
  buyerRiskState: string;
  riskSeverity: RiskSeverity;
  currentTrustSources: string[];
  trustDeficit: string;
  transferMechanism: {
    name: string;
    description: string;
    proofArtifact: string;
  };
  failureModes: Array<{ mechanism: string; whyItWouldFail: string }>;
  requiredProofShape: string;
  commercialFunction: string;
  groundedSignals: string[];
  reasoningSteps: string[];
  judgeVerdict: "ACCEPTED" | "REJECTED" | "NOT_RUN";
  judgeReason?: string;
  retryCount: number;
  modelUsed: string;
  generatedAt: string;
}

const FEW_SHOT_EXAMPLES = `
═══ CALIBRATION EXAMPLES (this is the LEVEL required) ═══

WEAK (REJECTED): "Authority persuasion fits this audience because they are sophisticated."
STRONG (ACCEPTED):
  buyerRiskState: "Buyer fears looking incompetent to their CFO if vendor pick fails — career risk, not budget risk."
  trustDeficit: "Buyer trusts peer CMOs in similar B2B SaaS verticals; does not extend that trust to vendor self-claims about ROI."
  transferMechanism: "Surface 3 named-CMO outcomes from same vertical, each tied to a specific monthly metric, with logo + LinkedIn linkable to a real person — not anonymized 'Fortune 500 client'."
  failureModes: [
    { mechanism: "Founder credentials / authority", whyItWouldFail: "Buyer discounts vendor self-claims at this sophistication tier; founder bio reads as marketing." },
    { mechanism: "Generic social proof badges", whyItWouldFail: "Anonymized logos signal 'we needed to fill a wall' — they amplify skepticism in a career-risk decision." }
  ]
  commercialFunction: "Transfers peer-CMO trust onto our claim by making the proof artifact identity-contiguous with the buyer (same role, same vertical, named person)."

WEAK (REJECTED): "Use scarcity because it creates urgency."
STRONG (ACCEPTED):
  buyerRiskState: "Buyer is in opportunity-cost paralysis — has 3 vendor demos this quarter, fears choosing wrong one means missing budget cycle."
  trustDeficit: "Buyer trusts internally-validated case patterns over vendor claims; scarcity from vendor reads as manipulation."
  transferMechanism: "Reframe scarcity as buyer's own — 'Q4 budget closes in 6 weeks; integration takes 3' — using their calendar, not ours."
  failureModes: [
    { mechanism: "Vendor scarcity ('only 5 spots left')", whyItWouldFail: "Saturated audience tier 4 reads vendor scarcity as fake; reduces trust." },
    { mechanism: "Generic urgency ('act now')", whyItWouldFail: "No specific cost-of-delay; buyer absorbs it as ad copy." }
  ]
  commercialFunction: "Transfers urgency from vendor (low credibility) to buyer's own quarterly budget reality (high credibility)."
═══`;

function buildDesignerPrompt(args: {
  rootCauses: Array<{ id: string; description: string }>;
  objectionStatements: string[];
  trustBarriers: string[];
  audienceSegmentDescriptions: string[];
  sophisticationTier: number | null;
  awarenessStage: string;
  marketDiagnosis: string | null;
  enemyDefinition: string | null;
  rejectedClaimPatterns: string[];
  upstreamBuyerPsychology?: string | null;
  judgeFeedback?: string;
}): string {
  const rcBlock = args.rootCauses.length
    ? args.rootCauses.map(rc => `${rc.id}: ${rc.description}`).join("\n")
    : "(none)";
  const objBlock = args.objectionStatements.slice(0, 8).map((o, i) => `[OBJ${i + 1}] ${o}`).join("\n") || "(none)";
  const trustBlock = args.trustBarriers.slice(0, 6).map((t, i) => `[TRUST${i + 1}] ${t}`).join("\n") || "(none)";
  const segBlock = args.audienceSegmentDescriptions.slice(0, 4).map((s, i) => `[SEG${i + 1}] ${s}`).join("\n") || "(none)";
  const rejectedBlock = args.rejectedClaimPatterns.length
    ? args.rejectedClaimPatterns.slice(0, 6).map(r => `- ${r}`).join("\n")
    : "(none)";
  const psychBlock = args.upstreamBuyerPsychology || "(not yet supplied by upstream — infer conservatively from segment + objection signals above)";

  const judgePreface = args.judgeFeedback
    ? `\n═══ PRIOR ATTEMPT WAS REJECTED ═══\nReason: ${args.judgeFeedback}\nRewrite with SPECIFIC referents — named source, named mechanism, named failure mode. Do NOT repeat the prior generic output.\n`
    : "";

  return `You are a Trust-Transfer Designer working for a top-tier performance marketing principal.
Your job is NOT to label or classify. Your job is to DESIGN the specific commercial mechanism that bridges the buyer's trust deficit, given their actual risk state.

A weak system says: "use authority because they are sophisticated."
A strong system says: "buyer is in [specific risk state]; trusts [specific source]; bridge trust by [specific named mechanism using specific named proof artifact]; the mechanism would fail if we used [X] because [Y]."

You will design the bridge. You will name it. You will state what it transfers and why.
${judgePreface}
${FEW_SHOT_EXAMPLES}

═══ AUDIENCE PSYCHOLOGY ═══
Sophistication tier: ${args.sophisticationTier ?? "unknown"} (1=naive, 5=saturated/burnt)
Awareness stage: ${args.awarenessStage}
Market diagnosis: ${args.marketDiagnosis || "not specified"}
Enemy: ${args.enemyDefinition || "not specified"}
Upstream buyer psychology: ${psychBlock}

Segments:
${segBlock}

═══ ROOT CAUSES ═══
${rcBlock}

═══ OBJECTIONS ═══
${objBlock}

═══ TRUST BARRIERS ═══
${trustBlock}

═══ CLAIMS ALREADY REJECTED BY THIS AUDIENCE ═══
${rejectedBlock}

═══ HARD RULES ═══
1. buyerRiskState MUST name the SPECIFIC kind of risk (financial / time / reputational / identity / status / opportunity-cost) AND the specific scenario the buyer fears, citing [OBJ#]/[TRUST#]/[SEG#]/RC# evidence.
2. trustDeficit MUST name WHAT the buyer trusts AND WHY they don't extend it to us. Not "low trust" — name the source.
3. transferMechanism.name MUST be a specific named mechanism (e.g., "Named-CMO peer outcomes from same vertical"), NOT a category label ("authority", "social proof").
4. transferMechanism.proofArtifact MUST describe the PHYSICAL proof object (e.g., "3 logos + linked LinkedIn profiles + monthly metric", NOT "case studies").
5. failureModes MUST list AT LEAST 2 alternative mechanisms that would FAIL for THIS risk state, with concrete reasons.
6. commercialFunction MUST be ONE sentence answering "What is this doing commercially?" — citing the specific transfer (from X to Y).
7. Do NOT use generic words: "trust", "credibility", "authority", "social proof" without a concrete referent.
8. If you cannot find specific evidence for a field, say "INSUFFICIENT_EVIDENCE — would need [specific signal]" — do NOT fabricate.

Return ONLY valid JSON:
{
  "buyerRiskState": "<specific risk kind + scenario the buyer fears>",
  "riskSeverity": "low|moderate|high|critical",
  "currentTrustSources": ["<specific source>", "<specific source>"],
  "trustDeficit": "<what they trust + why it doesn't extend to us>",
  "transferMechanism": {
    "name": "<specific named mechanism>",
    "description": "<2-3 sentences on how the mechanism actually operates>",
    "proofArtifact": "<the physical proof object — concrete>"
  },
  "failureModes": [
    { "mechanism": "<alt mechanism name>", "whyItWouldFail": "<concrete reason for THIS risk state>" }
  ],
  "requiredProofShape": "<shape of proof: peer-named outcomes / institutional credentials / contrarian reframe / lived demonstration / etc>",
  "commercialFunction": "<one sentence: this transfers [X trust] to [Y claim] because buyer is in [Z risk state]>",
  "groundedSignals": ["[OBJ2] quote", "RC3"],
  "reasoningSteps": [
    "Step 1: identified risk state from [evidence] ...",
    "Step 2: located current trust sources from [evidence] ...",
    "Step 3: named the deficit (trusted X but not us because Y) ...",
    "Step 4: designed mechanism to bridge ...",
    "Step 5: ruled out alternative mechanisms because ..."
  ]
}`;
}

function buildJudgePrompt(designJson: string): string {
  return `You are a hostile reviewer evaluating a Trust-Transfer Design produced by another model.
Your job: reject anything that is generic, label-only, or trivial. Accept only designs a top-tier performance marketing principal would ship.

═══ AUTOMATIC REJECTION CRITERIA ═══
- Uses generic words ("trust", "authority", "credibility", "social proof") WITHOUT a named referent
- buyerRiskState is vague ("they need to trust us") instead of specific ("buyer fears looking incompetent to CFO")
- transferMechanism.name is a category label ("authority") instead of a named mechanism
- transferMechanism.proofArtifact is abstract ("case studies") instead of physical ("3 named-CMO logos with LinkedIn + monthly metric")
- failureModes are generic or fewer than 2
- commercialFunction does not name SPECIFIC source-to-claim transfer
- Any field reads like a textbook definition rather than a real-world design choice

═══ DESIGN TO EVALUATE ═══
${designJson}

Return ONLY valid JSON:
{
  "verdict": "ACCEPTED|REJECTED",
  "reason": "<if rejected, the SINGLE most important reason — be brutal and specific>",
  "specificFix": "<if rejected, what the rewriter must change concretely>"
}`;
}

function safeJsonParse(text: string): any {
  if (!text) return null;
  const cleaned = text.replace(/```json\n?/g, "").replace(/```\n?/g, "").trim();
  try { return JSON.parse(cleaned); } catch { return null; }
}

function extractRootCauses(ael: any): Array<{ id: string; description: string }> {
  if (!ael) return [];
  const out: Array<{ id: string; description: string }> = [];
  const arrays: any[][] = [];
  if (Array.isArray(ael.rootCauses)) arrays.push(ael.rootCauses);
  if (Array.isArray(ael.root_causes)) arrays.push(ael.root_causes);
  if (Array.isArray(ael.causalChains)) arrays.push(ael.causalChains);
  for (const arr of arrays) {
    for (const item of arr) {
      if (!item) continue;
      const id = String(item.id || item.rootCauseId || `RC${out.length + 1}`);
      const desc = String(item.description || item.statement || item.rootCause || item.cause || "").trim();
      if (desc) out.push({ id, description: desc.slice(0, 200) });
    }
  }
  return out.slice(0, 6);
}

function normalizeSeverity(v: any): RiskSeverity {
  const s = String(v || "").toLowerCase();
  if (s === "critical" || s === "high" || s === "moderate" || s === "low") return s as RiskSeverity;
  return "moderate";
}

function parseDesign(parsed: any, modelUsed: string, retryCount: number): TrustTransferDesign | null {
  if (!parsed || !parsed.buyerRiskState || !parsed.transferMechanism) return null;
  const tm = parsed.transferMechanism || {};
  return {
    buyerRiskState: String(parsed.buyerRiskState || "").trim(),
    riskSeverity: normalizeSeverity(parsed.riskSeverity),
    currentTrustSources: Array.isArray(parsed.currentTrustSources) ? parsed.currentTrustSources.map(String) : [],
    trustDeficit: String(parsed.trustDeficit || "").trim(),
    transferMechanism: {
      name: String(tm.name || "").trim(),
      description: String(tm.description || "").trim(),
      proofArtifact: String(tm.proofArtifact || "").trim(),
    },
    failureModes: Array.isArray(parsed.failureModes)
      ? parsed.failureModes
          .map((f: any) => ({
            mechanism: String(f.mechanism || "").trim(),
            whyItWouldFail: String(f.whyItWouldFail || "").trim(),
          }))
          .filter((f: any) => f.mechanism.length > 0 && f.whyItWouldFail.length > 0)
      : [],
    requiredProofShape: String(parsed.requiredProofShape || "").trim(),
    commercialFunction: String(parsed.commercialFunction || "").trim(),
    groundedSignals: Array.isArray(parsed.groundedSignals) ? parsed.groundedSignals.map(String) : [],
    reasoningSteps: Array.isArray(parsed.reasoningSteps) ? parsed.reasoningSteps.map(String) : [],
    judgeVerdict: "NOT_RUN",
    retryCount,
    modelUsed,
    generatedAt: new Date().toISOString(),
  };
}

export async function designTrustTransfer(args: {
  analyticalEnrichment: any;
  objectionStatements: string[];
  trustBarriers: string[];
  audienceSegmentDescriptions: string[];
  sophisticationTier: number | null;
  awarenessStage: string;
  marketDiagnosis: string | null;
  enemyDefinition: string | null;
  rejectedClaimPatterns: string[];
  upstreamBuyerPsychology?: string | null;
  accountId: string;
  // Anchor doctrine (criteria A + F): pre-rendered doctrine/DNA anchor block
  // computed ONCE by the parent persuasion engine. Injected into BOTH the
  // designer prompts and the judge prompts (anchor in first prompt AND judge).
  doctrineBlock?: string | null;
  anchorSource?: "doctrine" | "dna" | "none";
}): Promise<TrustTransferDesign | null> {
  const startTs = Date.now();
  const MODEL = "gpt-4.1-mini";
  // Explicit if/else source classification — no semantic-fallback chains (D1).
  let ttAnchorSource: "doctrine" | "dna" | "none" = "none";
  if (args.anchorSource === "doctrine") ttAnchorSource = "doctrine";
  else if (args.anchorSource === "dna") ttAnchorSource = "dna";
  const ttAnchorPresent = args.doctrineBlock && args.doctrineBlock.length > 0;
  const ttAnchorPrefix = ttAnchorPresent ? `${args.doctrineBlock}\n\n` : "";

  if (args.objectionStatements.length === 0 && args.trustBarriers.length === 0) {
    console.log("[TrustTransfer] SKIPPED — no objections or trust barriers to ground design");
    return null;
  }

  const rootCauses = extractRootCauses(args.analyticalEnrichment);
  console.log(`[TrustTransfer] STEP_1 | designing | rcs=${rootCauses.length} | objections=${args.objectionStatements.length} | tier=${args.sophisticationTier ?? "?"} | stage=${args.awarenessStage}`);

  const promptArgs = { ...args, rootCauses };

  // Attempt 1
  let prompt = `${ttAnchorPrefix}${buildDesignerPrompt(promptArgs)}`;
  console.log(`[TrustTransfer] ANCHOR_EVIDENCE | engine=persuasion_trust_transfer | site=first_prompt | attempt=1 | present=${ttAnchorPresent ? "yes" : "no"} | source=${ttAnchorSource}`);
  let raw = "";
  try {
    const resp = await aiChat({
      model: MODEL,
      messages: [{ role: "user", content: prompt }],
      temperature: 0.3,
      max_tokens: 1500,
      endpoint: "persuasion-engine-trust-transfer",
      accountId: args.accountId,
    });
    raw = resp.choices[0]?.message?.content?.trim() || "";
  } catch (err: any) {
    console.error(`[TrustTransfer] DESIGN_ATTEMPT_1_FAILED | ${err.message}`);
    return null;
  }

  let parsed = safeJsonParse(raw);
  let design = parseDesign(parsed, MODEL, 0);
  if (!design) {
    console.error(`[TrustTransfer] PARSE_FAILED_ATTEMPT_1 | raw=${raw.slice(0, 200)}`);
    return null;
  }

  console.log(`[TrustTransfer] STEP_2 | design_v1 | mechanism="${design.transferMechanism.name}" | risk=${design.riskSeverity} | failureModes=${design.failureModes.length}`);

  // Judge step
  // from a parseable judge response flips it. Failure / unparseable / missing
  // verdict all stay REJECTED with a JUDGE_ERROR reason (no accept-by-default).
  let judgeVerdict: "ACCEPTED" | "REJECTED" = "REJECTED";
  let judgeReason = "JUDGE_ERROR: judge did not run";
  let specificFix = "";
  try {
    const judgePrompt = `${ttAnchorPrefix}${buildJudgePrompt(JSON.stringify(design, null, 2))}`;
    console.log(`[TrustTransfer] ANCHOR_EVIDENCE | engine=persuasion_trust_transfer | site=judge | attempt=1 | present=${ttAnchorPresent ? "yes" : "no"} | source=${ttAnchorSource}`);
    const judgeResp = await aiChat({
      model: MODEL,
      messages: [{ role: "user", content: judgePrompt }],
      temperature: 0.1,
      max_tokens: 400,
      endpoint: "persuasion-engine-trust-transfer-judge",
      accountId: args.accountId,
    });
    const judgeRaw = judgeResp.choices[0]?.message?.content?.trim() || "";
    const judgeParsed = safeJsonParse(judgeRaw);
    if (judgeParsed && (judgeParsed.verdict === "ACCEPTED" || judgeParsed.verdict === "REJECTED")) {
      judgeVerdict = judgeParsed.verdict;
      judgeReason = String(judgeParsed.reason || "").trim();
      specificFix = String(judgeParsed.specificFix || "").trim();
    } else {
      judgeVerdict = "REJECTED";
      judgeReason = `JUDGE_ERROR: unparseable judge output (raw="${judgeRaw.slice(0, 80)}")`;
    }
  } catch (err: any) {
    console.warn(`[TrustTransfer] JUDGE_FAILED | ${err.message} | treating as REJECTED (no positive verdict)`);
    judgeVerdict = "REJECTED";
    judgeReason = `JUDGE_ERROR: ${err.message}`;
  }

  console.log(`[TrustTransfer] STEP_3 | judge=${judgeVerdict}${judgeReason ? ` | reason="${judgeReason.slice(0, 80)}"` : ""}`);

  // Retry once if rejected
  if (judgeVerdict === "REJECTED" && (judgeReason || specificFix)) {
    const feedback = [judgeReason, specificFix].filter(Boolean).join(" — ");
    console.log(`[TrustTransfer] STEP_4 | retry_with_feedback | "${feedback.slice(0, 100)}"`);
    prompt = `${ttAnchorPrefix}${buildDesignerPrompt({ ...promptArgs, judgeFeedback: feedback })}`;
    console.log(`[TrustTransfer] ANCHOR_EVIDENCE | engine=persuasion_trust_transfer | site=first_prompt | attempt=2 | present=${ttAnchorPresent ? "yes" : "no"} | source=${ttAnchorSource}`);
    try {
      const resp2 = await aiChat({
        model: MODEL,
        messages: [{ role: "user", content: prompt }],
        temperature: 0.3,
        max_tokens: 1500,
        endpoint: "persuasion-engine-trust-transfer-retry",
        accountId: args.accountId,
      });
      const raw2 = resp2.choices[0]?.message?.content?.trim() || "";
      const parsed2 = safeJsonParse(raw2);
      const design2 = parseDesign(parsed2, MODEL, 1);
      if (design2) {
        design = design2;
        console.log(`[TrustTransfer] STEP_5 | retry_design | mechanism="${design.transferMechanism.name}"`);
        // Re-judge once
        try {
          const judgePrompt2 = `${ttAnchorPrefix}${buildJudgePrompt(JSON.stringify(design, null, 2))}`;
          console.log(`[TrustTransfer] ANCHOR_EVIDENCE | engine=persuasion_trust_transfer | site=judge | attempt=2 | present=${ttAnchorPresent ? "yes" : "no"} | source=${ttAnchorSource}`);
          const judgeResp2 = await aiChat({
            model: MODEL,
            messages: [{ role: "user", content: judgePrompt2 }],
            temperature: 0.1,
            max_tokens: 400,
            endpoint: "persuasion-engine-trust-transfer-judge-retry",
            accountId: args.accountId,
          });
          const judgeRaw2 = judgeResp2.choices[0]?.message?.content?.trim() || "";
          const judgeParsed2 = safeJsonParse(judgeRaw2);
          if (judgeParsed2 && (judgeParsed2.verdict === "ACCEPTED" || judgeParsed2.verdict === "REJECTED")) {
            judgeVerdict = judgeParsed2.verdict;
            judgeReason = String(judgeParsed2.reason || "").trim();
          } else {
            judgeVerdict = "REJECTED";
            judgeReason = `JUDGE_ERROR: unparseable retry-judge output (raw="${judgeRaw2.slice(0, 80)}")`;
          }
        } catch (err: any) {
          judgeVerdict = "REJECTED";
          judgeReason = `JUDGE_ERROR: retry judge failed: ${err.message}`;
        }
      }
    } catch (err: any) {
      console.warn(`[TrustTransfer] RETRY_FAILED | ${err.message} | keeping v1`);
    }
  }

  design.judgeVerdict = judgeVerdict;
  design.judgeReason = judgeReason || undefined;

  console.log(`[TrustTransfer] DONE in ${Date.now() - startTs}ms | finalVerdict=${design.judgeVerdict} | retries=${design.retryCount}`);
  if (design.judgeVerdict === "REJECTED") {
    console.warn(`[TrustTransfer] FINAL_REJECTED — falling back to legacy persuasion output (no trustTransferDesign emitted)`);
    try {
      const { recordCommercialRejection } = await import("../../shared/commercial-dna");
      const reason = (design as any).judgeReason || "";
      const isJudgeErr = String(reason).startsWith("JUDGE_ERROR");
      recordCommercialRejection(args.accountId, {
        module: "persuasion.trustTransfer",
        reason: isJudgeErr ? "JUDGE_ERROR" : "FINAL_REJECTED",
        detail: String(reason),
      });
    } catch (regErr: any) {
      console.error(`[TrustTransfer] REGISTRY_WRITE_FAILED | ${regErr.message}`);
    }
    return null;
  }
  return design;
}
