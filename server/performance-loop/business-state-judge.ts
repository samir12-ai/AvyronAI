import { randomUUID } from "crypto";
import type { NormalizedFactualDossier } from "./source-normalizer";
import type { CandidateBusinessExecutionState } from "./business-state-reasoner";

export interface BusinessStateJudgeVerdict {
  judgeAuthorityId: string;
  status: "ACCEPTED" | "REPAIR_REQUIRED" | "INSUFFICIENT_EVIDENCE";
  violations: string[];
  rejectionReason: string | null;
  validatedMode: "BUILD" | "OPTIMIZE" | "UNKNOWN";
  validatedBottleneck: "REACH" | "ENGAGEMENT" | "INTENT" | "CONVERSATION" | "CONVERSION" | "RETENTION" | "NONE" | "UNKNOWN";
}

export function judgeBusinessExecutionState(
  candidate: CandidateBusinessExecutionState,
  dossier: NormalizedFactualDossier
): BusinessStateJudgeVerdict {
  const judgeAuthorityId = `auth_judge_${randomUUID().slice(0, 8)}`;
  const violations: string[] = [];

  // Gather all valid evidenceRefIds in dossier
  const validRefIds = new Set<string>();
  for (const snap of dossier.sourceSnapshots) {
    if (Array.isArray(snap.evidenceRefIds)) {
      snap.evidenceRefIds.forEach((id: any) => validRefIds.add(String(id)));
    }
  }
  if (dossier.websiteFact?.evidenceRefId) validRefIds.add(dossier.websiteFact.evidenceRefId);
  if (dossier.instagramFact?.evidenceRefId) validRefIds.add(dossier.instagramFact.evidenceRefId);
  if (dossier.manualTruthFact?.evidenceRefId) validRefIds.add(dossier.manualTruthFact.evidenceRefId);

  // Rule 1 & 2: Missing provider data safety
  const hasProviderFailures = dossier.providerFailures.length > 0;
  const noInstagramPosts = (dossier.instagramFact?.totalPostsObserved ?? 0) === 0;
  const noUserTruth = !dossier.manualTruthFact?.hasUserTruth;

  if (candidate.mode === "BUILD" && noInstagramPosts && noUserTruth) {
    violations.push("UNSUPPORTED_BUILD_MODE: Candidate asserted BUILD without confirmed operational or user-typed evidence. Missing data must produce UNKNOWN.");
  }

  // Rule 3: OPTIMIZE mode grounding
  if (candidate.mode === "OPTIMIZE") {
    const hasHistory = (dossier.instagramFact?.totalPostsObserved ?? 0) > 5 || dossier.manualTruthFact?.hasUserTruth;
    if (!hasHistory) {
      violations.push("UNSUPPORTED_OPTIMIZE_MODE: Candidate asserted OPTIMIZE without verified historical content or customer evidence.");
    }
  }

  // Rule 4: Cited evidence IDs existence — filter to valid ref IDs
  const cleanRefIds = (candidate.evidenceRefIds || []).filter(refId => refId && validRefIds.has(refId));
  if (cleanRefIds.length < (candidate.evidenceRefIds || []).length) {
    violations.push("UNGROUNDED_EVIDENCE_REF: Sanitized ungrounded evidenceRefIds from candidate.");
  }

  // Rule 5: Clarification question check
  if (candidate.clarificationRequest) {
    const q = candidate.clarificationRequest.question.toLowerCase();
    if (q.includes("what marketing strategy") || q.includes("build or optimize") || q.includes("which strategy do you want")) {
      violations.push("INVALID_CLARIFICATION_QUESTION: Question asks for strategy preferences instead of missing facts.");
    }
  }

  const hasModeViolation = violations.some(v => v.includes("UNSUPPORTED_BUILD_MODE") || v.includes("UNSUPPORTED_OPTIMIZE_MODE"));
  if (hasModeViolation) {
    return {
      judgeAuthorityId,
      status: "INSUFFICIENT_EVIDENCE",
      violations,
      rejectionReason: violations.join("; "),
      validatedMode: "UNKNOWN",
      validatedBottleneck: "UNKNOWN",
    };
  }

  return {
    judgeAuthorityId,
    status: violations.length > 0 ? "REPAIR_REQUIRED" : "ACCEPTED",
    violations,
    rejectionReason: violations.length > 0 ? violations.join("; ") : null,
    validatedMode: candidate.mode,
    validatedBottleneck: candidate.primaryBottleneck,
  };
}
