-- Migration 069: Add acquisition_tasks and evidence_manifests for coordinated parallel evidence pipeline

CREATE TABLE IF NOT EXISTS acquisition_tasks (
    id VARCHAR(128) PRIMARY KEY,
    campaign_id VARCHAR(128) NOT NULL,
    account_id VARCHAR(128) NOT NULL,
    source_platform VARCHAR(32) NOT NULL,
    entity_type VARCHAR(32) NOT NULL,
    entity_id VARCHAR(128) NOT NULL,
    task_key VARCHAR(256) NOT NULL UNIQUE,
    task_type VARCHAR(32) NOT NULL,
    status VARCHAR(32) NOT NULL DEFAULT 'PENDING',
    priority INTEGER NOT NULL DEFAULT 100,
    lease_owner VARCHAR(128),
    leased_until TIMESTAMPTZ,
    fencing_token INTEGER NOT NULL DEFAULT 0,
    retry_count INTEGER NOT NULL DEFAULT 0,
    max_retries INTEGER NOT NULL DEFAULT 2,
    input_payload JSONB NOT NULL DEFAULT '{}'::jsonb,
    output_summary JSONB,
    error_message TEXT,
    started_at TIMESTAMPTZ,
    completed_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_acq_tasks_claim 
ON acquisition_tasks (status, leased_until, priority DESC);

CREATE INDEX IF NOT EXISTS idx_acq_tasks_campaign 
ON acquisition_tasks (campaign_id, status);

CREATE TABLE IF NOT EXISTS evidence_manifests (
    id VARCHAR(128) PRIMARY KEY,
    campaign_id VARCHAR(128) NOT NULL,
    account_id VARCHAR(128) NOT NULL,
    orchestration_job_id VARCHAR(128) NOT NULL,
    context_fingerprint VARCHAR(64) NOT NULL,
    manifest_version INTEGER NOT NULL DEFAULT 1,
    status VARCHAR(32) NOT NULL DEFAULT 'FROZEN',
    included_post_ids JSONB NOT NULL DEFAULT '[]'::jsonb,
    included_comment_ids JSONB NOT NULL DEFAULT '[]'::jsonb,
    included_review_ids JSONB NOT NULL DEFAULT '[]'::jsonb,
    included_market_voice_ids JSONB NOT NULL DEFAULT '[]'::jsonb,
    included_web_snapshot_ids JSONB NOT NULL DEFAULT '[]'::jsonb,
    evidence_pool_counts JSONB NOT NULL DEFAULT '{}'::jsonb,
    source_diversity_report JSONB NOT NULL DEFAULT '{}'::jsonb,
    frozen_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_evidence_manifest_job 
ON evidence_manifests (orchestration_job_id);

CREATE INDEX IF NOT EXISTS idx_evidence_manifest_campaign 
ON evidence_manifests (campaign_id, created_at DESC);
