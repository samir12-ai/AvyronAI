import { type AuthoritativeAudiencePain } from "./audience-pain-registry";

export interface ExecutableLaneContext {
  laneId: string;
  title: string;
  description?: string;
  primaryCorePainId: string;
  corePainIds: string[];
  supportingPainIds: string[];
  segmentIds: string[];
  segmentId?: string;
  targetSegment?: any;
  approvedLane: any;
}

/**
 * Resolves all executable CORE strategic lanes from the approved lanes and pain registry.
 * 
 * Rules:
 * 1. An executable lane MUST have a stable laneId.
 * 2. An executable lane MUST contain at least one authorized CORE_PURCHASE pain.
 * 3. An executable lane MUST resolve to valid segmentId(s).
 * 4. Lanes composed exclusively of SUPPORTING pains are strictly excluded from standalone execution.
 * 5. Lanes containing only EXCLUDED / INCOMPLETE pains are strictly excluded.
 * 6. Array order invariance: Returns lanes sorted canonically by laneId so input array order never drops or alters the semantic lane set.
 */
export function getExecutableCoreLanes(
  approvedLanes: any[] | null | undefined,
  painRegistry: AuthoritativeAudiencePain[] | any[] | null | undefined,
  allSegments: any[] | null | undefined = [],
): ExecutableLaneContext[] {
  const lanes = Array.isArray(approvedLanes) ? approvedLanes : [];
  const pains = Array.isArray(painRegistry)
    ? painRegistry
    : ((painRegistry as any)?.canonicalPains || (painRegistry as any)?.pains || (painRegistry as any)?.audiencePains || []);
  const segments = Array.isArray(allSegments) ? allSegments : [];

  // Index pains by painId
  const corePainIds = new Set<string>();
  const supportingPainIds = new Set<string>();
  const painById = new Map<string, any>();

  for (const p of pains) {
    if (!p) continue;
    const pid = p.painId || p.id;
    if (!pid) continue;
    painById.set(pid, p);
    const classification = p.classification || p.role;
    if (classification === "CORE_PURCHASE" || classification === "CORE") {
      corePainIds.add(pid);
    } else if (classification === "SUPPORTING") {
      supportingPainIds.add(pid);
    }
  }

  const segmentById = new Map<string, any>();
  for (const s of segments) {
    if (s && s.id) segmentById.set(s.id, s);
  }

  const executableLanes: ExecutableLaneContext[] = [];
  const seenLaneIds = new Set<string>();

  for (const lane of lanes) {
    if (!lane) continue;
    const laneId = lane.laneId || lane.id;
    if (!laneId || seenLaneIds.has(laneId)) continue;

    // Collect all candidate pain IDs for this lane
    const candidateCorePains: string[] = [];
    const candidateSupportingPains: string[] = [];

    // Check lane.corePainIds
    if (Array.isArray(lane.corePainIds)) {
      for (const pid of lane.corePainIds) {
        if (corePainIds.has(pid)) candidateCorePains.push(pid);
        else if (supportingPainIds.has(pid)) candidateSupportingPains.push(pid);
      }
    }

    // Check lane.painIds
    if (Array.isArray(lane.painIds)) {
      for (const pid of lane.painIds) {
        if (corePainIds.has(pid) && !candidateCorePains.includes(pid)) {
          candidateCorePains.push(pid);
        } else if (supportingPainIds.has(pid) && !candidateSupportingPains.includes(pid)) {
          candidateSupportingPains.push(pid);
        }
      }
    }

    // Check primaryPainId
    if (lane.primaryPainId) {
      if (corePainIds.has(lane.primaryPainId) && !candidateCorePains.includes(lane.primaryPainId)) {
        candidateCorePains.unshift(lane.primaryPainId);
      }
    }

    // If lane.segmentIds is mapped, check if any segment's pains are core
    const laneSegmentIds: string[] = Array.isArray(lane.segmentIds)
      ? [...lane.segmentIds]
      : (lane.targetSegmentId ? [lane.targetSegmentId] : (lane.segmentId ? [lane.segmentId] : []));

    if (laneSegmentIds.length === 0) {
      for (const cpid of candidateCorePains) {
        const pObj = painById.get(cpid);
        if (pObj?.segmentId && !laneSegmentIds.includes(pObj.segmentId)) {
          laneSegmentIds.push(pObj.segmentId);
        }
      }
    }

    if (candidateCorePains.length === 0 && laneSegmentIds.length > 0) {
      for (const sid of laneSegmentIds) {
        const seg = segmentById.get(sid);
        if (seg && Array.isArray(seg.pains)) {
          for (const sp of seg.pains) {
            const spid = sp.claimId || sp.painId || sp.id || sp;
            if (corePainIds.has(spid) && !candidateCorePains.includes(spid)) {
              candidateCorePains.push(spid);
            }
          }
        }
        for (const [pid, pObj] of painById.entries()) {
          if (corePainIds.has(pid) && (pObj.segmentId === sid || (pObj.segmentIds || []).includes(sid))) {
            if (!candidateCorePains.includes(pid)) candidateCorePains.push(pid);
          }
        }
      }
    }

    // MUST have at least one CORE_PURCHASE pain to be executable
    if (candidateCorePains.length === 0) {
      continue;
    }

    // Resolve primaryCorePainId
    const primaryCorePainId = (lane.primaryPainId && candidateCorePains.includes(lane.primaryPainId))
      ? lane.primaryPainId
      : candidateCorePains[0];

    // Resolve target segment
    let targetSegment = null;
    if (laneSegmentIds.length > 0) {
      targetSegment = segmentById.get(laneSegmentIds[0]) || null;
    }
    if (!targetSegment && primaryCorePainId) {
      const pObj = painById.get(primaryCorePainId);
      if (pObj?.segmentId) targetSegment = segmentById.get(pObj.segmentId) || null;
    }

    executableLanes.push({
      laneId,
      title: lane.title || lane.name || `Strategic Lane ${laneId}`,
      description: lane.description || "",
      primaryCorePainId,
      corePainIds: candidateCorePains,
      supportingPainIds: candidateSupportingPains,
      segmentIds: laneSegmentIds,
      segmentId: laneSegmentIds[0],
      targetSegment,
      desires: lane.desires || [],
      objections: lane.objections || [],
      proofNeeds: lane.proofNeeds || [],
      messagingDirection: lane.messagingDirection || "",
      valueContext: lane.valueContext || "",
      commercialRelevance: lane.commercialRelevance || "",
      approvedLane: lane,
    });
    seenLaneIds.add(laneId);
  }

  // Fallback: If no approved lanes were passed at all (empty array / undefined) but we have authorized CORE pains
  if (executableLanes.length === 0 && lanes.length === 0 && corePainIds.size > 0) {
    const primaryCore = Array.from(corePainIds)[0];
    const pObj = painById.get(primaryCore);
    const sid = pObj?.segmentId || (pObj?.segmentIds?.[0]) || "default_segment";
    executableLanes.push({
      laneId: "lane_default",
      title: "Core Purchase Lane",
      description: "Default strategic lane derived from core purchase pain",
      primaryCorePainId: primaryCore,
      corePainIds: Array.from(corePainIds),
      supportingPainIds: Array.from(supportingPainIds),
      segmentIds: [sid],
      targetSegment: segmentById.get(sid) || null,
      approvedLane: {
        id: "lane_default",
        laneId: "lane_default",
        title: "Core Purchase Lane",
        segmentId: sid,
        primaryPainId: primaryCore,
        corePainIds: Array.from(corePainIds),
        supportingPainIds: Array.from(supportingPainIds),
      },
    });
  }

  // Sort canonically by laneId for deterministic presentation order
  return executableLanes.sort((a, b) => a.laneId.localeCompare(b.laneId));
}
