import type { ConnectorManifest } from "../../kernel/types";

export const opentableManifest: ConnectorManifest = {
  connectorId: "opentable",
  version: "1.0.0",
  displayName: "Opentable",
  category: "general" as any,
  description: "Advanced AI integration for Opentable",
  iconUrl: "/assets/icons/opentable.svg",
  authType: "oauth2",
  authConfig: {
    authorizationUrl: "https://api.opentable.com/oauth/authorize",
    tokenUrl: "https://api.opentable.com/oauth/token",
    scopes: ["opentable.read","opentable.write"],
    pkce: false,
    offlineAccess: true,
  },
  rateLimit: {
    requestsPerMinute: 60,
    requestsPerHour: 1000,
  },
  requiredEnvVars: ["OPENTABLE_CLIENT_ID", "OPENTABLE_CLIENT_SECRET"],
  capabilities: [
    {
      operationId: "opentable_search",
      name: "Search items in Opentable",
      description: "Search items in Opentable",
      requiredScopes: ["opentable.read","opentable.write"],
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
      operationId: "opentable_create",
      name: "Create a new item in Opentable",
      description: "Create a new item in Opentable",
      requiredScopes: ["opentable.read","opentable.write"],
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
