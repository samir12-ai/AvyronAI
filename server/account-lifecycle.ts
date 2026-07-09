/**
 * Seal #7 (Task #25 / F9.9) — GDPR account cascade delete.
 *
 * Two-phase, transactional. Phase 1 (request) immediately masks PII on the
 * `users` row and records a tombstone row with a 30-day reaper-after stamp.
 * Phase 2 (reap, daily job) walks every account_id-bearing table inside a
 * single transaction and deletes the rows; if anything fails the whole
 * transaction rolls back and the tombstone stays in `pending`.
 *
 * Why two phases:
 *   - GDPR Art. 17 says "without undue delay" — masking on phase 1 satisfies
 *     this for the personally-identifying surface (email, name, password,
 *     etc.) immediately.
 *   - The 30-day delay between mask and physical delete gives the user an
 *     undo window AND lets us recover from operator mistakes.
 *
 * Why a hardcoded table list instead of catalog introspection:
 *   - The list is the explicit contract. New `account_id`-bearing tables
 *     MUST be added here at the same time they're added to shared/schema.ts.
 *     A test (server/tests/boot-hardening.test.ts) snapshots the schema and
 *     fails CI if a new table appears that isn't in either CASCADE_TABLES
 *     or CASCADE_EXEMPT — preventing silent drift.
 *
 * CASCADE_EXEMPT enumerates tables that hold account_id but must be
 * preserved for compliance / audit:
 *   - audit_log_archive  → required for GDPR Art. 30 record of processing
 *   - account_tombstones → the row we're acting on; deleted last by reaper
 */
import { Pool, PoolClient } from "pg";
import * as crypto from "node:crypto";
import { logger } from "./logger";

// =====================================================================
// Tables walked by cascadeDeleteAccount. Order: child → parent.
// Auto-generated from shared/schema.ts on 2026-05-12. Total: 105 tables.
// =====================================================================
export const CASCADE_TABLES: readonly string[] = Object.freeze([
  // Pipeline overlay (Phase 1-6) — innermost first
  "pipeline_clusters",
  "pipeline_user_truth",
  "pipeline_eval_windows",
  "pipeline_dna",
  "boss_runs",
  "pipeline_acquisitions",
  "pipeline_rejections",
  "pipeline_change_events",
  "pipeline_signals",
  "pipeline_snapshots",
  "pipeline_runs",
  // Auth/session
  "auth_sessions",
  // Engine snapshots
  "system_control_verdicts",
  "build_plan_snapshots",
  "user_channel_snapshots",
  "user_public_profiles",
  "strategy_roots",
  "plan_assumptions",
  "execution_tasks",
  "growth_simulations",
  "goal_decompositions",
  "root_bundles",
  "content_dna",
  "conversations",
  "data_source_transitions",
  "snapshot_archive",
  "retention_snapshots",
  "iteration_snapshots",
  "channel_selection_snapshots",
  "budget_governor_snapshots",
  "strategy_validation_snapshots",
  "persuasion_snapshots",
  "awareness_snapshots",
  "integrity_snapshots",
  "funnel_snapshots",
  "offer_snapshots",
  "mechanism_snapshots",
  "differentiation_snapshots",
  "positioning_snapshots",
  "audience_snapshots",
  "mi_fetch_jobs",
  "ci_competitor_metrics_snapshot",
  "ci_competitor_reviews",
  "ci_competitor_comments",
  "ci_competitor_posts",
  "mi_refresh_schedule",
  "mi_signal_logs",
  "mi_snapshots",
  "scrape_target_backoff",
  // Orchestrator + plans + analytics
  "orchestrator_jobs",
  "retention_gate_inputs",
  "iteration_gate_inputs",
  "manual_retention_metrics",
  "manual_campaign_metrics",
  "ui_state_store",
  "plan_documents",
  "ai_usage_log",
  "business_data_layer",
  "studio_items",
  "decision_attributions",
  "calendar_entries",
  "required_work",
  "plan_approvals",
  "strategic_plans",
  "dominance_modifications",
  "dominance_analyses",
  "extraction_metrics",
  "strategic_audit_logs",
  "blueprint_versions",
  "blueprint_competitors",
  "strategic_blueprints",
  "ci_shared_profiles",
  "competitor_web_data",
  "campaign_selections",
  "meta_credentials",
  "ci_strategy_decisions",
  "ci_recommendations",
  "ci_market_analyses",
  "ci_snapshots",
  "ci_competitors",
  "ad_spend_entries",
  "revenue_entries",
  "landing_pages",
  "lead_magnets",
  "funnel_content_map",
  "funnel_definitions",
  "conversion_events",
  "cta_variants",
  "tracking_links",
  "lead_forms",
  "leads",
  "feature_flag_audit",
  "feature_flags",
  "caption_variants",
  "published_posts",
  "brand_config",
  "job_queue",
  "account_state",
  "audit_log",
  "decision_outcomes",
  "baseline_history",
  "guardrail_config",
  "signature_series",
  "moat_candidates",
  "weekly_reports",
  "growth_campaigns",
  "content_performance_snapshots",
  "strategy_memory",
  "strategy_decisions",
  "strategy_insights",
  "performance_snapshots",
  // Asset tables (videos / posts)
  "video_projects",
  "reservations",
  "post_interactions",
  "portfolio_posts",
  "photographer_profiles",
  // Operational/continuity state (2026-07 drift-sentinel closure): tenant-scoped
  // rows deleted by account_id; NULL/global rows (nullable account_id on
  // system_notices, orchestrator_replay_cassettes) survive the WHERE clause.
  "mutation_log",
  "engine_operational_state",
  "in_flight_jobs",
  "plan_anchor_resets",
  "continuity_window_claims",
  "system_notices",
  "ai_input_snapshots",
  "orchestrator_replay_cassettes",
  // Users last (other tables FK to users)
  "users",
]);

/** Tables that hold account_id but MUST survive cascade delete. */
export const CASCADE_EXEMPT: readonly string[] = Object.freeze([
  "audit_log_archive",
  "account_tombstones",
  "schema_migrations",
  "auth_lockouts",
  "messages",
]);

const TOMBSTONE_RETENTION_DAYS = 30;

let pool: Pool | null = null;
function getPool(): Pool {
  if (!pool) pool = new Pool({ connectionString: process.env.DATABASE_URL });
  return pool;
}

function hashIp(ip: string | undefined): string | null {
  if (!ip) return null;
  return crypto.createHash("sha256").update(ip).digest("hex").slice(0, 32);
}

/**
 * Phase 1: mask PII immediately + insert tombstone. Idempotent — re-calling
 * just refreshes the reaper-after stamp.
 */
export async function requestAccountDeletion(opts: {
  accountId: string;
  userId: string;
  ip?: string;
  userAgent?: string;
}): Promise<{ tombstoneAt: Date; reaperAfter: Date }> {
  const reaperAfter = new Date(Date.now() + TOMBSTONE_RETENTION_DAYS * 24 * 60 * 60 * 1000);
  const c = await getPool().connect();
  try {
    await c.query("BEGIN");
    try {
      // Mask PII on `users`. We don't drop the row yet — the cascade reaper
      // does that. But the personal data is unrecoverable from this moment.
      // shared/schema.ts users columns (snake_case in DB):
      //   username, password, email, account_id, stripe_customer_id
      // Mask all PII immediately. We can't NULL `username` (NOT NULL) or
      // `password` (NOT NULL) so we replace them with tombstone sentinels.
      await c.query(
        `UPDATE users SET
           username = 'deleted-' || id,
           email = 'deleted-' || id || '@tombstone.local',
           password = 'TOMBSTONE',
           stripe_customer_id = NULL
         WHERE account_id = $1`,
        [opts.accountId],
      );
      await c.query(
        `INSERT INTO account_tombstones (account_id, requested_by, reaper_after, state)
         VALUES ($1, $2, $3, 'pending')
         ON CONFLICT (account_id) DO UPDATE SET
           reaper_after = EXCLUDED.reaper_after,
           state = 'pending'`,
        [opts.accountId, opts.userId, reaperAfter],
      );
      await c.query(
        `INSERT INTO audit_log_archive (account_id, user_id, event_type, ip_hash, user_agent, details)
         VALUES ($1, $2, 'account_delete_requested', $3, $4, $5)`,
        [opts.accountId, opts.userId, hashIp(opts.ip), opts.userAgent ?? null, JSON.stringify({ reaperAfter })],
      );
      await c.query("COMMIT");
    } catch (err) {
      await c.query("ROLLBACK").catch(() => undefined);
      throw err;
    }
  } finally {
    c.release();
  }
  logger.warn(
    { component: "account-lifecycle", accountId: opts.accountId, userId: opts.userId, reaperAfter },
    "account deletion requested — PII masked, reaper scheduled",
  );
  return { tombstoneAt: new Date(), reaperAfter };
}

/**
 * Phase 2: full cascade delete inside a single transaction. Called by the
 * daily reaper for tombstones whose reaper_after has passed; can also be
 * triggered manually for synchronous testing (use force=true).
 *
 * If ANY table delete fails, the whole TX rolls back and the tombstone
 * remains pending — no partial deletes.
 */
export async function cascadeDeleteAccount(
  accountId: string,
  opts: { force?: boolean; client?: PoolClient } = {},
): Promise<{ rowsByTable: Record<string, number>; totalRows: number }> {
  const ownClient = !opts.client;
  const c = opts.client ?? (await getPool().connect());
  const rowsByTable: Record<string, number> = {};
  let totalRows = 0;

  try {
    if (!opts.force) {
      const r = await c.query<{ state: string; reaper_after: Date }>(
        "SELECT state, reaper_after FROM account_tombstones WHERE account_id = $1",
        [accountId],
      );
      const t = r.rows[0];
      if (!t) throw new Error(`cascadeDeleteAccount: no tombstone for ${accountId}`);
      if (t.state === "reaped") {
        logger.info({ component: "account-lifecycle", accountId }, "already reaped — no-op");
        return { rowsByTable, totalRows };
      }
      if (t.reaper_after > new Date()) {
        throw new Error(`cascadeDeleteAccount: tombstone for ${accountId} not yet eligible (reaper_after=${t.reaper_after.toISOString()})`);
      }
    }

    if (ownClient) await c.query("BEGIN");
    try {
      for (const table of CASCADE_TABLES) {
        const r = await c.query(`DELETE FROM ${table} WHERE account_id = $1`, [accountId]);
        rowsByTable[table] = r.rowCount ?? 0;
        totalRows += r.rowCount ?? 0;
      }
      // Mark tombstone reaped (write to the exempt table — survives the cascade).
      await c.query(
        "UPDATE account_tombstones SET state = 'reaped', reaped_at = now(), cascade_summary = $2 WHERE account_id = $1",
        [accountId, JSON.stringify({ totalRows, tables: Object.keys(rowsByTable).length })],
      );
      await c.query(
        `INSERT INTO audit_log_archive (account_id, event_type, details)
         VALUES ($1, 'account_delete_reaped', $2)`,
        [accountId, JSON.stringify({ totalRows, perTable: rowsByTable })],
      );
      if (ownClient) await c.query("COMMIT");
    } catch (err) {
      if (ownClient) await c.query("ROLLBACK").catch(() => undefined);
      logger.error(
        { component: "account-lifecycle", accountId, err: String(err) },
        "cascade delete failed — transaction rolled back, tombstone stays pending",
      );
      throw err;
    }

    logger.warn(
      { component: "account-lifecycle", accountId, totalRows, tables: Object.keys(rowsByTable).length },
      "account cascade-deleted",
    );
    return { rowsByTable, totalRows };
  } finally {
    if (ownClient) c.release();
  }
}

/**
 * Daily reaper — call from a scheduler. Walks pending tombstones whose
 * reaper_after has passed and cascade-deletes them one by one.
 */
export async function runTombstoneReaper(): Promise<{ reaped: number; failed: number }> {
  const c = await getPool().connect();
  let reaped = 0;
  let failed = 0;
  try {
    const r = await c.query<{ account_id: string }>(
      "SELECT account_id FROM account_tombstones WHERE state = 'pending' AND reaper_after <= now()",
    );
    for (const row of r.rows) {
      try {
        await cascadeDeleteAccount(row.account_id);
        reaped += 1;
      } catch (err) {
        failed += 1;
        logger.error(
          { component: "account-lifecycle", accountId: row.account_id, err: String(err) },
          "reaper attempt failed — will retry on next tick",
        );
      }
    }
  } finally {
    c.release();
  }
  if (reaped + failed > 0) {
    logger.info({ component: "account-lifecycle", reaped, failed }, "reaper tick complete");
  }
  return { reaped, failed };
}

/**
 * User-initiated cancel — only valid before the reaper runs. Clears the
 * tombstone, but cannot un-mask the PII (one-way operation; that was the
 * whole point of phase 1).
 */
export async function cancelAccountDeletion(accountId: string): Promise<boolean> {
  const c = await getPool().connect();
  try {
    const r = await c.query(
      "UPDATE account_tombstones SET state = 'cancelled' WHERE account_id = $1 AND state = 'pending'",
      [accountId],
    );
    return (r.rowCount ?? 0) > 0;
  } finally {
    c.release();
  }
}
