import type { ConnectorManifest } from "../../kernel/types";

export const applemusicManifest: ConnectorManifest = {
  connectorId: "apple-music",
  version: "1.0.0",
  displayName: "Apple Music",
  category: "lifestyle" as any,
  authType: "oauth2",
  authConfig: {
    authorizationUrl: "https://example.com/oauth/authorize",
    tokenUrl: "https://example.com/oauth/token",
    scopes: ["read"],
    pkce: false,
    offlineAccess: true,
  },
  rateLimit: {
    requestsPerMinute: 60,
    requestsPerHour: 1000,
  },
  requiredEnvVars: ["APPLE_MUSIC_CLIENT_ID", "APPLE_MUSIC_CLIENT_SECRET"],
  capabilities: [
    {
      operationId: "apple_music_get_status",
      description: "Get current status or basic info for Apple Music",
      inputSchema: {
        type: "object",
        properties: {},
        required: [],
      },
    },
  ],
};
