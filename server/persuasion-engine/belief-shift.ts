import { aiChat } from "../ai-client";
import { generateWithRepair, LLMReliabilityError } from "../shared/llm-reliability/reliability-runner";
import type { JudgeResult } from "../shared/llm-reliability/types";

export interface CanonicalBeliefShift {
  currentBelief: string;
  desiredBelief: string;
  contradictionLogic?: string;
  sourceIds?: string[];
}

export interface BeliefShiftInput {
  laneTitle?: string;
  primaryPain?: string;
  corePains?: string[];
  segmentName?: string;
  segmentPains?: string[];
  objectionStatements: string[];
  sophisticationTier?: number | null;
  awarenessStage?: string;
  marketDiagnosis?: string | null;
  enemyDefinition?: string | null;
  productTruthFacts?: Array<{ id: string; capability?: string; text?: string }>;
  doctrineBlock?: string | null;
  accountId: string;
}

function buildBeliefShiftPrompt(input: BeliefShiftInput, judgeFeedback?: string): string {
  const painBlock = (input.corePains && input.corePains.length > 0 ? input.corePains : input.segmentPains || [])
    .slice(0, 5)
    .map((p, i) => `[PAIN${i + 1}] ${p}`)
    .join("\n") || `[PAIN1] ${input.primaryPain || "Manual workflow complexity"}`;

  const objBlock = (input.objectionStatements || []).slice(0, 6).map((o, i) => `[OBJ${i + 1}] ${o}`).join("\n") || "(none)";

  const ptBlock = (input.productTruthFacts || [])
    .slice(0, 15)
    .map(f => `- ${f.id}: ${f.text || f.capability}`)
    .join("\n") || "(none supplied)";

  const judgePreface = judgeFeedback
    ? `\n═══ PRIOR ATTEMPT WAS REJECTED ═══\nReason: ${judgeFeedback}\nFix the defect. Do NOT repeat generic or ungrounded claims.\n`
    : "";

  return `You are a Principal Persuasion & Belief-Architecture Strategist.
Your job is to design the canonical Belief Shift for the buyer in this specific strategic lane.

A belief shift is NOT a slogan. It is a precise transformation of the buyer's mental model:
- currentBelief: The flawed or limiting assumption the buyer holds today that keeps them stuck in manual/inefficient workflows or skeptical of solutions.
- desiredBelief: The new conviction they must adopt where our mechanism and approach becomes the obvious, necessary choice.
- contradictionLogic: The logical reason why their old approach fails and the new model succeeds.

${judgePreface}
═══ STRATEGIC LANE & AUDIENCE CONTEXT ═══
Lane: ${input.laneTitle || "Core Acquisition Lane"}
Target Segment: ${input.segmentName || "Target Operational Decision Makers"}
Pains:
${painBlock}
Objections:
${objBlock}
Sophistication Tier: ${input.sophisticationTier ?? 3} (1=naive, 5=burnt/skeptical)
Awareness Stage: ${input.awarenessStage || "problem_aware"}

═══ CANONICAL PRODUCT TRUTH (Strict Boundary) ═══
${ptBlock}

═══ HARD RULES ═══
1. currentBelief MUST be a non-empty, substantive statement of the buyer's current flawed assumption.
2. desiredBelief MUST be a non-empty, substantive statement of the required conviction.
3. PRODUCT TRUTH BOUNDARY:
   - desiredBelief and contradictionLogic MUST NOT claim features, human staffing, or operational guarantees outside the Product Truth above.
   - Specifically: Do NOT claim "a human-driven process over automation", "human studio musicians/composers", "phonetic pronunciation control", "specify name pronunciation", "permanent/lifetime cloud link hosting", or "automated billing/refund portals" unless explicitly stated in CANONICAL PRODUCT TRUTH.
   - Ground desiredBelief and contradictionLogic strictly in how the verified product workflow, customization steps, evaluation/preview mechanism, and delivery format stated in CANONICAL PRODUCT TRUTH resolve buyer skepticism.
4. COMPETITOR ATTRIBUTION BOUNDARY: Do NOT state or imply that our business had expired links or hidden fees; treat those as market/competitor experiences that make buyers cautious.
5. desiredBelief must be distinct and contradictory to currentBelief.
6. Return ONLY valid JSON.

Return JSON shape:
{
  "currentBelief": "<substantive current belief>",
  "desiredBelief": "<substantive desired belief>",
  "contradictionLogic": "<concise explanation of why the old approach fails>",
  "sourceIds": ["PAIN1", "OBJ1"]
}`;
}

function safeJsonParse(raw: string): any {
  if (!raw) return null;
  let cleaned = raw.trim();
  if (cleaned.startsWith("```json")) cleaned = cleaned.slice(7);
  else if (cleaned.startsWith("```")) cleaned = cleaned.slice(3);
  if (cleaned.endsWith("```")) cleaned = cleaned.slice(0, -3);
  cleaned = cleaned.trim();
  try { return JSON.parse(cleaned); } catch { /* fall through */ }
  const start = cleaned.indexOf("{");
  const end = cleaned.lastIndexOf("}");
  if (start >= 0 && end > start) {
    try { return JSON.parse(cleaned.slice(start, end + 1)); } catch { return null; }
  }
  return null;
}

export async function designBeliefShift(input: BeliefShiftInput): Promise<CanonicalBeliefShift> {
  const { result } = await generateWithRepair<BeliefShiftInput, CanonicalBeliefShift>({
    engineName: "PersuasionEngine",
    touchpointName: "persuasion_belief_shift",
    authoritativeInput: input,
    config: {
      maxAttempts: 2,
      temperature: 0.2,
      model: "gpt-4.1-mini",
    },
    generate: async (inp) => {
      const prompt = buildBeliefShiftPrompt(inp);
      const resp = await aiChat({
        messages: [{ role: "user", content: prompt }],
        model: "gpt-4.1-mini",
        temperature: 0.2,
        max_tokens: 800,
        accountId: inp.accountId,
      });
      const parsed = safeJsonParse(resp?.choices?.[0]?.message?.content || "");
      if (!parsed) throw new LLMReliabilityError("Unparseable belief shift output", "PARSING_FAILURE");
      return {
        currentBelief: parsed.currentBelief || "",
        desiredBelief: parsed.desiredBelief || "",
        contradictionLogic: parsed.contradictionLogic || "",
        sourceIds: Array.isArray(parsed.sourceIds) ? parsed.sourceIds : [],
      };
    },
    judge: async (inp, candidate): Promise<JudgeResult<CanonicalBeliefShift>> => {
      const cur = (candidate.currentBelief || "").trim();
      const des = (candidate.desiredBelief || "").trim();
      const logic = (candidate.contradictionLogic || "").trim();
      const combined = `${des} ${logic}`;
      const ptText = (inp.productTruthFacts || []).map(f => f.text || f.capability || "").join(" ").toLowerCase();

      if (!cur || cur.length < 15 || !des || des.length < 15) {
        return {
          valid: false,
          failureClass: "SEMANTIC_FAILURE",
          rejections: [{
            field: "coreBeliefTransformation",
            reason: `BELIEF_SHIFT_INCOMPLETE: currentBelief or desiredBelief is empty or too brief (cur=${cur.length}, des=${des.length})`,
          }],
        };
      }

      if (cur.toLowerCase() === des.toLowerCase()) {
        return {
          valid: false,
          failureClass: "SEMANTIC_FAILURE",
          rejections: [{
            field: "coreBeliefTransformation",
            reason: "BELIEF_SHIFT_INCOMPLETE: desiredBelief is identical to currentBelief",
          }],
        };
      }

      if (/refund|billing\s*dispute|automated\s*chargeback/i.test(des) && !ptText.includes("refund")) {
        return {
          valid: false,
          failureClass: "HALLUCINATION",
          rejections: [{
            field: "desiredBelief",
            reason: "PRODUCT_TRUTH_VIOLATION: desiredBelief claims billing/refund capability outside Product Truth",
          }],
        };
      }

      if (/\bhuman[- ]driven\b|\bhuman composer|\bhuman musician|\bover automation\b|\breplacing automation with human\b/i.test(combined) && !ptText.includes("human composer")) {
        return {
          valid: false,
          failureClass: "HALLUCINATION",
          rejections: [{
            field: "desiredBelief",
            reason: "PRODUCT_TRUTH_VIOLATION: desiredBelief or contradictionLogic claims a human-driven process over automation, which is not supported by Product Truth.",
          }],
        };
      }

      if (/\bphonetic\b|\bspecify name pronunciation\b|\bpronunciation guide\b|\blifetime access\b|\bpermanent link\b|\bpermanent access\b|\bnever generic\b/i.test(combined) && !ptText.includes("phonetic") && !ptText.includes("lifetime access")) {
        return {
          valid: false,
          failureClass: "HALLUCINATION",
          rejections: [{
            field: "desiredBelief",
            reason: "PRODUCT_TRUTH_VIOLATION: desiredBelief claims phonetic pronunciation input, lifetime/permanent link hosting, or unsupported absolutes not present in Product Truth. Ground strictly in verified Product Truth capabilities.",
          }],
        };
      }

      return { valid: true };
    },
    repair: async (inp, failedCandidate, rejections) => {
      const feedback = rejections.map(r => r.reason).join("; ");
      const prompt = buildBeliefShiftPrompt(inp, feedback);
      const resp = await aiChat({
        messages: [{ role: "user", content: prompt }],
        model: "gpt-4.1-mini",
        temperature: 0.1,
        max_tokens: 800,
        accountId: inp.accountId,
      });
      const parsed = safeJsonParse(resp?.choices?.[0]?.message?.content || "");
      if (!parsed) throw new LLMReliabilityError("Unparseable repaired belief shift output", "PARSING_FAILURE");
      return {
        currentBelief: parsed.currentBelief || "",
        desiredBelief: parsed.desiredBelief || "",
        contradictionLogic: parsed.contradictionLogic || "",
        sourceIds: Array.isArray(parsed.sourceIds) ? parsed.sourceIds : [],
      };
    },
  });

  return result;
}
