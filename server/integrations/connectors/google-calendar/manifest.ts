import type { ConnectorManifest } from "../../kernel/types";

export const googlecalendarManifest: ConnectorManifest = {
  connectorId: "google-calendar",
  providerId: "google",
  version: "1.0.0",
  displayName: "Google Calendar",
  category: "general" as any,
  description: "View, search, and create events in Google Calendar",
  iconUrl: "/assets/icons/google-calendar.svg",
  authType: "oauth2",
  authConfig: {
    authorizationUrl: "https://accounts.google.com/o/oauth2/v2/auth",
    tokenUrl: "https://oauth2.googleapis.com/token",
    scopes: [
      "https://www.googleapis.com/auth/calendar.readonly",
      "https://www.googleapis.com/auth/calendar.events",
    ],
    pkce: false,
    offlineAccess: true,
  },
  rateLimit: {
    requestsPerMinute: 60,
    requestsPerHour: 1000,
  },
  requiredEnvVars: ["GOOGLE_CLIENT_ID", "GOOGLE_CLIENT_SECRET"],
  capabilities: [
    {
      operationId: "google_calendar_list_events",
      name: "List upcoming calendar events",
      description: "List events from the user's primary Google Calendar. Returns upcoming events ordered by start time. Use timeMin/timeMax to filter by date range.",
      requiredScopes: ["https://www.googleapis.com/auth/calendar.readonly"],
      dataAccessLevel: "read",
      confirmationRequired: false,
      idempotent: true,
      inputSchema: {
        type: "object",
        properties: {
          timeMin: {
            type: "string",
            description: "Lower bound (inclusive) for event start time as RFC3339 timestamp (e.g. '2026-04-07T00:00:00Z')",
          },
          timeMax: {
            type: "string",
            description: "Upper bound (exclusive) for event end time as RFC3339 timestamp",
          },
          maxResults: {
            type: "number",
            description: "Max events to return (1-250, default 10)",
          },
          q: {
            type: "string",
            description: "Free text search terms to find events matching text in summary, description, location, etc.",
          },
          singleEvents: {
            type: "boolean",
            description: "Whether to expand recurring events into instances (default true)",
          },
          orderBy: {
            type: "string",
            description: "Sort order: 'startTime' (default, requires singleEvents=true) or 'updated'",
          },
        },
        required: [],
      },
      outputSchema: { type: "object", properties: {} },
    },
    {
      operationId: "google_calendar_get_event",
      name: "Get a specific calendar event",
      description: "Get detailed information about a specific calendar event by its ID.",
      requiredScopes: ["https://www.googleapis.com/auth/calendar.readonly"],
      dataAccessLevel: "read",
      confirmationRequired: false,
      idempotent: true,
      inputSchema: {
        type: "object",
        properties: {
          eventId: {
            type: "string",
            description: "The event ID to retrieve",
          },
        },
        required: ["eventId"],
      },
      outputSchema: { type: "object", properties: {} },
    },
    {
      operationId: "google_calendar_create_event",
      name: "Create a new calendar event",
      description: "Create a new event in the user's primary Google Calendar with a summary, start/end time, and optional details.",
      requiredScopes: ["https://www.googleapis.com/auth/calendar.events"],
      dataAccessLevel: "write",
      confirmationRequired: true,
      idempotent: false,
      inputSchema: {
        type: "object",
        properties: {
          summary: {
            type: "string",
            description: "Event title",
          },
          description: {
            type: "string",
            description: "Event description",
          },
          location: {
            type: "string",
            description: "Event location",
          },
          startDateTime: {
            type: "string",
            description: "Event start as RFC3339 (e.g. '2026-04-10T14:00:00-05:00')",
          },
          endDateTime: {
            type: "string",
            description: "Event end as RFC3339 (e.g. '2026-04-10T15:00:00-05:00')",
          },
          startDate: {
            type: "string",
            description: "For all-day events: start date as YYYY-MM-DD",
          },
          endDate: {
            type: "string",
            description: "For all-day events: end date as YYYY-MM-DD (exclusive)",
          },
          attendees: {
            type: "string",
            description: "Comma-separated email addresses of attendees",
          },
          timeZone: {
            type: "string",
            description: "IANA time zone (e.g. 'America/Mexico_City'). Defaults to user's calendar timezone.",
          },
        },
        required: ["summary"],
      },
      outputSchema: { type: "object", properties: {} },
    },
    {
      operationId: "google_calendar_delete_event",
      name: "Delete a calendar event",
      description: "Delete an event from the user's primary Google Calendar by its ID.",
      requiredScopes: ["https://www.googleapis.com/auth/calendar.events"],
      dataAccessLevel: "write",
      confirmationRequired: true,
      idempotent: true,
      inputSchema: {
        type: "object",
        properties: {
          eventId: {
            type: "string",
            description: "The event ID to delete",
          },
        },
        required: ["eventId"],
      },
      outputSchema: { type: "object", properties: {} },
    },
  ],
};
