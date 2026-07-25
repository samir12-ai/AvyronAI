/**
 * ============================================================================
 * DNA ENRICHMENT REQUEST STORE (Path B persistence)
 * ============================================================================
 *
 * The ONLY writer/reader of dna_enrichment_requests. Campaign-scoped operational
 * UX state — NOT strategy_memory, NOT engine_operational_state, so it is outside
 * the canonical-fact write-gate. One open row per (campaign_id, engine_kind).
 *
 * The orchestrator calls upsert/autoResolve after the positioning + offer engines
 * run. The API routes call getOpen* / markResolved on operator action. Engines
 * NEVER call this (they only SURFACE a DnaEnrichmentSignal on their result) — DB
 * writes stay at the orchestration/route layer.
 *
 * NO SILENT CATCHES: callers handle thrown errors; this module does not swallow.
 */
import { and, eq } from "drizzle-orm";
import { db } from "../db";
import { dnaEnrichmentRequests, type DnaEnrichmentRequest } from "@shared/schema";
import type { DnaEnrichmentSignal } from "../shared/dna-enrichment";

export type EnrichmentEngineKind = DnaEnrichmentSignal["engineKind"];

/**
 * Raise (or refresh) the open enrichment request for a campaign+engine. Called
 * when the interchangeability gate is still failing at retry exhaustion. Upserts
 * on the (campaign_id, engine_kind) unique index so a re-run refreshes the row
 * rather than piling duplicates.
 */
export async function upsertEnrichmentRequest(input: {
  accountId: string;
  campaignId: string;
  signal: DnaEnrichmentSignal;
}): Promise<void> {
  const { accountId, campaignId, signal } = input;
  const top = signal.candidates.length > 0 ? signal.candidates[0] : null;
  const now = new Date();

  await db
    .insert(dnaEnrichmentRequests)
    .values({
      accountId,
      campaignId,
      engineKind: signal.engineKind,
      lastRejectionReason: signal.lastRejectionReason,
      candidateDifferentiator: top ? top.differentiator : null,
      groundingRefs: top ? top.groundingRefs : null,
      suggestionText: signal.suggestionText.length > 0 ? signal.suggestionText : null,
      status: "open",
      updatedAt: now,
      resolvedAt: null,
    })
    .onConflictDoUpdate({
      target: [dnaEnrichmentRequests.campaignId, dnaEnrichmentRequests.engineKind],
      set: {
        accountId,
        lastRejectionReason: signal.lastRejectionReason,
        candidateDifferentiator: top ? top.differentiator : null,
        groundingRefs: top ? top.groundingRefs : null,
        suggestionText: signal.suggestionText.length > 0 ? signal.suggestionText : null,
        status: "open",
        updatedAt: now,
        resolvedAt: null,
      },
    });
}

/**
 * Auto-resolve the open request for a campaign+engine — called when that engine
 * later PASSES the interchangeability gate, so the operator prompt is no longer
 * warranted (truthful: the problem cleared). No-op when nothing is open.
 */
export async function autoResolveEnrichmentRequest(input: {
  campaignId: string;
  engineKind: EnrichmentEngineKind;
}): Promise<void> {
  const now = new Date();
  await db
    .update(dnaEnrichmentRequests)
    .set({ status: "resolved", resolvedAt: now, updatedAt: now })
    .where(
      and(
        eq(dnaEnrichmentRequests.campaignId, input.campaignId),
        eq(dnaEnrichmentRequests.engineKind, input.engineKind),
        eq(dnaEnrichmentRequests.status, "open"),
      ),
    );
}

/** All open enrichment requests for a campaign (dashboard reads these). */
export async function getOpenEnrichmentRequests(campaignId: string): Promise<DnaEnrichmentRequest[]> {
  return db
    .select()
    .from(dnaEnrichmentRequests)
    .where(and(eq(dnaEnrichmentRequests.campaignId, campaignId), eq(dnaEnrichmentRequests.status, "open")));
}

/** The single open request for a campaign+engine, or null. Used by the resolve route. */
export async function getOpenEnrichmentRequest(input: {
  campaignId: string;
  engineKind: EnrichmentEngineKind;
}): Promise<DnaEnrichmentRequest | null> {
  const rows = await db
    .select()
    .from(dnaEnrichmentRequests)
    .where(
      and(
        eq(dnaEnrichmentRequests.campaignId, input.campaignId),
        eq(dnaEnrichmentRequests.engineKind, input.engineKind),
        eq(dnaEnrichmentRequests.status, "open"),
      ),
    )
    .limit(1);
  return rows.length > 0 ? rows[0] : null;
}

/** Mark a request resolved after the operator confirms/edits (route appends anchor). */
export async function markEnrichmentResolved(input: {
  campaignId: string;
  engineKind: EnrichmentEngineKind;
}): Promise<void> {
  const now = new Date();
  await db
    .update(dnaEnrichmentRequests)
    .set({ status: "resolved", resolvedAt: now, updatedAt: now })
    .where(
      and(
        eq(dnaEnrichmentRequests.campaignId, input.campaignId),
        eq(dnaEnrichmentRequests.engineKind, input.engineKind),
        eq(dnaEnrichmentRequests.status, "open"),
      ),
    );
}
