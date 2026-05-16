/**
 * Task #54 — GR19 (BETA_ADMISSIONS_FROZEN) + GR20 (BETA_ACCOUNT_CAP).
 *
 * Operator-toggleable admission gates evaluated at `/api/auth/register`.
 * Both checks run BEFORE bcrypt + DB insert so the admission decision is
 * made on the cheapest possible path and a frozen window cannot burn CPU.
 *
 * - GR19 returns 503 + `BETA_ADMISSIONS_FROZEN` with `Retry-After: 3600`.
 * - GR20 returns 503 + `BETA_ACCOUNT_CAP_REACHED` with the active count and
 *   the configured cap so the operator can see the trip reason from logs.
 *
 * No `??` / `||` semantic fallbacks on the verdict field (`AdmissionDecision.outcome`)
 * — D1–D5 contract compliance.
 */
import { db } from "../db";
import { users } from "@shared/schema";
import { sql } from "drizzle-orm";
import { logAudit } from "../audit";

export type AdmissionOutcome = "admit" | "frozen" | "cap_reached";

export interface AdmissionDecision {
  outcome: AdmissionOutcome;
  status: number;
  errorCode?: string;
  message?: string;
  retryAfterSec?: number;
  details?: Record<string, unknown>;
}

function isFrozen(): boolean {
  const v = (process.env.BETA_ADMISSIONS_FROZEN || "").toLowerCase().trim();
  return v === "true" || v === "1" || v === "yes";
}

function getCap(): number | null {
  const raw = process.env.BETA_ACCOUNT_CAP;
  if (!raw) return null;
  const n = Number(raw);
  if (!Number.isFinite(n) || n < 0) return null;
  return Math.floor(n);
}

async function getActiveAccountCount(): Promise<number> {
  // "Active" = any row in users where the deletion reaper hasn't completed.
  // The trial/paid distinction is irrelevant for the cap — every active row
  // counts against the beta seat budget.
  const res = await db.execute(sql`SELECT COUNT(*)::int AS n FROM users WHERE deleted_at IS NULL`);
  const row = (res.rows as any[])[0];
  return Number(row?.n) || 0;
}

export async function evaluateBetaAdmission(): Promise<AdmissionDecision> {
  if (isFrozen()) {
    return {
      outcome: "frozen",
      status: 503,
      errorCode: "BETA_ADMISSIONS_FROZEN",
      message: "New account signups are temporarily paused. Please try again later.",
      retryAfterSec: 3600,
      details: { reason: "BETA_ADMISSIONS_FROZEN=true" },
    };
  }

  const cap = getCap();
  if (cap !== null) {
    try {
      const active = await getActiveAccountCount();
      if (active >= cap) {
        return {
          outcome: "cap_reached",
          status: 503,
          errorCode: "BETA_ACCOUNT_CAP_REACHED",
          message: "We're at capacity for new beta accounts. We'll open more seats soon.",
          retryAfterSec: 3600,
          details: { activeAccounts: active, cap },
        };
      }
    } catch (err) {
      console.error("[BetaAdmission] CAP_COUNT_FAILED — admitting fail-open", (err as Error)?.message);
    }
  }

  return { outcome: "admit", status: 200 };
}

export async function recordAdmissionDenied(
  decision: AdmissionDecision,
  emailLower: string,
  ip: string | undefined,
): Promise<void> {
  // Admission denials are operator-relevant — log under a sentinel account id
  // since no account exists yet. The audit row is the operator's only signal
  // that GR19/GR20 is actively blocking signups.
  const eventType = decision.outcome === "frozen"
    ? "BETA_ADMISSIONS_FROZEN"
    : "BETA_ACCOUNT_CAP_REACHED";
  try {
    await logAudit("system", eventType, {
      details: {
        ...decision.details,
        emailHash: hashEmail(emailLower),
        ip: ip || null,
      },
      riskLevel: "info",
    });
  } catch (err) {
    console.error("[BetaAdmission] AUDIT_WRITE_FAILED", (err as Error)?.message);
  }
}

function hashEmail(email: string): string {
  // Short, non-reversible identifier for log correlation. Not for security —
  // we just need to tell two denials apart without writing the PII.
  let h = 0;
  for (let i = 0; i < email.length; i++) {
    h = ((h << 5) - h + email.charCodeAt(i)) | 0;
  }
  return `e_${(h >>> 0).toString(36)}`;
}
