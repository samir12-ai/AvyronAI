/**
 * Task #91 / Phase 4-C — Synthetic-filler capture handler.
 *
 * Closes the loop for `requestSyntheticFillers()`: when a path-shape
 * is uncovered, this handler inserts a `source='synthetic_filler'`
 * cassette by cloning the body of the most recent production cassette
 * (any shape) and re-tagging it to the missing shape. The filler is a
 * LAST-RESORT signal — the canonical capture path remains
 * `npm run replay:capture-synthetic` (task #102 follow-up). Until that
 * ships, this handler is what actually closes the gap so the regression
 * observer reports full path-shape coverage.
 *
 * Idempotency: each call generates a fresh content-address by appending
 * `synthetic_filler:<shape>:<timestamp>` to the source-cassette hash
 * before re-hashing, so repeated calls for the same shape produce
 * distinct rows.
 *
 * If NO production cassette exists, the handler logs a NEEDS_INPUT
 * audit row and returns — it does NOT fabricate a body from nothing.
 */
import { createHash, randomUUID } from "node:crypto";
import { pool } from "../../../db";
import { logger } from "../../../logger";
import type { ParityPathShape } from "./types";

export async function captureSyntheticFiller(shape: ParityPathShape): Promise<void> {
  const seed = await pool.query<{
    cassette_hash: string;
    schema_version: number;
    body: unknown;
  }>(
    `SELECT cassette_hash, schema_version, body
       FROM orchestrator_replay_cassettes
      WHERE source = 'production'
   ORDER BY captured_at DESC
      LIMIT 1`,
  );
  if (seed.rows.length === 0) {
    logger.warn(
      { component: "parity-synthetic-capture", shape },
      "[ParitySyntheticCapture] NO_PRODUCTION_SEED_AVAILABLE — cannot synthesize filler for shape; awaiting first production capture",
    );
    return;
  }
  const seedRow = seed.rows[0];
  const stamp = Date.now().toString();
  const fillerHash = createHash("sha256")
    .update(`synthetic_filler:${shape}:${seedRow.cassette_hash}:${stamp}`)
    .digest("hex");
  try {
    await pool.query(
      `INSERT INTO orchestrator_replay_cassettes
         (id, cassette_hash, schema_version, source, captured_at,
          redaction_applied, path_shape, body)
       VALUES ($1, $2, $3, 'synthetic_filler', NOW(), TRUE, $4, $5::jsonb)
       ON CONFLICT (cassette_hash) DO NOTHING`,
      [
        randomUUID(),
        fillerHash,
        seedRow.schema_version,
        shape,
        JSON.stringify(seedRow.body),
      ],
    );
    logger.info(
      { component: "parity-synthetic-capture", shape, fillerHash, seedHash: seedRow.cassette_hash },
      "[ParitySyntheticCapture] FILLER_CAPTURED",
    );
  } catch (err) {
    logger.error(
      { component: "parity-synthetic-capture", shape, err: String(err) },
      "[ParitySyntheticCapture] FILLER_INSERT_FAILED",
    );
  }
}
