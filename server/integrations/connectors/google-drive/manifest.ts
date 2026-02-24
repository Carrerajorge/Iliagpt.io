import type { ConnectorManifest } from "../../kernel/types";

export const googledriveManifest: ConnectorManifest = {
  connectorId: "google-drive",
  version: "1.0.0",
  displayName: "Google Drive",
  category: "general" as any,
  description: "Advanced AI integration for Google Drive",
  iconUrl: "/assets/icons/google-drive.svg",
  authType: "oauth2",
  authConfig: {
    authorizationUrl: "https://api.googledrive.com/oauth/authorize",
    tokenUrl: "https://api.googledrive.com/oauth/token",
    scopes: ["google_drive.read","google_drive.write"],
    pkce: false,
    offlineAccess: true,
  },
  rateLimit: {
    requestsPerMinute: 60,
    requestsPerHour: 1000,
  },
  requiredEnvVars: ["GOOGLE_DRIVE_CLIENT_ID", "GOOGLE_DRIVE_CLIENT_SECRET"],
  capabilities: [
    {
      operationId: "google_drive_search",
      name: "Search items in Google Drive",
      description: "Search items in Google Drive",
      requiredScopes: ["google_drive.read","google_drive.write"],
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
      operationId: "google_drive_create",
      name: "Create a new item in Google Drive",
      description: "Create a new item in Google Drive",
      requiredScopes: ["google_drive.read","google_drive.write"],
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
