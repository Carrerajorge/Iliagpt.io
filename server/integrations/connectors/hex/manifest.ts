import type { ConnectorManifest } from "../../kernel/types";

export const hexManifest: ConnectorManifest = {
  connectorId: "hex",
  version: "1.0.0",
  displayName: "Hex",
  category: "general" as any,
  description: "Advanced AI integration for Hex",
  iconUrl: "/assets/icons/hex.svg",
  authType: "oauth2",
  authConfig: {
    authorizationUrl: "https://api.hex.com/oauth/authorize",
    tokenUrl: "https://api.hex.com/oauth/token",
    scopes: ["hex.read","hex.write"],
    pkce: false,
    offlineAccess: true,
  },
  rateLimit: {
    requestsPerMinute: 60,
    requestsPerHour: 1000,
  },
  requiredEnvVars: ["HEX_CLIENT_ID", "HEX_CLIENT_SECRET"],
  capabilities: [
    {
      operationId: "hex_search",
      name: "Search items in Hex",
      description: "Search items in Hex",
      requiredScopes: ["hex.read","hex.write"],
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
      operationId: "hex_create",
      name: "Create a new item in Hex",
      description: "Create a new item in Hex",
      requiredScopes: ["hex.read","hex.write"],
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
