// server/events/types.ts
// Central event type definitions for the entire domain event system.

// ---------------------------------------------------------------------------
// Base envelope
// ---------------------------------------------------------------------------

export interface EventEnvelope<T = unknown> {
  /** Globally unique event ID (UUID v4) */
  id: string;
  /** Discriminated event type, e.g. "chat.created" */
  type: string;
  /** ID of the aggregate this event belongs to */
  aggregateId: string;
  /** Type of aggregate, e.g. "chat", "agent", "user" */
  aggregateType: string;
  /** User who triggered the event (null for system events) */
  userId: string | null;
  /** Tenant/workspace this event belongs to */
  tenantId: string;
  /** ISO-8601 UTC timestamp */
  timestamp: string;
  /** Monotonically increasing per-aggregate version for optimistic concurrency */
  version: number;
  /** Arbitrary key/value pairs: correlation IDs, trace IDs, source service, etc. */
  metadata: Record<string, unknown>;
  /** Domain-specific data for this event */
  payload: T;
}

// ---------------------------------------------------------------------------
// EventStore persistence record
// ---------------------------------------------------------------------------

export interface EventStoreRecord {
  id: string;
  type: string;
  aggregateId: string;
  aggregateType: string;
  userId: string | null;
  tenantId: string;
  timestamp: string;
  version: number;
  metadata: Record<string, unknown>;
  payload: unknown;
  checksum: string;
  createdAt: Date;
}

export interface Snapshot {
  aggregateId: string;
  aggregateType: string;
  state: unknown;
  version: number;
  createdAt: Date;
}

// ---------------------------------------------------------------------------
// Handler + config types
// ---------------------------------------------------------------------------

export type EventHandler<T = DomainEvent> = (event: T) => Promise<void>;

export interface EventBusConfig {
  redisUrl: string;
  streamPrefix?: string;
  maxRetries?: number;
  retryBaseDelayMs?: number;
  maxStreamLength?: number;
  deadLetterStream?: string;
  ackTimeoutMs?: number;
}

export interface StreamInfo {
  name: string;
  length: number;
  firstEntryId: string | null;
  lastEntryId: string | null;
  groups: number;
}

// ---------------------------------------------------------------------------
// Chat domain events
// ---------------------------------------------------------------------------

export interface ChatCreatedPayload {
  title: string;
  modelId: string;
  systemPrompt?: string;
  initialMessage?: string;
}

export interface ChatUpdatedPayload {
  title?: string;
  systemPrompt?: string;
  modelId?: string;
  changes: Record<string, { before: unknown; after: unknown }>;
}

export interface ChatDeletedPayload {
  reason?: string;
  softDelete: boolean;
}

export interface ChatArchivedPayload {
  archivedAt: string;
  reason?: string;
}

export interface MessageAddedPayload {
  chatId: string;
  messageId: string;
  role: 'user' | 'assistant' | 'system' | 'tool';
  content: string;
  tokens?: number;
  modelId?: string;
  latencyMs?: number;
  toolCalls?: Array<{ id: string; name: string; arguments: unknown }>;
}

export interface MessageEditedPayload {
  chatId: string;
  messageId: string;
  previousContent: string;
  newContent: string;
}

export type ChatCreated = EventEnvelope<ChatCreatedPayload> & { type: 'chat.created' };
export type ChatUpdated = EventEnvelope<ChatUpdatedPayload> & { type: 'chat.updated' };
export type ChatDeleted = EventEnvelope<ChatDeletedPayload> & { type: 'chat.deleted' };
export type ChatArchived = EventEnvelope<ChatArchivedPayload> & { type: 'chat.archived' };
export type MessageAdded = EventEnvelope<MessageAddedPayload> & { type: 'chat.message.added' };
export type MessageEdited = EventEnvelope<MessageEditedPayload> & { type: 'chat.message.edited' };

export type ChatEvent =
  | ChatCreated
  | ChatUpdated
  | ChatDeleted
  | ChatArchived
  | MessageAdded
  | MessageEdited;

// ---------------------------------------------------------------------------
// Agent domain events
// ---------------------------------------------------------------------------

export interface AgentCreatedPayload {
  name: string;
  description?: string;
  modelId: string;
  tools: string[];
  systemPrompt?: string;
  maxSteps?: number;
}

export interface AgentUpdatedPayload {
  name?: string;
  description?: string;
  modelId?: string;
  tools?: string[];
  systemPrompt?: string;
  changes: Record<string, { before: unknown; after: unknown }>;
}

export interface AgentDeletedPayload {
  reason?: string;
  softDelete: boolean;
}

export interface AgentExecutedPayload {
  executionId: string;
  chatId?: string;
  steps: number;
  totalTokens: number;
  durationMs: number;
  toolsUsed: string[];
  outputSummary?: string;
}

export interface AgentFailedPayload {
  executionId: string;
  chatId?: string;
  errorCode: string;
  errorMessage: string;
  stepsCompleted: number;
  lastToolUsed?: string;
}

export type AgentCreated = EventEnvelope<AgentCreatedPayload> & { type: 'agent.created' };
export type AgentUpdated = EventEnvelope<AgentUpdatedPayload> & { type: 'agent.updated' };
export type AgentDeleted = EventEnvelope<AgentDeletedPayload> & { type: 'agent.deleted' };
export type AgentExecuted = EventEnvelope<AgentExecutedPayload> & { type: 'agent.executed' };
export type AgentFailed = EventEnvelope<AgentFailedPayload> & { type: 'agent.failed' };

export type AgentEvent =
  | AgentCreated
  | AgentUpdated
  | AgentDeleted
  | AgentExecuted
  | AgentFailed;

// ---------------------------------------------------------------------------
// User domain events
// ---------------------------------------------------------------------------

export interface UserCreatedPayload {
  email: string;
  displayName: string;
  role: string;
  provider?: string;
}

export interface UserUpdatedPayload {
  changes: Record<string, { before: unknown; after: unknown }>;
}

export interface UserDeletedPayload {
  reason?: string;
  requestedBy: string;
  softDelete: boolean;
}

export interface UserLoggedInPayload {
  ip: string;
  userAgent: string;
  provider: string;
  sessionId: string;
}

export interface UserLoggedOutPayload {
  sessionId: string;
  durationMs?: number;
}

export type UserCreated = EventEnvelope<UserCreatedPayload> & { type: 'user.created' };
export type UserUpdated = EventEnvelope<UserUpdatedPayload> & { type: 'user.updated' };
export type UserDeleted = EventEnvelope<UserDeletedPayload> & { type: 'user.deleted' };
export type UserLoggedIn = EventEnvelope<UserLoggedInPayload> & { type: 'user.loggedIn' };
export type UserLoggedOut = EventEnvelope<UserLoggedOutPayload> & { type: 'user.loggedOut' };

export type UserEvent =
  | UserCreated
  | UserUpdated
  | UserDeleted
  | UserLoggedIn
  | UserLoggedOut;

// ---------------------------------------------------------------------------
// Model domain events
// ---------------------------------------------------------------------------

export interface ModelEnabledPayload {
  providerId: string;
  modelId: string;
  displayName: string;
  capabilities: string[];
}

export interface ModelDisabledPayload {
  providerId: string;
  modelId: string;
  reason?: string;
}

export interface ModelConfigUpdatedPayload {
  providerId: string;
  modelId: string;
  changes: Record<string, { before: unknown; after: unknown }>;
}

export type ModelEnabled = EventEnvelope<ModelEnabledPayload> & { type: 'model.enabled' };
export type ModelDisabled = EventEnvelope<ModelDisabledPayload> & { type: 'model.disabled' };
export type ModelConfigUpdated = EventEnvelope<ModelConfigUpdatedPayload> & {
  type: 'model.config.updated';
};

export type ModelEvent = ModelEnabled | ModelDisabled | ModelConfigUpdated;

// ---------------------------------------------------------------------------
// Document domain events
// ---------------------------------------------------------------------------

export interface DocumentUploadedPayload {
  filename: string;
  mimeType: string;
  sizeBytes: number;
  storageKey: string;
  checksum: string;
}

export interface DocumentProcessedPayload {
  storageKey: string;
  chunksCreated: number;
  embeddingsCreated: number;
  processingDurationMs: number;
  extractedText?: string;
}

export interface DocumentDeletedPayload {
  storageKey: string;
  reason?: string;
  softDelete: boolean;
}

export type DocumentUploaded = EventEnvelope<DocumentUploadedPayload> & {
  type: 'document.uploaded';
};
export type DocumentProcessed = EventEnvelope<DocumentProcessedPayload> & {
  type: 'document.processed';
};
export type DocumentDeleted = EventEnvelope<DocumentDeletedPayload> & {
  type: 'document.deleted';
};

export type DocumentEvent = DocumentUploaded | DocumentProcessed | DocumentDeleted;

// ---------------------------------------------------------------------------
// System domain events
// ---------------------------------------------------------------------------

export interface RateLimitExceededPayload {
  resource: string;
  limit: number;
  windowSeconds: number;
  ip?: string;
  endpoint?: string;
}

export interface SecurityAlertPayload {
  alertType: string;
  severity: 'low' | 'medium' | 'high' | 'critical';
  description: string;
  ip?: string;
  userAgent?: string;
  additionalContext?: Record<string, unknown>;
}

export interface TenantCreatedPayload {
  name: string;
  plan: string;
  ownerEmail: string;
  features: string[];
}

export interface TenantSuspendedPayload {
  reason: string;
  suspendedBy: string;
  reactivationDate?: string;
}

export type RateLimitExceeded = EventEnvelope<RateLimitExceededPayload> & {
  type: 'system.rateLimitExceeded';
};
export type SecurityAlert = EventEnvelope<SecurityAlertPayload> & {
  type: 'system.securityAlert';
};
export type TenantCreated = EventEnvelope<TenantCreatedPayload> & {
  type: 'system.tenantCreated';
};
export type TenantSuspended = EventEnvelope<TenantSuspendedPayload> & {
  type: 'system.tenantSuspended';
};

export type SystemEvent =
  | RateLimitExceeded
  | SecurityAlert
  | TenantCreated
  | TenantSuspended;

// ---------------------------------------------------------------------------
// Master union type
// ---------------------------------------------------------------------------

export type DomainEvent =
  | ChatEvent
  | AgentEvent
  | UserEvent
  | ModelEvent
  | DocumentEvent
  | SystemEvent;

// ---------------------------------------------------------------------------
// Convenience constants: all known event type strings
// ---------------------------------------------------------------------------

export const CHAT_EVENT_TYPES = [
  'chat.created',
  'chat.updated',
  'chat.deleted',
  'chat.archived',
  'chat.message.added',
  'chat.message.edited',
] as const;

export const AGENT_EVENT_TYPES = [
  'agent.created',
  'agent.updated',
  'agent.deleted',
  'agent.executed',
  'agent.failed',
] as const;

export const USER_EVENT_TYPES = [
  'user.created',
  'user.updated',
  'user.deleted',
  'user.loggedIn',
  'user.loggedOut',
] as const;

export const MODEL_EVENT_TYPES = [
  'model.enabled',
  'model.disabled',
  'model.config.updated',
] as const;

export const DOCUMENT_EVENT_TYPES = [
  'document.uploaded',
  'document.processed',
  'document.deleted',
] as const;

export const SYSTEM_EVENT_TYPES = [
  'system.rateLimitExceeded',
  'system.securityAlert',
  'system.tenantCreated',
  'system.tenantSuspended',
] as const;

export const ALL_EVENT_TYPES = [
  ...CHAT_EVENT_TYPES,
  ...AGENT_EVENT_TYPES,
  ...USER_EVENT_TYPES,
  ...MODEL_EVENT_TYPES,
  ...DOCUMENT_EVENT_TYPES,
  ...SYSTEM_EVENT_TYPES,
] as const;

export type EventType = (typeof ALL_EVENT_TYPES)[number];
