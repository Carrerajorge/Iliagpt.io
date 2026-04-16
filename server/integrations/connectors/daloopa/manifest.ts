import type { ConnectorManifest } from "../../kernel/types";

export const daloopaManifest: ConnectorManifest = {
  connectorId: "daloopa",
  version: "1.0.0",
  displayName: "Daloopa",
  category: "general" as any,
  description: "Advanced AI integration for Daloopa",
  iconUrl: "/assets/icons/daloopa.svg",
  authType: "oauth2",
  authConfig: {
    authorizationUrl: "https://api.daloopa.com/oauth/authorize",
    tokenUrl: "https://api.daloopa.com/oauth/token",
    scopes: ["daloopa.read","daloopa.write"],
    pkce: false,
    offlineAccess: true,
  },
  rateLimit: {
    requestsPerMinute: 60,
    requestsPerHour: 1000,
  },
  requiredEnvVars: ["DALOOPA_CLIENT_ID", "DALOOPA_CLIENT_SECRET"],
  capabilities: [
    {
      operationId: "daloopa_search",
      name: "Search items in Daloopa",
      description: "Search items in Daloopa",
      requiredScopes: ["daloopa.read","daloopa.write"],
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
      operationId: "daloopa_create",
      name: "Create a new item in Daloopa",
      description: "Create a new item in Daloopa",
      requiredScopes: ["daloopa.read","daloopa.write"],
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
