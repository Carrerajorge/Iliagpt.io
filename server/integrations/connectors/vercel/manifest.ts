import type { ConnectorManifest } from "../../kernel/types";

export const vercelManifest: ConnectorManifest = {
  connectorId: "vercel",
  version: "1.0.0",
  displayName: "Vercel",
  category: "general" as any,
  description: "Advanced AI integration for Vercel",
  iconUrl: "/assets/icons/vercel.svg",
  authType: "oauth2",
  authConfig: {
    authorizationUrl: "https://api.vercel.com/oauth/authorize",
    tokenUrl: "https://api.vercel.com/oauth/token",
    scopes: ["vercel.read","vercel.write"],
    pkce: false,
    offlineAccess: true,
  },
  rateLimit: {
    requestsPerMinute: 60,
    requestsPerHour: 1000,
  },
  requiredEnvVars: ["VERCEL_CLIENT_ID", "VERCEL_CLIENT_SECRET"],
  capabilities: [
    {
      operationId: "vercel_search",
      name: "Search items in Vercel",
      description: "Search items in Vercel",
      requiredScopes: ["vercel.read","vercel.write"],
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
      operationId: "vercel_create",
      name: "Create a new item in Vercel",
      description: "Create a new item in Vercel",
      requiredScopes: ["vercel.read","vercel.write"],
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
