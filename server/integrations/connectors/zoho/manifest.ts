import type { ConnectorManifest } from "../../kernel/types";

export const zohoManifest: ConnectorManifest = {
  connectorId: "zoho",
  version: "1.0.0",
  displayName: "Zoho",
  category: "general" as any,
  description: "Advanced AI integration for Zoho",
  iconUrl: "/assets/icons/zoho.svg",
  authType: "oauth2",
  authConfig: {
    authorizationUrl: "https://api.zoho.com/oauth/authorize",
    tokenUrl: "https://api.zoho.com/oauth/token",
    scopes: ["zoho.read","zoho.write"],
    pkce: false,
    offlineAccess: true,
  },
  rateLimit: {
    requestsPerMinute: 60,
    requestsPerHour: 1000,
  },
  requiredEnvVars: ["ZOHO_CLIENT_ID", "ZOHO_CLIENT_SECRET"],
  capabilities: [
    {
      operationId: "zoho_search",
      name: "Search items in Zoho",
      description: "Search items in Zoho",
      requiredScopes: ["zoho.read","zoho.write"],
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
      operationId: "zoho_create",
      name: "Create a new item in Zoho",
      description: "Create a new item in Zoho",
      requiredScopes: ["zoho.read","zoho.write"],
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
