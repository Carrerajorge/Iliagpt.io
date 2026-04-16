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
  "run_command": "bash",
  "exec": "bash",
  "execute": "bash",
  "cmd": "bash",
  "file_read": "read_file",
  "file_write": "write_file",
  "file_edit": "edit_file",
  "file_list": "list_files",
  "dir_list": "list_files",
  "ls": "list_files",
  "code_run": "run_code",
  "execute_code": "run_code",
  "python": "run_code",
  "javascript": "run_code",
  "grep": "grep_search",
  "search_files": "grep_search",
  "find_in_files": "grep_search",
  "ripgrep": "grep_search",
  "browse": "browse_and_act",
  "browser": "browse_and_act",
  "open_url": "browse_and_act",
  "navigate": "browse_and_act",
  "web_browse": "browse_and_act",
  "search_memory": "memory_search",
  "recall": "memory_search",
  "remember": "memory_search",
};

function resolveToolName(name: string, availableTools: Set<string>): string | null {
  if (availableTools.has(name)) return name;
  const aliased = TOOL_NAME_ALIASES[name];
  if (aliased && availableTools.has(aliased)) return aliased;
  const lower = name.toLowerCase();
  for (const t of availableTools) {
    if (t.toLowerCase() === lower) return t;
  }
  const underscored = lower.replace(/[-\s]/g, "_");
  for (const t of availableTools) {
    if (t.toLowerCase().replace(/[-\s]/g, "_") === underscored) return t;
  }
  return null;
}

function repairJSON(text: string): any | null {
  let cleaned = text
    .replace(/```json\s*/gi, "")
    .replace(/```\s*/gi, "")
    .replace(/,\s*([}\]])/g, "$1")
    .replace(/([{,]\s*)(\w+)\s*:/g, '$1"$2":')
    .replace(/:\s*'([^']*)'/g, ':"$1"')
    .replace(/\n/g, "\\n")
    .trim();

  try { return JSON.parse(cleaned); } catch {}

  cleaned = text.replace(/```json\s*/gi, "").replace(/```\s*/gi, "").trim();
  const braceStart = cleaned.indexOf("{");
  const braceEnd = cleaned.lastIndexOf("}");
  if (braceStart >= 0 && braceEnd > braceStart) {
    const extracted = cleaned.slice(braceStart, braceEnd + 1);
    try { return JSON.parse(extracted); } catch {}
    try {
      const fixed = extracted
        .replace(/,\s*([}\]])/g, "$1")
        .replace(/([{,]\s*)(\w+)\s*:/g, '$1"$2":');
      return JSON.parse(fixed);
    } catch {}
  }
  return null;
}

function tryParseJSON(text: string): any | null {
  try {
    const cleaned = text.replace(/```json\s*/gi, "").replace(/```\s*/gi, "").trim();
    return JSON.parse(cleaned);
  } catch {
    return repairJSON(text);
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

  const hermesRegex = /<tool_call>\s*([\s\S]*?)\s*<\/tool_call>/gi;
  while ((match = hermesRegex.exec(text)) !== null) {
    const parsed = tryParseJSON(match[1]);
    if (parsed && extractToolCall(parsed, availableTools, results, idCounter)) {
      idCounter++;
    }
  }
  if (results.length > 0) return results;

  const deepseekRegex = /✿FUNCTION✿\s*(\S+)\s*✿\s*([\s\S]*?)(?:✿|$)/gi;
  while ((match = deepseekRegex.exec(text)) !== null) {
    const toolName = match[1].trim();
    const resolved = resolveToolName(toolName, availableTools);
    if (resolved) {
      const parsed = tryParseJSON(match[2].trim());
      results.push({
        id: `parsed_tc_${idCounter++}`,
        name: resolved,
        arguments: parsed ? JSON.stringify(parsed) : match[2].trim(),
      });
    }
  }
  if (results.length > 0) return results;

  const functionaryRegex = />>>\s*(\w[\w.-]*)\s*\n\s*(\{[\s\S]*?\})/gi;
  while ((match = functionaryRegex.exec(text)) !== null) {
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

  const functionCallRegex = /<\|function_call\|>\s*(\{[\s\S]*?\})\s*(?:<\|\/function_call\|>|$)/gi;
  while ((match = functionCallRegex.exec(text)) !== null) {
    const parsed = tryParseJSON(match[1]);
    if (parsed && extractToolCall(parsed, availableTools, results, idCounter)) {
      idCounter++;
    }
  }
  if (results.length > 0) return results;

  const mistralRegex = /\[TOOL_CALLS?\]\s*\[?\s*(\{[\s\S]*?\})\s*\]?/gi;
  while ((match = mistralRegex.exec(text)) !== null) {
    const parsed = tryParseJSON(match[1]);
    if (parsed && extractToolCall(parsed, availableTools, results, idCounter)) {
      idCounter++;
    }
  }
  if (results.length > 0) return results;

  const actionRegex = /Action:\s*(\w[\w.-]*)\s*\n\s*(?:Action\s*Input|Input|Parameters?):\s*(\{[\s\S]*?\})/gi;
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

  const llamaToolRegex = /<function=(\w[\w.-]*)>\s*(\{[\s\S]*?\})\s*(?:<\/function>|$)/gi;
  while ((match = llamaToolRegex.exec(text)) !== null) {
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
  if (results.length > 0) return results;

  const bareToolCallRegex = /\b(\w[\w_-]*)\s*\(\s*(\{[\s\S]*?\})\s*\)/g;
  while ((match = bareToolCallRegex.exec(text)) !== null) {
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

  return results;
}

function extractToolCall(
  parsed: any,
  availableTools: Set<string>,
  results: ParsedToolCall[],
  idCounter: number
): boolean {
  const rawName = parsed.name || parsed.function || parsed.tool || parsed.tool_call || parsed.function_call || parsed.action;
  if (!rawName) return false;
  const name = resolveToolName(rawName, availableTools);
  if (!name) return false;

  const args = parsed.arguments || parsed.parameters || parsed.params || parsed.input || parsed.args || parsed.action_input || {};
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

Alternative formats also accepted:
- <tool_call>{"name": "tool_name", "arguments": {...}}</tool_call>
- Action: tool_name\\nAction Input: {...}
- <function=tool_name>{...}</function>

IMPORTANT: Always use the exact tool names listed below. Always include required parameters.

Available tools:
${toolDefs}

When you need to take an action, USE A TOOL. Do not tell the user to do things manually — execute the action yourself using the tools above.`;
}

export function stripToolCallsFromText(text: string): string {
  let cleaned = text;
  cleaned = cleaned.replace(/```(?:json)?\s*\{[\s\S]*?"(?:name|function|tool)"[\s\S]*?\}\s*```/gi, "");
  cleaned = cleaned.replace(/<tool_call>[\s\S]*?<\/tool_call>/gi, "");
  cleaned = cleaned.replace(/Action:\s*\w[\w.-]*\s*\n\s*(?:Action\s*Input|Input|Parameters?):\s*\{[\s\S]*?\}/gi, "");
  cleaned = cleaned.replace(/✿FUNCTION✿[\s\S]*?(?:✿|$)/gi, "");
  cleaned = cleaned.replace(/>>>\s*\w[\w.-]*\s*\n\s*\{[\s\S]*?\}/gi, "");
  cleaned = cleaned.replace(/<\|function_call\|>[\s\S]*?(?:<\|\/function_call\|>|$)/gi, "");
  cleaned = cleaned.replace(/\[TOOL_CALLS?\]\s*\[?\s*\{[\s\S]*?\}\s*\]?/gi, "");
  cleaned = cleaned.replace(/<function=\w[\w.-]*>[\s\S]*?(?:<\/function>|$)/gi, "");
  cleaned = cleaned.replace(/\b\w[\w_-]*\s*\(\s*\{[\s\S]*?\}\s*\)/g, (match) => {
    const nameMatch = match.match(/^(\w[\w_-]*)\s*\(/);
    if (nameMatch) {
      const name = nameMatch[1].toLowerCase();
      const toolLikeNames = ["bash","web_search","fetch_url","read_file","write_file","edit_file","list_files","run_code","grep_search","browse_and_act","analyze_data","generate_chart","process_list","port_check","memory_search","openclaw_rag_search","rag_index_document","shell","terminal","search","browse"];
      if (toolLikeNames.includes(name)) return "";
    }
    return match;
  });
  return cleaned.trim();
}
