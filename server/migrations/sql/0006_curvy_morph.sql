ALTER TABLE "business_data_layer" ALTER COLUMN "core_offer" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "audience_snapshots" ADD COLUMN "target_coverage" jsonb;--> statement-breakpoint
ALTER TABLE "business_data_layer" ADD COLUMN "business_model" text;--> statement-breakpoint
ALTER TABLE "business_data_layer" ADD COLUMN "hero_product" text;--> statement-breakpoint
ALTER TABLE "business_data_layer" ADD COLUMN "product_specs" text;--> statement-breakpoint
ALTER TABLE "business_data_layer" ADD COLUMN "end_consumer_use_case" text;--> statement-breakpoint
ALTER TABLE "business_data_layer" ADD COLUMN "replaced_competitor" text;