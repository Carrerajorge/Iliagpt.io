export type DocumentFormat = "pptx" | "docx" | "xlsx" | "pdf";
export type DocumentOperation = "create" | "edit" | "convert" | "redline" | "analyze";
export type DocumentBackend = "native" | "claude-skills";
export type QaStatus = "skipped" | "warning" | "passed" | "failed";

export interface DocumentSkillDefinition {
  id: string;
  format: DocumentFormat;
  operations: DocumentOperation[];
  triggers: string[];  // bilingual keywords
  level1Summary: string; // ~100 tokens for planner
  loadLevel2: () => Promise<string>; // full SKILL.md
  loadLevel3: (reason: string) => Promise<string | null>; // reference docs
  execute: (ctx: DocumentExecutionContext) => Promise<DocumentResult>;
  qaPolicy: "advisor" | "blocking"; // advisor = warn, blocking = fail
  backendSupport: DocumentBackend[];
}

export interface DocumentExecutionContext {
  operation: DocumentOperation;
  userMessage: string;
  format: DocumentFormat;
  backend: DocumentBackend;
  palette?: string;
  attachmentBuffer?: Buffer;
  attachmentFormat?: string;
  locale: string;
  userId: string;
  chatId: string;
}

export interface DocumentResult {
  buffer: Buffer;
  filename: string;
  mimeType: string;
  downloadUrl: string;
  previewHtml?: string;
  metadata: {
    skillId: string;
    operation: DocumentOperation;
    backendUsed: DocumentBackend;
    paletteId?: string;
    durationMs: number;
    qa: DocumentQaReport;
  };
}

export interface DocumentQaReport {
  status: QaStatus;
  severity: "none" | "low" | "medium" | "high";
  findings: string[];
  metrics: { validationMs: number; repairLoops: number };
}

export interface DocumentIntentRoute {
  format: DocumentFormat;
  operation: DocumentOperation;
  backend: DocumentBackend;
  requiresQa: boolean;
  requiresLevel3: boolean;
  confidence: number;
}

export interface DesignPalette {
  id: string;
  name: string;
  primary: string;
  secondary: string;
  accent: string;
  background: string;
  text: string;
  muted: string;
  border: string;
  surface: string;
}

export interface DesignTokens {
  palettes: Record<string, DesignPalette>;
  typography: {
    titleSize: [number, number]; // pt range
    subtitleSize: [number, number];
    bodySize: [number, number];
    captionSize: [number, number];
    titleFont: string;
    bodyFont: string;
  };
  excelColorCoding: { inputs: string; formulas: string; links: string };
  antiPatterns: string[];
}
