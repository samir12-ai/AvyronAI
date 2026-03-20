import type { EngineId } from "../orchestrator/priority-matrix";

function safeParseArr(v: any): any[] {
  try { const p = typeof v === "string" ? JSON.parse(v) : v; return Array.isArray(p) ? p : []; } catch { return []; }
}

function safeParseObj(v: any): any {
  try { return typeof v === "string" ? JSON.parse(v) : (v || null); } catch { return null; }
}

export function summarizeEngine(engineId: EngineId, output: any, status: string, blockReason?: string): string {
  if (status === "SKIPPED" || status === "BLOCKED") {
    return blockReason ? `Skipped — ${blockReason.split("|")[0].trim()}` : "Skipped";
  }
  if (status === "ERROR") return "Engine encountered an error";
  if (!output) return "No output produced";

  try {
    switch (engineId) {
      case "market_intelligence": {
        const out = output.output || output;
        const rawCompetitors = out.competitors || out.competitorData || out.competitor_data;
        const compArr = typeof rawCompetitors === "string" ? safeParseArr(rawCompetitors) : (Array.isArray(rawCompetitors) ? rawCompetitors : []);
        const competitors = compArr.length;
        const marketState = out.marketState || out.market_state || "analyzed";
        const saturation = out.angleSaturation !== undefined ? ` Saturation: ${out.angleSaturation}%.` : "";
        return `Found ${competitors} competitors. Market state: ${marketState}.${saturation}`;
      }
      case "audience": {
        const out = output.output || output;
        const rawPains = out.painProfiles || out.audiencePains;
        const painsArr = typeof rawPains === "string" ? safeParseArr(rawPains) : (Array.isArray(rawPains) ? rawPains : []);
        const pains = painsArr.length;
        const rawSegments = out.audienceSegments;
        const segArr = typeof rawSegments === "string" ? safeParseArr(rawSegments) : (Array.isArray(rawSegments) ? rawSegments : []);
        const segments = segArr.length;
        const topPain = painsArr[0]?.canonicalPain || painsArr[0]?.pain;
        return `${pains} pain profiles across ${segments} segments.${topPain ? ` Primary pain: ${topPain}.` : ""}`;
      }
      case "positioning": {
        const out = output.output || output;
        const rawTerritories = out.territories || out.positioningTerritories;
        const terrArr = typeof rawTerritories === "string" ? safeParseArr(rawTerritories) : (Array.isArray(rawTerritories) ? rawTerritories : []);
        const territories = terrArr.length;
        const primary = terrArr[0];
        const name = primary?.name || primary?.territoryName;
        const enemy = out.enemyDefinition || primary?.enemyDefinition;
        return `${territories} territories mapped.${name ? ` Primary: "${name}".` : ""}${enemy ? ` Enemy: ${enemy}.` : ""}`;
      }
      case "differentiation": {
        const out = output.output || output;
        const rawPillars = out.pillars || out.differentiationPillars;
        const pillarsArr = safeParseArr(rawPillars);
        const pillars = pillarsArr.length;
        const authority = out.authorityMode?.mode || (typeof out.authorityMode === "string" ? out.authorityMode : null);
        const names = pillarsArr.slice(0, 2).map((p: any) => p.name || p.pillarName).filter(Boolean);
        return `${pillars} differentiation pillars.${names.length ? ` Leading: ${names.join(", ")}.` : ""}${authority ? ` Authority mode: ${authority}.` : ""}`;
      }
      case "mechanism": {
        const out = output.output || output;
        const mech = out.primaryMechanism || out;
        const name = mech.mechanismName || out.mechanismName;
        const type = mech.mechanismType || out.mechanismType;
        return name ? `Mechanism: "${name}"${type ? ` (${type})` : ""}.` : "Mechanism defined.";
      }
      case "offer": {
        const out = output.output || output;
        const ofr = out.primaryOffer || out;
        const name = ofr.offerName || out.offerName;
        const outcome = ofr.coreOutcome || out.coreOutcome;
        return name ? `Offer: "${name}".${outcome ? ` Core outcome: ${outcome}.` : ""}` : "Offer structured.";
      }
      case "awareness": {
        const out = output.output || output;
        const route = out.primaryRoute || out;
        const routeName = route.routeName || route.name || out.routeName;
        const confidence = out.confidenceScore ?? out.awarenessStrengthScore;
        return `Awareness route: ${routeName || "defined"}.${confidence !== undefined ? ` Confidence: ${confidence}.` : ""}`;
      }
      case "funnel": {
        const out = output.output || output;
        const fnl = out.primaryFunnel || out;
        const type = fnl.funnelType || fnl.funnelName || out.funnelType || out.funnelName;
        const rawStages = fnl.stageMap || fnl.stages || out.stages;
        const stagesArr = safeParseArr(rawStages);
        const stages = stagesArr.length;
        const trust = out.trustPathScore ?? fnl.trustPathScore;
        return `Funnel${type ? `: ${type}` : " defined"}.${stages ? ` ${stages} stages.` : ""}${trust !== undefined ? ` Trust path score: ${trust}.` : ""}`;
      }
      case "persuasion": {
        const out = output.output || output;
        const route = out.primaryRoute || out;
        const mode = route.persuasionMode || out.persuasionMode;
        const routeName = route.routeName || route.name;
        return `Persuasion mode: ${mode || "defined"}.${routeName ? ` Primary route: ${routeName}.` : ""}`;
      }
      case "integrity": {
        const out = output.output || output;
        const score = out.confidenceScore;
        const stab = safeParseObj(out.stabilityResult);
        const stable = stab?.stable ?? out.stabilityResult?.stable;
        return `Integrity score: ${score !== undefined ? score : "checked"}.${stable !== undefined ? ` Stable: ${stable}.` : ""}`;
      }
      case "statistical_validation": {
        const out = output.output || output;
        const snap = safeParseObj(out.snapshot);
        const result = snap?.result || out.result || out;
        const state = result.validationState || out.validationState || result.status;
        const confidence = result.claimConfidenceScore || out.claimConfidenceScore || result.confidenceScore;
        return `Statistical validation: ${state || "complete"}.${confidence !== undefined ? ` Claim confidence: ${confidence}.` : ""}`;
      }
      case "budget_governor": {
        const out = output.output || output;
        const snap = safeParseObj(out.snapshot);
        const result = snap?.result || out.result || out;
        const rawDecision = result.decision || out.decision;
        const decision = typeof rawDecision === "object" ? (rawDecision?.verdict || rawDecision?.status || "reviewed") : rawDecision;
        const budget = result.recommendedBudget || result.monthlyBudget || out.recommendedBudget || out.monthlyBudget;
        const testRange = result.testBudgetRange;
        const budgetStr = budget ? `$${budget}/mo` : (testRange ? `$${testRange.min}-$${testRange.max}/mo` : null);
        return `Budget decision: ${decision || "reviewed"}.${budgetStr ? ` Recommended: ${budgetStr}.` : ""}`;
      }
      case "channel_selection": {
        const out = output.output || output;
        const snap = safeParseObj(out.snapshot);
        const result = snap?.result || out.result || out;
        const primary = result.primaryChannel?.channelName || result.primaryChannel?.name || out.primaryChannel?.channelName || out.primaryChannel?.name;
        const secondary = result.secondaryChannel?.channelName || result.secondaryChannel?.name || out.secondaryChannel?.channelName || out.secondaryChannel?.name;
        const rejected = result.rejectedChannels?.length || out.rejectedChannels?.length || 0;
        return `Primary channel: ${primary || "selected"}.${secondary ? ` Secondary: ${secondary}.` : ""}${rejected ? ` ${rejected} channels rejected.` : ""}`;
      }
      case "iteration": {
        const out = output.output || output;
        const snap = safeParseObj(out.snapshot);
        const result = snap?.result || out.result || out;
        const hypotheses = result.nextTestHypotheses?.length || out.nextTestHypotheses?.length || 0;
        const targets = result.optimizationTargets?.length || out.optimizationTargets?.length || 0;
        return `${hypotheses} test hypotheses. ${targets} optimization targets.`;
      }
      case "retention": {
        const out = output.output || output;
        const snap = safeParseObj(out.snapshot);
        const result = snap?.result || out.result || out;
        const loops = result.retentionLoops?.length || out.retentionLoops?.length || 0;
        const churn = result.churnRiskFlags?.length || out.churnRiskFlags?.length || 0;
        return `${loops} retention loops. ${churn} churn risk flags identified.`;
      }
      default:
        return "Completed.";
    }
  } catch {
    return "Output processed.";
  }
}
