import type { ConnectorManifest } from "../../kernel/types";

export const clayManifest: ConnectorManifest = {
  connectorId: "clay",
  version: "1.0.0",
  displayName: "Clay",
  category: "general" as any,
  description: "Advanced AI integration for Clay",
  iconUrl: "/assets/icons/clay.svg",
  authType: "oauth2",
  authConfig: {
    authorizationUrl: "https://api.clay.com/oauth/authorize",
    tokenUrl: "https://api.clay.com/oauth/token",
    scopes: ["clay.read","clay.write"],
    pkce: false,
    offlineAccess: true,
  },
  rateLimit: {
    requestsPerMinute: 60,
    requestsPerHour: 1000,
  },
  requiredEnvVars: ["CLAY_CLIENT_ID", "CLAY_CLIENT_SECRET"],
  capabilities: [
    {
      operationId: "clay_search",
      name: "Search items in Clay",
      description: "Search items in Clay",
      requiredScopes: ["clay.read","clay.write"],
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
      operationId: "clay_create",
      name: "Create a new item in Clay",
      description: "Create a new item in Clay",
      requiredScopes: ["clay.read","clay.write"],
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
