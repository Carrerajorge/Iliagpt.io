import { sql } from "drizzle-orm";
import { pgTable, text, varchar, timestamp, integer, boolean, index } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { users } from "./auth";
import { chats } from "./chat";

/**
 * Chat schedules ("Programaciones")
 * A schedule triggers a new user prompt in a given chat at a future time (once/daily/weekly).
 */
export const chatSchedules = pgTable(
  "chat_schedules",
  {
    id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
    userId: varchar("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    chatId: varchar("chat_id")
      .notNull()
      .references(() => chats.id, { onDelete: "cascade" }),

    name: text("name").notNull().default("Programación"),
    prompt: text("prompt").notNull(),

    // once|daily|weekly
    scheduleType: text("schedule_type").notNull(),
    timeZone: text("time_zone").notNull().default("UTC"),

    // once
    runAt: timestamp("run_at"),

    // daily/weekly (HH:MM)
    timeOfDay: text("time_of_day"),
    // weekly (0-6, Sunday=0)
    daysOfWeek: integer("days_of_week").array(),

    isActive: boolean("is_active").notNull().default(true),
    lastRunAt: timestamp("last_run_at"),
    nextRunAt: timestamp("next_run_at"),

    // Distributed lock to avoid duplicate runs in multi-instance deployments
    lockedAt: timestamp("locked_at"),
    lockedBy: text("locked_by"),

    failureCount: integer("failure_count").notNull().default(0),
    lastError: text("last_error"),

    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
  },
  (table: any) => [
    index("chat_schedules_user_idx").on(table.userId),
    index("chat_schedules_chat_idx").on(table.chatId),
    index("chat_schedules_active_next_idx").on(table.isActive, table.nextRunAt),
  ],
);

export const insertChatScheduleSchema = createInsertSchema(chatSchedules);

export type InsertChatSchedule = z.infer<typeof insertChatScheduleSchema>;
export type ChatSchedule = typeof chatSchedules.$inferSelect;

