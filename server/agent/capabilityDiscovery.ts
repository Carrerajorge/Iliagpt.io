import { AGENT_TOOLS as CONFIG_TOOLS } from "../config/agentTools";
import { AGENT_TOOLS as ENGINE_TOOLS } from "../agents/toolEngine";

export type TaskCategory =
  | "research"
  | "file-ops"
  | "web-automation"
  | "code-analysis"
  | "data-processing"
  | "document-creation"
  | "system-ops"
  | "memory-retrieval"
  | "communication"
  | "unknown";

export interface ToolRecommendation {
  toolName: string;
  reason: string;
  priority: number;
}

export interface CapabilityMatch {
  categories: TaskCategory[];
  recommendedTools: ToolRecommendation[];
  toolChain: string[][];
  confidence: number;
  fallbackSuggestion?: string;
}

interface TaskPattern {
  category: TaskCategory;
  keywords: RegExp[];
  tools: ToolRecommendation[];
  chains: string[][];
}

const TASK_PATTERNS: TaskPattern[] = [
  {
    category: "research",
    keywords: [
      /\b(search|find|look\s?up|research|investigate|discover|what\s+is|who\s+is|when\s+did|how\s+to)\b/i,
      /\b(latest|current|recent|news|trending|update)\b/i,
      /\b(compare|difference|versus|vs\.?)\b/i,
    ],
    tools: [
      { toolName: "web_search", reason: "Search for information on the topic", priority: 1 },
      { toolName: "fetch_url", reason: "Fetch detailed content from search results", priority: 2 },
      { toolName: "openclaw_rag_search", reason: "Check local knowledge base for relevant info", priority: 3 },
    ],
    chains: [
      ["web_search", "fetch_url", "analyze_data"],
      ["openclaw_rag_search", "web_search", "fetch_url"],
    ],
  },
  {
    category: "file-ops",
    keywords: [
      /\b(read|write|edit|create|delete|move|copy|rename|list)\s+(file|document|folder|directory)\b/i,
      /\b(file|folder|directory|path)\b/i,
      /\.(txt|json|csv|xml|yaml|yml|md|log|conf|cfg)\b/i,
    ],
    tools: [
      { toolName: "list_files", reason: "List directory contents to find target files", priority: 1 },
      { toolName: "read_file", reason: "Read file contents for analysis or modification", priority: 2 },
      { toolName: "bash", reason: "Perform file system operations", priority: 3 },
    ],
    chains: [
      ["list_files", "read_file"],
      ["list_files", "read_file", "write_file"],
      ["list_files", "read_file", "edit_file"],
    ],
  },
  {
    category: "web-automation",
    keywords: [
      /\b(browse|navigate|click|fill|submit|login|sign\s?in|book|reserve|purchase|order)\b/i,
      /\b(website|webpage|web\s?page|site|portal|form)\b/i,
      /\b(scrape|crawl|extract\s+from\s+web)\b/i,
    ],
    tools: [
      { toolName: "browse_and_act", reason: "Interact with websites using AI-driven browser", priority: 1 },
      { toolName: "fetch_url", reason: "Fetch webpage content without interaction", priority: 2 },
      { toolName: "web_search", reason: "Find the target website URL", priority: 3 },
    ],
    chains: [
      ["web_search", "browse_and_act"],
      ["web_search", "fetch_url"],
      ["fetch_url", "analyze_data"],
    ],
  },
  {
    category: "code-analysis",
    keywords: [
      /\b(code|script|program|function|class|module|debug|fix|refactor|optimize)\b/i,
      /\b(python|javascript|typescript|java|rust|go|ruby|php|sql)\b/i,
      /\b(compile|build|test|run|execute|lint)\b/i,
      /\b(bug|error|exception|stack\s?trace|crash)\b/i,
    ],
    tools: [
      { toolName: "read_file", reason: "Read source code files", priority: 1 },
      { toolName: "run_code", reason: "Execute code for testing or computation", priority: 2 },
      { toolName: "bash", reason: "Run build/test commands", priority: 3 },
      { toolName: "edit_file", reason: "Modify source code files", priority: 4 },
    ],
    chains: [
      ["read_file", "run_code"],
      ["read_file", "edit_file", "run_code"],
      ["list_files", "read_file", "edit_file", "bash"],
    ],
  },
  {
    category: "data-processing",
    keywords: [
      /\b(analyze|analysis|statistics|data|dataset|csv|excel|spreadsheet)\b/i,
      /\b(chart|graph|plot|visuali[sz]e|visualization)\b/i,
      /\b(aggregate|summarize|trend|forecast|predict|correlat)\b/i,
      /\b(average|mean|median|sum|count|min|max|distribution)\b/i,
    ],
    tools: [
      { toolName: "analyze_data", reason: "Perform statistical analysis on data", priority: 1 },
      { toolName: "generate_chart", reason: "Create visual charts and graphs", priority: 2 },
      { toolName: "run_code", reason: "Run custom data processing scripts", priority: 3 },
      { toolName: "read_file", reason: "Read data files for processing", priority: 4 },
    ],
    chains: [
      ["read_file", "analyze_data", "generate_chart"],
      ["read_file", "run_code", "generate_chart"],
      ["fetch_url", "analyze_data", "generate_chart"],
    ],
  },
  {
    category: "document-creation",
    keywords: [
      /\b(create|generate|make|build|write)\s+(document|presentation|spreadsheet|report|ppt|pptx|docx|xlsx)\b/i,
      /\b(slide|presentation|powerpoint|keynote)\b/i,
      /\b(word\s+doc|document|report|memo|letter)\b/i,
      /\b(spreadsheet|workbook|excel|table)\b/i,
    ],
    tools: [
      { toolName: "create_presentation", reason: "Create PowerPoint presentations", priority: 1 },
      { toolName: "create_document", reason: "Create Word documents", priority: 2 },
      { toolName: "create_spreadsheet", reason: "Create Excel spreadsheets", priority: 3 },
    ],
    chains: [
      ["web_search", "fetch_url", "create_document"],
      ["web_search", "fetch_url", "create_presentation"],
      ["analyze_data", "create_spreadsheet"],
      ["read_file", "create_document"],
    ],
  },
  {
    category: "system-ops",
    keywords: [
      /\b(process|service|daemon|port|pid|cpu|memory|disk|system)\b/i,
      /\b(install|update|upgrade|restart|stop|start|kill)\b/i,
      /\b(server|container|docker|kubernetes|deploy)\b/i,
    ],
    tools: [
      { toolName: "process_list", reason: "List and inspect running processes", priority: 1 },
      { toolName: "port_check", reason: "Check port usage and availability", priority: 2 },
      { toolName: "bash", reason: "Execute system administration commands", priority: 3 },
    ],
    chains: [
      ["process_list", "bash"],
      ["port_check", "process_list", "bash"],
      ["bash"],
    ],
  },
  {
    category: "memory-retrieval",
    keywords: [
      /\b(remember|recall|previous|earlier|last\s+time|history|conversation)\b/i,
      /\b(context|memory|stored|saved|knowledge\s+base)\b/i,
    ],
    tools: [
      { toolName: "memory_search", reason: "Search semantic memory from prior sessions", priority: 1 },
      { toolName: "openclaw_rag_search", reason: "Search document and conversation knowledge base", priority: 2 },
    ],
    chains: [
      ["memory_search"],
      ["openclaw_rag_search"],
      ["memory_search", "openclaw_rag_search"],
    ],
  },
];

const ALL_KNOWN_TOOLS = new Set<string>();
function initKnownTools() {
  if (ALL_KNOWN_TOOLS.size > 0) return;
  for (const t of CONFIG_TOOLS) ALL_KNOWN_TOOLS.add(t.name);
  for (const t of ENGINE_TOOLS) {
    const name = (t as any).function?.name || (t as any).name;
    if (name) ALL_KNOWN_TOOLS.add(name);
  }
}

function classifyTask(taskDescription: string): { category: TaskCategory; score: number }[] {
  const results: { category: TaskCategory; score: number }[] = [];

  for (const pattern of TASK_PATTERNS) {
    let matchCount = 0;
    for (const kw of pattern.keywords) {
      if (kw.test(taskDescription)) matchCount++;
    }
    if (matchCount > 0) {
      const score = matchCount / pattern.keywords.length;
      results.push({ category: pattern.category, score });
    }
  }

  results.sort((a, b) => b.score - a.score);
  return results;
}

export function discoverCapabilities(taskDescription: string): CapabilityMatch {
  initKnownTools();

  const classifications = classifyTask(taskDescription);

  if (classifications.length === 0) {
    return {
      categories: ["unknown"],
      recommendedTools: [
        { toolName: "web_search", reason: "General-purpose information gathering", priority: 1 },
        { toolName: "bash", reason: "Flexible command execution fallback", priority: 2 },
      ],
      toolChain: [["web_search"]],
      confidence: 0.1,
      fallbackSuggestion:
        "Could not determine specific task type. Consider breaking down the request into smaller, more specific subtasks.",
    };
  }

  const topCategories = classifications.filter((c) => c.score >= classifications[0].score * 0.5);
  const categories = topCategories.map((c) => c.category);

  const toolMap = new Map<string, ToolRecommendation>();
  const chains: string[][] = [];

  for (const cls of topCategories) {
    const pattern = TASK_PATTERNS.find((p) => p.category === cls.category);
    if (!pattern) continue;

    for (const tool of pattern.tools) {
      const existing = toolMap.get(tool.toolName);
      if (!existing || tool.priority < existing.priority) {
        toolMap.set(tool.toolName, { ...tool });
      }
    }

    for (const chain of pattern.chains) {
      if (!chains.some((c) => c.join(",") === chain.join(","))) {
        chains.push(chain);
      }
    }
  }

  const recommendedTools = Array.from(toolMap.values()).sort((a, b) => a.priority - b.priority);

  const unavailable = recommendedTools.filter((t) => !ALL_KNOWN_TOOLS.has(t.toolName));
  let fallbackSuggestion: string | undefined;
  if (unavailable.length > 0) {
    fallbackSuggestion = `Tools not currently available: ${unavailable.map((t) => t.toolName).join(", ")}. Consider composing available tools as alternatives.`;
  }

  const confidence = Math.min(classifications[0].score * 1.2, 1.0);

  return {
    categories,
    recommendedTools,
    toolChain: chains.slice(0, 3),
    confidence,
    fallbackSuggestion,
  };
}

export function getToolsForCategories(categories: TaskCategory[]): string[] {
  const tools = new Set<string>();
  for (const cat of categories) {
    const pattern = TASK_PATTERNS.find((p) => p.category === cat);
    if (pattern) {
      for (const t of pattern.tools) {
        tools.add(t.toolName);
      }
    }
  }
  return Array.from(tools);
}

export function suggestToolComposition(
  taskDescription: string,
  availableTools: string[]
): { canSolve: boolean; composition: string[]; explanation: string } {
  const match = discoverCapabilities(taskDescription);
  const needed = match.recommendedTools.map((t) => t.toolName);
  const available = new Set(availableTools);

  const missing = needed.filter((t) => !available.has(t));

  if (missing.length === 0) {
    const bestChain =
      match.toolChain.find((chain) => chain.every((t) => available.has(t))) || needed;
    return {
      canSolve: true,
      composition: bestChain,
      explanation: `Task can be solved using: ${bestChain.join(" → ")}`,
    };
  }

  const alternativeChain = match.toolChain.find((chain) => chain.every((t) => available.has(t)));

  if (alternativeChain) {
    return {
      canSolve: true,
      composition: alternativeChain,
      explanation: `Using alternative tool chain: ${alternativeChain.join(" → ")} (missing: ${missing.join(", ")})`,
    };
  }

  const partialTools = needed.filter((t) => available.has(t));
  return {
    canSolve: partialTools.length > 0,
    composition: partialTools,
    explanation: partialTools.length > 0
      ? `Partial solution with: ${partialTools.join(" → ")}. Missing tools: ${missing.join(", ")}`
      : `Cannot solve: missing all required tools (${missing.join(", ")})`,
  };
}

export function selectToolsForSubtask(subtaskDescription: string): string[] {
  const match = discoverCapabilities(subtaskDescription);
  return match.recommendedTools.map((t) => t.toolName);
}
