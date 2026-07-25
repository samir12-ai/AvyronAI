// One-shot validation driver — runs MindAI orchestrator with forceRefresh:true
// then captures BEFORE/AFTER snapshot diffs as JSON for the v2 validation report.
import { runOrchestrator } from "../server/orchestrator/index";
import { db } from "../server/db";
import { sql } from "drizzle-orm";
import * as fs from "fs";
import * as path from "path";

const ACCOUNT_ID = "a2d87878-a1e9-41ea-a8a5-90beff569673";
const CAMPAIGN_ID = "campaign_1773576062201_6t0oxi";
const LABEL = "MarketMindAI";

interface SnapshotProbe {
  engine: string;
  before: { id: string | null; createdAt: string | null; engineVersion?: number | null; status?: string | null; extra?: any };
  after: { id: string | null; createdAt: string | null; engineVersion?: number | null; status?: string | null; extra?: any };
  rowAdded: boolean;
}

async function probeOne(engine: string, table: string, extraCols: string[] = []): Promise<SnapshotProbe["before"]> {
  const cols = ["id", "created_at", "engine_version", ...extraCols].join(", ");
  try {
    const r: any = await db.execute(sql.raw(
      `SELECT ${cols} FROM ${table} WHERE campaign_id='${CAMPAIGN_ID}' ORDER BY created_at DESC LIMIT 1`
    ));
    const row = r.rows?.[0];
    if (!row) return { id: null, createdAt: null };
    const extra: any = {};
    for (const c of extraCols) extra[c] = row[c];
    return {
      id: row.id || null,
      createdAt: row.created_at?.toISOString?.() || String(row.created_at || ""),
      engineVersion: row.engine_version ?? null,
      status: row.status ?? null,
      extra,
    };
  } catch (e: any) {
    return { id: null, createdAt: null, status: `ERR:${e.message?.slice(0, 60)}` };
  }
}

const ENGINES: Array<[string, string, string[]]> = [
  ["mi", "mi_snapshots", ["status"]],
  ["audience", "audience_snapshots", ["awareness_level", "maturity_index"]],
  ["positioning", "positioning_snapshots", ["status", "confidence_score"]],
  ["differentiation", "differentiation_snapshots", ["status", "confidence_score"]],
  ["mechanism", "mechanism_snapshots", ["status", "confidence_score"]],
  ["offer", "offer_snapshots", ["status"]],
  ["awareness", "awareness_snapshots", ["status"]],
  ["funnel", "funnel_snapshots", ["status"]],
  ["persuasion", "persuasion_snapshots", ["status"]],
  ["integrity", "integrity_snapshots", ["status", "safe_to_execute"]],
  ["statval", "statistical_validation_snapshots", ["status"]],
  ["budget", "budget_governor_snapshots", ["status"]],
  ["channel", "channel_selection_snapshots", ["status"]],
  ["iteration", "iteration_snapshots", ["status"]],
  ["retention", "retention_snapshots", ["status"]],
];

async function probeAll(): Promise<Record<string, SnapshotProbe["before"]>> {
  const out: Record<string, SnapshotProbe["before"]> = {};
  for (const [name, tbl, extras] of ENGINES) {
    out[name] = await probeOne(name, tbl, extras);
  }
  return out;
}

async function fetchMechanismDetail(snapshotId: string | null) {
  if (!snapshotId) return null;
  try {
    const r: any = await db.execute(sql.raw(
      `SELECT id, engine_version, status, confidence_score, primary_mechanism, alternative_mechanism, raw_llm_confidence, inherited_confidence, confidence_penalty, alternative_mechanisms FROM mechanism_snapshots WHERE id='${snapshotId}' LIMIT 1`
    ));
    const row = r.rows?.[0];
    if (!row) return null;
    const safeJson = (s: any) => { try { return typeof s === "string" ? JSON.parse(s) : s; } catch { return s; } };
    const pm = safeJson(row.primary_mechanism) || {};
    return {
      id: row.id,
      engineVersion: row.engine_version,
      status: row.status,
      finalConfidence: row.confidence_score,
      rawLLMConfidence: row.raw_llm_confidence ?? null,
      inheritedConfidence: row.inherited_confidence ?? null,
      confidencePenalty: row.confidence_penalty ?? null,
      hasWhyItWorks: !!pm.whyItWorks,
      whyItWorksLen: typeof pm.whyItWorks === "string" ? pm.whyItWorks.length : 0,
      failureModesCount: Array.isArray(pm.failureModes) ? pm.failureModes.length : 0,
      causalChainSteps: Array.isArray(pm.causalChain) ? pm.causalChain.length : 0,
      hasCommercialFunction: !!pm.commercialFunction,
      commercialFunctionType: pm.commercialFunction?.type ?? null,
      hasUpstreamDependency: !!pm.upstreamDependency,
      alternativesConsidered: Array.isArray(safeJson(row.alternative_mechanisms)) ? safeJson(row.alternative_mechanisms).length : 0,
    };
  } catch (e: any) { return { error: e.message }; }
}

async function fetchOfferScrub(snapshotId: string | null) {
  if (!snapshotId) return null;
  try {
    const r: any = await db.execute(sql.raw(
      `SELECT primary_offer, alternative_offers, rejected_offer FROM offer_snapshots WHERE id='${snapshotId}' LIMIT 1`
    ));
    const row = r.rows?.[0];
    if (!row) return null;
    const blob = JSON.stringify({ primary: row.primary_offer, alt: row.alternative_offers, rej: row.rejected_offer });
    const objLitCount = (blob.match(/\[object Object\]/g) || []).length;
    const objPrefix = (blob.match(/\[object\b/g) || []).length;
    return { objLitCount, objPrefix, blobLen: blob.length };
  } catch (e: any) { return { error: e.message }; }
}

async function fetchPersuasionShape(snapshotId: string | null) {
  if (!snapshotId) return null;
  try {
    const r: any = await db.execute(sql.raw(
      `SELECT route_data FROM persuasion_snapshots WHERE id='${snapshotId}' LIMIT 1`
    ));
    const row = r.rows?.[0];
    if (!row) return null;
    const rd: any = (() => { try { return JSON.parse(row.route_data); } catch { return {}; } })();
    const op = rd?.primaryRoute?.objectionPriorities || rd?.objectionPriorities || [];
    const total = op.length;
    const structuredCount = op.filter((o: any) => o && typeof o === "object" && (o.tag || o.objection)).length;
    const stringCount = op.filter((o: any) => typeof o === "string").length;
    return { total, structuredCount, stringCount, sample: op.slice(0, 2) };
  } catch (e: any) { return { error: e.message }; }
}

async function fetchFunnelTrust(snapshotId: string | null) {
  if (!snapshotId) return null;
  try {
    const r: any = await db.execute(sql.raw(
      `SELECT trust_path_analysis FROM funnel_snapshots WHERE id='${snapshotId}' LIMIT 1`
    ));
    const row = r.rows?.[0];
    if (!row) return null;
    const t: any = (() => { try { return JSON.parse(row.trust_path_analysis); } catch { return row.trust_path_analysis || {}; } })();
    return {
      score: t?.score ?? null,
      proofPlacements: t?.proofPlacements ?? t?.placementCount ?? null,
      penaltyApplied: t?.proofPenaltyApplied ?? t?.penaltyFactor ?? null,
      warnings: t?.warnings ?? [],
    };
  } catch (e: any) { return { error: e.message }; }
}

async function fetchIntegrity(snapshotId: string | null) {
  if (!snapshotId) return null;
  try {
    const r: any = await db.execute(sql.raw(
      `SELECT id, status, safe_to_execute, warnings FROM integrity_snapshots WHERE id='${snapshotId}' LIMIT 1`
    ));
    const row = r.rows?.[0];
    if (!row) return null;
    let warnings: any = row.warnings;
    try { warnings = JSON.parse(warnings); } catch {}
    return {
      id: row.id,
      status: row.status,
      safeToExecute: row.safe_to_execute,
      warningsCount: Array.isArray(warnings) ? warnings.length : 0,
      sample: Array.isArray(warnings) ? warnings.slice(0, 3) : warnings,
    };
  } catch (e: any) { return { error: e.message }; }
}

async function main() {
  console.log(`[mindai-rerun-v2] capturing BEFORE state...`);
  const before = await probeAll();
  const beforeMech = await fetchMechanismDetail(before.mechanism.id);
  const beforeOffer = await fetchOfferScrub(before.offer.id);
  const beforePers = await fetchPersuasionShape(before.persuasion.id);
  const beforeFun = await fetchFunnelTrust(before.funnel.id);
  const beforeIntg = await fetchIntegrity(before.integrity.id);

  const jobId = `orch_${Date.now()}_${Math.random().toString(36).substr(2, 6)}`;
  await db.execute(sql`
    INSERT INTO orchestrator_jobs (id, blueprint_id, account_id, campaign_id, status, section_statuses)
    VALUES (${jobId}, 'orchestrator-v2', ${ACCOUNT_ID}, ${CAMPAIGN_ID}, 'RUNNING', '[]')
  `);
  console.log(`[mindai-rerun-v2] >>> Starting ${LABEL} | jobId=${jobId} | forceRefresh=true`);
  const t0 = Date.now();
  let runResult: any = null;
  let runError: string | null = null;
  try {
    runResult = await runOrchestrator({
      accountId: ACCOUNT_ID,
      campaignId: CAMPAIGN_ID,
      forceRefresh: true,
      preassignedJobId: jobId,
    });
    console.log(`[mindai-rerun-v2] <<< done in ${((Date.now() - t0) / 1000).toFixed(1)}s | status=${runResult.status} | engines=${runResult.completedEngines?.length}`);
  } catch (e: any) {
    runError = e.message;
    console.error(`[mindai-rerun-v2] <<< FAILED: ${e.message}`);
  }

  console.log(`[mindai-rerun-v2] capturing AFTER state...`);
  const after = await probeAll();
  const afterMech = await fetchMechanismDetail(after.mechanism.id);
  const afterOffer = await fetchOfferScrub(after.offer.id);
  const afterPers = await fetchPersuasionShape(after.persuasion.id);
  const afterFun = await fetchFunnelTrust(after.funnel.id);
  const afterIntg = await fetchIntegrity(after.integrity.id);

  // Compute diffs
  const diffs: SnapshotProbe[] = ENGINES.map(([name]) => ({
    engine: name,
    before: before[name],
    after: after[name],
    rowAdded: !!(after[name].id && after[name].id !== before[name].id),
  }));

  const report = {
    runMeta: {
      label: LABEL,
      campaignId: CAMPAIGN_ID,
      accountId: ACCOUNT_ID,
      jobId,
      runDurationSec: ((Date.now() - t0) / 1000).toFixed(1),
      runStatus: runResult?.status ?? "ERROR",
      runError,
      completedEngines: runResult?.completedEngines ?? [],
      failedEngine: runResult?.failedEngine ?? null,
      blockReason: runResult?.blockReason ?? null,
    },
    diffs,
    mechanismV2: { before: beforeMech, after: afterMech },
    offerScrub: { before: beforeOffer, after: afterOffer },
    persuasionShape: { before: beforePers, after: afterPers },
    funnelTrust: { before: beforeFun, after: afterFun },
    integrityGate: { before: beforeIntg, after: afterIntg },
  };

  const outDir = path.resolve(process.cwd(), ".local/validation");
  fs.mkdirSync(outDir, { recursive: true });
  const outJson = path.join(outDir, "mindai-rerun-v2.json");
  fs.writeFileSync(outJson, JSON.stringify(report, null, 2));
  console.log(`[mindai-rerun-v2] wrote ${outJson}`);
  console.log(`[mindai-rerun-v2] DONE.`);
  process.exit(0);
}

main().catch((e) => { console.error(e); process.exit(1); });
