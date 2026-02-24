import type { ConnectorManifest } from "../../kernel/types";

export const mondayManifest: ConnectorManifest = {
  connectorId: "monday",
  version: "1.0.0",
  displayName: "Monday",
  category: "general" as any,
  description: "Advanced AI integration for Monday",
  iconUrl: "/assets/icons/monday.svg",
  authType: "oauth2",
  authConfig: {
    authorizationUrl: "https://api.monday.com/oauth/authorize",
    tokenUrl: "https://api.monday.com/oauth/token",
    scopes: ["monday.read","monday.write"],
    pkce: false,
    offlineAccess: true,
  },
  rateLimit: {
    requestsPerMinute: 60,
    requestsPerHour: 1000,
  },
  requiredEnvVars: ["MONDAY_CLIENT_ID", "MONDAY_CLIENT_SECRET"],
  capabilities: [
    {
      operationId: "monday_search",
      name: "Search items in Monday",
      description: "Search items in Monday",
      requiredScopes: ["monday.read","monday.write"],
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
      operationId: "monday_create",
      name: "Create a new item in Monday",
      description: "Create a new item in Monday",
      requiredScopes: ["monday.read","monday.write"],
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
