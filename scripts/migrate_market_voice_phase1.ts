import "dotenv/config";
import { db } from "../server/db";
import { sql } from "drizzle-orm";

async function migrate() {
  console.log("Running Market Voice Phase 1 schema migration...");

  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS market_voice_discovery_jobs (
      id VARCHAR PRIMARY KEY DEFAULT gen_random_uuid(),
      account_id VARCHAR NOT NULL,
      campaign_id VARCHAR NOT NULL,
      campaign_offering_id VARCHAR NOT NULL,
      status VARCHAR(36) NOT NULL DEFAULT 'PENDING',
      search_planner_prompt TEXT,
      budget_limits JSONB DEFAULT '{}'::jsonb,
      discovered_competitor_count INTEGER DEFAULT 0,
      extracted_evidence_count INTEGER DEFAULT 0,
      error_message TEXT,
      metadata JSONB DEFAULT '{}'::jsonb,
      created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
      completed_at TIMESTAMP WITH TIME ZONE
    );

    CREATE INDEX IF NOT EXISTS market_voice_discovery_jobs_tenant_idx ON market_voice_discovery_jobs (account_id, campaign_id);
    CREATE INDEX IF NOT EXISTS market_voice_discovery_jobs_offering_idx ON market_voice_discovery_jobs (campaign_offering_id);
    CREATE INDEX IF NOT EXISTS market_voice_discovery_jobs_status_idx ON market_voice_discovery_jobs (status);

    CREATE TABLE IF NOT EXISTS market_voice_search_intents (
      id VARCHAR PRIMARY KEY DEFAULT gen_random_uuid(),
      discovery_job_id VARCHAR NOT NULL,
      account_id VARCHAR NOT NULL,
      campaign_id VARCHAR NOT NULL,
      campaign_offering_id VARCHAR NOT NULL,
      query TEXT NOT NULL,
      intent_category VARCHAR(36) NOT NULL,
      market_scope VARCHAR(24) NOT NULL DEFAULT 'GLOBAL_CATEGORY',
      target_platform VARCHAR(32) NOT NULL DEFAULT 'GOOGLE_SEARCH',
      target_geography VARCHAR(16),
      status VARCHAR(24) NOT NULL DEFAULT 'PENDING',
      results_count INTEGER DEFAULT 0,
      created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
    );

    CREATE INDEX IF NOT EXISTS market_voice_search_intents_job_idx ON market_voice_search_intents (discovery_job_id);
    CREATE INDEX IF NOT EXISTS market_voice_search_intents_tenant_idx ON market_voice_search_intents (account_id, campaign_id);
    CREATE INDEX IF NOT EXISTS market_voice_search_intents_category_idx ON market_voice_search_intents (intent_category);

    CREATE TABLE IF NOT EXISTS market_voice_discovery_results (
      id VARCHAR PRIMARY KEY DEFAULT gen_random_uuid(),
      search_intent_id VARCHAR NOT NULL,
      discovery_job_id VARCHAR NOT NULL,
      account_id VARCHAR NOT NULL,
      campaign_id VARCHAR NOT NULL,
      url TEXT NOT NULL,
      canonical_url TEXT NOT NULL,
      title TEXT,
      snippet TEXT,
      source_platform VARCHAR(32) NOT NULL,
      discovered_type VARCHAR(32) NOT NULL DEFAULT 'COMMUNITY_POST',
      verification_status VARCHAR(36) NOT NULL DEFAULT 'DISCOVERED',
      verified_competitor_id VARCHAR,
      extracted_count INTEGER DEFAULT 0,
      fetch_job_id VARCHAR(80),
      provider_run_id VARCHAR(80),
      metadata JSONB DEFAULT '{}'::jsonb,
      created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
    );

    CREATE INDEX IF NOT EXISTS market_voice_discovery_results_intent_idx ON market_voice_discovery_results (search_intent_id);
    CREATE INDEX IF NOT EXISTS market_voice_discovery_results_job_idx ON market_voice_discovery_results (discovery_job_id);
    CREATE INDEX IF NOT EXISTS market_voice_discovery_results_tenant_idx ON market_voice_discovery_results (account_id, campaign_id);
    CREATE INDEX IF NOT EXISTS market_voice_discovery_results_status_idx ON market_voice_discovery_results (verification_status);
    CREATE INDEX IF NOT EXISTS market_voice_discovery_results_url_idx ON market_voice_discovery_results (canonical_url);

    CREATE TABLE IF NOT EXISTS market_voice_evidence (
      id VARCHAR PRIMARY KEY DEFAULT gen_random_uuid(),
      discovery_result_id VARCHAR NOT NULL,
      search_intent_id VARCHAR NOT NULL,
      discovery_job_id VARCHAR NOT NULL,
      account_id VARCHAR NOT NULL,
      campaign_id VARCHAR NOT NULL,
      verbatim_text TEXT NOT NULL,
      source_scope VARCHAR(32) NOT NULL DEFAULT 'MARKET_CUSTOMER_VOICE',
      market_scope VARCHAR(24) NOT NULL DEFAULT 'GLOBAL_CATEGORY',
      platform VARCHAR(32) NOT NULL,
      external_url TEXT,
      external_id VARCHAR(128),
      author_hash VARCHAR(16),
      likes_count INTEGER DEFAULT 0,
      published_at TIMESTAMP WITH TIME ZONE,
      geography VARCHAR(16),
      language VARCHAR(16),
      fetch_job_id VARCHAR(80),
      provider_run_id VARCHAR(80),
      created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
    );

    CREATE INDEX IF NOT EXISTS market_voice_evidence_result_idx ON market_voice_evidence (discovery_result_id);
    CREATE INDEX IF NOT EXISTS market_voice_evidence_tenant_idx ON market_voice_evidence (account_id, campaign_id);
    CREATE INDEX IF NOT EXISTS market_voice_evidence_job_idx ON market_voice_evidence (discovery_job_id);
    CREATE INDEX IF NOT EXISTS market_voice_evidence_scope_idx ON market_voice_evidence (market_scope);
    CREATE INDEX IF NOT EXISTS market_voice_evidence_platform_idx ON market_voice_evidence (platform);
  `);

  console.log("Migration executed successfully!");
  process.exit(0);
}

migrate().catch((err) => {
  console.error("Migration failed:", err);
  process.exit(1);
});

