import type { ConnectorManifest } from "../../kernel/types";

export const lovableManifest: ConnectorManifest = {
  connectorId: "lovable",
  version: "1.0.0",
  displayName: "Lovable",
  category: "general" as any,
  description: "Advanced AI integration for Lovable",
  iconUrl: "/assets/icons/lovable.svg",
  authType: "oauth2",
  authConfig: {
    authorizationUrl: "https://api.lovable.com/oauth/authorize",
    tokenUrl: "https://api.lovable.com/oauth/token",
    scopes: ["lovable.read","lovable.write"],
    pkce: false,
    offlineAccess: true,
  },
  rateLimit: {
    requestsPerMinute: 60,
    requestsPerHour: 1000,
  },
  requiredEnvVars: ["LOVABLE_CLIENT_ID", "LOVABLE_CLIENT_SECRET"],
  capabilities: [
    {
      operationId: "lovable_search",
      name: "Search items in Lovable",
      description: "Search items in Lovable",
      requiredScopes: ["lovable.read","lovable.write"],
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
      operationId: "lovable_create",
      name: "Create a new item in Lovable",
      description: "Create a new item in Lovable",
      requiredScopes: ["lovable.read","lovable.write"],
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
