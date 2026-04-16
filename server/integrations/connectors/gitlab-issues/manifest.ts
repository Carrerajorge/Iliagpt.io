import type { ConnectorManifest } from "../../kernel/types";

export const gitlabissuesManifest: ConnectorManifest = {
  connectorId: "gitlab-issues",
  version: "1.0.0",
  displayName: "Gitlab Issues",
  category: "general" as any,
  description: "Advanced AI integration for Gitlab Issues",
  iconUrl: "/assets/icons/gitlab-issues.svg",
  authType: "oauth2",
  authConfig: {
    authorizationUrl: "https://api.gitlabissues.com/oauth/authorize",
    tokenUrl: "https://api.gitlabissues.com/oauth/token",
    scopes: ["gitlab_issues.read","gitlab_issues.write"],
    pkce: false,
    offlineAccess: true,
  },
  rateLimit: {
    requestsPerMinute: 60,
    requestsPerHour: 1000,
  },
  requiredEnvVars: ["GITLAB_ISSUES_CLIENT_ID", "GITLAB_ISSUES_CLIENT_SECRET"],
  capabilities: [
    {
      operationId: "gitlab_issues_search",
      name: "Search items in Gitlab Issues",
      description: "Search items in Gitlab Issues",
      requiredScopes: ["gitlab_issues.read","gitlab_issues.write"],
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
      operationId: "gitlab_issues_create",
      name: "Create a new item in Gitlab Issues",
      description: "Create a new item in Gitlab Issues",
      requiredScopes: ["gitlab_issues.read","gitlab_issues.write"],
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
