import { sql } from "drizzle-orm";
import { pgTable, text, varchar, integer, timestamp, boolean, doublePrecision } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";

export const users = pgTable("users", {
  id: varchar("id")
    .primaryKey()
    .default(sql`gen_random_uuid()`),
  username: text("username").notNull().unique(),
  password: text("password").notNull(),
});

export const photographerProfiles = pgTable("photographer_profiles", {
  id: varchar("id")
    .primaryKey()
    .default(sql`gen_random_uuid()`),
  name: text("name").notNull(),
  email: text("email").notNull().unique(),
  phone: text("phone"),
  bio: text("bio"),
  specialties: text("specialties"),
  profileImage: text("profile_image"),
  coverImage: text("cover_image"),
  location: text("location").default("Dubai"),
  city: text("city").default("Dubai"),
  country: text("country").default("UAE"),
  latitude: doublePrecision("latitude"),
  longitude: doublePrecision("longitude"),
  priceRange: text("price_range"),
  rating: doublePrecision("rating").default(0),
  totalReviews: integer("total_reviews").default(0),
  isVerified: boolean("is_verified").default(false),
  instagram: text("instagram"),
  website: text("website"),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

export const portfolioPosts = pgTable("portfolio_posts", {
  id: varchar("id")
    .primaryKey()
    .default(sql`gen_random_uuid()`),
  photographerId: varchar("photographer_id").notNull(),
  imageUrl: text("image_url").notNull(),
  title: text("title"),
  description: text("description"),
  category: text("category"),
  tags: text("tags"),
  likesCount: integer("likes_count").default(0),
  sharesCount: integer("shares_count").default(0),
  reservesCount: integer("reserves_count").default(0),
  createdAt: timestamp("created_at").defaultNow(),
});

export const postInteractions = pgTable("post_interactions", {
  id: varchar("id")
    .primaryKey()
    .default(sql`gen_random_uuid()`),
  postId: varchar("post_id").notNull(),
  userId: varchar("user_id").notNull(),
  type: text("type").notNull(),
  createdAt: timestamp("created_at").defaultNow(),
});

export const reservations = pgTable("reservations", {
  id: varchar("id")
    .primaryKey()
    .default(sql`gen_random_uuid()`),
  photographerId: varchar("photographer_id").notNull(),
  customerName: text("customer_name").notNull(),
  customerEmail: text("customer_email").notNull(),
  customerPhone: text("customer_phone"),
  eventType: text("event_type"),
  eventDate: text("event_date").notNull(),
  eventTime: text("event_time"),
  location: text("location"),
  notes: text("notes"),
  status: text("status").default("pending"),
  createdAt: timestamp("created_at").defaultNow(),
});

export const videoProjects = pgTable("video_projects", {
  id: varchar("id")
    .primaryKey()
    .default(sql`gen_random_uuid()`),
  title: text("title"),
  status: text("status").default("uploading"),
  clipCount: integer("clip_count").default(0),
  style: text("style"),
  mood: text("mood"),
  outputUrl: text("output_url"),
  thumbnailUrl: text("thumbnail_url"),
  duration: integer("duration"),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

export const performanceSnapshots = pgTable("performance_snapshots", {
  id: varchar("id")
    .primaryKey()
    .default(sql`gen_random_uuid()`),
  postId: text("post_id"),
  platform: text("platform").default("facebook"),
  contentType: text("content_type"),
  contentAngle: text("content_angle"),
  hookStyle: text("hook_style"),
  format: text("format"),
  reach: integer("reach").default(0),
  impressions: integer("impressions").default(0),
  saves: integer("saves").default(0),
  shares: integer("shares").default(0),
  likes: integer("likes").default(0),
  comments: integer("comments").default(0),
  clicks: integer("clicks").default(0),
  watchTime: doublePrecision("watch_time").default(0),
  retentionRate: doublePrecision("retention_rate").default(0),
  ctr: doublePrecision("ctr").default(0),
  cpm: doublePrecision("cpm").default(0),
  cpc: doublePrecision("cpc").default(0),
  cpa: doublePrecision("cpa").default(0),
  roas: doublePrecision("roas").default(0),
  spend: doublePrecision("spend").default(0),
  conversions: integer("conversions").default(0),
  audienceAge: text("audience_age"),
  audienceGender: text("audience_gender"),
  audienceLocation: text("audience_location"),
  topComments: text("top_comments"),
  campaignId: varchar("campaign_id"),
  accountId: varchar("account_id").default("default"),
  publishedAt: timestamp("published_at"),
  fetchedAt: timestamp("fetched_at").defaultNow(),
});

export const strategyInsights = pgTable("strategy_insights", {
  id: varchar("id")
    .primaryKey()
    .default(sql`gen_random_uuid()`),
  category: text("category").notNull(),
  insight: text("insight").notNull(),
  confidence: doublePrecision("confidence").default(0),
  dataPoints: integer("data_points").default(0),
  relatedMetric: text("related_metric"),
  metricValue: doublePrecision("metric_value"),
  accountAverage: doublePrecision("account_average"),
  isActive: boolean("is_active").default(true),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

export const strategyDecisions = pgTable("strategy_decisions", {
  id: varchar("id")
    .primaryKey()
    .default(sql`gen_random_uuid()`),
  accountId: varchar("account_id").default("default"),
  trigger: text("trigger").notNull(),
  action: text("action").notNull(),
  reason: text("reason").notNull(),
  objective: text("objective"),
  budgetAdjustment: text("budget_adjustment"),
  priority: text("priority").default("medium"),
  status: text("status").default("pending"),
  outcome: text("outcome"),
  riskLevel: text("risk_level").default("low"),
  autoGenerated: boolean("auto_generated").default(false),
  autoExecutable: boolean("auto_executable").default(false),
  outcomeStatus: text("outcome_status"),
  createdAt: timestamp("created_at").defaultNow(),
  executedAt: timestamp("executed_at"),
});

export const strategyMemory = pgTable("strategy_memory", {
  id: varchar("id")
    .primaryKey()
    .default(sql`gen_random_uuid()`),
  memoryType: text("memory_type").notNull(),
  label: text("label").notNull(),
  details: text("details"),
  performance: text("performance"),
  score: doublePrecision("score").default(0),
  usageCount: integer("usage_count").default(0),
  lastUsed: timestamp("last_used"),
  isWinner: boolean("is_winner").default(false),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

export const growthCampaigns = pgTable("growth_campaigns", {
  id: varchar("id")
    .primaryKey()
    .default(sql`gen_random_uuid()`),
  name: text("name").notNull(),
  stage: text("stage").default("testing"),
  dayNumber: integer("day_number").default(1),
  totalDays: integer("total_days").default(30),
  testingAngles: text("testing_angles"),
  winningAngles: text("winning_angles"),
  killedAngles: text("killed_angles"),
  budget: doublePrecision("budget").default(0),
  spent: doublePrecision("spent").default(0),
  results: text("results"),
  isActive: boolean("is_active").default(true),
  startedAt: timestamp("started_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

export const weeklyReports = pgTable("weekly_reports", {
  id: varchar("id")
    .primaryKey()
    .default(sql`gen_random_uuid()`),
  weekStart: timestamp("week_start").notNull(),
  weekEnd: timestamp("week_end").notNull(),
  summary: text("summary"),
  whatWorked: text("what_worked"),
  whatFailed: text("what_failed"),
  whyItHappened: text("why_it_happened"),
  whatToScale: text("what_to_scale"),
  whatToStop: text("what_to_stop"),
  nextWeekFocus: text("next_week_focus"),
  budgetReallocation: text("budget_reallocation"),
  baselineMetrics: text("baseline_metrics"),
  createdAt: timestamp("created_at").defaultNow(),
});

export const moatCandidates = pgTable("moat_candidates", {
  id: varchar("id")
    .primaryKey()
    .default(sql`gen_random_uuid()`),
  sourceType: text("source_type").notNull(),
  label: text("label").notNull(),
  description: text("description"),
  stability: doublePrecision("stability").default(0),
  resonance: doublePrecision("resonance").default(0),
  uniqueness: doublePrecision("uniqueness").default(0),
  moatScore: doublePrecision("moat_score").default(0),
  dataEvidence: text("data_evidence"),
  status: text("status").default("candidate"),
  convertedToSeriesId: varchar("converted_to_series_id"),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

export const signatureSeries = pgTable("signature_series", {
  id: varchar("id")
    .primaryKey()
    .default(sql`gen_random_uuid()`),
  name: text("name").notNull(),
  corePromise: text("core_promise"),
  episodeStructure: text("episode_structure"),
  hookFormula: text("hook_formula"),
  ctaFramework: text("cta_framework"),
  postingCadence: text("posting_cadence"),
  expansionRoadmap: text("expansion_roadmap"),
  authorityScore: doublePrecision("authority_score").default(0),
  differentiationScore: doublePrecision("differentiation_score").default(0),
  moatStrength: doublePrecision("moat_strength").default(0),
  fatigueRisk: doublePrecision("fatigue_risk").default(0),
  episodeCount: integer("episode_count").default(0),
  totalReach: integer("total_reach").default(0),
  avgEngagement: doublePrecision("avg_engagement").default(0),
  isActive: boolean("is_active").default(true),
  moatCandidateId: varchar("moat_candidate_id"),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

export const guardrailConfig = pgTable("guardrail_config", {
  id: varchar("id")
    .primaryKey()
    .default(sql`gen_random_uuid()`),
  accountId: varchar("account_id").notNull().default("default"),
  dailyBudgetLimit: doublePrecision("daily_budget_limit").default(100),
  monthlyBudgetLimit: doublePrecision("monthly_budget_limit").default(2000),
  cpaGuardMultiplier: doublePrecision("cpa_guard_multiplier").default(1.25),
  roasFloor: doublePrecision("roas_floor").default(1.5),
  volatilityThreshold: doublePrecision("volatility_threshold").default(0.35),
  maxScalingPercent: doublePrecision("max_scaling_percent").default(15),
  maxBudgetIncreasePerCycle: doublePrecision("max_budget_increase_per_cycle").default(15),
  isActive: boolean("is_active").default(true),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

export const baselineHistory = pgTable("baseline_history", {
  id: varchar("id")
    .primaryKey()
    .default(sql`gen_random_uuid()`),
  accountId: varchar("account_id").notNull().default("default"),
  cycleTimestamp: timestamp("cycle_timestamp").defaultNow(),
  rollingCpa: doublePrecision("rolling_cpa").default(0),
  rollingRoas: doublePrecision("rolling_roas").default(0),
  rollingCtr: doublePrecision("rolling_ctr").default(0),
  rollingSpend: doublePrecision("rolling_spend").default(0),
  driftPercentCpa: doublePrecision("drift_percent_cpa").default(0),
  driftPercentRoas: doublePrecision("drift_percent_roas").default(0),
  driftPercentCtr: doublePrecision("drift_percent_ctr").default(0),
  driftSustainedCycles: integer("drift_sustained_cycles").default(0),
  createdAt: timestamp("created_at").defaultNow(),
});

export const decisionOutcomes = pgTable("decision_outcomes", {
  id: varchar("id")
    .primaryKey()
    .default(sql`gen_random_uuid()`),
  decisionId: varchar("decision_id").notNull(),
  accountId: varchar("account_id").notNull().default("default"),
  decisionType: text("decision_type"),
  preMetricsCpa: doublePrecision("pre_metrics_cpa").default(0),
  preMetricsRoas: doublePrecision("pre_metrics_roas").default(0),
  preMetricsCtr: doublePrecision("pre_metrics_ctr").default(0),
  preMetricsSpend: doublePrecision("pre_metrics_spend").default(0),
  postMetricsCpa: doublePrecision("post_metrics_cpa"),
  postMetricsRoas: doublePrecision("post_metrics_roas"),
  postMetricsCtr: doublePrecision("post_metrics_ctr"),
  postMetricsSpend: doublePrecision("post_metrics_spend"),
  outcome: text("outcome"),
  evaluatedAt: timestamp("evaluated_at"),
  executedAt: timestamp("executed_at").defaultNow(),
  createdAt: timestamp("created_at").defaultNow(),
});

export const auditLog = pgTable("audit_log", {
  id: varchar("id")
    .primaryKey()
    .default(sql`gen_random_uuid()`),
  accountId: varchar("account_id").notNull().default("default"),
  eventType: text("event_type").notNull(),
  decisionId: varchar("decision_id"),
  details: text("details"),
  guardrailResult: text("guardrail_result"),
  riskLevel: text("risk_level"),
  executionStatus: text("execution_status"),
  preMetrics: text("pre_metrics"),
  postMetrics: text("post_metrics"),
  createdAt: timestamp("created_at").defaultNow(),
});

export const accountState = pgTable("account_state", {
  id: varchar("id")
    .primaryKey()
    .default(sql`gen_random_uuid()`),
  accountId: varchar("account_id").notNull().default("default").unique(),
  autopilotOn: boolean("autopilot_on").default(false),
  state: text("state").default("ACTIVE"),
  volatilityIndex: doublePrecision("volatility_index").default(0),
  volatilityCpa: doublePrecision("volatility_cpa").default(0),
  volatilityRoas: doublePrecision("volatility_roas").default(0),
  volatilityCtr: doublePrecision("volatility_ctr").default(0),
  driftFlag: boolean("drift_flag").default(false),
  consecutiveFailures: integer("consecutive_failures").default(0),
  guardrailTriggers24h: integer("guardrail_triggers_24h").default(0),
  lastGuardrailReset: timestamp("last_guardrail_reset").defaultNow(),
  lastWorkerRun: timestamp("last_worker_run"),
  confidenceScore: integer("confidence_score").default(100),
  confidenceStatus: text("confidence_status").default("Stable"),
  recoveryCyclesStable: integer("recovery_cycles_stable").default(0),
  metaMode: text("meta_mode").default("DISCONNECTED"),
  metaGrantedScopes: text("meta_granted_scopes"),
  metaMissingScopes: text("meta_missing_scopes"),
  metaLastVerifiedAt: timestamp("meta_last_verified_at"),
  metaDemoModeEnabled: boolean("meta_demo_mode_enabled").default(false),
  updatedAt: timestamp("updated_at").defaultNow(),
});

export const jobQueue = pgTable("job_queue", {
  id: varchar("id")
    .primaryKey()
    .default(sql`gen_random_uuid()`),
  accountId: varchar("account_id").notNull().default("default"),
  status: text("status").default("pending"),
  cycleId: varchar("cycle_id"),
  lockedAt: timestamp("locked_at"),
  startedAt: timestamp("started_at"),
  completedAt: timestamp("completed_at"),
  error: text("error"),
  createdAt: timestamp("created_at").defaultNow(),
});

export type MoatCandidate = typeof moatCandidates.$inferSelect;
export type SignatureSeries = typeof signatureSeries.$inferSelect;
export type GuardrailConfig = typeof guardrailConfig.$inferSelect;
export type BaselineHistory = typeof baselineHistory.$inferSelect;
export type DecisionOutcome = typeof decisionOutcomes.$inferSelect;
export type AuditLogEntry = typeof auditLog.$inferSelect;
export type AccountState = typeof accountState.$inferSelect;
export type JobQueueEntry = typeof jobQueue.$inferSelect;

export const insertUserSchema = createInsertSchema(users).pick({
  username: true,
  password: true,
});

export const insertPhotographerSchema = createInsertSchema(photographerProfiles).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
  rating: true,
  totalReviews: true,
  isVerified: true,
});

export const insertPortfolioPostSchema = createInsertSchema(portfolioPosts).omit({
  id: true,
  createdAt: true,
  likesCount: true,
  sharesCount: true,
  reservesCount: true,
});

export const insertReservationSchema = createInsertSchema(reservations).omit({
  id: true,
  createdAt: true,
  status: true,
});

export type InsertUser = z.infer<typeof insertUserSchema>;
export type User = typeof users.$inferSelect;
export type PhotographerProfile = typeof photographerProfiles.$inferSelect;
export type InsertPhotographer = z.infer<typeof insertPhotographerSchema>;
export type PortfolioPost = typeof portfolioPosts.$inferSelect;
export type InsertPortfolioPost = z.infer<typeof insertPortfolioPostSchema>;
export type Reservation = typeof reservations.$inferSelect;
export type InsertReservation = z.infer<typeof insertReservationSchema>;
export const brandConfig = pgTable("brand_config", {
  id: varchar("id")
    .primaryKey()
    .default(sql`gen_random_uuid()`),
  accountId: varchar("account_id").notNull().default("default"),
  brandName: text("brand_name").default(""),
  tone: text("tone").default("professional"),
  forbiddenClaims: text("forbidden_claims").default(""),
  ctaStyle: text("cta_style").default("direct"),
  hashtagPolicy: text("hashtag_policy").default("branded"),
  maxHashtags: integer("max_hashtags").default(5),
  preferredEmojis: text("preferred_emojis").default(""),
  languageStyle: text("language_style").default("formal"),
  targetIndustry: text("target_industry").default(""),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

export const publishedPosts = pgTable("published_posts", {
  id: varchar("id")
    .primaryKey()
    .default(sql`gen_random_uuid()`),
  accountId: varchar("account_id").notNull().default("default"),
  mediaItemId: varchar("media_item_id"),
  mediaType: text("media_type").default("image"),
  mediaUri: text("media_uri"),
  caption: text("caption").notNull(),
  platform: text("platform").notNull(),
  metaPostId: text("meta_post_id"),
  scheduledDate: timestamp("scheduled_date"),
  publishedAt: timestamp("published_at"),
  status: text("status").default("scheduled"),
  goal: text("goal"),
  audience: text("audience"),
  cta: text("cta"),
  series: text("series"),
  offer: text("offer"),
  impressions: integer("impressions").default(0),
  reach: integer("reach").default(0),
  engagement: integer("engagement").default(0),
  clicks: integer("clicks").default(0),
  lastMetricsFetch: timestamp("last_metrics_fetch"),
  publishLockToken: varchar("publish_lock_token"),
  publishLockedAt: timestamp("publish_locked_at"),
  campaignId: varchar("campaign_id"),
  publishMode: text("publish_mode").default("DEMO"),
  publishAttempts: integer("publish_attempts").default(0),
  lastPublishError: text("last_publish_error"),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

export const captionVariants = pgTable("caption_variants", {
  id: varchar("id")
    .primaryKey()
    .default(sql`gen_random_uuid()`),
  publishedPostId: varchar("published_post_id").notNull(),
  captionText: text("caption_text").notNull(),
  toneScore: doublePrecision("tone_score").default(0),
  ctaScore: doublePrecision("cta_score").default(0),
  structureScore: doublePrecision("structure_score").default(0),
  lengthScore: doublePrecision("length_score").default(0),
  totalScore: doublePrecision("total_score").default(0),
  selected: boolean("selected").default(false),
  createdAt: timestamp("created_at").defaultNow(),
});

// =============================================
// FEATURE FLAGS SYSTEM
// =============================================
export const featureFlags = pgTable("feature_flags", {
  id: varchar("id")
    .primaryKey()
    .default(sql`gen_random_uuid()`),
  accountId: varchar("account_id").notNull().default("default"),
  flagName: text("flag_name").notNull(),
  enabled: boolean("enabled").default(false),
  updatedBy: varchar("updated_by"),
  updatedAt: timestamp("updated_at").defaultNow(),
  createdAt: timestamp("created_at").defaultNow(),
});

export const featureFlagAudit = pgTable("feature_flag_audit", {
  id: varchar("id")
    .primaryKey()
    .default(sql`gen_random_uuid()`),
  accountId: varchar("account_id").notNull().default("default"),
  userId: varchar("user_id"),
  flagName: text("flag_name").notNull(),
  fromValue: boolean("from_value"),
  toValue: boolean("to_value").notNull(),
  reason: text("reason"),
  createdAt: timestamp("created_at").defaultNow(),
});

// =============================================
// LEAD ENGINE: Lead Capture Module
// =============================================
export const leads = pgTable("leads", {
  id: varchar("id")
    .primaryKey()
    .default(sql`gen_random_uuid()`),
  accountId: varchar("account_id").notNull().default("default"),
  name: text("name"),
  email: text("email"),
  phone: text("phone"),
  customFields: text("custom_fields"),
  sourceType: text("source_type"),
  sourcePostId: varchar("source_post_id"),
  sourceCampaign: text("source_campaign"),
  sourceCtaVariantId: varchar("source_cta_variant_id"),
  sourceTrackingId: varchar("source_tracking_id"),
  sourceLandingPageId: varchar("source_landing_page_id"),
  sourceLeadMagnetId: varchar("source_lead_magnet_id"),
  campaignId: varchar("campaign_id"),
  funnelStage: text("funnel_stage").default("lead"),
  status: text("status").default("new"),
  revenue: doublePrecision("revenue").default(0),
  notes: text("notes"),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

export const leadForms = pgTable("lead_forms", {
  id: varchar("id")
    .primaryKey()
    .default(sql`gen_random_uuid()`),
  accountId: varchar("account_id").notNull().default("default"),
  name: text("name").notNull(),
  fields: text("fields").notNull(),
  thankYouMessage: text("thank_you_message").default("Thank you for your submission!"),
  redirectUrl: text("redirect_url"),
  isActive: boolean("is_active").default(true),
  submissions: integer("submissions").default(0),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

export const trackingLinks = pgTable("tracking_links", {
  id: varchar("id")
    .primaryKey()
    .default(sql`gen_random_uuid()`),
  accountId: varchar("account_id").notNull().default("default"),
  trackingId: varchar("tracking_id").notNull().unique(),
  destinationUrl: text("destination_url").notNull(),
  linkType: text("link_type").default("cta"),
  postId: varchar("post_id"),
  campaignId: varchar("campaign_id"),
  ctaVariantId: varchar("cta_variant_id"),
  whatsappNumber: text("whatsapp_number"),
  whatsappMessage: text("whatsapp_message"),
  clicks: integer("clicks").default(0),
  conversions: integer("conversions").default(0),
  isActive: boolean("is_active").default(true),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

// =============================================
// LEAD ENGINE: CTA Engine Module
// =============================================
export const ctaVariants = pgTable("cta_variants", {
  id: varchar("id")
    .primaryKey()
    .default(sql`gen_random_uuid()`),
  accountId: varchar("account_id").notNull().default("default"),
  postId: varchar("post_id"),
  campaignId: varchar("campaign_id"),
  ctaText: text("cta_text").notNull(),
  ctaType: text("cta_type").default("link"),
  destinationUrl: text("destination_url"),
  impressions: integer("impressions").default(0),
  clicks: integer("clicks").default(0),
  conversions: integer("conversions").default(0),
  conversionRate: doublePrecision("conversion_rate").default(0),
  isWinner: boolean("is_winner").default(false),
  isActive: boolean("is_active").default(true),
  abGroup: text("ab_group"),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

// =============================================
// LEAD ENGINE: Conversion Tracking Module
// =============================================
export const conversionEvents = pgTable("conversion_events", {
  id: varchar("id")
    .primaryKey()
    .default(sql`gen_random_uuid()`),
  accountId: varchar("account_id").notNull().default("default"),
  eventType: text("event_type").notNull(),
  trackingId: varchar("tracking_id"),
  leadId: varchar("lead_id"),
  postId: varchar("post_id"),
  ctaVariantId: varchar("cta_variant_id"),
  campaignId: varchar("campaign_id"),
  landingPageId: varchar("landing_page_id"),
  leadMagnetId: varchar("lead_magnet_id"),
  metadata: text("metadata"),
  ipAddress: text("ip_address"),
  userAgent: text("user_agent"),
  referrer: text("referrer"),
  createdAt: timestamp("created_at").defaultNow(),
});

// =============================================
// LEAD ENGINE: Funnel Logic Module
// =============================================
export const funnelDefinitions = pgTable("funnel_definitions", {
  id: varchar("id")
    .primaryKey()
    .default(sql`gen_random_uuid()`),
  accountId: varchar("account_id").notNull().default("default"),
  name: text("name").notNull(),
  stages: text("stages").notNull(),
  isDefault: boolean("is_default").default(false),
  isActive: boolean("is_active").default(true),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

export const funnelContentMap = pgTable("funnel_content_map", {
  id: varchar("id")
    .primaryKey()
    .default(sql`gen_random_uuid()`),
  accountId: varchar("account_id").notNull().default("default"),
  funnelId: varchar("funnel_id").notNull(),
  stage: text("stage").notNull(),
  postId: varchar("post_id"),
  contentType: text("content_type"),
  performance: text("performance"),
  createdAt: timestamp("created_at").defaultNow(),
});

// =============================================
// LEAD ENGINE: Lead Magnet Module
// =============================================
export const leadMagnets = pgTable("lead_magnets", {
  id: varchar("id")
    .primaryKey()
    .default(sql`gen_random_uuid()`),
  accountId: varchar("account_id").notNull().default("default"),
  name: text("name").notNull(),
  magnetType: text("magnet_type").notNull(),
  content: text("content"),
  deliveryMethod: text("delivery_method").default("email"),
  downloadUrl: text("download_url"),
  discountCode: text("discount_code"),
  offerDetails: text("offer_details"),
  downloads: integer("downloads").default(0),
  leadsGenerated: integer("leads_generated").default(0),
  conversionRate: doublePrecision("conversion_rate").default(0),
  isActive: boolean("is_active").default(true),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

// =============================================
// LEAD ENGINE: Landing Page Module
// =============================================
export const landingPages = pgTable("landing_pages", {
  id: varchar("id")
    .primaryKey()
    .default(sql`gen_random_uuid()`),
  accountId: varchar("account_id").notNull().default("default"),
  title: text("title").notNull(),
  slug: varchar("slug").notNull().unique(),
  headline: text("headline"),
  subheadline: text("subheadline"),
  bodyContent: text("body_content"),
  ctaText: text("cta_text"),
  ctaUrl: text("cta_url"),
  formId: varchar("form_id"),
  leadMagnetId: varchar("lead_magnet_id"),
  ctaVariantId: varchar("cta_variant_id"),
  backgroundImage: text("background_image"),
  colorScheme: text("color_scheme").default("default"),
  views: integer("views").default(0),
  conversions: integer("conversions").default(0),
  conversionRate: doublePrecision("conversion_rate").default(0),
  isPublished: boolean("is_published").default(false),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

// =============================================
// LEAD ENGINE: Revenue Attribution Module
// =============================================
export const revenueEntries = pgTable("revenue_entries", {
  id: varchar("id")
    .primaryKey()
    .default(sql`gen_random_uuid()`),
  accountId: varchar("account_id").notNull().default("default"),
  leadId: varchar("lead_id"),
  amount: doublePrecision("amount").notNull().default(0),
  source: text("source"),
  postId: varchar("post_id"),
  campaignId: varchar("campaign_id"),
  ctaVariantId: varchar("cta_variant_id"),
  funnelStage: text("funnel_stage"),
  notes: text("notes"),
  createdAt: timestamp("created_at").defaultNow(),
});

export const adSpendEntries = pgTable("ad_spend_entries", {
  id: varchar("id")
    .primaryKey()
    .default(sql`gen_random_uuid()`),
  accountId: varchar("account_id").notNull().default("default"),
  amount: doublePrecision("amount").notNull().default(0),
  platform: text("platform"),
  campaignId: varchar("campaign_id"),
  period: text("period"),
  notes: text("notes"),
  createdAt: timestamp("created_at").defaultNow(),
});

export type VideoProject = typeof videoProjects.$inferSelect;
export type PerformanceSnapshot = typeof performanceSnapshots.$inferSelect;
export type StrategyInsight = typeof strategyInsights.$inferSelect;
export type StrategyDecision = typeof strategyDecisions.$inferSelect;
export type StrategyMemory = typeof strategyMemory.$inferSelect;
export type GrowthCampaign = typeof growthCampaigns.$inferSelect;
export type WeeklyReport = typeof weeklyReports.$inferSelect;
export type BrandConfig = typeof brandConfig.$inferSelect;
export type PublishedPost = typeof publishedPosts.$inferSelect;
export type CaptionVariant = typeof captionVariants.$inferSelect;
export type FeatureFlag = typeof featureFlags.$inferSelect;
export type FeatureFlagAuditEntry = typeof featureFlagAudit.$inferSelect;
export type Lead = typeof leads.$inferSelect;
export type LeadForm = typeof leadForms.$inferSelect;
export type TrackingLink = typeof trackingLinks.$inferSelect;
export type CtaVariant = typeof ctaVariants.$inferSelect;
export type ConversionEvent = typeof conversionEvents.$inferSelect;
export type FunnelDefinition = typeof funnelDefinitions.$inferSelect;
export type FunnelContentMap = typeof funnelContentMap.$inferSelect;
export type LeadMagnet = typeof leadMagnets.$inferSelect;
export type LandingPage = typeof landingPages.$inferSelect;
export type RevenueEntry = typeof revenueEntries.$inferSelect;
export type AdSpendEntry = typeof adSpendEntries.$inferSelect;

// =============================================
// COMPETITIVE INTELLIGENCE MODULE
// =============================================
export const ciCompetitors = pgTable("ci_competitors", {
  id: varchar("id")
    .primaryKey()
    .default(sql`gen_random_uuid()`),
  accountId: varchar("account_id").notNull().default("default"),
  name: text("name").notNull(),
  platform: text("platform").notNull().default("instagram"),
  profileLink: text("profile_link").notNull(),
  businessType: text("business_type").notNull(),
  primaryObjective: text("primary_objective").notNull(),
  postingFrequency: integer("posting_frequency"),
  contentTypeRatio: text("content_type_ratio"),
  engagementRatio: doublePrecision("engagement_ratio"),
  ctaPatterns: text("cta_patterns"),
  discountFrequency: text("discount_frequency"),
  hookStyles: text("hook_styles"),
  messagingTone: text("messaging_tone"),
  socialProofPresence: text("social_proof_presence"),
  screenshotUrls: text("screenshot_urls"),
  notes: text("notes"),
  isDemo: boolean("is_demo").default(false),
  isActive: boolean("is_active").default(true),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

export const ciSnapshots = pgTable("ci_snapshots", {
  id: varchar("id")
    .primaryKey()
    .default(sql`gen_random_uuid()`),
  accountId: varchar("account_id").notNull().default("default"),
  competitorId: varchar("competitor_id").notNull(),
  snapshotMonth: text("snapshot_month").notNull(),
  postingFrequency: integer("posting_frequency"),
  contentTypeRatio: text("content_type_ratio"),
  engagementRatio: doublePrecision("engagement_ratio"),
  ctaPatterns: text("cta_patterns"),
  discountFrequency: text("discount_frequency"),
  hookStyles: text("hook_styles"),
  messagingTone: text("messaging_tone"),
  socialProofPresence: text("social_proof_presence"),
  rawData: text("raw_data"),
  createdAt: timestamp("created_at").defaultNow(),
});

export const ciMarketAnalyses = pgTable("ci_market_analyses", {
  id: varchar("id")
    .primaryKey()
    .default(sql`gen_random_uuid()`),
  accountId: varchar("account_id").notNull().default("default"),
  analysisMonth: text("analysis_month").notNull(),
  marketOverview: text("market_overview"),
  competitorBreakdown: text("competitor_breakdown"),
  strategicGaps: text("strategic_gaps"),
  saturationPatterns: text("saturation_patterns"),
  differentiationGaps: text("differentiation_gaps"),
  offerPositioningGaps: text("offer_positioning_gaps"),
  pricingNarrativePatterns: text("pricing_narrative_patterns"),
  funnelWeaknesses: text("funnel_weaknesses"),
  ctaTrends: text("cta_trends"),
  authorityGaps: text("authority_gaps"),
  monthDiff: text("month_diff"),
  clientPerformanceShift: text("client_performance_shift"),
  evidenceSummary: text("evidence_summary"),
  dataCompleteness: doublePrecision("data_completeness").default(0),
  status: text("status").default("pending"),
  isDemo: boolean("is_demo").default(false),
  createdAt: timestamp("created_at").defaultNow(),
});

export const ciRecommendations = pgTable("ci_recommendations", {
  id: varchar("id")
    .primaryKey()
    .default(sql`gen_random_uuid()`),
  accountId: varchar("account_id").notNull().default("default"),
  analysisId: varchar("analysis_id").notNull(),
  category: text("category").notNull(),
  title: text("title").notNull(),
  description: text("description").notNull(),
  actionType: text("action_type").notNull(),
  actionTarget: text("action_target").notNull(),
  actionDetails: text("action_details"),
  evidenceCitations: text("evidence_citations"),
  whyChanged: text("why_changed"),
  confidenceScore: doublePrecision("confidence_score").default(0),
  riskLevel: text("risk_level").default("low"),
  impactRangeLow: doublePrecision("impact_range_low").default(0),
  impactRangeHigh: doublePrecision("impact_range_high").default(0),
  timeframe: text("timeframe").default("30_days"),
  status: text("status").default("pending"),
  isDemo: boolean("is_demo").default(false),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

export const ciStrategyDecisions = pgTable("ci_strategy_decisions", {
  id: varchar("id")
    .primaryKey()
    .default(sql`gen_random_uuid()`),
  accountId: varchar("account_id").notNull().default("default"),
  recommendationId: varchar("recommendation_id").notNull(),
  analysisId: varchar("analysis_id").notNull(),
  decision: text("decision").notNull(),
  reason: text("reason"),
  appliedChanges: text("applied_changes"),
  createdAt: timestamp("created_at").defaultNow(),
});

export const metaCredentials = pgTable("meta_credentials", {
  id: varchar("id")
    .primaryKey()
    .default(sql`gen_random_uuid()`),
  accountId: varchar("account_id").notNull().default("default").unique(),
  encryptedUserToken: text("encrypted_user_token"),
  ivUser: text("iv_user"),
  encryptedPageToken: text("encrypted_page_token"),
  ivPage: text("iv_page"),
  encryptionKeyVersion: integer("encryption_key_version").default(1),
  userTokenExpiresAt: timestamp("user_token_expires_at"),
  pageId: text("page_id"),
  pageName: text("page_name"),
  igBusinessId: text("ig_business_id"),
  igUsername: text("ig_username"),
  lastHealthCheckAt: timestamp("last_health_check_at"),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

export type MetaCredentials = typeof metaCredentials.$inferSelect;

export const campaignSelections = pgTable("campaign_selections", {
  id: varchar("id")
    .primaryKey()
    .default(sql`gen_random_uuid()`),
  accountId: varchar("account_id").notNull().default("default"),
  selectedCampaignId: varchar("selected_campaign_id").notNull(),
  selectedCampaignName: text("selected_campaign_name").notNull(),
  selectedPlatform: text("selected_platform").default("meta"),
  campaignGoalType: text("campaign_goal_type").notNull(),
  campaignStatus: text("campaign_status").notNull().default("active"),
  campaignLocation: text("campaign_location"),
  selectedAt: timestamp("selected_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

export type CampaignSelection = typeof campaignSelections.$inferSelect;

export type CiCompetitor = typeof ciCompetitors.$inferSelect;
export type CiSnapshot = typeof ciSnapshots.$inferSelect;
export type CiMarketAnalysis = typeof ciMarketAnalyses.$inferSelect;
export type CiRecommendation = typeof ciRecommendations.$inferSelect;
export type CiStrategyDecision = typeof ciStrategyDecisions.$inferSelect;

// =============================================
// STRATEGIC CORE: BUILD THE PLAN
// =============================================
export const strategicBlueprints = pgTable("strategic_blueprints", {
  id: varchar("id")
    .primaryKey()
    .default(sql`gen_random_uuid()`),
  accountId: varchar("account_id").notNull().default("default"),
  campaignId: varchar("campaign_id"),
  campaignContext: text("campaign_context"),
  blueprintVersion: integer("blueprint_version").notNull().default(1),
  status: text("status").notNull().default("DRAFT"),
  competitorUrls: text("competitor_urls"),
  averageSellingPrice: doublePrecision("average_selling_price"),
  creativeMediaType: text("creative_media_type"),
  creativeMediaUrl: text("creative_media_url"),
  draftBlueprint: text("draft_blueprint"),
  creativeAnalysis: text("creative_analysis"),
  confirmedBlueprint: text("confirmed_blueprint"),
  marketMap: text("market_map"),
  validationResult: text("validation_result"),
  orchestratorPlan: text("orchestrator_plan"),
  gatePassedAt: timestamp("gate_passed_at"),
  analysisCompletedAt: timestamp("analysis_completed_at"),
  confirmedAt: timestamp("confirmed_at"),
  validatedAt: timestamp("validated_at"),
  orchestratedAt: timestamp("orchestrated_at"),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

export const blueprintCompetitors = pgTable("blueprint_competitors", {
  id: varchar("id")
    .primaryKey()
    .default(sql`gen_random_uuid()`),
  blueprintId: varchar("blueprint_id").notNull(),
  url: text("url").notNull(),
  analysisData: text("analysis_data"),
  createdAt: timestamp("created_at").defaultNow(),
});

export const blueprintVersions = pgTable("blueprint_versions", {
  id: varchar("id")
    .primaryKey()
    .default(sql`gen_random_uuid()`),
  blueprintId: varchar("blueprint_id").notNull(),
  version: integer("version").notNull().default(1),
  accountId: varchar("account_id").notNull().default("default"),
  campaignId: varchar("campaign_id"),
  campaignContext: text("campaign_context"),
  confirmedBlueprint: text("confirmed_blueprint"),
  draftBlueprint: text("draft_blueprint"),
  competitorUrls: text("competitor_urls"),
  averageSellingPrice: doublePrecision("average_selling_price"),
  marketMap: text("market_map"),
  validationResult: text("validation_result"),
  orchestratorPlan: text("orchestrator_plan"),
  previousVersionId: varchar("previous_version_id"),
  createdAt: timestamp("created_at").defaultNow(),
});

export const strategicAuditLogs = pgTable("strategic_audit_logs", {
  id: varchar("id")
    .primaryKey()
    .default(sql`gen_random_uuid()`),
  accountId: varchar("account_id").notNull().default("default"),
  campaignId: varchar("campaign_id"),
  blueprintId: varchar("blueprint_id"),
  blueprintVersion: integer("blueprint_version"),
  event: text("event").notNull(),
  details: text("details"),
  timestamp: timestamp("timestamp").defaultNow(),
});

export const extractionMetrics = pgTable("extraction_metrics", {
  id: varchar("id")
    .primaryKey()
    .default(sql`gen_random_uuid()`),
  campaignId: varchar("campaign_id"),
  blueprintId: varchar("blueprint_id").notNull(),
  modelName: text("model_name").notNull(),
  parseFailedReason: text("parse_failed_reason").notNull(),
  inputTokenCount: integer("input_token_count"),
  outputTokenCount: integer("output_token_count"),
  totalTokenCount: integer("total_token_count"),
  finishReason: text("finish_reason"),
  creativeType: text("creative_type").notNull(),
  videoDuration: doublePrecision("video_duration"),
  attemptCount: integer("attempt_count").notNull().default(1),
  createdAt: timestamp("created_at").defaultNow(),
});

export type StrategicBlueprint = typeof strategicBlueprints.$inferSelect;
export type BlueprintCompetitor = typeof blueprintCompetitors.$inferSelect;
export type BlueprintVersion = typeof blueprintVersions.$inferSelect;
export type StrategicAuditLog = typeof strategicAuditLogs.$inferSelect;
export type ExtractionMetric = typeof extractionMetrics.$inferSelect;
