import type { EngineId } from "../orchestrator/priority-matrix";

export function summarizeEngine(engineId: EngineId, output: any, status: string, blockReason?: string): string {
  if (status === "SKIPPED" || status === "BLOCKED") {
    return blockReason ? `Skipped — ${blockReason.split("|")[0].trim()}` : "Skipped";
  }
  if (status === "ERROR") return "Engine encountered an error";
  if (!output) return "No output produced";

  try {
    switch (engineId) {
      case "market_intelligence": {
        const competitors = output.competitors?.length || 0;
        const marketState = output.marketState || "analyzed";
        const saturation = output.angleSaturation !== undefined ? ` Saturation: ${output.angleSaturation}%.` : "";
        return `Found ${competitors} competitors. Market state: ${marketState}.${saturation}`;
      }
      case "audience": {
        const pains = output.painProfiles?.length || 0;
        const segments = output.audienceSegments?.length || 0;
        const topPain = output.painProfiles?.[0]?.canonicalPain || output.painProfiles?.[0]?.pain;
        return `${pains} pain profiles across ${segments} segments.${topPain ? ` Primary pain: ${topPain}.` : ""}`;
      }
      case "positioning": {
        const territories = output.territories?.length || 0;
        const primary = output.territories?.[0];
        const name = primary?.name;
        const enemy = output.enemyDefinition || primary?.enemyDefinition;
        return `${territories} territories mapped.${name ? ` Primary: "${name}".` : ""}${enemy ? ` Enemy: ${enemy}.` : ""}`;
      }
      case "differentiation": {
        const out = output.output || output;
        const pillars = out.pillars?.length || 0;
        const authority = out.authorityMode?.mode || (typeof out.authorityMode === "string" ? out.authorityMode : null);
        const names = ((out.pillars || []) as any[]).slice(0, 2).map((p: any) => p.name || p.pillarName).filter(Boolean);
        return `${pillars} differentiation pillars.${names.length ? ` Leading: ${names.join(", ")}.` : ""}${authority ? ` Authority mode: ${authority}.` : ""}`;
      }
      case "mechanism": {
        const out = output.output || output;
        const name = out.mechanismName;
        const type = out.mechanismType;
        return name ? `Mechanism: "${name}"${type ? ` (${type})` : ""}.` : "Mechanism defined.";
      }
      case "offer": {
        const out = output.output || output;
        const name = out.offerName;
        const outcome = out.coreOutcome;
        return name ? `Offer: "${name}".${outcome ? ` Core outcome: ${outcome}.` : ""}` : "Offer structured.";
      }
      case "awareness": {
        const out = output.output || output;
        const route = out.primaryRoute?.routeName || out.primaryRoute?.name;
        const confidence = out.confidenceScore;
        return `Awareness route: ${route || "defined"}.${confidence !== undefined ? ` Confidence: ${confidence}.` : ""}`;
      }
      case "funnel": {
        const out = output.output || output;
        const type = out.funnelType || out.funnelName;
        const stages = (out.stages || []).length;
        const trust = out.trustPathScore;
        return `Funnel${type ? `: ${type}` : " defined"}.${stages ? ` ${stages} stages.` : ""}${trust !== undefined ? ` Trust path score: ${trust}.` : ""}`;
      }
      case "persuasion": {
        const out = output.output || output;
        const mode = out.persuasionMode;
        const route = out.primaryRoute?.routeName || out.primaryRoute?.name;
        return `Persuasion mode: ${mode || "defined"}.${route ? ` Primary route: ${route}.` : ""}`;
      }
      case "integrity": {
        const out = output.output || output;
        const score = out.confidenceScore;
        const stable = out.stabilityResult?.stable;
        return `Integrity score: ${score !== undefined ? score : "checked"}.${stable !== undefined ? ` Stable: ${stable}.` : ""}`;
      }
      case "statistical_validation": {
        const out = output.output || output;
        const state = out.validationState;
        const confidence = out.claimConfidenceScore;
        return `Statistical validation: ${state || "complete"}.${confidence !== undefined ? ` Claim confidence: ${confidence}.` : ""}`;
      }
      case "budget_governor": {
        const out = output.output || output;
        const decision = out.decision;
        const budget = out.recommendedBudget || out.monthlyBudget;
        return `Budget decision: ${decision || "reviewed"}.${budget ? ` Recommended: $${budget}/mo.` : ""}`;
      }
      case "channel_selection": {
        const out = output.output || output;
        const primary = out.primaryChannel?.channelName || out.primaryChannel?.name;
        const secondary = out.secondaryChannel?.channelName || out.secondaryChannel?.name;
        const rejected = out.rejectedChannels?.length || 0;
        return `Primary channel: ${primary || "selected"}.${secondary ? ` Secondary: ${secondary}.` : ""}${rejected ? ` ${rejected} channels rejected.` : ""}`;
      }
      case "iteration": {
        const out = output.output || output;
        const hypotheses = out.nextTestHypotheses?.length || 0;
        const targets = out.optimizationTargets?.length || 0;
        return `${hypotheses} test hypotheses. ${targets} optimization targets.`;
      }
      case "retention": {
        const out = output.output || output;
        const loops = out.retentionLoops?.length || 0;
        const churn = out.churnRiskFlags?.length || 0;
        return `${loops} retention loops. ${churn} churn risk flags identified.`;
      }
      default:
        return "Completed.";
    }
  } catch {
    return "Output processed.";
  }
}
