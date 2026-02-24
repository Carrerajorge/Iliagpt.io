import { google, gmail_v1 } from "googleapis";
import { storage } from "../storage";
import type { GmailOAuthToken } from "@shared/schema";
import { sanitizePlainText } from "../lib/textSanitizers";

export type GmailUserId = string;

export const GMAIL_SCOPES = [
  "https://www.googleapis.com/auth/gmail.readonly",
  "https://www.googleapis.com/auth/gmail.send",
  "https://www.googleapis.com/auth/gmail.modify",
  "https://www.googleapis.com/auth/gmail.labels",
];

export async function getGmailClientForUser(userId: GmailUserId): Promise<gmail_v1.Gmail> {
  const token = await storage.getGmailOAuthToken(userId);
  if (!token) {
    throw new Error("Gmail not connected for this user");
  }
  return getGmailClient(token);
}

export async function getGmailClient(token: GmailOAuthToken): Promise<gmail_v1.Gmail> {
  const oauth2Client = new google.auth.OAuth2(
    process.env.GOOGLE_CLIENT_ID,
    process.env.GOOGLE_CLIENT_SECRET
  );

  oauth2Client.setCredentials({
    access_token: token.accessToken,
    refresh_token: token.refreshToken,
    expiry_date: token.expiresAt.getTime(),
  });

  // Refresh if expiring within 60s
  if (token.expiresAt.getTime() < Date.now() + 60_000) {
    const { credentials } = await oauth2Client.refreshAccessToken();
    await storage.updateGmailOAuthToken(token.userId, {
      accessToken: credentials.access_token!,
      expiresAt: new Date(credentials.expiry_date!),
    });
    oauth2Client.setCredentials(credentials);
  }

  return google.gmail({ version: "v1", auth: oauth2Client });
}

export function getHeader(headers: gmail_v1.Schema$MessagePartHeader[] | undefined, name: string): string {
  return headers?.find(h => h.name?.toLowerCase() === name.toLowerCase())?.value || "";
}

export function extractBody(payload: gmail_v1.Schema$MessagePart | undefined): { text: string; html: string } {
  let text = "";
  let html = "";

  function traverse(part: gmail_v1.Schema$MessagePart) {
    if (part.mimeType === "text/plain" && part.body?.data) {
      text += Buffer.from(part.body.data, "base64").toString("utf-8");
    } else if (part.mimeType === "text/html" && part.body?.data) {
      html += Buffer.from(part.body.data, "base64").toString("utf-8");
    }
    if (part.parts) part.parts.forEach(traverse);
  }

  if (payload) traverse(payload);
  return { text, html };
}

export async function gmailSearch(gmail: gmail_v1.Gmail, args: { query: string; maxResults?: number }) {
  const maxResults = args.maxResults ?? 20;
  const response = await gmail.users.messages.list({
    userId: "me",
    maxResults,
    q: args.query,
  });

  const emails: any[] = [];
  for (const msg of (response.data.messages || []).slice(0, maxResults)) {
    const fullMsg = await gmail.users.messages.get({
      userId: "me",
      id: msg.id!,
      format: "metadata",
      metadataHeaders: ["From", "To", "Subject", "Date"],
    });

    const headers = fullMsg.data.payload?.headers;
    emails.push({
      id: msg.id,
      threadId: msg.threadId,
      subject: getHeader(headers, "Subject") || "(No subject)",
      from: getHeader(headers, "From"),
      to: getHeader(headers, "To"),
      date: getHeader(headers, "Date"),
      snippet: fullMsg.data.snippet,
      labels: fullMsg.data.labelIds,
    });
  }

  return { emails, count: emails.length };
}

export async function gmailFetchThread(gmail: gmail_v1.Gmail, args: { threadId: string }) {
  const thread = await gmail.users.threads.get({
    userId: "me",
    id: args.threadId,
    format: "full",
  });

  const messages: any[] = [];
  for (const msg of thread.data.messages || []) {
    const headers = msg.payload?.headers;
    const body = extractBody(msg.payload);

    messages.push({
      id: msg.id,
      from: getHeader(headers, "From"),
      to: getHeader(headers, "To"),
      subject: getHeader(headers, "Subject"),
      date: getHeader(headers, "Date"),
      body: body.text || sanitizePlainText(body.html, { maxLen: 20000, collapseWs: true }),
      snippet: msg.snippet,
    });
  }

  return { threadId: args.threadId, subject: messages[0]?.subject, messages };
}

export async function gmailSend(
  gmail: gmail_v1.Gmail,
  args: { to: string; subject: string; body: string; threadId?: string }
) {
  const profile = await gmail.users.getProfile({ userId: "me" });
  const from = profile.data.emailAddress;

  const rawLines = [
    `From: ${from}`,
    `To: ${args.to}`,
    `Subject: ${args.subject}`,
    "Content-Type: text/plain; charset=\"UTF-8\"",
    "",
    args.body,
  ];

  const raw = Buffer.from(rawLines.join("\r\n"))
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");

  const message: gmail_v1.Schema$Message = {
    raw,
    threadId: args.threadId,
  };

  const sent = await gmail.users.messages.send({
    userId: "me",
    requestBody: message,
  });

  return { id: sent.data.id, threadId: sent.data.threadId };
}

export async function gmailMarkRead(gmail: gmail_v1.Gmail, args: { messageId: string }) {
  const updated = await gmail.users.messages.modify({
    userId: "me",
    id: args.messageId,
    requestBody: {
      removeLabelIds: ["UNREAD"],
    },
  });

  return { id: updated.data.id, labelIds: updated.data.labelIds };
}

export async function gmailLabels(gmail: gmail_v1.Gmail) {
  const res = await gmail.users.labels.list({ userId: "me" });
  return { labels: res.data.labels || [] };
}
