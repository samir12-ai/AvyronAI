-- DNA Enrichment Gate (Path B) — campaign-scoped "we need one detail from you" flag.
--
-- WHY: when the interchangeability judge rejects a positioning claim or offer as
-- generic 3/3 times, the auto-enrichment retry (Path A) may still fail to produce
-- a candidate that clears the UNCHANGED judge — because Product DNA genuinely
-- lacks a proprietary differentiator. Rather than silently shipping degraded
-- (REUSED_UNVERIFIED) output, we surface a fail-closed, campaign-scoped request
-- for the operator to confirm/edit the grounded differentiator candidate. On
-- resolve, the confirmed line is appended to growth_campaigns.product_anchor so
-- the NEXT run's judge tests against a real differentiator.
--
-- This is OPERATIONAL / UX state — NOT strategy_memory (outside the canonical-fact
-- write-gate) and NOT engine_operational_state (that singleton is per-engine
-- runtime state, not a per-campaign user prompt). One open row per
-- (campaign_id, engine_kind): the orchestrator upserts on interchangeability
-- exhaustion and auto-resolves when the engine later passes.
--
-- FAIL-CLOSED: nullable candidate/grounding columns — a NOT_RUN enrichment still
-- records the request (status=open) with an empty candidate so the surface never
-- goes silent (B2 visibility over silence).

CREATE TABLE IF NOT EXISTS dna_enrichment_requests (
  id                      varchar PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id              varchar NOT NULL,
  campaign_id             varchar NOT NULL,
  -- Which interchangeability judge kind triggered this: 'positioning_claim' | 'offer'.
  engine_kind             text NOT NULL,
  -- The judge's last interchangeability rejection reason (for audit / display context).
  last_rejection_reason   text NOT NULL,
  -- Top grounded differentiator candidate from Path A (nullable → enrichment NOT_RUN).
  candidate_differentiator text,
  -- AEL evidence IDs the candidate is grounded in, e.g. ["RC2","CC2"].
  grounding_refs          jsonb,
  -- Non-technical confirm/edit prompt shown on the dashboard (nullable → NOT_RUN).
  suggestion_text         text,
  -- 'open' → awaiting operator; 'resolved' → confirmed/edited or auto-resolved.
  status                  text NOT NULL DEFAULT 'open',
  created_at              timestamptz NOT NULL DEFAULT now(),
  updated_at              timestamptz NOT NULL DEFAULT now(),
  resolved_at             timestamptz
);

-- One live request per campaign+engine (upsert target); allows history via status.
CREATE UNIQUE INDEX IF NOT EXISTS dna_enrichment_requests_campaign_engine_uidx
  ON dna_enrichment_requests (campaign_id, engine_kind);

-- Dashboard reads open requests per campaign.
CREATE INDEX IF NOT EXISTS dna_enrichment_requests_campaign_status_idx
  ON dna_enrichment_requests (campaign_id, status);

COMMENT ON TABLE dna_enrichment_requests IS
  'DNA Enrichment Gate (Path B): campaign-scoped operator prompt raised when the interchangeability judge rejects positioning/offer as generic and auto-enrichment cannot ground a passing candidate. Resolve appends the confirmed differentiator to growth_campaigns.product_anchor. Operational/UX state — NOT strategy_memory.';
