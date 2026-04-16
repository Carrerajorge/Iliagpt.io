import { RobustIntent } from "./robustIntentClassifier";
import { ContextSignals, AttachmentType } from "./contextDetector";

export const AGENT_REQUIRED_TOOLS = new Set([
  "file_read",
  "summarize",
  "text_summarize",
  "document_analyze",
  "spreadsheet_analyze",
  "pdf_extract",
  "image_ocr",
  "web_search",
  "browse_url",
  "code_execute",
  "code_analyze",
  "generate_document",
  "plan",
  "data_analyze",
  "data_visualize"
]);

export interface ToolSelection {
  tools: string[];
  requiresAgent: boolean;
  reason: string;
}

const INTENT_TO_TOOLS: Record<RobustIntent, string[]> = {
  analysis: ["summarize", "document_analyze", "data_analyze"],
  nav: ["web_search", "browse_url"],
  artifact: ["plan", "generate_document"],
  code: ["code_execute", "code_analyze"],
  automation: ["plan", "schedule", "workflow"],
  chat: []
};

const ATTACHMENT_TYPE_TO_TOOLS: Record<AttachmentType, string[]> = {
  pdf: ["file_read", "pdf_extract", "document_analyze"],
  xlsx: ["file_read", "spreadsheet_analyze", "data_analyze"],
  xls: ["file_read", "spreadsheet_analyze", "data_analyze"],
  docx: ["file_read", "document_analyze"],
  doc: ["file_read", "document_analyze"],
  pptx: ["file_read", "document_analyze"],
  ppt: ["file_read", "document_analyze"],
  csv: ["file_read", "data_analyze", "spreadsheet_analyze"],
  image: ["image_ocr", "vision_analyze"],
  text: ["file_read", "text_summarize"],
  json: ["file_read", "data_analyze"],
  unknown: ["file_read"]
};

export function selectTools(
  intent: RobustIntent,
  context: ContextSignals,
  text: string
): ToolSelection {
  const tools: Set<string> = new Set();
  const reasons: string[] = [];

  const intentTools = INTENT_TO_TOOLS[intent] || [];
  for (const tool of intentTools) {
    tools.add(tool);
  }
  if (intentTools.length > 0) {
    reasons.push(`Intent '${intent}' maps to: ${intentTools.join(", ")}`);
  }

  if (context.hasAttachments) {
    tools.add("file_read");
    reasons.push("Attachments require file_read");

    for (const attachmentType of context.attachmentTypes) {
      const attachmentTools = ATTACHMENT_TYPE_TO_TOOLS[attachmentType] || [];
      for (const tool of attachmentTools) {
        tools.add(tool);
      }
      if (attachmentTools.length > 0) {
        reasons.push(`${attachmentType} attachment adds: ${attachmentTools.join(", ")}`);
      }
    }

    if (intent === "analysis") {
      const lowerText = text.toLowerCase();
      if (lowerText.includes("resumen") || lowerText.includes("resume") || 
          lowerText.includes("summarize") || lowerText.includes("summary")) {
        tools.add("summarize");
        tools.add("text_summarize");
        reasons.push("Summary request adds summarize tools");
      }
    }
  }

  if (context.hasUrls && (intent === "nav" || intent === "analysis")) {
    tools.add("browse_url");
    tools.add("web_search");
    reasons.push("URLs detected, adding web tools");
  }

  if (intent === "artifact") {
    tools.add("plan");
    tools.add("generate_document");
    
    const lowerText = text.toLowerCase();
    if (lowerText.includes("excel") || lowerText.includes("xlsx") || 
        lowerText.includes("spreadsheet") || lowerText.includes("hoja")) {
      tools.add("spreadsheet_analyze");
      reasons.push("Excel artifact requested");
    }
    if (lowerText.includes("word") || lowerText.includes("docx") || 
        lowerText.includes("documento") || lowerText.includes("document")) {
      tools.add("document_analyze");
      reasons.push("Word artifact requested");
    }
    if (lowerText.includes("ppt") || lowerText.includes("powerpoint") || 
        lowerText.includes("presentación") || lowerText.includes("presentation") ||
        lowerText.includes("slides") || lowerText.includes("diapositivas")) {
      reasons.push("Presentation artifact requested");
    }
  }

  const toolList = Array.from(tools);
  const requiresAgent = toolList.some(t => AGENT_REQUIRED_TOOLS.has(t));

  return {
    tools: toolList,
    requiresAgent,
    reason: reasons.join("; ") || "No specific tools required"
  };
}

export function toolsIntersectAgentRequired(tools: string[]): boolean {
  return tools.some(t => AGENT_REQUIRED_TOOLS.has(t));
}

export class ToolSelector {
  select(intent: RobustIntent, context: ContextSignals, text: string): ToolSelection {
    const startTime = Date.now();
    const result = selectTools(intent, context, text);
    const duration = Date.now() - startTime;

    console.log(
      `[ToolSelector] Selected in ${duration}ms: ` +
      `tools=[${result.tools.slice(0, 5).join(", ")}${result.tools.length > 5 ? "..." : ""}], ` +
      `requiresAgent=${result.requiresAgent}`
    );

    return result;
  }
}
