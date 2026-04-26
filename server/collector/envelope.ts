/**
 * Phase 8.0 — Collector envelope contract.
 *
 * Pure type definitions. No runtime imports. Defines the shape every
 * Collector-produced envelope must conform to so the Boss agent and the
 * pipeline lanes can consume acquisitions in a uniform, lineage-bearing
 * way.
 *
 * The envelope is the single contract between the legacy Main acquisition
 * surface (server/competitive-intelligence/data-acquisition.ts and
 * server/user-channel-scraper.ts) and the new Phase 8.0 pipeline. The
 * adapter at server/collector/index.ts is responsible for translating
 * Main's stored data into this shape and persisting one row per
 * acquisition into pipeline_acquisitions.
 */

export type CollectorLane = "user" | "competitor";

export type CollectorEntityType =
  | "user_channel"
  | "competitor_website"
  | "competitor_instagram"
  | "competitor_tiktok"
  | "competitor_reviews";

export interface CollectorProvenance {
  /** True iff the envelope was served from a previously persisted row. */
  cache_hit: boolean;
  /** Non-fatal issues observed during acquisition (missing entity, partial payload, parse errors). */
  warnings: string[];
  /** Identifier of the underlying Main adapter that produced the payload. */
  upstream_adapter?: string;
  fetch_started_at?: string;
  fetch_finished_at?: string;
  fetch_duration_ms?: number;
  /** True iff caller passed freshness.force=true. */
  forced_freshness?: boolean;
  [k: string]: unknown;
}

export interface CollectorEnvelope {
  acquisition_id: string;
  account_id: string;
  campaign_id: string;
  lane: CollectorLane;
  entity_type: CollectorEntityType;
  entity_id: string;
  source_adapter: string;
  /** ISO-8601 timestamp the envelope was finalized. String so it round-trips
   *  through JSON cleanly and matches downstream lane input contracts
   *  (UserLaneInput.collectedAt: string, CompetitorLaneInput.collectedAt: string). */
  collected_at: string;
  /** Adapter-normalized payload. Translation hygiene (envelope-to-lane) inspects fields like
   *  headlines, cta_labels, pains, desires, metrics, posts, hashtags, offer_phrases. */
  payload: Record<string, unknown>;
  provenance: CollectorProvenance;
}
