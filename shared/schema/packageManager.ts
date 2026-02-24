import { sql } from "drizzle-orm";

import { pgTable, text, varchar, timestamp, jsonb, uuid, integer } from "drizzle-orm/pg-core";


export const packageOperations = pgTable("package_operations", {

  id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),


  confirmationId: text("confirmation_id"),


  packageName: text("package_name").notNull(),

  manager: text("manager").notNull(),

  action: text("action").notNull(),

  status: text("status").notNull().default("planned"),


  osFamily: text("os_family"),

  osDistro: text("os_distro"),

  command: text("command"),


  policyDecision: text("policy_decision"),

  policyWarnings: jsonb("policy_warnings").$type<string[]>().notNull().default(sql`'[]'::jsonb`),


  requestedBy: text("requested_by"),


  stdout: text("stdout"),

  stderr: text("stderr"),

  exitCode: integer("exit_code"),

  durationMs: integer("duration_ms"),

  rollbackCommand: text("rollback_command"),


  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),

  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),

});


export type PackageOperation = typeof packageOperations.$inferSelect;

export type InsertPackageOperation = typeof packageOperations.$inferInsert;
