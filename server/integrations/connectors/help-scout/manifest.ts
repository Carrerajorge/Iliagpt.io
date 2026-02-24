import type { ConnectorManifest } from "../../kernel/types";

export const helpscoutManifest: ConnectorManifest = {
  connectorId: "help-scout",
  version: "1.0.0",
  displayName: "Help Scout",
  category: "general" as any,
  description: "Advanced AI integration for Help Scout",
  iconUrl: "/assets/icons/help-scout.svg",
  authType: "oauth2",
  authConfig: {
    authorizationUrl: "https://api.helpscout.com/oauth/authorize",
    tokenUrl: "https://api.helpscout.com/oauth/token",
    scopes: ["help_scout.read","help_scout.write"],
    pkce: false,
    offlineAccess: true,
  },
  rateLimit: {
    requestsPerMinute: 60,
    requestsPerHour: 1000,
  },
  requiredEnvVars: ["HELP_SCOUT_CLIENT_ID", "HELP_SCOUT_CLIENT_SECRET"],
  capabilities: [
    {
      operationId: "help_scout_search",
      name: "Search items in Help Scout",
      description: "Search items in Help Scout",
      requiredScopes: ["help_scout.read","help_scout.write"],
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
      operationId: "help_scout_create",
      name: "Create a new item in Help Scout",
      description: "Create a new item in Help Scout",
      requiredScopes: ["help_scout.read","help_scout.write"],
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
