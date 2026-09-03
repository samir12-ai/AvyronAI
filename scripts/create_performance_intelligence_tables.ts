import "dotenv/config";
import { db } from "../server/db";
import { sql } from "drizzle-orm";

async function main() {
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS owned_source_snapshots (
      id VARCHAR PRIMARY KEY DEFAULT gen_random_uuid(),
      account_id VARCHAR NOT NULL,
      campaign_id VARCHAR,
      source_type VARCHAR NOT NULL,
      source_identity_id VARCHAR,
      provider_snapshot_id VARCHAR,
      history_availability VARCHAR NOT NULL DEFAULT 'UNKNOWN',
      provider_status VARCHAR NOT NULL DEFAULT 'NOT_CONNECTED',
      factual_metrics JSONB,
      evidence_ref_ids JSONB DEFAULT '[]'::jsonb,
      freshness VARCHAR DEFAULT 'FRESH',
      captured_at TIMESTAMPTZ DEFAULT NOW(),
      observed_period_start TIMESTAMPTZ,
      observed_period_end TIMESTAMPTZ,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS business_execution_states (
      id VARCHAR PRIMARY KEY DEFAULT gen_random_uuid(),
      account_id VARCHAR NOT NULL,
      campaign_id VARCHAR NOT NULL,
      source_performance_cycle_id VARCHAR,
      source_website_snapshot_id VARCHAR,
      source_owned_source_snapshot_ids JSONB DEFAULT '[]'::jsonb,
      mode VARCHAR NOT NULL DEFAULT 'UNKNOWN',
      primary_bottleneck VARCHAR DEFAULT 'UNKNOWN',
      observed_business_history JSONB,
      observed_audience_traction JSONB,
      observed_demand_state JSONB,
      observed_lead_state JSONB,
      observed_customer_state JSONB,
      observed_conversion_state JSONB,
      observed_proof_state JSONB,
      observed_channel_state JSONB,
      evidence_summary TEXT,
      evidence_ref_ids JSONB DEFAULT '[]'::jsonb,
      confidence VARCHAR NOT NULL DEFAULT 'LOW',
      freshness VARCHAR NOT NULL DEFAULT 'FRESH',
      status VARCHAR NOT NULL DEFAULT 'ACTIVE',
      reason TEXT,
      reasoning_authority_id VARCHAR,
      judge_authority_id VARCHAR,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS clarification_requests (
      id VARCHAR PRIMARY KEY DEFAULT gen_random_uuid(),
      account_id VARCHAR NOT NULL,
      campaign_id VARCHAR NOT NULL,
      execution_state_draft_id VARCHAR,
      missing_fact_type VARCHAR NOT NULL,
      question TEXT NOT NULL,
      answer_type VARCHAR NOT NULL DEFAULT 'TEXT',
      reason TEXT,
      evidence_ref_ids JSONB DEFAULT '[]'::jsonb,
      status VARCHAR NOT NULL DEFAULT 'PENDING',
      user_answer TEXT,
      answered_at TIMESTAMPTZ,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS performance_contexts (
      id VARCHAR PRIMARY KEY DEFAULT gen_random_uuid(),
      business_execution_state_id VARCHAR NOT NULL,
      account_id VARCHAR NOT NULL,
      campaign_id VARCHAR NOT NULL,
      mode VARCHAR NOT NULL DEFAULT 'UNKNOWN',
      primary_bottleneck VARCHAR DEFAULT 'UNKNOWN',
      current_reality TEXT,
      strongest_signals JSONB DEFAULT '[]'::jsonb,
      weakest_signals JSONB DEFAULT '[]'::jsonb,
      recent_trend VARCHAR DEFAULT 'INSUFFICIENT_DATA',
      active_channels JSONB DEFAULT '[]'::jsonb,
      proven_assets JSONB DEFAULT '[]'::jsonb,
      proof_gaps JSONB DEFAULT '[]'::jsonb,
      relevant_buyer_responses JSONB DEFAULT '[]'::jsonb,
      relevant_objections JSONB DEFAULT '[]'::jsonb,
      confidence VARCHAR NOT NULL DEFAULT 'LOW',
      freshness VARCHAR NOT NULL DEFAULT 'FRESH',
      evidence_ref_ids JSONB DEFAULT '[]'::jsonb,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);
  console.log("Performance Intelligence Tables created successfully.");
  process.exit(0);
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
