/**
 * Event types for the IliaGPT Event-Driven Architecture (CQRS)
 * Improvement 10: All application event definitions
 */

import { z } from "zod";

// ---------------------------------------------------------------------------
// Base event interface
// ---------------------------------------------------------------------------

export interface IEvent {
  id: string;
  type: string;
  timestamp: Date;
  source: string;
  correlationId?: string;
  userId?: string;
  tenantId?: string;
  metadata?: Record<string, any>;
}

// ---------------------------------------------------------------------------
// Chat events
// ---------------------------------------------------------------------------

export interface ChatCreated extends IEvent {
  type: "chat.created";
  payload: {
    chatId: string;
    title: string;
    modelId: string;
    userId: string;
    tenantId?: string;
    settings?: Record<string, any>;
  };
}

export interface ChatArchived extends IEvent {
  type: "chat.archived";
  payload: {
    chatId: string;
    userId: string;
    archivedAt: Date;
    reason?: string;
  };
}

export interface ChatDeleted extends IEvent {
  type: "chat.deleted";
  payload: {
    chatId: string;
    userId: string;
    deletedAt: Date;
    reason?: string;
  };
}

// ---------------------------------------------------------------------------
// Message events
// ---------------------------------------------------------------------------

export interface MessageSent extends IEvent {
  type: "message.sent";
  payload: {
    messageId: string;
    chatId: string;
    userId: string;
    role: "user" | "assistant" | "system" | "tool";
    content: string;
    modelId?: string;
    tokenCount?: number;
    costUsd?: number;
    latencyMs?: number;
    cached?: boolean;
  };
}

// ---------------------------------------------------------------------------
// Agent task events
// ---------------------------------------------------------------------------

export interface AgentTaskStarted extends IEvent {
  type: "agent.task.started";
  payload: {
    taskId: string;
    agentId: string;
    userId: string;
    chatId?: string;
    taskType: string;
    description: string;
    inputTokens?: number;
    tools?: string[];
  };
}

export interface AgentTaskCompleted extends IEvent {
  type: "agent.task.completed";
  payload: {
    taskId: string;
    agentId: string;
    userId: string;
    chatId?: string;
    durationMs: number;
    outputTokens?: number;
    totalCostUsd?: number;
    toolCallCount?: number;
    result?: string;
  };
}

export interface AgentTaskFailed extends IEvent {
  type: "agent.task.failed";
  payload: {
    taskId: string;
    agentId: string;
    userId: string;
    chatId?: string;
    durationMs: number;
    errorCode: string;
    errorMessage: string;
    retryCount?: number;
  };
}

// ---------------------------------------------------------------------------
// Document events
// ---------------------------------------------------------------------------

export interface DocumentGenerated extends IEvent {
  type: "document.generated";
  payload: {
    documentId: string;
    userId: string;
    documentType: "docx" | "xlsx" | "pdf" | "txt" | string;
    sizeBytes: number;
    generationMs: number;
    templateId?: string;
  };
}

export interface DocumentAnalyzed extends IEvent {
  type: "document.analyzed";
  payload: {
    documentId: string;
    userId: string;
    documentType: string;
    sizeBytes: number;
    analysisMs: number;
    pageCount?: number;
    wordCount?: number;
    summary?: string;
  };
}

// ---------------------------------------------------------------------------
// User auth events
// ---------------------------------------------------------------------------

export interface UserSignedIn extends IEvent {
  type: "user.signed_in";
  payload: {
    userId: string;
    email: string;
    provider: string;
    ipAddress?: string;
    userAgent?: string;
    tenantId?: string;
  };
}

export interface UserSignedOut extends IEvent {
  type: "user.signed_out";
  payload: {
    userId: string;
    sessionId?: string;
    reason?: "manual" | "timeout" | "forced";
  };
}

// ---------------------------------------------------------------------------
// Model events
// ---------------------------------------------------------------------------

export interface ModelSwitched extends IEvent {
  type: "model.switched";
  payload: {
    chatId: string;
    userId: string;
    fromModelId: string;
    toModelId: string;
    reason?: string;
  };
}

export interface ModelError extends IEvent {
  type: "model.error";
  payload: {
    modelId: string;
    userId?: string;
    chatId?: string;
    errorCode: string;
    errorMessage: string;
    retried: boolean;
    fallbackModelId?: string;
  };
}

// ---------------------------------------------------------------------------
// System / generic events
// ---------------------------------------------------------------------------

export interface ErrorOccurred extends IEvent {
  type: "error.occurred";
  payload: {
    errorCode: string;
    errorMessage: string;
    stack?: string;
    severity: "low" | "medium" | "high" | "critical";
    context?: Record<string, any>;
    userId?: string;
    requestId?: string;
  };
}

export interface SettingsUpdated extends IEvent {
  type: "settings.updated";
  payload: {
    userId: string;
    settingsKey: string;
    previousValue?: any;
    newValue: any;
    scope: "user" | "chat" | "tenant" | "system";
  };
}

// ---------------------------------------------------------------------------
// Union type
// ---------------------------------------------------------------------------

export type AppEvent =
  | ChatCreated
  | ChatArchived
  | ChatDeleted
  | MessageSent
  | AgentTaskStarted
  | AgentTaskCompleted
  | AgentTaskFailed
  | DocumentGenerated
  | DocumentAnalyzed
  | UserSignedIn
  | UserSignedOut
  | ModelSwitched
  | ModelError
  | ErrorOccurred
  | SettingsUpdated;

// ---------------------------------------------------------------------------
// Event type constants
// ---------------------------------------------------------------------------

export const EVENT_TYPES = {
  CHAT_CREATED: "chat.created" as const,
  CHAT_ARCHIVED: "chat.archived" as const,
  CHAT_DELETED: "chat.deleted" as const,
  MESSAGE_SENT: "message.sent" as const,
  AGENT_TASK_STARTED: "agent.task.started" as const,
  AGENT_TASK_COMPLETED: "agent.task.completed" as const,
  AGENT_TASK_FAILED: "agent.task.failed" as const,
  DOCUMENT_GENERATED: "document.generated" as const,
  DOCUMENT_ANALYZED: "document.analyzed" as const,
  USER_SIGNED_IN: "user.signed_in" as const,
  USER_SIGNED_OUT: "user.signed_out" as const,
  MODEL_SWITCHED: "model.switched" as const,
  MODEL_ERROR: "model.error" as const,
  ERROR_OCCURRED: "error.occurred" as const,
  SETTINGS_UPDATED: "settings.updated" as const,
} as const;

export type EventType = (typeof EVENT_TYPES)[keyof typeof EVENT_TYPES];

// ---------------------------------------------------------------------------
// Handler type
// ---------------------------------------------------------------------------

export type EventHandler<T extends AppEvent = AppEvent> = (event: T) => Promise<void>;

// ---------------------------------------------------------------------------
// Zod schema for base event validation
// ---------------------------------------------------------------------------

export const BaseEventSchema = z.object({
  id: z.string().uuid(),
  type: z.string().min(1),
  timestamp: z.date(),
  source: z.string().min(1),
  correlationId: z.string().optional(),
  userId: z.string().optional(),
  tenantId: z.string().optional(),
  metadata: z.record(z.any()).optional(),
  payload: z.record(z.any()),
});

export type BaseEventInput = z.infer<typeof BaseEventSchema>;

// ---------------------------------------------------------------------------
// Stream info helper type
// ---------------------------------------------------------------------------

export interface StreamInfo {
  streamKey: string;
  length: number;
  groups: number;
  firstEntryId?: string;
  lastEntryId?: string;
}

// ---------------------------------------------------------------------------
// EventFilter for store queries
// ---------------------------------------------------------------------------

export interface EventFilter {
  types?: EventType[];
  userId?: string;
  tenantId?: string;
  aggregateId?: string;
  aggregateType?: string;
  fromTimestamp?: Date;
  toTimestamp?: Date;
  correlationId?: string;
  limit?: number;
  offset?: number;
}

// ---------------------------------------------------------------------------
// Snapshot type
// ---------------------------------------------------------------------------

export interface Snapshot {
  id: string;
  aggregateId: string;
  aggregateType: string;
  version: number;
  state: any;
  createdAt: Date;
}
