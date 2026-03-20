import { db } from "./db";
import { sql } from "drizzle-orm";

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

function pickNested(obj: any, path: string[]): string | null {
  let cur = obj;
  for (const k of path) {
    if (!cur) return null;
    cur = cur[k];
  }
  return typeof cur === "string" && cur.trim() ? cur.trim() : null;
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

export async function buildCausalNarrative(campaignId: string, accountId: string = "default"): Promise<CausalNarrative> {
  const empty: CausalNarrative = { hasNarrative: false, steps: [], oneLiner: "", engineCount: 0, completedAt: null };

  const jobRows = await db.execute(
    sql`SELECT section_statuses, status, completed_at FROM orchestrator_jobs
        WHERE campaign_id = ${campaignId} AND account_id = ${accountId} ORDER BY created_at DESC LIMIT 1`
  );
  const job = jobRows.rows?.[0];
  if (!job || !job.section_statuses) return empty;

  const sections: Array<{ id: string; status: string }> = safeP(job.section_statuses) || [];
  const completed = sections.filter(s => s.status === "SUCCESS");
  if (completed.length < 3) return empty;

  const completedIds = new Set(completed.map(s => s.id));

  const base = `http://localhost:${process.env.PORT || 5000}`;
  const q = `?campaignId=${encodeURIComponent(campaignId)}`;

  async function safe(url: string): Promise<any> {
    try { const r = await fetch(url); if (!r.ok) return null; return r.json(); } catch { return null; }
  }

  const apiMap: Record<string, string> = {
    positioning: `/api/positioning-engine/latest${q}`,
    differentiation: `/api/differentiation-engine/latest${q}`,
    mechanism: `/api/mechanism-engine/latest${q}`,
    offer: `/api/offer-engine/latest${q}`,
    funnel: `/api/funnel-engine/latest${q}`,
  };

  const results: Record<string, any> = {};
  await Promise.all(
    Object.entries(apiMap).map(async ([k, path]) => {
      if (completedIds.has(k) || k === "positioning") {
        const data = await safe(`${base}${path}`);
        if (data && !data.error) results[k] = data;
      }
    })
  );

  let aelData: any = null;
  try {
    const aelRows = await db.execute(
      sql`SELECT root_causes, causal_chains, buying_barriers
          FROM ael_snapshots WHERE campaign_id = ${campaignId} ORDER BY created_at DESC LIMIT 1`
    );
    if (aelRows.rows?.[0]) {
      aelData = {
        rootCauses: safeP(aelRows.rows[0].root_causes) || [],
        causalChains: safeP(aelRows.rows[0].causal_chains) || [],
        buyingBarriers: safeP(aelRows.rows[0].buying_barriers) || [],
      };
    }
  } catch {}

  const pos = results.positioning || {};
  const diff = results.differentiation || {};
  const mech = results.mechanism || {};
  const ofr = results.offer || {};
  const fnl = results.funnel || {};

  const primaryTerritory = safeP(pos.territory) || firstItem(pos, "territories", "positioningTerritories");
  const territoryName = primaryTerritory?.name || primaryTerritory?.territoryName || null;
  const enemy = primaryTerritory?.enemyDefinition || pick(pos, "enemyDefinition") || null;
  const contrastAxis = primaryTerritory?.contrastAxis || pick(pos, "contrastAxis") || null;
  const narrativeDirection = primaryTerritory?.narrativeDirection || pick(pos, "narrativeDirection") || null;

  let problemText: string | null = null;
  let problemSource = "positioning";

  if (enemy) {
    problemText = truncate(enemy, 120);
  } else if (contrastAxis) {
    problemText = truncate(contrastAxis, 120);
  } else if (narrativeDirection) {
    problemText = truncate(narrativeDirection, 120);
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
    whyText = truncate(contrastAxis, 120);
    whySource = "positioning";
  }

  if (!whyText && enemy) {
    whyText = truncate(enemy, 120);
    whySource = "positioning";
  }

  if (!whyText) {
    whyText = "Pending — AEL root cause analysis needed";
    whySource = "none";
  }

  let whatWeDoText: string;
  let positionSource = "positioning";
  if (territoryName && enemy) {
    whatWeDoText = `Own "${territoryName}" — fight ${truncate(enemy, 80)}`;
  } else if (territoryName) {
    whatWeDoText = `Own the "${territoryName}" territory`;
  } else {
    whatWeDoText = "Pending — positioning engine output needed";
    positionSource = "none";
  }

  const mechObj = mech.primaryMechanism || mech;
  const mechName = pick(mechObj, "mechanismName") || pick(mech, "mechanismName");
  const mechType = pick(mechObj, "mechanismType") || pick(mech, "mechanismType");
  const diffPillars = safeP(diff.pillars || diff.differentiationPillars) || [];
  const topPillar = Array.isArray(diffPillars) && diffPillars[0]
    ? (diffPillars[0].name || diffPillars[0].pillarName)
    : null;
  const authorityMode = typeof diff.authorityMode === "object"
    ? diff.authorityMode?.mode
    : (typeof diff.authorityMode === "string" ? diff.authorityMode : null);

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

  const funnelObj = fnl.primaryFunnel || fnl;
  const funnelType = pick(funnelObj, "funnelType", "funnelName") || pick(fnl, "funnelType", "funnelName");
  const offerObj = ofr.primaryOffer || ofr;
  const offerName = pick(offerObj, "offerName") || pick(ofr, "offerName");
  const coreOutcome = pick(offerObj, "coreOutcome") || pick(ofr, "coreOutcome");

  let executeText: string;
  let executeSource = "offer+funnel";
  if (offerName && funnelType && coreOutcome) {
    executeText = `"${truncate(offerName, 60)}" → ${funnelType} funnel → ${truncate(coreOutcome, 60)}`;
  } else if (offerName && funnelType) {
    executeText = `"${truncate(offerName, 60)}" offer → ${funnelType} funnel`;
  } else if (offerName && coreOutcome) {
    executeText = `"${truncate(offerName, 60)}" → ${truncate(coreOutcome, 60)}`;
  } else if (offerName) {
    executeText = `Execute with "${truncate(offerName, 80)}" offer`;
  } else if (funnelType) {
    executeText = `Execute through ${funnelType} funnel`;
  } else {
    executeText = "Pending — offer and funnel engines needed";
    executeSource = "none";
  }

  const steps: NarrativeStep[] = [
    { key: "problem", label: "Market Problem", icon: "alert-circle-outline", text: problemText, source: problemSource },
    { key: "why", label: "Why It Happens", icon: "git-branch-outline", text: whyText, source: whySource },
    { key: "position", label: "What We Do", icon: "flag-outline", text: whatWeDoText, source: positionSource },
    { key: "mechanism", label: "How We Fix It", icon: "construct-outline", text: howText, source: howSource },
    { key: "execute", label: "What To Execute", icon: "rocket-outline", text: executeText, source: executeSource },
  ];

  const oneLiner = `${problemText} → ${whatWeDoText} → ${executeText}`;

  return {
    hasNarrative: true,
    steps,
    oneLiner,
    engineCount: completed.length,
    completedAt: job.completed_at ? String(job.completed_at) : null,
  };
}
