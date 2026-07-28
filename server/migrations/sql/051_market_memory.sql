-- Migration 051: market_memory — long-term historical record of validated
-- Watchtower Market Insights (P-4 Strategic Reasoning Layer).
--
-- Every validated market insight (AI judge-approved or deterministic summary
-- over real signal content) is stored here so the Strategic Reasoning Engine
-- can compare current market behavior against history ("has this happened
-- before?", "is this temporary or recurring?"). Deduped by content
-- fingerprint per campaign+window: unchanged signal states never create
-- duplicate history rows.
--
-- JSON payload columns use text (house convention — see evidence columns on
-- pipeline_change_events / performance_cycle_reports).

CREATE TABLE IF NOT EXISTS market_memory (
  id varchar PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id varchar NOT NULL,
  campaign_id varchar NOT NULL,
  window_days integer NOT NULL,
  window_from timestamp NOT NULL,
  window_to timestamp NOT NULL,
  -- SHA-256 over signal content (window timestamps excluded) — same
  -- fingerprint the insight cache uses, so memory dedup matches cache reuse.
  fingerprint text NOT NULL,
  -- 'ai' (judge-approved interpretation) | 'deterministic' (verified summary)
  source text NOT NULL,
  headline text NOT NULL,
  narrative text NOT NULL,
  signal_groups text NOT NULL DEFAULT '[]',
  dominant_themes text NOT NULL DEFAULT '[]',
  emerging_themes text NOT NULL DEFAULT '[]',
  declining_themes text NOT NULL DEFAULT '[]',
  confirmed_shifts text NOT NULL DEFAULT '[]',
  -- overall confidence of the stored insight: high | medium | low
  confidence text NOT NULL,
  -- ok | thin (insufficient insights are never stored)
  data_status text NOT NULL,
  based_on text NOT NULL DEFAULT '{}',
  created_at timestamp NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS market_memory_fingerprint_uniq
  ON market_memory (campaign_id, window_days, fingerprint);

CREATE INDEX IF NOT EXISTS market_memory_campaign_idx
  ON market_memory (campaign_id, window_days, created_at);
