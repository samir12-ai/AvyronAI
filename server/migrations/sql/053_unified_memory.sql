-- Migration 053: Unified Intelligence Memory (P-5, M1+M2)
--
-- M1: evidence_registry (thin citation/lineage index over existing stores —
--     payloads stay in source tables) + reasoning_runs (every judge-gated
--     interpretation run is persisted: accepted cards OR rejection + reasons,
--     making reasoning accuracy measurable).
-- M2: append-only history for the three overwrite-in-place L4 belief stores:
--     business_data_revisions (write-through), dna_enrichment_attempts
--     (write-through), ci_competitor_revisions (DB TRIGGER — ci_competitors
--     has multi-writer fan-out, so capture is enforced below the app layer).
--
-- JSON payload columns use text (house convention).

-- ---------------------------------------------------------------------------
-- M1.1 evidence_registry — stable citable UIDs. A pointer index, NOT a data
-- store: source_table/source_id locate the payload; label/detail snapshot the
-- human-readable citation so it survives source cleanup. Lazy registration:
-- rows appear when evidence is first cited.
CREATE TABLE IF NOT EXISTS evidence_registry (
  id varchar PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id varchar NOT NULL,
  campaign_id varchar NOT NULL,
  -- deterministic: EV:<kind>:<source_table>:<source_id>
  evidence_uid text NOT NULL,
  -- market_insight | performance_report | performance_verdict |
  -- performance_memory | business_context | objective | competitor |
  -- historical_finding | causal_claim
  kind text NOT NULL,
  source_table text NOT NULL,   -- real table, or 'derived:<analyzer>' for computed findings
  source_id text NOT NULL,
  label text NOT NULL,          -- customer-safe short description
  detail text NOT NULL,         -- grounding detail (numbers cited must appear here)
  observed_at timestamp NOT NULL, -- coverage time (windowTo-style), not write time
  supersedes_uid text,
  created_at timestamp NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS evidence_registry_uid_uniq
  ON evidence_registry (account_id, campaign_id, evidence_uid);
CREATE INDEX IF NOT EXISTS evidence_registry_kind_idx
  ON evidence_registry (account_id, campaign_id, kind);

-- ---------------------------------------------------------------------------
-- M1.2 reasoning_runs — persisted outcome of every fresh judge-gated
-- interpretation run (strategic reasoning cards + watchtower market analyst).
-- Rejected AI output is stored for future accuracy/learning analysis and is
-- NEVER served to customers.
CREATE TABLE IF NOT EXISTS reasoning_runs (
  id varchar PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id varchar NOT NULL,
  campaign_id varchar NOT NULL,
  layer text NOT NULL,                -- 'strategic_reasoning' | 'market_analyst'
  -- accepted_ai | guards_rejected | judge_rejected | llm_failed | no_trigger
  status text NOT NULL,
  context_fingerprint text NOT NULL,
  model text,
  output text NOT NULL,               -- JSON: what was actually served
  rejected_output text,               -- JSON: the AI output that guards/judge rejected
  rejection_reasons text,             -- JSON array of violations
  evidence_uids text NOT NULL DEFAULT '[]', -- JSON array of cited registry UIDs
  ref_map text,                       -- JSON: prompt-time alias (MM-1) -> evidence_uid
  created_at timestamp NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS reasoning_runs_campaign_idx
  ON reasoning_runs (account_id, campaign_id, layer, created_at);

-- ---------------------------------------------------------------------------
-- M2.1 business_data_revisions — append-only snapshot of the PREVIOUS
-- business_data_layer row taken before every overwrite (single write path:
-- write-through in the PUT route).
CREATE TABLE IF NOT EXISTS business_data_revisions (
  id varchar PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id varchar NOT NULL,
  campaign_id varchar NOT NULL,
  snapshot text NOT NULL,        -- JSON: full previous row
  changed_fields text NOT NULL,  -- JSON array of field names that changed
  created_at timestamp NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS business_data_revisions_campaign_idx
  ON business_data_revisions (account_id, campaign_id, created_at);

-- ---------------------------------------------------------------------------
-- M2.2 dna_enrichment_attempts — append-only log of every enrichment raise /
-- resolution so rejected candidates are never silently forgotten by the
-- (campaign, engine) upsert on dna_enrichment_requests.
CREATE TABLE IF NOT EXISTS dna_enrichment_attempts (
  id varchar PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id varchar NOT NULL,
  campaign_id varchar NOT NULL,
  engine_kind text NOT NULL,
  event text NOT NULL,           -- 'raised' | 'auto_resolved' | 'operator_resolved'
  candidate_differentiator text,
  grounding_refs text,           -- JSON array
  rejection_reason text,
  created_at timestamp NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS dna_enrichment_attempts_campaign_idx
  ON dna_enrichment_attempts (account_id, campaign_id, engine_kind, created_at);

-- ---------------------------------------------------------------------------
-- M2.3 ci_competitor_revisions + trigger. ci_competitors has MULTIPLE direct
-- writers (MI fetch orchestrator, CI data acquisition, shared profile store,
-- competitor routes) — a convention-based app hook would silently miss
-- writers, so capture is enforced with an AFTER UPDATE trigger restricted to
-- profile-relevant columns (high-churn operational columns like
-- website_scraped_at are deliberately excluded).
CREATE TABLE IF NOT EXISTS ci_competitor_revisions (
  id varchar PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id varchar,
  campaign_id varchar,
  competitor_id varchar NOT NULL,
  changed_fields text NOT NULL,  -- JSON array of field names
  previous_values text NOT NULL, -- JSON object: field -> old value
  current_values text NOT NULL,  -- JSON object: field -> new value
  created_at timestamp NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS ci_competitor_revisions_campaign_idx
  ON ci_competitor_revisions (account_id, campaign_id, competitor_id, created_at);

CREATE OR REPLACE FUNCTION capture_ci_competitor_revision() RETURNS trigger AS $$
DECLARE
  profile_fields text[] := ARRAY[
    'name','platform','business_type','primary_objective','posting_frequency',
    'content_type_ratio','engagement_ratio','cta_patterns','discount_frequency',
    'hook_styles','messaging_tone','social_proof_presence','notes',
    'website_url','blog_url','is_active'
  ];
  f text;
  oldj jsonb := to_jsonb(OLD);
  newj jsonb := to_jsonb(NEW);
  changed text[] := '{}';
  prev jsonb := '{}'::jsonb;
  curr jsonb := '{}'::jsonb;
BEGIN
  FOREACH f IN ARRAY profile_fields LOOP
    IF oldj->f IS DISTINCT FROM newj->f THEN
      changed := array_append(changed, f);
      prev := prev || jsonb_build_object(f, oldj->f);
      curr := curr || jsonb_build_object(f, newj->f);
    END IF;
  END LOOP;
  IF array_length(changed, 1) IS NULL THEN
    RETURN NEW; -- no profile-relevant change
  END IF;
  INSERT INTO ci_competitor_revisions
    (account_id, campaign_id, competitor_id, changed_fields, previous_values, current_values)
  VALUES
    (NEW.account_id, NEW.campaign_id, NEW.id,
     to_jsonb(changed)::text, prev::text, curr::text);
  RETURN NEW;
END $$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_ci_competitor_revision ON ci_competitors;
CREATE TRIGGER trg_ci_competitor_revision
  AFTER UPDATE ON ci_competitors
  FOR EACH ROW
  EXECUTE FUNCTION capture_ci_competitor_revision();
