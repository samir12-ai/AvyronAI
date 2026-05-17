import { sql } from "drizzle-orm";
import { pgTable, text, varchar, integer, serial, timestamp, boolean, doublePrecision, uniqueIndex, jsonb, primaryKey, bigint } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";

export const users = pgTable("users", {
  id: varchar("id")
    .primaryKey()
    .default(sql`gen_random_uuid()`),
  username: text("username").notNull().unique(),
  password: text("password").notNull(),
  email: text("email").unique(),
  trialStart: timestamp("trial_start").defaultNow(),
  trialEnd: timestamp("trial_end"),
  subscriptionStatus: text("subscription_status").default("trial"),
  planType: text("plan_type").default("trial"),
  videoCredits: integer("video_credits").default(0),
  stripeCustomerId: text("stripe_customer_id"),
  hasSeenIntro: boolean("has_seen_intro").default(false),
  accountId: varchar("account_id"),
  createdAt: timestamp("created_at").defaultNow(),
});

export const photographerProfiles = pgTable("photographer_profiles", {
  id: varchar("id")
    .primaryKey()
    .default(sql`gen_random_uuid()`),
  // tenant ownership column. Added by migration
  // 012. Nullable for safe online deploy; reads filter by accountId, so any
  // pre-migration row with NULL account_id is invisible to every authed user.
  accountId: varchar("account_id"),
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
  // tenant ownership column. See migration 012.
  accountId: varchar("account_id"),
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
  // tenant ownership column. See migration 012.
  accountId: varchar("account_id"),
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
  // tenant ownership column. Added by migration
  // 012. Nullable for safe online deploy; reads filter by accountId, so any
  // pre-migration row with NULL account_id is invisible to every authed user.
  accountId: varchar("account_id"),
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
  accountId: varchar("account_id").notNull(),
  campaignId: varchar("campaign_id").notNull(),
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
  campaignId: varchar("campaign_id"),
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
  insightType: text("insight_type").default("user_execution"),
});

export const strategyMemory = pgTable("strategy_memory", {
  id: varchar("id")
    .primaryKey()
    .default(sql`gen_random_uuid()`),
  accountId: varchar("account_id").notNull(),
  campaignId: varchar("campaign_id").notNull(),
  memoryType: text("memory_type").notNull(),
  label: text("label").notNull(),
  details: text("details"),
  performance: text("performance"),
  score: doublePrecision("score").default(0),
  usageCount: integer("usage_count").default(0),
  lastUsed: timestamp("last_used"),
  /** @deprecated backward-compat alias — always kept in sync with direction. Read-path derives this as direction === 'reinforce'. Write-path must set isWinner = (direction === 'reinforce'). */
  isWinner: boolean("is_winner").default(false),
  engineName: text("engine_name"),
  planId: varchar("plan_id"),
  strategyFingerprint: text("strategy_fingerprint"),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
  confidenceScore: doublePrecision("confidence_score").default(0.5),
  direction: text("direction").default("neutral"),
  lastValidatedAt: timestamp("last_validated_at"),
  decayRate: doublePrecision("decay_rate").default(0.95),
  validationCount: integer("validation_count").default(0),
  industry: text("industry"),
  platform: text("platform"),
  campaignType: text("campaign_type"),
  funnelObjective: text("funnel_objective"),
  sourceOutcomeId: varchar("source_outcome_id"),
  // Task #65 / Phase 2 — DEC-B FK on strategy_decisions.id. Nullable for
  // legacy/backfilled rows; new reinforcement-path writes populate this
  // so updates can target by the decision that triggered them.
  decisionId: varchar("decision_id"),
  // Task #65 / Phase 2 — explicit provenance tag for every write.
  // Canonical values: 'outcome' | 'mutation' | 'engine_seed' |
  // 'exploration' | 'decay' | 'unknown'. Non-outcome writes that lack a
  // sourceOutcomeId set this to a non-'unknown' value so audits can
  // distinguish "never had a source" from "writer didn't declare one".
  provenanceOrigin: text("provenance_origin").default("unknown"),
});

// Task #64 / Phase 1 — Canonical Fact Ownership.
// mutation_log was previously persisted as a strategy_memory row with
// memoryType='mutation_log'. That collapsed two distinct concerns onto one
// table: strategic facts (winners/avoids/insights — readable as AI context)
// and operational audit logs (mutation runs — strictly internal). Splitting
// removes the need for every fact reader to filter out the audit row.
export const mutationLog = pgTable("mutation_log", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  accountId: varchar("account_id").notNull(),
  campaignId: varchar("campaign_id").notNull(),
  label: text("label").notNull(),
  confirmedCount: integer("confirmed_count").default(0),
  challengedCount: integer("challenged_count").default(0),
  flippedCount: integer("flipped_count").default(0),
  decayedCount: integer("decayed_count").default(0),
  totalProcessed: integer("total_processed").default(0),
  challengedIds: jsonb("challenged_ids").$type<string[]>().default(sql`'[]'::jsonb`),
  flipped: jsonb("flipped").$type<Array<{ label: string; from: string; to: string }>>().default(sql`'[]'::jsonb`),
  runAt: timestamp("run_at").defaultNow(),
  createdAt: timestamp("created_at").defaultNow(),
});

// Task #64 / Phase 1 — Canonical Fact Ownership.
// content_rhythm, exploration_budget, and agent rhythm rows are operational
// state, not strategic memory. Co-locating them on strategy_memory required
// the OPERATIONAL_MEMORY_TYPES bypass in decision-policy and a NON_STRATEGIC
// filter on every read path. Demoting them to a dedicated table removes both.
// Singleton-per-(account, campaign, stateType): writers upsert.
export const engineOperationalState = pgTable("engine_operational_state", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  accountId: varchar("account_id").notNull(),
  campaignId: varchar("campaign_id").notNull(),
  // 'content_rhythm' | 'exploration_budget' | 'agent_rhythm'
  stateType: text("state_type").notNull(),
  engineName: text("engine_name").notNull(),
  label: text("label").notNull(),
  payload: jsonb("payload").default(sql`'{}'::jsonb`),
  rationale: text("rationale"),
  confidenceScore: doublePrecision("confidence_score").default(0.5),
  updatedAt: timestamp("updated_at").defaultNow(),
  createdAt: timestamp("created_at").defaultNow(),
});

export const contentPerformanceSnapshots = pgTable("content_performance_snapshots", {
  id: varchar("id")
    .primaryKey()
    .default(sql`gen_random_uuid()`),
  accountId: varchar("account_id").notNull(),
  campaignId: varchar("campaign_id").notNull(),
  contentType: text("content_type").notNull(),
  periodLabel: text("period_label").notNull(),
  periodStart: timestamp("period_start"),
  periodEnd: timestamp("period_end"),
  avgReach: doublePrecision("avg_reach").default(0),
  avgSaves: doublePrecision("avg_saves").default(0),
  savesRate: doublePrecision("saves_rate").default(0),
  avgEngagementRate: doublePrecision("avg_engagement_rate").default(0),
  avgLikes: doublePrecision("avg_likes").default(0),
  avgComments: doublePrecision("avg_comments").default(0),
  reachDecayFactor: doublePrecision("reach_decay_factor").default(1.0),
  totalPublished: integer("total_published").default(0),
  rawPerformanceScore: doublePrecision("raw_performance_score").default(0),
  smoothedPerformanceScore: doublePrecision("smoothed_performance_score").default(0),
  volumePenaltyApplied: boolean("volume_penalty_applied").default(false),
  source: text("source").default("manual"),
  notes: text("notes"),
  createdAt: timestamp("created_at").defaultNow(),
});

export type ContentPerformanceSnapshot = typeof contentPerformanceSnapshots.$inferSelect;
export type InsertContentPerformanceSnapshot = typeof contentPerformanceSnapshots.$inferInsert;

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
  goalMode: text("goal_mode").default("STRATEGY_MODE"),
  explorationBudgetPercent: doublePrecision("exploration_budget_percent"),
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
  accountId: varchar("account_id").notNull(),
  campaignId: varchar("campaign_id").notNull(),
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
  maxDecisionsPerHour: integer("max_decisions_per_hour").default(1),
  circuitBreakerThreshold: integer("circuit_breaker_threshold").default(3),
  idleSkipDays: integer("idle_skip_days").default(7),
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
  campaignId: varchar("campaign_id"),
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
  confidenceScore: integer("confidence_score").default(0),
  confidenceStatus: text("confidence_status").default("Unstable"),
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

// ─── () — F1.9 / F1.10 strict body schemas ──────────────────
// Pass-3 (reviewer-aligned): built via drizzle-zod's createInsertSchema()
// so the column allowlist is DERIVED FROM THE TABLE SCHEMA — if a column
// is renamed or dropped, the `.pick({...})` here fails to type-check, so
// the allowlist cannot silently drift from the database. `.strict()`
// produces `unrecognized_keys` for any body field outside the picked set.
// Per-field regex constraints are layered on with `.extend()`.
const SEAL3_PHOTO_TEXT_RE = new RegExp("^[A-Za-z0-9 .,'\"!?@()_+\\-/\\[\\]]{0,500}$");
const SEAL3_PHOTO_URL_RE = new RegExp("^https?://[A-Za-z0-9._~:/?#\\[\\]@!$'()*+,;=%\\-]{1,500}$", "i");
const SEAL3_PHOTO_HANDLE_RE = new RegExp("^[A-Za-z0-9._@:\\-/]{1,100}$");
const SEAL3_PHOTO_PHONE_RE = new RegExp("^[+0-9 ()\\-]{0,40}$");
const SEAL3_PHOTO_PATH_RE = new RegExp("^[A-Za-z0-9._\\-/]{0,500}$");
const SEAL3_VIDEO_TITLE_RE = new RegExp("^[A-Za-z0-9 .,'\"!?@()_+\\-/\\[\\]]{1,200}$");
const SEAL3_VIDEO_TAG_RE = new RegExp("^[A-Za-z0-9 _\\-]{1,50}$");

export const photographyProfileUpdateSchema = createInsertSchema(photographerProfiles)
  .pick({
    name: true,
    phone: true,
    bio: true,
    specialties: true,
    profileImage: true,
    coverImage: true,
    location: true,
    city: true,
    country: true,
    priceRange: true,
    instagram: true,
    website: true,
  })
  .extend({
    name: z.string().trim().min(1).max(120).regex(SEAL3_PHOTO_TEXT_RE),
    phone: z.string().trim().max(40).regex(SEAL3_PHOTO_PHONE_RE).nullable(),
    bio: z.string().trim().max(2000).regex(SEAL3_PHOTO_TEXT_RE).nullable(),
    specialties: z.string().trim().max(500).regex(SEAL3_PHOTO_TEXT_RE).nullable(),
    profileImage: z.string().trim().max(500).regex(SEAL3_PHOTO_PATH_RE).nullable(),
    coverImage: z.string().trim().max(500).regex(SEAL3_PHOTO_PATH_RE).nullable(),
    location: z.string().trim().max(120).regex(SEAL3_PHOTO_TEXT_RE),
    city: z.string().trim().max(120).regex(SEAL3_PHOTO_TEXT_RE),
    country: z.string().trim().max(120).regex(SEAL3_PHOTO_TEXT_RE),
    priceRange: z.string().trim().max(120).regex(SEAL3_PHOTO_TEXT_RE).nullable(),
    instagram: z.string().trim().max(120).regex(SEAL3_PHOTO_HANDLE_RE).nullable(),
    website: z.string().trim().max(500).regex(SEAL3_PHOTO_URL_RE).nullable(),
  })
  .strict()
  .partial();
export type PhotographyProfileUpdate = z.infer<typeof photographyProfileUpdateSchema>;

export const videoProjectCreateSchema = createInsertSchema(videoProjects)
  .pick({ title: true, style: true, mood: true })
  .extend({
    title: z.string().trim().min(1).max(200).regex(SEAL3_VIDEO_TITLE_RE),
    style: z.string().trim().min(1).max(50).regex(SEAL3_VIDEO_TAG_RE),
    mood: z.string().trim().min(1).max(50).regex(SEAL3_VIDEO_TAG_RE),
  })
  .strict()
  .partial();
export type VideoProjectCreate = z.infer<typeof videoProjectCreateSchema>;

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
  publishMode: text("publish_mode").default("BLOCKED"),
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
  campaignId: varchar("campaign_id").notNull().default("default"),
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
  websiteUrl: text("website_url"),
  blogUrl: text("blog_url"),
  websiteScrapedAt: timestamp("website_scraped_at"),
  blogScrapedAt: timestamp("blog_scraped_at"),
  websiteEnrichmentStatus: text("website_enrichment_status").default("NONE"),
  blogEnrichmentStatus: text("blog_enrichment_status").default("NONE"),
  isDemo: boolean("is_demo").default(false),
  isActive: boolean("is_active").default(true),
  lastCheckedAt: timestamp("last_checked_at"),
  analysisLevel: text("analysis_level").default("FAST_PASS"),
  enrichmentStatus: text("enrichment_status").default("PENDING"),
  fetchMethod: text("fetch_method"),
  postsCollected: integer("posts_collected").default(0),
  commentsCollected: integer("comments_collected").default(0),
  dataFreshnessDays: integer("data_freshness_days").default(0),
  lastSyntheticEnrichmentAt: timestamp("last_synthetic_enrichment_at"),
  syntheticEnrichmentCount: integer("synthetic_enrichment_count").notNull().default(0),
  syntheticChurnFlag: text("synthetic_churn_flag"),
  lastPostWatermark: timestamp("last_post_watermark"),
  sharedProfileId: varchar("shared_profile_id"),
  tiktokUrl: text("tiktok_url"),
  googleMapsUrl: text("google_maps_url"),
  // refresh tier. 'A' = priority (24h cooldown), 'B' = standard
  // (72h cooldown). Defaults to 'B' for safety; operators promote competitors
  // to tier A explicitly via UI/API.
  tier: text("tier").notNull().default("B"),
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
  dataSourceMode: text("data_source_mode").notNull().default("benchmark"),
  selectedAt: timestamp("selected_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

export type CampaignSelection = typeof campaignSelections.$inferSelect;

export const competitorWebData = pgTable("competitor_web_data", {
  id: varchar("id")
    .primaryKey()
    .default(sql`gen_random_uuid()`),
  accountId: varchar("account_id").notNull().default("default"),
  competitorId: varchar("competitor_id").notNull(),
  campaignId: varchar("campaign_id").notNull(),
  sourceType: text("source_type").notNull(),
  sourceUrl: text("source_url").notNull(),
  pageType: text("page_type"),
  headlines: text("headlines"),
  subheadlines: text("subheadlines"),
  ctaLabels: text("cta_labels"),
  offerPhrases: text("offer_phrases"),
  pricingAnchors: text("pricing_anchors"),
  proofBlocks: text("proof_blocks"),
  testimonialBlocks: text("testimonial_blocks"),
  topicTitles: text("topic_titles"),
  contentHeadings: text("content_headings"),
  guarantees: text("guarantees"),
  featureList: text("feature_list"),
  navigationLinks: text("navigation_links"),
  rawTextPreview: text("raw_text_preview"),
  extractionStatus: text("extraction_status").default("PENDING"),
  extractionError: text("extraction_error"),
  signalClassification: text("signal_classification"),
  scrapedAt: timestamp("scraped_at").defaultNow(),
  expiresAt: timestamp("expires_at"),
  createdAt: timestamp("created_at").defaultNow(),
});

export type CompetitorWebData = typeof competitorWebData.$inferSelect;

export const ciSharedProfiles = pgTable("ci_shared_profiles", {
  id: varchar("id")
    .primaryKey()
    .default(sql`gen_random_uuid()`),
  platform: text("platform").notNull().default("instagram"),
  normalizedHandle: text("normalized_handle").notNull(),
  followers: integer("followers"),
  bioText: text("bio_text"),
  linkInBio: text("link_in_bio"),
  postCount: integer("post_count").default(0),
  commentCount: integer("comment_count").default(0),
  scrapeQuality: text("scrape_quality").default("FAST_PASS"),
  lastScrapedAt: timestamp("last_scraped_at"),
  fetchMethod: text("fetch_method"),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
}, (table) => ({
  platformHandleUnique: uniqueIndex("idx_ci_shared_profiles_platform_handle").on(table.platform, table.normalizedHandle),
}));

export type CiSharedProfile = typeof ciSharedProfiles.$inferSelect;

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

export const dominanceAnalyses = pgTable("dominance_analyses", {
  id: varchar("id")
    .primaryKey()
    .default(sql`gen_random_uuid()`),
  accountId: varchar("account_id").notNull().default("default"),
  campaignId: varchar("campaign_id"),
  location: text("location").default("Dubai, UAE"),
  blueprintId: varchar("blueprint_id"),
  runId: varchar("run_id").default(sql`gen_random_uuid()`),
  runVersion: integer("run_version").default(1),
  inputsHash: text("inputs_hash"),
  competitorName: text("competitor_name").notNull(),
  competitorUrl: text("competitor_url").notNull(),
  topContent: text("top_content"),
  contentEvidence: text("content_evidence"),
  evidenceSource: text("evidence_source").default("manual"),
  contentDissection: text("content_dissection"),
  weaknessDetection: text("weakness_detection"),
  dominanceStrategy: text("dominance_strategy"),
  dominanceDelta: text("dominance_delta"),
  fallbackReason: text("fallback_reason"),
  fallbackAcknowledged: boolean("fallback_acknowledged").default(false),
  modificationStatus: text("modification_status").default("pending"),
  modelUsed: text("model_used").default("gpt-5.2"),
  status: text("status").default("pending"),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

export const dominanceModifications = pgTable("dominance_modifications", {
  id: varchar("id")
    .primaryKey()
    .default(sql`gen_random_uuid()`),
  analysisId: varchar("analysis_id").notNull(),
  accountId: varchar("account_id").notNull().default("default"),
  basePlan: text("base_plan"),
  adjustedPlan: text("adjusted_plan"),
  diffSummary: text("diff_summary"),
  adjustments: text("adjustments"),
  overallImpact: text("overall_impact"),
  competitorTargeted: text("competitor_targeted"),
  lifecycleStatus: text("lifecycle_status").default("DRAFT"),
  approvedBy: text("approved_by"),
  approvedAt: timestamp("approved_at"),
  rejectedReason: text("rejected_reason"),
  previousBasePlan: text("previous_base_plan"),
  rollbackAvailable: boolean("rollback_available").default(false),
  fallbackUsed: boolean("fallback_used").default(false),
  fallbackReason: text("fallback_reason"),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

// =============================================
// EXECUTION MACHINE: STRATEGIC PLANS + APPROVAL + REQUIRED WORK
// =============================================
export const strategicPlans = pgTable("strategic_plans", {
  id: varchar("id")
    .primaryKey()
    .default(sql`gen_random_uuid()`),
  accountId: varchar("account_id").notNull().default("default"),
  blueprintId: varchar("blueprint_id").notNull(),
  campaignId: varchar("campaign_id").notNull(),
  jobId: varchar("job_id"),
  planJson: text("plan_json").notNull(),
  planSummary: text("plan_summary"),
  status: text("status").notNull().default("DRAFT"),
  executionStatus: text("execution_status").notNull().default("IDLE"),
  emergencyStopped: boolean("emergency_stopped").default(false),
  emergencyStoppedAt: timestamp("emergency_stopped_at"),
  emergencyStoppedReason: text("emergency_stopped_reason"),
  generatedToCalendarAt: timestamp("generated_to_calendar_at"),
  aiExecutionStartedAt: timestamp("ai_execution_started_at"),
  aiExecutionCompletedAt: timestamp("ai_execution_completed_at"),
  totalCalendarEntries: integer("total_calendar_entries").default(0),
  totalStudioItems: integer("total_studio_items").default(0),
  totalPublished: integer("total_published").default(0),
  totalFailed: integer("total_failed").default(0),
  totalCanceled: integer("total_canceled").default(0),
  rootBundleId: varchar("root_bundle_id"),
  rootBundleVersion: integer("root_bundle_version"),
  approvedRhythmJson: text("approved_rhythm_json"),
  // optimistic-locking version. Every UPDATE
  // must include WHERE version=? + SET version=version+1; affected-rows=0
  // throws CONCURRENT_MODIFICATION instead of silently overwriting a
  // concurrent edit (e.g. plan approval racing plan synthesis re-write).
  version: integer("version").notNull().default(1),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

export const planApprovals = pgTable("plan_approvals", {
  id: varchar("id")
    .primaryKey()
    .default(sql`gen_random_uuid()`),
  planId: varchar("plan_id").notNull(),
  accountId: varchar("account_id").notNull().default("default"),
  decision: text("decision").notNull(),
  reason: text("reason"),
  decidedBy: text("decided_by").default("client"),
  rhythmSnapshotJson: text("rhythm_snapshot_json"),
  // optimistic-locking version (same contract
  // as strategicPlans.version above).
  version: integer("version").notNull().default(1),
  createdAt: timestamp("created_at").defaultNow(),
});

// in_flight_jobs: snapshot-cleanup-worker
// MUST exclude any snapshot whose jobId is currently in this table. The
// orchestrator inserts on job start, deletes on terminal status (COMPLETED
// / NEEDS_INPUT / BLOCKED / ERROR). Reaper deletes rows whose started_at
// is older than the orchestrator wall-clock budget (currently ~30 min).
export const inFlightJobs = pgTable("in_flight_jobs", {
  jobId: varchar("job_id").primaryKey(),
  accountId: varchar("account_id").notNull(),
  campaignId: varchar("campaign_id").notNull(),
  startedAt: timestamp("started_at").notNull().defaultNow(),
  expectedCompleteBy: timestamp("expected_complete_by"),
});

// Seal #13 / Track #1 — Operational continuity layer.
//
// plan_anchor_resets: explicit re-anchor records consulted by
// evaluateWindowState() in addition to plan_approvals.decided_at.
// The scheduler writes a row here when it detects a long gap
// (>1 window since the most-recent anchor with no eval windows
// produced) so that the next evaluation cycle starts cleanly at
// window_index=0 instead of jumping to index N with N orphan
// windows. Append-only.
export const planAnchorResets = pgTable("plan_anchor_resets", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  accountId: varchar("account_id").notNull(),
  campaignId: varchar("campaign_id").notNull(),
  planId: varchar("plan_id").notNull(),
  reanchoredAt: timestamp("reanchored_at").notNull(),
  reason: text("reason").notNull(),
  source: text("source").notNull().default("continuity_scheduler"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});
export type PlanAnchorReset = typeof planAnchorResets.$inferSelect;
export type InsertPlanAnchorReset = typeof planAnchorResets.$inferInsert;

// continuity_ticks: one row per continuity scheduler tick. Drives
// the /healthz/continuity endpoint and gives ops a paper trail
// explaining WHY no boss_run was produced for a given window.
export const continuityTicks = pgTable("continuity_ticks", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  tickAt: timestamp("tick_at").notNull().defaultNow(),
  durationMs: integer("duration_ms").notNull().default(0),
  campaignsScanned: integer("campaigns_scanned").notNull().default(0),
  runsInvoked: integer("runs_invoked").notNull().default(0),
  runsSkippedIdempotent: integer("runs_skipped_idempotent").notNull().default(0),
  runsFailed: integer("runs_failed").notNull().default(0),
  reanchorsWritten: integer("reanchors_written").notNull().default(0),
  missedWindowsDetected: integer("missed_windows_detected").notNull().default(0),
  deadCyclesDetected: integer("dead_cycles_detected").notNull().default(0),
  notes: jsonb("notes").notNull().default(sql`'[]'::jsonb`),
});
export type ContinuityTick = typeof continuityTicks.$inferSelect;
export type InsertContinuityTick = typeof continuityTicks.$inferInsert;

// Seal #14 / Track #2 — Continuity Supervision Layer.
//
// continuity_window_claims: DB-level idempotency lock per
// (campaign_id, plan_id, window_index). Replaces the single-process
// inFlightTick Map with a multi-replica-safe claim handshake. INSERT
// ON CONFLICT DO NOTHING is the lock acquire; DELETE on failed/partial
// boss_run is the retry hook (preserves INVARIANT-RETRY: failed runs
// MUST never be suppressed). UPDATE to status='completed' on success
// is the idempotency sentinel.
export const continuityWindowClaims = pgTable("continuity_window_claims", {
  campaignId: varchar("campaign_id").notNull(),
  planId: varchar("plan_id").notNull(),
  windowIndex: integer("window_index").notNull(),
  accountId: varchar("account_id").notNull(),
  claimedBy: varchar("claimed_by").notNull(),
  claimedAt: timestamp("claimed_at").notNull().defaultNow(),
  status: varchar("status").notNull().default("in_progress"),
  outcome: varchar("outcome"),
  outcomeAt: timestamp("outcome_at"),
  bossRunId: varchar("boss_run_id"),
}, (t) => ({
  pk: primaryKey({ columns: [t.campaignId, t.planId, t.windowIndex] }),
}));
export type ContinuityWindowClaim = typeof continuityWindowClaims.$inferSelect;
export type InsertContinuityWindowClaim = typeof continuityWindowClaims.$inferInsert;

// system_notices: Operations Guardian (Task #52 follow-up) — single
// source of truth for "what should the operator/user see right now?"
// Written by the Guardian Interpreter (server/operations-guardian/
// interpreter.ts) which runs as a step inside the existing Continuity
// Supervisor tick. NOT a per-event log — one row per (correlationKey,
// audience) until resolved. The unique partial index below collapses
// repeat observations into lastSeenAt bumps; resolution sets
// resolved_at and frees the slot for the next occurrence.
//
// Audience is set ONCE AT WRITE TIME and never recomputed. It is the
// firewall that prevents internal vocabulary (stuck claims, watchdog
// zombies, retry loops) from leaking into customer-visible surfaces.
// audience='user' rows MUST come from the USER_COPY firewall in
// server/operations-guardian/types.ts.
//
// During the observe-only phase (Steps 1–7 of the Guardian rollout)
// the interpreter only writes audience='operator' rows. audience='user'
// stays empty until copy review unlocks each category individually.
export const systemNotices = pgTable("system_notices", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  category: varchar("category").notNull(),
  severity: varchar("severity").notNull(),
  audience: varchar("audience").notNull(),
  correlationKey: varchar("correlation_key").notNull(),
  accountId: varchar("account_id"),
  campaignId: varchar("campaign_id"),
  copyKey: varchar("copy_key").notNull(),
  copyVars: jsonb("copy_vars"),
  detail: jsonb("detail"),
  firstSeenAt: timestamp("first_seen_at").notNull().defaultNow(),
  lastSeenAt: timestamp("last_seen_at").notNull().defaultNow(),
  resolvedAt: timestamp("resolved_at"),
  suppressedUntil: timestamp("suppressed_until"),
  recoveryAttempted: boolean("recovery_attempted").notNull().default(false),
  recoveryOutcome: varchar("recovery_outcome"),
  observationCount: integer("observation_count").notNull().default(1),
}, (t) => ({
  // Partial unique index — at most ONE open notice per (correlationKey,
  // audience). Re-emitting bumps lastSeenAt + observationCount via
  // ON CONFLICT DO UPDATE; never inserts a duplicate.
  openCorrelationUnique: uniqueIndex("system_notices_open_correlation_unique")
    .on(t.correlationKey, t.audience)
    .where(sql`resolved_at IS NULL`),
}));
export type SystemNotice = typeof systemNotices.$inferSelect;
export type InsertSystemNotice = typeof systemNotices.$inferInsert;

// chain_registry_state: observability state for the 10-chain operational
// registry. Updated every supervisor tick (~5min). last_state ∈
// {HEALTHY, DEGRADED, DEAD, UNKNOWN}; UNKNOWN means
// introspection_available=false (no data-source query wired yet — these
// chains will be promoted in Track #3 silent-degradation sweep).
export const chainRegistryState = pgTable("chain_registry_state", {
  chainId: varchar("chain_id").primaryKey(),
  expectedIntervalMs: bigint("expected_interval_ms", { mode: "number" }).notNull(),
  lastObservedRunAt: timestamp("last_observed_run_at"),
  lastObservedLagMs: bigint("last_observed_lag_ms", { mode: "number" }),
  lastState: varchar("last_state").notNull().default("UNKNOWN"),
  lastStateChangedAt: timestamp("last_state_changed_at").notNull().defaultNow(),
  introspectionAvailable: boolean("introspection_available").notNull().default(true),
  notes: jsonb("notes").notNull().default(sql`'{}'::jsonb`),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});
export type ChainRegistryStateRow = typeof chainRegistryState.$inferSelect;
export type InsertChainRegistryState = typeof chainRegistryState.$inferInsert;

// continuity_supervisor_ticks: paper trail for the continuity supervisor
// itself. A missing row for >2× supervisor interval is the operator-
// visible signal that the supervisor has stalled (the watcher of the
// watchers).
export const continuitySupervisorTicks = pgTable("continuity_supervisor_ticks", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  tickAt: timestamp("tick_at").notNull().defaultNow(),
  durationMs: integer("duration_ms").notNull().default(0),
  schedulerHeartbeatAgeMs: bigint("scheduler_heartbeat_age_ms", { mode: "number" }),
  schedulerState: varchar("scheduler_state").notNull().default("UNKNOWN"),
  chainsChecked: integer("chains_checked").notNull().default(0),
  chainsHealthy: integer("chains_healthy").notNull().default(0),
  chainsDegraded: integer("chains_degraded").notNull().default(0),
  chainsDead: integer("chains_dead").notNull().default(0),
  chainsUnknown: integer("chains_unknown").notNull().default(0),
  details: jsonb("details").notNull().default(sql`'[]'::jsonb`),
});
export type ContinuitySupervisorTick = typeof continuitySupervisorTicks.$inferSelect;
export type InsertContinuitySupervisorTick = typeof continuitySupervisorTicks.$inferInsert;

// F6.8 — orphan-observation tracking. (table_name, snapshot_id) PK with
// first_observed_at gates orphan deletion to ORPHAN_GRACE_DAYS after the
// first time this worker saw the snapshot in an orphaned state.
export const snapshotOrphanObserved = pgTable("snapshot_orphan_observed", {
  tableName: varchar("table_name").notNull(),
  snapshotId: varchar("snapshot_id").notNull(),
  campaignId: varchar("campaign_id").notNull(),
  firstObservedAt: timestamp("first_observed_at", { withTimezone: true }).notNull().defaultNow(),
});

// Seal #11 / Task #29 / F6.1
// ai_token_budget: per-(jobId, provider) persistence of the MI v3 token-budget
// projection. Engine + fetch-orchestrator persist on first compute and read
// through on subsequent calls so a restart after crash gets the SAME
// projection (and therefore the same selectedMode) instead of recomputing
// under different sample counts.
export const aiTokenBudget = pgTable("ai_token_budget", {
  jobId: varchar("job_id").notNull(),
  provider: varchar("provider").notNull(),
  projectedTokens: integer("projected_tokens").notNull(),
  ceiling: integer("ceiling").notNull(),
  selectedMode: varchar("selected_mode").notNull(),
  downgradeReason: text("downgrade_reason"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
});

export const requiredWork = pgTable("required_work", {
  id: varchar("id")
    .primaryKey()
    .default(sql`gen_random_uuid()`),
  planId: varchar("plan_id").notNull(),
  campaignId: varchar("campaign_id").notNull(),
  accountId: varchar("account_id").notNull().default("default"),
  periodDays: integer("period_days").notNull().default(30),
  reelsPerWeek: integer("reels_per_week").default(0),
  postsPerWeek: integer("posts_per_week").default(0),
  storiesPerDay: integer("stories_per_day").default(0),
  carouselsPerWeek: integer("carousels_per_week").default(0),
  videosPerWeek: integer("videos_per_week").default(0),
  totalReels: integer("total_reels").default(0),
  totalPosts: integer("total_posts").default(0),
  totalStories: integer("total_stories").default(0),
  totalCarousels: integer("total_carousels").default(0),
  totalVideos: integer("total_videos").default(0),
  totalContentPieces: integer("total_content_pieces").default(0),
  generatedCount: integer("generated_count").default(0),
  readyCount: integer("ready_count").default(0),
  scheduledCount: integer("scheduled_count").default(0),
  publishedCount: integer("published_count").default(0),
  failedCount: integer("failed_count").default(0),
  branch: varchar("branch").notNull().default("POSTS"),
  storyItems: integer("story_items").default(0),
  postItems: integer("post_items").default(0),
  reelItems: integer("reel_items").default(0),
  explorationSlotsPerWeek: integer("exploration_slots_per_week").default(0),
  rootBundleId: varchar("root_bundle_id"),
  rootBundleVersion: integer("root_bundle_version"),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

export const calendarEntries = pgTable("calendar_entries", {
  id: varchar("id")
    .primaryKey()
    .default(sql`gen_random_uuid()`),
  planId: varchar("plan_id").notNull(),
  campaignId: varchar("campaign_id").notNull(),
  accountId: varchar("account_id").notNull().default("default"),
  contentType: text("content_type").notNull(),
  scheduledDate: text("scheduled_date").notNull(),
  scheduledTime: text("scheduled_time").notNull(),
  title: text("title"),
  caption: text("caption"),
  creativeBrief: text("creative_brief"),
  ctaCopy: text("cta_copy"),
  status: text("status").notNull().default("DRAFT"),
  studioItemId: varchar("studio_item_id"),
  aiGeneratedAt: timestamp("ai_generated_at"),
  errorReason: text("error_reason"),
  sourceLabel: text("source_label"),
  rootBundleId: varchar("root_bundle_id"),
  rootBundleVersion: integer("root_bundle_version"),
  sourceDecisionId: varchar("source_decision_id"),
  isExploration: boolean("is_exploration").default(false),
  explorationIntent: text("exploration_intent"),
  explorationHypothesis: text("exploration_hypothesis"),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

export const decisionAttributions = pgTable("decision_attributions", {
  id: varchar("id")
    .primaryKey()
    .default(sql`gen_random_uuid()`),
  calendarEntryId: varchar("calendar_entry_id").notNull(),
  decisionId: varchar("decision_id").notNull(),
  weight: doublePrecision("weight").notNull().default(1.0),
  relevanceScore: doublePrecision("relevance_score").default(0),
  attributionMethod: text("attribution_method").notNull().default("single"),
  matchReason: text("match_reason"),
  accountId: varchar("account_id").notNull().default("default"),
  campaignId: varchar("campaign_id"),
  createdAt: timestamp("created_at").defaultNow(),
});

export const studioItems = pgTable("studio_items", {
  id: varchar("id")
    .primaryKey()
    .default(sql`gen_random_uuid()`),
  planId: varchar("plan_id"),
  campaignId: varchar("campaign_id"),
  calendarEntryId: varchar("calendar_entry_id").unique(),
  accountId: varchar("account_id").notNull().default("default"),
  contentType: text("content_type").notNull(),
  title: text("title"),
  caption: text("caption"),
  creativeBrief: text("creative_brief"),
  ctaCopy: text("cta_copy"),
  mediaUrl: text("media_url"),
  thumbnailUrl: text("thumbnail_url"),
  status: text("status").notNull().default("DRAFT"),
  errorReason: text("error_reason"),
  sourcePostId: varchar("source_post_id"),
  generationId: varchar("generation_id").unique(),
  origin: text("origin").default("MANUAL"),
  engineName: text("engine_name"),
  analysisStatus: text("analysis_status").default("NONE"),
  hook: text("hook"),
  goal: text("goal"),
  keywords: text("keywords"),
  contentAngle: text("content_angle"),
  suggestedCta: text("suggested_cta"),
  suggestedCaption: text("suggested_caption"),
  analysisError: text("analysis_error"),
  publishedAt: timestamp("published_at"),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

export type StrategicBlueprint = typeof strategicBlueprints.$inferSelect;
export type BlueprintCompetitor = typeof blueprintCompetitors.$inferSelect;
export type BlueprintVersion = typeof blueprintVersions.$inferSelect;
export type StrategicAuditLog = typeof strategicAuditLogs.$inferSelect;
export type ExtractionMetric = typeof extractionMetrics.$inferSelect;
export type DominanceAnalysis = typeof dominanceAnalyses.$inferSelect;
export type DominanceModification = typeof dominanceModifications.$inferSelect;
export type StrategicPlan = typeof strategicPlans.$inferSelect;
export type PlanApproval = typeof planApprovals.$inferSelect;
export type RequiredWork = typeof requiredWork.$inferSelect;
export type CalendarEntry = typeof calendarEntries.$inferSelect;
export type StudioItem = typeof studioItems.$inferSelect;

export const businessDataLayer = pgTable("business_data_layer", {
  id: varchar("id")
    .primaryKey()
    .default(sql`gen_random_uuid()`),
  campaignId: varchar("campaign_id").notNull(),
  accountId: varchar("account_id").notNull().default("default"),
  businessLocation: text("business_location").notNull(),
  businessType: text("business_type").notNull(),
  coreOffer: text("core_offer").notNull(),
  priceRange: text("price_range").notNull(),
  targetAudienceAge: text("target_audience_age").notNull(),
  targetAudienceSegment: text("target_audience_segment").notNull(),
  monthlyBudget: text("monthly_budget").notNull(),
  funnelObjective: text("funnel_objective").notNull(),
  primaryConversionChannel: text("primary_conversion_channel").notNull(),
  productCategory: text("product_category"),
  coreProblemSolved: text("core_problem_solved"),
  uniqueMechanism: text("unique_mechanism"),
  strategicAdvantage: text("strategic_advantage"),
  targetDecisionMaker: text("target_decision_maker"),
  goalTarget: text("goal_target").default(""),
  goalTimeline: text("goal_timeline").default(""),
  goalDescription: text("goal_description").default(""),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

export type BusinessDataLayer = typeof businessDataLayer.$inferSelect;

export const aiUsageLog = pgTable("ai_usage_log", {
  id: varchar("id")
    .primaryKey()
    .default(sql`gen_random_uuid()`),
  accountId: varchar("account_id").notNull().default("default"),
  endpoint: text("endpoint").notNull(),
  model: text("model").notNull(),
  maxTokens: integer("max_tokens").notNull(),
  estimatedTokens: integer("estimated_tokens").default(0),
  success: boolean("success").default(true),
  durationMs: integer("duration_ms").default(0),
  createdAt: timestamp("created_at").defaultNow(),
});

export type AIUsageLog = typeof aiUsageLog.$inferSelect;

export const planDocuments = pgTable("plan_documents", {
  id: varchar("id")
    .primaryKey()
    .default(sql`gen_random_uuid()`),
  planId: varchar("plan_id").notNull(),
  blueprintId: varchar("blueprint_id").notNull().default(""),
  campaignId: varchar("campaign_id").notNull(),
  accountId: varchar("account_id").notNull().default("default"),
  version: integer("version").notNull().default(1),
  fileName: text("file_name").notNull(),
  content: text("content").notNull(),
  contentJson: text("content_json"),
  contentMarkdown: text("content_markdown"),
  isFallback: boolean("is_fallback").notNull().default(false),
  format: text("format").notNull().default("markdown"),
  createdAt: timestamp("created_at").defaultNow(),
});

export type PlanDocument = typeof planDocuments.$inferSelect;

export const uiStateStore = pgTable("ui_state_store", {
  id: integer("id").primaryKey().generatedAlwaysAsIdentity(),
  accountId: varchar("account_id", { length: 255 }).notNull(),
  campaignId: varchar("campaign_id", { length: 255 }).notNull(),
  moduleKey: varchar("module_key", { length: 100 }).notNull(),
  stateData: text("state_data").notNull(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export type UIStateStore = typeof uiStateStore.$inferSelect;

export const manualCampaignMetrics = pgTable("manual_campaign_metrics", {
  id: integer("id").primaryKey().generatedAlwaysAsIdentity(),
  accountId: varchar("account_id", { length: 255 }).notNull().default("default"),
  campaignId: varchar("campaign_id", { length: 255 }).notNull(),
  spend: doublePrecision("spend").notNull().default(0),
  revenue: doublePrecision("revenue").notNull().default(0),
  leads: integer("leads").notNull().default(0),
  conversions: integer("conversions").notNull().default(0),
  impressions: integer("impressions").notNull().default(0),
  clicks: integer("clicks").notNull().default(0),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
  createdAt: timestamp("created_at").defaultNow(),
});

export type ManualCampaignMetrics = typeof manualCampaignMetrics.$inferSelect;

export const manualRetentionMetrics = pgTable("manual_retention_metrics", {
  id: integer("id").primaryKey().generatedAlwaysAsIdentity(),
  accountId: varchar("account_id", { length: 255 }).notNull().default("default"),
  campaignId: varchar("campaign_id", { length: 255 }).notNull(),
  totalCustomers: integer("total_customers"),
  totalPurchases: integer("total_purchases"),
  returningCustomers: integer("returning_customers"),
  averageOrderValue: doublePrecision("average_order_value"),
  refundCount: integer("refund_count"),
  monthlyCustomers: integer("monthly_customers"),
  dataWindowDays: integer("data_window_days").default(30),
  repeatPurchaseRate: doublePrecision("repeat_purchase_rate"),
  customerLifespan: doublePrecision("customer_lifespan"),
  refundRate: doublePrecision("refund_rate"),
  purchaseFrequency: doublePrecision("purchase_frequency"),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
  createdAt: timestamp("created_at").defaultNow(),
});

export type ManualRetentionMetrics = typeof manualRetentionMetrics.$inferSelect;

export const iterationGateInputs = pgTable("iteration_gate_inputs", {
  id: integer("id").primaryKey().generatedAlwaysAsIdentity(),
  accountId: varchar("account_id", { length: 255 }).notNull().default("default"),
  campaignId: varchar("campaign_id", { length: 255 }).notNull(),
  hasExistingAsset: boolean("has_existing_asset").notNull().default(false),
  assetDescription: text("asset_description"),
  primaryKpi: varchar("primary_kpi", { length: 100 }),
  dataWindowDays: integer("data_window_days"),
  spend: doublePrecision("spend"),
  impressions: integer("impressions"),
  clicks: integer("clicks"),
  leads: integer("leads"),
  purchases: integer("purchases"),
  revenue: doublePrecision("revenue"),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
  createdAt: timestamp("created_at").defaultNow(),
});

export type IterationGateInputs = typeof iterationGateInputs.$inferSelect;

export const retentionGateInputs = pgTable("retention_gate_inputs", {
  id: integer("id").primaryKey().generatedAlwaysAsIdentity(),
  accountId: varchar("account_id", { length: 255 }).notNull().default("default"),
  campaignId: varchar("campaign_id", { length: 255 }).notNull(),
  hasExistingCustomers: boolean("has_existing_customers").notNull().default(false),
  retentionGoal: varchar("retention_goal", { length: 100 }),
  businessModel: varchar("business_model", { length: 100 }),
  reachableAudience: text("reachable_audience"),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
  createdAt: timestamp("created_at").defaultNow(),
});

export type RetentionGateInputs = typeof retentionGateInputs.$inferSelect;

export const orchestratorJobs = pgTable("orchestrator_jobs", {
  id: varchar("id")
    .primaryKey()
    .default(sql`gen_random_uuid()`),
  blueprintId: varchar("blueprint_id").notNull(),
  accountId: varchar("account_id").notNull().default("default"),
  campaignId: varchar("campaign_id").notNull(),
  status: text("status").notNull().default("RUNNING"),
  sectionStatuses: text("section_statuses"),
  planJson: text("plan_json"),
  planId: varchar("plan_id"),
  fallback: boolean("fallback").default(false),
  fallbackReason: text("fallback_reason"),
  error: text("error"),
  errorCode: text("error_code"),
  stageTimes: text("stage_times"),
  durationMs: integer("duration_ms"),
  pausedContext: text("paused_context"),
  pausedEngine: varchar("paused_engine", { length: 50 }),
  needsInputFields: text("needs_input_fields"),
  createdAt: timestamp("created_at").defaultNow(),
  completedAt: timestamp("completed_at"),
});

export type OrchestratorJob = typeof orchestratorJobs.$inferSelect;

// =============================================
// MARKET INTELLIGENCE V3
// =============================================
export const miSnapshots = pgTable("mi_snapshots", {
  id: varchar("id")
    .primaryKey()
    .default(sql`gen_random_uuid()`),
  accountId: varchar("account_id").notNull().default("default"),
  campaignId: varchar("campaign_id").notNull(),
  jobId: varchar("job_id").notNull(),
  competitorHash: varchar("competitor_hash", { length: 16 }),
  version: integer("version").notNull().default(1),
  competitorData: text("competitor_data"),
  signalData: text("signal_data"),
  intentData: text("intent_data"),
  trajectoryData: text("trajectory_data"),
  dominanceData: text("dominance_data"),
  confidenceData: text("confidence_data"),
  marketState: text("market_state"),
  executionMode: text("execution_mode").notNull().default("FULL"),
  telemetry: text("telemetry"),
  narrativeSynthesis: text("narrative_synthesis"),
  marketDiagnosis: text("market_diagnosis"),
  threatSignals: text("threat_signals"),
  opportunitySignals: text("opportunity_signals"),
  missingSignalFlags: text("missing_signal_flags"),
  volatilityIndex: doublePrecision("volatility_index").default(0),
  dataFreshnessDays: doublePrecision("data_freshness_days").default(0),
  overallConfidence: doublePrecision("overall_confidence").default(0),
  confidenceLevel: text("confidence_level").default("INSUFFICIENT"),
  analysisVersion: integer("analysis_version").default(0),
  snapshotSource: text("snapshot_source").default("FRESH_DATA"),
  fetchExecuted: boolean("fetch_executed").default(true),
  status: text("status").notNull().default("PENDING"),
  similarityData: text("similarity_data"),
  confirmedRuns: integer("confirmed_runs").default(0),
  previousDirection: text("previous_direction"),
  directionLockedUntil: timestamp("direction_locked_until"),
  goalMode: text("goal_mode").default("STRATEGY_MODE"),
  contentDnaData: text("content_dna_data"),
  deltaReport: text("delta_report"),
  diagnosticsData: text("diagnostics_data"),
  dataStatus: text("data_status").default("LIVE"),
  objectionMapData: text("objection_map_data"),
  signalLineage: text("signal_lineage"),
  multiSourceSignals: text("multi_source_signals"),
  sourceAvailability: text("source_availability"),
  createdAt: timestamp("created_at").defaultNow(),
  expiresAt: timestamp("expires_at"),
});

export type MiSnapshot = typeof miSnapshots.$inferSelect;

export const miSignalLogs = pgTable("mi_signal_logs", {
  id: varchar("id")
    .primaryKey()
    .default(sql`gen_random_uuid()`),
  snapshotId: varchar("snapshot_id").notNull(),
  competitorId: varchar("competitor_id").notNull(),
  signals: text("signals"),
  signalCoverageScore: doublePrecision("signal_coverage_score").default(0),
  sourceReliabilityScore: doublePrecision("source_reliability_score").default(0),
  sampleSize: integer("sample_size").default(0),
  timeWindowDays: integer("time_window_days").default(0),
  varianceScore: doublePrecision("variance_score").default(0),
  dominantSourceRatio: doublePrecision("dominant_source_ratio").default(0),
  missingFields: text("missing_fields"),
  createdAt: timestamp("created_at").defaultNow(),
});

export type MiSignalLog = typeof miSignalLogs.$inferSelect;

export const miRefreshSchedule = pgTable("mi_refresh_schedule", {
  id: varchar("id")
    .primaryKey()
    .default(sql`gen_random_uuid()`),
  accountId: varchar("account_id").notNull().default("default"),
  campaignId: varchar("campaign_id").notNull(),
  competitorId: varchar("competitor_id").notNull(),
  nextRefreshAt: timestamp("next_refresh_at"),
  intervalDays: integer("interval_days").notNull().default(7),
  volatilityIndex: doublePrecision("volatility_index").default(0),
  lastRefreshAt: timestamp("last_refresh_at"),
  refreshReason: text("refresh_reason"),
  createdAt: timestamp("created_at").defaultNow(),
});

export type MiRefreshSchedule = typeof miRefreshSchedule.$inferSelect;

export const miTelemetry = pgTable("mi_telemetry", {
  id: varchar("id")
    .primaryKey()
    .default(sql`gen_random_uuid()`),
  snapshotId: varchar("snapshot_id").notNull(),
  executionMode: text("execution_mode").notNull(),
  projectedTokens: integer("projected_tokens").default(0),
  actualTokensUsed: integer("actual_tokens_used").default(0),
  competitorsCount: integer("competitors_count").default(0),
  commentSampleSize: integer("comment_sample_size").default(0),
  postSampleSize: integer("post_sample_size").default(0),
  downgradeReason: text("downgrade_reason"),
  postsProcessed: integer("posts_processed").default(0),
  commentsProcessed: integer("comments_processed").default(0),
  refreshReason: text("refresh_reason"),
  createdAt: timestamp("created_at").defaultNow(),
});

export type MiTelemetry = typeof miTelemetry.$inferSelect;

export const ciCompetitorPosts = pgTable("ci_competitor_posts", {
  id: varchar("id")
    .primaryKey()
    .default(sql`gen_random_uuid()`),
  competitorId: varchar("competitor_id").notNull(),
  accountId: varchar("account_id").notNull().default("default"),
  postId: text("post_id").notNull(),
  permalink: text("permalink"),
  mediaType: text("media_type"),
  caption: text("caption"),
  likes: integer("likes"),
  comments: integer("comments"),
  views: integer("views"),
  hashtags: text("hashtags"),
  timestamp: timestamp("timestamp"),
  hasCTA: boolean("has_cta").default(false),
  ctaType: text("cta_type"),
  hasOffer: boolean("has_offer").default(false),
  shortcode: text("shortcode"),
  batchId: varchar("batch_id"),
  platform: text("platform").notNull().default("instagram"),
  hookText: text("hook_text"),
  transcript: text("transcript"),
  hookSource: text("hook_source"),
  createdAt: timestamp("created_at").defaultNow(),
}, (table) => ({
  competitorPostUnique: uniqueIndex("idx_ci_posts_competitor_postid").on(table.competitorId, table.postId),
  competitorShortcodeUnique: uniqueIndex("idx_ci_posts_competitor_shortcode").on(table.competitorId, table.shortcode).where(sql`${table.shortcode} IS NOT NULL`),
}));

export type CiCompetitorPost = typeof ciCompetitorPosts.$inferSelect;

export const ciCompetitorComments = pgTable("ci_competitor_comments", {
  id: varchar("id")
    .primaryKey()
    .default(sql`gen_random_uuid()`),
  competitorId: varchar("competitor_id").notNull(),
  accountId: varchar("account_id").notNull().default("default"),
  postId: text("post_id").notNull(),
  commentId: varchar("comment_id", { length: 128 }),
  username: varchar("username", { length: 255 }),
  commentText: text("comment_text"),
  sentiment: doublePrecision("sentiment"),
  timestamp: timestamp("timestamp"),
  batchId: varchar("batch_id"),
  isSynthetic: boolean("is_synthetic").notNull().default(false),
  source: varchar("source", { length: 64 }).default("scraped"),
  createdAt: timestamp("created_at").defaultNow(),
});

export type CiCompetitorComment = typeof ciCompetitorComments.$inferSelect;

export const ciCompetitorReviews = pgTable("ci_competitor_reviews", {
  id: varchar("id")
    .primaryKey()
    .default(sql`gen_random_uuid()`),
  competitorId: varchar("competitor_id").notNull(),
  accountId: varchar("account_id").notNull().default("default"),
  campaignId: varchar("campaign_id").notNull(),
  reviewId: varchar("review_id", { length: 256 }),
  reviewText: text("review_text").notNull(),
  rating: integer("rating"),
  platform: text("platform").notNull().default("google"),
  reviewDate: timestamp("review_date"),
  isSynthetic: boolean("is_synthetic").notNull().default(false),
  // sha256(name).slice(0,12). PII-safe alternative to
  // persisting raw author names (which we never stored in production, but the
  // extractor produced them). Used for cross-review dedup and reviewer-pattern
  // analysis without revealing identity.
  authorHash: varchar("author_hash", { length: 12 }),
  scrapedAt: timestamp("scraped_at").defaultNow(),
  createdAt: timestamp("created_at").defaultNow(),
});

export type CiCompetitorReview = typeof ciCompetitorReviews.$inferSelect;

export const ciCompetitorMetricsSnapshot = pgTable("ci_competitor_metrics_snapshot", {
  id: varchar("id")
    .primaryKey()
    .default(sql`gen_random_uuid()`),
  competitorId: varchar("competitor_id").notNull(),
  accountId: varchar("account_id").notNull().default("default"),
  postsCollected: integer("posts_collected").default(0),
  commentsCollected: integer("comments_collected").default(0),
  ctaCoverage: doublePrecision("cta_coverage").default(0),
  ctaTypes: text("cta_types"),
  followers: integer("followers"),
  engagementRate: doublePrecision("engagement_rate"),
  postingFrequency: doublePrecision("posting_frequency"),
  contentMix: text("content_mix"),
  bioText: text("bio_text"),
  linkInBio: text("link_in_bio"),
  websiteUrl: text("website_url"),
  dataFreshnessDays: integer("data_freshness_days").default(0),
  lastFetchAt: timestamp("last_fetch_at"),
  fetchMethod: text("fetch_method"),
  fetchStatus: text("fetch_status").default("PENDING"),
  batchId: varchar("batch_id"),
  createdAt: timestamp("created_at").defaultNow(),
});

export type CiCompetitorMetricsSnapshot = typeof ciCompetitorMetricsSnapshot.$inferSelect;

export const miFetchJobs = pgTable("mi_fetch_jobs", {
  id: varchar("id")
    .primaryKey()
    .default(sql`gen_random_uuid()`),
  accountId: varchar("account_id").notNull(),
  campaignId: varchar("campaign_id").notNull(),
  competitorHash: varchar("competitor_hash"),
  status: text("status").notNull().default("PENDING"),
  stageStatuses: text("stage_statuses"),
  fetchLimitReasons: text("fetch_limit_reasons"),
  totalPostsFetched: integer("total_posts_fetched").default(0),
  totalCommentsFetched: integer("total_comments_fetched").default(0),
  competitorCount: integer("competitor_count").default(0),
  snapshotIdCreated: varchar("snapshot_id_created"),
  stopReason: text("stop_reason"),
  error: text("error"),
  retryCount: integer("retry_count").default(0),
  durationMs: integer("duration_ms"),
  collectionMode: text("collection_mode").default("FAST_PASS"),
  dataStatus: text("data_status").default("LIVE"),
  priority: integer("priority").default(1),
  createdAt: timestamp("created_at").defaultNow(),
  completedAt: timestamp("completed_at"),
});

export type MiFetchJob = typeof miFetchJobs.$inferSelect;

export const audienceSnapshots = pgTable("audience_snapshots", {
  id: varchar("id")
    .primaryKey()
    .default(sql`gen_random_uuid()`),
  accountId: varchar("account_id").notNull().default("default"),
  campaignId: varchar("campaign_id").notNull(),
  jobId: varchar("job_id").notNull(),
  miSnapshotId: varchar("mi_snapshot_id"),
  engineVersion: integer("engine_version").notNull().default(3),
  languageSignals: text("language_signals"),
  audiencePains: text("audience_pains"),
  desireMap: text("desire_map"),
  objectionMap: text("objection_map"),
  transformationMap: text("transformation_map"),
  emotionalDrivers: text("emotional_drivers"),
  audienceSegments: text("audience_segments"),
  segmentDensity: text("segment_density"),
  awarenessLevel: text("awareness_level"),
  maturityIndex: text("maturity_index"),
  audienceIntentDistribution: text("audience_intent_distribution"),
  adsTargetingHints: text("ads_targeting_hints"),
  inputSummary: text("input_summary"),
  signalLineage: text("signal_lineage"),
  structuredSignals: text("structured_signals"),
  executionTimeMs: integer("execution_time_ms"),
  inputHash: text("input_hash"),
  createdAt: timestamp("created_at").defaultNow(),
});

export type AudienceSnapshot = typeof audienceSnapshots.$inferSelect;

export const positioningSnapshots = pgTable("positioning_snapshots", {
  id: varchar("id")
    .primaryKey()
    .default(sql`gen_random_uuid()`),
  accountId: varchar("account_id").notNull().default("default"),
  campaignId: varchar("campaign_id").notNull(),
  jobId: varchar("job_id").notNull(),
  miSnapshotId: varchar("mi_snapshot_id").notNull(),
  audienceSnapshotId: varchar("audience_snapshot_id").notNull(),
  engineVersion: integer("engine_version").notNull().default(3),
  status: text("status").notNull().default("COMPLETE"),
  statusMessage: text("status_message"),
  territory: text("territory"),
  enemyDefinition: text("enemy_definition"),
  contrastAxis: text("contrast_axis"),
  narrativeDirection: text("narrative_direction"),
  differentiationVector: text("differentiation_vector"),
  proofSignals: text("proof_signals"),
  strategyCards: text("strategy_cards"),
  territories: text("territories"),
  stabilityResult: text("stability_result"),
  marketPowerAnalysis: text("market_power_analysis"),
  opportunityGaps: text("opportunity_gaps"),
  narrativeSaturation: text("narrative_saturation"),
  segmentPriority: text("segment_priority"),
  inputSummary: text("input_summary"),
  confidenceScore: doublePrecision("confidence_score"),
  signalTraceability: text("signal_traceability"),
  executionTimeMs: integer("execution_time_ms"),
  inputHash: text("input_hash"),
  createdAt: timestamp("created_at").defaultNow(),
});

export type PositioningSnapshot = typeof positioningSnapshots.$inferSelect;

export const differentiationSnapshots = pgTable("differentiation_snapshots", {
  id: varchar("id")
    .primaryKey()
    .default(sql`gen_random_uuid()`),
  accountId: varchar("account_id").notNull().default("default"),
  campaignId: varchar("campaign_id").notNull(),
  jobId: varchar("job_id").notNull(),
  miSnapshotId: varchar("mi_snapshot_id").notNull(),
  audienceSnapshotId: varchar("audience_snapshot_id").notNull(),
  positioningSnapshotId: varchar("positioning_snapshot_id").notNull(),
  engineVersion: integer("engine_version").notNull().default(3),
  status: text("status").notNull().default("COMPLETE"),
  statusMessage: text("status_message"),
  differentiationPillars: text("differentiation_pillars"),
  proofArchitecture: text("proof_architecture"),
  claimStructures: text("claim_structures"),
  authorityMode: text("authority_mode"),
  mechanismFraming: text("mechanism_framing"),
  mechanismCore: text("mechanism_core"),
  trustPriorityMap: text("trust_priority_map"),
  claimScores: text("claim_scores"),
  collisionDiagnostics: text("collision_diagnostics"),
  stabilityResult: text("stability_result"),
  confidenceScore: doublePrecision("confidence_score"),
  executionTimeMs: integer("execution_time_ms"),
  inputHash: text("input_hash"),
  createdAt: timestamp("created_at").defaultNow(),
});

export type DifferentiationSnapshot = typeof differentiationSnapshots.$inferSelect;

export const mechanismSnapshots = pgTable("mechanism_snapshots", {
  id: varchar("id")
    .primaryKey()
    .default(sql`gen_random_uuid()`),
  accountId: varchar("account_id").notNull().default("default"),
  campaignId: varchar("campaign_id").notNull(),
  jobId: varchar("job_id").notNull(),
  positioningSnapshotId: varchar("positioning_snapshot_id").notNull(),
  differentiationSnapshotId: varchar("differentiation_snapshot_id").notNull(),
  engineVersion: integer("engine_version").notNull().default(1),
  status: text("status").notNull().default("COMPLETE"),
  statusMessage: text("status_message"),
  primaryMechanism: text("primary_mechanism"),
  alternativeMechanism: text("alternative_mechanism"),
  axisConsistency: text("axis_consistency"),
  confidenceScore: doublePrecision("confidence_score"),
  executionTimeMs: integer("execution_time_ms"),
  inputHash: text("input_hash"),
  createdAt: timestamp("created_at").defaultNow(),
});

export type MechanismSnapshot = typeof mechanismSnapshots.$inferSelect;

export const offerSnapshots = pgTable("offer_snapshots", {
  id: varchar("id")
    .primaryKey()
    .default(sql`gen_random_uuid()`),
  accountId: varchar("account_id").notNull().default("default"),
  campaignId: varchar("campaign_id").notNull(),
  jobId: varchar("job_id").notNull(),
  miSnapshotId: varchar("mi_snapshot_id").notNull(),
  audienceSnapshotId: varchar("audience_snapshot_id").notNull(),
  positioningSnapshotId: varchar("positioning_snapshot_id").notNull(),
  differentiationSnapshotId: varchar("differentiation_snapshot_id").notNull(),
  mechanismSnapshotId: varchar("mechanism_snapshot_id"),
  engineVersion: integer("engine_version").notNull().default(1),
  status: text("status").notNull().default("COMPLETE"),
  statusMessage: text("status_message"),
  primaryOffer: text("primary_offer"),
  alternativeOffer: text("alternative_offer"),
  rejectedOffer: text("rejected_offer"),
  offerStrengthScore: doublePrecision("offer_strength_score"),
  positioningConsistency: text("positioning_consistency"),
  hookMechanismAlignment: text("hook_mechanism_alignment"),
  boundaryCheck: text("boundary_check"),
  confidenceScore: doublePrecision("confidence_score"),
  selectedOption: varchar("selected_option"),
  signalLineage: text("signal_lineage"),
  structuralWarnings: text("structural_warnings"),
  layerDiagnostics: text("layer_diagnostics"),
  strategyRootId: varchar("strategy_root_id"),
  executionTimeMs: integer("execution_time_ms"),
  inputHash: text("input_hash"),
  createdAt: timestamp("created_at").defaultNow(),
});

export type OfferSnapshot = typeof offerSnapshots.$inferSelect;

export const funnelSnapshots = pgTable("funnel_snapshots", {
  id: varchar("id")
    .primaryKey()
    .default(sql`gen_random_uuid()`),
  accountId: varchar("account_id").notNull().default("default"),
  campaignId: varchar("campaign_id").notNull(),
  jobId: varchar("job_id").notNull(),
  offerSnapshotId: varchar("offer_snapshot_id").notNull(),
  awarenessSnapshotId: varchar("awareness_snapshot_id"),
  miSnapshotId: varchar("mi_snapshot_id").notNull(),
  audienceSnapshotId: varchar("audience_snapshot_id").notNull(),
  positioningSnapshotId: varchar("positioning_snapshot_id").notNull(),
  differentiationSnapshotId: varchar("differentiation_snapshot_id").notNull(),
  engineVersion: integer("engine_version").notNull().default(1),
  status: text("status").notNull().default("COMPLETE"),
  statusMessage: text("status_message"),
  primaryFunnel: text("primary_funnel"),
  alternativeFunnel: text("alternative_funnel"),
  rejectedFunnel: text("rejected_funnel"),
  funnelStrengthScore: doublePrecision("funnel_strength_score"),
  trustPathAnalysis: text("trust_path_analysis"),
  proofPlacementLogic: text("proof_placement_logic"),
  frictionMap: text("friction_map"),
  boundaryCheck: text("boundary_check"),
  confidenceScore: doublePrecision("confidence_score"),
  selectedOption: varchar("selected_option"),
  strategyRootId: varchar("strategy_root_id"),
  executionTimeMs: integer("execution_time_ms"),
  layerDiagnostics: text("layer_diagnostics"),
  inputHash: text("input_hash"),
  createdAt: timestamp("created_at").defaultNow(),
});

export type FunnelSnapshot = typeof funnelSnapshots.$inferSelect;

export const integritySnapshots = pgTable("integrity_snapshots", {
  id: varchar("id")
    .primaryKey()
    .default(sql`gen_random_uuid()`),
  accountId: varchar("account_id").notNull().default("default"),
  campaignId: varchar("campaign_id").notNull(),
  jobId: varchar("job_id").notNull(),
  funnelSnapshotId: varchar("funnel_snapshot_id").notNull(),
  offerSnapshotId: varchar("offer_snapshot_id").notNull(),
  miSnapshotId: varchar("mi_snapshot_id").notNull(),
  audienceSnapshotId: varchar("audience_snapshot_id").notNull(),
  positioningSnapshotId: varchar("positioning_snapshot_id").notNull(),
  differentiationSnapshotId: varchar("differentiation_snapshot_id").notNull(),
  engineVersion: integer("engine_version").notNull().default(1),
  status: text("status").notNull().default("COMPLETE"),
  statusMessage: text("status_message"),
  overallIntegrityScore: doublePrecision("overall_integrity_score"),
  safeToExecute: boolean("safe_to_execute").default(false),
  layerResults: text("layer_results"),
  structuralWarnings: text("structural_warnings"),
  flaggedInconsistencies: text("flagged_inconsistencies"),
  boundaryCheck: text("boundary_check"),
  strategyRootId: varchar("strategy_root_id"),
  executionTimeMs: integer("execution_time_ms"),
  inputHash: text("input_hash"),
  createdAt: timestamp("created_at").defaultNow(),
});

export type IntegritySnapshot = typeof integritySnapshots.$inferSelect;

export const awarenessSnapshots = pgTable("awareness_snapshots", {
  id: varchar("id")
    .primaryKey()
    .default(sql`gen_random_uuid()`),
  accountId: varchar("account_id").notNull().default("default"),
  campaignId: varchar("campaign_id").notNull(),
  jobId: varchar("job_id").notNull(),
  integritySnapshotId: varchar("integrity_snapshot_id"),
  funnelSnapshotId: varchar("funnel_snapshot_id"),
  offerSnapshotId: varchar("offer_snapshot_id").notNull(),
  miSnapshotId: varchar("mi_snapshot_id").notNull(),
  audienceSnapshotId: varchar("audience_snapshot_id").notNull(),
  positioningSnapshotId: varchar("positioning_snapshot_id").notNull(),
  differentiationSnapshotId: varchar("differentiation_snapshot_id").notNull(),
  engineVersion: integer("engine_version").notNull().default(1),
  status: text("status").notNull().default("COMPLETE"),
  statusMessage: text("status_message"),
  primaryRoute: text("primary_route"),
  alternativeRoute: text("alternative_route"),
  rejectedRoute: text("rejected_route"),
  layerResults: text("layer_results"),
  structuralWarnings: text("structural_warnings"),
  boundaryCheck: text("boundary_check"),
  dataReliability: text("data_reliability"),
  // T008 [DEPRECATED 2026-05-03]: confidence_normalized — legacy boolean=false everywhere; engines no longer write to it.
  // Column kept in DB for backwards compat; safe to drop in a follow-up migration once no consumer remains.
  confidenceNormalized: boolean("confidence_normalized").default(false),
  awarenessStrengthScore: doublePrecision("awareness_strength_score"),
  signalLineage: text("signal_lineage"),
  executionTimeMs: integer("execution_time_ms"),
  inputHash: text("input_hash"),
  createdAt: timestamp("created_at").defaultNow(),
});

export type AwarenessSnapshot = typeof awarenessSnapshots.$inferSelect;

export const persuasionSnapshots = pgTable("persuasion_snapshots", {
  id: varchar("id")
    .primaryKey()
    .default(sql`gen_random_uuid()`),
  accountId: varchar("account_id").notNull().default("default"),
  campaignId: varchar("campaign_id").notNull(),
  jobId: varchar("job_id").notNull(),
  awarenessSnapshotId: varchar("awareness_snapshot_id").notNull(),
  integritySnapshotId: varchar("integrity_snapshot_id").notNull(),
  funnelSnapshotId: varchar("funnel_snapshot_id").notNull(),
  offerSnapshotId: varchar("offer_snapshot_id").notNull(),
  miSnapshotId: varchar("mi_snapshot_id").notNull(),
  audienceSnapshotId: varchar("audience_snapshot_id").notNull(),
  positioningSnapshotId: varchar("positioning_snapshot_id").notNull(),
  differentiationSnapshotId: varchar("differentiation_snapshot_id").notNull(),
  engineVersion: integer("engine_version").notNull().default(1),
  status: text("status").notNull().default("COMPLETE"),
  statusMessage: text("status_message"),
  primaryRoute: text("primary_route"),
  alternativeRoute: text("alternative_route"),
  rejectedRoute: text("rejected_route"),
  layerResults: text("layer_results"),
  structuralWarnings: text("structural_warnings"),
  boundaryCheck: text("boundary_check"),
  dataReliability: text("data_reliability"),
  // T008 [DEPRECATED 2026-05-03]: confidence_normalized — legacy boolean=false everywhere; engines no longer write to it.
  // Column kept in DB for backwards compat; safe to drop in a follow-up migration once no consumer remains.
  confidenceNormalized: boolean("confidence_normalized").default(false),
  persuasionStrengthScore: doublePrecision("persuasion_strength_score"),
  signalLineage: text("signal_lineage"),
  executionTimeMs: integer("execution_time_ms"),
  inputHash: text("input_hash"),
  createdAt: timestamp("created_at").defaultNow(),
});

export type PersuasionSnapshot = typeof persuasionSnapshots.$inferSelect;

export const strategyValidationSnapshots = pgTable("strategy_validation_snapshots", {
  id: varchar("id")
    .primaryKey()
    .default(sql`gen_random_uuid()`),
  accountId: varchar("account_id").notNull().default("default"),
  campaignId: varchar("campaign_id").notNull(),
  jobId: varchar("job_id").notNull(),
  persuasionSnapshotId: varchar("persuasion_snapshot_id"),
  engineVersion: integer("engine_version").notNull().default(1),
  status: text("status").notNull().default("COMPLETE"),
  statusMessage: text("status_message"),
  result: text("result"),
  layerResults: text("layer_results"),
  structuralWarnings: text("structural_warnings"),
  boundaryCheck: text("boundary_check"),
  dataReliability: text("data_reliability"),
  confidenceScore: doublePrecision("confidence_score"),
  executionTimeMs: integer("execution_time_ms"),
  inputHash: text("input_hash"),
  createdAt: timestamp("created_at").defaultNow(),
});

export type StrategyValidationSnapshot = typeof strategyValidationSnapshots.$inferSelect;

export const budgetGovernorSnapshots = pgTable("budget_governor_snapshots", {
  id: varchar("id")
    .primaryKey()
    .default(sql`gen_random_uuid()`),
  accountId: varchar("account_id").notNull().default("default"),
  campaignId: varchar("campaign_id").notNull(),
  jobId: varchar("job_id").notNull(),
  validationSnapshotId: varchar("validation_snapshot_id"),
  engineVersion: integer("engine_version").notNull().default(1),
  status: text("status").notNull().default("COMPLETE"),
  statusMessage: text("status_message"),
  result: text("result"),
  layerResults: text("layer_results"),
  structuralWarnings: text("structural_warnings"),
  boundaryCheck: text("boundary_check"),
  dataReliability: text("data_reliability"),
  confidenceScore: doublePrecision("confidence_score"),
  executionTimeMs: integer("execution_time_ms"),
  inputHash: text("input_hash"),
  createdAt: timestamp("created_at").defaultNow(),
});

export type BudgetGovernorSnapshot = typeof budgetGovernorSnapshots.$inferSelect;

export const channelSelectionSnapshots = pgTable("channel_selection_snapshots", {
  id: varchar("id")
    .primaryKey()
    .default(sql`gen_random_uuid()`),
  accountId: varchar("account_id").notNull().default("default"),
  campaignId: varchar("campaign_id").notNull(),
  jobId: varchar("job_id").notNull(),
  validationSnapshotId: varchar("validation_snapshot_id"),
  budgetSnapshotId: varchar("budget_snapshot_id"),
  engineVersion: integer("engine_version").notNull().default(1),
  status: text("status").notNull().default("COMPLETE"),
  statusMessage: text("status_message"),
  result: text("result"),
  layerResults: text("layer_results"),
  structuralWarnings: text("structural_warnings"),
  boundaryCheck: text("boundary_check"),
  dataReliability: text("data_reliability"),
  confidenceScore: doublePrecision("confidence_score"),
  executionTimeMs: integer("execution_time_ms"),
  inputHash: text("input_hash"),
  createdAt: timestamp("created_at").defaultNow(),
});

export type ChannelSelectionSnapshot = typeof channelSelectionSnapshots.$inferSelect;

export const iterationSnapshots = pgTable("iteration_snapshots", {
  id: varchar("id")
    .primaryKey()
    .default(sql`gen_random_uuid()`),
  accountId: varchar("account_id").notNull().default("default"),
  campaignId: varchar("campaign_id").notNull(),
  jobId: varchar("job_id").notNull(),
  engineVersion: integer("engine_version").notNull().default(1),
  status: text("status").notNull().default("COMPLETE"),
  statusMessage: text("status_message"),
  result: text("result"),
  layerResults: text("layer_results"),
  structuralWarnings: text("structural_warnings"),
  boundaryCheck: text("boundary_check"),
  dataReliability: text("data_reliability"),
  confidenceScore: doublePrecision("confidence_score"),
  executionTimeMs: integer("execution_time_ms"),
  inputHash: text("input_hash"),
  createdAt: timestamp("created_at").defaultNow(),
});

export type IterationSnapshot = typeof iterationSnapshots.$inferSelect;

export const retentionSnapshots = pgTable("retention_snapshots", {
  id: varchar("id")
    .primaryKey()
    .default(sql`gen_random_uuid()`),
  accountId: varchar("account_id").notNull().default("default"),
  campaignId: varchar("campaign_id").notNull(),
  jobId: varchar("job_id").notNull(),
  engineVersion: integer("engine_version").notNull().default(1),
  status: text("status").notNull().default("COMPLETE"),
  statusMessage: text("status_message"),
  result: text("result"),
  layerResults: text("layer_results"),
  structuralWarnings: text("structural_warnings"),
  boundaryCheck: text("boundary_check"),
  dataReliability: text("data_reliability"),
  confidenceScore: doublePrecision("confidence_score"),
  executionTimeMs: integer("execution_time_ms"),
  inputHash: text("input_hash"),
  createdAt: timestamp("created_at").defaultNow(),
});

export type RetentionSnapshot = typeof retentionSnapshots.$inferSelect;

export const snapshotArchive = pgTable("snapshot_archive", {
  id: varchar("id")
    .primaryKey()
    .default(sql`gen_random_uuid()`),
  originalId: varchar("original_id").notNull(),
  sourceTable: varchar("source_table").notNull(),
  accountId: varchar("account_id").notNull().default("default"),
  campaignId: varchar("campaign_id"),
  originalStatus: text("original_status").notNull(),
  engineVersion: integer("engine_version"),
  archiveReason: text("archive_reason").notNull(),
  snapshotData: text("snapshot_data"),
  originalCreatedAt: timestamp("original_created_at"),
  archivedAt: timestamp("archived_at").defaultNow(),
});

export type SnapshotArchive = typeof snapshotArchive.$inferSelect;

export const dataSourceTransitions = pgTable("data_source_transitions", {
  id: varchar("id")
    .primaryKey()
    .default(sql`gen_random_uuid()`),
  accountId: varchar("account_id").notNull().default("default"),
  campaignId: varchar("campaign_id").notNull(),
  previousMode: text("previous_mode").notNull(),
  newMode: text("new_mode").notNull(),
  transitionReason: text("transition_reason").notNull(),
  triggeredBy: text("triggered_by").notNull().default("adaptive_switch"),
  statisticalEvidence: text("statistical_evidence"),
  createdAt: timestamp("created_at").defaultNow(),
});

export type DataSourceTransition = typeof dataSourceTransitions.$inferSelect;

export const conversations = pgTable("conversations", {
  id: serial("id").primaryKey(),
  accountId: varchar("account_id").notNull().default("default"),
  title: text("title").notNull().default("New Chat"),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

export const messages = pgTable("messages", {
  id: serial("id").primaryKey(),
  conversationId: integer("conversation_id").notNull(),
  role: text("role").notNull(),
  content: text("content").notNull(),
  createdAt: timestamp("created_at").defaultNow(),
});

export const contentDna = pgTable("content_dna", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  campaignId: varchar("campaign_id").notNull(),
  accountId: varchar("account_id").notNull().default("default"),
  planId: varchar("plan_id"),
  messagingCore: text("messaging_core"),
  ctaDna: text("cta_dna"),
  hookDna: text("hook_dna"),
  narrativeDna: text("narrative_dna"),
  contentAngleDna: text("content_angle_dna"),
  visualDna: text("visual_dna"),
  formatDna: text("format_dna"),
  executionRules: text("execution_rules"),
  snapshot: text("snapshot"),
  contentInstructions: text("content_instructions"),
  status: text("status").notNull().default("active"),
  rootBundleId: varchar("root_bundle_id"),
  rootBundleVersion: integer("root_bundle_version"),
  generatedAt: timestamp("generated_at").defaultNow(),
  createdAt: timestamp("created_at").defaultNow(),
});

export type ContentDna = typeof contentDna.$inferSelect;

export const rootBundles = pgTable("root_bundles", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  campaignId: varchar("campaign_id").notNull(),
  accountId: varchar("account_id").notNull().default("default"),
  version: integer("version").notNull().default(1),
  businessRoots: text("business_roots"),
  funnelRoots: text("funnel_roots"),
  contentRoots: text("content_roots"),
  executionRoots: text("execution_roots"),
  mathRoots: text("math_roots"),
  strategyHash: varchar("strategy_hash"),
  sourceSnapshot: text("source_snapshot"),
  status: text("status").notNull().default("draft"),
  lockedAt: timestamp("locked_at"),
  staleAt: timestamp("stale_at"),
  staleReason: text("stale_reason"),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

export type RootBundle = typeof rootBundles.$inferSelect;

export const goalDecompositions = pgTable("goal_decompositions", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  campaignId: varchar("campaign_id").notNull(),
  accountId: varchar("account_id").notNull().default("default"),
  planId: varchar("plan_id"),
  rootBundleId: varchar("root_bundle_id"),
  rootBundleVersion: integer("root_bundle_version"),
  goalType: text("goal_type").notNull(),
  goalTarget: integer("goal_target"),
  goalLabel: text("goal_label"),
  timeHorizonDays: integer("time_horizon_days").notNull().default(90),
  feasibility: text("feasibility").notNull().default("pending"),
  feasibilityScore: integer("feasibility_score"),
  feasibilityExplanation: text("feasibility_explanation"),
  funnelMath: text("funnel_math"),
  channelFit: text("channel_fit"),
  contentSystem: text("content_system"),
  budgetDecomposition: text("budget_decomposition"),
  assumptions: text("assumptions"),
  confidenceScore: integer("confidence_score"),
  status: text("status").notNull().default("active"),
  jobId: varchar("job_id"),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

export type GoalDecomposition = typeof goalDecompositions.$inferSelect;

export const growthSimulations = pgTable("growth_simulations", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  campaignId: varchar("campaign_id").notNull(),
  accountId: varchar("account_id").notNull().default("default"),
  planId: varchar("plan_id"),
  goalDecompositionId: varchar("goal_decomposition_id"),
  rootBundleId: varchar("root_bundle_id"),
  planHash: varchar("plan_hash"),
  conservativeCase: text("conservative_case"),
  baseCase: text("base_case"),
  upsideCase: text("upside_case"),
  confidenceScore: integer("confidence_score"),
  keyAssumptions: text("key_assumptions"),
  bottleneckAlerts: text("bottleneck_alerts"),
  constraintSimulation: text("constraint_simulation"),
  status: text("status").notNull().default("active"),
  jobId: varchar("job_id"),
  createdAt: timestamp("created_at").defaultNow(),
});

export type GrowthSimulation = typeof growthSimulations.$inferSelect;

export const executionTasks = pgTable("execution_tasks", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  planId: varchar("plan_id").notNull(),
  campaignId: varchar("campaign_id").notNull(),
  accountId: varchar("account_id").notNull().default("default"),
  rootBundleId: varchar("root_bundle_id"),
  taskType: text("task_type").notNull(),
  dayNumber: integer("day_number"),
  weekNumber: integer("week_number"),
  title: text("title").notNull(),
  description: text("description"),
  category: text("category"),
  priority: text("priority").notNull().default("normal"),
  status: text("status").notNull().default("pending"),
  sortOrder: integer("sort_order").default(0),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

export type ExecutionTask = typeof executionTasks.$inferSelect;

export const planAssumptions = pgTable("plan_assumptions", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  planId: varchar("plan_id").notNull(),
  campaignId: varchar("campaign_id").notNull(),
  accountId: varchar("account_id").notNull().default("default"),
  assumption: text("assumption").notNull(),
  confidence: text("confidence").notNull(),
  impactSeverity: text("impact_severity").notNull(),
  source: text("source"),
  affectedModules: text("affected_modules"),
  createdAt: timestamp("created_at").defaultNow(),
});

export type PlanAssumption = typeof planAssumptions.$inferSelect;

export const strategyRoots = pgTable("strategy_roots", {
  id: varchar("id")
    .primaryKey()
    .default(sql`gen_random_uuid()`),
  accountId: varchar("account_id").notNull().default("default"),
  campaignId: varchar("campaign_id").notNull(),
  runId: varchar("run_id").notNull(),
  rootHash: varchar("root_hash").notNull(),
  primaryAxis: text("primary_axis"),
  contrastAxisText: text("contrast_axis_text"),
  approvedMechanism: text("approved_mechanism"),
  approvedAudiencePains: text("approved_audience_pains"),
  approvedDesires: text("approved_desires"),
  approvedTransformation: text("approved_transformation"),
  approvedClaim: text("approved_claim"),
  approvedClaims: text("approved_claims"),
  approvedPromise: text("approved_promise"),
  approvedObjections: text("approved_objections"),
  approvedProofTypes: text("approved_proof_types"),
  approvedPositioningContext: text("approved_positioning_context"),
  miSnapshotId: varchar("mi_snapshot_id").notNull(),
  audienceSnapshotId: varchar("audience_snapshot_id").notNull(),
  positioningSnapshotId: varchar("positioning_snapshot_id").notNull(),
  differentiationSnapshotId: varchar("differentiation_snapshot_id").notNull(),
  mechanismSnapshotId: varchar("mechanism_snapshot_id").notNull(),
  status: text("status").notNull().default("ACTIVE"),
  createdAt: timestamp("created_at").defaultNow(),
});

export type StrategyRoot = typeof strategyRoots.$inferSelect;

// =============================================
// USER CHANNEL SCRAPING ()
// =============================================
export const userPublicProfiles = pgTable("user_public_profiles", {
  id: varchar("id")
    .primaryKey()
    .default(sql`gen_random_uuid()`),
  accountId: varchar("account_id").notNull(),
  campaignId: varchar("campaign_id").notNull(),
  platform: text("platform").notNull(),
  handle: text("handle"),
  url: text("url"),
  addedAt: timestamp("added_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

export const userChannelSnapshots = pgTable("user_channel_snapshots", {
  id: varchar("id")
    .primaryKey()
    .default(sql`gen_random_uuid()`),
  accountId: varchar("account_id").notNull(),
  campaignId: varchar("campaign_id").notNull(),
  platform: text("platform").notNull(),
  handle: text("handle"),
  snapshotData: text("snapshot_data"),
  deltaFromPrevious: text("delta_from_previous"),
  scrapedAt: timestamp("scraped_at").defaultNow(),
});

export type UserPublicProfile = typeof userPublicProfiles.$inferSelect;
export type UserChannelSnapshot = typeof userChannelSnapshots.$inferSelect;

export const buildPlanSnapshots = pgTable("build_plan_snapshots", {
  id: varchar("id")
    .primaryKey()
    .default(sql`gen_random_uuid()`),
  accountId: varchar("account_id").notNull().default("default"),
  campaignId: varchar("campaign_id").notNull(),
  status: text("status").notNull().default("SUCCESS"),
  plan: text("plan"),
  actionabilityScore: doublePrecision("actionability_score").default(0),
  failedBlocks: text("failed_blocks"),
  attempts: integer("attempts").default(1),
  createdAt: timestamp("created_at").defaultNow(),
});

export type BuildPlanSnapshot = typeof buildPlanSnapshots.$inferSelect;

// Phase 6 / Task #69 step 5 — AI Input Snapshot persistence layer.
//
// Captures the EXACT input shape sent to every LLM call (15 engines)
// alongside the model name, prompt fingerprint, and resolved provenance.
// Required by the replay/audit lane so a contested AI output can be
// re-derived deterministically from its captured inputs without re-running
// the entire upstream pipeline.
//
// This is the table-of-record. The wrapper that writes to it lives at
// `server/shared/ai-replay/persistAiInputSnapshot.ts`. NOTE: per the task's
// drift-acceptable footnote, this PR ships the table + wrapper only — the
// 15 per-engine `persistAiInputSnapshot(...)` call sites are filed as a
// follow-up so the wiring can happen behind a shadow flag and each
// engine's payload shape can be validated against its prompt fixture.
export const aiInputSnapshots = pgTable("ai_input_snapshots", {
  id: varchar("id")
    .primaryKey()
    .default(sql`gen_random_uuid()`),
  accountId: varchar("account_id").notNull().default("default"),
  campaignId: varchar("campaign_id").notNull(),
  jobId: varchar("job_id"),
  engineId: text("engine_id").notNull(),
  engineVersion: integer("engine_version").default(0),
  model: text("model").notNull(),
  promptFingerprint: text("prompt_fingerprint").notNull(),
  inputPayload: text("input_payload").notNull(),
  inputBytes: integer("input_bytes").default(0),
  contextSummary: text("context_summary"),
  provenance: text("provenance"),
  createdAt: timestamp("created_at").defaultNow(),
});

export type AiInputSnapshot = typeof aiInputSnapshots.$inferSelect;
export type InsertAiInputSnapshot = typeof aiInputSnapshots.$inferInsert;

export const systemControlVerdicts = pgTable("system_control_verdicts", {
  id: varchar("id")
    .primaryKey()
    .default(sql`gen_random_uuid()`),
  accountId: varchar("account_id").notNull(),
  campaignId: varchar("campaign_id").notNull(),
  jobId: varchar("job_id"),
  verdict: text("verdict").notNull(),
  executionMode: text("execution_mode").notNull(),
  blockReasons: text("block_reasons"),
  downgrades: text("downgrades"),
  structuralChecks: text("structural_checks"),
  contradictions: text("contradictions"),
  repairActions: text("repair_actions"),
  repairAttempted: boolean("repair_attempted").default(false),
  checksTotal: integer("checks_total").default(0),
  checksPassed: integer("checks_passed").default(0),
  durationMs: integer("duration_ms").default(0),
  controlVersion: text("control_version"),
  shadowMode: boolean("shadow_mode").default(false),
  commercialJudgement: text("commercial_judgement"),
  recoveryPlan: text("recovery_plan"),
  createdAt: timestamp("created_at").defaultNow(),
});

export type SystemControlVerdictRecord = typeof systemControlVerdicts.$inferSelect;


// =============================================
// PHASE 8.0 — REMIX ADAPTIVE PIPELINE OVERLAY
// Source: Avyron Remix → Avyron Main migration
// Additive only. Does not modify or replace any
// existing engine snapshot/signal storage.
// 12 tables: pipeline_runs/snapshots/signals/change_events/rejections/
// acquisitions/eval_windows/user_truth/dna/dna_versions/clusters + boss_runs
// =============================================
// =============================================
// REMIX PIPELINE OVERLAY (Phase 1)
// Additive only. Does not modify or replace any
// existing engine snapshot/signal storage.
// =============================================
export const pipelineRuns = pgTable("pipeline_runs", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  accountId: varchar("account_id").notNull().default("default"),
  campaignId: varchar("campaign_id").notNull(),
  lane: text("lane").notNull(), // user | competitor | bridge | shared
  trigger: text("trigger").notNull().default("manual"), // cron | manual | approval | bridge
  parentRunId: varchar("parent_run_id"),
  schemaVersion: text("schema_version").notNull().default("v1"),
  status: text("status").notNull().default("pending"), // pending | running | validated | rejected | failed
  rejectionReasons: text("rejection_reasons"),
  summary: text("summary"),
  startedAt: timestamp("started_at"),
  finishedAt: timestamp("finished_at"),
  createdAt: timestamp("created_at").defaultNow(),
});

export type PipelineRun = typeof pipelineRuns.$inferSelect;
export type InsertPipelineRun = typeof pipelineRuns.$inferInsert;

export const pipelineSnapshots = pgTable("pipeline_snapshots", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  runId: varchar("run_id").notNull(),
  // Phase 6.5 — first-class lineage. Nullable for additive backfill safety;
  // writers must populate; readers hard-reject rows with missing lineage.
  accountId: varchar("account_id"),
  campaignId: varchar("campaign_id"),
  acquisitionId: varchar("acquisition_id"),
  windowId: varchar("window_id"),
  entityId: varchar("entity_id").notNull(),
  entityType: text("entity_type").notNull(),
  lane: text("lane").notNull(),
  source: text("source").notNull(),
  collectedAt: timestamp("collected_at").notNull(),
  payload: text("payload").notNull(),
  schemaVersion: text("schema_version").notNull().default("v1"),
  createdAt: timestamp("created_at").defaultNow(),
});

export type PipelineSnapshot = typeof pipelineSnapshots.$inferSelect;

export const pipelineSignals = pgTable("pipeline_signals", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  runId: varchar("run_id").notNull(),
  // Phase 6.5 — first-class lineage (see pipelineSnapshots note).
  accountId: varchar("account_id"),
  campaignId: varchar("campaign_id"),
  acquisitionId: varchar("acquisition_id"),
  windowId: varchar("window_id"),
  derivedFromSignalId: varchar("derived_from_signal_id"),
  sourceSnapshotId: varchar("source_snapshot_id").notNull(),
  lane: text("lane").notNull(),
  type: text("type").notNull(),
  value: text("value").notNull(),
  confidence: doublePrecision("confidence").notNull().default(0),
  evidence: text("evidence"),
  schemaVersion: text("schema_version").notNull().default("v1"),
  createdAt: timestamp("created_at").defaultNow(),
});

export type PipelineSignal = typeof pipelineSignals.$inferSelect;

export const pipelineChangeEvents = pgTable("pipeline_change_events", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  runId: varchar("run_id").notNull(),
  // Phase 6.5 — first-class lineage (see pipelineSnapshots note).
  accountId: varchar("account_id"),
  campaignId: varchar("campaign_id"),
  acquisitionId: varchar("acquisition_id"),
  windowId: varchar("window_id"),
  baselineSnapshotId: varchar("baseline_snapshot_id").notNull(),
  currentSnapshotId: varchar("current_snapshot_id").notNull(),
  changeDimension: text("change_dimension").notNull(),
  severity: text("severity").notNull(),
  evidence: text("evidence"),
  schemaVersion: text("schema_version").notNull().default("v1"),
  createdAt: timestamp("created_at").defaultNow(),
});

export type PipelineChangeEvent = typeof pipelineChangeEvents.$inferSelect;

// =============================================
// Phase 6.5 — Integrity Engineering rejection log.
// Locked by Samir 2026-04-20:
//   Every hard-reject from the reader/writer boundary writes a row here.
//   Provides queryable proof that the system is fail-closed and surfaces
//   structured reasons on the admin dashboard. Append-only; no updates.
// =============================================
export const pipelineRejections = pgTable("pipeline_rejections", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  observedAt: timestamp("observed_at").defaultNow().notNull(),
  // Boundary that caught the violation: "reader" | "writer" | "harness".
  boundary: text("boundary").notNull(),
  // Logical table the rejected row came from (or "n/a" for non-row violations).
  tableName: text("table_name").notNull(),
  // Row id when known; null for shape/contract violations with no persisted row.
  rowId: varchar("row_id"),
  // Run id when the rejection happened in the context of a pipeline run.
  runId: varchar("run_id"),
  accountId: varchar("account_id"),
  campaignId: varchar("campaign_id"),
  lane: text("lane"),
  // Canonical machine-readable reason code (LINEAGE_MISSING_ACCOUNT, etc).
  reasonCode: text("reason_code").notNull(),
  // Human-readable detail.
  reasonDetail: text("reason_detail").notNull(),
  // JSON snapshot of lineage context (account_id, campaign_id, acquisition_id,
  // expected vs observed values, etc) for debugging. Strict JSON, no fallback.
  context: text("context"),
});

export type PipelineRejection = typeof pipelineRejections.$inferSelect;
export type InsertPipelineRejection = typeof pipelineRejections.$inferInsert;

// =============================================
// Phase 2 — Centralized Collector overlay.
// Single source of acquisition for the new pipeline.
// Additive only. Legacy scrapers and their tables remain untouched.
// =============================================
export const pipelineAcquisitions = pgTable("pipeline_acquisitions", {
  id: varchar("id").primaryKey(),
  accountId: varchar("account_id").notNull().default("default"),
  campaignId: varchar("campaign_id").notNull(),
  lane: text("lane").notNull(),                 // user | competitor
  entityType: text("entity_type").notNull(),    // user_channel | competitor_website | competitor_instagram | competitor_tiktok | competitor_reviews
  entityId: varchar("entity_id").notNull(),
  sourceAdapter: text("source_adapter").notNull(),
  collectedAt: timestamp("collected_at").notNull(),
  payload: text("payload").notNull(),           // JSON — adapter-normalized raw acquisition (no signals)
  provenance: text("provenance").notNull(),     // JSON — upstream scraper, backend, timing, rate-limit, cache info
  ttlMs: integer("ttl_ms").notNull(),
  scopeHash: text("scope_hash").notNull().default("default"),
  schemaVersion: text("schema_version").notNull().default("v1"),
  createdAt: timestamp("created_at").defaultNow(),
});

export type PipelineAcquisition = typeof pipelineAcquisitions.$inferSelect;
export type InsertPipelineAcquisition = typeof pipelineAcquisitions.$inferInsert;

// =============================================
// Phase 3 — Boss Agent overlay.
// Orchestration-only. Records the decision/execution log for every Boss run.
// Lane runs spawned by a Boss run reuse pipeline_runs.parentRunId = boss_runs.id.
// =============================================
export const bossRuns = pgTable("boss_runs", {
  id: varchar("id").primaryKey(),
  accountId: varchar("account_id").notNull().default("default"),
  campaignId: varchar("campaign_id").notNull(),
  trigger: text("trigger").notNull(),               // "manual" | "approval" (cron deferred to Phase 8)
  status: text("status").notNull().default("running"), // "running" | "completed" | "partial" | "failed"
  scope: text("scope"),                             // JSON — what the caller asked for
  plan: text("plan"),                               // JSON — BossPlan
  execution: text("execution"),                     // JSON — acquisitions + lane run ids + bridge run id
  q1Verdict: text("q1_verdict").notNull().default("UNKNOWN"),    // "WORKING" | "DEGRADED" | "UNKNOWN"
  q1Reasons: text("q1_reasons"),                    // JSON array
  q2Verdict: text("q2_verdict").notNull().default("UNCERTAIN"),  // "STABLE" | "SHIFTED" | "UNCERTAIN"
  q2Reasons: text("q2_reasons"),                    // JSON array
  warnings: text("warnings"),                       // JSON array
  startedAt: timestamp("started_at"),
  finishedAt: timestamp("finished_at"),
  createdAt: timestamp("created_at").defaultNow(),
});

export type BossRun = typeof bossRuns.$inferSelect;
export type InsertBossRun = typeof bossRuns.$inferInsert;

// =============================================
// Phase 5 — User Truth Layer + Plan-Anchored Eval Windows.
// Overlay-only. Locked by Samir 2026-04-20:
//   - Anchor source = plan_approvals.decided_at (primary) /
//     strategic_plans.updated_at (fallback w/ warning).
//   - Each approved plan creates its own anchor — no retroactive mixing
//     of rhythm expectations across different plans.
//   - 4 truth fields exactly: total_leads, qualified_leads, booked_calls,
//     paid_active. Nothing else (no notes, no derived ratios).
//   - Truth FK-bound to a specific window so orphan truth is impossible.
// =============================================
export const pipelineEvalWindows = pgTable("pipeline_eval_windows", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  accountId: varchar("account_id").notNull().default("default"),
  campaignId: varchar("campaign_id").notNull(),
  planId: varchar("plan_id").notNull(),                 // FK to strategic_plans.id
  anchorAt: timestamp("anchor_at").notNull(),           // plan_approvals.decided_at OR fallback
  anchorFallbackUsed: boolean("anchor_fallback_used").notNull().default(false),
  windowIndex: integer("window_index").notNull(),       // 0 = first 7-day cycle from anchor
  windowStart: timestamp("window_start").notNull(),     // inclusive
  windowEnd: timestamp("window_end").notNull(),         // exclusive
  state: text("state").notNull().default("open"),       // "open" | "closed_with_truth" | "closed_missing_truth" | "late_filled"
  openedAt: timestamp("opened_at").notNull().defaultNow(),
  closedAt: timestamp("closed_at"),
  truthId: varchar("truth_id"),                         // FK to pipeline_user_truth.id
  createdAt: timestamp("created_at").defaultNow(),
}, (table) => ({
  // Each (campaign, plan, window_index) gets exactly one row.
  // Lazy-create uses INSERT ... ON CONFLICT DO NOTHING on this constraint.
  campaignPlanWindowUnique: uniqueIndex("idx_pipeline_eval_windows_unique")
    .on(table.campaignId, table.planId, table.windowIndex),
}));

export type PipelineEvalWindow = typeof pipelineEvalWindows.$inferSelect;
export type InsertPipelineEvalWindow = typeof pipelineEvalWindows.$inferInsert;

export const pipelineUserTruth = pgTable("pipeline_user_truth", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  accountId: varchar("account_id").notNull().default("default"),
  campaignId: varchar("campaign_id").notNull(),
  windowId: varchar("window_id").notNull(),             // FK to pipeline_eval_windows.id (orphan truth impossible)
  totalLeads: integer("total_leads").notNull(),
  qualifiedLeads: integer("qualified_leads").notNull(),
  bookedCalls: integer("booked_calls").notNull(),
  paidActive: boolean("paid_active").notNull(),
  submittedAt: timestamp("submitted_at").notNull().defaultNow(),
  submittedBy: varchar("submitted_by"),                 // admin user id from JWT (audit trail)
  wasLate: boolean("was_late").notNull().default(false),
  supersededAt: timestamp("superseded_at"),
  supersededBy: varchar("superseded_by"),               // FK to a newer pipeline_user_truth.id
  createdAt: timestamp("created_at").defaultNow(),
});

export type PipelineUserTruth = typeof pipelineUserTruth.$inferSelect;
export type InsertPipelineUserTruth = typeof pipelineUserTruth.$inferInsert;

// =============================================
// Phase 6 — DNA lifecycle + Cluster comparison + Outcome-gated Q1.
// Overlay-only. Locked by Samir 2026-04-20 (rev 2):
//   - Q1 is a JOINED interpretation of three layers (Phase 5 execution +
//     Phase 5 truth + Phase 6 cluster comparison). No single layer can
//     promote WORKING on its own.
//   - Active-DNA cardinality enforced at the DB level by a partial unique
//     index on (account_id, campaign_id) WHERE status='active'.
//   - Hypothesis edits do NOT mint a new dna_id — they append a
//     pipeline_dna_versions row so the cluster baseline survives.
//   - Cluster production is idempotent per (window_id, dna_id).
// =============================================
export const pipelineDna = pgTable("pipeline_dna", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  accountId: varchar("account_id").notNull(),
  campaignId: varchar("campaign_id").notNull(),
  hypothesis: text("hypothesis").notNull(),
  status: text("status").notNull().default("proposed"), // "proposed" | "active" | "paused" | "retired"
  createdBy: varchar("created_by"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  activatedAt: timestamp("activated_at"),
  retiredAt: timestamp("retired_at"),
  notes: text("notes"),
});

export type PipelineDna = typeof pipelineDna.$inferSelect;
export type InsertPipelineDna = typeof pipelineDna.$inferInsert;

export const pipelineDnaVersions = pgTable("pipeline_dna_versions", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  dnaId: varchar("dna_id").notNull(),               // FK -> pipeline_dna.id
  hypothesis: text("hypothesis").notNull(),         // snapshot at this version
  status: text("status").notNull(),                 // snapshot at this version
  changedBy: varchar("changed_by"),
  changedAt: timestamp("changed_at").notNull().defaultNow(),
  reason: text("reason"),                           // operator note
});

export type PipelineDnaVersion = typeof pipelineDnaVersions.$inferSelect;
export type InsertPipelineDnaVersion = typeof pipelineDnaVersions.$inferInsert;

export const pipelineClusters = pgTable("pipeline_clusters", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  accountId: varchar("account_id").notNull(),
  campaignId: varchar("campaign_id").notNull(),
  dnaId: varchar("dna_id").notNull(),               // FK -> pipeline_dna.id
  windowId: varchar("window_id").notNull(),         // FK -> pipeline_eval_windows.id
  clusterSignature: jsonb("cluster_signature").notNull(),
  producedAt: timestamp("produced_at").notNull().defaultNow(),
  producedByRunId: varchar("produced_by_run_id"),   // FK -> boss_runs.id
}, (table) => ({
  // Idempotency boundary: re-running boss in the same window with same active DNA is a no-op.
  windowDnaUnique: uniqueIndex("idx_pipeline_clusters_window_dna").on(table.windowId, table.dnaId),
}));

export type PipelineCluster = typeof pipelineClusters.$inferSelect;
export type InsertPipelineCluster = typeof pipelineClusters.$inferInsert;

// ─── () — F9.4 account lockout & F9.8 refresh-token rotation ──
// Auth-hardening tables. Migration 013 creates them in PG. Read by server/auth.ts.
export const authLockouts = pgTable("auth_lockouts", {
  email: text("email").primaryKey(),
  failedAttempts: integer("failed_attempts").notNull().default(0),
  windowStart: timestamp("window_start").notNull().defaultNow(),
  lockedUntil: timestamp("locked_until"),
  lastAttemptAt: timestamp("last_attempt_at").notNull().defaultNow(),
});

export const authSessions = pgTable("auth_sessions", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  accountId: varchar("account_id").notNull(),
  userId: varchar("user_id").notNull(),
  deviceFingerprint: text("device_fingerprint").notNull().default("default"),
  refreshTokenHash: text("refresh_token_hash").notNull(),
  issuedAt: timestamp("issued_at").notNull().defaultNow(),
  lastUsedAt: timestamp("last_used_at").notNull().defaultNow(),
  revokedAt: timestamp("revoked_at"),
  revokeReason: text("revoke_reason"),
});

export type AuthLockout = typeof authLockouts.$inferSelect;
export type AuthSession = typeof authSessions.$inferSelect;


