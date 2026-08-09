/**
 * ============================================================================
 * CANDIDATE GATE BATTERY — "AI Proposes, Code Validates" (Phase 2 / T12)
 * ============================================================================
 *
 * The single reusable "run every gate on one candidate" function. The engines
 * (audience / positioning / offer, and channel in Phase 3) all call this so the
 * full validation battery is defined ONCE and stays identical everywhere.
 *
 * The battery layers the deterministic floor and the two hostile LLM judges in
 * cost order, short-circuiting on the first hard failure:
 *   1. breadth        — deterministic regex, free, always runs first.
 *   2. interchangeability — LLM: is the candidate generic boilerplate?
 *   3. contradiction  — LLM: does the candidate conflict with a locked prior?
 *
 * PURITY / REPLAY: this module lives in server/shared (whitelisted to reach the
 * judges, which own the aiChat calls). It imports NO server/orchestrator type —
 * priors arrive as a plain EngineDecisionSummary[]. The retry loop and the SSC
 * recording live in the CALLING engine, never here.
 *
 * D1/D5 — NO silent substitution: `passed` and `failedGate` are assigned per
 * branch with literals (no `?? / ||`). Judge NOT_RUN verdicts are RECORDED on
 * the result (breadth/interchangeability/contradiction fields) so the caller can
 * persist them into the ai_path_report — a NOT_RUN is an abstention, NEVER an
 * implicit pass-through. Only REJECTED / CONTRADICTS fail a candidate; ACCEPTED,
 * CONSISTENT, and NOT_RUN all proceed (the deterministic floor already held).
 */
import {
  checkBreadth,
  breadthRejectionFeedback,
  type BreadthResult,
} from "./breadth-gate";
import {
  judgeInterchangeability,
  type InterchangeabilityVerdict,
  type JudgeKind,
} from "./interchangeability-judge";
import {
  judgeContradiction,
  type ContradictionVerdict,
} from "./contradiction-judge";
import type { ProductAnchor, EngineDecisionSummary } from "./strategic-doctrine";
import {
  validateAuthorityBoundaries,
  type AuthorityCheckResult,
  type SelectedPainLike,
} from "./authority-validator";
import type { ValidatedCapability } from "./capability-registry";
import type { JudgeAuthorityContext } from "./interchangeability-judge";

/** Which gate rejected the candidate (null when it passed all gates). */
export type FailedGate = "authority" | "breadth" | "interchangeability" | "contradiction";

/**
 * Optional authority context (Pain Registry + validated capability registry).
 * When supplied, the deterministic authority gate runs FIRST (free) and the
 * interchangeability judge additionally enforces the same boundaries.
 */
export interface GateAuthorityInput {
  selectedPains: SelectedPainLike[];
  capabilities: ValidatedCapability[];
  /** Output fields that claim a CENTRAL customer problem (caller-designated). */
  centralProblemTexts: string[];
  /** Structured capabilityRefs the LLM emitted, when the schema carries one. */
  capabilityRefs?: unknown;
}

export interface GateBatteryResult {
  /** true only when NO gate rejected the candidate. Explicit, never `??`-merged. */
  passed: boolean;
  /** The first gate that rejected the candidate; null when passed. */
  failedGate: FailedGate | null;
  /** Deterministic authority verdict (null when no authority context supplied). */
  authority: AuthorityCheckResult | null;
  /** Deterministic breadth verdict (always populated — the floor always runs). */
  breadth: BreadthResult;
  /** Interchangeability judge verdict (NOT_RUN when skipped or abstained). */
  interchangeability: InterchangeabilityVerdict;
  /** Contradiction judge verdict (NOT_RUN when no priors, skipped, or abstained). */
  contradiction: ContradictionVerdict;
  /** One-line rejection feedback for the retry prompt; "" when passed. */
  rejectionFeedback: string;
}

/** Explicit "did not run because an earlier gate already failed" verdicts. These
 *  are recorded (never dropped) so the ai_path_report shows the true gate trace. */
function skippedInterchangeability(kind: JudgeKind): InterchangeabilityVerdict {
  return {
    kind,
    verdict: "NOT_RUN",
    reason: "SKIPPED: an earlier gate already rejected this candidate",
    fix: "",
  };
}
function skippedContradiction(kind: JudgeKind): ContradictionVerdict {
  return {
    kind,
    verdict: "NOT_RUN",
    contradictedEngineId: null,
    reason: "SKIPPED: an earlier gate already rejected this candidate",
    fix: "",
  };
}

/**
 * Run the full gate battery on a single candidate's strategic text.
 * @param input.kind          which judge prompt family applies to this text.
 * @param input.candidateText the candidate strategic text (e.g. "name: description").
 * @param input.productAnchor the campaign's product anchor (null → degraded test).
 * @param input.priorDecisions validated upstream decisions (empty → contradiction NOT_RUN).
 * @param input.accountId     tenant id (for AI rate limiting / telemetry).
 */
export async function runCandidateGateBattery(input: {
  kind: JudgeKind;
  candidateText: string;
  productAnchor: ProductAnchor | null;
  priorDecisions: EngineDecisionSummary[];
  accountId: string;
  /** Optional Pain-Registry/capability authority context (see GateAuthorityInput). */
  authority?: GateAuthorityInput | null;
}): Promise<GateBatteryResult> {
  const { kind, candidateText, productAnchor, priorDecisions, accountId } = input;

  // GATE 0 — authority boundaries (deterministic, free). Runs FIRST when the
  // caller supplied the selected pains / validated capabilities: an output
  // whose central problem or capability claims violate the authority model is
  // rejected with precise retry feedback before any LLM judge is spent.
  let authorityResult: AuthorityCheckResult | null = null;
  if (input.authority) {
    authorityResult = validateAuthorityBoundaries({
      engineId: kind,
      centralProblemTexts: input.authority.centralProblemTexts,
      capabilityRefs: input.authority.capabilityRefs,
      selectedPains: input.authority.selectedPains,
      capabilities: input.authority.capabilities,
    });
    if (!authorityResult.passed) {
      return {
        passed: false,
        failedGate: "authority",
        authority: authorityResult,
        breadth: checkBreadth(candidateText),
        interchangeability: skippedInterchangeability(kind),
        contradiction: skippedContradiction(kind),
        rejectionFeedback: authorityResult.violations.map((v) => v.retryFeedback).join(" "),
      };
    }
  }

  // GATE 1 — breadth (deterministic, free). Catches empties + broad boilerplate.
  const breadth = checkBreadth(candidateText);
  if (!breadth.passed) {
    return {
      passed: false,
      failedGate: "breadth",
      authority: authorityResult,
      breadth,
      interchangeability: skippedInterchangeability(kind),
      contradiction: skippedContradiction(kind),
      rejectionFeedback: breadthRejectionFeedback(breadth),
    };
  }

  // GATE 2 — interchangeability (LLM). REJECTED short-circuits (skips gate 3 to
  // cap judge calls). ACCEPTED and NOT_RUN both proceed — NOT_RUN is recorded.
  const judgeAuthority: JudgeAuthorityContext | null = input.authority
    ? {
        selectedPains: input.authority.selectedPains,
        capabilities: input.authority.capabilities.map((c) => ({
          capabilityId: c.capabilityId,
          statement: c.statement,
        })),
      }
    : null;
  const interchangeability = await judgeInterchangeability({
    kind,
    candidate: candidateText,
    productAnchor,
    accountId,
    authority: judgeAuthority,
  });
  if (interchangeability.verdict === "REJECTED") {
    const fix = interchangeability.fix ? ` Fix: ${interchangeability.fix}` : "";
    return {
      passed: false,
      failedGate: "interchangeability",
      authority: authorityResult,
      breadth,
      interchangeability,
      contradiction: skippedContradiction(kind),
      rejectionFeedback: `Rejected by interchangeability judge: ${interchangeability.reason}${fix}`,
    };
  }

  // GATE 3 — contradiction (LLM). CONTRADICTS short-circuits; CONSISTENT and
  // NOT_RUN both proceed (NOT_RUN = no priors to compare, or abstention).
  const contradiction = await judgeContradiction({
    kind,
    candidate: candidateText,
    priorDecisions,
    productAnchor,
    accountId,
  });
  if (contradiction.verdict === "CONTRADICTS") {
    const named = contradiction.contradictedEngineId
      ? contradiction.contradictedEngineId
      : "a prior decision";
    const fix = contradiction.fix ? ` Fix: ${contradiction.fix}` : "";
    return {
      passed: false,
      failedGate: "contradiction",
      authority: authorityResult,
      breadth,
      interchangeability,
      contradiction,
      rejectionFeedback: `Rejected by contradiction judge (conflicts with ${named}): ${contradiction.reason}${fix}`,
    };
  }

  // Every gate held. Judges may have abstained (NOT_RUN) — those verdicts are
  // carried on the result for recording, but they do NOT block the candidate.
  return {
    passed: true,
    failedGate: null,
    authority: authorityResult,
    breadth,
    interchangeability,
    contradiction,
    rejectionFeedback: "",
  };
}
