ALTER TABLE "business_data_layer" ALTER COLUMN "core_offer" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "audience_snapshots" ADD COLUMN IF NOT EXISTS "target_coverage" jsonb;--> statement-breakpoint
ALTER TABLE "business_data_layer" ADD COLUMN IF NOT EXISTS "business_model" text;--> statement-breakpoint
ALTER TABLE "business_data_layer" ADD COLUMN IF NOT EXISTS "hero_product" text;--> statement-breakpoint
ALTER TABLE "business_data_layer" ADD COLUMN IF NOT EXISTS "product_specs" text;--> statement-breakpoint
ALTER TABLE "business_data_layer" ADD COLUMN IF NOT EXISTS "end_consumer_use_case" text;--> statement-breakpoint
ALTER TABLE "business_data_layer" ADD COLUMN IF NOT EXISTS "replaced_competitor" text;