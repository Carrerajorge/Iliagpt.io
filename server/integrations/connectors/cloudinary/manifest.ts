import type { ConnectorManifest } from "../../kernel/types";

export const cloudinaryManifest: ConnectorManifest = {
  connectorId: "cloudinary",
  version: "1.0.0",
  displayName: "Cloudinary",
  category: "general" as any,
  description: "Advanced AI integration for Cloudinary",
  iconUrl: "/assets/icons/cloudinary.svg",
  authType: "oauth2",
  authConfig: {
    authorizationUrl: "https://api.cloudinary.com/oauth/authorize",
    tokenUrl: "https://api.cloudinary.com/oauth/token",
    scopes: ["cloudinary.read","cloudinary.write"],
    pkce: false,
    offlineAccess: true,
  },
  rateLimit: {
    requestsPerMinute: 60,
    requestsPerHour: 1000,
  },
  requiredEnvVars: ["CLOUDINARY_CLIENT_ID", "CLOUDINARY_CLIENT_SECRET"],
  capabilities: [
    {
      operationId: "cloudinary_search",
      name: "Search items in Cloudinary",
      description: "Search items in Cloudinary",
      requiredScopes: ["cloudinary.read","cloudinary.write"],
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
      operationId: "cloudinary_create",
      name: "Create a new item in Cloudinary",
      description: "Create a new item in Cloudinary",
      requiredScopes: ["cloudinary.read","cloudinary.write"],
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
