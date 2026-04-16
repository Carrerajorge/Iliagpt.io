import { EventEmitter } from "events";
import { randomUUID } from "crypto";

export type InjectionType = "direct_injection" | "indirect_injection" | "jailbreak" | "data_exfiltration";
export type ThreatSeverity = "low" | "medium" | "high" | "critical";

export interface InjectionDetectionResult {
  id: string;
  detected: boolean;
  blocked: boolean;
  injectionType: InjectionType | null;
  severity: ThreatSeverity | null;
  score: number;
  matchedPatterns: string[];
  source: "user_input" | "rag_content" | "tool_output";
  input: string;
  timestamp: number;
}

interface PatternRule {
  name: string;
  pattern: RegExp;
  type: InjectionType;
  severity: ThreatSeverity;
  weight: number;
}

const DIRECT_INJECTION_PATTERNS: PatternRule[] = [
  { name: "ignore_instructions", pattern: /ignore\s+(all\s+)?(previous|prior|above|earlier|system)\s+(instructions?|prompts?|rules?|context|guidelines?)/i, type: "direct_injection", severity: "critical", weight: 0.9 },
  { name: "disregard_instructions", pattern: /disregard\s+(all\s+)?(previous|prior|above|earlier|your)\s+(instructions?|prompts?|rules?|guidelines?)/i, type: "direct_injection", severity: "critical", weight: 0.9 },
  { name: "forget_instructions", pattern: /forget\s+(everything|all|your)\s+(you\s+)?(were\s+told|know|instructions?)/i, type: "direct_injection", severity: "critical", weight: 0.85 },
  { name: "override_system", pattern: /override\s+(system|your|all)\s+(prompt|instructions?|rules?|behavior|settings?)/i, type: "direct_injection", severity: "critical", weight: 0.9 },
  { name: "new_instructions", pattern: /(?:new|updated|revised|corrected)\s+(?:system\s+)?instructions?\s*:/i, type: "direct_injection", severity: "high", weight: 0.8 },
  { name: "do_not_follow", pattern: /do\s+not\s+follow\s+(your|the|any)\s+(previous|original|system|initial)\s+(instructions?|prompt|rules?)/i, type: "direct_injection", severity: "critical", weight: 0.9 },
  { name: "reset_context", pattern: /(?:reset|clear|wipe)\s+(?:your\s+)?(?:context|memory|conversation|history|instructions?)/i, type: "direct_injection", severity: "high", weight: 0.75 },
];

const INDIRECT_INJECTION_PATTERNS: PatternRule[] = [
  { name: "hidden_instruction_marker", pattern: /\[SYSTEM\]|\[INST\]|\[\/INST\]|<\|im_start\|>|<\|im_end\|>/i, type: "indirect_injection", severity: "critical", weight: 0.95 },
  { name: "system_block", pattern: /<<\s*SYS\s*>>|<\/?system>|```\s*system\s*\n/i, type: "indirect_injection", severity: "critical", weight: 0.95 },
  { name: "hidden_text_marker", pattern: /<!--\s*(?:system|instruction|ignore|override|prompt)/i, type: "indirect_injection", severity: "high", weight: 0.8 },
  { name: "invisible_unicode", pattern: /[\u200B\u200C\u200D\u2060\uFEFF]{3,}/i, type: "indirect_injection", severity: "high", weight: 0.7 },
  { name: "markdown_injection", pattern: /!\[.*?\]\(https?:\/\/[^)]*(?:callback|webhook|exfil|steal|leak)/i, type: "indirect_injection", severity: "high", weight: 0.85 },
  { name: "encoded_payload", pattern: /(?:decode|interpret|execute|run|eval)\s+(?:this|the\s+following)\s+(?:base64|hex|binary|encoded|rot13)/i, type: "indirect_injection", severity: "critical", weight: 0.9 },
  { name: "base64_known_payloads", pattern: /aWdub3Jl|SWdub3Jl|ZGlzcmVnYXJk|b3ZlcnJpZGU=/i, type: "indirect_injection", severity: "high", weight: 0.85 },
];

const JAILBREAK_PATTERNS: PatternRule[] = [
  { name: "developer_mode", pattern: /enter\s+(developer|debug|admin|god|root|sudo|jailbreak|unrestricted|DAN)\s+mode/i, type: "jailbreak", severity: "critical", weight: 0.9 },
  { name: "enable_mode", pattern: /enable\s+(developer|debug|admin|god|root|sudo|jailbreak|unrestricted|DAN)\s+mode/i, type: "jailbreak", severity: "critical", weight: 0.9 },
  { name: "role_hijack", pattern: /you\s+are\s+now\s+(a|an|the|my)\s+(?!helpful|friendly|polite)/i, type: "jailbreak", severity: "medium", weight: 0.5 },
  { name: "role_switch", pattern: /from\s+now\s+on,?\s+you\s+(are|will|should|must)\s+(?!help|assist|answer)/i, type: "jailbreak", severity: "medium", weight: 0.6 },
  { name: "pretend_bypass", pattern: /pretend\s+(?:that\s+)?(?:you\s+)?(?:have\s+no|there\s+are\s+no|you\s+don'?t\s+have)\s+(?:restrictions?|limitations?|rules?|filters?|guardrails?)/i, type: "jailbreak", severity: "high", weight: 0.85 },
  { name: "hypothetical_bypass", pattern: /(?:hypothetically|in\s+theory|for\s+educational\s+purposes|just\s+pretend),?\s+(?:if\s+you\s+)?(?:could|were\s+to|had\s+to)\s+(?:ignore|bypass|override|break)/i, type: "jailbreak", severity: "high", weight: 0.75 },
  { name: "dan_pattern", pattern: /\bDAN\b.*(?:do\s+anything|no\s+restrictions|no\s+rules|no\s+limits|unrestricted)/i, type: "jailbreak", severity: "critical", weight: 0.95 },
  { name: "opposite_day", pattern: /(?:opposite\s+day|bizarro\s+mode|reverse\s+(?:all|your)\s+(?:rules|instructions))/i, type: "jailbreak", severity: "high", weight: 0.7 },
];

const DATA_EXFILTRATION_PATTERNS: PatternRule[] = [
  { name: "send_data", pattern: /send\s+(all|my|the|this|your)\s+(data|information|messages?|conversation|history|context|secrets?|keys?)\s+to/i, type: "data_exfiltration", severity: "critical", weight: 0.9 },
  { name: "forward_data", pattern: /forward\s+(all|my|the|this|your)\s+(data|information|messages?|conversation|emails?)\s+to/i, type: "data_exfiltration", severity: "critical", weight: 0.9 },
  { name: "exfiltrate", pattern: /exfiltrate|leak\s+(the\s+)?(system|internal|private|secret|api\s+key)/i, type: "data_exfiltration", severity: "critical", weight: 0.95 },
  { name: "extract_prompt", pattern: /(?:show|reveal|display|print|output|repeat|tell\s+me|give\s+me)\s+(your|the)\s+(system\s+prompt|instructions?|initial\s+prompt|original\s+prompt|hidden\s+prompt|api\s+key|secret)/i, type: "data_exfiltration", severity: "high", weight: 0.8 },
  { name: "upload_internal", pattern: /upload\s+(the\s+)?(system\s+prompt|internal|conversation|chat\s+history|api\s+keys?)\s+to/i, type: "data_exfiltration", severity: "critical", weight: 0.9 },
  { name: "webhook_exfil", pattern: /(?:fetch|curl|wget|post|get)\s+https?:\/\/[^\s]+.*(?:system_prompt|api_key|secret|token|password)/i, type: "data_exfiltration", severity: "critical", weight: 0.95 },
];

const ALL_PATTERNS: PatternRule[] = [
  ...DIRECT_INJECTION_PATTERNS,
  ...INDIRECT_INJECTION_PATTERNS,
  ...JAILBREAK_PATTERNS,
  ...DATA_EXFILTRATION_PATTERNS,
];

function computeHeuristicScore(input: string): { score: number; flags: string[] } {
  const flags: string[] = [];
  let score = 0;

  const lowerInput = input.toLowerCase();

  const systemKeywords = ["system prompt", "instructions", "ignore", "override", "disregard", "bypass", "jailbreak", "unrestricted"];
  const keywordCount = systemKeywords.filter(kw => lowerInput.includes(kw)).length;
  if (keywordCount >= 3) {
    score += 0.3;
    flags.push("high_keyword_density");
  } else if (keywordCount >= 2) {
    score += 0.15;
    flags.push("moderate_keyword_density");
  }

  const lineCount = input.split("\n").length;
  const avgLineLen = input.length / Math.max(lineCount, 1);
  if (lineCount > 20 && avgLineLen < 30) {
    score += 0.1;
    flags.push("unusual_formatting");
  }

  const unicodeRatio = (input.match(/[^\x00-\x7F]/g) || []).length / Math.max(input.length, 1);
  if (unicodeRatio > 0.3) {
    score += 0.15;
    flags.push("high_unicode_ratio");
  }

  const repetitionMatch = input.match(/(.{10,})\1{2,}/);
  if (repetitionMatch) {
    score += 0.1;
    flags.push("suspicious_repetition");
  }

  if (lowerInput.includes("```") && (lowerInput.includes("system") || lowerInput.includes("[inst]"))) {
    score += 0.2;
    flags.push("code_block_with_markers");
  }

  return { score: Math.min(score, 1), flags };
}

export class PromptInjectionDetector extends EventEmitter {
  private detectionHistory: InjectionDetectionResult[] = [];
  private readonly maxHistory = 1000;
  private blockThreshold = 0.7;
  private warnThreshold = 0.4;

  setBlockThreshold(threshold: number): void {
    this.blockThreshold = Math.max(0, Math.min(1, threshold));
  }

  setWarnThreshold(threshold: number): void {
    this.warnThreshold = Math.max(0, Math.min(1, threshold));
  }

  detect(input: string, source: "user_input" | "rag_content" | "tool_output" = "user_input"): InjectionDetectionResult {
    if (!input || typeof input !== "string") {
      return this.createCleanResult(input || "", source);
    }

    const matchedPatterns: PatternRule[] = [];
    for (const rule of ALL_PATTERNS) {
      if (rule.pattern.test(input)) {
        matchedPatterns.push(rule);
      }
    }

    const heuristic = computeHeuristicScore(input);
    let patternScore = 0;
    if (matchedPatterns.length > 0) {
      patternScore = Math.max(...matchedPatterns.map(p => p.weight));
      patternScore = Math.min(patternScore + (matchedPatterns.length - 1) * 0.05, 1);
    }

    const combinedScore = Math.min(patternScore * 0.7 + heuristic.score * 0.3 + (patternScore > 0 ? heuristic.score : 0), 1);

    const detected = combinedScore >= this.warnThreshold || matchedPatterns.length > 0;
    const blocked = combinedScore >= this.blockThreshold;

    let injectionType: InjectionType | null = null;
    let severity: ThreatSeverity | null = null;

    if (detected && matchedPatterns.length > 0) {
      const severityOrder: Record<ThreatSeverity, number> = { low: 0, medium: 1, high: 2, critical: 3 };
      const worstPattern = matchedPatterns.reduce((worst, current) =>
        severityOrder[current.severity] > severityOrder[worst.severity] ? current : worst
      );
      injectionType = worstPattern.type;
      severity = worstPattern.severity;
    } else if (detected) {
      injectionType = "direct_injection";
      severity = combinedScore >= 0.7 ? "high" : "medium";
    }

    const result: InjectionDetectionResult = {
      id: randomUUID(),
      detected,
      blocked,
      injectionType,
      severity,
      score: Math.round(combinedScore * 100) / 100,
      matchedPatterns: [...matchedPatterns.map(p => p.name), ...heuristic.flags],
      source,
      input: input.substring(0, 500),
      timestamp: Date.now(),
    };

    if (detected) {
      this.addToHistory(result);
      this.emit("injection_detected", result);
    }

    if (blocked) {
      this.emit("injection_blocked", result);
    }

    return result;
  }

  detectInMessages(messages: Array<{ role: string; content: string }>): {
    results: InjectionDetectionResult[];
    blocked: boolean;
    worstSeverity: ThreatSeverity | null;
  } {
    const results: InjectionDetectionResult[] = [];
    let blocked = false;
    let worstSeverity: ThreatSeverity | null = null;
    const severityOrder: Record<ThreatSeverity, number> = { low: 0, medium: 1, high: 2, critical: 3 };

    for (const msg of messages) {
      if (msg.role !== "user") continue;
      const result = this.detect(msg.content, "user_input");
      if (result.detected) {
        results.push(result);
        if (result.blocked) blocked = true;
        if (result.severity && (!worstSeverity || severityOrder[result.severity] > severityOrder[worstSeverity])) {
          worstSeverity = result.severity;
        }
      }
    }

    return { results, blocked, worstSeverity };
  }

  detectInRAGContent(chunks: string[]): InjectionDetectionResult[] {
    const results: InjectionDetectionResult[] = [];
    for (const chunk of chunks) {
      const result = this.detect(chunk, "rag_content");
      if (result.detected) {
        results.push(result);
      }
    }
    return results;
  }

  detectInToolOutput(output: string): InjectionDetectionResult {
    return this.detect(output, "tool_output");
  }

  getHistory(limit = 100): InjectionDetectionResult[] {
    return this.detectionHistory.slice(-limit);
  }

  getStats(): {
    totalDetections: number;
    totalBlocked: number;
    byType: Record<InjectionType, number>;
    bySeverity: Record<ThreatSeverity, number>;
    bySource: Record<string, number>;
  } {
    const byType: Record<InjectionType, number> = { direct_injection: 0, indirect_injection: 0, jailbreak: 0, data_exfiltration: 0 };
    const bySeverity: Record<ThreatSeverity, number> = { low: 0, medium: 0, high: 0, critical: 0 };
    const bySource: Record<string, number> = { user_input: 0, rag_content: 0, tool_output: 0 };
    let totalBlocked = 0;

    for (const entry of this.detectionHistory) {
      if (entry.injectionType) byType[entry.injectionType]++;
      if (entry.severity) bySeverity[entry.severity]++;
      bySource[entry.source] = (bySource[entry.source] || 0) + 1;
      if (entry.blocked) totalBlocked++;
    }

    return {
      totalDetections: this.detectionHistory.length,
      totalBlocked,
      byType,
      bySeverity,
      bySource,
    };
  }

  clearHistory(): void {
    this.detectionHistory = [];
  }

  private createCleanResult(input: string, source: "user_input" | "rag_content" | "tool_output"): InjectionDetectionResult {
    return {
      id: randomUUID(),
      detected: false,
      blocked: false,
      injectionType: null,
      severity: null,
      score: 0,
      matchedPatterns: [],
      source,
      input: input.substring(0, 500),
      timestamp: Date.now(),
    };
  }

  private addToHistory(result: InjectionDetectionResult): void {
    this.detectionHistory.push(result);
    if (this.detectionHistory.length > this.maxHistory) {
      this.detectionHistory = this.detectionHistory.slice(-this.maxHistory);
    }
  }
}

export const promptInjectionDetector = new PromptInjectionDetector();
