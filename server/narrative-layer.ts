import { db } from "./db";
import { sql } from "drizzle-orm";
import { summarizeEngine } from "./agent/summarizers";
import type { EngineId } from "./orchestrator/priority-matrix";

interface NarrativeStep {
  key: string;
  label: string;
  icon: string;
  text: string;
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

  const base = `http://localhost:${process.env.PORT || 5000}`;
  const q = `?campaignId=${encodeURIComponent(campaignId)}`;

  async function safe(url: string): Promise<any> {
    try { const r = await fetch(url); if (!r.ok) return null; return r.json(); } catch { return null; }
  }

  const apiMap: Record<string, string> = {
    audience: `/api/audience-engine/latest${q}`,
    positioning: `/api/positioning-engine/latest${q}`,
    differentiation: `/api/differentiation-engine/latest${q}`,
    mechanism: `/api/mechanism-engine/latest${q}`,
    offer: `/api/offer-engine/latest${q}`,
    funnel: `/api/funnel-engine/latest${q}`,
    content_dna: `/api/content-dna/latest${q}`,
  };

  const keysToFetch = ["audience", "positioning", "differentiation", "mechanism", "offer", "funnel", "content_dna"];
  const results: Record<string, any> = {};
  await Promise.all(
    keysToFetch.map(async (k) => {
      if (apiMap[k]) {
        const data = await safe(`${base}${apiMap[k]}`);
        if (data) results[k] = data;
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

  const aud = results.audience?.output || results.audience || {};
  const pos = results.positioning?.output || results.positioning || {};
  const diff = results.differentiation?.output || results.differentiation || {};
  const mech = results.mechanism?.output || results.mechanism || {};
  const ofr = results.offer?.output || results.offer || {};
  const fnl = results.funnel?.output || results.funnel || {};

  const topPain = firstItem(aud, "painProfiles", "audiencePains");
  const painText = topPain?.canonicalPain || topPain?.canonical || topPain?.pain || null;

  let problemText = "Market has unresolved friction blocking conversions";
  if (painText) {
    problemText = painText;
  } else if (aelData?.rootCauses?.[0]) {
    const rc = aelData.rootCauses[0];
    problemText = rc.deepCause || rc.surfaceSignal || problemText;
  }

  let whyText = "Root cause not yet identified";
  if (aelData?.causalChains?.[0]) {
    const cc = aelData.causalChains[0];
    whyText = cc.cause || cc.impact || whyText;
  } else if (aelData?.rootCauses?.[0]?.causalReasoning) {
    whyText = aelData.rootCauses[0].causalReasoning;
  } else if (aelData?.buyingBarriers?.[0]) {
    const bb = aelData.buyingBarriers[0];
    whyText = bb.rootCause || bb.barrier || whyText;
  } else {
    const objections = safeP(aud.objectionMap) || [];
    const topObj = Array.isArray(objections) ? objections[0] : null;
    if (topObj?.canonical) {
      whyText = topObj.canonical;
    } else {
      const pains = safeP(aud.painProfiles || aud.audiencePains) || [];
      const secondPain = Array.isArray(pains) && pains.length > 1 ? pains[1] : null;
      if (secondPain?.canonical || secondPain?.canonicalPain) {
        whyText = `Driven by: ${secondPain.canonical || secondPain.canonicalPain}`;
      }
    }
  }

  const territory = firstItem(pos, "territories", "positioningTerritories");
  const territoryName = territory?.name || territory?.territoryName || null;
  const enemy = pick(pos, "enemyDefinition") || territory?.enemyDefinition || null;
  let whatWeDoText = "Position against market defaults";
  if (territoryName && enemy) {
    whatWeDoText = `Own "${territoryName}" — fight ${enemy}`;
  } else if (territoryName) {
    whatWeDoText = `Own the "${territoryName}" territory`;
  }

  const mechObj = mech.primaryMechanism || mech;
  const mechName = pick(mechObj, "mechanismName") || pick(mech, "mechanismName");
  const diffPillars = (safeP(diff.pillars || diff.differentiationPillars) || []);
  const topPillar = diffPillars[0]?.name || diffPillars[0]?.pillarName || null;
  let howText = "Apply differentiated mechanism";
  if (mechName && topPillar) {
    howText = `"${mechName}" mechanism — anchored on ${topPillar}`;
  } else if (mechName) {
    howText = `"${mechName}" mechanism drives the fix`;
  } else if (topPillar) {
    howText = `Lead with "${topPillar}" as primary differentiator`;
  }

  const funnelType = pick(fnl, "funnelType", "funnelName") ||
    pick(fnl.primaryFunnel || {}, "funnelType", "funnelName");
  const offerName = pick(ofr.primaryOffer || ofr, "offerName") || pick(ofr, "offerName");
  let executeText = "Deploy content through optimized funnel";
  if (offerName && funnelType) {
    executeText = `"${offerName}" offer → ${funnelType} funnel`;
  } else if (offerName) {
    executeText = `Execute with "${offerName}" offer`;
  } else if (funnelType) {
    executeText = `Execute through ${funnelType} funnel`;
  }

  const steps: NarrativeStep[] = [
    { key: "problem", label: "Market Problem", icon: "alert-circle-outline", text: problemText },
    { key: "why", label: "Why It Happens", icon: "git-branch-outline", text: whyText },
    { key: "position", label: "What We Do", icon: "flag-outline", text: whatWeDoText },
    { key: "mechanism", label: "How We Fix It", icon: "construct-outline", text: howText },
    { key: "execute", label: "What To Execute", icon: "rocket-outline", text: executeText },
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
