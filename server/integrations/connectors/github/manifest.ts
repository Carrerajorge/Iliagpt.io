import type { ConnectorManifest } from "../../kernel/types";

export const githubManifest: ConnectorManifest = {
  connectorId: "github",
  version: "1.0.0",
  displayName: "GitHub",
  category: "dev" as any,
  description: "Advanced AI integration for GitHub",
  iconUrl: "/assets/icons/github.svg",
  authType: "oauth2",
  authConfig: {
    authorizationUrl: "https://github.com/login/oauth/authorize",
    tokenUrl: "https://github.com/login/oauth/access_token",
    scopes: ["repo","read:user"],
    pkce: false,
    offlineAccess: true,
  },
  rateLimit: {
    requestsPerMinute: 60,
    requestsPerHour: 1000,
  },
  requiredEnvVars: ["GITHUB_CLIENT_ID", "GITHUB_CLIENT_SECRET"],
  capabilities: [
    {
      operationId: "github_search_issues",
      name: "Search for issues and pull requests",
      description: "Search for issues and pull requests",
      requiredScopes: ["repo","read:user"],
      dataAccessLevel: "read",
      confirmationRequired: false,
      idempotent: true,
      inputSchema: {
        type: "object",
        properties: {
          "q": {
                    "type": "string"
          }
},
        required: ["q"]
      },
      outputSchema: { type: "object", properties: {} }
    },
    {
      operationId: "github_create_issue",
      name: "Create an issue",
      description: "Create an issue",
      requiredScopes: ["repo","read:user"],
      dataAccessLevel: "write",
      confirmationRequired: true,
      idempotent: false,
      inputSchema: {
        type: "object",
        properties: {
          "owner": {
                    "type": "string"
          },
          "repo": {
                    "type": "string"
          },
          "title": {
                    "type": "string"
          },
          "body": {
                    "type": "string"
          }
},
        required: ["owner","repo","title"]
      },
      outputSchema: { type: "object", properties: {} }
    }
  ]
};
