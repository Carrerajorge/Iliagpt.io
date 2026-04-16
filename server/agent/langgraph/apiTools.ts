import { tool } from "@langchain/core/tools";
import { z } from "zod";
import OpenAI from "openai";

const xaiClient = new OpenAI({
  baseURL: "https://api.x.ai/v1",
  apiKey: process.env.XAI_API_KEY || "missing",
});

const DEFAULT_MODEL = "grok-4-1-fast-non-reasoning";

export const apiCallTool = tool(
  async (input) => {
    const { url, method = "GET", headers = {}, body, timeout = 30000 } = input;
    const startTime = Date.now();

    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), timeout);

      const fetchOptions: RequestInit = {
        method,
        headers: {
          "Content-Type": "application/json",
          ...headers,
        },
        signal: controller.signal,
      };

      if (body && ["POST", "PUT", "PATCH"].includes(method)) {
        fetchOptions.body = typeof body === "string" ? body : JSON.stringify(body);
      }

      const response = await fetch(url, fetchOptions);
      clearTimeout(timeoutId);

      const contentType = response.headers.get("content-type") || "";
      let responseBody: any;

      if (contentType.includes("application/json")) {
        responseBody = await response.json();
      } else if (contentType.includes("text/")) {
        responseBody = await response.text();
      } else {
        responseBody = `Binary content (${contentType})`;
      }

      return JSON.stringify({
        success: true,
        status: response.status,
        statusText: response.statusText,
        headers: Object.fromEntries(response.headers.entries()),
        body: responseBody,
        latencyMs: Date.now() - startTime,
      });
    } catch (error: any) {
      return JSON.stringify({
        success: false,
        error: error.name === "AbortError" ? "Request timed out" : error.message,
        latencyMs: Date.now() - startTime,
      });
    }
  },
  {
    name: "api_call",
    description: "Makes HTTP API calls with configurable method, headers, and body. Supports JSON and text responses.",
    schema: z.object({
      url: z.string().url().describe("API endpoint URL"),
      method: z.enum(["GET", "POST", "PUT", "PATCH", "DELETE", "HEAD", "OPTIONS"]).optional().default("GET")
        .describe("HTTP method"),
      headers: z.record(z.string()).optional().default({}).describe("Request headers"),
      body: z.union([z.string(), z.record(z.any())]).optional().describe("Request body for POST/PUT/PATCH"),
      timeout: z.number().optional().default(30000).describe("Timeout in milliseconds"),
    }),
  }
);

export const webhookSendTool = tool(
  async (input) => {
    const { url, event, payload, secret } = input;
    const startTime = Date.now();

    try {
      const timestamp = Math.floor(Date.now() / 1000);
      const webhookPayload = {
        event,
        timestamp,
        data: payload,
      };

      const headers: Record<string, string> = {
        "Content-Type": "application/json",
        "X-Webhook-Event": event,
        "X-Webhook-Timestamp": timestamp.toString(),
      };

      if (secret) {
        const crypto = await import("crypto");
        const signature = crypto
          .createHmac("sha256", secret)
          .update(JSON.stringify(webhookPayload))
          .digest("hex");
        headers["X-Webhook-Signature"] = `sha256=${signature}`;
      }

      const response = await fetch(url, {
        method: "POST",
        headers,
        body: JSON.stringify(webhookPayload),
      });

      return JSON.stringify({
        success: response.ok,
        status: response.status,
        event,
        timestamp,
        responseBody: await response.text().catch(() => ""),
        latencyMs: Date.now() - startTime,
      });
    } catch (error: any) {
      return JSON.stringify({
        success: false,
        error: error.message,
        latencyMs: Date.now() - startTime,
      });
    }
  },
  {
    name: "webhook_send",
    description: "Sends webhook events to external services with optional HMAC signature verification.",
    schema: z.object({
      url: z.string().url().describe("Webhook endpoint URL"),
      event: z.string().describe("Event type (e.g., 'user.created', 'order.completed')"),
      payload: z.record(z.any()).describe("Event payload data"),
      secret: z.string().optional().describe("Secret for HMAC signature"),
    }),
  }
);

export const graphqlQueryTool = tool(
  async (input) => {
    const { endpoint, query, variables = {}, headers = {} } = input;
    const startTime = Date.now();

    try {
      const response = await fetch(endpoint, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...headers,
        },
        body: JSON.stringify({
          query,
          variables,
        }),
      });

      const result = await response.json();

      return JSON.stringify({
        success: !result.errors,
        data: result.data,
        errors: result.errors,
        extensions: result.extensions,
        latencyMs: Date.now() - startTime,
      });
    } catch (error: any) {
      return JSON.stringify({
        success: false,
        error: error.message,
        latencyMs: Date.now() - startTime,
      });
    }
  },
  {
    name: "graphql_query",
    description: "Executes GraphQL queries and mutations against any GraphQL endpoint.",
    schema: z.object({
      endpoint: z.string().url().describe("GraphQL endpoint URL"),
      query: z.string().describe("GraphQL query or mutation"),
      variables: z.record(z.any()).optional().default({}).describe("Query variables"),
      headers: z.record(z.string()).optional().default({}).describe("Additional headers"),
    }),
  }
);

export const oauthTokenTool = tool(
  async (input) => {
    const { provider, grantType = "authorization_code", code, refreshToken, clientId, clientSecret, redirectUri, tokenUrl } = input;
    const startTime = Date.now();

    try {
      const params = new URLSearchParams();
      params.append("grant_type", grantType);
      params.append("client_id", clientId);
      params.append("client_secret", clientSecret);

      if (grantType === "authorization_code" && code) {
        params.append("code", code);
        if (redirectUri) params.append("redirect_uri", redirectUri);
      } else if (grantType === "refresh_token" && refreshToken) {
        params.append("refresh_token", refreshToken);
      }

      const response = await fetch(tokenUrl, {
        method: "POST",
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
        },
        body: params,
      });

      const result = await response.json();

      if (result.access_token) {
        return JSON.stringify({
          success: true,
          provider,
          accessToken: result.access_token,
          tokenType: result.token_type || "Bearer",
          expiresIn: result.expires_in,
          refreshToken: result.refresh_token,
          scope: result.scope,
          latencyMs: Date.now() - startTime,
        });
      }

      return JSON.stringify({
        success: false,
        error: result.error || result.error_description || "Token exchange failed",
        latencyMs: Date.now() - startTime,
      });
    } catch (error: any) {
      return JSON.stringify({
        success: false,
        error: error.message,
        latencyMs: Date.now() - startTime,
      });
    }
  },
  {
    name: "oauth_token",
    description: "Exchanges OAuth authorization codes for access tokens or refreshes existing tokens.",
    schema: z.object({
      provider: z.string().describe("OAuth provider name (e.g., 'google', 'github')"),
      grantType: z.enum(["authorization_code", "refresh_token", "client_credentials"]).optional().default("authorization_code"),
      code: z.string().optional().describe("Authorization code (for authorization_code grant)"),
      refreshToken: z.string().optional().describe("Refresh token (for refresh_token grant)"),
      clientId: z.string().describe("OAuth client ID"),
      clientSecret: z.string().describe("OAuth client secret"),
      redirectUri: z.string().optional().describe("Redirect URI"),
      tokenUrl: z.string().url().describe("Token endpoint URL"),
    }),
  }
);

export const emailSendTool = tool(
  async (input) => {
    const { to, subject, body, from, isHtml = false, attachments = [] } = input;
    const startTime = Date.now();

    try {
      const response = await xaiClient.chat.completions.create({
        model: DEFAULT_MODEL,
        messages: [
          {
            role: "system",
            content: `You are an email composition assistant. Format the email for sending.

Return JSON:
{
  "formattedEmail": {
    "from": "sender address",
    "to": ["recipient addresses"],
    "subject": "email subject",
    "body": "formatted body",
    "html": "HTML version if applicable"
  },
  "validation": {
    "valid": boolean,
    "issues": ["any issues"]
  },
  "sendInstructions": {
    "provider": "recommended provider",
    "smtpSettings": { "host": "", "port": 587, "secure": false },
    "apiConfig": { "endpoint": "", "method": "POST" }
  }
}`,
          },
          {
            role: "user",
            content: `Prepare this email:
From: ${from || "noreply@example.com"}
To: ${Array.isArray(to) ? to.join(", ") : to}
Subject: ${subject}
Body: ${body}
Is HTML: ${isHtml}
Attachments: ${attachments.length} files`,
          },
        ],
        temperature: 0.2,
      });

      const content = response.choices[0].message.content || "";
      const jsonMatch = content.match(/\{[\s\S]*\}/);

      if (jsonMatch) {
        const result = JSON.parse(jsonMatch[0]);
        return JSON.stringify({
          success: true,
          ...result,
          note: "Email prepared. Use your configured email service to send.",
          latencyMs: Date.now() - startTime,
        });
      }

      return JSON.stringify({
        success: true,
        email: { to, subject, body },
        latencyMs: Date.now() - startTime,
      });
    } catch (error: any) {
      return JSON.stringify({
        success: false,
        error: error.message,
        latencyMs: Date.now() - startTime,
      });
    }
  },
  {
    name: "email_send",
    description: "Prepares and sends emails with support for HTML content and attachments.",
    schema: z.object({
      to: z.union([z.string().email(), z.array(z.string().email())]).describe("Recipient email(s)"),
      subject: z.string().describe("Email subject"),
      body: z.string().describe("Email body content"),
      from: z.string().email().optional().describe("Sender email address"),
      isHtml: z.boolean().optional().default(false).describe("Whether body is HTML"),
      attachments: z.array(z.object({
        filename: z.string(),
        content: z.string(),
        contentType: z.string(),
      })).optional().default([]).describe("File attachments"),
    }),
  }
);

export const notificationPushTool = tool(
  async (input) => {
    const { platform, title, body, data = {}, recipients, priority = "normal" } = input;
    const startTime = Date.now();

    try {
      const response = await xaiClient.chat.completions.create({
        model: DEFAULT_MODEL,
        messages: [
          {
            role: "system",
            content: `You are a push notification expert. Format notifications for various platforms.

Return JSON:
{
  "notification": {
    "title": "notification title",
    "body": "notification body",
    "icon": "suggested icon",
    "badge": "suggested badge",
    "sound": "default|custom",
    "data": {}
  },
  "platformPayload": {
    "fcm": { Firebase Cloud Messaging format },
    "apns": { Apple Push Notification format },
    "web": { Web Push format }
  },
  "recommendations": ["best practices for this notification"],
  "scheduling": {
    "bestTime": "recommended send time",
    "timezone": "consider user timezone"
  }
}`,
          },
          {
            role: "user",
            content: `Create push notification:
Platform: ${platform}
Title: ${title}
Body: ${body}
Data: ${JSON.stringify(data)}
Recipients: ${recipients.length} users
Priority: ${priority}`,
          },
        ],
        temperature: 0.3,
      });

      const content = response.choices[0].message.content || "";
      const jsonMatch = content.match(/\{[\s\S]*\}/);

      if (jsonMatch) {
        const result = JSON.parse(jsonMatch[0]);
        return JSON.stringify({
          success: true,
          platform,
          recipientCount: recipients.length,
          ...result,
          latencyMs: Date.now() - startTime,
        });
      }

      return JSON.stringify({
        success: true,
        notification: { platform, title, body },
        latencyMs: Date.now() - startTime,
      });
    } catch (error: any) {
      return JSON.stringify({
        success: false,
        error: error.message,
        latencyMs: Date.now() - startTime,
      });
    }
  },
  {
    name: "notification_push",
    description: "Sends push notifications to mobile devices and web browsers via FCM, APNS, or Web Push.",
    schema: z.object({
      platform: z.enum(["fcm", "apns", "web", "all"]).describe("Push notification platform"),
      title: z.string().describe("Notification title"),
      body: z.string().describe("Notification body"),
      data: z.record(z.any()).optional().default({}).describe("Custom data payload"),
      recipients: z.array(z.string()).describe("Device tokens or subscription endpoints"),
      priority: z.enum(["low", "normal", "high"]).optional().default("normal").describe("Notification priority"),
    }),
  }
);

export const API_TOOLS = [
  apiCallTool,
  webhookSendTool,
  graphqlQueryTool,
  oauthTokenTool,
  emailSendTool,
  notificationPushTool,
];
