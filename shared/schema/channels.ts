import { sql } from "drizzle-orm";
import {
  pgTable,
  text,
  varchar,
  timestamp,
  jsonb,
  index,
  uniqueIndex,
  boolean,
} from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { users } from "./auth";
import { chats } from "./chat";

// External channel conversations (Telegram, WhatsApp Cloud, etc.)
// Maps an external conversation identifier to an internal chat + owning user.
export const channelConversations = pgTable(
  "channel_conversations",
  {
    id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
    userId: varchar("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    channel: text("channel").notNull(), // "telegram" | "whatsapp_cloud" | ...
    channelKey: text("channel_key").notNull(), // namespace key (e.g., phone_number_id for WA Cloud, "default" for Telegram)
    externalConversationId: text("external_conversation_id").notNull(), // Telegram chat_id, WhatsApp "from", etc.
    chatId: varchar("chat_id")
      .notNull()
      .references(() => chats.id, { onDelete: "cascade" }),
    isActive: boolean("is_active").notNull().default(true),
    metadata: jsonb("metadata"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
  },
  (table: any) => [
    uniqueIndex("channel_conversations_unique").on(
      table.channel,
      table.channelKey,
      table.externalConversationId,
    ),
    index("channel_conversations_user_idx").on(table.userId),
    index("channel_conversations_chat_idx").on(table.chatId),
    index("channel_conversations_channel_idx").on(table.channel),
  ],
);

export const insertChannelConversationSchema = createInsertSchema(channelConversations);
export type InsertChannelConversation = z.infer<typeof insertChannelConversationSchema>;
export type ChannelConversation = typeof channelConversations.$inferSelect;

// One-time pairing codes used to link an external channel identity to a user account.
export const channelPairingCodes = pgTable(
  "channel_pairing_codes",
  {
    id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
    userId: varchar("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    channel: text("channel").notNull(), // currently: "telegram"
    code: varchar("code", { length: 64 }).notNull(),
    expiresAt: timestamp("expires_at").notNull(),
    consumedAt: timestamp("consumed_at"),
    consumedByExternalId: text("consumed_by_external_id"),
    metadata: jsonb("metadata"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (table: any) => [
    uniqueIndex("channel_pairing_codes_code_unique").on(table.code),
    index("channel_pairing_codes_user_idx").on(table.userId),
    index("channel_pairing_codes_channel_idx").on(table.channel),
    index("channel_pairing_codes_expires_idx").on(table.expiresAt),
  ],
);

export const insertChannelPairingCodeSchema = createInsertSchema(channelPairingCodes);
export type InsertChannelPairingCode = z.infer<typeof insertChannelPairingCodeSchema>;
export type ChannelPairingCode = typeof channelPairingCodes.$inferSelect;

