import type { ConnectorManifest } from "../../kernel/types";

export const adobephotoshopManifest: ConnectorManifest = {
  connectorId: "adobe-photoshop",
  version: "1.0.0",
  displayName: "Adobe Photoshop",
  category: "general" as any,
  description: "Advanced AI integration for Adobe Photoshop",
  iconUrl: "/assets/icons/adobe-photoshop.svg",
  authType: "oauth2",
  authConfig: {
    authorizationUrl: "https://api.adobephotoshop.com/oauth/authorize",
    tokenUrl: "https://api.adobephotoshop.com/oauth/token",
    scopes: ["adobe_photoshop.read","adobe_photoshop.write"],
    pkce: false,
    offlineAccess: true,
  },
  rateLimit: {
    requestsPerMinute: 60,
    requestsPerHour: 1000,
  },
  requiredEnvVars: ["ADOBE_PHOTOSHOP_CLIENT_ID", "ADOBE_PHOTOSHOP_CLIENT_SECRET"],
  capabilities: [
    {
      operationId: "adobe_photoshop_search",
      name: "Search items in Adobe Photoshop",
      description: "Search items in Adobe Photoshop",
      requiredScopes: ["adobe_photoshop.read","adobe_photoshop.write"],
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
      operationId: "adobe_photoshop_create",
      name: "Create a new item in Adobe Photoshop",
      description: "Create a new item in Adobe Photoshop",
      requiredScopes: ["adobe_photoshop.read","adobe_photoshop.write"],
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
