CREATE TABLE IF NOT EXISTS "business_understanding_snapshots" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"account_id" varchar NOT NULL,
	"campaign_id" varchar NOT NULL,
	"website_snapshot_id" varchar NOT NULL,
	"offering_input_evidence_id" varchar NOT NULL,
	"campaign_offering_id" varchar NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"business_understanding" jsonb NOT NULL,
	"status" text DEFAULT 'COMPLETE' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "campaign_offerings" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"account_id" varchar NOT NULL,
	"campaign_id" varchar NOT NULL,
	"offering_name" text NOT NULL,
	"source_input_evidence_id" varchar NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "offering_input_evidence" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"account_id" varchar NOT NULL,
	"campaign_id" varchar NOT NULL,
	"campaign_offering_id" varchar NOT NULL,
	"raw_offering_name" text NOT NULL,
	"raw_features_and_notes" text NOT NULL,
	"content_hash" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "website_snapshots" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"account_id" varchar NOT NULL,
	"campaign_id" varchar NOT NULL,
	"root_url" text NOT NULL,
	"pages_crawled" jsonb NOT NULL,
	"content_hash" text NOT NULL,
	"status" text DEFAULT 'SUCCESS' NOT NULL,
	"failure_code" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "business_understanding_snapshots_tenant_idx" ON "business_understanding_snapshots" USING btree ("account_id","campaign_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "campaign_offerings_tenant_idx" ON "campaign_offerings" USING btree ("account_id","campaign_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "offering_input_evidence_tenant_idx" ON "offering_input_evidence" USING btree ("account_id","campaign_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "website_snapshots_tenant_idx" ON "website_snapshots" USING btree ("account_id","campaign_id");