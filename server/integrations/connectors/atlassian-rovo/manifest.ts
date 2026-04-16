import type { ConnectorManifest } from "../../kernel/types";

export const atlassianrovoManifest: ConnectorManifest = {
  connectorId: "atlassian-rovo",
  version: "1.0.0",
  displayName: "Atlassian Rovo",
  category: "general" as any,
  description: "Advanced AI integration for Atlassian Rovo",
  iconUrl: "/assets/icons/atlassian-rovo.svg",
  authType: "oauth2",
  authConfig: {
    authorizationUrl: "https://api.atlassianrovo.com/oauth/authorize",
    tokenUrl: "https://api.atlassianrovo.com/oauth/token",
    scopes: ["atlassian_rovo.read","atlassian_rovo.write"],
    pkce: false,
    offlineAccess: true,
  },
  rateLimit: {
    requestsPerMinute: 60,
    requestsPerHour: 1000,
  },
  requiredEnvVars: ["ATLASSIAN_ROVO_CLIENT_ID", "ATLASSIAN_ROVO_CLIENT_SECRET"],
  capabilities: [
    {
      operationId: "atlassian_rovo_search",
      name: "Search items in Atlassian Rovo",
      description: "Search items in Atlassian Rovo",
      requiredScopes: ["atlassian_rovo.read","atlassian_rovo.write"],
      dataAccessLevel: "read",
      confirmationRequired: false,
      idempotent: true,
      inputSchema: {
        type: "object",
        properties: {
          "query": {
                    "type": "string",
                    "description": "Search query"
          }
},
        required: ["query"]
      },
      outputSchema: { type: "object", properties: {} }
    },
    {
      operationId: "atlassian_rovo_create",
      name: "Create a new item in Atlassian Rovo",
      description: "Create a new item in Atlassian Rovo",
      requiredScopes: ["atlassian_rovo.read","atlassian_rovo.write"],
      dataAccessLevel: "write",
      confirmationRequired: true,
      idempotent: false,
      inputSchema: {
        type: "object",
        properties: {
          "name": {
                    "type": "string",
                    "description": "Item name"
          },
          "description": {
                    "type": "string"
          }
},
        required: ["name"]
      },
      outputSchema: { type: "object", properties: {} }
    }
  ]
};
