/**
 * Task #91 / Phase 4-C — Operator pager integration for BLOCK-triggered
 * auto-revert.
 *
 * The spec calls for "page the operator on every non-shadow BLOCK
 * auto-revert". The codebase has no central pager SDK, so this module
 * provides the canonical hand-off:
 *
 *   1. Structured log line with prefix `[ParityPager] PARITY_BLOCK_PAGE`
 *      and `level=error` so the Replit log alerting can match a single
 *      regex (operator runbook entry already covers the symbol).
 *   2. `PARITY_BLOCK_PAGE` audit_log row with full attribution so
 *      the operator panel + ops-guardian interpreter can reason about
 *      the incident later.
 *   3. Optional webhook POST to `PARITY_PAGER_WEBHOOK_URL` when set
 *      (PagerDuty Events API v2 compatible payload shape). Skipped
 *      silently when unset (dev / local). Failures log + continue —
 *      the audit row and structured log are the authoritative trail.
 *
 * Idempotency: callers MUST pass a stable `dedupeKey` (we recommend
 * `${moduleId}:${tick-window-floor-hour}`) so repeated divergences in
 * the same hour fan in to one page. We use the audit_log row as the
 * dedupe ledger.
 */
import { pool } from "../../../db";
import { logger } from "../../../logger";

export interface PagerInvocation {
  moduleId: string;
  moduleFlag: string;
  reason: string;
  dedupeKey: string;
  divergencePath?: string;
}

export async function pageOperatorOnBlockRevert(p: PagerInvocation): Promise<void> {
  // Dedupe: skip if an identical PARITY_BLOCK_PAGE row exists in the
  // last hour with the same dedupeKey.
  try {
    const recent = await pool.query<{ cnt: string }>(
      `SELECT COUNT(*)::text AS cnt FROM audit_log
        WHERE event_type = 'PARITY_BLOCK_PAGE'
          AND created_at >= NOW() - INTERVAL '1 hour'
          AND details LIKE $1`,
      [`%"dedupeKey":"${p.dedupeKey}"%`],
    );
    if (parseInt(recent.rows[0]?.cnt ?? "0", 10) > 0) {
      logger.info(
        { component: "parity-pager", moduleId: p.moduleId, dedupeKey: p.dedupeKey },
        "[ParityPager] PARITY_BLOCK_PAGE_DEDUPED (recent row within 1h)",
      );
      return;
    }
  } catch (err) {
    // Continue — dedupe miss is preferable to silently swallowing the page.
    logger.warn(
      { component: "parity-pager", err: String(err) },
      "[ParityPager] DEDUPE_QUERY_FAILED — emitting page anyway",
    );
  }

  // (1) Structured log — primary alarm signal.
  logger.error(
    {
      component: "parity-pager",
      moduleId: p.moduleId,
      moduleFlag: p.moduleFlag,
      reason: p.reason,
      divergencePath: p.divergencePath ?? null,
      dedupeKey: p.dedupeKey,
    },
    "[ParityPager] PARITY_BLOCK_PAGE — operator page emitted (non-shadow BLOCK auto-revert)",
  );

  // (2) Audit row.
  try {
    await pool.query(
      `INSERT INTO audit_log (id, account_id, event_type, details, execution_status, created_at)
       VALUES (gen_random_uuid(), 'system-parity-gate', 'PARITY_BLOCK_PAGE', $1, 'COMPLETED', NOW())`,
      [JSON.stringify({
        moduleId: p.moduleId,
        moduleFlag: p.moduleFlag,
        reason: p.reason,
        divergencePath: p.divergencePath ?? null,
        dedupeKey: p.dedupeKey,
        at: new Date().toISOString(),
      })],
    );
  } catch (err) {
    logger.warn(
      { component: "parity-pager", err: String(err) },
      "[ParityPager] PAGE_AUDIT_WRITE_FAILED",
    );
  }

  // (3) Optional webhook (PagerDuty Events API v2 compatible payload).
  const webhook = process.env.PARITY_PAGER_WEBHOOK_URL;
  if (!webhook) return;
  try {
    const ac = new AbortController();
    const timer = setTimeout(() => ac.abort(), 5000);
    timer.unref?.();
    const resp = await fetch(webhook, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        routing_key: process.env.PARITY_PAGER_ROUTING_KEY ?? "missing",
        event_action: "trigger",
        dedup_key: p.dedupeKey,
        payload: {
          summary: `[ParityGate] BLOCK auto-revert: ${p.moduleId} — ${p.reason}`,
          severity: "error",
          source: "avyron-parity-gate",
          custom_details: {
            moduleId: p.moduleId,
            moduleFlag: p.moduleFlag,
            reason: p.reason,
            divergencePath: p.divergencePath ?? null,
          },
        },
      }),
      signal: ac.signal,
    });
    clearTimeout(timer);
    if (!resp.ok) {
      logger.warn(
        { component: "parity-pager", status: resp.status, moduleId: p.moduleId },
        "[ParityPager] WEBHOOK_NON_2XX",
      );
    }
  } catch (err) {
    logger.warn(
      { component: "parity-pager", err: String(err), moduleId: p.moduleId },
      "[ParityPager] WEBHOOK_POST_FAILED",
    );
  }
}
