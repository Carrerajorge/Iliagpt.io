import type { ConnectorManifest } from "../../kernel/types";

export const notionManifest: ConnectorManifest = {
  connectorId: "notion",
  version: "1.0.0",
  displayName: "Notion",
  category: "productivity",
  authType: "oauth2",
  authConfig: {
    authorizationUrl: "https://api.notion.com/v1/oauth/authorize",
    tokenUrl: "https://api.notion.com/v1/oauth/token",
    scopes: [],
    pkce: false,
    offlineAccess: false,
    extraAuthParams: { owner: "user" },
  },
  rateLimit: {
    requestsPerMinute: 30,
    requestsPerHour: 500,
  },
  requiredEnvVars: ["NOTION_CLIENT_ID", "NOTION_CLIENT_SECRET"],
  capabilities: [
    {
      operationId: "notion_search",
      description: "Search across all pages and databases the integration can access",
      inputSchema: {
        type: "object" as const,
        description: "Parameters for searching Notion pages and databases",
        properties: {
          query: {
            type: "string",
            description: "The text to search for across page titles and content",
          },
          filter: {
            type: "object",
            description:
              'Optional filter to narrow results by object type (e.g. { "property": "object", "value": "page" })',
            properties: {
              property: {
                type: "string",
                description: 'The property to filter on (always "object")',
              },
              value: {
                type: "string",
                description: 'The object type to filter: "page" or "database"',
              },
            },
            required: ["property", "value"],
          },
          page_size: {
            type: "number",
            description: "Number of results to return (default 10, max 100)",
          },
        },
        required: ["query"],
      },
    },
    {
      operationId: "notion_read_page",
      description: "Read a Notion page's properties and block content",
      inputSchema: {
        type: "object" as const,
        description: "Parameters for reading a Notion page by its ID",
        properties: {
          pageId: {
            type: "string",
            description: "The UUID of the Notion page to read",
          },
        },
        required: ["pageId"],
      },
    },
    {
      operationId: "notion_create_page",
      description: "Create a new page under a parent page or database",
      confirmationRequired: true,
      inputSchema: {
        type: "object" as const,
        description: "Parameters for creating a new Notion page",
        properties: {
          parent_id: {
            type: "string",
            description:
              "The UUID of the parent page or database to create the page under",
          },
          title: {
            type: "string",
            description: "The title of the new page",
          },
          content: {
            type: "string",
            description:
              "Optional markdown-like text content for the page body",
          },
        },
        required: ["parent_id", "title"],
      },
    },
    {
      operationId: "notion_query_database",
      description: "Query a Notion database with optional filters and sorts",
      inputSchema: {
        type: "object" as const,
        description: "Parameters for querying a Notion database",
        properties: {
          database_id: {
            type: "string",
            description: "The UUID of the database to query",
          },
          filter: {
            type: "object",
            description:
              "Optional Notion filter object to narrow results (see Notion API filter docs)",
          },
          sorts: {
            type: "array",
            description:
              'Optional array of sort objects (e.g. [{ "property": "Created", "direction": "descending" }])',
            items: {
              type: "object",
              properties: {
                property: {
                  type: "string",
                  description: "The property name to sort by",
                },
                direction: {
                  type: "string",
                  description: '"ascending" or "descending"',
                },
              },
              required: ["property", "direction"],
            },
          },
          page_size: {
            type: "number",
            description: "Number of results to return (default 10, max 100)",
          },
        },
        required: ["database_id"],
      },
    },
    {
      operationId: "notion_list_databases",
      description: "List all databases the integration has access to",
      inputSchema: {
        type: "object" as const,
        description: "Parameters for listing accessible Notion databases",
        properties: {
          page_size: {
            type: "number",
            description: "Number of results to return (default 10, max 100)",
          },
        },
        required: [],
      },
    },
  ],
};
