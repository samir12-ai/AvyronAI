import { aiChat } from "../ai-client";
import { db } from "../db";
import {
  positioningSnapshots,
  differentiationSnapshots,
  mechanismSnapshots,
  offerSnapshots,
  funnelSnapshots,
  awarenessSnapshots,
  persuasionSnapshots,
  audienceSnapshots,
  miSnapshots,
} from "@shared/schema";
import { eq, desc, and } from "drizzle-orm";

export interface BuildPlanOutput {
  positioning: string;
  differentiation: string;
  mechanism: { name: string; explanation: string };
  offer: string;
  funnel: { top: string; middle: string; bottom: string };
  contentDna: {
    weeklyStructure: { reels: number; carousels: number; stories: number };
    contentTypes: { problems: string; proof: string; education: string; conversion: string };
  };
  kpiRules: {
    postingFrequency: string;
    contentMix: string;
    conversionTargets: string;
  };
}

export interface BuildPlanResult {
  status: "SUCCESS" | "ACTIONABILITY_FAILED" | "INSUFFICIENT_DATA" | "ERROR";
  plan: BuildPlanOutput | null;
  actionabilityScore: number;
  failedBlocks: string[];
  attempts: number;
  error?: string;
}

interface EngineSnapshot {
  engineId: string;
  data: any;
  depthGateStatus?: string;
}

const ACTIONABILITY_RULES = [
  { name: "specificity", test: (v: string) => v.length > 20 && !/focus on|leverage|utilize|optimize/i.test(v) },
  { name: "clarity", test: (v: string) => !/\b(maybe|perhaps|could|might|possibly|consider)\b/i.test(v) },
  { name: "usability", test: (v: string) => !/\b(various|multiple|different|many|several|some)\b/i.test(v) || v.length > 50 },
];

function safeParseSnapshot(raw: any): any | null {
  try {
    if (typeof raw === "string") return JSON.parse(raw);
    return raw;
  } catch {
    return null;
  }
}

function enforceActionability(output: BuildPlanOutput): { passed: boolean; score: number; failedBlocks: string[] } {
  const blocks: Array<{ name: string; value: string }> = [
    { name: "positioning", value: output.positioning },
    { name: "differentiation", value: output.differentiation },
    { name: "mechanism", value: `${output.mechanism.name}: ${output.mechanism.explanation}` },
    { name: "offer", value: output.offer },
    { name: "funnel_top", value: output.funnel.top },
    { name: "funnel_middle", value: output.funnel.middle },
    { name: "funnel_bottom", value: output.funnel.bottom },
    { name: "contentDna_problems", value: output.contentDna.contentTypes.problems },
    { name: "contentDna_proof", value: output.contentDna.contentTypes.proof },
    { name: "contentDna_education", value: output.contentDna.contentTypes.education },
    { name: "contentDna_conversion", value: output.contentDna.contentTypes.conversion },
    { name: "kpi_frequency", value: output.kpiRules.postingFrequency },
    { name: "kpi_mix", value: output.kpiRules.contentMix },
    { name: "kpi_targets", value: output.kpiRules.conversionTargets },
  ];

  const failedBlocks: string[] = [];
  let passed = 0;

  for (const block of blocks) {
    const blockPassed = ACTIONABILITY_RULES.every(rule => rule.test(block.value));
    if (blockPassed) {
      passed++;
    } else {
      failedBlocks.push(block.name);
    }
  }

  const score = passed / blocks.length;
  return { passed: score >= 0.85, score, failedBlocks };
}

async function getLatestSnapshot(table: any, accountId: string, campaignId: string): Promise<any | null> {
  try {
    const [snap] = await db
      .select()
      .from(table)
      .where(and(eq(table.accountId, accountId), eq(table.campaignId, campaignId)))
      .orderBy(desc(table.createdAt))
      .limit(1);
    return snap || null;
  } catch {
    return null;
  }
}

async function collectValidatedEngineOutputs(
  accountId: string,
  campaignId: string,
  depthGateStatus?: Record<string, string>
): Promise<EngineSnapshot[]> {
  const snapshots: EngineSnapshot[] = [];

  const GATED_PASS_STATES = ["SIGNAL_PASSED", "DEPTH_PASSED"];

  const miSnap = await getLatestSnapshot(miSnapshots, accountId, campaignId);
  if (miSnap?.output) {
    const parsed = safeParseSnapshot(miSnap.output);
    if (parsed) snapshots.push({ engineId: "market_intelligence", data: parsed });
  }

  const audienceSnap = await getLatestSnapshot(audienceSnapshots, accountId, campaignId);
  if (audienceSnap?.output) {
    const parsed = safeParseSnapshot(audienceSnap.output);
    if (parsed) snapshots.push({ engineId: "audience", data: parsed });
  }

  const posSnap = await getLatestSnapshot(positioningSnapshots, accountId, campaignId);
  if (posSnap?.output) {
    const status = depthGateStatus?.positioning;
    if (!status || GATED_PASS_STATES.includes(status)) {
      const parsed = safeParseSnapshot(posSnap.output);
      if (parsed) snapshots.push({ engineId: "positioning", data: parsed, depthGateStatus: status });
    }
  }

  const diffSnap = await getLatestSnapshot(differentiationSnapshots, accountId, campaignId);
  if (diffSnap?.output) {
    const status = depthGateStatus?.differentiation;
    if (!status || GATED_PASS_STATES.includes(status)) {
      const parsed = safeParseSnapshot(diffSnap.output);
      if (parsed) snapshots.push({ engineId: "differentiation", data: parsed, depthGateStatus: status });
    }
  }

  const mechSnap = await getLatestSnapshot(mechanismSnapshots, accountId, campaignId);
  if (mechSnap?.output) {
    const status = depthGateStatus?.mechanism;
    if (!status || GATED_PASS_STATES.includes(status)) {
      const parsed = safeParseSnapshot(mechSnap.output);
      if (parsed) snapshots.push({ engineId: "mechanism", data: parsed, depthGateStatus: status });
    }
  }

  const offerSnap = await getLatestSnapshot(offerSnapshots, accountId, campaignId);
  if (offerSnap?.output) {
    const status = depthGateStatus?.offer;
    if (!status || GATED_PASS_STATES.includes(status)) {
      const parsed = safeParseSnapshot(offerSnap.output);
      if (parsed) snapshots.push({ engineId: "offer", data: parsed, depthGateStatus: status });
    }
  }

  const funnelSnap = await getLatestSnapshot(funnelSnapshots, accountId, campaignId);
  if (funnelSnap?.output) {
    const status = depthGateStatus?.funnel;
    if (!status || GATED_PASS_STATES.includes(status)) {
      const parsed = safeParseSnapshot(funnelSnap.output);
      if (parsed) snapshots.push({ engineId: "funnel", data: parsed, depthGateStatus: status });
    }
  }

  const awarenessSnap = await getLatestSnapshot(awarenessSnapshots, accountId, campaignId);
  if (awarenessSnap?.output) {
    const status = depthGateStatus?.awareness;
    if (!status || GATED_PASS_STATES.includes(status)) {
      const parsed = safeParseSnapshot(awarenessSnap.output);
      if (parsed) snapshots.push({ engineId: "awareness", data: parsed, depthGateStatus: status });
    }
  }

  const persuasionSnap = await getLatestSnapshot(persuasionSnapshots, accountId, campaignId);
  if (persuasionSnap?.output) {
    const status = depthGateStatus?.persuasion;
    if (!status || GATED_PASS_STATES.includes(status)) {
      const parsed = safeParseSnapshot(persuasionSnap.output);
      if (parsed) snapshots.push({ engineId: "persuasion", data: parsed, depthGateStatus: status });
    }
  }

  return snapshots;
}

function buildEngineContext(snapshots: EngineSnapshot[]): string {
  const parts: string[] = [];

  for (const snap of snapshots) {
    const data = snap.data;
    switch (snap.engineId) {
      case "market_intelligence": {
        const out = data.output || data;
        const competitors = (out.competitors || []).slice(0, 5).map((c: any) => c.name || c.handle || "unknown").join(", ");
        const signals = (out.signals || []).slice(0, 5).map((s: any) => s.text || s.signal || "").join("; ");
        parts.push(`[Market Intelligence] Competitors: ${competitors}. Key signals: ${signals}. Market state: ${out.marketState || "active"}`);
        break;
      }
      case "audience": {
        const pains = (data.painProfiles || []).slice(0, 3).map((p: any) => p.pain || p.label || "").join("; ");
        const desires = (data.desireMap || []).slice(0, 3).map((d: any) => d.desire || d.label || "").join("; ");
        const segments = (data.audienceSegments || []).slice(0, 2).map((s: any) => s.name || s.segment || "").join(", ");
        parts.push(`[Audience] Top pains: ${pains}. Top desires: ${desires}. Segments: ${segments}`);
        break;
      }
      case "positioning": {
        const out = data.output || data;
        const narrative = out.narrative || out.narrativeDirection || "";
        const territories = (out.territories || []).slice(0, 2).map((t: any) => t.name || t.territory || "").join(", ");
        parts.push(`[Positioning] Narrative: ${narrative}. Territories: ${territories}`);
        break;
      }
      case "differentiation": {
        const out = data.output || data;
        const claims = (out.validatedClaims || out.claimStructures || []).slice(0, 3).map((c: any) => c.claim || c.title || "").join("; ");
        const mode = out.authorityMode?.mode || out.authorityMode || "";
        parts.push(`[Differentiation] Claims: ${claims}. Authority mode: ${mode}`);
        break;
      }
      case "mechanism": {
        const out = data.output || data;
        const name = out.mechanismName || out.name || "";
        const explanation = out.mechanismExplanation || out.explanation || out.howItWorks || "";
        parts.push(`[Mechanism] Name: ${name}. Explanation: ${explanation}`);
        break;
      }
      case "offer": {
        const out = data.output || data;
        const headline = out.offerHeadline || out.headline || "";
        const value = out.primaryValueProp || out.valueProposition || "";
        parts.push(`[Offer] Headline: ${headline}. Value: ${value}`);
        break;
      }
      case "funnel": {
        const out = data.output || data;
        const stages = (out.stages || out.funnelStages || []).slice(0, 3).map((s: any) => `${s.name || s.stage}: ${s.objective || s.description || ""}`).join(" → ");
        parts.push(`[Funnel] ${stages}`);
        break;
      }
      case "awareness": {
        const out = data.output || data;
        const route = out.primaryRoute?.routeName || out.primaryRoute?.name || "";
        parts.push(`[Awareness] Primary route: ${route}`);
        break;
      }
      case "persuasion": {
        const out = data.output || data;
        const route = out.primaryRoute?.routeName || out.primaryRoute?.name || "";
        const alt = out.alternativeRoute?.routeName || "";
        parts.push(`[Persuasion] Primary: ${route}${alt ? `, Alternative: ${alt}` : ""}`);
        break;
      }
    }
  }

  return parts.join("\n");
}

function buildBuildPlanPrompt(engineContext: string, previousFailures?: string[]): string {
  let failureContext = "";
  if (previousFailures && previousFailures.length > 0) {
    failureContext = `\n\nPREVIOUS ATTEMPT FAILED ACTIONABILITY CHECK. These blocks were rejected for being vague/generic: ${previousFailures.join(", ")}.\nYou MUST make them more specific, concrete, and directly usable. No generic advice. Only clear, executable decisions.\n`;
  }

  return `You are a Decision Engine. Your ONLY job is to convert analysis into FINAL DECISIONS.

CRITICAL RULES:
- NO paragraphs, NO explanations, NO multiple options, NO diagnostics
- ONLY final, usable decisions
- Every output must be specific enough to execute IMMEDIATELY
- REJECT any urge to add context, caveats, or alternatives

ENGINE DATA:
${engineContext}
${failureContext}
Return EXACTLY this JSON structure:

{
  "positioning": "One specific sentence. Not generic. Example: 'The only AI tool that delivers clear reports in under 5 minutes' — NOT 'Focus on simplicity'",
  "differentiation": "One dominant angle as a single statement. Not a list. Must be concrete and provable.",
  "mechanism": {
    "name": "Clear name for the mechanism (2-4 words)",
    "explanation": "One-line explanation of how it works. Must be specific."
  },
  "offer": "Ready-to-use offer statement. Must include what they get, the outcome, and any constraint (time/price/guarantee).",
  "funnel": {
    "top": "Specific attention strategy with format and hook type",
    "middle": "Specific trust-building tactic with content type",
    "bottom": "Specific conversion action with CTA format"
  },
  "contentDna": {
    "weeklyStructure": { "reels": 3, "carousels": 2, "stories": 5 },
    "contentTypes": {
      "problems": "Exact description of problem content to create",
      "proof": "Exact description of proof content to create",
      "education": "Exact description of education content to create",
      "conversion": "Exact description of conversion content to create"
    }
  },
  "kpiRules": {
    "postingFrequency": "Exact schedule (e.g., '5 posts/week: Mon-Fri at 9am')",
    "contentMix": "Exact percentages (e.g., '40% education, 30% proof, 20% problem, 10% conversion')",
    "conversionTargets": "Specific numbers if available, or 'Baseline month — track engagement rate, profile visits, DM inquiries'"
  }
}

Return ONLY valid JSON. No markdown, no code blocks, no explanation.`;
}

function parseAIResponse(content: string): BuildPlanOutput | null {
  try {
    let cleaned = content.trim();
    if (cleaned.startsWith("```")) {
      cleaned = cleaned.replace(/^```(?:json)?\n?/, "").replace(/\n?```$/, "");
    }
    const parsed = JSON.parse(cleaned);

    if (!parsed.positioning || !parsed.differentiation || !parsed.mechanism || !parsed.offer || !parsed.funnel || !parsed.contentDna || !parsed.kpiRules) {
      return null;
    }

    return {
      positioning: String(parsed.positioning),
      differentiation: String(parsed.differentiation),
      mechanism: {
        name: String(parsed.mechanism?.name || ""),
        explanation: String(parsed.mechanism?.explanation || ""),
      },
      offer: String(parsed.offer),
      funnel: {
        top: String(parsed.funnel?.top || ""),
        middle: String(parsed.funnel?.middle || ""),
        bottom: String(parsed.funnel?.bottom || ""),
      },
      contentDna: {
        weeklyStructure: {
          reels: Number(parsed.contentDna?.weeklyStructure?.reels || 3),
          carousels: Number(parsed.contentDna?.weeklyStructure?.carousels || 2),
          stories: Number(parsed.contentDna?.weeklyStructure?.stories || 5),
        },
        contentTypes: {
          problems: String(parsed.contentDna?.contentTypes?.problems || ""),
          proof: String(parsed.contentDna?.contentTypes?.proof || ""),
          education: String(parsed.contentDna?.contentTypes?.education || ""),
          conversion: String(parsed.contentDna?.contentTypes?.conversion || ""),
        },
      },
      kpiRules: {
        postingFrequency: String(parsed.kpiRules?.postingFrequency || ""),
        contentMix: String(parsed.kpiRules?.contentMix || ""),
        conversionTargets: String(parsed.kpiRules?.conversionTargets || ""),
      },
    };
  } catch {
    return null;
  }
}

export async function runBuildPlanLayer(
  accountId: string,
  campaignId: string,
  depthGateStatus?: Record<string, string>
): Promise<BuildPlanResult> {
  const MAX_ATTEMPTS = 3;

  const snapshots = await collectValidatedEngineOutputs(accountId, campaignId, depthGateStatus);

  if (snapshots.length < 3) {
    return {
      status: "INSUFFICIENT_DATA",
      plan: null,
      actionabilityScore: 0,
      failedBlocks: [],
      attempts: 0,
      error: `Only ${snapshots.length} validated engine outputs available. Need at least 3.`,
    };
  }

  const engineContext = buildEngineContext(snapshots);
  let lastFailedBlocks: string[] = [];

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    try {
      const prompt = buildBuildPlanPrompt(engineContext, attempt > 1 ? lastFailedBlocks : undefined);

      const response = await aiChat({
        model: "gpt-4o",
        messages: [{ role: "user", content: prompt }],
        max_tokens: 1500,
        temperature: 0.3,
        accountId,
        endpoint: "build-plan-layer",
      });

      const content = response.choices?.[0]?.message?.content;
      if (!content) {
        console.warn(`[BuildPlanLayer] Attempt ${attempt}: Empty AI response`);
        continue;
      }

      const plan = parseAIResponse(content);
      if (!plan) {
        console.warn(`[BuildPlanLayer] Attempt ${attempt}: Failed to parse response`);
        continue;
      }

      const actionability = enforceActionability(plan);
      console.log(`[BuildPlanLayer] Attempt ${attempt}: actionability=${actionability.score.toFixed(2)}, passed=${actionability.passed}, failed=${actionability.failedBlocks.join(",")}`);

      if (actionability.passed) {
        return {
          status: "SUCCESS",
          plan,
          actionabilityScore: actionability.score,
          failedBlocks: [],
          attempts: attempt,
        };
      }

      lastFailedBlocks = actionability.failedBlocks;

      if (attempt === MAX_ATTEMPTS) {
        return {
          status: "ACTIONABILITY_FAILED",
          plan,
          actionabilityScore: actionability.score,
          failedBlocks: actionability.failedBlocks,
          attempts: attempt,
        };
      }
    } catch (err: any) {
      console.error(`[BuildPlanLayer] Attempt ${attempt} error:`, err.message);
      if (attempt === MAX_ATTEMPTS) {
        return {
          status: "ERROR",
          plan: null,
          actionabilityScore: 0,
          failedBlocks: [],
          attempts: attempt,
          error: err.message,
        };
      }
    }
  }

  return {
    status: "ERROR",
    plan: null,
    actionabilityScore: 0,
    failedBlocks: [],
    attempts: MAX_ATTEMPTS,
    error: "All attempts exhausted",
  };
}
