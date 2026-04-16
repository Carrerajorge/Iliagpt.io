import type { ConnectorManifest } from "../../kernel/types";

export const linearManifest: ConnectorManifest = {
  connectorId: "linear",
  version: "1.0.0",
  displayName: "Linear",
  category: "productivity" as any,
  description: "Connect Linear to search and create issues directly from the AI.",
  iconUrl: "/assets/icons/linear.svg",
  authType: "oauth2",
  authConfig: {
    authorizationUrl: "https://linear.app/oauth/authorize",
    tokenUrl: "https://api.linear.app/oauth/token",
    scopes: ["read", "write", "issues:create"],
    pkce: false,
    offlineAccess: true,
  },
  rateLimit: {
    requestsPerMinute: 60,
    requestsPerHour: 1000,
  },
  requiredEnvVars: ["LINEAR_CLIENT_ID", "LINEAR_CLIENT_SECRET"],
  capabilities: [
    {
      operationId: "linear_search_issues",
      name: "Search Linear Issues",
      description: "Search for issues in Linear by keyword",
      requiredScopes: ["read"],
      dataAccessLevel: "read",
      confirmationRequired: false,
      idempotent: false,
      inputSchema: {
        type: "object",
        properties: {
          query: {
            type: "string",
            description: "Keyword to search across Linear issues",
          },
          limit: {
            type: "number",
            description: "Maximum number of issues to return (default: 10)",
          },
        },
        required: ["query"],
      },
      outputSchema: { type: "object", properties: {} },
    },
    {
      operationId: "linear_create_issue",
      name: "Create Linear Issue",
      description: "Create a new issue in Linear",
      requiredScopes: ["write", "issues:create"],
      dataAccessLevel: "write",
      confirmationRequired: true,
      idempotent: false,
      inputSchema: {
        type: "object",
        properties: {
          teamId: {
            type: "string",
            description: "The ID of the team to create the issue in",
          },
          title: {
            type: "string",
            description: "Title of the issue",
          },
          description: {
            type: "string",
            description: "Markdown description of the issue",
          },
        },
        required: ["teamId", "title"],
      },
      outputSchema: { type: "object", properties: {} },
    }
  ],
};
