import type { ConnectorManifest } from "../../kernel/types";

export const replitManifest: ConnectorManifest = {
  connectorId: "replit",
  version: "1.0.0",
  displayName: "Replit",
  category: "general" as any,
  description: "Advanced AI integration for Replit",
  iconUrl: "/assets/icons/replit.svg",
  authType: "oauth2",
  authConfig: {
    authorizationUrl: "https://api.replit.com/oauth/authorize",
    tokenUrl: "https://api.replit.com/oauth/token",
    scopes: ["replit.read","replit.write"],
    pkce: false,
    offlineAccess: true,
  },
  rateLimit: {
    requestsPerMinute: 60,
    requestsPerHour: 1000,
  },
  requiredEnvVars: ["REPLIT_CLIENT_ID", "REPLIT_CLIENT_SECRET"],
  capabilities: [
    {
      operationId: "replit_search",
      name: "Search items in Replit",
      description: "Search items in Replit",
      requiredScopes: ["replit.read","replit.write"],
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
      operationId: "replit_create",
      name: "Create a new item in Replit",
      description: "Create a new item in Replit",
      requiredScopes: ["replit.read","replit.write"],
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
