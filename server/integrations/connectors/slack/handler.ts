import { createRestHandler } from "../../kernel/baseConnectorHandler";
import { slackManifest } from "./manifest";

const SLACK_API = "https://slack.com/api";

export const handler = createRestHandler(
  slackManifest,
  SLACK_API,
  {
    slack_post_message: { path: "/chat.postMessage", method: "POST" },
    slack_list_channels: { path: "/conversations.list", method: "GET" },
    slack_read_messages: { path: "/conversations.history", method: "GET" },
    slack_search_messages: { path: "/search.messages", method: "GET" },
  },
  {
    onAfterResponse: async (res, data) => {
      // Slack uses 200 OK but sets data.ok = false for API errors
      if (!res.ok || data.ok === false) {
        return {
          success: false,
          error: {
            code: "SLACK_ERROR",
            message: data.error ?? `Slack API error (${res.status})`,
            retryable: res.status >= 500 || res.status === 429,
          },
        };
      }
      return { success: true, data };
    },
  }
);
