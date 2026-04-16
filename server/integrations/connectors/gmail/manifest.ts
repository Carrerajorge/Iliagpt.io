import type { ConnectorManifest } from "../../kernel/types";

export const gmailManifest: ConnectorManifest = {
  connectorId: "gmail",
  providerId: "google",
  version: "1.0.0",
  displayName: "Gmail",
  category: "email" as any,
  description: "Search, read, and send emails via Gmail",
  iconUrl: "/assets/icons/gmail.svg",
  authType: "oauth2",
  authConfig: {
    authorizationUrl: "https://accounts.google.com/o/oauth2/v2/auth",
    tokenUrl: "https://oauth2.googleapis.com/token",
    scopes: [
      "https://www.googleapis.com/auth/gmail.readonly",
      "https://www.googleapis.com/auth/gmail.send",
      "https://www.googleapis.com/auth/gmail.modify",
    ],
    pkce: false,
    offlineAccess: true,
  },
  rateLimit: {
    requestsPerMinute: 60,
    requestsPerHour: 1000,
  },
  requiredEnvVars: ["GOOGLE_CLIENT_ID", "GOOGLE_CLIENT_SECRET"],
  capabilities: [
    {
      operationId: "gmail_search",
      name: "Search emails",
      description: "Search emails in Gmail using Gmail search query syntax (same as the Gmail search bar). Returns a list of matching message IDs and snippets.",
      requiredScopes: ["https://www.googleapis.com/auth/gmail.readonly"],
      dataAccessLevel: "read",
      confirmationRequired: false,
      idempotent: true,
      inputSchema: {
        type: "object",
        properties: {
          q: {
            type: "string",
            description: "Gmail search query (e.g. 'from:john subject:invoice after:2026/01/01')",
          },
          maxResults: {
            type: "number",
            description: "Max messages to return (1-100, default 10)",
          },
        },
        required: ["q"],
      },
      outputSchema: { type: "object", properties: {} },
    },
    {
      operationId: "gmail_fetch",
      name: "Read email message",
      description: "Fetch the full content of a specific email message by its ID, including headers (from, to, subject, date) and body text.",
      requiredScopes: ["https://www.googleapis.com/auth/gmail.readonly"],
      dataAccessLevel: "read",
      confirmationRequired: false,
      idempotent: true,
      inputSchema: {
        type: "object",
        properties: {
          messageId: {
            type: "string",
            description: "The message ID to fetch (from gmail_search results)",
          },
          format: {
            type: "string",
            description: "Response format: 'full' (default), 'metadata', 'minimal', or 'raw'",
          },
        },
        required: ["messageId"],
      },
      outputSchema: { type: "object", properties: {} },
    },
    {
      operationId: "gmail_send",
      name: "Send email",
      description: "Send a new email or reply to an existing thread via Gmail.",
      requiredScopes: ["https://www.googleapis.com/auth/gmail.send"],
      dataAccessLevel: "write",
      confirmationRequired: true,
      idempotent: false,
      inputSchema: {
        type: "object",
        properties: {
          to: {
            type: "string",
            description: "Recipient email address(es), comma-separated",
          },
          subject: {
            type: "string",
            description: "Email subject line",
          },
          body: {
            type: "string",
            description: "Email body (plain text)",
          },
          cc: {
            type: "string",
            description: "CC recipients, comma-separated",
          },
          threadId: {
            type: "string",
            description: "Thread ID to reply to (optional, for threading)",
          },
        },
        required: ["to", "subject", "body"],
      },
      outputSchema: { type: "object", properties: {} },
    },
    {
      operationId: "gmail_mark_read",
      name: "Mark email as read",
      description: "Mark one or more email messages as read by removing the UNREAD label.",
      requiredScopes: ["https://www.googleapis.com/auth/gmail.modify"],
      dataAccessLevel: "write",
      confirmationRequired: false,
      idempotent: true,
      inputSchema: {
        type: "object",
        properties: {
          messageId: {
            type: "string",
            description: "The message ID to mark as read",
          },
        },
        required: ["messageId"],
      },
      outputSchema: { type: "object", properties: {} },
    },
    {
      operationId: "gmail_labels",
      name: "List Gmail labels",
      description: "List all labels (folders/categories) in the user's Gmail account.",
      requiredScopes: ["https://www.googleapis.com/auth/gmail.readonly"],
      dataAccessLevel: "read",
      confirmationRequired: false,
      idempotent: true,
      inputSchema: {
        type: "object",
        properties: {},
        required: [],
      },
      outputSchema: { type: "object", properties: {} },
    },
  ],
};
