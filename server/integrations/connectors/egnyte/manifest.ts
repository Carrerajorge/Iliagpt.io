import type { ConnectorManifest } from "../../kernel/types";

export const egnyteManifest: ConnectorManifest = {
  connectorId: "egnyte",
  version: "1.0.0",
  displayName: "Egnyte",
  category: "general" as any,
  description: "Advanced AI integration for Egnyte",
  iconUrl: "/assets/icons/egnyte.svg",
  authType: "oauth2",
  authConfig: {
    authorizationUrl: "https://api.egnyte.com/oauth/authorize",
    tokenUrl: "https://api.egnyte.com/oauth/token",
    scopes: ["egnyte.read","egnyte.write"],
    pkce: false,
    offlineAccess: true,
  },
  rateLimit: {
    requestsPerMinute: 60,
    requestsPerHour: 1000,
  },
  requiredEnvVars: ["EGNYTE_CLIENT_ID", "EGNYTE_CLIENT_SECRET"],
  capabilities: [
    {
      operationId: "egnyte_search",
      name: "Search items in Egnyte",
      description: "Search items in Egnyte",
      requiredScopes: ["egnyte.read","egnyte.write"],
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
      operationId: "egnyte_create",
      name: "Create a new item in Egnyte",
      description: "Create a new item in Egnyte",
      requiredScopes: ["egnyte.read","egnyte.write"],
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
