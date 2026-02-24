import type { ConnectorManifest } from "../../kernel/types";

export const pitchbookManifest: ConnectorManifest = {
  connectorId: "pitchbook",
  version: "1.0.0",
  displayName: "Pitchbook",
  category: "general" as any,
  description: "Advanced AI integration for Pitchbook",
  iconUrl: "/assets/icons/pitchbook.svg",
  authType: "oauth2",
  authConfig: {
    authorizationUrl: "https://api.pitchbook.com/oauth/authorize",
    tokenUrl: "https://api.pitchbook.com/oauth/token",
    scopes: ["pitchbook.read","pitchbook.write"],
    pkce: false,
    offlineAccess: true,
  },
  rateLimit: {
    requestsPerMinute: 60,
    requestsPerHour: 1000,
  },
  requiredEnvVars: ["PITCHBOOK_CLIENT_ID", "PITCHBOOK_CLIENT_SECRET"],
  capabilities: [
    {
      operationId: "pitchbook_search",
      name: "Search items in Pitchbook",
      description: "Search items in Pitchbook",
      requiredScopes: ["pitchbook.read","pitchbook.write"],
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
      operationId: "pitchbook_create",
      name: "Create a new item in Pitchbook",
      description: "Create a new item in Pitchbook",
      requiredScopes: ["pitchbook.read","pitchbook.write"],
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
