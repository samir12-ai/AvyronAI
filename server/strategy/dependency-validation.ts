import { ENGINE_VERSION as CHANNEL_VERSION } from "./channel-selection/constants";
import { ENGINE_VERSION as BUDGET_VERSION } from "./budget-governor/constants";

interface EngineVersionMap {
  [engineName: string]: number;
}

interface DependencyRule {
  engine: string;
  dependsOn: string[];
  minVersions: Record<string, number>;
}

const CURRENT_VERSIONS: EngineVersionMap = {
  "channel-selection": CHANNEL_VERSION,
  "budget-governor": BUDGET_VERSION,
};

const DEPENDENCY_RULES: DependencyRule[] = [
  {
    engine: "channel-selection",
    dependsOn: ["audience", "awareness", "persuasion", "offer", "budget-governor", "statistical-validation"],
    minVersions: {},
  },
  {
    engine: "budget-governor",
    dependsOn: ["offer", "funnel", "statistical-validation"],
    minVersions: {},
  },
];

export interface DependencyValidationResult {
  valid: boolean;
  engine: string;
  currentVersion: number;
  warnings: string[];
  mismatches: string[];
}

export function validateEngineDependencies(engineName: string): DependencyValidationResult {
  const currentVersion = CURRENT_VERSIONS[engineName] || 0;
  const rule = DEPENDENCY_RULES.find(r => r.engine === engineName);
  const warnings: string[] = [];
  const mismatches: string[] = [];

  if (!rule) {
    return { valid: true, engine: engineName, currentVersion, warnings: [], mismatches: [] };
  }

  for (const dep of rule.dependsOn) {
    const minVersion = rule.minVersions[dep];
    if (minVersion !== undefined) {
      const depVersion = CURRENT_VERSIONS[dep];
      if (depVersion !== undefined && depVersion < minVersion) {
        mismatches.push(`${engineName} v${currentVersion} requires ${dep} v${minVersion}+, but found v${depVersion}`);
      }
    }
  }

  if (mismatches.length > 0) {
    warnings.push(`Engine dependency validation failed: ${mismatches.length} mismatch(es) detected`);
  }

  return {
    valid: mismatches.length === 0,
    engine: engineName,
    currentVersion,
    warnings,
    mismatches,
  };
}

export function enforceEngineIsolation(sourceEngine: string, targetField: string, action: string): { allowed: boolean; reason: string } {
  const PROHIBITED_CROSS_ENGINE_WRITES: Record<string, string[]> = {
    "channel-selection": ["persuasion_output", "budget_risk_score", "strategic_conclusion", "offer_strength"],
    "budget-governor": ["risk_score_override", "strategic_conclusion", "channel_recommendation"],
    "offer-engine": ["funnel_design", "persuasion_mode", "channel_recommendation"],
    "funnel-engine": ["offer_redesign", "persuasion_framework", "budget_allocation"],
  };

  const prohibited = PROHIBITED_CROSS_ENGINE_WRITES[sourceEngine] || [];
  if (prohibited.includes(targetField)) {
    return {
      allowed: false,
      reason: `ISOLATION VIOLATION: ${sourceEngine} attempted to ${action} on "${targetField}" — only the Master Plan orchestration layer may reconcile cross-engine outputs`,
    };
  }

  return { allowed: true, reason: "No isolation rule violated" };
}

export function logDependencyCheck(engineName: string, result: DependencyValidationResult): void {
  if (result.valid) {
    console.log(`[DependencyValidation] ${engineName} v${result.currentVersion} — all dependencies valid`);
  } else {
    console.warn(`[DependencyValidation] ${engineName} v${result.currentVersion} — MISMATCHES: ${result.mismatches.join("; ")}`);
  }
}
