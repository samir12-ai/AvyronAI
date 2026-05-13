import type {
  BlockCode,
  ExecutionMode,
  ResolverActor,
  RootCauseCategory,
} from "./types";

export interface RecoveryMapEntry {
  meaning: string;
  severity: "critical" | "high";
  ownerEngine: string;
  rootCauseCategory: RootCauseCategory;
  repairOrderRank: number;
  repairPatterns: string[];
  successCriteria: string[];
  requiredProof: string[];
  allowedNextModes: ExecutionMode[];
  defaultNextMode: ExecutionMode;
}

/**
 * v1 Actionable Block Recovery (May 2026): per-block-code operational
 * metadata. Static — never inferred per-run. Drives `RecoveryIssue.retrySafe`
 * and `RecoveryIssue.resolverActor` so the user sees, for every block, both
 * whether the system can resolve it at runtime and who must act if not.
 *
 *   retrySafe=true  → block has a wired pure-mutation runtime repair
 *                     OR a system-side mode-flip that strictly downgrades risk
 *   retrySafe=false → real-world action / engine re-run / human review needed
 *
 *   resolverActor="system"   → in-platform resolution is possible
 *   resolverActor="user"     → human review required (HUMAN_REVIEW_REQUIRED)
 *   resolverActor="external" → real-world data acquisition required
 *                              (proof collection / MI refresh / validation window)
 */
export const BLOCK_METADATA: Record<BlockCode | "UNKNOWN_BLOCK", { retrySafe: boolean; resolverActor: ResolverActor }> = {
  // Wired-active runtime repairs (pre-v1)
  NO_CONVERSION_PATH:               { retrySafe: true,  resolverActor: "system" },
  SCALE_WITHOUT_REAL_DATA:          { retrySafe: true,  resolverActor: "system" },
  // v1 pure-mutation repairs
  CONFIDENCE_CHAIN_VIOLATION:       { retrySafe: true,  resolverActor: "system" },
  CONFIDENCE_SPREAD_EXCESSIVE:      { retrySafe: true,  resolverActor: "system" },
  BUDGET_OVERRIDE_ZERO_CONFIDENCE:  { retrySafe: true,  resolverActor: "system" },
  CHANNEL_CONFIDENCE_BELOW_MINIMUM: { retrySafe: true,  resolverActor: "system" },
  // Engine-rerun-required (system-driven, not safe inside system-control loop)
  INTEGRITY_FAILURE:                { retrySafe: false, resolverActor: "system" },
  COMPLIANCE_FAILURE:               { retrySafe: false, resolverActor: "system" },
  OFFER_AUDIENCE_MISALIGNMENT:      { retrySafe: false, resolverActor: "system" },
  ZERO_OBJECTION_COVERAGE:          { retrySafe: false, resolverActor: "system" },
  // Offer can only resume after Audience produces
  // ≥1 grounded pain signal. That requires fresh MI / scraping data, so the
  // resolver is system-driven (rerun upstream), not a runtime mutation.
  OFFER_INPUT_INSUFFICIENT:         { retrySafe: false, resolverActor: "system" },
  // Truthfulness / commercial brake signals — must NOT be repaired
  VALIDATION_REJECTED:              { retrySafe: false, resolverActor: "external" },
  BUDGET_KILL:                      { retrySafe: false, resolverActor: "external" },
  BUDGET_HALT:                      { retrySafe: false, resolverActor: "external" },
  SIGNAL_GROUNDING_MASS_FAILURE:    { retrySafe: false, resolverActor: "external" },
  // Human-review or architectural-truth signals
  POSITIONING_HARD_GATE:            { retrySafe: false, resolverActor: "user" },
  UNRESOLVED_CRITICAL_PROBLEMS:     { retrySafe: false, resolverActor: "user" },
  // Phase R reliability blocks — system-domain (orchestrator/retry-policy/snapshot-refresh)
  PIPELINE_INCOMPLETE:              { retrySafe: false, resolverActor: "system" },
  STALE_SNAPSHOT_EVIDENCE:          { retrySafe: false, resolverActor: "system" },
  ENGINE_TIMEOUT:                   { retrySafe: false, resolverActor: "system" },
  UNRESOLVED_CONTRADICTION:         { retrySafe: false, resolverActor: "user" },
  // Unknown — escalate to human
  UNKNOWN_BLOCK:                    { retrySafe: false, resolverActor: "user" },
};

const RANK = {
  STRUCTURAL: 10,
  AUDIENCE: 20,
  POSITIONING: 25,
  MECHANISM: 30,
  OFFER: 40,
  FUNNEL: 50,
  PROOF: 60,
  VALIDATION: 70,
  CHANNEL: 80,
  BUDGET: 90,
  SYSTEM: 100,
} as const;

// Phase 6 maturity (May 2026): system-domain reliability blocks now carry
// explicit recovery narratives instead of falling through to the generic
// "Manual investigation required" UNKNOWN_BLOCK template. This eliminates
// opaque dead-end BLOCK states for the operator. The retrySafe / resolverActor
// metadata for these blocks lives in BLOCK_METADATA above; this map adds the
// strategic-recovery copy.
export const RECOVERY_MAP: Partial<Record<BlockCode | "UNKNOWN_BLOCK", RecoveryMapEntry>> & { UNKNOWN_BLOCK: RecoveryMapEntry } = {
  INTEGRITY_FAILURE: {
    meaning: "System Integrity engine flagged a structural failure across one or more strategic engines.",
    severity: "critical",
    ownerEngine: "Integrity",
    rootCauseCategory: "system_parser_issue",
    repairOrderRank: RANK.STRUCTURAL,
    repairPatterns: [
      "Re-run the engines flagged FAIL with cleared cache",
      "Re-validate dependency graph for the failing engines",
      "Inspect the integrity report's contradiction list and resolve highest-severity entry first",
    ],
    successCriteria: [
      "integrityReport.overallStatus !== 'FAIL'",
      "All previously failing engines return status === 'SUCCESS'",
    ],
    requiredProof: ["IntegrityReport with PASS or PARTIAL after rerun"],
    allowedNextModes: ["RESTRICTED_EXECUTION", "REVIEW_REQUIRED", "TEST_ONLY", "FULL_EXECUTION"],
    defaultNextMode: "REVIEW_REQUIRED",
  },

  COMPLIANCE_FAILURE: {
    meaning: "Causal Enforcement Layer (CEL) detected misalignment between AEL root causes and downstream engine outputs.",
    severity: "critical",
    ownerEngine: "CEL",
    rootCauseCategory: "system_parser_issue",
    repairOrderRank: RANK.STRUCTURAL,
    repairPatterns: [
      "Re-run AEL to refresh root-cause set, then re-run failing downstream engines",
      "Inspect failing constraint rule and align the offending engine's output to AEL root causes",
    ],
    successCriteria: ["All CEL constraint rules return passed === true"],
    requiredProof: ["CEL compliance report with zero failed rules"],
    allowedNextModes: ["RESTRICTED_EXECUTION", "REVIEW_REQUIRED", "TEST_ONLY"],
    defaultNextMode: "REVIEW_REQUIRED",
  },

  SIGNAL_GROUNDING_MASS_FAILURE: {
    meaning: "Three or more engines were blocked or errored due to insufficient signal grounding from upstream data.",
    severity: "critical",
    ownerEngine: "Audience + MI",
    rootCauseCategory: "data_insufficiency",
    repairOrderRank: RANK.AUDIENCE,
    repairPatterns: [
      "Refresh Market Intelligence with extended source coverage (Instagram + Website + Reviews minimum)",
      "Re-run Audience engine with updated MI snapshot to lift structured signal count above engine floor",
      "Pause execution; route to PROOF_COLLECTION while data is harvested",
    ],
    successCriteria: [
      "Audience engine produces ≥ 8 structured signals",
      "MI snapshot has ≥ 2 source channels with non-empty data",
      "Fewer than 3 engines in SIGNAL_BLOCKED state on rerun",
    ],
    requiredProof: ["Updated MI snapshot id with channel coverage manifest", "Audience snapshot with structuredSignals.length ≥ 8"],
    allowedNextModes: ["PROOF_COLLECTION", "AWARENESS_BUILD_PHASE", "REVIEW_REQUIRED"],
    defaultNextMode: "PROOF_COLLECTION",
  },

  POSITIONING_HARD_GATE: {
    meaning: "Positioning engine confidence fell below the 0.40 hard gate, indicating no defensible category position.",
    severity: "critical",
    ownerEngine: "Positioning",
    rootCauseCategory: "strategy_issue",
    repairOrderRank: RANK.POSITIONING,
    repairPatterns: [
      "Re-run Positioning with refreshed Audience signals (signal-first claim seeds need ≥ 4 mapped signals)",
      "Verify Mechanism engine has produced a defensible axis before re-running Positioning",
      "If orphan claim rate > 50% on rerun, escalate to manual category-game review",
    ],
    successCriteria: [
      "positioning.engineConfidence ≥ 0.40",
      "At least one territory survives orphan-claim audit",
    ],
    requiredProof: ["Positioning snapshot with engineConfidence ≥ 0.40 and ≥ 1 grounded territory"],
    allowedNextModes: ["TEST_ONLY", "RESTRICTED_EXECUTION", "REVIEW_REQUIRED"],
    defaultNextMode: "REVIEW_REQUIRED",
  },

  OFFER_INPUT_INSUFFICIENT: {
    meaning: "Offer engine refused to run because Audience produced zero pain signals and the MarketLanguageMap has no raw pain phrases. Replaces the legacy 'unresolved challenge' fabricated fallback.",
    severity: "critical",
    ownerEngine: "Offer",
    rootCauseCategory: "data_insufficiency",
    repairOrderRank: RANK.OFFER - 5,
    repairPatterns: [
      "Re-run MI snapshot to widen source-language coverage (Instagram + Website + Reviews minimum)",
      "Re-run Audience engine after MI refresh; verify audience.audiencePains.length ≥ 1",
      "Inspect Audience engine quality gate — if mediumQualitySignals were dropped, lower the medium threshold for one diagnostic run",
    ],
    successCriteria: [
      "audience.audiencePains.length ≥ 1 OR offer.marketLanguage.rawPainPhrases.length ≥ 1",
      "Offer engine status !== INSUFFICIENT_SIGNALS on rerun",
    ],
    requiredProof: [
      "Audience snapshot id with audiencePains.length ≥ 1",
      "Offer snapshot status COMPLETE with primaryPain field non-empty",
    ],
    allowedNextModes: ["PROOF_COLLECTION", "AWARENESS_BUILD_PHASE", "REVIEW_REQUIRED"],
    defaultNextMode: "PROOF_COLLECTION",
  },

  OFFER_AUDIENCE_MISALIGNMENT: {
    meaning: "Offer engine output does not reflect the audience pains identified upstream — market language was lost.",
    severity: "critical",
    ownerEngine: "Offer",
    rootCauseCategory: "audience_mismatch",
    repairOrderRank: RANK.OFFER,
    repairPatterns: [
      "Re-run Audience to confirm top 3 pains are stable",
      "Re-run Offer with explicit pain-binding seeds (each promise must cite ≥ 1 audience pain id)",
      "Reject any Offer rerun where promise→pain coverage < 60%",
    ],
    successCriteria: [
      "Every offer promise maps to at least one audience pain id",
      "Top 3 audience pains each appear in at least one promise",
    ],
    requiredProof: ["Offer snapshot with promise→pain mapping table; coverage ≥ 60%"],
    allowedNextModes: ["TEST_ONLY", "RESTRICTED_EXECUTION", "PROOF_COLLECTION"],
    defaultNextMode: "TEST_ONLY",
  },

  ZERO_OBJECTION_COVERAGE: {
    meaning: "Audience surfaced objections but the offer provides zero objection-handling or risk mitigation.",
    severity: "high",
    ownerEngine: "Offer",
    rootCauseCategory: "offer_issue",
    repairOrderRank: RANK.OFFER + 5,
    repairPatterns: [
      "Add a guarantee, social proof block, or risk-reversal element addressing the top objection",
      "Re-run Offer with `objectionHandling[]` populated against each audience.objections[] entry",
    ],
    successCriteria: [
      "offer.objectionHandling covers ≥ 70% of audience.objections by id",
      "At least one risk-reversal element present (guarantee | proof | trial | refund)",
    ],
    requiredProof: ["Offer snapshot with objectionHandling array tied to objection ids"],
    allowedNextModes: ["TEST_ONLY", "RESTRICTED_EXECUTION"],
    defaultNextMode: "TEST_ONLY",
  },

  NO_CONVERSION_PATH: {
    meaning: "No channel was assigned to a conversion role — the funnel cannot complete a purchase or signup.",
    severity: "critical",
    ownerEngine: "Funnel + Channel",
    rootCauseCategory: "funnel_issue",
    repairOrderRank: RANK.FUNNEL,
    repairPatterns: [
      "Add a decision-stage CTA tied to a specific conversion channel",
      "Re-run Channel Selection ensuring at least one channel is tagged role==='conversion'",
      "If no channel can credibly convert, downgrade to AWARENESS_BUILD_PHASE rather than scaling",
    ],
    successCriteria: [
      "channel_selection produces ≥ 1 channel with role === 'conversion'",
      "Funnel completion check passes",
    ],
    requiredProof: ["Channel selection snapshot with conversion-role channel + funnel completion log"],
    allowedNextModes: ["AWARENESS_BUILD_PHASE", "CHANNEL_VALIDATION_REQUIRED", "TEST_ONLY"],
    defaultNextMode: "CHANNEL_VALIDATION_REQUIRED",
  },

  CHANNEL_CONFIDENCE_BELOW_MINIMUM: {
    meaning: "Channel Selection confidence fell below the 0.40 minimum — selected channels lack defensible signal.",
    severity: "critical",
    ownerEngine: "Channel Selection",
    rootCauseCategory: "channel_issue",
    repairOrderRank: RANK.CHANNEL,
    repairPatterns: [
      "Run a single-channel pilot test before scaling (CHANNEL_VALIDATION_REQUIRED mode)",
      "Re-run Channel Selection with refreshed competitor channel signals from MI",
      "If proof signals are strong but channel confidence weak, recommend pilot mode rather than full block",
    ],
    successCriteria: [
      "channel_selection.confidence ≥ 0.40",
      "Or pilot test produces ≥ 50 conversion events at the candidate channel",
    ],
    requiredProof: ["Pilot test result with CPL/CPA below benchmark, OR refreshed channel-selection snapshot with confidence ≥ 0.40"],
    allowedNextModes: ["CHANNEL_VALIDATION_REQUIRED", "LIMITED_SPEND", "TEST_ONLY"],
    defaultNextMode: "CHANNEL_VALIDATION_REQUIRED",
  },

  VALIDATION_REJECTED: {
    meaning: "Statistical Validation engine rejected the strategy — claim grounding or evidence quality was insufficient.",
    severity: "critical",
    ownerEngine: "Statistical Validation",
    rootCauseCategory: "validation_issue",
    repairOrderRank: RANK.VALIDATION,
    repairPatterns: [
      "Collect proof signals for the top failing claims (case studies, A/B results, third-party benchmarks)",
      "Re-run StatVal once unmapped claim ratio drops below 30%",
      "If high-confidence claims are absent, route to PROOF_COLLECTION rather than scaling budget",
    ],
    successCriteria: [
      "statistical_validation.status === 'pass' or 'partial'",
      "Unmapped claim ratio < 30%",
      "Evidence quality (dataReliability.overallReliability) ≥ 0.5",
    ],
    requiredProof: ["StatVal snapshot with status pass/partial + unmapped ratio < 30%"],
    allowedNextModes: ["PROOF_COLLECTION", "TEST_ONLY", "LIMITED_SPEND"],
    defaultNextMode: "PROOF_COLLECTION",
  },

  SCALE_WITHOUT_REAL_DATA: {
    meaning: "Budget Governor is attempting to scale spend but realRatio is 0 — no real performance data exists.",
    severity: "critical",
    ownerEngine: "Budget Governor",
    rootCauseCategory: "budget_risk",
    repairOrderRank: RANK.VALIDATION,
    repairPatterns: [
      "Downgrade Budget action from 'scale' to 'test' with a capped spend",
      "Run a LIMITED_SPEND learning loop until realRatio ≥ 0.3",
      "Block scale unlock until conversion data accumulates",
    ],
    successCriteria: [
      "Budget Governor produces realRatio ≥ 0.3",
      "At least 2 weeks of real spend data with conversion events",
    ],
    requiredProof: ["Campaign metrics snapshot with realRatio ≥ 0.3 and ≥ 50 conversion events"],
    allowedNextModes: ["LIMITED_SPEND", "TEST_ONLY"],
    defaultNextMode: "LIMITED_SPEND",
  },

  BUDGET_KILL: {
    meaning: "Budget Governor issued a hard kill — spend exceeded efficiency thresholds with no recovery path.",
    severity: "critical",
    ownerEngine: "Budget Governor",
    rootCauseCategory: "budget_risk",
    repairOrderRank: RANK.BUDGET,
    repairPatterns: [
      "Halt all paid spend immediately, then route the campaign to PROOF_COLLECTION to harvest hypotheses before any restart",
      "Re-run Iteration engine to identify failing strategy hypotheses",
      "Re-validate Offer and Channel before re-attempting any spend",
    ],
    successCriteria: [
      "Iteration engine produces ≥ 1 actionable nextTestHypothesis",
      "Offer or Channel changes pass review before any spend resumes",
    ],
    requiredProof: ["Iteration snapshot with hypotheses + revised Offer/Channel snapshots"],
    allowedNextModes: ["PROOF_COLLECTION", "REVIEW_REQUIRED", "HUMAN_REVIEW_REQUIRED", "HALTED"],
    defaultNextMode: "PROOF_COLLECTION",
  },

  BUDGET_HALT: {
    meaning: "Budget Governor halted spend pending validation — efficiency is degrading but not catastrophic.",
    severity: "critical",
    ownerEngine: "Budget Governor",
    rootCauseCategory: "budget_risk",
    repairOrderRank: RANK.BUDGET,
    repairPatterns: [
      "Pause spend at current level, do not increase",
      "Run a 7–14 day validation window with capped budget",
      "Resume only if CAC stays within ±20% of target",
    ],
    successCriteria: [
      "CAC within ±20% of target for ≥ 14 days",
      "No degradation in validation confidence",
    ],
    requiredProof: ["14-day campaign metrics with stable CAC"],
    allowedNextModes: ["LIMITED_SPEND", "TEST_ONLY", "RESTRICTED_EXECUTION"],
    defaultNextMode: "LIMITED_SPEND",
  },

  BUDGET_OVERRIDE_ZERO_CONFIDENCE: {
    meaning: "Budget Governor attempted scale or test action while system-wide confidence floor is 0.",
    severity: "critical",
    ownerEngine: "Budget Governor + Orchestrator",
    rootCauseCategory: "budget_risk",
    repairOrderRank: RANK.BUDGET,
    repairPatterns: [
      "Reject the budget action; do not unlock spend until confidence floor > 0",
      "Investigate which upstream engine collapsed the confidence floor (likely StatVal or Audience)",
      "Re-run upstream engine; if floor remains 0, route to HUMAN_REVIEW_REQUIRED",
    ],
    successCriteria: [
      "ssc.confidenceFloor > 0.30",
      "No engine reports SIGNAL_BLOCKED on rerun",
    ],
    requiredProof: ["SSC snapshot with confidenceFloor > 0.30"],
    allowedNextModes: ["HUMAN_REVIEW_REQUIRED", "PROOF_COLLECTION", "HALTED"],
    defaultNextMode: "HUMAN_REVIEW_REQUIRED",
  },

  CONFIDENCE_CHAIN_VIOLATION: {
    meaning: "An engine reported confidence > 0.20 above its inherited floor — a logical leap not supported by upstream signal.",
    severity: "critical",
    ownerEngine: "Orchestrator (SSC)",
    rootCauseCategory: "validation_issue",
    repairOrderRank: RANK.VALIDATION,
    repairPatterns: [
      "Identify the violating engine and cap its confidence at floor + 0.20",
      "Re-run the violating engine with explicit confidence-bound seeds",
      "If violation persists, route to REVIEW_REQUIRED",
    ],
    successCriteria: [
      "All engine confidences within (floor, floor + 0.20)",
      "No SSC violation logs on rerun",
    ],
    requiredProof: ["Orchestrator run log with no confidence-chain violations"],
    allowedNextModes: ["RESTRICTED_EXECUTION", "REVIEW_REQUIRED", "TEST_ONLY"],
    defaultNextMode: "REVIEW_REQUIRED",
  },

  CONFIDENCE_SPREAD_EXCESSIVE: {
    meaning: "Spread between highest and lowest engine confidence exceeds 0.50, indicating internal disagreement.",
    severity: "critical",
    ownerEngine: "Orchestrator (SSC)",
    rootCauseCategory: "validation_issue",
    repairOrderRank: RANK.VALIDATION,
    repairPatterns: [
      "Identify the high-confidence and low-confidence engines and surface the contradiction",
      "Force both engines to the lower confidence value and re-run downstream",
      "If disagreement is structural, route to HUMAN_REVIEW_REQUIRED",
    ],
    successCriteria: [
      "Engine confidence spread ≤ 0.50",
      "No active contradictions in SSC",
    ],
    requiredProof: ["SSC snapshot with confidence spread ≤ 0.50"],
    allowedNextModes: ["RESTRICTED_EXECUTION", "REVIEW_REQUIRED", "HUMAN_REVIEW_REQUIRED"],
    defaultNextMode: "REVIEW_REQUIRED",
  },

  UNRESOLVED_CRITICAL_PROBLEMS: {
    meaning: "One or more critical-severity problems remain open in the Shared Strategic Context after all engines ran.",
    severity: "critical",
    ownerEngine: "Orchestrator (SSC)",
    rootCauseCategory: "system_parser_issue",
    repairOrderRank: RANK.STRUCTURAL,
    repairPatterns: [
      "Inspect each unresolved problem and route to its owner engine",
      "Re-run the owner engines until problems flip to 'resolved' or 'mitigated'",
      "If problems remain 'cannot_resolve', escalate to human review",
    ],
    successCriteria: [
      "Zero SSC problems with severity='critical' AND status in ('open','cannot_resolve')",
    ],
    requiredProof: ["SSC problems registry with no open critical entries"],
    allowedNextModes: ["RESTRICTED_EXECUTION", "REVIEW_REQUIRED", "HUMAN_REVIEW_REQUIRED"],
    defaultNextMode: "REVIEW_REQUIRED",
  },

  PIPELINE_INCOMPLETE: {
    meaning: "One or more required engines did not complete successfully — pipeline produced a partial run.",
    severity: "critical",
    ownerEngine: "Orchestrator",
    rootCauseCategory: "system_parser_issue",
    repairOrderRank: RANK.SYSTEM,
    repairPatterns: [
      "Inspect the engineExecutionStatus map for engines reporting status='ERROR' or 'TIMEOUT'",
      "Review the engine run logs for the failing engine and identify the underlying error (proxy block, LLM rate-limit, schema validation, etc.)",
      "Re-run the pipeline once the underlying cause is resolved (e.g., restore proxy capacity, wait for rate-limit reset, fix engine input)",
      "If a non-critical engine continues to fail, scopedEngines re-run can isolate it without re-executing the full pipeline",
    ],
    successCriteria: [
      "All required engines (per pipeline contract) report status='COMPLETE'",
      "engineExecutionStatus contains no entries with status in ('ERROR','TIMEOUT','SKIPPED_REQUIRED')",
    ],
    requiredProof: ["Successful re-run of the pipeline with the same inputs and zero ERROR/TIMEOUT engines"],
    allowedNextModes: ["RESTRICTED_EXECUTION", "REVIEW_REQUIRED", "HUMAN_REVIEW_REQUIRED"],
    defaultNextMode: "REVIEW_REQUIRED",
  },

  ENGINE_TIMEOUT: {
    meaning: "An individual engine exceeded its execution time budget and was force-cancelled.",
    severity: "high",
    ownerEngine: "Orchestrator (engine-specific)",
    rootCauseCategory: "system_parser_issue",
    repairOrderRank: RANK.SYSTEM,
    repairPatterns: [
      "Identify which engine timed out (engineExecutionStatus[engineId].status === 'TIMEOUT')",
      "Check the engine's external dependencies — proxy pool health, LLM provider latency, DB query plans",
      "If the timeout is reproducible, increase the engine's per-call timeout OR reduce its input cardinality (fewer competitors, narrower analysis window)",
      "Re-run the pipeline; if the same engine times out again, escalate to engineering",
    ],
    successCriteria: ["Re-run completes with the previously-timing-out engine reporting status='COMPLETE'"],
    requiredProof: ["Engine completes within its timeout budget on next run"],
    allowedNextModes: ["RESTRICTED_EXECUTION", "REVIEW_REQUIRED"],
    defaultNextMode: "REVIEW_REQUIRED",
  },

  STALE_SNAPSHOT_EVIDENCE: {
    meaning: "A downstream engine read a snapshot that is older than the freshness window — evidence may not reflect current state.",
    severity: "high",
    ownerEngine: "Orchestrator (snapshot-resolver)",
    rootCauseCategory: "system_parser_issue",
    repairOrderRank: RANK.SYSTEM,
    repairPatterns: [
      "Force-refresh the upstream engine that produced the stale snapshot (e.g., re-run market_intelligence to refresh the MI snapshot)",
      "Verify the freshness threshold for the snapshot type matches the campaign cadence (longer-cadence campaigns may need wider thresholds)",
      "If the underlying data source is failing (e.g., proxy block), resolve the data-acquisition issue before the next pipeline run",
    ],
    successCriteria: ["All upstream snapshots referenced by the run are within their freshness windows"],
    requiredProof: ["Snapshot timestamps within freshness window on next pipeline run"],
    allowedNextModes: ["RESTRICTED_EXECUTION", "REVIEW_REQUIRED"],
    defaultNextMode: "REVIEW_REQUIRED",
  },

  UNKNOWN_BLOCK: {
    meaning: "An unmapped block code was raised. Manual investigation required to extend the recovery map.",
    severity: "critical",
    ownerEngine: "System (Manual)",
    rootCauseCategory: "system_parser_issue",
    repairOrderRank: RANK.SYSTEM,
    repairPatterns: [
      "Inspect the block reason source and description",
      "Add an entry to RECOVERY_MAP for the new block code",
      "Until mapped, route to HUMAN_REVIEW_REQUIRED",
    ],
    successCriteria: ["Block code added to RECOVERY_MAP and successfully resolved by deterministic plan"],
    requiredProof: ["Recovery map PR + successful rerun"],
    allowedNextModes: ["HUMAN_REVIEW_REQUIRED", "REVIEW_REQUIRED"],
    defaultNextMode: "HUMAN_REVIEW_REQUIRED",
  },
};

export function lookupRecovery(code: string): RecoveryMapEntry {
  return RECOVERY_MAP[code as BlockCode] ?? RECOVERY_MAP.UNKNOWN_BLOCK;
}

export function listMappedBlockCodes(): string[] {
  return Object.keys(RECOVERY_MAP).filter(k => k !== "UNKNOWN_BLOCK");
}
