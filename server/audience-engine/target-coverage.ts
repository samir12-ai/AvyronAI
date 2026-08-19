import { db } from "../db";
import { growthCampaigns, businessDataLayer } from "@shared/schema";
import { eq, and } from "drizzle-orm";
import { loadProductDNA } from "../shared/product-dna";
import type { AudienceSegment } from "./engine";

export type BuyerType =
  | "ECONOMIC_BUYER"
  | "TECHNICAL_EVALUATOR"
  | "END_USER"
  | "PRACTITIONER"
  | "BUSINESS_OWNER"
  | "UNKNOWN";

export type RoleMatchType =
  | "EXACT_MATCH"
  | "VALID_SEMANTIC_MATCH"
  | "BROADER_THAN_TARGET"
  | "NARROWER_THAN_TARGET"
  | "BUYER_USER_MISMATCH"
  | "INSUFFICIENT_EVIDENCE"
  | "NO_MATCH";

export interface NormalizedTargetRole {
  targetId: string;
  roleName: string;
  description: string;
  buyerType: BuyerType;
  sourceField: string;
  rawSourceText: string;
}

export interface TargetRoleMatch {
  targetId: string;
  roleName: string;
  matchType: RoleMatchType;
  isCovered: boolean;
  matchedSegmentNames: string[];
  matchedRoles: string[];
  reasoning: string;
}

export interface TargetCoverageResult {
  status: "FULL" | "PARTIAL" | "GAP" | "NOT_EVALUATED";
  supportedTargetRoles: string[];
  unsupportedTargetRoles: string[];
  evidenceGap: boolean;
  reason: string;
  targetRoles: NormalizedTargetRole[];
  matches?: TargetRoleMatch[];
}

export interface BusinessTargetSourceItem {
  field: string;
  text: string;
  campaignId: string;
  accountId: string;
}

export interface EvidenceOwnershipItem {
  evidenceId: string;
  stableRecordId: string;
  sourceTable: string;
  campaignId: string;
  accountId: string;
}

export interface AudienceLineage {
  campaignId: string;
  accountId: string;
  audienceSnapshotId?: string;
  evidenceOwnership?: EvidenceOwnershipItem[];
}

const RESOLVER_MODEL = "gpt-4.1-mini";
const JUDGE_MODEL = "gpt-4o-mini";

// 1. EXTRACT BUSINESS-AUTHORED TARGET INTENT
export async function extractBusinessTargetAuthority(
  campaignId: string,
  accountId?: string,
  explicitTargetInput?: string
): Promise<BusinessTargetSourceItem[]> {
  const sources: BusinessTargetSourceItem[] = [];
  const effectiveAccountId = accountId || "default";

  if (explicitTargetInput && explicitTargetInput.trim().length > 0) {
    sources.push({
      field: "explicitTargetInput",
      text: explicitTargetInput.trim(),
      campaignId,
      accountId: effectiveAccountId
    });
  }

  try {
    // A. Product DNA / Business Data Layer (targetAudienceSegment, targetDecisionMaker)
    if (accountId) {
      const dna = await loadProductDNA(campaignId, accountId);
      if (dna) {
        if (dna.targetAudienceSegment && dna.targetAudienceSegment.trim().length > 0) {
          sources.push({
            field: "businessDataLayer.targetAudienceSegment",
            text: dna.targetAudienceSegment.trim(),
            campaignId,
            accountId: effectiveAccountId
          });
        }
        if (dna.targetDecisionMaker && dna.targetDecisionMaker.trim().length > 0) {
          sources.push({
            field: "businessDataLayer.targetDecisionMaker",
            text: dna.targetDecisionMaker.trim(),
            campaignId,
            accountId: effectiveAccountId
          });
        }
      }
    } else {
      // Query businessDataLayer by campaignId alone if accountId not supplied
      const [bizData] = await db.select().from(businessDataLayer)
        .where(eq(businessDataLayer.campaignId, campaignId))
        .limit(1);

      if (bizData) {
        if (bizData.targetAudienceSegment && bizData.targetAudienceSegment.trim().length > 0) {
          sources.push({
            field: "businessDataLayer.targetAudienceSegment",
            text: bizData.targetAudienceSegment.trim(),
            campaignId,
            accountId: bizData.accountId || effectiveAccountId
          });
        }
        if (bizData.targetDecisionMaker && bizData.targetDecisionMaker.trim().length > 0) {
          sources.push({
            field: "businessDataLayer.targetDecisionMaker",
            text: bizData.targetDecisionMaker.trim(),
            campaignId,
            accountId: bizData.accountId || effectiveAccountId
          });
        }
      }
    }

    // B. Campaign productAnchor
    const [camp] = await db.select().from(growthCampaigns)
      .where(eq(growthCampaigns.id, campaignId))
      .limit(1);

    if (camp?.productAnchor && typeof camp.productAnchor === "object") {
      const anchor: any = camp.productAnchor;
      if (anchor.targetAudience && typeof anchor.targetAudience === "string" && anchor.targetAudience.trim().length > 0) {
        sources.push({
          field: "growthCampaigns.productAnchor.targetAudience",
          text: anchor.targetAudience.trim(),
          campaignId,
          accountId: effectiveAccountId
        });
      }
    }
  } catch (err) {
    console.warn("[TargetCoverage] DB target extraction notice:", err);
  }

  return sources;
}

// 2. LLM TARGET RESOLVER + TARGET AUTHORITY JUDGE
export async function resolveTargetRolesWithJudge(
  sources: BusinessTargetSourceItem[],
  model: string = RESOLVER_MODEL,
  judgeModel: string = JUDGE_MODEL
): Promise<{ valid: boolean; targetRoles: NormalizedTargetRole[]; rejectionReasons?: string[] }> {
  if (sources.length === 0) {
    return { valid: false, targetRoles: [], rejectionReasons: ["No source items provided"] };
  }

  const MAX_RETRIES = 3;
  let repairFeedback: string | undefined;
  let lastReasons: string[] = [];

  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    const repairSection = repairFeedback ? `\nCRITICAL PREVIOUS JUDGE REPAIR DIRECTIVE (You MUST follow this strictly):\n${repairFeedback}\n` : "";

    const resolverPrompt = `You are an expert target audience parser extracting the EXPLICIT business target roles intended by this business.
${repairSection}
RULES:
1. ONLY extract target roles explicitly stated in the business source items below.
2. Extract 1 normalized target role per business source item, using the exact role phrasing from that source item (e.g. if the item states "Marketing Operations Lead and Growth Team Managers", keep that exact title as roleName; do not split or subdivide it).
3. DO NOT invent, infer, or hallucinate buyer roles, B2B defaults, B2C defaults, or unstated personas.
4. If the explicit target statement does not explicitly declare executive purchasing signoff (e.g. CEO, CFO, procurement head), set buyerType = "UNKNOWN" or "PRACTITIONER".
5. Every normalized target role MUST preserve its lineage: exact sourceField and exact rawSourceText.

ALLOWED BUYER TYPES:
- ECONOMIC_BUYER (Only for executive titles with explicit sign-off / budget ownership: e.g. CEO, CFO, VP of Procurement)
- TECHNICAL_EVALUATOR (Evaluates technical specs: e.g. Lead Architect, Security Engineer)
- END_USER (Uses the software day-to-day: e.g. staff member, subscriber)
- PRACTITIONER (Operator or team lead who executes hands-on workflows: e.g. Marketing Lead, Content Creator, Operator)
- BUSINESS_OWNER (Small business or agency owner)
- UNKNOWN (Target statement does not explicitly prove purchasing sign-off)

BUSINESS SOURCE ITEMS:
${sources.map((s, idx) => `[Item ${idx + 1} | Field: ${s.field}]\n"${s.text}"`).join("\n\n")}

Return a JSON object:
{
  "targetRoles": [
    {
      "targetId": "target_1",
      "roleName": "Short descriptive role name",
      "description": "Concise description of the explicit target role from source text",
      "buyerType": "ECONOMIC_BUYER" | "TECHNICAL_EVALUATOR" | "END_USER" | "PRACTITIONER" | "BUSINESS_OWNER" | "UNKNOWN",
      "sourceField": "source field name",
      "rawSourceText": "exact text from source item that proves this target"
    }
  ]
}`;

    try {
      const { aiChat } = await import("../ai-client");
      const res = await aiChat({
        messages: [{ role: "user", content: resolverPrompt }],
        model,
        max_tokens: 1500,
        temperature: 0.1,
        response_format: { type: "json_object" },
        accountId: "system",
        endpoint: "target-authority-resolver"
      });

      const parsed = JSON.parse(res.choices[0]?.message?.content || '{"targetRoles":[]}');
      const targetRoles: NormalizedTargetRole[] = (parsed.targetRoles || []).map((t: any, idx: number) => ({
        targetId: t.targetId || `target_${idx + 1}`,
        roleName: String(t.roleName || "").trim(),
        description: String(t.description || "").trim(),
        buyerType: (["ECONOMIC_BUYER", "TECHNICAL_EVALUATOR", "END_USER", "PRACTITIONER", "BUSINESS_OWNER", "UNKNOWN"].includes(t.buyerType)
          ? t.buyerType
          : "UNKNOWN") as BuyerType,
        sourceField: String(t.sourceField || ""),
        rawSourceText: String(t.rawSourceText || "")
      })).filter((t: NormalizedTargetRole) => t.roleName.length > 0);

      if (targetRoles.length === 0) {
        return { valid: false, targetRoles: [], rejectionReasons: ["No valid target roles extracted from sources"] };
      }

      // TARGET AUTHORITY JUDGE
      const judgePrompt = `You are the Target Authority Judge evaluating whether extracted target roles faithfully reflect explicit business intent.

ORIGINAL BUSINESS SOURCE ITEMS:
${sources.map((s, idx) => `[Item ${idx + 1} | Field: ${s.field}]\n"${s.text}"`).join("\n\n")}

PROPOSED NORMALIZED TARGET ROLES:
${JSON.stringify(targetRoles, null, 2)}

JUDGE VERIFICATION CRITERIA:
1. NO TARGET_ROLE_INVENTION: Does every proposed target role originate directly from the text of the source items? (Pass if the roles accurately represent the target personas stated in the source text. Only reject if an unmentioned role was invented).
2. ACCURATE BUYER TYPE: Is the buyerType supported by the source text? (UNKNOWN, PRACTITIONER, and BUSINESS_OWNER are always valid. Do not reject a role for using UNKNOWN or PRACTITIONER. Only reject if an unstated executive budget authority like ECONOMIC_BUYER was fabricated).
3. PROVENANCE VERIFIED: Does rawSourceText in each target role match the original source text?

DECISION INSTRUCTION:
- Set "valid": true if the proposed target roles satisfy all 3 criteria above.
- Set "valid": false ONLY if the proposed roles violate one of the criteria.

Return a JSON object:
{
  "valid": boolean,
  "rejectionCode": "TARGET_ROLE_INVENTION" | "FABRICATED_BUYER_TYPE" | "LINEAGE_MISMATCH" | null,
  "reasons": ["string"]
}`;

      const judgeRes = await aiChat({
        messages: [{ role: "user", content: judgePrompt }],
        model: judgeModel,
        max_tokens: 1000,
        temperature: 0.1,
        response_format: { type: "json_object" },
        accountId: "system",
        endpoint: "target-authority-judge"
      });

      const judgeParsed = JSON.parse(judgeRes.choices[0]?.message?.content || '{"valid":false,"reasons":["Judge parsing failed"]}');
      if (judgeParsed.valid === true) {
        return { valid: true, targetRoles };
      } else {
        lastReasons = Array.isArray(judgeParsed.reasons) ? judgeParsed.reasons : [String(judgeParsed.reasons || "Rejected by judge")];
        repairFeedback = `Judge Rejection (${judgeParsed.rejectionCode || "INVALID_TARGET"}): ${lastReasons.join("; ")}`;
      }
    } catch (err: any) {
      console.error("[TargetCoverage] Resolver/Judge attempt error:", err);
      lastReasons = [err?.message || "Resolver execution failed"];
    }
  }

  return { valid: false, targetRoles: [], rejectionReasons: lastReasons };
}

// 3. SEMANTIC ROLE MATCHER + ROLE-MATCH JUDGE
export async function matchAudienceToTargetsWithJudge(
  targetRoles: NormalizedTargetRole[],
  audienceSegments: AudienceSegment[],
  model: string = RESOLVER_MODEL,
  judgeModel: string = JUDGE_MODEL
): Promise<{ valid: boolean; matches: TargetRoleMatch[]; rejectionReasons?: string[] }> {
  if (targetRoles.length === 0 || audienceSegments.length === 0) {
    return { valid: false, matches: [], rejectionReasons: ["Missing targets or audience segments"] };
  }

  const MAX_RETRIES = 2;
  let repairFeedback: string | undefined;
  let lastReasons: string[] = [];

  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    const repairSection = repairFeedback ? `\nPREVIOUS ROLE-MATCH JUDGE REPAIR DIRECTIVE (Fix these issues):\n${repairFeedback}\n` : "";

    const matcherPrompt = `You are an expert market intelligence evaluator comparing explicit Business Target Roles against evidence-derived Canonical Audience Segments.
${repairSection}
SEMANTIC MATCH TYPES:
1. EXACT_MATCH: The audience segment explicitly and directly represents this exact buyer role and function. (Counts as COVERED).
2. VALID_SEMANTIC_MATCH: Different wording, but the evidence-derived segment definition, role, and pains prove this exact buyer function and context. (Counts as COVERED).
3. BROADER_THAN_TARGET: The evidence describes a general user, operator, or broad practitioner category, but CANNOT confirm the specific decision maker or niche targeted. (DOES NOT COUNT AS COVERED).
4. NARROWER_THAN_TARGET: The evidence describes a very narrow sub-demographic that represents only a minor fraction of the target. (DOES NOT COUNT AS COVERED).
5. BUYER_USER_MISMATCH: The business explicitly targets an economic buyer, business owner, or decision maker, but the audience evidence only represents complaining end users or software support tickets. (DOES NOT COUNT AS COVERED).
6. INSUFFICIENT_EVIDENCE: There is speculative mention or mention without sufficient corroborating evidence to establish the role. (DOES NOT COUNT AS COVERED).
7. NO_MATCH: No audience segment corresponds to this target role. (DOES NOT COUNT AS COVERED).

IMPORTANT RULES:
- ONLY EXACT_MATCH and VALID_SEMANTIC_MATCH may have isCovered: true. All other match types MUST have isCovered: false.
- DO NOT collapse end-user complaints or general software users into Business Owners or Economic Buyers without explicit evidence.
- DO NOT treat broad practitioners as automatically covering specific executive roles (e.g. Marketing Director, VP, Agency Owner).

EXPLICIT BUSINESS TARGET ROLES:
${JSON.stringify(targetRoles, null, 2)}

ACCEPTED EVIDENCE-DERIVED AUDIENCE SEGMENTS:
${JSON.stringify(audienceSegments.map(s => ({
  name: s.name,
  role: s.role,
  roleClaim: s.roleClaim,
  segmentDefinition: s.segmentDefinition,
  pains: s.pains,
  groundingRefs: s.groundingRefs
})), null, 2)}

Return a JSON object:
{
  "matches": [
    {
      "targetId": "target_1",
      "roleName": "Target role name",
      "matchType": "EXACT_MATCH" | "VALID_SEMANTIC_MATCH" | "BROADER_THAN_TARGET" | "NARROWER_THAN_TARGET" | "BUYER_USER_MISMATCH" | "INSUFFICIENT_EVIDENCE" | "NO_MATCH",
      "isCovered": boolean,
      "matchedSegmentNames": ["Segment Name"],
      "matchedRoles": ["END_CONSUMER" | "PRACTITIONER" | ...],
      "reasoning": "Concise justification for why this target role is or is not covered by the audience evidence"
    }
  ]
}`;

    try {
      const { aiChat } = await import("../ai-client");
      const res = await aiChat({
        messages: [{ role: "user", content: matcherPrompt }],
        model,
        max_tokens: 2000,
        temperature: 0.1,
        response_format: { type: "json_object" },
        accountId: "system",
        endpoint: "target-role-matcher"
      });

      const parsed = JSON.parse(res.choices[0]?.message?.content || '{"matches":[]}');
      const matches: TargetRoleMatch[] = (parsed.matches || []).map((m: any) => {
        const mType: RoleMatchType = [
          "EXACT_MATCH", "VALID_SEMANTIC_MATCH", "BROADER_THAN_TARGET",
          "NARROWER_THAN_TARGET", "BUYER_USER_MISMATCH", "INSUFFICIENT_EVIDENCE", "NO_MATCH"
        ].includes(m.matchType) ? m.matchType : "NO_MATCH";

        const isCovered = (mType === "EXACT_MATCH" || mType === "VALID_SEMANTIC_MATCH") && m.isCovered === true;

        return {
          targetId: m.targetId,
          roleName: m.roleName,
          matchType: mType,
          isCovered,
          matchedSegmentNames: Array.isArray(m.matchedSegmentNames) ? m.matchedSegmentNames : [],
          matchedRoles: Array.isArray(m.matchedRoles) ? m.matchedRoles : [],
          reasoning: String(m.reasoning || "")
        };
      });

      // ROLE-MATCH JUDGE
      const judgePrompt = `You are the Role-Match Judge evaluating whether the audience evidence legitimately covers the business target roles.

EXPLICIT BUSINESS TARGET ROLES:
${JSON.stringify(targetRoles, null, 2)}

ACCEPTED AUDIENCE SEGMENTS:
${JSON.stringify(audienceSegments.map(s => ({ name: s.name, role: s.role, roleClaim: s.roleClaim, segmentDefinition: s.segmentDefinition, pains: s.pains })), null, 2)}

PROPOSED ROLE MATCHES:
${JSON.stringify(matches, null, 2)}

JUDGE VERIFICATION CRITERIA:
1. NO BUYER_USER_ROLE_COLLAPSE: Were complaining end-users or support ticket commenters classified as matching an Economic Buyer or Business Owner? (If so, this MUST be BUYER_USER_MISMATCH and isCovered MUST be false).
2. NO UNWARRANTED_BROADENING: Was a broad category (e.g. general practitioner) marked as an EXACT_MATCH or VALID_SEMANTIC_MATCH for a specific executive or distinct business role without proof? (If broader, it MUST be BROADER_THAN_TARGET and isCovered MUST be false).
3. STRICT COVERAGE ENFORCEMENT: Are ONLY EXACT_MATCH and VALID_SEMANTIC_MATCH marked isCovered: true?
4. FACTUAL REASONING: Does the reasoning accurately reflect what the evidence-derived segments state?

DECISION INSTRUCTION:
- Set "valid": true if you APPROVE the proposed matches (i.e. the matchType and isCovered determinations are correct, whether covered or not covered). If the matcher correctly determined that a target is NOT covered (e.g. isCovered: false due to BROADER_THAN_TARGET, BUYER_USER_MISMATCH, or NO_MATCH), you MUST return "valid": true.
- Set "valid": false ONLY if you REJECT the proposed evaluation (e.g. if the matcher falsely set isCovered: true for an unproven role, or missed a buyer/user role collapse).

Return a JSON object:
{
  "valid": boolean,
  "rejectionCode": "BUYER_USER_ROLE_COLLAPSE" | "UNWARRANTED_BROADENING" | "INVALID_COVERAGE_FLAG" | "MISCLASSIFIED_MATCH" | null,
  "reasons": ["string"]
}`;

      const judgeRes = await aiChat({
        messages: [{ role: "user", content: judgePrompt }],
        model: judgeModel,
        max_tokens: 1000,
        temperature: 0.1,
        response_format: { type: "json_object" },
        accountId: "system",
        endpoint: "role-match-judge"
      });

      const judgeParsed = JSON.parse(judgeRes.choices[0]?.message?.content || '{"valid":false,"reasons":["Judge parsing failed"]}');
      if (judgeParsed.valid === true) {
        return { valid: true, matches };
      } else {
        lastReasons = Array.isArray(judgeParsed.reasons) ? judgeParsed.reasons : [String(judgeParsed.reasons || "Rejected by role match judge")];
        repairFeedback = `Role-Match Judge Rejection (${judgeParsed.rejectionCode || "INVALID_MATCH"}): ${lastReasons.join("; ")}`;
      }
    } catch (err: any) {
      console.error("[TargetCoverage] Matcher/Judge attempt error:", err);
      lastReasons = [err?.message || "Matcher execution failed"];
    }
  }

  return { valid: false, matches: [], rejectionReasons: lastReasons };
}

// 4. MAIN TARGET COVERAGE EVALUATOR
export async function evaluateTargetCoverage(
  campaignId: string,
  accountId: string | undefined,
  audienceSegments: AudienceSegment[],
  audienceStatus: string,
  audienceLineage?: AudienceLineage,
  explicitTargetInput?: string
): Promise<TargetCoverageResult> {
  const effectiveAccountId = accountId || "default";

  // HARD STRUCTURAL LINEAGE INVARIANTS:
  // 1. Audience Lineage Check
  if (audienceLineage) {
    if (audienceLineage.campaignId !== campaignId) {
      console.error(
        `[TargetCoverage] CROSS_CAMPAIGN_AUTHORITY_MISMATCH: requested campaign (${campaignId}) does not match audience lineage campaign (${audienceLineage.campaignId})`
      );
      return {
        status: "NOT_EVALUATED",
        supportedTargetRoles: [],
        unsupportedTargetRoles: [],
        evidenceGap: false,
        reason: "CROSS_CAMPAIGN_AUTHORITY_MISMATCH",
        targetRoles: []
      };
    }
    if (audienceLineage.accountId !== effectiveAccountId) {
      console.error(
        `[TargetCoverage] CROSS_ACCOUNT_AUTHORITY_MISMATCH: requested account (${effectiveAccountId}) does not match audience lineage account (${audienceLineage.accountId})`
      );
      return {
        status: "NOT_EVALUATED",
        supportedTargetRoles: [],
        unsupportedTargetRoles: [],
        evidenceGap: false,
        reason: "CROSS_ACCOUNT_AUTHORITY_MISMATCH",
        targetRoles: []
      };
    }
  }

  // 2. Cross-Snapshot Mixing Invariant:
  // Audience segments cannot be mixed across different snapshot IDs
  if (audienceSegments.length > 1) {
    const snapshotIds = new Set(
      audienceSegments
        .map(s => s.inputSnapshotId)
        .filter((id): id is string => typeof id === "string" && id.trim().length > 0)
    );
    if (snapshotIds.size > 1) {
      console.error(
        `[TargetCoverage] CROSS_SNAPSHOT_SEGMENT_MISMATCH: audience segments originate from multiple distinct snapshots: ${Array.from(snapshotIds).join(", ")}`
      );
      return {
        status: "NOT_EVALUATED",
        supportedTargetRoles: [],
        unsupportedTargetRoles: [],
        evidenceGap: false,
        reason: "CROSS_SNAPSHOT_SEGMENT_MISMATCH",
        targetRoles: []
      };
    }
  }

  // 3. Raw Evidence Lineage Check (if evidenceOwnership provided)
  if (audienceLineage?.evidenceOwnership && audienceLineage.evidenceOwnership.length > 0) {
    const evidenceMap = new Map(
      audienceLineage.evidenceOwnership.map(e => [e.evidenceId, e])
    );

    for (const seg of audienceSegments) {
      const citedIds = [
        ...(seg.roleEvidenceIds || []),
        ...(seg.roleClaim?.evidenceIds || []),
        ...(seg.segmentDefinition?.evidenceIds || []),
        ...(seg.pains || []).flatMap(p => p.evidenceIds || []),
        ...(seg.desires || []).flatMap(d => d.evidenceIds || []),
        ...(seg.objections || []).flatMap(o => o.evidenceIds || []),
        ...(seg.motivations || []).flatMap(m => m.evidenceIds || []),
        ...(seg.outcomes || []).flatMap(o => o.evidenceIds || [])
      ];

      for (const evId of citedIds) {
        const ev = evidenceMap.get(evId);
        if (ev) {
          if (ev.campaignId !== campaignId) {
            console.error(
              `[TargetCoverage] CROSS_CAMPAIGN_EVIDENCE_LINEAGE_MISMATCH: cited evidence ${evId} belongs to campaign ${ev.campaignId}, expected ${campaignId}`
            );
            return {
              status: "NOT_EVALUATED",
              supportedTargetRoles: [],
              unsupportedTargetRoles: [],
              evidenceGap: false,
              reason: "CROSS_CAMPAIGN_EVIDENCE_LINEAGE_MISMATCH",
              targetRoles: []
            };
          }
          if (ev.accountId !== effectiveAccountId) {
            console.error(
              `[TargetCoverage] CROSS_ACCOUNT_EVIDENCE_LINEAGE_MISMATCH: cited evidence ${evId} belongs to account ${ev.accountId}, expected ${effectiveAccountId}`
            );
            return {
              status: "NOT_EVALUATED",
              supportedTargetRoles: [],
              unsupportedTargetRoles: [],
              evidenceGap: false,
              reason: "CROSS_ACCOUNT_EVIDENCE_LINEAGE_MISMATCH",
              targetRoles: []
            };
          }
        }
      }
    }
  }

  // A. If Audience itself is incomplete/defensive/failed -> NOT_EVALUATED
  if (audienceStatus !== "COMPLETE" && audienceStatus !== "PARTIAL") {
    return {
      status: "NOT_EVALUATED",
      supportedTargetRoles: [],
      unsupportedTargetRoles: [],
      evidenceGap: false,
      reason: "Target coverage not evaluated due to incomplete audience status.",
      targetRoles: []
    };
  }

  // B. Extract explicit business-authored target authority
  const sourceItems = await extractBusinessTargetAuthority(campaignId, accountId, explicitTargetInput);

  // Lineage assertion on extracted business target authority
  for (const item of sourceItems) {
    if (item.campaignId !== campaignId) {
      console.error(
        `[TargetCoverage] CROSS_CAMPAIGN_AUTHORITY_MISMATCH: requested campaign (${campaignId}) does not match target authority source item campaign (${item.campaignId})`
      );
      return {
        status: "NOT_EVALUATED",
        supportedTargetRoles: [],
        unsupportedTargetRoles: [],
        evidenceGap: false,
        reason: "CROSS_CAMPAIGN_AUTHORITY_MISMATCH",
        targetRoles: []
      };
    }
    if (item.accountId !== effectiveAccountId) {
      console.error(
        `[TargetCoverage] CROSS_ACCOUNT_AUTHORITY_MISMATCH: requested account (${effectiveAccountId}) does not match target authority source item account (${item.accountId})`
      );
      return {
        status: "NOT_EVALUATED",
        supportedTargetRoles: [],
        unsupportedTargetRoles: [],
        evidenceGap: false,
        reason: "CROSS_ACCOUNT_AUTHORITY_MISMATCH",
        targetRoles: []
      };
    }
  }

  if (sourceItems.length === 0) {
    console.log(`[TargetCoverage] TARGET_AUTHORITY_MISSING — no explicit business target authority found for campaign ${campaignId}`);
    return {
      status: "NOT_EVALUATED",
      supportedTargetRoles: [],
      unsupportedTargetRoles: [],
      evidenceGap: false,
      reason: "TARGET_AUTHORITY_MISSING",
      targetRoles: []
    };
  }

  // C. Resolve Target Roles via LLM + Target Authority Judge
  const targetResolution = await resolveTargetRolesWithJudge(sourceItems);
  if (!targetResolution.valid || targetResolution.targetRoles.length === 0) {
    console.log(`[TargetCoverage] TARGET_AUTHORITY_INVALID — Judge rejected target roles: ${targetResolution.rejectionReasons?.join("; ")}`);
    return {
      status: "NOT_EVALUATED",
      supportedTargetRoles: [],
      unsupportedTargetRoles: [],
      evidenceGap: false,
      reason: `TARGET_AUTHORITY_INVALID: ${targetResolution.rejectionReasons?.join("; ") || "Extraction unverified"}`,
      targetRoles: []
    };
  }

  const { targetRoles } = targetResolution;

  // D. Match Audience Segments to Target Roles via LLM + Role-Match Judge
  const matchResult = await matchAudienceToTargetsWithJudge(targetRoles, audienceSegments);
  if (!matchResult.valid || matchResult.matches.length === 0) {
    console.log(`[TargetCoverage] ROLE_MATCH_UNRESOLVED — Judge rejected matches: ${matchResult.rejectionReasons?.join("; ")}`);
    return {
      status: "NOT_EVALUATED",
      supportedTargetRoles: [],
      unsupportedTargetRoles: targetRoles.map(t => t.roleName),
      evidenceGap: false,
      reason: `ROLE_MATCH_UNRESOLVED: ${matchResult.rejectionReasons?.join("; ") || "Match unverified"}`,
      targetRoles,
      matches: []
    };
  }

  const { matches } = matchResult;

  // E. Deterministic Aggregation
  const supportedTargetRoles = matches.filter(m => m.isCovered).map(m => m.roleName);
  const unsupportedTargetRoles = matches.filter(m => !m.isCovered).map(m => m.roleName);

  let status: "FULL" | "PARTIAL" | "GAP" = "GAP";
  let evidenceGap = false;
  let reason = "";

  if (supportedTargetRoles.length === targetRoles.length) {
    status = "FULL";
    evidenceGap = false;
    reason = `All ${targetRoles.length} explicit business target roles are supported by market evidence.`;
  } else if (supportedTargetRoles.length > 0) {
    status = "PARTIAL";
    evidenceGap = false;
    reason = `Partial coverage: ${supportedTargetRoles.length}/${targetRoles.length} target roles supported. Unsupported: ${unsupportedTargetRoles.join(", ")}`;
  } else {
    status = "GAP";
    evidenceGap = true;
    reason = `TARGET_AUDIENCE_EVIDENCE_GAP: No material evidence found for target roles: ${unsupportedTargetRoles.join(", ")}`;
  }

  console.log(`[TargetCoverage] Evaluation COMPLETE | status=${status} | supported=${supportedTargetRoles.length}/${targetRoles.length} | evidenceGap=${evidenceGap}`);

  return {
    status,
    supportedTargetRoles,
    unsupportedTargetRoles,
    evidenceGap,
    reason,
    targetRoles,
    matches
  };
}
