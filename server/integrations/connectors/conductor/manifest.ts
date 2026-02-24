import type { ConnectorManifest } from "../../kernel/types";

export const conductorManifest: ConnectorManifest = {
  connectorId: "conductor",
  version: "1.0.0",
  displayName: "Conductor",
  category: "general" as any,
  description: "Advanced AI integration for Conductor",
  iconUrl: "/assets/icons/conductor.svg",
  authType: "oauth2",
  authConfig: {
    authorizationUrl: "https://api.conductor.com/oauth/authorize",
    tokenUrl: "https://api.conductor.com/oauth/token",
    scopes: ["conductor.read","conductor.write"],
    pkce: false,
    offlineAccess: true,
  },
  rateLimit: {
    requestsPerMinute: 60,
    requestsPerHour: 1000,
  },
  requiredEnvVars: ["CONDUCTOR_CLIENT_ID", "CONDUCTOR_CLIENT_SECRET"],
  capabilities: [
    {
      operationId: "conductor_search",
      name: "Search items in Conductor",
      description: "Search items in Conductor",
      requiredScopes: ["conductor.read","conductor.write"],
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
      operationId: "conductor_create",
      name: "Create a new item in Conductor",
      description: "Create a new item in Conductor",
      requiredScopes: ["conductor.read","conductor.write"],
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
