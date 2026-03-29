import { db } from "./db";
import { sql } from "drizzle-orm";
import {
  positioningSnapshots,
  differentiationSnapshots,
  mechanismSnapshots,
  offerSnapshots,
  funnelSnapshots,
} from "@shared/schema";
import { eq, and, or, desc } from "drizzle-orm";

interface NarrativeStep {
  key: string;
  label: string;
  icon: string;
  text: string;
  source: string;
}

interface CausalNarrative {
  hasNarrative: boolean;
  steps: NarrativeStep[];
  oneLiner: string;
  engineCount: number;
  completedAt: string | null;
}

function safeP(v: any): any {
  try { return typeof v === "string" ? JSON.parse(v) : v; } catch { return null; }
}

function pick(obj: any, ...keys: string[]): string | null {
  if (!obj) return null;
  for (const k of keys) {
    const v = obj[k];
    if (typeof v === "string" && v.trim()) return v.trim();
  }
  return null;
}

function firstItem(obj: any, ...keys: string[]): any {
  if (!obj) return null;
  for (const k of keys) {
    const raw = obj[k];
    const arr = typeof raw === "string" ? safeP(raw) : raw;
    if (Array.isArray(arr) && arr.length) return arr[0];
  }
  return null;
}

function truncate(s: string, max: number): string {
  if (s.length <= max) return s;
  return s.substring(0, max - 1) + "…";
}

const REPLACEMENTS: Array<[RegExp, string]> = [
  [/\bthe market\s+(?:is\s+)?(?:currently\s+)?(?:dominated|saturated)\s+(?:by|with)\b/gi, "most brands rely on"],
  [/\bgeneric\s+(?:and\s+)?commoditized\b/gi, "generic"],
  [/\black\s+of\s+differentiation\b/gi, "no clear differentiator"],
  [/\bfailure\s+to\s+(?:adequately\s+)?address\b/gi, "not addressing"],
  [/\binability\s+to\b/gi, "can't"],
  [/\bdue\s+to\s+the\s+fact\s+that\b/gi, "because"],
  [/\bin\s+order\s+to\b/gi, "to"],
  [/\bleverage\b/gi, "use"],
  [/\butilize\b/gi, "use"],
  [/\bfacilitate\b/gi, "enable"],
  [/\boptimize\b/gi, "improve"],
  [/\bimplement\b/gi, "build"],
  [/\bestablish\b/gi, "create"],
  [/\bdemonstrate\b/gi, "show"],
  [/\bidentify\b/gi, "find"],
  [/\bprimary\s+differentiator\b/gi, "key advantage"],
  [/\bas\s+(?:a\s+)?primary\s+(?:strategic\s+)?advantage\b/gi, "as the edge"],
  [/\bstrategic\s+positioning\b/gi, "positioning"],
  [/\bstrategic\s+narrative\b/gi, "narrative"],
  [/\bstrategic\s+mechanism\b/gi, "mechanism"],
  [/\bcausal\s+reasoning\b/gi, "root cause"],
  [/\bsurface\s*-?\s*level\s+signals?\b/gi, "visible symptom"],
  [/\bmechanism\s+drives\s+the\s+fix\b/gi, "mechanism"],
  [/\b(?:Execute|Deploy)\s+(?:with|through|via)\s+/gi, ""],
  [/\s+funnel\s+funnel\b/g, " funnel"],
  [/\s{2,}/g, " "],
];

function humanize(text: string): string {
  if (!text || text.startsWith("Pending")) return text;

  let out = text;
  for (const [pattern, replacement] of REPLACEMENTS) {
    out = out.replace(pattern, replacement);
  }

  out = out.replace(/^[a-z]/, c => c.toUpperCase());
  out = out.trim();

  return out;
}

export async function buildCausalNarrative(campaignId: string, accountId: string = "default"): Promise<CausalNarrative> {
  const empty: CausalNarrative = { hasNarrative: false, steps: [], oneLiner: "", engineCount: 0, completedAt: null };

  const jobRows = await db.execute(
    sql`SELECT section_statuses, status, completed_at FROM orchestrator_jobs
        WHERE campaign_id = ${campaignId} AND account_id = ${accountId} ORDER BY created_at DESC LIMIT 1`
  );
  const job = jobRows.rows?.[0];
  if (!job || !job.section_statuses) return empty;

  const sections: Array<{ id: string; status: string }> = safeP(job.section_statuses) || [];
  const completed = sections.filter(s => s.status === "SUCCESS" || s.status === "COMPLETE");
  if (completed.length < 3) return empty;

  const completedIds = new Set(completed.map(s => s.id));

  const COMPLETE_STATUS = ["COMPLETE", "SUCCESS"];

  const [posRows, diffRows, mechRows, offerRows, funnelRows] = await Promise.all([
    db.select().from(positioningSnapshots)
      .where(and(
        eq(positioningSnapshots.campaignId, campaignId),
        eq(positioningSnapshots.accountId, accountId),
        or(...COMPLETE_STATUS.map(s => eq(positioningSnapshots.status, s)))
      ))
      .orderBy(desc(positioningSnapshots.createdAt))
      .limit(1)
      .catch(() => []),

    completedIds.has("differentiation")
      ? db.select().from(differentiationSnapshots)
          .where(and(
            eq(differentiationSnapshots.campaignId, campaignId),
            eq(differentiationSnapshots.accountId, accountId),
            or(...COMPLETE_STATUS.map(s => eq(differentiationSnapshots.status, s)))
          ))
          .orderBy(desc(differentiationSnapshots.createdAt))
          .limit(1)
          .catch(() => [])
      : Promise.resolve([]),

    completedIds.has("mechanism")
      ? db.select().from(mechanismSnapshots)
          .where(and(
            eq(mechanismSnapshots.campaignId, campaignId),
            eq(mechanismSnapshots.accountId, accountId),
            or(...COMPLETE_STATUS.map(s => eq(mechanismSnapshots.status, s)))
          ))
          .orderBy(desc(mechanismSnapshots.createdAt))
          .limit(1)
          .catch(() => [])
      : Promise.resolve([]),

    completedIds.has("offer")
      ? db.select().from(offerSnapshots)
          .where(and(
            eq(offerSnapshots.campaignId, campaignId),
            eq(offerSnapshots.accountId, accountId),
            or(...COMPLETE_STATUS.map(s => eq(offerSnapshots.status, s)))
          ))
          .orderBy(desc(offerSnapshots.createdAt))
          .limit(1)
          .catch(() => [])
      : Promise.resolve([]),

    completedIds.has("funnel")
      ? db.select().from(funnelSnapshots)
          .where(and(
            eq(funnelSnapshots.campaignId, campaignId),
            eq(funnelSnapshots.accountId, accountId),
            or(...COMPLETE_STATUS.map(s => eq(funnelSnapshots.status, s)))
          ))
          .orderBy(desc(funnelSnapshots.createdAt))
          .limit(1)
          .catch(() => [])
      : Promise.resolve([]),
  ]);

  let aelData: any = null;
  try {
    const aelRows = await db.execute(
      sql`SELECT root_causes, causal_chains, buying_barriers
          FROM ael_snapshots WHERE campaign_id = ${campaignId} AND account_id = ${accountId} ORDER BY created_at DESC LIMIT 1`
    );
    if (aelRows.rows?.[0]) {
      aelData = {
        rootCauses: safeP(aelRows.rows[0].root_causes) || [],
        causalChains: safeP(aelRows.rows[0].causal_chains) || [],
        buyingBarriers: safeP(aelRows.rows[0].buying_barriers) || [],
      };
    }
  } catch {}

  const posRow = posRows[0] || null;
  const diffRow = diffRows[0] || null;
  const mechRow = mechRows[0] || null;
  const offerRow = offerRows[0] || null;
  const funnelRow = funnelRows[0] || null;

  const primaryTerritory = safeP(posRow?.territory) || firstItem({ territories: posRow?.territories }, "territories");
  const territoryName = primaryTerritory?.name || primaryTerritory?.territoryName || null;
  const enemy = primaryTerritory?.enemyDefinition
    || (posRow?.enemyDefinition ? posRow.enemyDefinition : null)
    || pick(primaryTerritory, "enemy") || null;
  const contrastAxis = primaryTerritory?.contrastAxis
    || (posRow?.contrastAxis ? posRow.contrastAxis : null) || null;
  const narrativeDirection = primaryTerritory?.narrativeDirection
    || (posRow?.narrativeDirection ? posRow.narrativeDirection : null) || null;

  let problemText: string | null = null;
  let problemSource = "positioning";

  if (enemy) {
    problemText = enemy;
  } else if (contrastAxis) {
    problemText = contrastAxis;
  } else if (narrativeDirection) {
    problemText = narrativeDirection;
  }

  if (!problemText && aelData?.rootCauses?.[0]) {
    const rc = aelData.rootCauses[0];
    problemText = rc.deepCause || rc.surfaceSignal || null;
    problemSource = "ael";
  }

  if (!problemText) {
    problemText = "Pending — run strategic engines to identify market problem";
    problemSource = "none";
  }

  let whyText: string | null = null;
  let whySource = "ael";

  if (aelData?.causalChains?.[0]) {
    const cc = aelData.causalChains[0];
    whyText = cc.cause || cc.impact || null;
  }
  if (!whyText && aelData?.rootCauses?.[0]) {
    whyText = aelData.rootCauses[0].causalReasoning || aelData.rootCauses[0].deepCause || null;
  }
  if (!whyText && aelData?.buyingBarriers?.[0]) {
    const bb = aelData.buyingBarriers[0];
    whyText = bb.rootCause || bb.barrier || null;
  }

  if (!whyText && contrastAxis) {
    whyText = contrastAxis;
    whySource = "positioning";
  }

  if (!whyText && enemy) {
    whyText = enemy;
    whySource = "positioning";
  }

  if (!whyText) {
    whyText = "Pending — AEL root cause analysis needed";
    whySource = "none";
  }

  let whatWeDoText: string;
  let positionSource = "positioning";
  if (territoryName && enemy) {
    whatWeDoText = `Own "${territoryName}" — fight ${enemy}`;
  } else if (territoryName) {
    whatWeDoText = `Own the "${territoryName}" territory`;
  } else {
    whatWeDoText = "Pending — positioning engine output needed";
    positionSource = "none";
  }

  const mechObj = safeP(mechRow?.primaryMechanism) || {};
  const mechName = pick(mechObj, "mechanismName") || null;
  const mechType = pick(mechObj, "mechanismType") || null;

  const diffPillars = safeP(diffRow?.differentiationPillars) || [];
  const topPillar = Array.isArray(diffPillars) && diffPillars[0]
    ? (diffPillars[0].name || diffPillars[0].pillarName)
    : null;
  const authorityModeRaw = safeP(diffRow?.authorityMode);
  const authorityMode = typeof authorityModeRaw === "object"
    ? authorityModeRaw?.mode
    : (typeof authorityModeRaw === "string" ? authorityModeRaw : null);

  let howText: string;
  let howSource = "mechanism";
  if (mechName && topPillar) {
    howText = `"${mechName}" mechanism — anchored on ${topPillar}`;
  } else if (mechName && mechType) {
    howText = `"${mechName}" (${mechType}) mechanism`;
  } else if (mechName) {
    howText = `"${mechName}" mechanism drives the fix`;
  } else if (topPillar && authorityMode) {
    howText = `${authorityMode} authority — lead with "${topPillar}"`;
    howSource = "differentiation";
  } else if (topPillar) {
    howText = `Lead with "${topPillar}" as primary differentiator`;
    howSource = "differentiation";
  } else {
    howText = "Pending — mechanism and differentiation engines needed";
    howSource = "none";
  }

  const funnelObj = safeP(funnelRow?.primaryFunnel) || {};
  const funnelType = pick(funnelObj, "funnelType", "funnelName") || null;
  const offerObj = safeP(offerRow?.primaryOffer) || {};
  const offerName = pick(offerObj, "offerName") || null;
  const coreOutcome = pick(offerObj, "coreOutcome") || null;

  let executeText: string;
  let executeSource = "offer+funnel";
  if (offerName && funnelType && coreOutcome) {
    executeText = `"${offerName}" → ${funnelType} funnel → ${coreOutcome}`;
  } else if (offerName && funnelType) {
    executeText = `"${offerName}" offer → ${funnelType} funnel`;
  } else if (offerName && coreOutcome) {
    executeText = `"${offerName}" → ${coreOutcome}`;
  } else if (offerName) {
    executeText = `"${offerName}" offer`;
  } else if (funnelType) {
    executeText = `Execute through ${funnelType} funnel`;
  } else {
    executeText = "Pending — offer and funnel engines needed";
    executeSource = "none";
  }

  const steps: NarrativeStep[] = [
    { key: "problem", label: "Market Problem", icon: "alert-circle-outline", text: humanize(problemText), source: problemSource },
    { key: "why", label: "Why It Happens", icon: "git-branch-outline", text: humanize(whyText), source: whySource },
    { key: "position", label: "What We Do", icon: "flag-outline", text: humanize(whatWeDoText), source: positionSource },
    { key: "mechanism", label: "How We Fix It", icon: "construct-outline", text: humanize(howText), source: howSource },
    { key: "execute", label: "What To Execute", icon: "rocket-outline", text: humanize(executeText), source: executeSource },
  ];

  const oneLiner = `${humanize(problemText)} → ${humanize(whatWeDoText)} → ${humanize(executeText)}`;

  return {
    hasNarrative: true,
    steps,
    oneLiner,
    engineCount: completed.length,
    completedAt: job.completed_at ? String(job.completed_at) : null,
  };
}
