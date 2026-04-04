/**
 * ContextualActions — suggests actionable buttons based on conversation state.
 * After code: "Run / Test / Deploy". After analysis: "Dig Deeper / Export".
 * After search: "Read Full / Save". Dynamic — changes with each response.
 */

import { createLogger } from "../utils/logger";

const logger = createLogger("ContextualActions");

// ─── Types ────────────────────────────────────────────────────────────────────

export type ActionCategory =
  | "code"
  | "document"
  | "search"
  | "analysis"
  | "memory"
  | "workflow"
  | "navigation"
  | "export"
  | "share";

export interface ContextualAction {
  id: string;
  label: string;
  icon?: string;                       // emoji or icon name
  category: ActionCategory;
  payload: Record<string, unknown>;
  primary?: boolean;                   // highlight as main CTA
  description?: string;                // tooltip text
  shortcut?: string;                   // keyboard shortcut hint
}

export interface ActionGroup {
  id: string;
  title: string;
  actions: ContextualAction[];
  collapseAfter?: number;              // show N actions, hide rest
}

export interface ConversationSnapshot {
  lastMessage: string;
  lastResponse: string;
  detectedLanguage?: string;
  hasCodeBlock: boolean;
  codeLanguages: string[];
  hasSearch: boolean;
  hasDocument: boolean;
  hasMath: boolean;
  hasError: boolean;
  isLongResponse: boolean;
  turnCount: number;
  topics: string[];
}

// ─── Response Analyzer ────────────────────────────────────────────────────────

function analyzeResponse(message: string, response: string): ConversationSnapshot {
  const codeBlockMatches = [...response.matchAll(/```(\w+)?\n/g)];
  const codeLanguages = codeBlockMatches
    .map((m) => m[1]?.toLowerCase() ?? "")
    .filter((l) => l.length > 0);

  const hasError = /\b(error|exception|traceback|failed|undefined|null)\b/i.test(message) ||
    /\b(error|exception|failed)\b/i.test(response);

  // Extract topic words from message
  const stopwords = new Set(["the", "a", "an", "i", "you", "we", "and", "or", "is", "in", "to"]);
  const topics = message
    .toLowerCase()
    .split(/\W+/)
    .filter((w) => w.length > 4 && !stopwords.has(w))
    .slice(0, 5);

  return {
    lastMessage: message,
    lastResponse: response,
    hasCodeBlock: codeBlockMatches.length > 0,
    codeLanguages,
    hasSearch: /\b(search|found|results|sources|websites|articles)\b/i.test(response),
    hasDocument: /\b(document|pdf|file|upload|attachment)\b/i.test(message + response),
    hasMath: /\b(formula|equation|\$[^$]+\$|\\frac|integral|sum|∑|∫|√)\b/.test(response),
    hasError,
    isLongResponse: response.length > 2000,
    turnCount: 1,
    topics,
    detectedLanguage: undefined,
  };
}

// ─── Action Generators ────────────────────────────────────────────────────────

function getCodeActions(snapshot: ConversationSnapshot): ContextualAction[] {
  const actions: ContextualAction[] = [];
  const lang = snapshot.codeLanguages[0] ?? "code";

  actions.push({
    id: "run_code",
    label: "Run",
    icon: "▶",
    category: "code",
    primary: true,
    payload: { action: "execute_code", language: lang },
    description: `Execute the ${lang} code`,
    shortcut: "Ctrl+Enter",
  });

  if (["python", "javascript", "typescript", "js", "ts"].includes(lang)) {
    actions.push({
      id: "test_code",
      label: "Generate Tests",
      icon: "🧪",
      category: "code",
      payload: { action: "generate_tests", language: lang },
      description: "Generate unit tests for this code",
    });
  }

  actions.push({
    id: "explain_code",
    label: "Explain",
    icon: "💡",
    category: "code",
    payload: { action: "explain_code" },
    description: "Step-by-step explanation of this code",
  });

  actions.push({
    id: "optimize_code",
    label: "Optimize",
    icon: "⚡",
    category: "code",
    payload: { action: "optimize_code", language: lang },
    description: "Suggest performance improvements",
  });

  if (snapshot.hasError) {
    actions.unshift({
      id: "fix_error",
      label: "Fix Error",
      icon: "🔧",
      category: "code",
      primary: true,
      payload: { action: "fix_error" },
      description: "Auto-diagnose and fix the error",
    });
  }

  return actions;
}

function getSearchActions(snapshot: ConversationSnapshot): ContextualAction[] {
  return [
    {
      id: "search_deeper",
      label: "Search More",
      icon: "🔍",
      category: "search",
      primary: true,
      payload: { action: "search", query: snapshot.topics.join(" "), maxResults: 20 },
      description: "Search for more results on this topic",
    },
    {
      id: "save_results",
      label: "Save to Memory",
      icon: "💾",
      category: "memory",
      payload: { action: "save_memory", content: snapshot.lastResponse.slice(0, 1000) },
      description: "Save these findings for future reference",
    },
    {
      id: "academic_search",
      label: "Academic Sources",
      icon: "📚",
      category: "search",
      payload: { action: "academic_search", query: snapshot.topics.join(" ") },
      description: "Search academic papers and journals",
    },
  ];
}

function getAnalysisActions(snapshot: ConversationSnapshot): ContextualAction[] {
  return [
    {
      id: "dig_deeper",
      label: "Dig Deeper",
      icon: "🔬",
      category: "analysis",
      primary: true,
      payload: { action: "follow_up", prompt: `Go deeper on: ${snapshot.topics.slice(0, 2).join(", ")}` },
      description: "Request a more detailed analysis",
    },
    {
      id: "export_analysis",
      label: "Export",
      icon: "📄",
      category: "export",
      payload: { action: "export", format: "markdown", content: snapshot.lastResponse },
      description: "Export this analysis as a document",
    },
    {
      id: "verify_facts",
      label: "Verify Facts",
      icon: "✓",
      category: "analysis",
      payload: { action: "verify_facts", content: snapshot.lastResponse },
      description: "Check factual claims in this response",
    },
    {
      id: "visualize",
      label: "Visualize",
      icon: "📊",
      category: "analysis",
      payload: { action: "create_chart", data: snapshot.lastResponse },
      description: "Create a visualization from this data",
    },
  ];
}

function getDocumentActions(snapshot: ConversationSnapshot): ContextualAction[] {
  return [
    {
      id: "summarize_doc",
      label: "Summarize",
      icon: "📝",
      category: "document",
      primary: true,
      payload: { action: "summarize" },
      description: "Generate a concise summary",
    },
    {
      id: "extract_key_points",
      label: "Key Points",
      icon: "🔑",
      category: "document",
      payload: { action: "extract_key_points" },
      description: "Extract the most important points",
    },
    {
      id: "translate_doc",
      label: "Translate",
      icon: "🌐",
      category: "document",
      payload: { action: "translate" },
      description: "Translate document to English",
    },
  ];
}

function getShareExportActions(snapshot: ConversationSnapshot): ContextualAction[] {
  return [
    {
      id: "copy_response",
      label: "Copy",
      icon: "📋",
      category: "share",
      payload: { action: "copy", content: snapshot.lastResponse },
      description: "Copy response to clipboard",
    },
    {
      id: "save_memory",
      label: "Remember This",
      icon: "🧠",
      category: "memory",
      payload: { action: "save_memory", content: snapshot.lastResponse, topics: snapshot.topics },
      description: "Save to long-term memory",
    },
  ];
}

function getLongResponseActions(snapshot: ConversationSnapshot): ContextualAction[] {
  return [
    {
      id: "tldr",
      label: "TL;DR",
      icon: "⚡",
      category: "analysis",
      primary: true,
      payload: { action: "summarize_short", content: snapshot.lastResponse },
      description: "Get a one-paragraph summary",
    },
    {
      id: "outline",
      label: "Outline",
      icon: "📑",
      category: "analysis",
      payload: { action: "create_outline", content: snapshot.lastResponse },
      description: "Create a structured outline",
    },
  ];
}

// ─── ContextualActions ────────────────────────────────────────────────────────

export class ContextualActions {
  /**
   * Generate contextually appropriate action groups for a conversation state.
   */
  generateActions(
    userMessage: string,
    assistantResponse: string,
    options: { turnCount?: number; userId?: string } = {}
  ): ActionGroup[] {
    const snapshot = analyzeResponse(userMessage, assistantResponse);
    snapshot.turnCount = options.turnCount ?? 1;

    const groups: ActionGroup[] = [];

    // Code-related actions
    if (snapshot.hasCodeBlock) {
      groups.push({
        id: "code_actions",
        title: "Code",
        actions: getCodeActions(snapshot),
        collapseAfter: 3,
      });
    }

    // Search-related actions
    if (snapshot.hasSearch) {
      groups.push({
        id: "search_actions",
        title: "Sources",
        actions: getSearchActions(snapshot),
        collapseAfter: 2,
      });
    }

    // Document actions
    if (snapshot.hasDocument) {
      groups.push({
        id: "document_actions",
        title: "Document",
        actions: getDocumentActions(snapshot),
        collapseAfter: 2,
      });
    }

    // Long response actions
    if (snapshot.isLongResponse) {
      groups.push({
        id: "length_actions",
        title: "Simplify",
        actions: getLongResponseActions(snapshot),
      });
    }

    // Analysis actions (for substantive responses)
    if (assistantResponse.length > 500 && !snapshot.hasCodeBlock) {
      groups.push({
        id: "analysis_actions",
        title: "Explore",
        actions: getAnalysisActions(snapshot),
        collapseAfter: 2,
      });
    }

    // Always show share/export for longer responses
    if (assistantResponse.length > 300 || snapshot.hasCodeBlock) {
      groups.push({
        id: "share_actions",
        title: "Save & Share",
        actions: getShareExportActions(snapshot),
      });
    }

    const totalActions = groups.reduce((s, g) => s + g.actions.length, 0);
    logger.info(`Generated ${totalActions} contextual actions in ${groups.length} groups`);

    return groups;
  }

  /**
   * Get flat list of primary (highlighted) actions only.
   */
  getPrimaryActions(groups: ActionGroup[]): ContextualAction[] {
    return groups
      .flatMap((g) => g.actions)
      .filter((a) => a.primary);
  }

  /**
   * Serialize action groups to a format suitable for frontend rendering.
   */
  serializeForUI(groups: ActionGroup[]): Array<{
    id: string;
    title: string;
    actions: Array<{ id: string; label: string; icon?: string; primary?: boolean; shortcut?: string }>;
  }> {
    return groups.map((g) => ({
      id: g.id,
      title: g.title,
      actions: (g.collapseAfter ? g.actions.slice(0, g.collapseAfter) : g.actions).map((a) => ({
        id: a.id,
        label: a.label,
        icon: a.icon,
        primary: a.primary,
        shortcut: a.shortcut,
        description: a.description,
      })),
    }));
  }

  /**
   * Find and return the full payload for a given action ID.
   */
  resolveAction(groups: ActionGroup[], actionId: string): ContextualAction | null {
    for (const group of groups) {
      const action = group.actions.find((a) => a.id === actionId);
      if (action) return action;
    }
    return null;
  }
}

export const contextualActions = new ContextualActions();
