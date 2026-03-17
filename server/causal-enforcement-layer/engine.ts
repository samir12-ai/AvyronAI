import {
  CausalConstraintRule,
  ComplianceResult,
  ComplianceViolation,
  CELReport,
} from "./types";
import { AnalyticalPackage } from "../analytical-enrichment-layer/types";

const LOG_PREFIX = "[CEL]";

const celReportCache = new Map<string, { report: CELReport; storedAt: number }>();
const CEL_REPORT_TTL = 30 * 60 * 1000;

export function storeCELReport(campaignId: string, report: CELReport): void {
  celReportCache.set(campaignId, { report, storedAt: Date.now() });
  console.log(`${LOG_PREFIX} REPORT_STORED | campaign=${campaignId} | engines=${report.engineResults.length} | score=${report.overallScore}`);
}

export function getCachedCELReport(campaignId: string): CELReport | null {
  const entry = celReportCache.get(campaignId);
  if (!entry) return null;
  if (Date.now() - entry.storedAt > CEL_REPORT_TTL) {
    celReportCache.delete(campaignId);
    return null;
  }
  return entry.report;
}

const CAUSAL_CONSTRAINT_RULES: CausalConstraintRule[] = [
  {
    id: "TRUST_OPACITY_RULE",
    rootCausePattern: /trust|opaci|transparen|hidden|unclear|confus|deceiv|mislead|skeptic|credibil|believab/i,
    requiredAxisPatterns: [/transparen/i, /trust/i, /clarit/i, /predict/i, /proof/i, /honest/i, /verif/i, /accountab/i, /credib/i, /open/i],
    blockedAxisPatterns: [/^simplicity$/i, /^ease$/i, /^simplicity.and.ease$/i, /^convenience$/i],
    description: "When root cause involves trust/opacity/confusion, positioning must reflect transparency/trust/clarity — NOT generic simplicity",
  },
  {
    id: "VALUE_PERCEPTION_RULE",
    rootCausePattern: /roi|return.on.invest|value.percep|worth|justif|pay.*back|cost.*benefit|price.*value/i,
    requiredAxisPatterns: [/roi/i, /value/i, /return/i, /proof/i, /result/i, /outcome/i, /measur/i, /demonstra/i, /quantif/i],
    blockedAxisPatterns: [/^affordab/i, /^cheap/i, /^budget/i, /^low.cost$/i],
    description: "When root cause is value perception/ROI justification, positioning must reflect demonstrable value — NOT affordability",
  },
  {
    id: "MECHANISM_COMPREHENSION_RULE",
    rootCausePattern: /mechanism|understand.*how|comprehens|know.*work|process.*unclear|how.it.work/i,
    requiredAxisPatterns: [/mechanism/i, /how.*work/i, /process/i, /method/i, /system/i, /framework/i, /demonstra/i, /explain/i],
    blockedAxisPatterns: [/^simplicity$/i, /^easy$/i, /^simple$/i, /^simplicity.and.ease$/i],
    description: "When root cause is mechanism comprehension gap, positioning must explain HOW it works — NOT claim simplicity",
  },
  {
    id: "FEAR_RISK_RULE",
    rootCausePattern: /fear|risk|afraid|anxiet|uncertain|hesita|worried|concern.*fail|loss.avers/i,
    requiredAxisPatterns: [/guarantee/i, /risk/i, /safe/i, /protect/i, /secur/i, /assur/i, /certain/i, /confiden/i, /proven/i],
    blockedAxisPatterns: [/^generic/i, /^general/i],
    description: "When root cause involves fear/risk/uncertainty, positioning must address safety/guarantee/proof — NOT generic benefits",
  },
  {
    id: "IDENTITY_STATUS_RULE",
    rootCausePattern: /identit|status|belong|recogni|prestig|exclusiv|aspirat|self.image|perception/i,
    requiredAxisPatterns: [/identit/i, /status/i, /belong/i, /exclusiv/i, /community/i, /prestig/i, /transform/i, /elevat/i],
    blockedAxisPatterns: [/^productivity$/i, /^efficiency$/i],
    description: "When root cause is identity/status driven, positioning must address identity transformation — NOT productivity",
  },
  {
    id: "KNOWLEDGE_GAP_RULE",
    rootCausePattern: /knowledge.gap|don.*know|information|unaware|education|literacy|understand/i,
    requiredAxisPatterns: [/educat/i, /knowledge/i, /inform/i, /guid/i, /mentor/i, /teach/i, /learn/i, /framework/i, /clarit/i],
    blockedAxisPatterns: [/^simplicity$/i, /^easy$/i],
    description: "When root cause is knowledge gap, positioning must provide education/guidance — NOT simplicity claims",
  },
  {
    id: "OVERWHELM_COMPLEXITY_RULE",
    rootCausePattern: /overwhelm|too.many|information.overload|paralysis|decision.fatigue|complex.*option/i,
    requiredAxisPatterns: [/curat/i, /focus/i, /priorit/i, /structur/i, /step.*by.*step/i, /roadmap/i, /pathway/i, /system/i, /direct/i],
    blockedAxisPatterns: [],
    description: "When root cause is overwhelm/decision fatigue, positioning must offer structure/curation — a clear path forward",
  },
];

const GENERIC_FALLBACK_PATTERNS: RegExp[] = [
  /^simplicity$/i,
  /^simplicity.and.ease$/i,
  /^ease.of.use$/i,
  /^convenience$/i,
  /^quality$/i,
  /^value$/i,
  /^innovation$/i,
  /^transformation$/i,
  /^empowerment$/i,
  /^growth$/i,
  /^success$/i,
  /^results$/i,
  /^efficiency$/i,
  /^productivity$/i,
];

export function extractDominantCausalThemes(ael: AnalyticalPackage): {
  themes: string[];
  primaryTheme: string | null;
  rootCauseTexts: string[];
} {
  if (!ael || !ael.root_causes || ael.root_causes.length === 0) {
    return { themes: [], primaryTheme: null, rootCauseTexts: [] };
  }

  const rootCauseTexts = ael.root_causes.map(rc => rc.deepCause || rc.surfaceSignal || "");

  const barrierTexts = (ael.buying_barriers || []).map(bb => `${bb.barrier} ${bb.rootCause}`);
  const chainTexts = (ael.causal_chains || []).map(cc => `${cc.cause} ${cc.impact}`);
  const mechGapTexts = (ael.mechanism_gaps || []).map(mg => mg.whatUserDoesNotUnderstand || "");
  const trustGapTexts = (ael.trust_gaps || []).map(tg => `${tg.gap} ${tg.barrier}`);

  const allCausalText = [...rootCauseTexts, ...barrierTexts, ...chainTexts, ...mechGapTexts, ...trustGapTexts].join(" ").toLowerCase();

  const themeScores: Record<string, number> = {};

  for (const rule of CAUSAL_CONSTRAINT_RULES) {
    const matches = allCausalText.match(rule.rootCausePattern);
    if (matches) {
      themeScores[rule.id] = (themeScores[rule.id] || 0) + matches.length;
    }
  }

  const highPriorityRCs = ael.root_causes.filter(rc => rc.confidenceLevel === "high");
  for (const rc of highPriorityRCs) {
    const rcText = `${rc.deepCause} ${rc.causalReasoning}`.toLowerCase();
    for (const rule of CAUSAL_CONSTRAINT_RULES) {
      if (rule.rootCausePattern.test(rcText)) {
        themeScores[rule.id] = (themeScores[rule.id] || 0) + 3;
      }
    }
  }

  if (ael.priority_ranking && ael.priority_ranking.length > 0) {
    for (const pr of ael.priority_ranking.slice(0, 3)) {
      const prText = pr.insight.toLowerCase();
      for (const rule of CAUSAL_CONSTRAINT_RULES) {
        if (rule.rootCausePattern.test(prText)) {
          themeScores[rule.id] = (themeScores[rule.id] || 0) + (4 - (pr.rank || 3));
        }
      }
    }
  }

  const sortedThemes = Object.entries(themeScores)
    .sort(([, a], [, b]) => b - a)
    .map(([ruleId]) => ruleId);

  return {
    themes: sortedThemes,
    primaryTheme: sortedThemes[0] || null,
    rootCauseTexts,
  };
}

export function enforcePositioningCompliance(
  territories: Array<{
    name: string;
    contrastAxis: string;
    narrativeDirection: string;
    enemyDefinition: string;
    confidenceScore: number;
    stabilityNotes?: string[];
  }>,
  ael: AnalyticalPackage | null,
): ComplianceResult {
  const result: ComplianceResult = {
    engineId: "positioning",
    passed: true,
    score: 1.0,
    violations: [],
    appliedRules: [],
    rootCausesEvaluated: 0,
    enforcementLog: [],
  };

  if (!ael || !ael.root_causes || ael.root_causes.length === 0) {
    result.enforcementLog.push("NO_AEL: No analytical enrichment available — skipping enforcement");
    return result;
  }

  const { themes, primaryTheme, rootCauseTexts } = extractDominantCausalThemes(ael);
  result.rootCausesEvaluated = rootCauseTexts.length;
  result.enforcementLog.push(`THEMES: ${themes.join(", ")} | primary=${primaryTheme}`);

  if (themes.length === 0) {
    result.enforcementLog.push("NO_MATCHING_RULES: AEL root causes did not match any constraint rules");
    return result;
  }

  const activeRules = CAUSAL_CONSTRAINT_RULES.filter(r => themes.includes(r.id));
  result.appliedRules = activeRules.map(r => r.id);

  for (const territory of territories) {
    const outputText = `${territory.name} ${territory.contrastAxis} ${territory.narrativeDirection} ${territory.enemyDefinition}`.toLowerCase();

    for (const rule of activeRules) {
      const hasRequiredAlignment = rule.requiredAxisPatterns.some(p => p.test(outputText));

      const blockedMatch = rule.blockedAxisPatterns.find(p => {
        return p.test(territory.name) || p.test(territory.contrastAxis);
      });

      if (blockedMatch) {
        const violation: ComplianceViolation = {
          ruleId: rule.id,
          violationType: "blocked_pattern",
          severity: rule.id === primaryTheme ? "blocking" : "major",
          details: `Territory "${territory.name}" uses blocked pattern "${blockedMatch.source}" while rule ${rule.id} is active`,
          rootCause: rootCauseTexts.slice(0, 2).join("; "),
          engineOutput: `name="${territory.name}" axis="${territory.contrastAxis}"`,
          requiredDirection: rule.description,
        };
        result.violations.push(violation);
        result.enforcementLog.push(`VIOLATION [${rule.id}]: blocked pattern in territory "${territory.name}"`);
      }

      if (!hasRequiredAlignment && rule.id === primaryTheme) {
        const violation: ComplianceViolation = {
          ruleId: rule.id,
          violationType: "missing_alignment",
          severity: "major",
          details: `Territory "${territory.name}" does not reflect required causal theme "${rule.id}" — none of the required patterns found in output`,
          rootCause: rootCauseTexts.slice(0, 2).join("; "),
          engineOutput: `name="${territory.name}" direction="${territory.narrativeDirection}"`,
          requiredDirection: rule.description,
        };
        result.violations.push(violation);
        result.enforcementLog.push(`VIOLATION [${rule.id}]: missing alignment in territory "${territory.name}"`);
      }
    }

    const isGenericName = GENERIC_FALLBACK_PATTERNS.some(p => p.test(territory.name.trim()));
    const isGenericAxis = GENERIC_FALLBACK_PATTERNS.some(p => p.test(territory.contrastAxis.trim()));

    if (isGenericName || isGenericAxis) {
      const violation: ComplianceViolation = {
        ruleId: "GENERIC_FALLBACK_GUARD",
        violationType: "generic_fallback",
        severity: "major",
        details: `Territory uses generic fallback: name="${territory.name}" axis="${territory.contrastAxis}" — with deep AEL insights available, generic outputs are not acceptable`,
        rootCause: rootCauseTexts.slice(0, 2).join("; "),
        engineOutput: `name="${territory.name}" axis="${territory.contrastAxis}"`,
        requiredDirection: `Must derive positioning from AEL root causes: ${rootCauseTexts.slice(0, 3).join("; ")}`,
      };
      result.violations.push(violation);
      result.enforcementLog.push(`VIOLATION [GENERIC]: "${territory.name}" / "${territory.contrastAxis}" is a generic fallback`);
    }
  }

  const blockingViolations = result.violations.filter(v => v.severity === "blocking");
  const majorViolations = result.violations.filter(v => v.severity === "major");

  if (blockingViolations.length > 0) {
    result.passed = false;
    result.score = 0;
  } else if (majorViolations.length > 0) {
    result.score = Math.max(0, 1 - (majorViolations.length * 0.3));
    result.passed = result.score >= 0.4;
  }

  result.enforcementLog.push(`RESULT: passed=${result.passed} | score=${result.score.toFixed(2)} | violations=${result.violations.length} (blocking=${blockingViolations.length}, major=${majorViolations.length})`);

  return result;
}

export function enforceGenericEngineCompliance(
  engineId: string,
  outputTexts: string[],
  ael: AnalyticalPackage | null,
): ComplianceResult {
  const result: ComplianceResult = {
    engineId,
    passed: true,
    score: 1.0,
    violations: [],
    appliedRules: [],
    rootCausesEvaluated: 0,
    enforcementLog: [],
  };

  if (!ael || !ael.root_causes || ael.root_causes.length === 0) {
    result.enforcementLog.push("NO_AEL: Skipping enforcement");
    return result;
  }

  const { themes, primaryTheme, rootCauseTexts } = extractDominantCausalThemes(ael);
  result.rootCausesEvaluated = rootCauseTexts.length;
  result.appliedRules = themes;

  if (!primaryTheme || themes.length === 0) {
    result.enforcementLog.push("NO_MATCHING_RULES: No causal themes detected");
    return result;
  }

  const primaryRule = CAUSAL_CONSTRAINT_RULES.find(r => r.id === primaryTheme);
  if (!primaryRule) return result;

  const allOutput = outputTexts.join(" ").toLowerCase();
  const hasAnyAlignment = primaryRule.requiredAxisPatterns.some(p => p.test(allOutput));

  if (!hasAnyAlignment) {
    result.violations.push({
      ruleId: primaryRule.id,
      violationType: "missing_alignment",
      severity: "minor",
      details: `${engineId} output does not reflect dominant causal theme "${primaryRule.id}"`,
      rootCause: rootCauseTexts.slice(0, 2).join("; "),
      engineOutput: outputTexts[0]?.slice(0, 200) || "",
      requiredDirection: primaryRule.description,
    });
    result.score = 0.7;
    result.enforcementLog.push(`WARN: ${engineId} lacks alignment with primary causal theme`);
  }

  const genericHits = outputTexts.filter(t => GENERIC_FALLBACK_PATTERNS.some(p => p.test(t.trim())));
  if (genericHits.length > 0) {
    result.violations.push({
      ruleId: "GENERIC_FALLBACK_GUARD",
      violationType: "generic_fallback",
      severity: "minor",
      details: `${engineId} contains generic terms: ${genericHits.slice(0, 3).join(", ")}`,
      rootCause: rootCauseTexts.slice(0, 2).join("; "),
      engineOutput: genericHits.join(", "),
      requiredDirection: `Derive from AEL: ${rootCauseTexts[0] || ""}`,
    });
    result.score = Math.max(0, result.score - 0.1 * genericHits.length);
  }

  result.passed = result.score >= 0.4;
  result.enforcementLog.push(`RESULT: passed=${result.passed} | score=${result.score.toFixed(2)} | violations=${result.violations.length}`);

  return result;
}

export function buildCELReport(
  campaignId: string,
  aelVersion: number,
  engineResults: ComplianceResult[],
): CELReport {
  if (engineResults.length === 0) {
    return {
      timestamp: new Date().toISOString(),
      campaignId,
      aelVersion,
      engineResults: [],
      overallScore: 0,
      overallPassed: false,
      summary: "No engines audited — CEL requires engine outputs to evaluate compliance.",
    };
  }

  const totalScore = engineResults.reduce((sum, r) => sum + r.score, 0) / engineResults.length;
  const allPassed = engineResults.every(r => r.passed);

  const violationSummaries = engineResults
    .filter(r => r.violations.length > 0)
    .map(r => `${r.engineId}: ${r.violations.length} violations (${r.violations.map(v => v.violationType).join(", ")})`)
    .join("; ");

  return {
    timestamp: new Date().toISOString(),
    campaignId,
    aelVersion,
    engineResults,
    overallScore: Math.round(totalScore * 100) / 100,
    overallPassed: allPassed,
    summary: allPassed
      ? `All ${engineResults.length} engines passed causal compliance checks.`
      : `Causal compliance issues detected: ${violationSummaries}`,
  };
}

export function buildCausalDirectiveForPrompt(ael: AnalyticalPackage | null): string {
  if (!ael || !ael.root_causes || ael.root_causes.length === 0) return "";

  const { themes, primaryTheme, rootCauseTexts } = extractDominantCausalThemes(ael);
  if (!primaryTheme) return "";

  const primaryRule = CAUSAL_CONSTRAINT_RULES.find(r => r.id === primaryTheme);
  if (!primaryRule) return "";

  const topRootCauses = ael.root_causes
    .filter(rc => rc.confidenceLevel === "high" || rc.confidenceLevel === "medium")
    .slice(0, 3);

  const topBarriers = (ael.buying_barriers || []).slice(0, 3);

  const sections: string[] = [];
  sections.push("\n═══ CAUSAL ENFORCEMENT DIRECTIVE ═══");
  sections.push("MANDATORY: Your output MUST be causally derived from the root causes below.");
  sections.push("DO NOT use generic positioning. DO NOT default to simplicity/ease/value without causal justification.\n");

  sections.push(`PRIMARY CAUSAL THEME: ${primaryRule.description}`);

  if (topRootCauses.length > 0) {
    sections.push("\nROOT CAUSES (your output must address these):");
    for (const rc of topRootCauses) {
      sections.push(`  → Surface: "${rc.surfaceSignal}" | Reality: ${rc.deepCause}`);
    }
  }

  if (topBarriers.length > 0) {
    sections.push("\nBUYING BARRIERS (your output must resolve these):");
    for (const bb of topBarriers) {
      sections.push(`  → ${bb.barrier} — buyer thinks: "${bb.userThinking}"`);
    }
  }

  const blockedTerms = primaryRule.blockedAxisPatterns.map(p => p.source.replace(/[\\^$]/g, ""));
  if (blockedTerms.length > 0) {
    sections.push(`\nBLOCKED TERMS (DO NOT use these): ${blockedTerms.join(", ")}`);
  }

  sections.push("\n═══ END CAUSAL DIRECTIVE ═══\n");

  return sections.join("\n");
}

export function applyCompliancePenalties(
  territories: Array<{
    name: string;
    contrastAxis: string;
    narrativeDirection: string;
    enemyDefinition: string;
    confidenceScore: number;
    stabilityNotes?: string[];
  }>,
  compliance: ComplianceResult,
): void {
  if (compliance.passed && compliance.violations.length === 0) return;

  for (const violation of compliance.violations) {
    const territory = territories.find(t =>
      violation.engineOutput.includes(t.name) ||
      violation.details.includes(t.name)
    );

    if (territory) {
      if (violation.severity === "blocking") {
        territory.confidenceScore = 0;
      } else {
        const penalty = violation.severity === "major" ? 0.30 : 0.10;
        territory.confidenceScore = Math.max(0, territory.confidenceScore - penalty);
      }

      if (!territory.stabilityNotes) territory.stabilityNotes = [];
      territory.stabilityNotes.push(`[CEL-${violation.severity.toUpperCase()}] ${violation.details}`);

      const penaltyLabel = violation.severity === "blocking" ? "→0%" : violation.severity === "major" ? "-30%" : "-10%";
      console.log(`${LOG_PREFIX} PENALTY | territory="${territory.name}" | ${penaltyLabel} | rule=${violation.ruleId} | type=${violation.violationType}`);
    }
  }
}

export { CAUSAL_CONSTRAINT_RULES };
