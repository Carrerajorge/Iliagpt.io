import type { ConnectorManifest } from "../../kernel/types";

export const zoomManifest: ConnectorManifest = {
  connectorId: "zoom",
  version: "1.0.0",
  displayName: "Zoom",
  category: "general" as any,
  description: "Advanced AI integration for Zoom",
  iconUrl: "/assets/icons/zoom.svg",
  authType: "oauth2",
  authConfig: {
    authorizationUrl: "https://api.zoom.com/oauth/authorize",
    tokenUrl: "https://api.zoom.com/oauth/token",
    scopes: ["zoom.read","zoom.write"],
    pkce: false,
    offlineAccess: true,
  },
  rateLimit: {
    requestsPerMinute: 60,
    requestsPerHour: 1000,
  },
  requiredEnvVars: ["ZOOM_CLIENT_ID", "ZOOM_CLIENT_SECRET"],
  capabilities: [
    {
      operationId: "zoom_search",
      name: "Search items in Zoom",
      description: "Search items in Zoom",
      requiredScopes: ["zoom.read","zoom.write"],
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
      operationId: "zoom_create",
      name: "Create a new item in Zoom",
      description: "Create a new item in Zoom",
      requiredScopes: ["zoom.read","zoom.write"],
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
