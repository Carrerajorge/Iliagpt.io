import type { ConnectorManifest } from "../../kernel/types";

export const lsegManifest: ConnectorManifest = {
  connectorId: "lseg",
  version: "1.0.0",
  displayName: "Lseg",
  category: "general" as any,
  description: "Advanced AI integration for Lseg",
  iconUrl: "/assets/icons/lseg.svg",
  authType: "oauth2",
  authConfig: {
    authorizationUrl: "https://api.lseg.com/oauth/authorize",
    tokenUrl: "https://api.lseg.com/oauth/token",
    scopes: ["lseg.read","lseg.write"],
    pkce: false,
    offlineAccess: true,
  },
  rateLimit: {
    requestsPerMinute: 60,
    requestsPerHour: 1000,
  },
  requiredEnvVars: ["LSEG_CLIENT_ID", "LSEG_CLIENT_SECRET"],
  capabilities: [
    {
      operationId: "lseg_search",
      name: "Search items in Lseg",
      description: "Search items in Lseg",
      requiredScopes: ["lseg.read","lseg.write"],
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
      operationId: "lseg_create",
      name: "Create a new item in Lseg",
      description: "Create a new item in Lseg",
      requiredScopes: ["lseg.read","lseg.write"],
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
