ALTER TABLE "lead_forms" ADD COLUMN "campaign_id" varchar;--> statement-breakpoint
ALTER TABLE "landing_pages" ADD COLUMN "campaign_id" varchar;--> statement-breakpoint
ALTER TABLE "funnel_definitions" ADD COLUMN "campaign_id" varchar;--> statement-breakpoint
ALTER TABLE "lead_magnets" ADD COLUMN "campaign_id" varchar;--> statement-breakpoint
ALTER TABLE "lead_forms" ADD CONSTRAINT "lead_forms_campaign_id_growth_campaigns_id_fk" FOREIGN KEY ("campaign_id") REFERENCES "public"."growth_campaigns"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "landing_pages" ADD CONSTRAINT "landing_pages_campaign_id_growth_campaigns_id_fk" FOREIGN KEY ("campaign_id") REFERENCES "public"."growth_campaigns"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "funnel_definitions" ADD CONSTRAINT "funnel_definitions_campaign_id_growth_campaigns_id_fk" FOREIGN KEY ("campaign_id") REFERENCES "public"."growth_campaigns"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lead_magnets" ADD CONSTRAINT "lead_magnets_campaign_id_growth_campaigns_id_fk" FOREIGN KEY ("campaign_id") REFERENCES "public"."growth_campaigns"("id") ON DELETE cascade ON UPDATE no action;