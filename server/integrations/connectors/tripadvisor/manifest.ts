import type { ConnectorManifest } from "../../kernel/types";

export const tripadvisorManifest: ConnectorManifest = {
  connectorId: "tripadvisor",
  version: "1.0.0",
  displayName: "Tripadvisor",
  category: "general" as any,
  description: "Advanced AI integration for Tripadvisor",
  iconUrl: "/assets/icons/tripadvisor.svg",
  authType: "oauth2",
  authConfig: {
    authorizationUrl: "https://api.tripadvisor.com/oauth/authorize",
    tokenUrl: "https://api.tripadvisor.com/oauth/token",
    scopes: ["tripadvisor.read","tripadvisor.write"],
    pkce: false,
    offlineAccess: true,
  },
  rateLimit: {
    requestsPerMinute: 60,
    requestsPerHour: 1000,
  },
  requiredEnvVars: ["TRIPADVISOR_CLIENT_ID", "TRIPADVISOR_CLIENT_SECRET"],
  capabilities: [
    {
      operationId: "tripadvisor_search",
      name: "Search items in Tripadvisor",
      description: "Search items in Tripadvisor",
      requiredScopes: ["tripadvisor.read","tripadvisor.write"],
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
      operationId: "tripadvisor_create",
      name: "Create a new item in Tripadvisor",
      description: "Create a new item in Tripadvisor",
      requiredScopes: ["tripadvisor.read","tripadvisor.write"],
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
