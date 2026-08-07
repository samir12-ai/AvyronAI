-- Migration 056: watchtower_strategic_briefs
CREATE TABLE watchtower_strategic_briefs (
  id VARCHAR(255) PRIMARY KEY,
  event_id VARCHAR(255) NOT NULL,
  account_id VARCHAR(255) NOT NULL,
  campaign_id VARCHAR(255) NOT NULL,
  competitor_id VARCHAR(255),
  status VARCHAR(50) NOT NULL, -- 'queued' | 'generating' | 'validating' | 'ready' | 'insufficient_evidence' | 'failed'
  
  brief JSONB,
  evidence_registry JSONB, -- nullable during queue/generation
  context_lineage JSONB, -- nullable during queue/generation
  source_versions JSONB, -- nullable during queue/generation
  deterministic_violations JSONB,
  judge_result JSONB,
  
  model_proposed_confidence DOUBLE PRECISION,
  final_validated_confidence DOUBLE PRECISION,
  confidence_adjustment_reasons JSONB,

  context_fingerprint VARCHAR(255), -- populated after context collection
  generator_version VARCHAR(50) NOT NULL DEFAULT 'v1',
  prompt_version VARCHAR(50) NOT NULL DEFAULT 'v1',
  judge_version VARCHAR(50) NOT NULL DEFAULT 'v1',
  evidence_version VARCHAR(50) NOT NULL DEFAULT 'v1',
  
  failure_code VARCHAR(100),
  failure_details JSONB,
  attempt_count INTEGER NOT NULL DEFAULT 0,
  is_latest BOOLEAN NOT NULL DEFAULT TRUE,
  
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  started_at TIMESTAMPTZ,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  completed_at TIMESTAMPTZ,
  
  supersedes_brief_id VARCHAR(255) REFERENCES watchtower_strategic_briefs(id) ON DELETE SET NULL,
  CONSTRAINT fk_wtsb_event FOREIGN KEY (event_id) REFERENCES pipeline_change_events(id) ON DELETE CASCADE
);

CREATE INDEX idx_wtsb_event_id ON watchtower_strategic_briefs(event_id);
CREATE INDEX idx_wtsb_tenant ON watchtower_strategic_briefs(account_id, campaign_id);
CREATE INDEX idx_wtsb_status ON watchtower_strategic_briefs(status);

-- Idempotency: prevent multiple ready/completed briefs with the same exact context + code versions
CREATE UNIQUE INDEX uq_wtsb_idempotency ON watchtower_strategic_briefs(
  event_id, context_fingerprint, prompt_version, generator_version, judge_version, evidence_version
);

-- Active lock: prevent duplicate concurrent runs for the same event
CREATE UNIQUE INDEX uq_wtsb_active_run ON watchtower_strategic_briefs(event_id)
WHERE status IN ('queued', 'generating', 'validating');

-- Latest resolution: exactly one brief can be marked 'latest' per event
CREATE UNIQUE INDEX uq_wtsb_one_latest_per_event ON watchtower_strategic_briefs(event_id)
WHERE is_latest = TRUE;
