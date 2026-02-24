import type { ConnectorManifest } from "../../kernel/types";

export const sharepointManifest: ConnectorManifest = {
  connectorId: "sharepoint",
  version: "1.0.0",
  displayName: "Sharepoint",
  category: "general" as any,
  description: "Advanced AI integration for Sharepoint",
  iconUrl: "/assets/icons/sharepoint.svg",
  authType: "oauth2",
  authConfig: {
    authorizationUrl: "https://api.sharepoint.com/oauth/authorize",
    tokenUrl: "https://api.sharepoint.com/oauth/token",
    scopes: ["sharepoint.read","sharepoint.write"],
    pkce: false,
    offlineAccess: true,
  },
  rateLimit: {
    requestsPerMinute: 60,
    requestsPerHour: 1000,
  },
  requiredEnvVars: ["SHAREPOINT_CLIENT_ID", "SHAREPOINT_CLIENT_SECRET"],
  capabilities: [
    {
      operationId: "sharepoint_search",
      name: "Search items in Sharepoint",
      description: "Search items in Sharepoint",
      requiredScopes: ["sharepoint.read","sharepoint.write"],
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
      operationId: "sharepoint_create",
      name: "Create a new item in Sharepoint",
      description: "Create a new item in Sharepoint",
      requiredScopes: ["sharepoint.read","sharepoint.write"],
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
