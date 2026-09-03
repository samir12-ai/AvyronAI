/**
 * Cascade Planner & Dependency Impact Evaluator
 * 
 * Constitutional Principle:
 * DEPENDENT DOES NOT MEAN AUTOMATICALLY REGENERATE.
 * For every downstream candidate in the authority dependency graph:
 * - Computes topological dependency ordering.
 * - Performs an impact check: PRESERVE vs REEVALUATE.
 * - Executes recomputations in upstream-first order.
 * - If an upstream authority is evaluated as NO_CHANGE_REQUIRED, downstream reevaluation is skipped.
 */

import { StrategicAuthorityName } from "./contracts";
import {
  STRATEGY_AUTHORITY_REGISTRY,
  getAuthorityDefinition,
  getDownstreamDependents,
  getTransitiveDependents,
} from "./authority-registry";

export type ImpactAction = "PRESERVE" | "REEVALUATE" | "RECOMPUTE";

export interface DependentImpactEvaluation {
  authority: StrategicAuthorityName;
  action: ImpactAction;
  reason: string;
  triggeringUpstreamAuthorities: StrategicAuthorityName[];
}

export interface CascadePlan {
  initialAuthorities: StrategicAuthorityName[];
  topologicalExecutionOrder: StrategicAuthorityName[];
  dependentEvaluations: Record<StrategicAuthorityName, DependentImpactEvaluation>;
  authoritiesToRecompute: StrategicAuthorityName[];
}

/**
 * Topologically sorts a set of authorities according to upstream/downstream dependencies.
 */
export function sortAuthoritiesTopologically(authorities: StrategicAuthorityName[]): StrategicAuthorityName[] {
  const authoritySet = new Set(authorities);
  const visited = new Set<StrategicAuthorityName>();
  const result: StrategicAuthorityName[] = [];

  function visit(auth: StrategicAuthorityName, stack = new Set<StrategicAuthorityName>()) {
    if (stack.has(auth)) {
      // Cycle detected, break cycle gracefully
      return;
    }
    if (visited.has(auth)) return;

    stack.add(auth);
    const def = getAuthorityDefinition(auth);
    for (const upstream of def.upstreamDependencies) {
      if (authoritySet.has(upstream)) {
        visit(upstream, new Set(stack));
      }
    }
    visited.add(auth);
    result.push(auth);
  }

  for (const auth of authorities) {
    if (!visited.has(auth)) {
      visit(auth);
    }
  }

  return result;
}

export interface ImpactCheckInput {
  changedAuthority: StrategicAuthorityName;
  candidateDependent: StrategicAuthorityName;
  oldArtifactPayload?: any;
  newArtifactPayload?: any;
  currentDependentPayload?: any;
  reasoningRationale?: string;
}

/**
 * Performs a semantic/structural impact check for a single downstream candidate dependent.
 */
export function evaluateDependentImpact(input: ImpactCheckInput): DependentImpactEvaluation {
  const { changedAuthority, candidateDependent, reasoningRationale } = input;

  // Upstream foundational truth invalidation creates broader cascade
  const isFoundationalUpstream =
    changedAuthority === "BUSINESS_UNDERSTANDING" ||
    changedAuthority === "TARGET_ASSESSMENT" ||
    changedAuthority === "AUDIENCE" ||
    changedAuthority === "STRATEGIC_PAIN_DECISION";

  if (isFoundationalUpstream) {
    return {
      authority: candidateDependent,
      action: "REEVALUATE",
      reason: `Upstream foundational authority ${changedAuthority} changed; dependent ${candidateDependent} requires reevaluation.`,
      triggeringUpstreamAuthorities: [changedAuthority],
    };
  }

  // Tactical / downstream changes do not invalidate unrelated dependents
  if (changedAuthority === "CHANNEL_SELECTION") {
    if (candidateDependent === "BUDGET_GOVERNOR" || candidateDependent === "PLAN_SYNTHESIS") {
      return {
        authority: candidateDependent,
        action: "REEVALUATE",
        reason: `Channel distribution changed; ${candidateDependent} requires alignment.`,
        triggeringUpstreamAuthorities: [changedAuthority],
      };
    }
    return {
      authority: candidateDependent,
      action: "PRESERVE",
      reason: `Channel change does not invalidate ${candidateDependent}.`,
      triggeringUpstreamAuthorities: [changedAuthority],
    };
  }

  if (changedAuthority === "DIFFERENTIATION") {
    if (candidateDependent === "OFFER" || candidateDependent === "PERSUASION" || candidateDependent === "STRATEGY_ROOT") {
      return {
        authority: candidateDependent,
        action: "REEVALUATE",
        reason: `Differentiation claims changed; ${candidateDependent} may need claim/risk re-alignment.`,
        triggeringUpstreamAuthorities: [changedAuthority],
      };
    }
    return {
      authority: candidateDependent,
      action: "PRESERVE",
      reason: `Differentiation change does not invalidate ${candidateDependent}.`,
      triggeringUpstreamAuthorities: [changedAuthority],
    };
  }

  if (changedAuthority === "POSITIONING") {
    if (
      candidateDependent === "DIFFERENTIATION" ||
      candidateDependent === "MECHANISM" ||
      candidateDependent === "OFFER" ||
      candidateDependent === "STRATEGY_ROOT"
    ) {
      return {
        authority: candidateDependent,
        action: "REEVALUATE",
        reason: `Positioning territory changed; ${candidateDependent} requires narrative alignment.`,
        triggeringUpstreamAuthorities: [changedAuthority],
      };
    }
    return {
      authority: candidateDependent,
      action: "PRESERVE",
      reason: `Positioning change does not invalidate ${candidateDependent}.`,
      triggeringUpstreamAuthorities: [changedAuthority],
    };
  }

  // Default: evaluate direct downstream dependents
  const directDependents = getDownstreamDependents(changedAuthority);
  if (directDependents.includes(candidateDependent)) {
    return {
      authority: candidateDependent,
      action: "REEVALUATE",
      reason: `Direct downstream dependent of ${changedAuthority}.`,
      triggeringUpstreamAuthorities: [changedAuthority],
    };
  }

  return {
    authority: candidateDependent,
    action: "PRESERVE",
    reason: `Transitive dependent preserved; no direct semantic disruption from ${changedAuthority}.`,
    triggeringUpstreamAuthorities: [changedAuthority],
  };
}

/**
 * Plans the targeted recompute cascade for a set of initially affected authorities.
 */
export function planRecomputeCascade(
  initialAuthorities: StrategicAuthorityName[],
  options?: {
    forceAllDownstream?: boolean;
    reasoningRationale?: string;
  }
): CascadePlan {
  // 1. Resolve all transitive downstream candidates
  const candidateSet = new Set<StrategicAuthorityName>(initialAuthorities);
  for (const auth of initialAuthorities) {
    const transitive = getTransitiveDependents(auth);
    for (const dep of transitive) {
      candidateSet.add(dep);
    }
  }

  // 2. Evaluate impact for each candidate dependent
  const dependentEvaluations: Record<StrategicAuthorityName, DependentImpactEvaluation> = {} as any;
  const authoritiesToRecompute = new Set<StrategicAuthorityName>(initialAuthorities);

  for (const candidate of candidateSet) {
    if (initialAuthorities.includes(candidate)) {
      dependentEvaluations[candidate] = {
        authority: candidate,
        action: "REEVALUATE",
        reason: "Explicitly requested by Adaptive Decision.",
        triggeringUpstreamAuthorities: [],
      };
      continue;
    }

    // Check impact against all triggering changed authorities
    const triggeringAuthorities = initialAuthorities.filter(init =>
      getTransitiveDependents(init).includes(candidate)
    );

    let finalAction: ImpactAction = "PRESERVE";
    let finalReason = "No material impact from upstream changes.";

    for (const trig of triggeringAuthorities) {
      const evalResult = evaluateDependentImpact({
        changedAuthority: trig,
        candidateDependent: candidate,
        reasoningRationale: options?.reasoningRationale,
      });

      if (evalResult.action === "REEVALUATE" || evalResult.action === "RECOMPUTE" || options?.forceAllDownstream) {
        finalAction = "REEVALUATE";
        finalReason = evalResult.reason;
        authoritiesToRecompute.add(candidate);
        break;
      }
    }

    dependentEvaluations[candidate] = {
      authority: candidate,
      action: finalAction,
      reason: finalReason,
      triggeringUpstreamAuthorities: triggeringAuthorities,
    };
  }

  // 3. Topologically sort the execution order of authorities to recompute
  const topologicalExecutionOrder = sortAuthoritiesTopologically(Array.from(authoritiesToRecompute));

  return {
    initialAuthorities,
    topologicalExecutionOrder,
    dependentEvaluations,
    authoritiesToRecompute: topologicalExecutionOrder,
  };
}
