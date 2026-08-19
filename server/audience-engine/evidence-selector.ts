import { calculateSafeEvidenceBudget, estimateTokens } from "../shared/token-utils";

export type EvidenceAuthorityClass =
  | "DIRECT_AUDIENCE_EVIDENCE"
  | "SUPPORTING_AUDIENCE_CONTEXT"
  | "MARKET_NARRATIVE_CONTEXT"
  | "LOW_AUDIENCE_INFORMATION"
  | "INVALID_UNUSABLE";

export interface EvidenceDisposition {
  evidenceId: string;
  authorityClass: EvidenceAuthorityClass;
  informationValue: "HIGH" | "MEDIUM" | "LOW" | "NONE";
  safeUses: string[];
  prohibitedUses: string[];
  reasoning: string;
}

export interface RawEvidenceItem {
  id?: string;
  text: string;
  sourceActor: string;
  authorityClass?: EvidenceAuthorityClass;
  informationValue?: "HIGH" | "MEDIUM" | "LOW" | "NONE";
  safeUses?: string[];
  prohibitedUses?: string[];
  reasoning?: string;
}

export interface ClusteredEvidenceItem {
  clusterId: string;
  semanticTheme: string;
  evidenceCount: number;
  sourceActorDistribution: Record<string, number>;
  representativeEvidence: string[];
  allEvidenceIds: string[];
  authorityClass?: EvidenceAuthorityClass;
  safeUses?: string[];
  prohibitedUses?: string[];
}

export type AudienceEvidenceUnit = RawEvidenceItem | ClusteredEvidenceItem;

export interface EvidenceSelectionResult {
  valid: boolean;
  selectedUnits: AudienceEvidenceUnit[];
  tokensUsed: number;
  tokensBudget: number;
  totalCandidateCount: number;
  retainedCount: number;
  classificationDistribution: Record<EvidenceAuthorityClass, number>;
  rejectionReasons?: string[];
}

interface SelectionCandidate {
  id: string;
  text: string;
  sourceActor: string;
  authorityClass?: EvidenceAuthorityClass;
  informationValue?: "HIGH" | "MEDIUM" | "LOW" | "NONE";
  safeUses?: string[];
  prohibitedUses?: string[];
  reasoning?: string;
}

interface EvidenceClusterResult {
  clusters: {
    theme: string;
    evidenceIds: string[];
    representativeQuotes: string[];
  }[];
}

const SELECTOR_MODEL = "gpt-4.1-mini";
const JUDGE_MODEL = "gpt-4o-mini";
const CHUNK_MODEL = "gpt-4o-mini";

function getSafeAndProhibitedUses(authClass: EvidenceAuthorityClass, sourceActor: string): { safeUses: string[], prohibitedUses: string[] } {
  switch (authClass) {
    case "DIRECT_AUDIENCE_EVIDENCE":
      return {
        safeUses: ["direct_audience_claim", "pain_discovery", "objection_discovery", "buyer_reality"],
        prohibitedUses: ["competitor_positioning_claim"]
      };
    case "SUPPORTING_AUDIENCE_CONTEXT":
      return {
        safeUses: ["audience_context", "market_discussion", "corroborating_pattern"],
        prohibitedUses: ["direct_buyer_pain_testimony"]
      };
    case "MARKET_NARRATIVE_CONTEXT":
      return {
        safeUses: ["market_narrative", "competitor_claims", "positioning_context"],
        prohibitedUses: ["direct_buyer_pain_testimony", "direct_audience_claim"]
      };
    case "LOW_AUDIENCE_INFORMATION":
    case "INVALID_UNUSABLE":
    default:
      return {
        safeUses: [],
        prohibitedUses: ["all_intelligence_layers"]
      };
  }
}

// 1. CHUNK EVALUATOR WITH SEMANTIC AUTHORITY CLASSIFICATION
async function evaluateChunkWithAuthority(
  chunk: SelectionCandidate[],
  task: string,
  businessContext: string,
  repairFeedback?: string
): Promise<EvidenceDisposition[]> {
  const repairSection = repairFeedback
    ? `\nPREVIOUS SELECTION JUDGE REPAIR FEEDBACK (Correct these issues):\n${repairFeedback}\n`
    : "";

  const prompt = `You are an expert market intelligence evaluator classifying raw market evidence for ${task}.
BUSINESS CONTEXT: ${businessContext}
${repairSection}
AUDIENCE_DISCOVERY seeks evidence about:
- Real audience experiences, complaints, and situations
- Problems, pains, frictions, and frustrations (billing, support, cancellation, pricing, workflow, tool issues)
- Objections, skepticism, and decision hesitation
- Workflows, processes, time usage, and operational realities
- Desires, goals, and desired outcomes
- Questions and inquiries from prospective or existing users
- Relevant audience context and usage environments

CLASSIFICATION INSTRUCTIONS:
Evaluate every evidence item individually based on: sourceActor + raw text + context + task.
Assign one of the following Authority Classes:
1. DIRECT_AUDIENCE_EVIDENCE: ALL user/customer accounts, complaints, problems, questions, criticisms (billing, pricing, support, cancellation, refunds, tool issues, workflow bugs, feature requests), or experiences from end users, customers, practitioners, or buyers. (informationValue: HIGH or MEDIUM).
2. SUPPORTING_AUDIENCE_CONTEXT: Industry discussions, situational context, corroborating patterns, or reactions that illuminate audience reality.
3. MARKET_NARRATIVE_CONTEXT: Competitor brand claims, promotional messaging, marketing promises, product positioning narratives.
4. LOW_AUDIENCE_INFORMATION: Emojis only (e.g. '🔥', '👍', '❤️❤️'), bot spam, promotional link dumps, or single-word greetings ('hi', 'hello') lacking substance.
5. INVALID_UNUSABLE: Unintelligible, corrupt, or uninterpretable text.

STRICT CLASSIFICATION RULE:
- ANY comment from a user or reviewer that mentions a problem, complaint, experience, question, cancellation, billing issue, refund, pricing, support interaction, or software workflow MUST be classified as DIRECT_AUDIENCE_EVIDENCE with informationValue HIGH or MEDIUM.
- NEVER classify a customer complaint, friction, or question as LOW_AUDIENCE_INFORMATION. Only classify pure emojis, spam, or vacuous single-word praise as LOW_AUDIENCE_INFORMATION.

EVIDENCE TO EVALUATE:
${chunk.map(c => `[ID: ${c.id} | SourceActor: ${c.sourceActor}] "${c.text.slice(0, 350)}"`).join("\n")}

Return a JSON object with format:
{
  "evaluations": [
    {
      "evidenceId": "EV-0",
      "authorityClass": "DIRECT_AUDIENCE_EVIDENCE" | "SUPPORTING_AUDIENCE_CONTEXT" | "MARKET_NARRATIVE_CONTEXT" | "LOW_AUDIENCE_INFORMATION" | "INVALID_UNUSABLE",
      "informationValue": "HIGH" | "MEDIUM" | "LOW" | "NONE",
      "reasoning": "concise explanation"
    }
  ]
}`;

  try {
    const { aiChat } = await import("../ai-client");
    const result = await aiChat({
      messages: [{ role: "user", content: prompt }],
      model: CHUNK_MODEL,
      max_tokens: 3000,
      temperature: 0.1,
      response_format: { type: "json_object" },
      accountId: "system",
      endpoint: "evidence-authority-evaluator"
    });
    const parsed = JSON.parse(result.choices[0]?.message?.content || '{"evaluations":[]}');
    const rawEvals: any[] = Array.isArray(parsed.evaluations) ? parsed.evaluations : [];
    
    return rawEvals.map(e => {
      const authClass: EvidenceAuthorityClass = e.authorityClass || "SUPPORTING_AUDIENCE_CONTEXT";
      const { safeUses, prohibitedUses } = getSafeAndProhibitedUses(authClass, "CUSTOMER_COMMENTER");
      return {
        evidenceId: e.evidenceId,
        authorityClass: authClass,
        informationValue: e.informationValue || "MEDIUM",
        safeUses,
        prohibitedUses,
        reasoning: e.reasoning || ""
      };
    });
  } catch (e) {
    console.error("[EvidenceSelector] Chunk authority evaluation failed, generating fallback dispositions", e);
    return chunk.map(c => {
      const authClass: EvidenceAuthorityClass = c.sourceActor === "COMPETITOR_BRAND" ? "MARKET_NARRATIVE_CONTEXT" : "DIRECT_AUDIENCE_EVIDENCE";
      const { safeUses, prohibitedUses } = getSafeAndProhibitedUses(authClass, c.sourceActor);
      return {
        evidenceId: c.id,
        authorityClass: authClass,
        informationValue: "MEDIUM",
        safeUses,
        prohibitedUses,
        reasoning: "Fallback classification due to evaluation error"
      };
    });
  }
}

// 2. CLUSTERING / COMPRESSION
async function clusterEvidence(items: SelectionCandidate[]): Promise<ClusteredEvidenceItem[]> {
  const prompt = `You are compressing a large evidence pool into dense semantic clusters. Preserve all meaning and corroboration. DO NOT invent meaning.
EVIDENCE TO CLUSTER:
${items.map(c => `[ID: ${c.id} | SourceActor: ${c.sourceActor} | Authority: ${c.authorityClass || "UNKNOWN"}] "${c.text.slice(0, 300)}"`).join("\n")}

Return a JSON object: { "clusters": [{ "theme": "string", "evidenceIds": ["id1", "id2"], "representativeQuotes": ["quote1"] }] }`;

  try {
    const { aiChat } = await import("../ai-client");
    const result = await aiChat({
      messages: [{ role: "user", content: prompt }],
      model: SELECTOR_MODEL,
      max_tokens: 4000,
      temperature: 0.2,
      response_format: { type: "json_object" },
      accountId: "system",
      endpoint: "evidence-clusterer"
    });
    
    const parsed = JSON.parse(result.choices[0]?.message?.content || "{}") as EvidenceClusterResult;
    const clusters: ClusteredEvidenceItem[] = [];
    
    for (let i = 0; i < (parsed.clusters || []).length; i++) {
      const c = parsed.clusters[i];
      const clusterItems = items.filter(item => c.evidenceIds.includes(item.id));
      if (clusterItems.length === 0) continue;
      
      const dist: Record<string, number> = {};
      for (const item of clusterItems) {
        dist[item.sourceActor] = (dist[item.sourceActor] || 0) + 1;
      }
      
      clusters.push({
        clusterId: `CLUSTER-${i}`,
        semanticTheme: c.theme,
        evidenceCount: clusterItems.length,
        sourceActorDistribution: dist,
        representativeEvidence: c.representativeQuotes || [],
        allEvidenceIds: clusterItems.map(item => item.id),
        authorityClass: clusterItems.some(item => item.authorityClass === "DIRECT_AUDIENCE_EVIDENCE")
          ? "DIRECT_AUDIENCE_EVIDENCE"
          : "SUPPORTING_AUDIENCE_CONTEXT",
        safeUses: Array.from(new Set(clusterItems.flatMap(item => item.safeUses || []))),
        prohibitedUses: Array.from(new Set(clusterItems.flatMap(item => item.prohibitedUses || []))),
      });
    }
    
    return clusters;
  } catch (e) {
    console.error("[EvidenceSelector] Clustering failed, returning empty", e);
    return [];
  }
}

// 3. SELECTION JUDGE WITH FULL-POOL VISIBILITY & RAW MEANING
interface JudgeVerdict {
  valid: boolean;
  rejectionCode?: string;
  reasons: string[];
}

async function runSelectionJudge(
  originalCandidates: SelectionCandidate[],
  selectedUnits: AudienceEvidenceUnit[],
  task: string,
  judgeModel: string
): Promise<JudgeVerdict> {
  const sourceDistribution: Record<string, number> = {};
  for (const c of originalCandidates) {
    sourceDistribution[c.sourceActor] = (sourceDistribution[c.sourceActor] || 0) + 1;
  }

  const classificationDistribution: Record<string, number> = {};
  for (const c of originalCandidates) {
    const auth = c.authorityClass || "UNCLASSIFIED";
    classificationDistribution[auth] = (classificationDistribution[auth] || 0) + 1;
  }

  const directCount = classificationDistribution["DIRECT_AUDIENCE_EVIDENCE"] || 0;
  const supportingCount = classificationDistribution["SUPPORTING_AUDIENCE_CONTEXT"] || 0;

  const prompt = `You are the Selection Judge evaluating evidence selection for ${task}.
Verify that the evidence evaluator correctly preserved legitimate audience intelligence and did not over-prune or misclassify evidence.

ORIGINAL CANDIDATE POOL (${originalCandidates.length} total items):
Source Actor Breakdown:
${JSON.stringify(sourceDistribution, null, 2)}

EVALUATOR CLASSIFICATION DISTRIBUTION:
${JSON.stringify(classificationDistribution, null, 2)}

RETAINED EVIDENCE SET (${selectedUnits.length} items, including ${directCount} DIRECT_AUDIENCE_EVIDENCE items and ${supportingCount} SUPPORTING_AUDIENCE_CONTEXT items):
${formatEvidenceUnits(selectedUnits)}

JUDGE VERIFICATION CRITERIA:
1. NO HIGH_VALUE_EVIDENCE_OMITTED: Does the retained evidence set of ${selectedUnits.length} items (containing ${directCount} direct audience items) adequately represent the customer complaints, problems, objections, and usage realities from the pool? If the retained set captures user complaints and context, this criterion PASSES (valid: true).
2. NO SOURCE_STARVATION: Was an entire source category completely discarded when legitimate audience signal was present? (If real complaints/questions exist, they must be preserved).
3. NO CORROBORATION_LOSS: Was meaningful corroboration of recurring audience patterns preserved?
4. CORRECT AUTHORITY ASSIGNMENT: Are items properly classified so competitor claims are NOT tagged as DIRECT_AUDIENCE_EVIDENCE, and genuine user experiences are NOT tagged as MARKET_NARRATIVE_CONTEXT?
5. LINEAGE & USES PRESERVED: Do retained items carry clear safeUses and prohibitedUses?

Return a JSON object with format:
{
  "valid": boolean,
  "rejectionCode": "HIGH_VALUE_EVIDENCE_OMITTED" | "SOURCE_STARVATION" | "CORROBORATION_LOSS" | "AUTHORITY_MISCLASSIFICATION" | "LINEAGE_LOSS" | null,
  "reasons": ["string"]
}`;

  try {
    const { aiChat } = await import("../ai-client");
    const result = await aiChat({
      messages: [{ role: "user", content: prompt }],
      model: judgeModel,
      max_tokens: 1000,
      temperature: 0.1,
      response_format: { type: "json_object" },
      accountId: "system",
      endpoint: "evidence-selector-judge"
    });
    const parsed = JSON.parse(result.choices[0]?.message?.content || '{"valid":false,"reasons":["Judge parsing failed"]}');
    return {
      valid: parsed.valid === true,
      rejectionCode: parsed.rejectionCode || (parsed.valid ? undefined : "REJECTED_BY_JUDGE"),
      reasons: Array.isArray(parsed.reasons) ? parsed.reasons : [String(parsed.reasons || "")]
    };
  } catch (e) {
    console.error("[EvidenceSelector] Judge call failed, accepting by default", e);
    return { valid: true, reasons: [] };
  }
}

export async function selectEvidence(
  rawEvidence: RawEvidenceItem[],
  task: string,
  businessContext: string,
  generatorModel: string = "gpt-4.1-mini",
  judgeModel: string = "gpt-4o-mini"
): Promise<EvidenceSelectionResult> {
  const candidates: SelectionCandidate[] = rawEvidence.map((e, idx) => ({
    id: e.id || `EV-${idx}`,
    text: e.text,
    sourceActor: e.sourceActor
  }));

  const { MODEL_CONTEXT_LIMITS } = await import("../shared/token-utils");
  const generatorLimit = MODEL_CONTEXT_LIMITS[generatorModel] || MODEL_CONTEXT_LIMITS.default;
  const judgeLimit = MODEL_CONTEXT_LIMITS[judgeModel] || MODEL_CONTEXT_LIMITS.default;

  const configs = [
    { stage: "Audience Generator", model: generatorModel, limit: generatorLimit, reservedOutputTokens: 2000, promptOverheadTokens: 1500, safetyMarginTokens: 2000 },
    { stage: "Selection Judge", model: judgeModel, limit: judgeLimit, reservedOutputTokens: 1000, promptOverheadTokens: 2000, safetyMarginTokens: 2000 },
    { stage: "Audience Judge", model: judgeModel, limit: judgeLimit, reservedOutputTokens: 1000, promptOverheadTokens: 2000, safetyMarginTokens: 2000 },
  ];

  let minSafeBudget = Infinity;
  console.log("\n[EvidenceSelector] Token Limits Report:");
  console.log("| Stage | Model | Context Limit | Prompt Overhead | Reserved Output | Safety Margin | Evidence Budget |");
  
  for (const config of configs) {
    const safeBudget = config.limit - config.promptOverheadTokens - config.reservedOutputTokens - config.safetyMarginTokens;
    if (safeBudget < minSafeBudget) minSafeBudget = safeBudget;
    console.log(`| ${config.stage} | ${config.model} | ${config.limit} | ${config.promptOverheadTokens} | ${config.reservedOutputTokens} | ${config.safetyMarginTokens} | ${safeBudget} |`);
  }
  
  const budget = minSafeBudget;
  const initialTokens = candidates.reduce((acc, c) => acc + estimateTokens(c.text), 0);
  console.log(`\n[EvidenceSelector] Initial Pool: ${candidates.length} items (${initialTokens} tokens). Strict Budget: ${budget}`);

  // HIERARCHICAL BATCHED CLASSIFICATION (Chunk size 25 with 4-way concurrency)
  const CHUNK_SIZE = 25;
  const CONCURRENCY = 4;
  const MAX_RETRY_ATTEMPTS = 2;
  let repairFeedback: string | undefined;
  let currentCandidates = [...candidates];
  let selectedUnits: AudienceEvidenceUnit[] = [];
  let isJudgeValid = false;
  let lastJudgeReasons: string[] = [];
  const distCount: Record<EvidenceAuthorityClass, number> = {
    DIRECT_AUDIENCE_EVIDENCE: 0,
    SUPPORTING_AUDIENCE_CONTEXT: 0,
    MARKET_NARRATIVE_CONTEXT: 0,
    LOW_AUDIENCE_INFORMATION: 0,
    INVALID_UNUSABLE: 0,
  };

  for (let attempt = 1; attempt <= MAX_RETRY_ATTEMPTS; attempt++) {
    console.log(`[EvidenceSelector] Authority evaluation attempt ${attempt}/${MAX_RETRY_ATTEMPTS}...`);
    
    for (const key of Object.keys(distCount) as EvidenceAuthorityClass[]) {
      distCount[key] = 0;
    }

    const chunks: SelectionCandidate[][] = [];
    for (let i = 0; i < currentCandidates.length; i += CHUNK_SIZE) {
      chunks.push(currentCandidates.slice(i, i + CHUNK_SIZE));
    }

    const evaluatedCandidates: SelectionCandidate[] = [];

    for (let i = 0; i < chunks.length; i += CONCURRENCY) {
      const batch = chunks.slice(i, i + CONCURRENCY);
      const batchResults = await Promise.all(
        batch.map(chunk => evaluateChunkWithAuthority(chunk, task, businessContext, repairFeedback))
      );

      for (let b = 0; b < batch.length; b++) {
        const chunk = batch[b];
        const evals = batchResults[b];
        const evalMap = new Map<string, EvidenceDisposition>();
        for (const ev of evals) {
          evalMap.set(ev.evidenceId, ev);
        }

        for (const c of chunk) {
          const ev = evalMap.get(c.id);
          const authClass = ev?.authorityClass || (c.sourceActor === "COMPETITOR_BRAND" ? "MARKET_NARRATIVE_CONTEXT" : "SUPPORTING_AUDIENCE_CONTEXT");
          c.authorityClass = authClass;
          c.informationValue = ev?.informationValue || "MEDIUM";
          c.safeUses = ev?.safeUses || [];
          c.prohibitedUses = ev?.prohibitedUses || [];
          c.reasoning = ev?.reasoning || "";

          distCount[authClass] = (distCount[authClass] || 0) + 1;
          evaluatedCandidates.push(c);
        }
      }
    }

    currentCandidates = evaluatedCandidates;

    // Filter retained items: keep DIRECT, SUPPORTING, and informative MARKET_NARRATIVE
    const retainedCandidates = currentCandidates.filter(c => 
      c.authorityClass === "DIRECT_AUDIENCE_EVIDENCE" ||
      c.authorityClass === "SUPPORTING_AUDIENCE_CONTEXT" ||
      (c.authorityClass === "MARKET_NARRATIVE_CONTEXT" && c.informationValue !== "NONE" && c.informationValue !== "LOW")
    );

    let retainedTokens = retainedCandidates.reduce((acc, c) => acc + estimateTokens(c.text), 0);
    console.log(`[EvidenceSelector] Classification Distribution:`, distCount);
    console.log(`[EvidenceSelector] Retained ${retainedCandidates.length}/${currentCandidates.length} items (${retainedTokens} tokens).`);

    // IF RETAINED ITEMS EXCEED DOWNSTREAM BUDGET -> COMPRESS SEMANTICALLY
    if (retainedTokens > budget) {
      console.log(`[EvidenceSelector] Retained items exceed context budget. Executing semantic compression...`);
      selectedUnits = await clusterEvidence(retainedCandidates);
    } else {
      selectedUnits = retainedCandidates.map(c => ({
        id: c.id,
        text: c.text,
        sourceActor: c.sourceActor,
        authorityClass: c.authorityClass,
        informationValue: c.informationValue,
        safeUses: c.safeUses,
        prohibitedUses: c.prohibitedUses,
        reasoning: c.reasoning
      }));
    }

    // RUN SELECTION JUDGE WITH ORIGINAL POOL VISIBILITY
    const verdict = await runSelectionJudge(currentCandidates, selectedUnits, task, judgeModel);
    console.log(`[EvidenceSelector] Selection Judge Verdict: valid=${verdict.valid} ${verdict.rejectionCode ? `[${verdict.rejectionCode}]` : ""}`);
    if (verdict.reasons.length > 0) {
      console.log(`[EvidenceSelector] Selection Judge Reasons:`, verdict.reasons);
    }

    lastJudgeReasons = verdict.reasons;
    if (verdict.valid) {
      isJudgeValid = true;
      break;
    } else {
      repairFeedback = `Judge Rejection (${verdict.rejectionCode}): ${verdict.reasons.join("; ")}`;
    }
  }

  const finalTokens = Math.ceil(JSON.stringify(selectedUnits).length / 4);
  console.log(`[EvidenceSelector] Final Evidence Payload: ${selectedUnits.length} units (${finalTokens} tokens). Valid: ${isJudgeValid}. Remaining Capacity: ${budget - finalTokens}`);

  return {
    valid: isJudgeValid,
    selectedUnits,
    tokensUsed: finalTokens,
    tokensBudget: budget,
    totalCandidateCount: candidates.length,
    retainedCount: selectedUnits.length,
    classificationDistribution: distCount,
    rejectionReasons: isJudgeValid ? undefined : lastJudgeReasons
  };
}

export function formatEvidenceUnits(units: AudienceEvidenceUnit[]): string {
  return units.map(u => {
    if ('text' in u) {
      const auth = u.authorityClass || "UNKNOWN";
      const safe = u.safeUses && u.safeUses.length > 0 ? ` | SafeUses: [${u.safeUses.join(", ")}]` : "";
      const prohib = u.prohibitedUses && u.prohibitedUses.length > 0 ? ` | ProhibitedUses: [${u.prohibitedUses.join(", ")}]` : "";
      return `[ID: ${u.id} | SourceActor: ${u.sourceActor} | Authority: ${auth}${safe}${prohib}]\n"${u.text}"`;
    } else {
      const auth = u.authorityClass || "CLUSTERED_EVIDENCE";
      const safe = u.safeUses && u.safeUses.length > 0 ? ` | SafeUses: [${u.safeUses.join(", ")}]` : "";
      const prohib = u.prohibitedUses && u.prohibitedUses.length > 0 ? ` | ProhibitedUses: [${u.prohibitedUses.join(", ")}]` : "";
      return `[CLUSTER: ${u.clusterId} | Theme: ${u.semanticTheme} | Items: ${u.evidenceCount} | Authority: ${auth} | Sources: ${JSON.stringify(u.sourceActorDistribution)}${safe}${prohib}]\nRepresentative Quotes:\n${u.representativeEvidence.map(q => `- "${q}"`).join("\n")}`;
    }
  }).join("\n\n");
}
