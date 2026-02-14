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
