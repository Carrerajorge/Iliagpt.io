import { pgTable, text, varchar, integer, timestamp, boolean, serial, index } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";
import { sql } from "drizzle-orm";

export const iliaAds = pgTable("ilia_ads", {
  id: serial("id").primaryKey(),
  title: varchar("title", { length: 120 }).notNull(),
  description: text("description").notNull(),
  imageUrl: text("image_url"),
  targetUrl: text("target_url").notNull(),
  advertiser: varchar("advertiser", { length: 100 }).notNull(),
  keywords: text("keywords").array().notNull().default(sql`'{}'::text[]`),
  category: varchar("category", { length: 50 }).default("general"),
  objective: varchar("objective", { length: 50 }).default("automatic"),
  costPerImpression: integer("cost_per_impression").default(1),
  dailyBudget: integer("daily_budget").default(350),
  totalBudget: integer("total_budget"),
  costSpent: integer("cost_spent").default(0),
  impressions: integer("impressions").default(0),
  clicks: integer("clicks").default(0),
  messagesReceived: integer("messages_received").default(0),
  active: boolean("active").default(true),
  status: varchar("status", { length: 30 }).default("draft"),
  targetCountry: varchar("target_country", { length: 50 }).default("PE"),
  minAge: integer("min_age").default(18),
  maxAge: integer("max_age").default(65),
  gender: varchar("gender", { length: 20 }).default("all"),
  advantagePlus: boolean("advantage_plus").default(true),
  durationDays: integer("duration_days").default(7),
  startDate: timestamp("start_date").defaultNow(),
  endDate: timestamp("end_date"),
  placements: text("placements").array().default(sql`'{in_chat}'::text[]`),
  paymentMethod: varchar("payment_method", { length: 50 }).default("per_impression"),
  currency: varchar("currency", { length: 10 }).default("PEN"),
  createdAt: timestamp("created_at").defaultNow(),
  expiresAt: timestamp("expires_at"),
  createdBy: varchar("created_by", { length: 255 }),
}, (table) => [
  index("idx_ilia_ads_active").on(table.active),
  index("idx_ilia_ads_category").on(table.category),
  index("idx_ilia_ads_status").on(table.status),
]);

export const adImpressions = pgTable("ad_impressions", {
  id: serial("id").primaryKey(),
  adId: integer("ad_id").notNull(),
  sessionId: varchar("session_id", { length: 255 }),
  query: text("query"),
  matchedKeyword: varchar("matched_keyword", { length: 100 }),
  clicked: boolean("clicked").default(false),
  costCharged: integer("cost_charged").default(1),
  placement: varchar("placement", { length: 30 }).default("in_chat"),
  createdAt: timestamp("created_at").defaultNow(),
}, (table) => [
  index("idx_ad_impressions_ad").on(table.adId),
  index("idx_ad_impressions_session").on(table.sessionId),
]);

export const insertIliaAdSchema = createInsertSchema(iliaAds).omit({
  id: true,
  impressions: true,
  clicks: true,
  costSpent: true,
  messagesReceived: true,
  createdAt: true,
});

export const insertAdImpressionSchema = createInsertSchema(adImpressions).omit({
  id: true,
  createdAt: true,
});

export type IliaAd = typeof iliaAds.$inferSelect;
export type InsertIliaAd = z.infer<typeof insertIliaAdSchema>;
export type AdImpression = typeof adImpressions.$inferSelect;
export type InsertAdImpression = z.infer<typeof insertAdImpressionSchema>;
