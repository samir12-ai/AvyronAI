import { aiChat } from "../ai-client";
import { type AuthoritativeAudiencePain } from "./audience-pain-registry";
import crypto from "crypto";

export interface StrategicLane {
  laneId: string;
  id?: string;
  title: string;
  description: string;
  primaryPainId: string;
  corePainIds: string[];
  supportingPainIds: string[];
  painDecisionIds?: string[];
  segmentIds: string[];
  segmentId?: string;
  painIds: string[];
  productTruthFactIds?: string[];
  brandSpineAuthority?: any;
  jobId?: string;
  campaignId?: string;
  campaignOfferingId?: string;
  desires: string[];
  objections: string[];
  valueContext: string;
  proofNeeds: string[];
  messagingDirection: string;
  commercialRelevance: string;
}

export interface LaneJudgeIssue {
  laneId: string;
  code: string;
  message: string;
}

export interface LaneJudgeResult {
  valid: boolean;
  issues: LaneJudgeIssue[];
}

export const LANE_GROUPER_VERSION = "lane_grouper_v2+authority_gate_v1";

export async function runLaneGrouper(
  segments: any[],
  painRegistry: AuthoritativeAudiencePain[],
  opts: {
    accountId: string;
    campaignId: string;
    jobId?: string;
    campaignOfferingId?: string;
    productCapabilities?: string | null;
  }
): Promise<StrategicLane[]> {
  // Filter for authorized pains only: CORE_PURCHASE and SUPPORTING.
  // Strictly exclude STRATEGIC_EXCLUDED, EXCLUDED, and INCOMPLETE.
  const authorizedPains = (painRegistry || []).filter(p => {
    const c = p.classification;
    return (c === "CORE_PURCHASE" || c === "CORE" || c === "SUPPORTING") &&
           c !== "STRATEGIC_EXCLUDED" &&
           c !== "EXCLUDED" &&
           c !== "INCOMPLETE" &&
           c !== "NOT_EVALUATED" &&
           c !== "UNKNOWN" &&
           p.eligible === true;
  });

  const corePains = authorizedPains.filter(p => p.classification === "CORE_PURCHASE" || p.classification === "CORE");
  const supportingPains = authorizedPains.filter(p => p.classification === "SUPPORTING");

  if (corePains.length === 0) {
    console.warn("[LaneGrouper] No authorized CORE_PURCHASE pains available. Cannot form strategic lanes.");
    return [];
  }

  // Canonical Audience segments own their IDs. Legacy backfill only if ID is missing.
  segments.forEach((seg, idx) => {
    if (seg && !seg.id) {
      seg.id = `seg_legacy_${idx + 1}`;
    }
  });

  // Filter input segments to those associated with authorized pains
  const authorizedPainIds = new Set(authorizedPains.map(p => p.painId));
  const eligibleSegments = segments.filter(seg => {
    const segPains = Array.isArray(seg.pains) ? seg.pains : [];
    const segPainIds = segPains.map((p: any) => p.claimId || p.painId || p.id || p);
    return segPainIds.some((pid: string) => authorizedPainIds.has(pid)) ||
           authorizedPains.some(ap => (ap.segmentIds || []).includes(seg.id));
  });

  const prompt = `You are a strategic marketing architect. Your sole task is to group target audience segments and their validated pains into coherent Strategic Lanes.

DOCTRINE & RULES:
1. Every authorized CORE_PURCHASE pain MUST belong to at least one valid lane.
2. A lane MUST contain at least one CORE_PURCHASE pain.
3. Every lane MUST declare a "primaryPainId" that resolves strictly to one of the CORE_PURCHASE pains in that lane.
4. SUPPORTING pains MAY be attached to a semantically compatible CORE lane if they provide valuable context, proof, or objection handling.
5. SUPPORTING pains are OPTIONAL and must NEVER create a standalone lane or become the primaryPainId.
6. EXCLUDED, STRATEGIC_EXCLUDED, and INCOMPLETE pains must NEVER be included in any lane.
7. A segment without a CORE_PURCHASE pain CANNOT form a standalone strategic lane.
8. Group related segments and compatible buying contexts together into the minimum necessary number of coherent lanes. Do not over-fragment.
9. A Strategic Lane is a structural scoping container to group segments and pains. Do NOT generate or invent brand positioning, differentiation claims, market enemies, mechanisms, or offer details. The title and description must concisely summarize the grouping scope based strictly on the provided pains and product capabilities.

INPUT SEGMENTS:
${eligibleSegments.map((s) => `- id=${s.id} name="${s.name}" description="${s.description}"`).join("\n")}

AUTHORIZED CORE_PURCHASE PAINS (EACH MUST MAP TO AT LEAST ONE LANE AS CORE/PRIMARY):
${corePains.map((p) => `- painId=${p.painId} canonical="${p.canonical}" classification=${p.classification} segmentIds=[${(p.segmentIds || []).join(", ")}]`).join("\n")}

AUTHORIZED SUPPORTING PAINS (OPTIONAL - ATTACH ONLY TO COMPATIBLE CORE LANES):
${supportingPains.map((p) => `- painId=${p.painId} canonical="${p.canonical}" classification=${p.classification} segmentIds=[${(p.segmentIds || []).join(", ")}]`).join("\n")}

PRODUCT CAPABILITIES / TRUTH BOUNDARY:
${opts.productCapabilities || "UNKNOWN"}

Respond ONLY with JSON:
{
  "lanes": [
    {
      "title": "Short descriptive lane title",
      "description": "One sentence describing this lane's core strategic focus",
      "primaryPainId": "CORE_PURCHASE painId",
      "corePainIds": ["CORE_PURCHASE painId1"],
      "supportingPainIds": ["SUPPORTING painId1"],
      "segmentIds": ["seg_id1"],
      "desires": ["Desire phrase 1"],
      "objections": ["Objection phrase 1"],
      "valueContext": "How this segment buys and what commercial context they are in",
      "proofNeeds": ["E.g. Sourcing SLAs, Lab Reports, Automation Demos"],
      "messagingDirection": "Messaging angles guidelines for this lane",
      "commercialRelevance": "The commercial motivation behind targeting this lane"
    }
  ]
}`;

  try {
    const response = await aiChat({
      model: "gpt-4.1-mini",
      messages: [{ role: "user", content: prompt }],
      temperature: 0,
      max_tokens: 3000,
      response_format: { type: "json_object" },
      accountId: opts.accountId,
      endpoint: "lane-grouper",
    });

    const content = response.choices?.[0]?.message?.content || "";
    const parsed = JSON.parse(content);
    if (!Array.isArray(parsed?.lanes)) {
      throw new Error("Lanes output is not an array");
    }

    const rawLanes: any[] = parsed.lanes;
    const corePainIdSet = new Set(corePains.map(p => p.painId));
    const supportingPainIdSet = new Set(supportingPains.map(p => p.painId));

    const resolvedLanes: StrategicLane[] = rawLanes.map((lane, index) => {
      const derivedLaneId = `lane_${crypto.createHash("sha256").update(lane.title || `lane-${index}`).digest("hex").slice(0, 12)}`;
      
      const rawCoreIds = Array.isArray(lane.corePainIds) ? lane.corePainIds : [];
      const rawSuppIds = Array.isArray(lane.supportingPainIds) ? lane.supportingPainIds : [];
      const rawPainIds = Array.isArray(lane.painIds) ? lane.painIds : [...rawCoreIds, ...rawSuppIds];

      // Filter to only authorized CORE and SUPPORTING pains
      const filteredCore = [...new Set([...rawCoreIds, ...rawPainIds.filter(pid => corePainIdSet.has(pid))])].filter(pid => corePainIdSet.has(pid));
      const filteredSupp = [...new Set([...rawSuppIds, ...rawPainIds.filter(pid => supportingPainIdSet.has(pid))])].filter(pid => supportingPainIdSet.has(pid));

      let primaryPainId = lane.primaryPainId;
      if (!primaryPainId || !corePainIdSet.has(primaryPainId)) {
        primaryPainId = filteredCore[0] || corePains[0]?.painId;
      }
      if (primaryPainId && !filteredCore.includes(primaryPainId)) {
        filteredCore.unshift(primaryPainId);
      }

      const allPainIds = [...new Set([...filteredCore, ...filteredSupp])];
      const matchingPains = authorizedPains.filter(p => allPainIds.includes(p.painId));
      const painDecisionIds = matchingPains.map(p => p.strategicPainDecisionAuthorityId || p.coreDecisionId).filter(Boolean) as string[];
      const productTruthFactIds = [...new Set(matchingPains.flatMap(p => p.productTruthFactIds || []))];
      const segIds = Array.isArray(lane.segmentIds) ? lane.segmentIds : [];

      return {
        laneId: derivedLaneId,
        id: derivedLaneId,
        title: typeof lane.title === "string" ? lane.title : `Strategic Lane ${index + 1}`,
        description: typeof lane.description === "string" ? lane.description : "",
        primaryPainId,
        corePainIds: filteredCore,
        supportingPainIds: filteredSupp,
        painIds: allPainIds,
        painDecisionIds,
        productTruthFactIds,
        jobId: opts.jobId,
        campaignId: opts.campaignId,
        campaignOfferingId: opts.campaignOfferingId,
        segmentIds: segIds,
        segmentId: segIds[0],
        desires: Array.isArray(lane.desires) ? lane.desires.map(String) : [],
        objections: Array.isArray(lane.objections) ? lane.objections.map(String) : [],
        valueContext: typeof lane.valueContext === "string" ? lane.valueContext : "",
        proofNeeds: Array.isArray(lane.proofNeeds) ? lane.proofNeeds.map(String) : [],
        messagingDirection: typeof lane.messagingDirection === "string" ? lane.messagingDirection : "",
        commercialRelevance: typeof lane.commercialRelevance === "string" ? lane.commercialRelevance : "",
      };
    }).filter(lane => lane.corePainIds.length > 0);

    // Run strict authority judge
    const judge = judgeLanes(resolvedLanes, eligibleSegments, painRegistry);
    if (!judge.valid) {
      console.warn(`[LaneGrouper] JUDGE_FAILED | issues=`, judge.issues);
      const repaired = repairLanes(resolvedLanes, eligibleSegments, painRegistry);
      return repaired;
    }

    return resolvedLanes;
  } catch (err: any) {
    console.warn(`[LaneGrouper] Failed to run lane grouper: ${err.message} -- building deterministic authority fallback lanes`);
    return defaultFallbackLanes(eligibleSegments, authorizedPains, opts);
  }
}

export function judgeLanes(
  lanes: StrategicLane[],
  segments: any[],
  painRegistry: AuthoritativeAudiencePain[]
): LaneJudgeResult {
  const issues: LaneJudgeIssue[] = [];
  const knownSegIds = new Set(segments.map(s => s.id));
  
  const corePains = (painRegistry || []).filter(p => p.classification === "CORE_PURCHASE" || p.classification === "CORE");
  const supportingPains = (painRegistry || []).filter(p => p.classification === "SUPPORTING");
  const excludedPains = (painRegistry || []).filter(p => 
    p.classification === "STRATEGIC_EXCLUDED" || 
    p.classification === "EXCLUDED" || 
    p.classification === "INCOMPLETE" || 
    p.classification === "UNKNOWN"
  );

  const corePainIds = new Set(corePains.map(p => p.painId));
  const supportingPainIds = new Set(supportingPains.map(p => p.painId));
  const excludedPainIds = new Set(excludedPains.map(p => p.painId));

  if (lanes.length === 0) {
    issues.push({ laneId: "*", code: "NO_LANES_GENERATED", message: "Zero lanes generated" });
    return { valid: false, issues };
  }

  if (lanes.length > 5) {
    issues.push({ laneId: "*", code: "OVER_FRAGMENTATION", message: `Generated ${lanes.length} lanes, exceeding technical ceiling of 5` });
  }

  const mappedCorePainIds = new Set<string>();

  lanes.forEach(lane => {
    if (!lane.title || lane.title.trim().length === 0) {
      issues.push({ laneId: lane.laneId, code: "MISSING_TITLE", message: "Lane is missing a title" });
    }

    // A. Must contain >= 1 CORE_PURCHASE pain
    if (!lane.corePainIds || lane.corePainIds.length === 0) {
      issues.push({ laneId: lane.laneId, code: "NO_CORE_PAIN_IN_STRATEGIC_LANE", message: `Lane "${lane.title}" has no CORE_PURCHASE pain` });
    }

    // B. primaryPainId MUST resolve to CORE_PURCHASE
    if (!lane.primaryPainId || !corePainIds.has(lane.primaryPainId)) {
      issues.push({ laneId: lane.laneId, code: "INVALID_PRIMARY_PAIN", message: `Lane "${lane.title}" primaryPainId "${lane.primaryPainId}" is not a valid CORE_PURCHASE pain` });
    }

    // C. Every corePainId must resolve to CORE_PURCHASE
    lane.corePainIds.forEach(pid => {
      if (!corePainIds.has(pid)) {
        issues.push({ laneId: lane.laneId, code: "INVALID_CORE_PAIN_ID", message: `Pain ID ${pid} in corePainIds is not CORE_PURCHASE` });
      } else {
        mappedCorePainIds.add(pid);
      }
    });

    // D. Every supportingPainId must resolve to SUPPORTING
    lane.supportingPainIds.forEach(pid => {
      if (!supportingPainIds.has(pid)) {
        issues.push({ laneId: lane.laneId, code: "INVALID_SUPPORTING_PAIN_ID", message: `Pain ID ${pid} in supportingPainIds is not SUPPORTING` });
      }
    });

    // E. NO pain resolves to STRATEGIC_EXCLUDED / EXCLUDE / INCOMPLETE
    const allLanePains = [...(lane.painIds || []), ...(lane.corePainIds || []), ...(lane.supportingPainIds || []), lane.primaryPainId].filter(Boolean);
    allLanePains.forEach(pid => {
      if (excludedPainIds.has(pid)) {
        issues.push({ laneId: lane.laneId, code: "EXCLUDED_PAIN_IN_STRATEGIC_LANE", message: `Excluded pain ID ${pid} detected in lane "${lane.title}"` });
      }
    });

    // Segment validation
    lane.segmentIds.forEach(sid => {
      if (!knownSegIds.has(sid)) {
        issues.push({ laneId: lane.laneId, code: "INVALID_SEGMENT_ID", message: `Segment ID ${sid} does not exist in eligible segments` });
      }
    });
  });

  // Check that all authorized CORE_PURCHASE pains are mapped to at least one lane
  corePains.forEach(cp => {
    if (!mappedCorePainIds.has(cp.painId)) {
      issues.push({ laneId: "*", code: "UNMAPPED_CORE_PAIN", message: `Authorized CORE_PURCHASE pain "${cp.painId}" is not mapped to any strategic lane` });
    }
  });

  // Under-fragmentation check: B2B vs B2C collision
  lanes.forEach(lane => {
    const segmentNames = lane.segmentIds.map(sid => segments.find(s => s.id === sid)?.name || "").join(" ").toLowerCase();
    const hasB2B = segmentNames.includes("procurement") || segmentNames.includes("wholesale") || segmentNames.includes("b2b") || segmentNames.includes("clinic") || segmentNames.includes("distributor");
    const hasB2C = segmentNames.includes("patient") || segmentNames.includes("consumer") || segmentNames.includes("b2c") || segmentNames.includes("client") || segmentNames.includes("end-user") || segmentNames.includes("individual");
    if (hasB2B && hasB2C && lane.segmentIds.length > 1) {
      issues.push({ laneId: lane.laneId, code: "LANE_COLLISION", message: `Lane "${lane.title}" mixes B2B procurement and B2C consumer contexts` });
    }
  });

  return {
    valid: issues.length === 0,
    issues
  };
}

export function repairLanes(
  lanes: StrategicLane[],
  segments: any[],
  painRegistry: AuthoritativeAudiencePain[]
): StrategicLane[] {
  const corePains = (painRegistry || []).filter(p => p.classification === "CORE_PURCHASE" || p.classification === "CORE");
  const supportingPains = (painRegistry || []).filter(p => p.classification === "SUPPORTING");
  const corePainIds = new Set(corePains.map(p => p.painId));
  const supportingPainIds = new Set(supportingPains.map(p => p.painId));
  const knownSegIds = new Set(segments.map(s => s.id).filter(Boolean));

  let repaired = lanes.map(lane => {
    const filteredCore = (lane.corePainIds || []).filter(pid => corePainIds.has(pid));
    const filteredSupp = (lane.supportingPainIds || []).filter(pid => supportingPainIds.has(pid));
    
    // Ensure primaryPainId is a valid CORE pain
    let primaryPainId = lane.primaryPainId;
    if (!primaryPainId || !corePainIds.has(primaryPainId)) {
      primaryPainId = filteredCore[0] || corePains[0]?.painId || "";
    }
    if (primaryPainId && !filteredCore.includes(primaryPainId)) {
      filteredCore.unshift(primaryPainId);
    }

    return {
      ...lane,
      primaryPainId,
      corePainIds: filteredCore,
      supportingPainIds: filteredSupp,
      painIds: [...new Set([...filteredCore, ...filteredSupp])],
      segmentIds: (lane.segmentIds || []).filter(sid => knownSegIds.has(sid)),
    };
  }).filter(lane => lane.corePainIds.length > 0);

  // If over-fragmentation occurs, merge smallest lanes
  while (repaired.length > 5) {
    repaired.sort((a, b) => (a.corePainIds.length + a.supportingPainIds.length) - (b.corePainIds.length + b.supportingPainIds.length));
    const smallest = repaired.shift()!;
    repaired[0].corePainIds = [...new Set([...repaired[0].corePainIds, ...smallest.corePainIds])];
    repaired[0].supportingPainIds = [...new Set([...repaired[0].supportingPainIds, ...smallest.supportingPainIds])];
    repaired[0].painIds = [...new Set([...repaired[0].corePainIds, ...repaired[0].supportingPainIds])];
    repaired[0].segmentIds = [...new Set([...repaired[0].segmentIds, ...smallest.segmentIds])];
  }

  // Ensure every CORE_PURCHASE pain is mapped to at least one lane
  const mappedCorePains = new Set(repaired.flatMap(l => l.corePainIds));
  corePains.forEach(cp => {
    if (!mappedCorePains.has(cp.painId)) {
      // Find a lane matching its segmentIds, or append to the first lane
      const matched = repaired.find(l => l.segmentIds.some(sid => (cp.segmentIds || []).includes(sid)));
      if (matched) {
        matched.corePainIds.push(cp.painId);
        matched.painIds = [...new Set([...matched.painIds, cp.painId])];
      } else if (repaired.length > 0) {
        repaired[0].corePainIds.push(cp.painId);
        repaired[0].painIds = [...new Set([...repaired[0].painIds, cp.painId])];
      } else {
        // Build a dedicated lane for this core pain
        const derivedLaneId = `lane_${crypto.createHash("sha256").update(cp.canonical).digest("hex").slice(0, 12)}`;
        repaired.push({
          laneId: derivedLaneId,
          title: `Strategic Lane: ${cp.canonical.slice(0, 50)}`,
          description: `Focused on resolving CORE pain: ${cp.canonical}`,
          primaryPainId: cp.painId,
          corePainIds: [cp.painId],
          supportingPainIds: [],
          painIds: [cp.painId],
          segmentIds: cp.segmentIds || [],
          desires: [],
          objections: [],
          valueContext: "Commercial strategic buyer context",
          proofNeeds: ["Product capability proof", "Case studies"],
          messagingDirection: `Address ${cp.canonical}`,
          commercialRelevance: "Addresses core buyer purchase criteria",
        });
      }
    }
  });

  return repaired;
}

export function defaultFallbackLanes(
  segments: any[],
  authorizedPains: AuthoritativeAudiencePain[],
  opts?: { jobId?: string; campaignId?: string; campaignOfferingId?: string }
): StrategicLane[] {
  const corePains = (authorizedPains || []).filter(p => p.classification === "CORE_PURCHASE" || p.classification === "CORE");
  const supportingPains = (authorizedPains || []).filter(p => p.classification === "SUPPORTING");
  
  if (corePains.length === 0) {
    return [];
  }

  // Create one lane per core pain (or one combined lane)
  return corePains.map((cp, idx) => {
    const laneId = `lane_fallback_${idx + 1}_${Date.now()}`;
    const matchingSupp = supportingPains.filter(sp => (sp.segmentIds || []).some(sid => (cp.segmentIds || []).includes(sid)));
    const coreIds = [cp.painId];
    const suppIds = matchingSupp.map(sp => sp.painId);
    const allIds = [...coreIds, ...suppIds];

    const segIds = cp.segmentIds || segments.map(s => s.id).filter(Boolean);
    return {
      laneId,
      id: laneId,
      title: `Strategic Lane: ${cp.canonical.slice(0, 50)}`,
      description: `Core campaign strategic lane addressing ${cp.canonical}`,
      primaryPainId: cp.painId,
      corePainIds: coreIds,
      supportingPainIds: suppIds,
      painIds: allIds,
      painDecisionIds: [cp.strategicPainDecisionAuthorityId || cp.coreDecisionId].filter(Boolean) as string[],
      productTruthFactIds: cp.productTruthFactIds || [],
      jobId: opts?.jobId,
      campaignId: opts?.campaignId,
      campaignOfferingId: opts?.campaignOfferingId,
      segmentIds: segIds,
      segmentId: segIds[0],
      desires: segments.flatMap(s => s.desireProfile || []).slice(0, 3),
      objections: segments.flatMap(s => s.objectionProfile || []).slice(0, 3),
      valueContext: "Standard campaign market segment context",
      proofNeeds: ["Client testimonials", "Case studies", "Performance benchmarks"],
      messagingDirection: "Address core buyer/user pain and deliver core product truth",
      commercialRelevance: "Capture the main commercial opportunities identified in market evidence",
    };
  });
}
