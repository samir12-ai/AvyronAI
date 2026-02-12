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
  trigger: text("trigger").notNull(),
  action: text("action").notNull(),
  reason: text("reason").notNull(),
  objective: text("objective"),
  budgetAdjustment: text("budget_adjustment"),
  priority: text("priority").default("medium"),
  status: text("status").default("pending"),
  outcome: text("outcome"),
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
export type VideoProject = typeof videoProjects.$inferSelect;
export type PerformanceSnapshot = typeof performanceSnapshots.$inferSelect;
export type StrategyInsight = typeof strategyInsights.$inferSelect;
export type StrategyDecision = typeof strategyDecisions.$inferSelect;
export type StrategyMemory = typeof strategyMemory.$inferSelect;
export type GrowthCampaign = typeof growthCampaigns.$inferSelect;
export type WeeklyReport = typeof weeklyReports.$inferSelect;
