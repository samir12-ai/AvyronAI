import type {
  SystemControlInput,
  SystemControlVerdict,
  SystemVerdict,
  ExecutionMode,
  BlockReason,
  Downgrade,
  StructuralCheck,
  Contradiction,
} from "./types";
import {
  checkConversionPath,
  checkSignalGrounding,
  checkIntegrityStatus,
  checkCELCompliance,
  checkUpstreamEngineHealth,
  checkFunnelStructuralCompleteness,
  checkBudgetFunnelAlignment,
  checkBudgetCACVerification,
  collectBlockReasons,
} from "./structural-checks";
import { detectContradictions } from "./contradiction-detector";
import { CONTROL_VERSION, INTEGRITY_RESTRICT_THRESHOLD } from "./constants";

export function evaluateSystemControl(input: SystemControlInput): SystemControlVerdict {
  const startTime = Date.now();

  const budgetResult = input.results.get("budget_governor");
  const budgetAction = budgetResult?.output?.decision?.action ?? null;

  const structuralChecks: StructuralCheck[] = [];

  structuralChecks.push(checkConversionPath(input.results));
  structuralChecks.push(checkSignalGrounding(input.signalComposition, budgetAction));
  structuralChecks.push(checkIntegrityStatus(input.integrityReport));
  structuralChecks.push(checkCELCompliance(input.celResults));
  structuralChecks.push(checkUpstreamEngineHealth(input.results));
  structuralChecks.push(checkFunnelStructuralCompleteness(input.results));

  const contradictions = detectContradictions(input.results, input.integrityReport);

  const blockReasons = collectBlockReasons(structuralChecks, input.results);

  const downgrades: Downgrade[] = [];

  const budgetFunnelCheck = checkBudgetFunnelAlignment(input.results);
  if (budgetFunnelCheck.contradiction && budgetFunnelCheck.downgrade) {
    downgrades.push(budgetFunnelCheck.downgrade);
  }

  const cacCheck = checkBudgetCACVerification(input.results);
  if (cacCheck.unverified && cacCheck.downgrade) {
    downgrades.push(cacCheck.downgrade);
  }

  if (
    input.integrityReport?.overallStatus === "PARTIAL" &&
    budgetAction === "test"
  ) {
    downgrades.push({
      from: "test",
      to: "hold",
      reason: "Integrity is PARTIAL — downgrade from test to hold until integrity improves",
      code: "INTEGRITY_PARTIAL",
      affectedEngine: "budget_governor",
    });
  }

  if (
    input.signalComposition &&
    input.signalComposition.trustedRatio < 0.3 &&
    budgetAction === "test"
  ) {
    downgrades.push({
      from: "test",
      to: "hold",
      reason: `Trusted signal ratio ${input.signalComposition.trustedRatio.toFixed(2)} is below 0.30 — downgrade from test to hold`,
      code: "LOW_SIGNAL_TRUST",
      affectedEngine: "budget_governor",
    });
  }

  let verdict: SystemVerdict;
  let executionMode: ExecutionMode;

  if (blockReasons.length > 0) {
    verdict = "BLOCK";
    executionMode = "HALTED";
  } else if (downgrades.length > 0) {
    verdict = "DOWNGRADE";
    const hasScaleDowngrade = downgrades.some(d => d.from === "scale");
    const hasTestDowngrade = downgrades.some(d => d.from === "test");

    if (hasScaleDowngrade) {
      executionMode = "TEST_ONLY";
    } else if (hasTestDowngrade) {
      executionMode = "RESTRICTED_EXECUTION";
    } else {
      executionMode = "RESTRICTED_EXECUTION";
    }
  } else if (contradictions.length > 0) {
    verdict = "PASS";
    executionMode = "REVIEW_REQUIRED";
  } else {
    verdict = "PASS";
    executionMode = "FULL_EXECUTION";
  }

  const durationMs = Date.now() - startTime;

  const result: SystemControlVerdict = {
    verdict,
    executionMode,
    blockReasons,
    downgrades,
    structuralChecks,
    contradictions,
    timestamp: new Date(),
    durationMs,
    controlVersion: CONTROL_VERSION,
    shadowMode: true,
  };

  logVerdict(result, input.config);

  return result;
}

function logVerdict(verdict: SystemControlVerdict, config: { campaignId: string; accountId: string }): void {
  const checksPass = verdict.structuralChecks.filter(c => c.passed).length;
  const checksFail = verdict.structuralChecks.filter(c => !c.passed).length;

  console.log(
    `[SystemControl] ${verdict.shadowMode ? "SHADOW" : "ACTIVE"} | ` +
    `verdict=${verdict.verdict} | mode=${verdict.executionMode} | ` +
    `blocks=${verdict.blockReasons.length} | downgrades=${verdict.downgrades.length} | ` +
    `contradictions=${verdict.contradictions.length} | ` +
    `checks=${checksPass}/${checksPass + checksFail} passed | ` +
    `campaign=${config.campaignId} | ${verdict.durationMs}ms`
  );

  if (verdict.blockReasons.length > 0) {
    for (const block of verdict.blockReasons) {
      console.log(`[SystemControl] BLOCK_REASON | code=${block.code} | severity=${block.severity} | ${block.description}`);
    }
  }

  if (verdict.downgrades.length > 0) {
    for (const dg of verdict.downgrades) {
      console.log(`[SystemControl] DOWNGRADE | ${dg.from}→${dg.to} | code=${dg.code} | engine=${dg.affectedEngine} | ${dg.reason}`);
    }
  }

  if (verdict.contradictions.length > 0) {
    for (const c of verdict.contradictions) {
      console.log(`[SystemControl] CONTRADICTION | ${c.engineA} vs ${c.engineB} | ${c.description}`);
    }
  }

  for (const check of verdict.structuralChecks) {
    if (!check.passed) {
      console.log(`[SystemControl] CHECK_FAILED | ${check.check} | ${check.details}`);
    }
  }
}
