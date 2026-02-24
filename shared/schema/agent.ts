import { pgTable, text, serial, integer, boolean, timestamp, jsonb, doublePrecision, uuid } from "drizzle-orm/pg-core";

// --- EXISTING SCHEMAS (Mocks for append to preserve module) ---
export const agentModeEvents = pgTable("agent_mode_events", {
    id: uuid("id").primaryKey().defaultRandom(),
    runId: text("run_id").notNull(),
    stepIndex: integer("step_index"),
    correlationId: text("correlation_id").notNull(),
    eventType: text("event_type").notNull(),
    payload: jsonb("payload").notNull(),
    metadata: jsonb("metadata"),
    timestamp: timestamp("timestamp").notNull().defaultNow(),
});

// T09-002: WORLD MODEL TRANSACTIONS
export const agentTransitions = pgTable("agent_transitions", {
    id: uuid('id').primaryKey().defaultRandom(),
    stateBefore: text('state_before').notNull(),
    action: jsonb('action').notNull(),
    stateAfter: text('state_after').notNull(),
    reward: doublePrecision('reward').notNull(),
    appContext: text('app_context'),
    createdAt: timestamp('created_at').defaultNow(),
});

import { customType } from "drizzle-orm/pg-core";
const vector = customType<{ data: number[] }>({
    dataType() { return 'vector(1536)'; },
});

// T09-003: EPISODIC MEMORY (Long Term Context)
export const agentEpisodicMemory = pgTable("agent_episodic_memory", {
    id: uuid('id').primaryKey().defaultRandom(),
    runId: text('run_id').notNull(),
    embedding: vector('embedding').notNull(),
    content: text('content').notNull(),
    metadata: jsonb('metadata'),
    createdAt: timestamp('created_at').defaultNow(),
});
