interface ParsedToolCall {
  id: string;
  name: string;
  arguments: string;
}

const TOOL_NAME_ALIASES: Record<string, string> = {
  "fetch_url": "web_fetch",
  "search": "web_search",
  "search_web": "web_search",
  "execute_bash": "bash",
  "shell": "bash",
  "terminal": "bash",
  "file_read": "read_file",
  "file_write": "write_file",
  "file_edit": "edit_file",
  "file_list": "list_files",
  "dir_list": "list_files",
  "code_run": "run_code",
  "execute_code": "run_code",
  "grep": "grep_search",
  "search_files": "grep_search",
};

function resolveToolName(name: string, availableTools: Set<string>): string | null {
  if (availableTools.has(name)) return name;
  const aliased = TOOL_NAME_ALIASES[name];
  if (aliased && availableTools.has(aliased)) return aliased;
  const lower = name.toLowerCase();
  for (const t of availableTools) {
    if (t.toLowerCase() === lower) return t;
  }
  return null;
}

const TOOL_CALL_PATTERNS = [
  /```(?:json)?\s*\{[\s\S]*?"(?:name|function|tool)"[\s\S]*?\}[\s\S]*?```/gi,
  /<tool_call>\s*([\s\S]*?)\s*<\/tool_call>/gi,
  /\{\s*"(?:name|function_call|tool_call)"\s*:\s*"([^"]+)"[\s\S]*?\}/gi,
];

function tryParseJSON(text: string): any | null {
  try {
    const cleaned = text.replace(/```json\s*/gi, "").replace(/```\s*/gi, "").trim();
    return JSON.parse(cleaned);
  } catch {
    return null;
  }
}

export function parseToolCallsFromText(
  text: string,
  availableTools: Set<string>
): ParsedToolCall[] {
  if (!text || text.length < 10) return [];

  const results: ParsedToolCall[] = [];
  let idCounter = 0;

  const jsonBlockRegex = /```(?:json)?\s*(\{[\s\S]*?\})\s*```/gi;
  let match: RegExpExecArray | null;
  while ((match = jsonBlockRegex.exec(text)) !== null) {
    const parsed = tryParseJSON(match[1]);
    if (parsed && extractToolCall(parsed, availableTools, results, idCounter)) {
      idCounter++;
    }
  }
  if (results.length > 0) return results;

  const xmlRegex = /<tool_call>\s*([\s\S]*?)\s*<\/tool_call>/gi;
  while ((match = xmlRegex.exec(text)) !== null) {
    const parsed = tryParseJSON(match[1]);
    if (parsed && extractToolCall(parsed, availableTools, results, idCounter)) {
      idCounter++;
    }
  }
  if (results.length > 0) return results;

  const actionRegex = /Action:\s*(\w+)\s*\nAction Input:\s*(\{[\s\S]*?\})/gi;
  while ((match = actionRegex.exec(text)) !== null) {
    const resolved = resolveToolName(match[1].trim(), availableTools);
    if (resolved) {
      const parsed = tryParseJSON(match[2]);
      if (parsed) {
        results.push({
          id: `parsed_tc_${idCounter++}`,
          name: resolved,
          arguments: JSON.stringify(parsed),
        });
      }
    }
  }
  if (results.length > 0) return results;

  const inlineJsonRegex = /\{\s*"(?:name|function|tool)"\s*:\s*"([^"]+)"[^}]*"(?:arguments|parameters|params|input)"\s*:\s*(\{[^}]*\})/gi;
  while ((match = inlineJsonRegex.exec(text)) !== null) {
    const resolved = resolveToolName(match[1].trim(), availableTools);
    if (resolved) {
      const parsed = tryParseJSON(match[2]);
      results.push({
        id: `parsed_tc_${idCounter++}`,
        name: resolved,
        arguments: parsed ? JSON.stringify(parsed) : match[2],
      });
    }
  }

  return results;
}

function extractToolCall(
  parsed: any,
  availableTools: Set<string>,
  results: ParsedToolCall[],
  idCounter: number
): boolean {
  const rawName = parsed.name || parsed.function || parsed.tool || parsed.tool_call || parsed.function_call;
  if (!rawName) return false;
  const name = resolveToolName(rawName, availableTools);
  if (!name) return false;

  const args = parsed.arguments || parsed.parameters || parsed.params || parsed.input || parsed.args || {};
  const argsStr = typeof args === "string" ? args : JSON.stringify(args);

  results.push({
    id: `parsed_tc_${idCounter}`,
    name,
    arguments: argsStr,
  });
  return true;
}

export function buildToolCallingSystemPrompt(toolSchemas: Array<{ name: string; description: string; parameters: any }>): string {
  const toolDefs = toolSchemas.map(t => {
    const params = t.parameters?.properties
      ? Object.entries(t.parameters.properties).map(([k, v]: [string, any]) => {
          const req = t.parameters.required?.includes(k) ? " (required)" : "";
          return `    - ${k}: ${v.type || "string"}${req} — ${v.description || ""}`;
        }).join("\n")
      : "    (no parameters)";
    return `- **${t.name}**: ${t.description}\n  Parameters:\n${params}`;
  }).join("\n\n");

  return `You have access to the following tools. To use a tool, respond with a JSON block inside a code fence:

\`\`\`json
{"name": "tool_name", "arguments": {"param1": "value1"}}
\`\`\`

You can call multiple tools by including multiple JSON blocks. After each tool executes, you will receive the results and can continue reasoning or call more tools.

IMPORTANT: Always use the exact tool names listed below. Always include required parameters.

Available tools:
${toolDefs}

When you need to take an action, USE A TOOL. Do not tell the user to do things manually — execute the action yourself using the tools above.`;
}

export function stripToolCallsFromText(text: string): string {
  let cleaned = text;
  cleaned = cleaned.replace(/```(?:json)?\s*\{[\s\S]*?"(?:name|function|tool)"[\s\S]*?\}\s*```/gi, "");
  cleaned = cleaned.replace(/<tool_call>[\s\S]*?<\/tool_call>/gi, "");
  cleaned = cleaned.replace(/Action:\s*\w+\s*\nAction Input:\s*\{[\s\S]*?\}/gi, "");
  return cleaned.trim();
}
