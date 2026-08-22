import 'dotenv/config';
import { db } from './server/db';
import { sql } from 'drizzle-orm';

async function run() {
  await db.execute(sql`
    DROP TABLE IF EXISTS business_understanding_snapshots CASCADE;
    DROP TABLE IF EXISTS website_snapshots CASCADE;
    DROP TABLE IF EXISTS campaign_offerings CASCADE;
    DROP TABLE IF EXISTS offering_input_evidence CASCADE;
    DROP TABLE IF EXISTS strategic_pain_decisions CASCADE;
    DROP TABLE IF EXISTS target_assessments CASCADE;
    DROP TABLE IF EXISTS product_assessments CASCADE;

    CREATE TABLE IF NOT EXISTS target_assessments (
      id VARCHAR PRIMARY KEY DEFAULT gen_random_uuid(),
      job_id VARCHAR NOT NULL,
      campaign_id VARCHAR NOT NULL,
      account_id VARCHAR NOT NULL,
      pain_id VARCHAR NOT NULL,
      target_understanding_authority_id VARCHAR NOT NULL,
      decision VARCHAR NOT NULL,
      status VARCHAR NOT NULL,
      parent_authority_ids JSONB NOT NULL,
      payload JSONB NOT NULL,
      created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
    );

    CREATE TABLE IF NOT EXISTS product_assessments (
      id VARCHAR PRIMARY KEY DEFAULT gen_random_uuid(),
      job_id VARCHAR NOT NULL,
      campaign_id VARCHAR NOT NULL,
      account_id VARCHAR NOT NULL,
      pain_id VARCHAR NOT NULL,
      campaign_offering_id VARCHAR NOT NULL,
      business_understanding_authority_id VARCHAR NOT NULL,
      product_truth_fact_ids JSONB NOT NULL,
      fit_type VARCHAR NOT NULL,
      status VARCHAR NOT NULL,
      parent_authority_ids JSONB NOT NULL,
      payload JSONB NOT NULL,
      created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
    );

    CREATE TABLE IF NOT EXISTS strategic_pain_decisions (
      id VARCHAR PRIMARY KEY DEFAULT gen_random_uuid(),
      job_id VARCHAR NOT NULL,
      campaign_id VARCHAR NOT NULL,
      account_id VARCHAR NOT NULL,
      pain_id VARCHAR,
      target_assessment_authority_id VARCHAR,
      product_assessment_authority_id VARCHAR,
      final_classification VARCHAR,
      status VARCHAR NOT NULL DEFAULT 'COMPLETE',
      reason TEXT,
      payload JSONB NOT NULL,
      created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
    );

    CREATE TABLE IF NOT EXISTS offering_input_evidence (
      id VARCHAR PRIMARY KEY DEFAULT gen_random_uuid(),
      account_id VARCHAR NOT NULL,
      campaign_id VARCHAR NOT NULL,
      campaign_offering_id VARCHAR NOT NULL,
      raw_offering_name TEXT NOT NULL,
      raw_features_and_notes TEXT NOT NULL,
      content_hash TEXT NOT NULL,
      created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
    );
    CREATE TABLE IF NOT EXISTS campaign_offerings (
      id VARCHAR PRIMARY KEY DEFAULT gen_random_uuid(),
      account_id VARCHAR NOT NULL,
      campaign_id VARCHAR NOT NULL,
      offering_name TEXT NOT NULL,
      source_input_evidence_id VARCHAR NOT NULL,
      created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
    );
    CREATE TABLE IF NOT EXISTS website_snapshots (
      id VARCHAR PRIMARY KEY DEFAULT gen_random_uuid(),
      account_id VARCHAR NOT NULL,
      campaign_id VARCHAR NOT NULL,
      root_url TEXT,
      pages_crawled JSONB,
      content_hash TEXT,
      status TEXT,
      failure_code TEXT,
      created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
    );
    CREATE TABLE IF NOT EXISTS business_understanding_snapshots (
      id VARCHAR PRIMARY KEY DEFAULT gen_random_uuid(),
      account_id VARCHAR NOT NULL,
      campaign_id VARCHAR NOT NULL,
      website_snapshot_id VARCHAR,
      offering_input_evidence_id VARCHAR,
      campaign_offering_id VARCHAR,
      version INTEGER NOT NULL DEFAULT 1,
      business_understanding JSONB NOT NULL,
      status TEXT NOT NULL DEFAULT 'COMPLETE',
      created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
    );
  `);
  console.log('success');
  process.exit(0);
}
run().catch(console.error);
