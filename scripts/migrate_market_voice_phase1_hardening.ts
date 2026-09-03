import "dotenv/config";
import { db } from "../server/db";
import { sql } from "drizzle-orm";

async function migrate() {
  console.log("Auditing existing row counts prior to composite lineage migration...");

  const [rJobs, rIntents, rResults, rEvidence] = await Promise.all([
    db.execute(sql`SELECT count(*) FROM market_voice_discovery_jobs`),
    db.execute(sql`SELECT count(*) FROM market_voice_search_intents`),
    db.execute(sql`SELECT count(*) FROM market_voice_discovery_results`),
    db.execute(sql`SELECT count(*) FROM market_voice_evidence`),
  ]);

  const counts = {
    jobs: Number(rJobs.rows[0].count),
    intents: Number(rIntents.rows[0].count),
    results: Number(rResults.rows[0].count),
    evidence: Number(rEvidence.rows[0].count),
  };

  console.log("Existing Market Voice row counts:", counts);

  console.log("Applying Composite Lineage Constraints Migration...");

  // 1. Drop existing single-column FKs
  await db.execute(sql`
    DO $$ 
    BEGIN 
      -- Search intents single FK
      IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_mv_search_intents_job') THEN
        ALTER TABLE market_voice_search_intents DROP CONSTRAINT fk_mv_search_intents_job;
      END IF;

      -- Discovery results single FKs
      IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_mv_discovery_results_intent') THEN
        ALTER TABLE market_voice_discovery_results DROP CONSTRAINT fk_mv_discovery_results_intent;
      END IF;
      IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_mv_discovery_results_job') THEN
        ALTER TABLE market_voice_discovery_results DROP CONSTRAINT fk_mv_discovery_results_job;
      END IF;

      -- Evidence single FKs
      IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_mv_evidence_result') THEN
        ALTER TABLE market_voice_evidence DROP CONSTRAINT fk_mv_evidence_result;
      END IF;
      IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_mv_evidence_intent') THEN
        ALTER TABLE market_voice_evidence DROP CONSTRAINT fk_mv_evidence_intent;
      END IF;
      IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_mv_evidence_job') THEN
        ALTER TABLE market_voice_evidence DROP CONSTRAINT fk_mv_evidence_job;
      END IF;
    END $$;
  `);

  // 2. Add composite unique constraint on Jobs
  await db.execute(sql`
    DO $$ 
    BEGIN 
      IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'uq_mv_jobs_lineage') THEN
        ALTER TABLE market_voice_discovery_jobs 
        ADD CONSTRAINT uq_mv_jobs_lineage 
        UNIQUE (id, account_id, campaign_id, campaign_offering_id);
      END IF;
    END $$;
  `);

  // 3. Add composite FK and composite unique constraint on Search Intents
  await db.execute(sql`
    DO $$ 
    BEGIN 
      IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_mv_search_intents_job_lineage') THEN
        ALTER TABLE market_voice_search_intents 
        ADD CONSTRAINT fk_mv_search_intents_job_lineage 
        FOREIGN KEY (discovery_job_id, account_id, campaign_id, campaign_offering_id) 
        REFERENCES market_voice_discovery_jobs(id, account_id, campaign_id, campaign_offering_id) 
        ON DELETE CASCADE;
      END IF;

      IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'uq_mv_search_intents_lineage') THEN
        ALTER TABLE market_voice_search_intents 
        ADD CONSTRAINT uq_mv_search_intents_lineage 
        UNIQUE (id, discovery_job_id, account_id, campaign_id, campaign_offering_id);
      END IF;
    END $$;
  `);

  // 4. Add composite FK and composite unique constraint on Discovery Results
  await db.execute(sql`
    DO $$ 
    BEGIN 
      IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_mv_discovery_results_intent_lineage') THEN
        ALTER TABLE market_voice_discovery_results 
        ADD CONSTRAINT fk_mv_discovery_results_intent_lineage 
        FOREIGN KEY (search_intent_id, discovery_job_id, account_id, campaign_id, campaign_offering_id) 
        REFERENCES market_voice_search_intents(id, discovery_job_id, account_id, campaign_id, campaign_offering_id) 
        ON DELETE CASCADE;
      END IF;

      IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'uq_mv_discovery_results_lineage') THEN
        ALTER TABLE market_voice_discovery_results 
        ADD CONSTRAINT uq_mv_discovery_results_lineage 
        UNIQUE (id, search_intent_id, discovery_job_id, account_id, campaign_id, campaign_offering_id);
      END IF;
    END $$;
  `);

  // 5. Add composite FK on Evidence
  await db.execute(sql`
    DO $$ 
    BEGIN 
      IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_mv_evidence_result_lineage') THEN
        ALTER TABLE market_voice_evidence 
        ADD CONSTRAINT fk_mv_evidence_result_lineage 
        FOREIGN KEY (discovery_result_id, search_intent_id, discovery_job_id, account_id, campaign_id, campaign_offering_id) 
        REFERENCES market_voice_discovery_results(id, search_intent_id, discovery_job_id, account_id, campaign_id, campaign_offering_id) 
        ON DELETE CASCADE;
      END IF;
    END $$;
  `);

  console.log("Composite lineage migration successfully applied to Neon PostgreSQL!");
  process.exit(0);
}

migrate().catch((err) => {
  console.error("Migration failed:", err);
  process.exit(1);
});

