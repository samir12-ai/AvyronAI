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

export type CoverageDecision =
  | "COVERED"
  | "RELATED_BUT_UNPROVEN"
  | "NOT_COVERED";

export interface NormalizedTargetRole {
  targetId: string;
  roleName: string;
  description: string;
  buyerType: BuyerType;
  sourceLineages: Array<{ sourceField: string; rawSourceText: string }>;
}

export interface TargetRoleMatch {
  targetId: string;
  segmentId?: string;
  roleName: string;
  coverageDecision: CoverageDecision;
  targetIdentity: string;
  segmentIdentity: string;
  relationshipDescription: string;
  confidence: number;
  reason: string;
  matchedSegmentNames: string[];
}

export interface TargetCoverageResult {
  status: "FULL" | "PARTIAL" | "GAP" | "NOT_EVALUATED";
  supportedTargetRoles: string[];
  unsupportedTargetRoles: string[];
  evidenceGap: boolean;
  reason: string;
  targetRoles: NormalizedTargetRole[];
  matches?: TargetRoleMatch[];
  parentAuthorityIds?: string[];
  jobId?: string;
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
        if (dna.targetRoles && dna.targetRoles.length > 0) {
          for (const r of dna.targetRoles) {
            if (r.roleTitle && r.roleTitle.trim().length > 0) {
              sources.push({
                field: `targetUnderstanding.targetRoles.${r.roleType || 'ROLE'}`,
                text: `${r.roleTitle}${r.rationale ? `: ${r.rationale}` : ''}`,
                campaignId,
                accountId: effectiveAccountId
              });
            }
          }
        }
        if (dna.targetAudienceSegment && dna.targetAudienceSegment.trim().length > 0) {
          sources.push({
            field: "targetUnderstanding.targetAudienceSegment",
            text: dna.targetAudienceSegment.trim(),
            campaignId,
            accountId: effectiveAccountId
          });
        }
        if (dna.targetDecisionMaker && dna.targetDecisionMaker.trim().length > 0) {
          sources.push({
            field: "targetUnderstanding.targetDecisionMaker",
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
1. Extract normalized target roles explicitly stated in the business source items below.
2. Do not invent, infer, or hallucinate buyer roles, B2B defaults, B2C defaults, or unstated personas.
3. If the explicit target statement does not explicitly declare executive purchasing signoff, set buyerType = "UNKNOWN" or "PRACTITIONER".
4. Do not create duplicate semantic authorities when the same target appears in multiple Business Profile fields. If multiple fields refer to effectively the same explicit target (e.g., "SMB founders" and "SMB founders and owners"), merge them into a single semantic target and preserve ALL source lineages.
5. Every normalized target role MUST preserve its lineage in the sourceLineages array.

ALLOWED BUYER TYPES:
- ECONOMIC_BUYER
- TECHNICAL_EVALUATOR
- END_USER
- PRACTITIONER
- BUSINESS_OWNER
- UNKNOWN

BUSINESS SOURCE ITEMS:
${sources.map((s, idx) => `[Item ${idx + 1} | Field: ${s.field}]\n"${s.text}"`).join("\n\n")}

Return a JSON object:
{
  "targetRoles": [
    {
      "targetId": "target_1",
      "roleName": "Short descriptive role name",
      "description": "Concise description",
      "buyerType": "ECONOMIC_BUYER" | "TECHNICAL_EVALUATOR" | "END_USER" | "PRACTITIONER" | "BUSINESS_OWNER" | "UNKNOWN",
      "sourceLineages": [
        {
          "sourceField": "source field name",
          "rawSourceText": "exact text from source item"
        }
      ]
    }
  ]
}`;

    try {
      const { aiChat } = await import("../ai-client");
      const res = await aiChat({
        messages: [{ role: "user", content: resolverPrompt }],
        model,
        max_tokens: 16000,
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
        sourceLineages: Array.isArray(t.sourceLineages) ? t.sourceLineages.map((l: any) => ({
          sourceField: String(l.sourceField || ""),
          rawSourceText: String(l.rawSourceText || "")
        })) : []
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
1. NO TARGET_ROLE_INVENTION: Does every proposed target role originate directly from the text of the source items?
2. ACCURATE BUYER TYPE: Is the buyerType supported by the source text? (Note: buyerType 'UNKNOWN' is fully valid whenever the specific buyer role is not explicitly specified in the source text).
3. PROVENANCE VERIFIED: Do the rawSourceText strings in sourceLineages match the original source text?

DECISION INSTRUCTION:
- Set "valid": true if the proposed target roles satisfy all criteria above.
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
        max_tokens: 4000,
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

    const matcherPrompt = `You are an expert market intelligence evaluator determining AUDIENCE IDENTITY / TARGET MEMBERSHIP.
${repairSection}
THE ONLY QUESTION YOU ANSWER:
"Based only on audience identity, role, function, and context, does this evidence-derived Audience Segment legitimately represent people included in the explicit Business Target?"

CRITICAL RULE - NO PRODUCT OR PAIN RELEVANCE:
You must NEVER ask or consider:
- Does our product solve this segment's pain?
- Is this pain relevant to our product?
- Is this segment commercially attractive?
- Will this segment buy?
- Is this a CORE pain?
- Is there Product Fit?
Pain text must NOT determine target membership. Never use "What are they complaining about?" as evidence that they are or are not the business target.

THREE SEMANTIC OUTCOMES:

1. COVERED
The Audience segment legitimately represents people included in the explicit Business Target.
- Wording does NOT need to match. Titles do NOT need to be identical.
- The segment may be somewhat broader or narrower. What matters is the actual semantic identity/function.
- Example: Target: "SMB founders and owners" / Segment: "SMB Founders and Owners Struggling with Billing and Customer Service Issues" -> COVERED.

2. RELATED_BUT_UNPROVEN
There is a meaningful overlap, but the Audience authority does not establish strongly enough that the intended Business Target is actually represented.
- Example: Target: "Marketing Managers" / Segment: "Business professionals interested in AI" -> RELATED_BUT_UNPROVEN.

3. NOT_COVERED
The Audience segment genuinely represents a different population from the Business Target.
- Example: Target: "CEOs" / Segment: "Customer support representatives" -> NOT_COVERED.

EXPLICIT BUSINESS TARGET ROLES:
${JSON.stringify(targetRoles, null, 2)}

ACCEPTED EVIDENCE-DERIVED AUDIENCE SEGMENTS (Evaluate against every target):
${JSON.stringify(audienceSegments.map(s => ({
  segmentId: s.id || s.name,
  name: s.name,
  role: s.role,
  segmentDefinition: s.segmentDefinition
})), null, 2)}

Return a JSON object evaluating EVERY combination of Target Role and Audience Segment that is relevant. You MUST output a match object for EVERY target-segment combination provided.
{
  "matches": [
    {
      "targetId": "target_1",
      "segmentId": "segment_id_or_name",
      "roleName": "Target role name",
      "matchedSegmentNames": ["Segment Name"],
      "coverageDecision": "COVERED" | "RELATED_BUT_UNPROVEN" | "NOT_COVERED",
      "targetIdentity": "Who the business explicitly wants",
      "segmentIdentity": "Who the Audience evidence actually represents",
      "relationshipDescription": "Describe role relationship and functional relationship (broader/narrower is okay to mention here)",
      "confidence": 0.95,
      "reason": "Concise business rationale. Do NOT mention pain relevance."
    }
  ]
}`;

    try {
      const { aiChat } = await import("../ai-client");
      const res = await aiChat({
        messages: [{ role: "user", content: matcherPrompt }],
        model,
        max_tokens: 4000,
        temperature: 0.1,
        response_format: { type: "json_object" },
        accountId: "system",
        endpoint: "target-role-matcher",
        timeoutMs: 90000,
      });

      const parsed = JSON.parse(res.choices[0]?.message?.content || '{"matches":[]}');
      const matches: TargetRoleMatch[] = (parsed.matches || []).map((m: any) => {
        const coverageDecision: CoverageDecision = ["COVERED", "RELATED_BUT_UNPROVEN", "NOT_COVERED"].includes(m.coverageDecision) ? m.coverageDecision : "NOT_COVERED";

        return {
          targetId: m.targetId || "",
          segmentId: m.segmentId || "",
          roleName: m.roleName || "",
          coverageDecision,
          relationshipDescription: String(m.relationshipDescription || ""),
          targetIdentity: String(m.targetIdentity || ""),
          segmentIdentity: String(m.segmentIdentity || ""),
          confidence: Number(m.confidence) || 0,
          reason: String(m.reason || ""),
          matchedSegmentNames: Array.isArray(m.matchedSegmentNames) ? m.matchedSegmentNames : [],
        };
      });

      // ROLE-MATCH JUDGE
      const judgePrompt = `You are the Role-Match Judge evaluating TARGET MEMBERSHIP decisions.

EXPLICIT BUSINESS TARGET ROLES:
${JSON.stringify(targetRoles, null, 2)}

ACCEPTED AUDIENCE SEGMENTS:
${JSON.stringify(audienceSegments.map(s => ({ id: s.id, name: s.name, role: s.role, segmentDefinition: s.segmentDefinition })), null, 2)}

PROPOSED ROLE MATCHES:
${JSON.stringify(matches, null, 2)}

JUDGE VERIFICATION CRITERIA (Answer YES/NO internally before deciding):
1. Did the Matcher preserve the explicit Business Target?
2. Did it preserve the Audience Segment identity?
3. Did it judge WHO the segment represents rather than what pain they have?
4. Is COVERED supported by legitimate semantic inclusion?
5. Is RELATED_BUT_UNPROVEN more appropriate when membership cannot be proven?
6. Is NOT_COVERED supported by an actual audience-role/context contradiction?
7. Did Product relevance contaminate the decision?
8. Did pain relevance contaminate the decision?
9. Did wording specificity alone cause rejection?

DECISION INSTRUCTION:
- Set "valid": true if you APPROVE the proposed semantic conclusions.
- Set "valid": false ONLY if you REJECT the proposed evaluation due to violations.

Return a JSON object:
{
  "valid": boolean,
  "rejectionCode": "PRODUCT_RELEVANCE_LEAK" | "PAIN_RELEVANCE_LEAK" | "TARGET_MEANING_DRIFT" | "SEGMENT_MEANING_DRIFT" | "VALID_TARGET_MEMBERSHIP_REJECTED" | "GENERIC_OVERLAP_MISTAKEN_FOR_COVERAGE" | "UNPROVEN_RELATIONSHIP_MISTAKEN_FOR_REJECTION" | "ROLE_CONTRADICTION_IGNORED" | "WORDING_SPECIFICITY_OVERWEIGHTED" | null,
  "reasons": ["string"]
}`;

      const judgeRes = await aiChat({
        messages: [{ role: "user", content: judgePrompt }],
        model: judgeModel,
        max_tokens: 2000,
        temperature: 0.1,
        response_format: { type: "json_object" },
        accountId: "system",
        endpoint: "role-match-judge",
        timeoutMs: 90000,
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
  explicitTargetInput?: string,
  jobId?: string,
  parentAuthorityIds?: string[]
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
  const supportedTargetRoles = matches.filter(m => m.coverageDecision === "COVERED").map(m => m.roleName);
  const unsupportedTargetRoles = matches.filter(m => m.coverageDecision === "NOT_COVERED" || m.coverageDecision === "RELATED_BUT_UNPROVEN").map(m => m.roleName);

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
