import type { ConnectorManifest } from "../../kernel/types";

export const courseraManifest: ConnectorManifest = {
  connectorId: "coursera",
  version: "1.0.0",
  displayName: "Coursera",
  category: "general" as any,
  description: "Advanced AI integration for Coursera",
  iconUrl: "/assets/icons/coursera.svg",
  authType: "oauth2",
  authConfig: {
    authorizationUrl: "https://api.coursera.com/oauth/authorize",
    tokenUrl: "https://api.coursera.com/oauth/token",
    scopes: ["coursera.read","coursera.write"],
    pkce: false,
    offlineAccess: true,
  },
  rateLimit: {
    requestsPerMinute: 60,
    requestsPerHour: 1000,
  },
  requiredEnvVars: ["COURSERA_CLIENT_ID", "COURSERA_CLIENT_SECRET"],
  capabilities: [
    {
      operationId: "coursera_search",
      name: "Search items in Coursera",
      description: "Search items in Coursera",
      requiredScopes: ["coursera.read","coursera.write"],
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
      operationId: "coursera_create",
      name: "Create a new item in Coursera",
      description: "Create a new item in Coursera",
      requiredScopes: ["coursera.read","coursera.write"],
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
