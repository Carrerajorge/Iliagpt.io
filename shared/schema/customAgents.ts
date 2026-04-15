import { pgTable, text, varchar, integer, timestamp, jsonb, index, boolean, real } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const customAgents = pgTable("custom_agents", {
  id: integer("id").primaryKey().generatedAlwaysAsIdentity(),
  userId: varchar("user_id").notNull(),
  name: varchar("name", { length: 100 }).notNull(),
  description: text("description"),
  avatarEmoji: varchar("avatar_emoji", { length: 10 }).default("🤖"),
  systemPrompt: text("system_prompt").notNull(),
  model: varchar("model", { length: 100 }).default("auto"),
  temperature: real("temperature").default(0.7),
  tools: jsonb("tools").$type<string[]>().default(["chat"]),
  knowledgeFiles: jsonb("knowledge_files").$type<string[]>().default([]),
  conversationStarters: jsonb("conversation_starters").$type<string[]>().default([]),
  isPublic: boolean("is_public").default(false),
  category: varchar("category", { length: 50 }),
  usageCount: integer("usage_count").default(0),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
}, (table) => [
  index("idx_custom_agents_user").on(table.userId),
  index("idx_custom_agents_public").on(table.isPublic),
  index("idx_custom_agents_category").on(table.category),
]);

export const insertCustomAgentSchema = createInsertSchema(customAgents).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
  usageCount: true,
});

export type CustomAgent = typeof customAgents.$inferSelect;
export type InsertCustomAgent = z.infer<typeof insertCustomAgentSchema>;
