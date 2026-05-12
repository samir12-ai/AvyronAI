/**
 * Migration 013 — Seal #2 (Task #20): Auth-hardening tables.
 *
 * F9.4 — `auth_lockouts`: per-email failure tracking with sliding 15min
 * window + 15min lockout. Email is PK so concurrent attempts share one row.
 *
 * F9.8 — `auth_sessions`: per-(account, device) refresh-token rotation. Old
 * rows are NOT deleted on rotate — they are marked `revoked_at` so a reused
 * refresh token can be detected (SECURITY_REFRESH_REUSE → revoke all).
 *
 * Partial unique index enforces "at most one ACTIVE refresh token per device"
 * while still allowing multiple historical (revoked) rows to coexist.
 */
import { db } from "../db";
import { sql } from "drizzle-orm";

export async function migrateAuthHardening() {
  console.log("[Migration-013] Creating auth_lockouts + auth_sessions tables...");

  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS auth_lockouts (
      email             TEXT      PRIMARY KEY,
      failed_attempts   INTEGER   NOT NULL DEFAULT 0,
      window_start      TIMESTAMP NOT NULL DEFAULT NOW(),
      locked_until      TIMESTAMP,
      last_attempt_at   TIMESTAMP NOT NULL DEFAULT NOW()
    )
  `);
  await db.execute(sql`CREATE INDEX IF NOT EXISTS idx_auth_lockouts_locked_until ON auth_lockouts (locked_until)`);

  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS auth_sessions (
      id                  VARCHAR   PRIMARY KEY DEFAULT gen_random_uuid(),
      account_id          VARCHAR   NOT NULL,
      user_id             VARCHAR   NOT NULL,
      device_fingerprint  TEXT      NOT NULL DEFAULT 'default',
      refresh_token_hash  TEXT      NOT NULL,
      issued_at           TIMESTAMP NOT NULL DEFAULT NOW(),
      last_used_at        TIMESTAMP NOT NULL DEFAULT NOW(),
      revoked_at          TIMESTAMP,
      revoke_reason       TEXT
    )
  `);
  await db.execute(sql`CREATE INDEX IF NOT EXISTS idx_auth_sessions_account ON auth_sessions (account_id, revoked_at)`);
  // Partial unique: at most ONE active session per (account, device).
  // Revoked rows are kept (history + reuse detection) and don't conflict.
  await db.execute(sql`
    CREATE UNIQUE INDEX IF NOT EXISTS uq_auth_sessions_active_device
      ON auth_sessions (account_id, device_fingerprint)
      WHERE revoked_at IS NULL
  `);

  console.log("[Migration-013] auth_lockouts + auth_sessions ready.");
}
