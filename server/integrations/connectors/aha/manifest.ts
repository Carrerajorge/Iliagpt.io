import type { ConnectorManifest } from "../../kernel/types";

export const ahaManifest: ConnectorManifest = {
  connectorId: "aha",
  version: "1.0.0",
  displayName: "Aha",
  category: "general" as any,
  description: "Advanced AI integration for Aha",
  iconUrl: "/assets/icons/aha.svg",
  authType: "oauth2",
  authConfig: {
    authorizationUrl: "https://api.aha.com/oauth/authorize",
    tokenUrl: "https://api.aha.com/oauth/token",
    scopes: ["aha.read","aha.write"],
    pkce: false,
    offlineAccess: true,
  },
  rateLimit: {
    requestsPerMinute: 60,
    requestsPerHour: 1000,
  },
  requiredEnvVars: ["AHA_CLIENT_ID", "AHA_CLIENT_SECRET"],
  capabilities: [
    {
      operationId: "aha_search",
      name: "Search items in Aha",
      description: "Search items in Aha",
      requiredScopes: ["aha.read","aha.write"],
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
      operationId: "aha_create",
      name: "Create a new item in Aha",
      description: "Create a new item in Aha",
      requiredScopes: ["aha.read","aha.write"],
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
