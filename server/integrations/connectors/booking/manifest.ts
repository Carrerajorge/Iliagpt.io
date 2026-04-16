import type { ConnectorManifest } from "../../kernel/types";

export const bookingManifest: ConnectorManifest = {
  connectorId: "booking",
  version: "1.0.0",
  displayName: "Booking",
  category: "general" as any,
  description: "Advanced AI integration for Booking",
  iconUrl: "/assets/icons/booking.svg",
  authType: "oauth2",
  authConfig: {
    authorizationUrl: "https://api.booking.com/oauth/authorize",
    tokenUrl: "https://api.booking.com/oauth/token",
    scopes: ["booking.read","booking.write"],
    pkce: false,
    offlineAccess: true,
  },
  rateLimit: {
    requestsPerMinute: 60,
    requestsPerHour: 1000,
  },
  requiredEnvVars: ["BOOKING_CLIENT_ID", "BOOKING_CLIENT_SECRET"],
  capabilities: [
    {
      operationId: "booking_search",
      name: "Search items in Booking",
      description: "Search items in Booking",
      requiredScopes: ["booking.read","booking.write"],
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
      operationId: "booking_create",
      name: "Create a new item in Booking",
      description: "Create a new item in Booking",
      requiredScopes: ["booking.read","booking.write"],
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
