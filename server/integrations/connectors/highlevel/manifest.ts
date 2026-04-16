import type { ConnectorManifest } from "../../kernel/types";

export const highlevelManifest: ConnectorManifest = {
  connectorId: "highlevel",
  version: "1.0.0",
  displayName: "Highlevel",
  category: "general" as any,
  description: "Advanced AI integration for Highlevel",
  iconUrl: "/assets/icons/highlevel.svg",
  authType: "oauth2",
  authConfig: {
    authorizationUrl: "https://api.highlevel.com/oauth/authorize",
    tokenUrl: "https://api.highlevel.com/oauth/token",
    scopes: ["highlevel.read","highlevel.write"],
    pkce: false,
    offlineAccess: true,
  },
  rateLimit: {
    requestsPerMinute: 60,
    requestsPerHour: 1000,
  },
  requiredEnvVars: ["HIGHLEVEL_CLIENT_ID", "HIGHLEVEL_CLIENT_SECRET"],
  capabilities: [
    {
      operationId: "highlevel_search",
      name: "Search items in Highlevel",
      description: "Search items in Highlevel",
      requiredScopes: ["highlevel.read","highlevel.write"],
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
      operationId: "highlevel_create",
      name: "Create a new item in Highlevel",
      description: "Create a new item in Highlevel",
      requiredScopes: ["highlevel.read","highlevel.write"],
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
