import type { ConnectorManifest } from "../../kernel/types";

export const hubspotManifest: ConnectorManifest = {
  connectorId: "hubspot",
  version: "1.0.0",
  displayName: "Hubspot",
  category: "general" as any,
  description: "Advanced AI integration for Hubspot",
  iconUrl: "/assets/icons/hubspot.svg",
  authType: "oauth2",
  authConfig: {
    authorizationUrl: "https://api.hubspot.com/oauth/authorize",
    tokenUrl: "https://api.hubspot.com/oauth/token",
    scopes: ["hubspot.read","hubspot.write"],
    pkce: false,
    offlineAccess: true,
  },
  rateLimit: {
    requestsPerMinute: 60,
    requestsPerHour: 1000,
  },
  requiredEnvVars: ["HUBSPOT_CLIENT_ID", "HUBSPOT_CLIENT_SECRET"],
  capabilities: [
    {
      operationId: "hubspot_search",
      name: "Search items in Hubspot",
      description: "Search items in Hubspot",
      requiredScopes: ["hubspot.read","hubspot.write"],
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
      operationId: "hubspot_create",
      name: "Create a new item in Hubspot",
      description: "Create a new item in Hubspot",
      requiredScopes: ["hubspot.read","hubspot.write"],
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
