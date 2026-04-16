import type { ConnectorManifest } from "../../kernel/types";

export const basecampManifest: ConnectorManifest = {
  connectorId: "basecamp",
  version: "1.0.0",
  displayName: "Basecamp",
  category: "general" as any,
  description: "Advanced AI integration for Basecamp",
  iconUrl: "/assets/icons/basecamp.svg",
  authType: "oauth2",
  authConfig: {
    authorizationUrl: "https://api.basecamp.com/oauth/authorize",
    tokenUrl: "https://api.basecamp.com/oauth/token",
    scopes: ["basecamp.read","basecamp.write"],
    pkce: false,
    offlineAccess: true,
  },
  rateLimit: {
    requestsPerMinute: 60,
    requestsPerHour: 1000,
  },
  requiredEnvVars: ["BASECAMP_CLIENT_ID", "BASECAMP_CLIENT_SECRET"],
  capabilities: [
    {
      operationId: "basecamp_search",
      name: "Search items in Basecamp",
      description: "Search items in Basecamp",
      requiredScopes: ["basecamp.read","basecamp.write"],
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
      operationId: "basecamp_create",
      name: "Create a new item in Basecamp",
      description: "Create a new item in Basecamp",
      requiredScopes: ["basecamp.read","basecamp.write"],
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
