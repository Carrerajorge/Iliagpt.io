import type { ConnectorManifest } from "../../kernel/types";

export const dropboxManifest: ConnectorManifest = {
  connectorId: "dropbox",
  version: "1.0.0",
  displayName: "Dropbox",
  category: "general" as any,
  description: "Advanced AI integration for Dropbox",
  iconUrl: "/assets/icons/dropbox.svg",
  authType: "oauth2",
  authConfig: {
    authorizationUrl: "https://api.dropbox.com/oauth/authorize",
    tokenUrl: "https://api.dropbox.com/oauth/token",
    scopes: ["dropbox.read","dropbox.write"],
    pkce: false,
    offlineAccess: true,
  },
  rateLimit: {
    requestsPerMinute: 60,
    requestsPerHour: 1000,
  },
  requiredEnvVars: ["DROPBOX_CLIENT_ID", "DROPBOX_CLIENT_SECRET"],
  capabilities: [
    {
      operationId: "dropbox_search",
      name: "Search items in Dropbox",
      description: "Search items in Dropbox",
      requiredScopes: ["dropbox.read","dropbox.write"],
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
      operationId: "dropbox_create",
      name: "Create a new item in Dropbox",
      description: "Create a new item in Dropbox",
      requiredScopes: ["dropbox.read","dropbox.write"],
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
