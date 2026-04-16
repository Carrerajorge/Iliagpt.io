import type { ConnectorManifest } from "../../kernel/types";

export const huggingfaceManifest: ConnectorManifest = {
  connectorId: "hugging-face",
  version: "1.0.0",
  displayName: "Hugging Face",
  category: "general" as any,
  description: "Advanced AI integration for Hugging Face",
  iconUrl: "/assets/icons/hugging-face.svg",
  authType: "oauth2",
  authConfig: {
    authorizationUrl: "https://api.huggingface.com/oauth/authorize",
    tokenUrl: "https://api.huggingface.com/oauth/token",
    scopes: ["hugging_face.read","hugging_face.write"],
    pkce: false,
    offlineAccess: true,
  },
  rateLimit: {
    requestsPerMinute: 60,
    requestsPerHour: 1000,
  },
  requiredEnvVars: ["HUGGING_FACE_CLIENT_ID", "HUGGING_FACE_CLIENT_SECRET"],
  capabilities: [
    {
      operationId: "hugging_face_search",
      name: "Search items in Hugging Face",
      description: "Search items in Hugging Face",
      requiredScopes: ["hugging_face.read","hugging_face.write"],
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
      operationId: "hugging_face_create",
      name: "Create a new item in Hugging Face",
      description: "Create a new item in Hugging Face",
      requiredScopes: ["hugging_face.read","hugging_face.write"],
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
