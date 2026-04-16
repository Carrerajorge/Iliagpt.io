import type { ConnectorHandlerFactory } from "../../kernel/connectorRegistry";
import type {
  ResolvedCredential,
  ConnectorOperationResult,
} from "../../kernel/types";
import { createRestHandler } from "../../kernel/baseConnectorHandler";
import { notionManifest } from "./manifest";

const NOTION_API = "https://api.notion.com/v1";
const NOTION_VERSION = "2022-06-28";

function notionHeaders(credential: ResolvedCredential): Record<string, string> {
  return {
    Authorization: `Bearer ${credential.accessToken}`,
    "Notion-Version": NOTION_VERSION,
    "Content-Type": "application/json",
  };
}

async function notionFetch(
  method: "GET" | "POST" | "PATCH",
  path: string,
  credential: ResolvedCredential,
  body?: Record<string, unknown>,
): Promise<ConnectorOperationResult> {
  const url = `${NOTION_API}${path}`;
  const init: RequestInit = {
    method,
    headers: notionHeaders(credential),
  };

  if (body && (method === "POST" || method === "PATCH")) {
    init.body = JSON.stringify(body);
  }

  const res = await fetch(url, init);
  const data = await res.json();

  if (!res.ok) {
    return {
      success: false,
      error: data.message ?? data.code ?? `Notion API error (${res.status})`,
      data: undefined,
    };
  }

  return { success: true, data };
}

function textToBlocks(text: string): Array<Record<string, unknown>> {
  return text.split("\n").map((line) => ({
    object: "block",
    type: "paragraph",
    paragraph: { rich_text: [{ type: "text", text: { content: line } }] },
  }));
}

const baseHandler = createRestHandler(
  notionManifest,
  NOTION_API,
  {
    notion_search: { path: "/search", method: "POST" },
    notion_query_database: { path: "/databases/{database_id}/query", method: "POST" },
    notion_list_databases: { path: "/search", method: "POST" },
  },
  {
    onBeforeRequest: (req, operationId, input) => {
      req.headers["Notion-Version"] = NOTION_VERSION;
      if (operationId === "notion_list_databases") {
        req.body = { ...req.body, filter: { property: "object", value: "database" } };
      }
    },
  }
);

export const handler: ConnectorHandlerFactory = {
  async execute(
    operationId: string,
    params: Record<string, unknown>,
    credential: ResolvedCredential,
  ): Promise<ConnectorOperationResult> {

    // Delegate simple endpoints to the new generic base handler
    if (["notion_search", "notion_query_database", "notion_list_databases"].includes(operationId)) {
      return baseHandler.execute(operationId, params, credential);
    }

    switch (operationId) {
      /* ── Read page (properties + block children) ───────── */
      case "notion_read_page": {
        const pageId = String(params.pageId);
        const [pageResult, blocksResult] = await Promise.all([
          notionFetch("GET", `/pages/${pageId}`, credential),
          notionFetch("GET", `/blocks/${pageId}/children?page_size=100`, credential),
        ]);

        if (!pageResult.success) return pageResult;
        if (!blocksResult.success) return blocksResult;

        return {
          success: true,
          data: {
            page: pageResult.data,
            blocks: (blocksResult.data as Record<string, unknown>).results,
          },
        };
      }

      /* ── Create a new page ─────────────────────────────── */
      case "notion_create_page": {
        const parentId = String(params.parent_id);
        const title = String(params.title);
        const content = params.content ? String(params.content) : undefined;

        const body: Record<string, unknown> = {
          parent: { page_id: parentId },
          properties: {
            title: { title: [{ type: "text", text: { content: title } }] },
          },
        };

        if (content) {
          body.children = textToBlocks(content);
        }

        const result = await notionFetch("POST", "/pages", credential, body);

        if (!result.success && result.error && String(result.error).includes("validation_error")) {
          (body.parent as Record<string, unknown>) = { database_id: parentId };
          return notionFetch("POST", "/pages", credential, body);
        }

        return result;
      }

      default:
        return {
          success: false,
          error: `Unknown Notion operation: ${operationId}`,
          data: undefined,
        };
    }
  },
};
