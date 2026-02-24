import type { ConnectorManifest } from "../../kernel/types";

export const stripeManifest: ConnectorManifest = {
  connectorId: "stripe",
  version: "1.0.0",
  displayName: "Stripe",
  category: "general" as any,
  description: "Advanced AI integration for Stripe",
  iconUrl: "/assets/icons/stripe.svg",
  authType: "oauth2",
  authConfig: {
    authorizationUrl: "https://api.stripe.com/oauth/authorize",
    tokenUrl: "https://api.stripe.com/oauth/token",
    scopes: ["stripe.read","stripe.write"],
    pkce: false,
    offlineAccess: true,
  },
  rateLimit: {
    requestsPerMinute: 60,
    requestsPerHour: 1000,
  },
  requiredEnvVars: ["STRIPE_CLIENT_ID", "STRIPE_CLIENT_SECRET"],
  capabilities: [
    {
      operationId: "stripe_search",
      name: "Search items in Stripe",
      description: "Search items in Stripe",
      requiredScopes: ["stripe.read","stripe.write"],
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
      operationId: "stripe_create",
      name: "Create a new item in Stripe",
      description: "Create a new item in Stripe",
      requiredScopes: ["stripe.read","stripe.write"],
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
