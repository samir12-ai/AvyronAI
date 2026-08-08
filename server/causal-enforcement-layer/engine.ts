import {
  CausalConstraintRule,
  ComplianceResult,
  ComplianceViolation,
  CELReport,
} from "./types";
import { AnalyticalPackage } from "../analytical-enrichment-layer/types";
import { cosineSimilarity, SEMANTIC_MATCH_THRESHOLD } from "../shared/embedding";
import {
  classifyClaims,
  buildClaimBreakdown,
  extractFactualClaims,
  ClaimBreakdown,
  ClassifiedClaim,
} from "./claim-classifier";

const LOG_PREFIX = "[CEL]";

// P1-4 (runtime-truth-isolation): bounded LRU cache. The previous Map was
// unbounded — any account could grow it indefinitely (one entry per
// (account, campaign) pair) until process OOM. The eviction policy is
// strict LRU on read+write with a hard size cap, and TTL is enforced on
// every read so stale entries never serve a live decision. The cache key
// remains `${accountId}:${campaignId}` (per-tenant); cross-run blending
// within a tenant is gated downstream by sourceJobId checks in
// classifyTrust + the build-plan-layer sourceJobId reads (P0-6).
const celReportCache = new Map<string, { report: CELReport; storedAt: number }>();
const CEL_REPORT_TTL = 30 * 60 * 1000;
const CEL_REPORT_MAX_ENTRIES = 500;

// Phase 6 / Task #69 step 8 — cache eviction telemetry. Counts size-cap and
// TTL evictions separately so an operator can detect (a) cache thrash (size
// evictions climbing fast on a small tenant set = key collision bug) and
// (b) stale-read avoidance (ttl evictions = healthy churn). Exposed via
// `_getCelCacheStats()` for /metrics integration.
const _celCacheEvictions = { size: 0, ttl: 0 };
export function _getCelCacheStats(): { size: number; ttl: number; entries: number; maxEntries: number; ttlMs: number } {
  return { size: _celCacheEvictions.size, ttl: _celCacheEvictions.ttl, entries: celReportCache.size, maxEntries: CEL_REPORT_MAX_ENTRIES, ttlMs: CEL_REPORT_TTL };
}

function celCacheTouch(key: string, value: { report: CELReport; storedAt: number }): void {
  // Re-insertion at the end of the Map = LRU touch (Map preserves
  // insertion order on iteration; the oldest key is the first one out).
  celReportCache.delete(key);
  celReportCache.set(key, value);
  while (celReportCache.size > CEL_REPORT_MAX_ENTRIES) {
    const oldest = celReportCache.keys().next().value;
    if (oldest === undefined) break;
    celReportCache.delete(oldest);
    _celCacheEvictions.size++;
    console.warn(`${LOG_PREFIX} CACHE_LRU_EVICT | key=${oldest} | reason=size_cap | totalSizeEvicts=${_celCacheEvictions.size}`);
  }
}

export function storeCELReport(campaignId: string, accountId: string, report: CELReport): void {
  const key = `${accountId}:${campaignId}`;
  celCacheTouch(key, { report, storedAt: Date.now() });
  console.log(`${LOG_PREFIX} REPORT_STORED | campaign=${campaignId} | account=${accountId} | engines=${report.engineResults.length} | score=${report.overallScore}`);
}

export function getCachedCELReport(campaignId: string, accountId: string): CELReport | null {
  const key = `${accountId}:${campaignId}`;
  const entry = celReportCache.get(key);
  if (!entry) return null;
  if (Date.now() - entry.storedAt > CEL_REPORT_TTL) {
    celReportCache.delete(key);
    _celCacheEvictions.ttl++;
    return null;
  }
  // LRU touch on read so hot keys survive eviction longer.
  celCacheTouch(key, entry);
  return entry.report;
}

/**
 * Per-rule pass thresholds.
 * Default raised from 0.4 → 0.6 (a "passed" engine must clear the majority of
 * its causal-compliance budget, not just survive minor violations).
 * "Critical" rules — those whose root-cause is named CAUSAL_CHAIN or
 * ROOT_CAUSE_GROUNDING in the engine taxonomy — require 0.75. The map keys
 * are matched against ComplianceResult.appliedRules entries.
 */
export const DEFAULT_CONSTRAINT_THRESHOLD = 0.6;
export const CONSTRAINT_THRESHOLDS: Record<string, number> = {
  TRUST_OPACITY_RULE: 0.75,
  VALUE_PERCEPTION_RULE: 0.75,
  MECHANISM_COMPREHENSION_RULE: 0.75,
  FEAR_RISK_RULE: 0.75,
};
export function resolveConstraintThreshold(appliedRules: string[]): number {
  let max = DEFAULT_CONSTRAINT_THRESHOLD;
  for (const id of appliedRules) {
    const t = CONSTRAINT_THRESHOLDS[id];
    if (typeof t === "number" && t > max) max = t;
  }
  return max;
}

const CAUSAL_CONSTRAINT_RULES: CausalConstraintRule[] = [
  {
    id: "TRUST_OPACITY_RULE",
    rootCausePattern: /trust|opaci|transparen|hidden|unclear|confus|deceiv|mislead|skeptic|credibil|believab/i,
    requiredAxisPatterns: [/transparen/i, /trust/i, /clarit/i, /predict/i, /proof/i, /honest/i, /verif/i, /accountab/i, /credib/i, /open/i, /evidence/i],
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
    // evaluate causal compliance at all; the gate must treat this as a hard
    // fail so downstream callers don't get a green light from a non-evaluation.
    result.passed = false;
    result.score = 0;
    result.verdict = "INCOMPLETE";
    result.reason = "AEL_MISSING";
    result.enforcementLog.push("NO_AEL: No analytical enrichment available — verdict=INCOMPLETE (cannot evaluate)");
    return result;
  }

  // INCOMPLETE. A degraded enrichment package cannot ground positioning
  // territories' causal compliance any more than a missing one can.
  if (ael.isPartial === true) {
    result.passed = false;
    result.score = 0;
    result.verdict = "INCOMPLETE";
    result.reason = "AEL_PARTIAL";
    result.enforcementLog.push(`AEL_PARTIAL: ${ael.partialReason || "partial enrichment"} — verdict=INCOMPLETE (positioning cannot be grounded on degraded AEL)`);
    return result;
  }

  const { themes, primaryTheme, rootCauseTexts } = extractDominantCausalThemes(ael);
  result.rootCausesEvaluated = rootCauseTexts.length;
  result.enforcementLog.push(`THEMES: ${themes.join(", ")} | primary=${primaryTheme}`);

  if (themes.length === 0) {
    // either way. Mark INCOMPLETE so plan synthesis knows compliance was
    // not actually verified.
    result.passed = false;
    result.score = 0;
    result.verdict = "INCOMPLETE";
    result.enforcementLog.push("NO_MATCHING_RULES: AEL root causes did not match any constraint rules — verdict=INCOMPLETE");
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
    result.verdict = "FAIL";
    result.reason = blockingViolations[0].violationType;
  } else if (majorViolations.length > 0) {
    // value (default 0.6, critical themes 0.75). Raw score compared, no
    // pre-rounding (F3.9).
    result.score = Math.max(0, 1 - (majorViolations.length * 0.3));
    const threshold = resolveConstraintThreshold(result.appliedRules);
    result.passed = result.score >= threshold;
    result.verdict = result.passed ? "PASS" : "FAIL";
    result.reason = result.passed ? "OK" : majorViolations[0].violationType;
  } else {
    result.verdict = "PASS";
    result.reason = "OK";
  }

  result.enforcementLog.push(`RESULT: passed=${result.passed} | verdict=${result.verdict} | score=${result.score.toFixed(2)} | threshold=${resolveConstraintThreshold(result.appliedRules).toFixed(2)} | violations=${result.violations.length} (blocking=${blockingViolations.length}, major=${majorViolations.length})`);

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
    result.passed = false;
    result.score = 0;
    result.verdict = "INCOMPLETE";
    result.reason = "AEL_MISSING";
    result.enforcementLog.push(`NO_AEL: ${engineId} cannot be evaluated — verdict=INCOMPLETE`);
    return result;
  }

  if (ael.isPartial === true) {
    result.passed = false;
    result.score = 0;
    result.verdict = "INCOMPLETE";
    result.reason = "AEL_PARTIAL";
    result.enforcementLog.push(`AEL_PARTIAL: ${engineId} — ${ael.partialReason || "partial enrichment"} — verdict=INCOMPLETE`);
    return result;
  }

  const { themes, primaryTheme, rootCauseTexts } = extractDominantCausalThemes(ael);
  result.rootCausesEvaluated = rootCauseTexts.length;
  result.appliedRules = themes;

  if (!primaryTheme || themes.length === 0) {
    result.passed = false;
    result.score = 0;
    result.verdict = "INCOMPLETE";
    result.reason = "NO_MATCHING_RULES";
    result.enforcementLog.push(`NO_MATCHING_RULES: ${engineId} — verdict=INCOMPLETE`);
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

  // value (default 0.6, critical themes 0.75). Raw score compared (F3.9).
  const threshold = resolveConstraintThreshold(result.appliedRules);
  result.passed = result.score >= threshold;
  result.verdict = result.passed ? "PASS" : "FAIL";
  result.reason = result.passed
    ? "OK"
    : (result.violations[0]?.violationType || "BELOW_THRESHOLD");
  result.enforcementLog.push(`RESULT: passed=${result.passed} | verdict=${result.verdict} | score=${result.score.toFixed(2)} | threshold=${threshold.toFixed(2)} | violations=${result.violations.length}`);

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

const SHALLOW_OUTPUT_PATTERNS: RegExp[] = [
  /\beveryone\b.*\bneeds\b/i,
  /\bunique\b.*\bapproach\b/i,
  /\bstand\s+out\b.*\bfrom\b.*\bcrowd\b/i,
  /\bnext\s+level\b/i,
  /\bgame\s*changer\b/i,
  /\bcutting\s*edge\b/i,
  /\bworld\s*class\b/i,
  /\bbest\s+in\s+class\b/i,
  /\bunparalleled\b/i,
  /\bseamless\b.*\bexperience\b/i,
  /\bholistic\b.*\bapproach\b/i,
  /\bone\s*stop\s*shop\b/i,
  /\btailored\b.*\bsolution\b/i,
  /\bcomprehensive\b.*\bsolution\b/i,
  /\bleverage\b.*\bpower\b/i,
  /\bunlock\b.*\bpotential\b/i,
];

export const DEPTH_GATE_THRESHOLD = 0.20;
export const DEPTH_GATE_MAX_RETRIES = 1;

export interface DepthGateResult {
  passed: boolean;
  blocked: boolean;
  attempt: number;
  maxAttempts: number;
  depthResult: DepthComplianceResult;
  regenerationLog: string[];
  status: "DEPTH_PASSED" | "DEPTH_FAILED" | "DEPTH_BLOCKED" | "DEPTH_SKIPPED";
  failureReason: string | null;
}

// marketing-claim language even when the classifier returns 0 counts.
// This closes the bypass where shallow / emotional copy that the classifier
// misclassified would have skipped the depth gate entirely.
const MARKETING_CLAIM_STRING_PATTERNS: RegExp[] = [
  /\b(best|fastest|easiest|cheapest|simplest|smartest|safest|strongest|leading|premium|world[- ]class|industry[- ]leading|cutting[- ]edge|state[- ]of[- ]the[- ]art|game[- ]chang(er|ing)|next[- ]gen(eration)?|revolutionary|breakthrough|unmatched|unrivaled|unparalleled|guaranteed|proven|trusted|effortless|seamless)\b/i,
  /\b(transform|unlock|empower|skyrocket|supercharge|elevate|maximi[sz]e|optimi[sz]e|10x|2x faster|10x faster)\b/i,
  /\b(more (sales|revenue|leads|customers|growth|impact|value|results)|drive (sales|revenue|leads|growth)|boost (sales|revenue|conversion|engagement))\b/i,
  /\b(in (just |only )?(\d+|a few|minutes|hours|days)|same[- ]day|overnight|instantly|on demand)\b/i,
  /\b(love it|you'?ll love|customers love|everyone loves)\b/i,
];

export function detectMarketingClaimStrings(outputTexts: string[]): { present: boolean; matchedPattern: string | null; sample: string | null } {
  for (const text of outputTexts) {
    if (!text) continue;
    for (const re of MARKETING_CLAIM_STRING_PATTERNS) {
      const m = re.exec(text);
      if (m) return { present: true, matchedPattern: re.source, sample: m[0] };
    }
  }
  // F3.7 closure: ANY non-empty marketing output text counts as a claim,
  // even when no regex keyword fires. The depth gate must not be bypassable
  // by a classifier false-negative on novel/unstyled copy.
  for (const text of outputTexts) {
    const trimmed = (text ?? "").trim();
    if (trimmed.length >= 8) {
      return {
        present: true,
        matchedPattern: "NON_EMPTY_OUTPUT_FALLBACK",
        sample: trimmed.slice(0, 80),
      };
    }
  }
  return { present: false, matchedPattern: null, sample: null };
}

export function isDepthBlocking(depthResult: DepthComplianceResult, sourceTexts?: string[]): boolean {
  // EITHER from classifier counts OR (pass-6) from string-presence scan over
  // the raw output sections. Pass-6 added the string-presence parallel trigger
  // because the classifier was missing copy that bypassed enforcement.
  const cb = depthResult.claimBreakdown || { factual: 0, inferred: 0, emotional: 0 };
  const hasClassifierClaim =
    (cb.factual ?? 0) > 0 ||
    (cb.inferred ?? 0) > 0 ||
    (cb.emotional ?? 0) > 0;
  const stringDetect = sourceTexts && sourceTexts.length > 0
    ? detectMarketingClaimStrings(sourceTexts)
    : { present: false, matchedPattern: null, sample: null };
  const hasAnyMarketingClaim = hasClassifierClaim || stringDetect.present;
  if (depthResult.causalDepthScore < DEPTH_GATE_THRESHOLD) {
    if (!hasAnyMarketingClaim) return false;
    if (!hasClassifierClaim && stringDetect.present) {
      console.log(`[CEL-DepthGate] STRING_PRESENCE_TRIGGER | classifierMiss | matched="${stringDetect.sample}" | pattern=${stringDetect.matchedPattern}`);
    }
    return true;
  }
  return false;
}

export function buildDepthRejectionDirective(
  depthResult: DepthComplianceResult,
  attempt: number,
  lockedDecisions?: string[],
): string {
  const lines: string[] = [
    `\n═══ DEPTH ENFORCEMENT REJECTION (Attempt ${attempt} FAILED — output was BLOCKED) ═══`,
    `Your previous output was REJECTED because it lacked causal depth.`,
    `Depth score: ${(depthResult.causalDepthScore * 100).toFixed(0)}% (minimum required: ${(DEPTH_GATE_THRESHOLD * 100).toFixed(0)}%)`,
    ``,
  ];

  if (!depthResult.depthDiagnostics.hasRootCauseGrounding) {
    lines.push(`❌ MISSING: Root cause grounding — your output did not reference any identified root causes.`);
    lines.push(`   You MUST use specific root causes from the AEL analysis in your output.`);
  }
  if (!depthResult.depthDiagnostics.hasCausalChainUsage) {
    lines.push(`❌ MISSING: Causal chain usage — your output did not reflect cause→impact→behavior chains.`);
    lines.push(`   You MUST explain WHY things work, not just WHAT they are.`);
  }
  if (!depthResult.depthDiagnostics.hasBarrierResolution) {
    lines.push(`❌ MISSING: Barrier resolution — your output did not address buying barriers.`);
  }
  if (depthResult.depthDiagnostics.genericTermCount > 0) {
    lines.push(`⚠️ GENERIC TERMS (${depthResult.depthDiagnostics.genericTermCount}): Replace all generic marketing language with causally-derived reasoning.`);
  }
  if (depthResult.depthDiagnostics.shallowPatternCount > 0) {
    lines.push(`⚠️ SHALLOW PATTERNS (${depthResult.depthDiagnostics.shallowPatternCount}): Remove marketing fluff — build everything from root causes.`);
  }

  for (const v of depthResult.violations) {
    lines.push(`   → ${v.severity.toUpperCase()}: ${v.details}`);
    if (v.requiredDirection) lines.push(`     FIX: ${v.requiredDirection}`);
    if (v.rootCause) lines.push(`     USE THESE VERBATIM ROOT CAUSES IN YOUR OUTPUT: "${v.rootCause}"`);
  }

  if (lockedDecisions && lockedDecisions.length > 0) {
    lines.push(``);
    lines.push(`🔒 POSITIONING LOCK VIOLATIONS — your regenerated output MUST comply with the following locked decisions:`);
    for (const decision of lockedDecisions) {
      const core = decision.replace(/^(contrast_axis|enemy|mechanism|narrative_direction):\s*/i, "").trim();
      lines.push(`   → YOU MUST NOT reframe or contradict: "${core}"`);
      lines.push(`     FIX: Ensure every claim, mechanism step, and outcome description stays within the locked positioning axis above.`);
    }
    lines.push(`   Ignoring the positioning lock will cause semantic drift from upstream Offer Engine contracts.`);
  }

  lines.push(``);
  lines.push(`YOU MUST FIX ALL ISSUES ABOVE. Your output will be rejected again if depth is insufficient.`);
  lines.push(`Every claim, step, and description MUST trace back to a specific root cause or causal chain from the AEL analysis.`);
  lines.push(`═══ END REJECTION DIRECTIVE ═══\n`);

  return lines.join("\n");
}

export function buildDepthGateResult(
  depthResult: DepthComplianceResult,
  attempt: number,
  maxAttempts: number,
  regenerationLog: string[],
  sourceTexts?: string[],
): DepthGateResult {
  const blocked = isDepthBlocking(depthResult, sourceTexts);
  return {
    passed: !blocked,
    blocked,
    attempt,
    maxAttempts,
    depthResult,
    regenerationLog,
    status: blocked
      ? (attempt >= maxAttempts ? "DEPTH_FAILED" : "DEPTH_BLOCKED")
      : "DEPTH_PASSED",
    failureReason: blocked
      ? `Depth score ${(depthResult.causalDepthScore * 100).toFixed(0)}% below gate threshold ${(DEPTH_GATE_THRESHOLD * 100).toFixed(0)}% — ${depthResult.violations.length} violations`
      : null,
  };
}

export interface DepthComplianceResult extends ComplianceResult {
  causalDepthScore: number;
  rootCauseReferences: number;
  causalChainReferences: number;
  barrierReferences: number;
  claimBreakdown: ClaimBreakdown;
  factualClaimCount: number;
  depthDiagnostics: {
    hasRootCauseGrounding: boolean;
    hasCausalChainUsage: boolean;
    hasBarrierResolution: boolean;
    hasBehavioralImpact: boolean;
    genericTermCount: number;
    shallowPatternCount: number;
  };
}

export function enforceEngineDepthCompliance(
  engineId: string,
  outputTexts: string[],
  ael: AnalyticalPackage | null,
  preClassifiedClaims?: ClassifiedClaim[],
): DepthComplianceResult {
  const allOutputRaw = outputTexts.join(" ");
  const classifiedClaims = preClassifiedClaims ?? classifyClaims(allOutputRaw);
  const claimBreakdown = buildClaimBreakdown(classifiedClaims);
  const factualOnlyTexts = extractFactualClaims(classifiedClaims);
  const factualOnlyOutput = factualOnlyTexts.length > 0 ? factualOnlyTexts.join(" ").toLowerCase() : "";

  const result: DepthComplianceResult = {
    engineId,
    passed: true,
    score: 1.0,
    violations: [],
    appliedRules: [],
    rootCausesEvaluated: 0,
    enforcementLog: [],
    causalDepthScore: 0,
    rootCauseReferences: 0,
    causalChainReferences: 0,
    barrierReferences: 0,
    claimBreakdown,
    factualClaimCount: claimBreakdown.factual,
    depthDiagnostics: {
      hasRootCauseGrounding: false,
      hasCausalChainUsage: false,
      hasBarrierResolution: false,
      hasBehavioralImpact: false,
      genericTermCount: 0,
      shallowPatternCount: 0,
    },
  };

  if (!ael || !ael.root_causes || ael.root_causes.length === 0) {
    result.enforcementLog.push("NO_AEL: No analytical enrichment — depth enforcement skipped");
    result.enforcementLog.push(`CLAIM_CLASSIFIER: factual=${claimBreakdown.factual} | inferred=${claimBreakdown.inferred} | emotional=${claimBreakdown.emotional}`);
    result.causalDepthScore = 0;
    return result;
  }

  const { themes, primaryTheme, rootCauseTexts } = extractDominantCausalThemes(ael);
  result.rootCausesEvaluated = rootCauseTexts.length;
  result.appliedRules = themes;

  result.enforcementLog.push(`CLAIM_CLASSIFIER: factual=${claimBreakdown.factual} | inferred=${claimBreakdown.inferred} | emotional=${claimBreakdown.emotional} | factual_sentences_for_depth_check=${factualOnlyTexts.length}`);

  const allOutput = allOutputRaw.toLowerCase();

  let genericTermCount = 0;
  for (const pattern of GENERIC_FALLBACK_PATTERNS) {
    const matches = allOutput.match(new RegExp(pattern.source, "gi"));
    if (matches) genericTermCount += matches.length;
  }
  result.depthDiagnostics.genericTermCount = genericTermCount;

  let shallowPatternCount = 0;
  for (const pattern of SHALLOW_OUTPUT_PATTERNS) {
    if (pattern.test(allOutput)) shallowPatternCount++;
  }
  result.depthDiagnostics.shallowPatternCount = shallowPatternCount;

  const hasFactualClaims = factualOnlyOutput.length > 0;
  const segmentsToCheck = outputTexts.filter(t => t && t.trim().length > 10).map(t => t.toLowerCase());

  let rootCauseRefCount = 0;
  for (const rc of ael.root_causes) {
    const rcText = `${rc.deepCause || ""} ${rc.surfaceSignal || ""} ${rc.causalReasoning || ""}`;
    let maxSim = cosineSimilarity(rcText, allOutput);
    for (const seg of segmentsToCheck) {
      const segSim = cosineSimilarity(rcText, seg);
      if (segSim > maxSim) maxSim = segSim;
    }
    if (maxSim >= SEMANTIC_MATCH_THRESHOLD) {
      rootCauseRefCount++;
    }
  }
  result.rootCauseReferences = rootCauseRefCount;
  result.depthDiagnostics.hasRootCauseGrounding = rootCauseRefCount > 0;

  let chainRefCount = 0;
  for (const chain of (ael.causal_chains || [])) {
    const chainText = `${chain.cause || ""} ${chain.impact || ""} ${chain.behavior || ""} ${chain.pain || ""}`;
    let maxSim = cosineSimilarity(chainText, allOutput);
    for (const seg of segmentsToCheck) {
      const segSim = cosineSimilarity(chainText, seg);
      if (segSim > maxSim) maxSim = segSim;
    }
    if (maxSim >= SEMANTIC_MATCH_THRESHOLD) {
      chainRefCount++;
    }
  }
  result.causalChainReferences = chainRefCount;
  result.depthDiagnostics.hasCausalChainUsage = chainRefCount > 0;

  let barrierRefCount = 0;
  for (const barrier of (ael.buying_barriers || [])) {
    const barrierText = `${barrier.barrier || ""} ${barrier.rootCause || ""} ${barrier.userThinking || ""} ${barrier.requiredResolution || ""}`;
    const sim = cosineSimilarity(barrierText, allOutput);
    if (sim >= SEMANTIC_MATCH_THRESHOLD) {
      barrierRefCount++;
    }
  }
  result.barrierReferences = barrierRefCount;
  result.depthDiagnostics.hasBarrierResolution = barrierRefCount > 0;

  const behaviorKeywords = [
    "because", "driven by", "root cause", "underlying", "fear of",
    "believe that", "thinking", "perceive", "assume", "hesitat",
    "reluctan", "worried", "concern", "barrier", "friction",
    "resist", "distrust", "skeptic", "uncertain",
  ];
  const behaviorHits = behaviorKeywords.filter(kw => allOutput.includes(kw)).length;
  result.depthDiagnostics.hasBehavioralImpact = behaviorHits >= 2;

  const depthComponents = [
    result.depthDiagnostics.hasRootCauseGrounding ? 0.30 : 0,
    result.depthDiagnostics.hasCausalChainUsage ? 0.25 : 0,
    result.depthDiagnostics.hasBarrierResolution ? 0.20 : 0,
    result.depthDiagnostics.hasBehavioralImpact ? 0.15 : 0,
    Math.max(0, 0.10 - (genericTermCount * 0.02) - (shallowPatternCount * 0.03)),
  ];
  // threshold compare in isDepthBlocking sees the actual score. Display
  // rounding happens at serialization time only.
  result.causalDepthScore = depthComponents.reduce((a, b) => a + b, 0);

  if (hasFactualClaims && !result.depthDiagnostics.hasRootCauseGrounding) {
    result.violations.push({
      ruleId: "DEPTH_ROOT_CAUSE",
      violationType: "missing_root_cause",
      severity: "blocking",
      details: `${engineId} factual claims do not reference any AEL root cause (${rootCauseTexts.length} available)`,
      rootCause: rootCauseTexts.slice(0, 2).join("; "),
      engineOutput: outputTexts[0]?.slice(0, 200) || "",
      requiredDirection: "Factual claims must be grounded in identified root causes, not surface patterns",
    });
  }

  if (hasFactualClaims && !result.depthDiagnostics.hasCausalChainUsage && (ael.causal_chains || []).length > 0) {
    result.violations.push({
      ruleId: "DEPTH_CAUSAL_CHAIN",
      violationType: "missing_causal_chain",
      severity: "blocking",
      details: `${engineId} factual claims do not reflect any causal chain (${(ael.causal_chains || []).length} chains available)`,
      rootCause: (ael.causal_chains || []).slice(0, 2).map(c => `${c.cause}→${c.impact}`).join("; "),
      engineOutput: outputTexts[0]?.slice(0, 200) || "",
      requiredDirection: "Factual claims must demonstrate WHY, not just WHAT — use causal chains",
    });
  }

  if (genericTermCount >= 3) {
    result.violations.push({
      ruleId: "DEPTH_GENERIC_BLOCK",
      violationType: "generic_without_justification",
      severity: genericTermCount >= 5 ? "blocking" : "major",
      details: `${engineId} uses ${genericTermCount} generic terms without causal justification`,
      rootCause: rootCauseTexts[0] || "",
      engineOutput: outputTexts[0]?.slice(0, 200) || "",
      requiredDirection: "Replace generic labels with causally-derived reasoning from AEL",
    });
  }

  if (shallowPatternCount >= 2) {
    result.violations.push({
      ruleId: "DEPTH_SHALLOW_PATTERN",
      violationType: "shallow_reasoning",
      severity: "major",
      details: `${engineId} contains ${shallowPatternCount} shallow marketing patterns`,
      rootCause: rootCauseTexts[0] || "",
      engineOutput: "",
      requiredDirection: "Remove marketing fluff — build from root causes and behavioral impact",
    });
  }

  if (primaryTheme) {
    const primaryRule = CAUSAL_CONSTRAINT_RULES.find(r => r.id === primaryTheme);
    if (primaryRule) {
      const hasAlignment = primaryRule.requiredAxisPatterns.some(p => p.test(allOutput));
      if (!hasAlignment) {
        result.violations.push({
          ruleId: primaryRule.id,
          violationType: "theme_misalignment",
          severity: "minor",
          details: `${engineId} does not address dominant causal theme: ${primaryRule.description}`,
          rootCause: rootCauseTexts.slice(0, 2).join("; "),
          engineOutput: outputTexts[0]?.slice(0, 200) || "",
          requiredDirection: primaryRule.description,
        });
      }
    }
  }

  // Reconcile individual component violations with the overall depth-gate decision.
  // When overall causalDepthScore is at/above the gate threshold, the engine has
  // demonstrated sufficient causal depth via OTHER components even if one specific
  // component (e.g., causal_chain or root_cause) did not semantically match.
  // Treat those component-level "missing X" violations as MAJOR rather than
  // BLOCKING, so they still penalize confidence but do not veto an output that
  // passes the gate. This aligns passed/blocked decisions across the two layers
  // that previously disagreed (isDepthBlocking used depthScore, result.passed
  // used blocking-count).
  if (result.causalDepthScore >= DEPTH_GATE_THRESHOLD) {
    for (const v of result.violations) {
      if (
        v.severity === "blocking" &&
        (v.violationType === "missing_root_cause" || v.violationType === "missing_causal_chain")
      ) {
        v.severity = "major";
      }
    }
  }

  const blockingViolations = result.violations.filter(v => v.severity === "blocking");
  const majorViolations = result.violations.filter(v => v.severity === "major");
  const minorViolations = result.violations.filter(v => v.severity === "minor");

  if (blockingViolations.length > 0) {
    result.score = 0;
    result.passed = false;
  } else {
    result.score = Math.max(0, 1.0 - (majorViolations.length * 0.30) - (minorViolations.length * 0.10));
    result.passed = result.score >= 0.4;
  }

  result.enforcementLog.push(
    `DEPTH_CHECK: depthScore=${result.causalDepthScore} | rootCauseRefs=${rootCauseRefCount} | chainRefs=${chainRefCount} | barrierRefs=${barrierRefCount} | generic=${genericTermCount} | shallow=${shallowPatternCount}`,
  );
  result.enforcementLog.push(
    `RESULT: passed=${result.passed} | score=${result.score.toFixed(2)} | violations=${result.violations.length} (blocking=${blockingViolations.length}, major=${majorViolations.length}, minor=${minorViolations.length})`,
  );

  return result;
}

export function applyDepthPenalty(
  confidenceScore: number,
  depthResult: DepthComplianceResult,
): number {
  if (depthResult.passed && depthResult.violations.length === 0) return confidenceScore;

  let penalty = 0;
  for (const v of depthResult.violations) {
    if (v.severity === "blocking") return 0;
    penalty += v.severity === "major" ? 0.15 : 0.05;
  }

  if (depthResult.causalDepthScore < 0.3) {
    penalty += 0.10;
  }

  return Math.max(0, Math.round((confidenceScore - penalty) * 100) / 100);
}

export { CAUSAL_CONSTRAINT_RULES };

/**
 * Phase 3 fix — persist a per-engine ComplianceResult to `cel_reports`.
 *
 * The orchestrator calls `enforceGenericEngineCompliance` five times
 * per run (positioning, differentiation, offer, funnel, persuasion);
 * each call's result is used inline and then discarded. The narrative
 * layer + future audit tooling expects to read these from `cel_reports`,
 * which migration 033 created. This helper is the single write site;
 * called inline at each of the 5 sites in runOrchestrator.
 *
 * Idempotent: UNIQUE(account, campaign, job, engineId) so re-runs
 * UPSERT instead of stacking. Fail-loud-but-don't-block per Seal #15.
 */
export async function persistCELComplianceResult(args: {
  accountId: string;
  campaignId: string;
  jobId: string;
  result: ComplianceResult;
}): Promise<void> {
  const { accountId, campaignId, jobId, result } = args;
  if (!accountId || !campaignId || !jobId || !result?.engineId) {
    console.error(`${LOG_PREFIX} CEL_PERSIST_SKIPPED | missing required args | hasAccount=${!!accountId} hasCampaign=${!!campaignId} hasJob=${!!jobId} engineId=${result?.engineId || "missing"}`);
    return;
  }
  try {
    const { db } = await import("../db");
    const { sql } = await import("drizzle-orm");
    const id = `cel_${jobId}_${result.engineId}`;
    const verdict = result.verdict || (result.passed ? "PASS" : "FAIL");
    await db.execute(sql`
      INSERT INTO cel_reports (
        id, account_id, campaign_id, job_id, engine_id,
        passed, verdict, reason, score, root_causes_evaluated, report
      ) VALUES (
        ${id}, ${accountId}, ${campaignId}, ${jobId}, ${result.engineId},
        ${!!result.passed},
        ${verdict},
        ${result.reason || null},
        ${Number(result.score) || 0},
        ${Number(result.rootCausesEvaluated) || 0},
        ${JSON.stringify(result)}::jsonb
      )
      ON CONFLICT (account_id, campaign_id, job_id, engine_id) DO UPDATE SET
        passed = EXCLUDED.passed,
        verdict = EXCLUDED.verdict,
        reason = EXCLUDED.reason,
        score = EXCLUDED.score,
        root_causes_evaluated = EXCLUDED.root_causes_evaluated,
        report = EXCLUDED.report,
        created_at = now()
    `);
    console.log(`${LOG_PREFIX} CEL_PERSISTED | engine=${result.engineId} | verdict=${verdict} | score=${result.score} | violations=${result.violations?.length || 0} | campaign=${campaignId} | job=${jobId}`);
  } catch (err: any) {
    console.error(`${LOG_PREFIX} CEL_PERSIST_FAILED | engine=${result.engineId} | campaign=${campaignId} | job=${jobId} | err=${err?.message || err}`);
  }
}
