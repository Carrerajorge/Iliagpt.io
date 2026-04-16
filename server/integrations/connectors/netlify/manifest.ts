import type { ConnectorManifest } from "../../kernel/types";

export const netlifyManifest: ConnectorManifest = {
  connectorId: "netlify",
  version: "1.0.0",
  displayName: "Netlify",
  category: "general" as any,
  description: "Advanced AI integration for Netlify",
  iconUrl: "/assets/icons/netlify.svg",
  authType: "oauth2",
  authConfig: {
    authorizationUrl: "https://api.netlify.com/oauth/authorize",
    tokenUrl: "https://api.netlify.com/oauth/token",
    scopes: ["netlify.read","netlify.write"],
    pkce: false,
    offlineAccess: true,
  },
  rateLimit: {
    requestsPerMinute: 60,
    requestsPerHour: 1000,
  },
  requiredEnvVars: ["NETLIFY_CLIENT_ID", "NETLIFY_CLIENT_SECRET"],
  capabilities: [
    {
      operationId: "netlify_search",
      name: "Search items in Netlify",
      description: "Search items in Netlify",
      requiredScopes: ["netlify.read","netlify.write"],
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
      operationId: "netlify_create",
      name: "Create a new item in Netlify",
      description: "Create a new item in Netlify",
      requiredScopes: ["netlify.read","netlify.write"],
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
