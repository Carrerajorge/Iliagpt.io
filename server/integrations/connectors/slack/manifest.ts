import type { ConnectorManifest } from "../../kernel/types";

export const slackManifest: ConnectorManifest = {
  connectorId: "slack",
  version: "1.0.0",
  displayName: "Slack",
  category: "comms",
  authType: "oauth2",
  authConfig: {
    authorizationUrl: "https://slack.com/oauth/v2/authorize",
    tokenUrl: "https://slack.com/api/oauth.v2.access",
    scopes: [
      "channels:read",
      "channels:history",
      "chat:write",
      "search:read",
      "users:read",
    ],
    pkce: false,
    offlineAccess: false,
  },
  rateLimit: {
    requestsPerMinute: 30,
    requestsPerHour: 500,
  },
  requiredEnvVars: ["SLACK_CLIENT_ID", "SLACK_CLIENT_SECRET"],
  capabilities: [
    {
      operationId: "slack_post_message",
      description: "Post a message to a Slack channel or thread",
      confirmationRequired: true,
      inputSchema: {
        type: "object" as const,
        description: "Parameters for posting a message to a Slack channel",
        properties: {
          channel: {
            type: "string",
            description:
              "The ID of the channel to post the message to (e.g. C01ABCDEF)",
          },
          text: {
            type: "string",
            description: "The text content of the message to post",
          },
          thread_ts: {
            type: "string",
            description:
              "Optional timestamp of a parent message to reply in a thread",
          },
        },
        required: ["channel", "text"],
      },
    },
    {
      operationId: "slack_list_channels",
      description: "List public and private channels the bot has access to",
      inputSchema: {
        type: "object" as const,
        description: "Parameters for listing Slack channels",
        properties: {
          limit: {
            type: "number",
            description:
              "Maximum number of channels to return (default 100, max 1000)",
          },
          cursor: {
            type: "string",
            description:
              "Pagination cursor returned from a previous request for the next page",
          },
        },
        required: [],
      },
    },
    {
      operationId: "slack_read_messages",
      description: "Read message history from a Slack channel",
      inputSchema: {
        type: "object" as const,
        description: "Parameters for reading channel message history",
        properties: {
          channel: {
            type: "string",
            description: "The ID of the channel to read messages from",
          },
          limit: {
            type: "number",
            description:
              "Maximum number of messages to return (default 20, max 1000)",
          },
          oldest: {
            type: "string",
            description:
              "Only messages after this Unix timestamp (inclusive) are returned",
          },
          latest: {
            type: "string",
            description:
              "Only messages before this Unix timestamp (inclusive) are returned",
          },
        },
        required: ["channel"],
      },
    },
    {
      operationId: "slack_search_messages",
      description: "Search for messages across all channels using a query string",
      inputSchema: {
        type: "object" as const,
        description: "Parameters for searching Slack messages",
        properties: {
          query: {
            type: "string",
            description:
              "The search query string (supports Slack search modifiers)",
          },
          count: {
            type: "number",
            description:
              "Number of results to return per page (default 20, max 100)",
          },
        },
        required: ["query"],
      },
    },
  ],
};
