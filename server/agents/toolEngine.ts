import { bashToolSchema, executeBashTool } from "./tools/bashTool";
import { webFetchToolSchema, executeWebFetchTool } from "./tools/webFetchTool";
import { webSearchToolSchema, executeWebSearchTool } from "./tools/webSearchTool";
import {
  readFileToolSchema, writeFileToolSchema, editFileToolSchema, listFilesToolSchema, grepSearchToolSchema,
  executeReadFile, executeWriteFile, executeEditFile, executeListFiles, executeGrepSearch
} from "./tools/fsTool";
import {
  processListToolSchema, portCheckToolSchema,
  executeProcessList, executePortCheck
} from "./tools/processTool";
import { codeToolSchema, executeCodeTool } from "./tools/codeTool";

export interface ToolCall {
  id: string;
  type: "function";
  function: {
    name: string;
    arguments: string;
  };
}

export interface ToolResult {
  tool_call_id: string;
  role: "tool";
  content: string;
}

export const AGENT_TOOLS = [
  bashToolSchema,
  webFetchToolSchema,
  webSearchToolSchema,
  readFileToolSchema,
  writeFileToolSchema,
  editFileToolSchema,
  listFilesToolSchema,
  grepSearchToolSchema,
  codeToolSchema,
  processListToolSchema,
  portCheckToolSchema,
];

export const MAX_TOOL_ITERATIONS = 15;

export async function executeToolCall(
  toolCall: ToolCall,
  onStatus?: (msg: string) => void
): Promise<ToolResult> {
  const { name, arguments: argsStr } = toolCall.function;
  let args: any;

  try {
    args = JSON.parse(argsStr);
  } catch {
    return {
      tool_call_id: toolCall.id,
      role: "tool",
      content: JSON.stringify({ error: "Invalid JSON arguments" })
    };
  }

  let result: any;

  try {
    switch (name) {
      case "bash":
        onStatus?.(`Executing: \`${(args.command || "").slice(0, 80)}\``);
        result = await executeBashTool(args);
        break;

      case "web_fetch":
        onStatus?.(`Fetching: ${(args.url || "").slice(0, 80)}`);
        result = await executeWebFetchTool(args);
        break;

      case "web_search":
        onStatus?.(`Searching: "${(args.query || "").slice(0, 60)}"`);
        result = await executeWebSearchTool(args);
        break;

      case "read_file":
        onStatus?.(`Reading: ${args.file_path}`);
        result = await executeReadFile(args);
        break;

      case "write_file":
        onStatus?.(`Writing: ${args.file_path}`);
        result = await executeWriteFile(args);
        break;

      case "edit_file":
        onStatus?.(`Editing: ${args.file_path}`);
        result = await executeEditFile(args);
        break;

      case "list_files":
        onStatus?.(`Listing: ${args.directory || "."}`);
        result = await executeListFiles(args);
        break;

      case "run_code":
        onStatus?.(`Running ${args.language || "code"}...`);
        result = await executeCodeTool(args);
        break;

      case "grep_search":
        onStatus?.(`Searching: "${(args.pattern || "").slice(0, 60)}"${args.directory ? ` in ${args.directory}` : ""}`);
        result = await executeGrepSearch(args);
        break;

      case "process_list":
        onStatus?.(`Listing processes${args.filter ? ` matching "${args.filter}"` : ""}...`);
        result = await executeProcessList(args);
        break;

      case "port_check":
        onStatus?.(`Checking ${args.port ? `port ${args.port}` : "all ports"}...`);
        result = await executePortCheck(args);
        break;

      default:
        result = { error: `Unknown tool: ${name}` };
    }
  } catch (err: any) {
    result = { error: `Tool execution failed: ${err.message}` };
  }

  const contentStr = typeof result === "string" ? result : JSON.stringify(result, null, 2);
  const truncated = contentStr.length > 50000
    ? contentStr.slice(0, 50000) + "\n... [truncated]"
    : contentStr;

  return {
    tool_call_id: toolCall.id,
    role: "tool",
    content: truncated
  };
}

export function getToolSchemas() {
  return AGENT_TOOLS;
}
