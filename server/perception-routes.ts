// Perception Layer (Slices 1+2) — customer-facing read endpoints that
// surface the system's hidden runtime intelligence (continuity ticks,
// boss-run verdicts, re-anchor events) using the curated phrasing in
// shared/perception-translator.ts.
//
// Both endpoints are auth-scoped via requireCampaign (which itself
// runs after the global /api authMiddleware). NOT admin-token-gated —
// these are first-class user surfaces, not operator dashboards.
//
// D5 discipline: every translator output that returns `null` is hidden
// from the response. We NEVER substitute a generic "all good" phrase
// for an unknown internal status. Empty data => empty array + an
// explicit `state: "watching" | "no_data"` flag.

import type { Express, Request, Response } from "express";
import { db } from "./db";
import { requireCampaign } from "./campaign-routes";
import { bossRuns, planAnchorResets, continuityTicks } from "@shared/schema";
import { eq, and, desc, gte, sql } from "drizzle-orm";
import {
  translateQ1Verdict,
  translateQ2Verdict,
  translateFreshness,
  translateBossRunStatus,
  translateReanchorReason,
  translateContinuityDecision,
  type WatchtowerLine,
  type ActivityEvent,
} from "@shared/perception-translator";

const LOG_PREFIX = "[Perception]";

export function registerPerceptionRoutes(app: Express) {
  // -------------------------------------------------------------------------
  // GET /api/perception/watchtower?campaignId=...
  //
  // Returns 3 short "lines" (market state, plan state, freshness) suitable
  // for a single dashboard strip. Reads ONLY the latest completed boss_run
  // for the campaign. If none exists, every line is in the `watching` /
  // `unknown` tone — the strip still renders, just empty-state.
  // -------------------------------------------------------------------------
  app.get("/api/perception/watchtower", requireCampaign, async (req: Request, res: Response) => {
    try {
      const { accountId, campaignId } = (req as any).campaignContext;

      const [latest] = await db
        .select({
          id: bossRuns.id,
          status: bossRuns.status,
          q1Verdict: bossRuns.q1Verdict,
          q2Verdict: bossRuns.q2Verdict,
          finishedAt: bossRuns.finishedAt,
          createdAt: bossRuns.createdAt,
        })
        .from(bossRuns)
        .where(and(eq(bossRuns.accountId, accountId), eq(bossRuns.campaignId, campaignId)))
        .orderBy(desc(bossRuns.createdAt))
        .limit(1);

      const lastCheckedAt = latest?.finishedAt ?? latest?.createdAt ?? null;

      const lines: { id: string; line: WatchtowerLine }[] = [
        { id: "market", line: translateQ2Verdict(latest?.q2Verdict) },
        { id: "plan", line: translateQ1Verdict(latest?.q1Verdict) },
        { id: "freshness", line: translateFreshness(lastCheckedAt) },
      ];

      // NOTE: We intentionally DO NOT return bossRunId / internal status
      // strings — Phase 8 customer-surface gate. The translator output is
      // the entire customer-visible payload.
      return res.json({
        success: true,
        state: latest ? "ready" : "no_data",
        lastCheckedAt: lastCheckedAt instanceof Date ? lastCheckedAt.toISOString() : lastCheckedAt,
        lines,
      });
    } catch (err: any) {
      console.error(`${LOG_PREFIX} watchtower failed:`, err?.message ?? err);
      return res.status(500).json({ success: false, error: "WATCHTOWER_FAILED" });
    }
  });

  // -------------------------------------------------------------------------
  // GET /api/perception/activity?campaignId=...&sinceHours=168
  //
  // Returns a unified, time-ordered list of customer-visible system actions
  // over the last `sinceHours` (default 7 days). Sources:
  //   - boss_runs (review attempts)
  //   - plan_anchor_resets (review-cadence re-alignment)
  //   - continuity_ticks (per-campaign scheduler decisions extracted from
  //     the JSONB `notes` column)
  // Each row passes through the perception-translator allowlist. Unknown
  // statuses are DROPPED (not coerced into "all good").
  // -------------------------------------------------------------------------
  app.get("/api/perception/activity", requireCampaign, async (req: Request, res: Response) => {
    try {
      const { accountId, campaignId } = (req as any).campaignContext;
      const sinceHours = Math.max(1, Math.min(24 * 30, Number(req.query.sinceHours) || 168));
      const since = new Date(Date.now() - sinceHours * 3_600_000);
      const limit = Math.max(1, Math.min(100, Number(req.query.limit) || 30));

      const events: ActivityEvent[] = [];

      // Source 1: boss_runs
      const runs = await db
        .select({
          id: bossRuns.id,
          status: bossRuns.status,
          q1Verdict: bossRuns.q1Verdict,
          q2Verdict: bossRuns.q2Verdict,
          finishedAt: bossRuns.finishedAt,
          createdAt: bossRuns.createdAt,
        })
        .from(bossRuns)
        .where(and(
          eq(bossRuns.accountId, accountId),
          eq(bossRuns.campaignId, campaignId),
          gte(bossRuns.createdAt, since),
        ))
        .orderBy(desc(bossRuns.createdAt))
        .limit(limit);

      for (const r of runs) {
        const at = r.finishedAt ?? r.createdAt;
        if (!at) continue;
        const t = translateBossRunStatus(r.status, r.q1Verdict, r.q2Verdict);
        if (!t) continue; // fail-closed: drop unrecognized statuses
        events.push({
          // Opaque ids only — internal UUIDs/status codes never reach the
          // customer payload (Phase 8 customer-surface gate). `kind` + `at`
          // are enough to disambiguate for React keys.
          id: `boss:${at.getTime()}`,
          kind: "boss_run",
          at: at.toISOString(),
          tone: t.tone,
          title: t.title,
          detail: t.detail,
        });
      }

      // Source 2: plan_anchor_resets
      const resets = await db
        .select({
          id: planAnchorResets.id,
          reason: planAnchorResets.reason,
          reanchoredAt: planAnchorResets.reanchoredAt,
        })
        .from(planAnchorResets)
        .where(and(
          eq(planAnchorResets.accountId, accountId),
          eq(planAnchorResets.campaignId, campaignId),
          gte(planAnchorResets.reanchoredAt, since),
        ))
        .orderBy(desc(planAnchorResets.reanchoredAt))
        .limit(limit);

      for (const r of resets) {
        const t = translateReanchorReason(r.reason);
        events.push({
          id: `anchor:${r.reanchoredAt.getTime()}`,
          kind: "reanchor",
          at: r.reanchoredAt.toISOString(),
          tone: t.tone,
          title: t.title,
          detail: t.detail,
        });
      }

      // Source 3: continuity_ticks → per-campaign decisions from JSONB notes.
      // Tenant guard: filter on BOTH accountId AND campaignId inside the
      // JSONB note. campaignId alone would risk cross-tenant exposure if
      // two tenants ever shared a campaignId by collision.
      const tickRows = await db.execute(sql`
        SELECT
          (note->>'decision')::text AS decision,
          tick_at                   AS tick_at
        FROM ${continuityTicks},
             jsonb_array_elements(notes) AS note
        WHERE tick_at >= ${since}
          AND (note->>'accountId')  = ${accountId}
          AND (note->>'campaignId') = ${campaignId}
        ORDER BY tick_at DESC
        LIMIT ${limit}
      `);

      const rows = (tickRows as any).rows ?? (tickRows as any);
      for (const row of rows) {
        const decision = row.decision as string | null;
        const t = translateContinuityDecision(decision);
        if (!t) continue;
        // De-noise: drop the two heartbeat "no-op" decisions; customers
        // do not need a line per hour saying "nothing was due".
        if (decision === "skipped_no_advance" || decision === "skipped_completed_claim_exists" || decision === "skipped_claimed_by_other_replica") continue;
        const at = row.tick_at instanceof Date ? row.tick_at : new Date(row.tick_at);
        events.push({
          id: `tick:${at.getTime()}`,
          kind: "tick_decision",
          at: at.toISOString(),
          tone: t.tone,
          title: t.label,
          detail: null,
        });
      }

      // Merge + sort + cap.
      events.sort((a, b) => (a.at < b.at ? 1 : -1));
      const trimmed = events.slice(0, limit);

      return res.json({
        success: true,
        state: trimmed.length > 0 ? "ready" : "watching",
        sinceHours,
        events: trimmed,
      });
    } catch (err: any) {
      console.error(`${LOG_PREFIX} activity failed:`, err?.message ?? err);
      return res.status(500).json({ success: false, error: "ACTIVITY_FAILED" });
    }
  });

  console.log("[Perception] Routes registered: GET /api/perception/watchtower, GET /api/perception/activity");
}
