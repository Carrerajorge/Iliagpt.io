/**
 * Integration Kernel — Core Types
 *
 * Every external app (Gmail, Slack, Notion, etc.) is represented as a
 * ConnectorManifest.  Each manifest declares ConnectorCapabilities that
 * map 1-to-1 to LLM tool declarations (Gemini FunctionDeclarations).
 */

import type { JSONSchema7 } from "json-schema";

// ─── Categories & Auth ──────────────────────────────────────────────

export const CONNECTOR_CATEGORIES = [
  "email",
  "crm",
  "productivity",
  "dev",
  "comms",
  "finance",
  "design",
  "analytics",
  "storage",
  "marketing",
  "support",
  "ai",
  "general",
] as const;
export type ConnectorCategory = (typeof CONNECTOR_CATEGORIES)[number];

export const CONNECTOR_AUTH_TYPES = [
  "oauth2",
  "oauth2_pkce",
  "api_key",
  "basic",
  "bearer",
  "none",
] as const;
export type ConnectorAuthType = (typeof CONNECTOR_AUTH_TYPES)[number];

export const DATA_ACCESS_LEVELS = ["read", "write", "admin"] as const;
export type DataAccessLevel = (typeof DATA_ACCESS_LEVELS)[number];

// ─── Auth Configs ───────────────────────────────────────────────────

export interface OAuthConfig {
  authorizationUrl: string;
  tokenUrl: string;
  scopes: string[];
  pkce: boolean;
  offlineAccess: boolean;
  /** The provider-level ID shared across connectors (e.g. "google" for Gmail+Drive) */
  providerId?: string;
  /** Additional query params for the authorization request */
  extraAuthParams?: Record<string, string>;
}

export interface ApiKeyConfig {
  headerName: string;       // e.g. "Authorization", "X-Api-Key"
  headerPrefix?: string;    // e.g. "Bearer ", "Token "
  paramName?: string;       // for query-param API keys
}

export interface BasicAuthConfig {
  usernameField: string;
  passwordField: string;
}

// ─── Rate Limiting ──────────────────────────────────────────────────

export interface RateLimitConfig {
  requestsPerMinute: number;
  requestsPerHour: number;
  requestsPerDay?: number;
  burstAllowance?: number;
}

// ─── Webhook / Polling ──────────────────────────────────────────────

export interface WebhookConfig {
  path: string;               // relative path under /api/connectors/webhooks/{connectorId}
  verificationMethod: "hmac_sha256" | "hmac_sha1" | "token" | "challenge" | "none";
  secret?: string;            // env var name for the verification secret
  events: string[];           // e.g. ["message.created", "issue.opened"]
}

export interface PollingConfig {
  defaultIntervalMs: number;  // default poll interval
  minIntervalMs: number;
  resources: string[];        // which resources to poll
}

// ─── Connector Capability ───────────────────────────────────────────

export interface ConnectorCapability {
  /** Globally unique operation ID — used as the LLM tool name.
   *  Must be ≤64 chars (Gemini limit). Convention: {connectorId}_{verb}_{noun}
   *  e.g. "gmail_send_email", "slack_post_message" */
  operationId: string;

  /** Human-readable name (for UI display) */
  name: string;

  /** LLM-visible description (max 200 chars for Gemini) */
  description: string;

  /** OAuth scopes required for this operation */
  requiredScopes: string[];

  /** JSON Schema 7 for the operation input — used directly as
   *  Gemini FunctionDeclaration.parameters */
  inputSchema: JSONSchema7;

  /** JSON Schema 7 for the operation output */
  outputSchema: JSONSchema7;

  /** Whether this reads, writes, or requires admin access */
  dataAccessLevel: DataAccessLevel;

  /** If true, the agent must ask the user for confirmation before executing.
   *  Maps to ToolRegistry's REQUIRES_CONFIRMATION flow. */
  confirmationRequired: boolean;

  /** If true, calling with the same idempotencyKey returns the cached result */
  idempotent: boolean;

  /** Per-operation rate limit override (falls back to manifest-level) */
  rateLimit?: RateLimitConfig;

  /** Tags for capability matching (e.g. ["search", "email"]) */
  tags?: string[];
}

// ─── Connector Manifest ─────────────────────────────────────────────

export interface ConnectorManifest {
  /** Unique connector identifier — e.g. "gmail", "slack", "hubspot" */
  connectorId: string;

  /** Semantic version — e.g. "1.0.0" */
  version: string;

  /** Display name — e.g. "Gmail", "Slack" */
  displayName: string;

  /** Short description */
  description: string;

  /** URL to connector icon (relative or absolute) */
  iconUrl: string;

  /** Functional category */
  category: ConnectorCategory;

  /** Authentication method */
  authType: ConnectorAuthType;

  /** Auth-specific configuration */
  authConfig: OAuthConfig | ApiKeyConfig | BasicAuthConfig | Record<string, never>;

  /** The provider-level ID for credential lookup in integrationAccounts.
   *  Connectors sharing the same OAuth provider (Gmail+Drive → "google")
   *  use the same providerId. Defaults to connectorId if not set. */
  providerId?: string;

  /** Base URL for the connector's API — used by the generic HTTP executor */
  baseUrl?: string;

  /** List of tool capabilities this connector exposes */
  capabilities: ConnectorCapability[];

  /** Webhook push support */
  webhooks?: WebhookConfig[];

  /** Polling pull support */
  polling?: PollingConfig;

  /** Default rate limits for all operations */
  rateLimit: RateLimitConfig;

  /** Required environment variables (checked at startup) */
  requiredEnvVars: string[];

  /** Feature flags for progressive rollout */
  featureFlags?: Record<string, boolean>;

  /** SLA metadata */
  sla?: {
    expectedLatencyMs: number;
    maxLatencyMs: number;
    availabilityTarget: number;  // 0-1, e.g. 0.999
  };
}

// ─── Resolved Credential ────────────────────────────────────────────

export interface ResolvedCredential {
  accountId: string;
  providerId: string;
  userId: string;
  accessToken: string;
  refreshToken?: string;
  scopes: string[];
  metadata: Record<string, unknown>;
  expiresAt?: Date;
}

// ─── Connector Operation Result ─────────────────────────────────────

export interface ConnectorOperationResult {
  success: boolean;
  data?: unknown;
  error?: {
    code: string;
    message: string;
    retryable: boolean;
    statusCode?: number;
    details?: unknown;
  };
  metadata?: {
    requestId?: string;
    latencyMs?: number;
    rateLimitRemaining?: number;
    rateLimitReset?: number;
  };
}

// ─── Gemini FunctionDeclaration (compatible shape) ──────────────────

export interface GeminiFunctionDeclaration {
  name: string;
  description: string;
  parameters: {
    type: "object";
    properties: Record<string, unknown>;
    required?: string[];
  };
}

// ─── Index / Module re-exports ──────────────────────────────────────

export type {
  JSONSchema7,
};
