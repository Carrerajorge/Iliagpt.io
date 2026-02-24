import type { ConnectorManifest } from "../../kernel/types";

export const boxManifest: ConnectorManifest = {
  connectorId: "box",
  version: "1.0.0",
  displayName: "Box",
  category: "productivity" as any,
  description: "Advanced AI integration for Box",
  iconUrl: "/assets/icons/box.svg",
  authType: "oauth2",
  authConfig: {
    authorizationUrl: "https://account.box.com/api/oauth2/authorize",
    tokenUrl: "https://api.box.com/oauth2/token",
    scopes: ["root_readwrite"],
    pkce: false,
    offlineAccess: true,
  },
  rateLimit: {
    requestsPerMinute: 60,
    requestsPerHour: 1000,
  },
  requiredEnvVars: ["BOX_CLIENT_ID", "BOX_CLIENT_SECRET"],
  capabilities: [
    {
      operationId: "box_search_files",
      name: "Search for files and folders in Box",
      description: "Search for files and folders in Box",
      requiredScopes: ["root_readwrite"],
      dataAccessLevel: "read",
      confirmationRequired: false,
      idempotent: true,
      inputSchema: {
        type: "object",
        properties: {
          "query": {
                    "type": "string"
          }
},
        required: ["query"]
      },
      outputSchema: { type: "object", properties: {} }
    }
  ]
};
