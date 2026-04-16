import type { ConnectorManifest } from "../../kernel/types";

export const klaviyoManifest: ConnectorManifest = {
  connectorId: "klaviyo",
  version: "1.0.0",
  displayName: "Klaviyo",
  category: "general" as any,
  description: "Advanced AI integration for Klaviyo",
  iconUrl: "/assets/icons/klaviyo.svg",
  authType: "oauth2",
  authConfig: {
    authorizationUrl: "https://api.klaviyo.com/oauth/authorize",
    tokenUrl: "https://api.klaviyo.com/oauth/token",
    scopes: ["klaviyo.read","klaviyo.write"],
    pkce: false,
    offlineAccess: true,
  },
  rateLimit: {
    requestsPerMinute: 60,
    requestsPerHour: 1000,
  },
  requiredEnvVars: ["KLAVIYO_CLIENT_ID", "KLAVIYO_CLIENT_SECRET"],
  capabilities: [
    {
      operationId: "klaviyo_search",
      name: "Search items in Klaviyo",
      description: "Search items in Klaviyo",
      requiredScopes: ["klaviyo.read","klaviyo.write"],
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
      operationId: "klaviyo_create",
      name: "Create a new item in Klaviyo",
      description: "Create a new item in Klaviyo",
      requiredScopes: ["klaviyo.read","klaviyo.write"],
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
