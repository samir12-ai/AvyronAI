/**
 * Strategy Authority Registry & Structural Dependency Graph
 * 
 * Constitutional Principle:
 * ONE STRATEGIC AUTHORITY -> ONE OWNING ENGINE -> ONE CANONICAL PERSISTED TABLE
 * Structural dependencies denote potential re-evaluation requirements ("MAY REQUIRE REEVALUATION"),
 * not hardcoded automatic regeneration cascades.
 */

import { StrategicAuthorityName } from "./contracts";

export interface StrategyAuthorityDefinition {
  authorityName: StrategicAuthorityName;
  ownerEngine: string;
  canonicalTable: string;
  upstreamDependencies: StrategicAuthorityName[];
  downstreamDependents: StrategicAuthorityName[];
  supportsTargetedRecompute: boolean;
  recomputeEntrypoint?: string;
  description: string;
}

export const STRATEGY_AUTHORITY_REGISTRY: Record<StrategicAuthorityName, StrategyAuthorityDefinition> = {
  BUSINESS_UNDERSTANDING: {
    authorityName: "BUSINESS_UNDERSTANDING",
    ownerEngine: "BusinessUnderstandingEngine",
    canonicalTable: "business_understanding_snapshots",
    upstreamDependencies: [],
    downstreamDependents: ["PRODUCT_ASSESSMENT", "TARGET_ASSESSMENT", "AUDIENCE"],
    supportsTargetedRecompute: true,
    recomputeEntrypoint: "server/business-understanding/index.ts",
    description: "Establishes canonical business identity, product truth facts, offering facts, and target understanding roles.",
  },
  PRODUCT_ASSESSMENT: {
    authorityName: "PRODUCT_ASSESSMENT",
    ownerEngine: "ProductAssessmentEngine",
    canonicalTable: "product_assessments",
    upstreamDependencies: ["BUSINESS_UNDERSTANDING"],
    downstreamDependents: ["STRATEGIC_PAIN_DECISION", "OFFER", "DIFFERENTIATION"],
    supportsTargetedRecompute: true,
    recomputeEntrypoint: "server/strategic-reasoning/product-assessment.ts",
    description: "Evaluates factual capability and product solution fit against market pains/opportunities without owning canonical Product Truth.",
  },
  TARGET_ASSESSMENT: {
    authorityName: "TARGET_ASSESSMENT",
    ownerEngine: "TargetAssessmentEngine",
    canonicalTable: "target_assessments",
    upstreamDependencies: ["BUSINESS_UNDERSTANDING"],
    downstreamDependents: ["STRATEGIC_PAIN_DECISION", "AUDIENCE"],
    supportsTargetedRecompute: true,
    recomputeEntrypoint: "server/strategic-reasoning/target-assessment.ts",
    description: "Evaluates target segment needs and problem coverage against canonical target roles without owning canonical Target Understanding.",
  },
  AUDIENCE: {
    authorityName: "AUDIENCE",
    ownerEngine: "AudienceEngine",
    canonicalTable: "audience_snapshots",
    upstreamDependencies: ["BUSINESS_UNDERSTANDING", "TARGET_ASSESSMENT"],
    downstreamDependents: ["STRATEGIC_PAIN_DECISION", "STRATEGIC_LANES", "POSITIONING", "AWARENESS", "FUNNEL", "PERSUASION"],
    supportsTargetedRecompute: true,
    recomputeEntrypoint: "server/audience-engine/index.ts",
    description: "Audience segments, pain profiles, emotional drivers, and market density",
  },
  STRATEGIC_PAIN_DECISION: {
    authorityName: "STRATEGIC_PAIN_DECISION",
    ownerEngine: "StrategicPainDecisionEngine",
    canonicalTable: "strategic_pain_decisions",
    upstreamDependencies: ["PRODUCT_ASSESSMENT", "TARGET_ASSESSMENT", "AUDIENCE"],
    downstreamDependents: ["STRATEGIC_LANES", "POSITIONING", "OFFER"],
    supportsTargetedRecompute: true,
    recomputeEntrypoint: "server/strategic-pain/index.ts",
    description: "Adjudicates core purchase vs supporting pains per segment based on independent assessments",
  },
  STRATEGIC_LANES: {
    authorityName: "STRATEGIC_LANES",
    ownerEngine: "StrategyRootEngine",
    canonicalTable: "strategy_roots",
    upstreamDependencies: ["AUDIENCE", "STRATEGIC_PAIN_DECISION"],
    downstreamDependents: ["POSITIONING", "DIFFERENTIATION", "MECHANISM", "OFFER", "AWARENESS", "FUNNEL", "PERSUASION"],
    supportsTargetedRecompute: true,
    recomputeEntrypoint: "server/shared/executable-lanes.ts",
    description: "Core executable marketing lanes connecting segment pains to messaging vectors",
  },
  POSITIONING: {
    authorityName: "POSITIONING",
    ownerEngine: "PositioningEngine",
    canonicalTable: "positioning_snapshots",
    upstreamDependencies: ["AUDIENCE", "STRATEGIC_LANES", "STRATEGIC_PAIN_DECISION"],
    downstreamDependents: ["DIFFERENTIATION", "MECHANISM", "OFFER", "STRATEGY_ROOT"],
    supportsTargetedRecompute: true,
    recomputeEntrypoint: "server/positioning-engine/index.ts",
    description: "Market territory, enemy definition, narrative direction, and contrast axis",
  },
  DIFFERENTIATION: {
    authorityName: "DIFFERENTIATION",
    ownerEngine: "DifferentiationEngine",
    canonicalTable: "differentiation_snapshots",
    upstreamDependencies: ["POSITIONING", "PRODUCT_ASSESSMENT", "STRATEGIC_LANES"],
    downstreamDependents: ["MECHANISM", "OFFER", "STRATEGY_ROOT"],
    supportsTargetedRecompute: true,
    recomputeEntrypoint: "server/differentiation-engine/index.ts",
    description: "Differentiation pillars, claim structures, proof architecture, and authority mode",
  },
  MECHANISM: {
    authorityName: "MECHANISM",
    ownerEngine: "MechanismEngine",
    canonicalTable: "mechanism_snapshots",
    upstreamDependencies: ["POSITIONING", "DIFFERENTIATION", "STRATEGIC_LANES"],
    downstreamDependents: ["OFFER", "PERSUASION", "STRATEGY_ROOT"],
    supportsTargetedRecompute: true,
    recomputeEntrypoint: "server/mechanism-engine/index.ts",
    description: "Unique named mechanism and functional operational proof vector",
  },
  OFFER: {
    authorityName: "OFFER",
    ownerEngine: "OfferEngine",
    canonicalTable: "offer_snapshots",
    upstreamDependencies: ["POSITIONING", "DIFFERENTIATION", "MECHANISM", "PRODUCT_ASSESSMENT", "STRATEGIC_LANES"],
    downstreamDependents: ["AWARENESS", "FUNNEL", "PERSUASION", "STRATEGY_ROOT"],
    supportsTargetedRecompute: true,
    recomputeEntrypoint: "server/offer-engine/index.ts",
    description: "Core promise, outcome, pricing architecture, guarantee/risk reversal, and bonuses",
  },
  AWARENESS: {
    authorityName: "AWARENESS",
    ownerEngine: "AwarenessEngine",
    canonicalTable: "awareness_snapshots",
    upstreamDependencies: ["OFFER", "AUDIENCE", "STRATEGIC_LANES"],
    downstreamDependents: ["FUNNEL", "PERSUASION", "CHANNEL_SELECTION"],
    supportsTargetedRecompute: true,
    recomputeEntrypoint: "server/awareness-engine/index.ts",
    description: "Readiness stages, entry trigger enforcement, and trust journey framing",
  },
  FUNNEL: {
    authorityName: "FUNNEL",
    ownerEngine: "FunnelEngine",
    canonicalTable: "funnel_snapshots",
    upstreamDependencies: ["OFFER", "AWARENESS", "AUDIENCE", "STRATEGIC_LANES"],
    downstreamDependents: ["PERSUASION", "CHANNEL_SELECTION", "PLAN_SYNTHESIS"],
    supportsTargetedRecompute: true,
    recomputeEntrypoint: "server/funnel-engine/index.ts",
    description: "Funnel architecture, stage progression, commitment tiers, and friction points",
  },
  PERSUASION: {
    authorityName: "PERSUASION",
    ownerEngine: "PersuasionEngine",
    canonicalTable: "persuasion_snapshots",
    upstreamDependencies: ["FUNNEL", "AWARENESS", "OFFER", "MECHANISM", "STRATEGIC_LANES", "AUDIENCE"],
    downstreamDependents: ["CHANNEL_SELECTION", "PLAN_SYNTHESIS"],
    supportsTargetedRecompute: true,
    recomputeEntrypoint: "server/persuasion-engine/engine.ts",
    description: "Lane-scoped objection playbook, Cialdini principle grounding, and trust transfer",
  },
  CHANNEL_SELECTION: {
    authorityName: "CHANNEL_SELECTION",
    ownerEngine: "ChannelSelectionEngine",
    canonicalTable: "channel_selection_snapshots",
    upstreamDependencies: ["AWARENESS", "FUNNEL", "PERSUASION", "STRATEGIC_LANES"],
    downstreamDependents: ["BUDGET_GOVERNOR", "PLAN_SYNTHESIS"],
    supportsTargetedRecompute: true,
    recomputeEntrypoint: "server/channel-selection-engine/index.ts",
    description: "Primary distribution channels, lane-channel alignments, and rationale",
  },
  BUDGET_GOVERNOR: {
    authorityName: "BUDGET_GOVERNOR",
    ownerEngine: "BudgetGovernorEngine",
    canonicalTable: "budget_governor_snapshots",
    upstreamDependencies: ["CHANNEL_SELECTION"],
    downstreamDependents: ["PLAN_SYNTHESIS"],
    supportsTargetedRecompute: true,
    recomputeEntrypoint: "server/budget-governor-engine/index.ts",
    description: "Budget allocation, spend caps, pacing, and channel-level governance",
  },
  INTEGRITY: {
    authorityName: "INTEGRITY",
    ownerEngine: "IntegrityEngine",
    canonicalTable: "integrity_snapshots",
    upstreamDependencies: [
      "POSITIONING",
      "DIFFERENTIATION",
      "MECHANISM",
      "OFFER",
      "FUNNEL",
      "AWARENESS",
      "PERSUASION",
      "CHANNEL_SELECTION",
      "BUDGET_GOVERNOR",
    ],
    downstreamDependents: ["STRATEGY_ROOT", "PLAN_SYNTHESIS"],
    supportsTargetedRecompute: true,
    recomputeEntrypoint: "server/integrity-engine/index.ts",
    description: "Multi-layer coherence verification, contradiction detection, and execution gating",
  },
  STRATEGY_ROOT: {
    authorityName: "STRATEGY_ROOT",
    ownerEngine: "StrategyRootEngine",
    canonicalTable: "strategy_roots",
    upstreamDependencies: [
      "POSITIONING",
      "DIFFERENTIATION",
      "MECHANISM",
      "OFFER",
      "STRATEGIC_LANES",
      "INTEGRITY",
    ],
    downstreamDependents: ["PLAN_SYNTHESIS", "EXECUTION_TASKS"],
    supportsTargetedRecompute: false, // Orchestrates creation of immutable Strategy Root versions
    recomputeEntrypoint: "server/orchestrator/index.ts",
    description: "Immutable strategic spine linking core axes, mechanism, and lanes per version",
  },
  PLAN_SYNTHESIS: {
    authorityName: "PLAN_SYNTHESIS",
    ownerEngine: "PlanSynthesisEngine",
    canonicalTable: "strategic_plans",
    upstreamDependencies: [
      "STRATEGY_ROOT",
      "AWARENESS",
      "FUNNEL",
      "PERSUASION",
      "CHANNEL_SELECTION",
      "BUDGET_GOVERNOR",
    ],
    downstreamDependents: ["EXECUTION_TASKS"],
    supportsTargetedRecompute: true,
    recomputeEntrypoint: "server/orchestrator/plan-synthesis.ts",
    description: "Customer-facing strategy document synthesized across approved engine authorities",
  },
  EXECUTION_TASKS: {
    authorityName: "EXECUTION_TASKS",
    ownerEngine: "WhatToDoToday",
    canonicalTable: "execution_tasks",
    upstreamDependencies: ["PLAN_SYNTHESIS", "STRATEGY_ROOT"],
    downstreamDependents: [],
    supportsTargetedRecompute: true,
    recomputeEntrypoint: "server/what-to-do-today/index.ts",
    description: "Concrete operational tasks, scheduling, and tactical cadence execution",
  },
};

/**
 * Look up authority definition by canonical authority name.
 */
export function getAuthorityDefinition(name: StrategicAuthorityName): StrategyAuthorityDefinition {
  const def = STRATEGY_AUTHORITY_REGISTRY[name];
  if (!def) {
    throw new Error(`[StrategyAuthorityRegistry] Unknown authority name: "${name}"`);
  }
  return def;
}

/**
 * Returns all downstream dependent authorities for a given authority.
 */
export function getDownstreamDependents(name: StrategicAuthorityName): StrategicAuthorityName[] {
  return getAuthorityDefinition(name).downstreamDependents;
}

/**
 * Returns all upstream required dependencies for a given authority.
 */
export function getUpstreamDependencies(name: StrategicAuthorityName): StrategicAuthorityName[] {
  return getAuthorityDefinition(name).upstreamDependencies;
}

/**
 * Verifies if a given string is a valid StrategicAuthorityName.
 */
export function isValidAuthorityName(name: string): name is StrategicAuthorityName {
  return name in STRATEGY_AUTHORITY_REGISTRY;
}

/**
 * Computes the transitive dependency closure for an authority change.
 * Answers: "If authority X changes, what downstream authorities may require reconsideration?"
 */
export function getTransitiveDependents(name: StrategicAuthorityName): StrategicAuthorityName[] {
  const visited = new Set<StrategicAuthorityName>();
  const queue: StrategicAuthorityName[] = [...getDownstreamDependents(name)];

  while (queue.length > 0) {
    const current = queue.shift()!;
    if (!visited.has(current)) {
      visited.add(current);
      const nextDeps = getDownstreamDependents(current);
      for (const next of nextDeps) {
        if (!visited.has(next)) {
          queue.push(next);
        }
      }
    }
  }

  return Array.from(visited);
}

/**
 * Returns true if an authority is scoped per strategic lane rather than being a single global strategy constant.
 */
export function isLaneScopedAuthority(name: StrategicAuthorityName): boolean {
  const laneScopedAuthorities: Set<StrategicAuthorityName> = new Set([
    "FUNNEL",
    "PERSUASION",
    "AWARENESS",
    "STRATEGIC_LANES",
  ]);
  return laneScopedAuthorities.has(name);
}

