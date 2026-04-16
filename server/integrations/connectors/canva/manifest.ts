import type { ConnectorManifest } from "../../kernel/types";

export const canvaManifest: ConnectorManifest = {
  connectorId: "canva",
  version: "1.0.0",
  displayName: "Canva",
  category: "productivity" as any,
  description: "Advanced AI integration for Canva",
  iconUrl: "/assets/icons/canva.svg",
  authType: "oauth2",
  authConfig: {
    authorizationUrl: "https://www.canva.com/api/oauth/authorize",
    tokenUrl: "https://api.canva.com/rest/v1/oauth/token",
    scopes: ["design:content:read","design:meta:read"],
    pkce: false,
    offlineAccess: true,
  },
  rateLimit: {
    requestsPerMinute: 60,
    requestsPerHour: 1000,
  },
  requiredEnvVars: ["CANVA_CLIENT_ID", "CANVA_CLIENT_SECRET"],
  capabilities: [
    {
      operationId: "canva_list_designs",
      name: "List all designs",
      description: "List all designs",
      requiredScopes: ["design:content:read","design:meta:read"],
      dataAccessLevel: "read",
      confirmationRequired: false,
      idempotent: true,
      inputSchema: {
        type: "object",
        properties: {},
        required: []
      },
      outputSchema: { type: "object", properties: {} }
    }
  ]
};
