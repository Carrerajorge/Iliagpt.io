import { createRestHandler } from "../../kernel/baseConnectorHandler";
import { gmailManifest } from "./manifest";

const API_BASE = "https://gmail.googleapis.com/gmail/v1/users/me";

export const handler = createRestHandler(gmailManifest, API_BASE, {
  gmail_search: {
    path: "/messages",
    method: "GET",
  },
  gmail_fetch: {
    path: "/messages/{messageId}",
    method: "GET",
  },
  gmail_send: {
    path: "/messages/send",
    method: "POST",
  },
  gmail_mark_read: {
    path: "/messages/{messageId}/modify",
    method: "POST",
  },
  gmail_labels: {
    path: "/labels",
    method: "GET",
  },
}, {
  onBeforeRequest: async (req, operationId, input) => {
    if (operationId === "gmail_search") {
      if (!req.query.has("maxResults")) {
        req.query.set("maxResults", "10");
      }
    }

    if (operationId === "gmail_send") {
      // Gmail send API expects a base64url-encoded RFC 2822 message
      const to = input.to as string;
      const subject = input.subject as string;
      const body = input.body as string;
      const cc = input.cc as string | undefined;

      const headers = [
        `To: ${to}`,
        `Subject: ${subject}`,
        `Content-Type: text/plain; charset=utf-8`,
      ];
      if (cc) headers.push(`Cc: ${cc}`);

      const rawMessage = `${headers.join("\r\n")}\r\n\r\n${body}`;
      const encoded = Buffer.from(rawMessage)
        .toString("base64")
        .replace(/\+/g, "-")
        .replace(/\//g, "_")
        .replace(/=+$/, "");

      req.body = { raw: encoded };
      if (input.threadId) {
        req.body.threadId = input.threadId;
      }
    }

    if (operationId === "gmail_mark_read") {
      req.body = { removeLabelIds: ["UNREAD"] };
    }
  },
});
