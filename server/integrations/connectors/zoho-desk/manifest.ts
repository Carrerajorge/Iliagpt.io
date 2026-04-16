import type { ConnectorManifest } from "../../kernel/types";

export const zohodeskManifest: ConnectorManifest = {
  connectorId: "zoho-desk",
  version: "1.0.0",
  displayName: "Zoho Desk",
  category: "general" as any,
  description: "Advanced AI integration for Zoho Desk",
  iconUrl: "/assets/icons/zoho-desk.svg",
  authType: "oauth2",
  authConfig: {
    authorizationUrl: "https://api.zohodesk.com/oauth/authorize",
    tokenUrl: "https://api.zohodesk.com/oauth/token",
    scopes: ["zoho_desk.read","zoho_desk.write"],
    pkce: false,
    offlineAccess: true,
  },
  rateLimit: {
    requestsPerMinute: 60,
    requestsPerHour: 1000,
  },
  requiredEnvVars: ["ZOHO_DESK_CLIENT_ID", "ZOHO_DESK_CLIENT_SECRET"],
  capabilities: [
    {
      operationId: "zoho_desk_search",
      name: "Search items in Zoho Desk",
      description: "Search items in Zoho Desk",
      requiredScopes: ["zoho_desk.read","zoho_desk.write"],
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
      operationId: "zoho_desk_create",
      name: "Create a new item in Zoho Desk",
      description: "Create a new item in Zoho Desk",
      requiredScopes: ["zoho_desk.read","zoho_desk.write"],
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
