import { ENGINE_VERSION as CHANNEL_VERSION } from "./channel-selection/constants";
import { ENGINE_VERSION as BUDGET_VERSION } from "./budget-governor/constants";
import { ENGINE_VERSION as ITERATION_VERSION } from "./iteration-engine/constants";
import { ENGINE_VERSION as RETENTION_VERSION } from "./retention-engine/constants";

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
  "iteration-engine": ITERATION_VERSION,
  "retention-engine": RETENTION_VERSION,
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
  {
    engine: "iteration-engine",
    dependsOn: ["statistical-validation"],
    minVersions: {},
  },
  {
    engine: "retention-engine",
    dependsOn: [],
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
    "channel-selection": ["persuasion_output", "budget_risk_score", "strategic_conclusion", "offer_strength", "iteration_plan", "retention_loops"],
    "budget-governor": ["risk_score_override", "strategic_conclusion", "channel_recommendation", "funnel_stage_assignment", "iteration_plan", "retention_loops"],
    "iteration-engine": ["channel_recommendation", "funnel_stage_assignment", "budget_allocation", "retention_loops", "offer_strength", "persuasion_output"],
    "retention-engine": ["channel_recommendation", "funnel_stage_assignment", "budget_allocation", "iteration_plan", "offer_strength", "persuasion_output"],
    "offer-engine": ["funnel_design", "persuasion_mode", "channel_recommendation", "funnel_stage_assignment", "iteration_plan", "retention_loops"],
    "funnel-engine": ["offer_redesign", "persuasion_framework", "budget_allocation", "funnel_stage_assignment", "iteration_plan", "retention_loops"],
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

export interface SystemHealthReport {
  healthy: boolean;
  engines: Record<string, { version: number; dependenciesValid: boolean; mismatches: string[] }>;
  isolationRules: number;
  timestamp: string;
}

export function getSystemHealth(): SystemHealthReport {
  const engines: SystemHealthReport["engines"] = {};
  let allHealthy = true;

  for (const [engineName, version] of Object.entries(CURRENT_VERSIONS)) {
    const validation = validateEngineDependencies(engineName);
    engines[engineName] = {
      version,
      dependenciesValid: validation.valid,
      mismatches: validation.mismatches,
    };
    if (!validation.valid) allHealthy = false;
  }

  const PROHIBITED_CROSS_ENGINE_WRITES: Record<string, string[]> = {
    "channel-selection": ["persuasion_output", "budget_risk_score", "strategic_conclusion", "offer_strength", "iteration_plan", "retention_loops"],
    "budget-governor": ["risk_score_override", "strategic_conclusion", "channel_recommendation", "funnel_stage_assignment", "iteration_plan", "retention_loops"],
    "iteration-engine": ["channel_recommendation", "funnel_stage_assignment", "budget_allocation", "retention_loops", "offer_strength", "persuasion_output"],
    "retention-engine": ["channel_recommendation", "funnel_stage_assignment", "budget_allocation", "iteration_plan", "offer_strength", "persuasion_output"],
    "offer-engine": ["funnel_design", "persuasion_mode", "channel_recommendation", "funnel_stage_assignment", "iteration_plan", "retention_loops"],
    "funnel-engine": ["offer_redesign", "persuasion_framework", "budget_allocation", "funnel_stage_assignment", "iteration_plan", "retention_loops"],
  };

  let isolationRules = 0;
  for (const fields of Object.values(PROHIBITED_CROSS_ENGINE_WRITES)) {
    isolationRules += fields.length;
  }

  return {
    healthy: allHealthy,
    engines,
    isolationRules,
    timestamp: new Date().toISOString(),
  };
}

export function validateAllEngines(): { valid: boolean; results: DependencyValidationResult[] } {
  const results: DependencyValidationResult[] = [];
  for (const engineName of Object.keys(CURRENT_VERSIONS)) {
    const result = validateEngineDependencies(engineName);
    logDependencyCheck(engineName, result);
    results.push(result);
  }
  return {
    valid: results.every(r => r.valid),
    results,
  };
}

export function deduplicateWarnings(warnings: string[]): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const w of warnings) {
    const normalized = w
      .replace(/\d+(\.\d+)?%/g, "X%")
      .replace(/\$\d+(\.\d+)?/g, "$X")
      .replace(/\d+(\.\d+)?x/gi, "Xx")
      .replace(/v\d+/g, "vX")
      .trim();
    if (!seen.has(normalized)) {
      seen.add(normalized);
      result.push(w);
    }
  }
  return result;
}

export function deduplicateByField<T>(items: T[], field: keyof T): T[] {
  const seen = new Set<string>();
  const result: T[] = [];
  for (const item of items) {
    const key = String(item[field]).toLowerCase().trim();
    if (!seen.has(key)) {
      seen.add(key);
      result.push(item);
    }
  }
  return result;
}
