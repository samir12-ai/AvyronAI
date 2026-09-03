/**
 * Strategic Plan Reassembler
 * 
 * Constitutional Principle:
 * Plan Synthesis only REASSEMBLES approved canonical truth.
 * Plan Synthesis:
 * - Runs ONCE after final Root commit.
 * - Consumes new Strategy Root + approved exact canonical artifacts.
 * - Never patches old plans in place.
 * - Creates a new Strategic Plan version linked to the new Root.
 */

import { StrategicAuthorityName } from "./contracts";
import { randomUUID } from "crypto";

export interface PlanReassemblyInput {
  campaignId: string;
  accountId: string;
  newRoot: {
    id: string;
    version: number;
    authorityArtifactIds: Record<string, string>;
    primaryAxis?: string;
    contrastAxis?: string;
    approvedMechanism?: string;
    approvedLanes?: any[];
  };
  canonicalSnapshots: Record<string, any>;
  previousPlanId?: string | null;
}

export interface ReassembledPlanResult {
  planId: string;
  campaignId: string;
  accountId: string;
  strategyRootId: string;
  strategyRootVersion: number;
  planVersion: number;
  previousPlanId?: string | null;
  sections: {
    strategicContext: any;
    positioning: any;
    differentiation: any;
    mechanism: any;
    offer: any;
    lanes: any[];
    awareness: any;
    funnel: any;
    persuasion: any;
    channelSelection: any;
  };
  assembledAt: string;
}

/**
 * Assembles a new Strategic Plan version from the approved Strategy Root without mutating historical plans.
 */
export function reassembleStrategicPlanFromRoot(input: PlanReassemblyInput): ReassembledPlanResult {
  const { campaignId, accountId, newRoot, canonicalSnapshots, previousPlanId } = input;

  const planId = `plan_${randomUUID().slice(0, 12)}`;
  const assembledAt = new Date().toISOString();

  return {
    planId,
    campaignId,
    accountId,
    strategyRootId: newRoot.id,
    strategyRootVersion: newRoot.version,
    planVersion: newRoot.version,
    previousPlanId: previousPlanId || null,
    sections: {
      strategicContext: canonicalSnapshots["BUSINESS_UNDERSTANDING"] || { summary: "Canonical business context" },
      positioning: canonicalSnapshots["POSITIONING"] || { statement: "Canonical positioning" },
      differentiation: canonicalSnapshots["DIFFERENTIATION"] || { pillars: [] },
      mechanism: canonicalSnapshots["MECHANISM"] || { approvedMechanism: newRoot.approvedMechanism },
      offer: canonicalSnapshots["OFFER"] || { primaryOffer: {} },
      lanes: newRoot.approvedLanes || [],
      awareness: canonicalSnapshots["AWARENESS"] || {},
      funnel: canonicalSnapshots["FUNNEL"] || {},
      persuasion: canonicalSnapshots["PERSUASION"] || {},
      channelSelection: canonicalSnapshots["CHANNEL_SELECTION"] || {},
    },
    assembledAt,
  };
}
