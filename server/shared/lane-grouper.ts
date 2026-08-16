import { aiChat } from "../ai-client";
import { type AuthoritativeAudiencePain } from "./audience-pain-registry";
import crypto from "crypto";

export interface StrategicLane {
  laneId: string;
  title: string;
  description: string;
  segmentIds: string[];
  painIds: string[];
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

export const LANE_GROUPER_VERSION = "lane_grouper_v1+judge_v1";

export async function runLaneGrouper(
  segments: any[],
  painRegistry: AuthoritativeAudiencePain[],
  opts: { accountId: string; campaignId: string; productCapabilities?: string | null }
): Promise<StrategicLane[]> {
  if (segments.length === 0 || painRegistry.length === 0) {
    return [];
  }

  // Pre-decorate segments with stable segment IDs if they don't have them
  segments.forEach((seg) => {
    if (seg && !seg.id && seg.name) {
      seg.id = `seg_${crypto.createHash("sha256").update(seg.name.trim()).digest("hex").slice(0, 16)}`;
    }
  });

  const prompt = `You are a strategic marketing architect. Your sole task is to group target audience segments and their validated pains into coherent Strategic Lanes.

RULES:
1. Do NOT generate brand positioning, differentiation, claims, mechanisms, or offer details.
2. Group related segments, pains, desires, and objections into a minimum number of coherent marketing/strategic lanes.
3. Every segment and every pain from the registry must map to at least one lane.
4. Ensure target segments and pains that represent compatible buying/value contexts are grouped together (e.g., B2B procurement managers and sourcing pains belong together; B2C consumers and therapeutic/rehab outcomes belong together).
5. Output the minimum number of strategic lanes that make logical sense. Do not over-fragment.

INPUT SEGMENTS:
${segments.map((s) => `- id=${s.id} name="${s.name}" description="${s.description}" painProfile=[${(s.painProfile || []).join(", ")}] desireProfile=[${(s.desireProfile || []).join(", ")}] objectionProfile=[${(s.objectionProfile || []).join(", ")}]`).join("\n")}

VALIDATED PAINS REGISTRY:
${painRegistry.map((p) => `- painId=${p.painId} canonical="${p.canonical}" classification=${p.classification} segmentIds=[${(p.segmentIds || []).join(", ")}]`).join("\n")}

PRODUCT CAPABILITIES / TRUTH BOUNDARY:
${opts.productCapabilities || "UNKNOWN"}

Respond ONLY with JSON:
{
  "lanes": [
    {
      "title": "Short descriptive lane title",
      "description": "One sentence describing this lane's core strategic focus",
      "segmentIds": ["seg_id1", "seg_id2"],
      "painIds": ["pain_id1", "pain_id2"],
      "desires": ["Desire phrase 1", "Desire phrase 2"],
      "objections": ["Objection phrase 1", "Objection phrase 2"],
      "valueContext": "How this segment buys and what commercial context they are in",
      "proofNeeds": ["E.g. Sourcing SLAs, Lab Purity Reports, Clinic Testimonials"],
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
    const resolvedLanes = rawLanes.map((lane, index) => {
      const derivedLaneId = `lane_${crypto.createHash("sha256").update(lane.title || `lane-${index}`).digest("hex").slice(0, 12)}`;
      return {
        laneId: derivedLaneId,
        title: typeof lane.title === "string" ? lane.title : `Strategic Lane ${index + 1}`,
        description: typeof lane.description === "string" ? lane.description : "",
        segmentIds: Array.isArray(lane.segmentIds) ? lane.segmentIds : [],
        painIds: Array.isArray(lane.painIds) ? lane.painIds : [],
        desires: Array.isArray(lane.desires) ? lane.desires.map(String) : [],
        objections: Array.isArray(lane.objections) ? lane.objections.map(String) : [],
        valueContext: typeof lane.valueContext === "string" ? lane.valueContext : "",
        proofNeeds: Array.isArray(lane.proofNeeds) ? lane.proofNeeds.map(String) : [],
        messagingDirection: typeof lane.messagingDirection === "string" ? lane.messagingDirection : "",
        commercialRelevance: typeof lane.commercialRelevance === "string" ? lane.commercialRelevance : "",
      };
    });

    // Run semantic judge
    const judge = judgeLanes(resolvedLanes, segments, painRegistry);
    if (!judge.valid) {
      console.warn(`[LaneGrouper] JUDGE_FAILED | issues=`, judge.issues);
      // We will proceed with a repaired/corrected version of lanes if needed,
      // but if the issues are simple (e.g. unmapped segments/pains), we can automatically repair.
      const repaired = repairLanes(resolvedLanes, segments, painRegistry);
      return repaired;
    }

    return resolvedLanes;
  } catch (err: any) {
    console.warn(`[LaneGrouper] Failed to run lane grouper: ${err.message} -- falling back to default single-lane mapping`);
    return defaultFallbackLanes(segments, painRegistry);
  }
}

export function judgeLanes(
  lanes: StrategicLane[],
  segments: any[],
  painRegistry: AuthoritativeAudiencePain[]
): LaneJudgeResult {
  const issues: LaneJudgeIssue[] = [];
  const knownSegIds = new Set(segments.map(s => s.id));
  const knownPainIds = new Set(painRegistry.map(p => p.painId));

  if (lanes.length === 0) {
    issues.push({ laneId: "*", code: "NO_LANES_GENERATED", message: "Zero lanes generated" });
    return { valid: false, issues };
  }

  // Check emergency ceiling (5 lanes)
  if (lanes.length > 5) {
    issues.push({ laneId: "*", code: "OVER_FRAGMENTATION", message: `Generated ${lanes.length} lanes, exceeding technical ceiling of 5` });
  }

  const mappedSegIds = new Set<string>();
  const mappedPainIds = new Set<string>();

  lanes.forEach(lane => {
    if (!lane.title || lane.title.trim().length === 0) {
      issues.push({ laneId: lane.laneId, code: "MISSING_TITLE", message: "Lane is missing a title" });
    }
    
    // Check invalid segment IDs
    lane.segmentIds.forEach(sid => {
      if (!knownSegIds.has(sid)) {
        issues.push({ laneId: lane.laneId, code: "INVALID_SEGMENT_ID", message: `Segment ID ${sid} does not exist in audience snapshot` });
      } else {
        mappedSegIds.add(sid);
      }
    });

    // Check invalid pain IDs
    lane.painIds.forEach(pid => {
      if (!knownPainIds.has(pid)) {
        issues.push({ laneId: lane.laneId, code: "INVALID_PAIN_ID", message: `Pain ID ${pid} does not exist in pain registry` });
      } else {
        mappedPainIds.add(pid);
      }
    });
  });

  // Under-fragmentation check: are distinct segment categories collapsed?
  // E.g. B2B wholesale buyers and B2C direct clinic clients in the exact same lane is a collision.
  // We can flag a warning/issue if a lane maps B2B and B2C segments together.
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
  const knownSegIds = new Set(segments.map(s => s.id).filter(Boolean));
  const knownPainIds = new Set(painRegistry.map(p => p.painId).filter(Boolean));

  let repaired = lanes.map(lane => {
    return {
      ...lane,
      segmentIds: lane.segmentIds.filter(sid => knownSegIds.has(sid)),
      painIds: lane.painIds.filter(pid => knownPainIds.has(pid)),
    };
  }).filter(lane => lane.segmentIds.length > 0 || lane.painIds.length > 0);

  // If over-fragmentation occurs, merge the smallest lanes until <= 5 lanes remain
  while (repaired.length > 5) {
    repaired.sort((a, b) => (a.segmentIds.length + a.painIds.length) - (b.segmentIds.length + b.painIds.length));
    const smallest = repaired.shift()!;
    // merge into the new smallest lane
    repaired[0].segmentIds = [...new Set([...repaired[0].segmentIds, ...smallest.segmentIds])];
    repaired[0].painIds = [...new Set([...repaired[0].painIds, ...smallest.painIds])];
  }

  // Ensure all segments are mapped somewhere
  const mappedSegs = new Set(repaired.flatMap(l => l.segmentIds));
  segments.forEach(seg => {
    if (seg.id && !mappedSegs.has(seg.id)) {
      // Find a compatible lane or add to the first lane
      if (repaired.length > 0) {
        repaired[0].segmentIds.push(seg.id);
      }
    }
  });

  // Ensure all pains are mapped somewhere
  const mappedPains = new Set(repaired.flatMap(l => l.painIds));
  painRegistry.forEach(pain => {
    if (pain.painId && !mappedPains.has(pain.painId)) {
      // Add to a lane that contains its segmentIds, or the first lane
      const matchedLane = repaired.find(l => l.segmentIds.some(sid => (pain.segmentIds || []).includes(sid)));
      if (matchedLane) {
        matchedLane.painIds.push(pain.painId);
      } else if (repaired.length > 0) {
        repaired[0].painIds.push(pain.painId);
      }
    }
  });

  return repaired;
}

export function defaultFallbackLanes(
  segments: any[],
  painRegistry: AuthoritativeAudiencePain[]
): StrategicLane[] {
  const laneId = `lane_default_${Date.now()}`;
  return [
    {
      laneId,
      title: "Core Campaign Strategic Lane",
      description: "Default fallback lane grouping all campaign segments and pains",
      segmentIds: segments.map(s => s.id).filter(Boolean),
      painIds: painRegistry.map(p => p.painId).filter(Boolean),
      desires: segments.flatMap(s => s.desireProfile || []).slice(0, 5),
      objections: segments.flatMap(s => s.objectionProfile || []).slice(0, 5),
      valueContext: "Standard campaign market segment context",
      proofNeeds: ["Client testimonials", "Case studies"],
      messagingDirection: "Address core buyer/user pain and deliver core product truth",
      commercialRelevance: "Capture the main commercial opportunities identified in market evidence",
    }
  ];
}
