import type { ConnectorManifest } from "../../kernel/types";

export const adobeexpressManifest: ConnectorManifest = {
  connectorId: "adobe-express",
  version: "1.0.0",
  displayName: "Adobe Express",
  category: "general" as any,
  description: "Advanced AI integration for Adobe Express",
  iconUrl: "/assets/icons/adobe-express.svg",
  authType: "oauth2",
  authConfig: {
    authorizationUrl: "https://api.adobeexpress.com/oauth/authorize",
    tokenUrl: "https://api.adobeexpress.com/oauth/token",
    scopes: ["adobe_express.read","adobe_express.write"],
    pkce: false,
    offlineAccess: true,
  },
  rateLimit: {
    requestsPerMinute: 60,
    requestsPerHour: 1000,
  },
  requiredEnvVars: ["ADOBE_EXPRESS_CLIENT_ID", "ADOBE_EXPRESS_CLIENT_SECRET"],
  capabilities: [
    {
      operationId: "adobe_express_search",
      name: "Search items in Adobe Express",
      description: "Search items in Adobe Express",
      requiredScopes: ["adobe_express.read","adobe_express.write"],
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
      operationId: "adobe_express_create",
      name: "Create a new item in Adobe Express",
      description: "Create a new item in Adobe Express",
      requiredScopes: ["adobe_express.read","adobe_express.write"],
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
