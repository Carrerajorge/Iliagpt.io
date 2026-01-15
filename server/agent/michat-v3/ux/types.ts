/**
 * MICHAT v3.1 — UX Output Contracts
 * Salidas limpias, predecibles y útiles para usuarios finales
 */

export type UXLevel = "minimal" | "standard" | "debug";

export type UXBlock =
  | { type: "text"; text: string }
  | { type: "bullet"; title?: string; items: string[] }
  | { type: "notice"; tone: "info" | "success" | "warning" | "error"; text: string }
  | { type: "tool"; name: string; status: "ok" | "warn" | "error"; summary: string }
  | { type: "workflow"; status: "ok" | "warn" | "error"; summary: string }
  | { type: "debug"; json: unknown };

export interface UXResponse {
  requestId: string;
  traceId: string;
  agentId: string;
  level: UXLevel;
  blocks: UXBlock[];
  ui?: { 
    followUps?: string[]; 
    showFeedback?: boolean;
    suggestedActions?: Array<{ label: string; action: string }>;
  };
  meta?: {
    durationMs: number;
    toolsExecuted: number;
    tokensUsed?: number;
  };
}

export interface UXLimits {
  maxChars: number;
  maxLines: number;
  maxToolSummaryChars: number;
  maxBulletItems: number;
}

export const DefaultLimits: Record<UXLevel, UXLimits> = {
  minimal: { maxChars: 1800, maxLines: 10, maxToolSummaryChars: 220, maxBulletItems: 5 },
  standard: { maxChars: 5000, maxLines: 40, maxToolSummaryChars: 600, maxBulletItems: 10 },
  debug: { maxChars: 20000, maxLines: 500, maxToolSummaryChars: 2500, maxBulletItems: 50 },
};
