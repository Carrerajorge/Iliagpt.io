export type InjectionSeverity = 'low' | 'medium' | 'high';

export interface SanitizationResult {
  sanitizedInput: string;
  severity: InjectionSeverity | null;
  detected: boolean;
  patterns: string[];
  blocked: boolean;
}

export interface OutputSanitizationResult {
  sanitizedOutput: string;
  leaksDetected: string[];
}

const BOUNDARY_START = '<<<USER_INPUT_START>>>';
const BOUNDARY_END = '<<<USER_INPUT_END>>>';
const TOOL_BOUNDARY_START = '<<<TOOL_OUTPUT_START>>>';
const TOOL_BOUNDARY_END = '<<<TOOL_OUTPUT_END>>>';

interface PatternRule {
  name: string;
  pattern: RegExp;
  severity: InjectionSeverity;
}

const INJECTION_PATTERNS: PatternRule[] = [
  { name: 'instruction_override', pattern: /ignore\s+(all\s+)?(previous|prior|above|earlier)\s+(instructions?|prompts?|rules?|context)/i, severity: 'high' },
  { name: 'instruction_override_2', pattern: /disregard\s+(all\s+)?(previous|prior|above|earlier|your)\s+(instructions?|prompts?|rules?|guidelines?)/i, severity: 'high' },
  { name: 'instruction_override_3', pattern: /forget\s+(everything|all|your)\s+(you\s+)?(were\s+told|know|instructions?)/i, severity: 'high' },
  { name: 'instruction_override_4', pattern: /override\s+(system|your|all)\s+(prompt|instructions?|rules?|behavior)/i, severity: 'high' },
  { name: 'instruction_override_5', pattern: /do\s+not\s+follow\s+(your|the|any)\s+(previous|original|system)\s+(instructions?|prompt|rules?)/i, severity: 'high' },

  { name: 'role_hijacking', pattern: /you\s+are\s+now\s+(a|an|the|my)\s+/i, severity: 'medium' },
  { name: 'role_hijacking_2', pattern: /act\s+as\s+(if\s+you\s+are|a|an|the)\s+/i, severity: 'medium' },
  { name: 'role_hijacking_3', pattern: /pretend\s+(to\s+be|you\s+are|that\s+you)/i, severity: 'medium' },
  { name: 'role_hijacking_4', pattern: /from\s+now\s+on,?\s+you\s+(are|will|should|must)/i, severity: 'medium' },
  { name: 'role_hijacking_5', pattern: /switch\s+to\s+(a|an|the|your)\s+(new|different)\s+(role|persona|mode|character)/i, severity: 'medium' },
  { name: 'role_hijacking_6', pattern: /enter\s+(developer|debug|admin|god|root|sudo|jailbreak)\s+mode/i, severity: 'high' },
  { name: 'role_hijacking_7', pattern: /enable\s+(developer|debug|admin|god|root|sudo|jailbreak)\s+mode/i, severity: 'high' },

  { name: 'data_exfiltration', pattern: /send\s+(all|my|the|this|your)\s+(data|information|messages?|conversation|history|context)\s+to/i, severity: 'high' },
  { name: 'data_exfiltration_2', pattern: /forward\s+(all|my|the|this|your)\s+(data|information|messages?|conversation|emails?)/i, severity: 'high' },
  { name: 'data_exfiltration_3', pattern: /exfiltrate|leak\s+(the\s+)?(system|internal|private|secret)/i, severity: 'high' },
  { name: 'data_exfiltration_4', pattern: /upload\s+(the\s+)?(system\s+prompt|internal|conversation|chat\s+history)\s+to/i, severity: 'high' },

  { name: 'system_prompt_extraction', pattern: /(?:show|reveal|display|print|output|repeat|tell\s+me)\s+(your|the)\s+(system\s+prompt|instructions?|initial\s+prompt|original\s+prompt|hidden\s+prompt)/i, severity: 'medium' },
  { name: 'system_prompt_extraction_2', pattern: /what\s+(is|are)\s+your\s+(system\s+prompt|instructions?|original\s+instructions?|initial\s+prompt)/i, severity: 'low' },
  { name: 'system_prompt_extraction_3', pattern: /repeat\s+(the\s+)?(text|words?|content)\s+(above|before)\s+(this|the\s+user)/i, severity: 'medium' },

  { name: 'encoding_attack', pattern: /(?:decode|interpret|execute|run|eval)\s+(?:this|the\s+following)\s+(?:base64|hex|binary|encoded|rot13)/i, severity: 'high' },
  { name: 'encoding_attack_2', pattern: /aWdub3Jl|SWdub3Jl|ZGlzcmVnYXJk/i, severity: 'high' },

  { name: 'delimiter_injection', pattern: /```\s*system\s*\n/i, severity: 'high' },
  { name: 'delimiter_injection_2', pattern: /\[SYSTEM\]|\[INST\]|\[\/INST\]|<\|im_start\|>|<\|im_end\|>/i, severity: 'high' },
  { name: 'delimiter_injection_3', pattern: /<<\s*SYS\s*>>|<\/?system>/i, severity: 'high' },

  { name: 'multi_step_manipulation', pattern: /step\s*1[:\s].*(?:ignore|forget|override).*step\s*2/is, severity: 'high' },
  { name: 'hypothetical_framing', pattern: /(?:hypothetically|in\s+theory|for\s+educational\s+purposes|just\s+pretend),?\s+(?:if\s+you\s+)?(?:could|were\s+to|had\s+to)\s+(?:ignore|bypass|override)/i, severity: 'medium' },
];

const SYSTEM_PROMPT_LEAK_PATTERNS = [
  /you\s+are\s+an?\s+(advanced\s+)?ai\s+assistant/i,
  /system\s+prompt:/i,
  /internal\s+instructions?:/i,
  /<<<[A-Z_]+>>>/,
  /\[INTERNAL\]/i,
  /\[SYSTEM_NOTE\]/i,
  /api[_-]?key\s*[:=]\s*[a-zA-Z0-9_-]{20,}/i,
  /sk-[a-zA-Z0-9]{20,}/,
  /bearer\s+[a-zA-Z0-9._-]{20,}/i,
];

function computeSeverity(patterns: { name: string; severity: InjectionSeverity }[]): InjectionSeverity {
  if (patterns.some(p => p.severity === 'high')) return 'high';
  if (patterns.some(p => p.severity === 'medium')) return 'medium';
  return 'low';
}

export function sanitizeInput(input: string): SanitizationResult {
  if (!input || typeof input !== 'string') {
    return { sanitizedInput: input || '', severity: null, detected: false, patterns: [], blocked: false };
  }

  const matchedPatterns: { name: string; severity: InjectionSeverity }[] = [];

  for (const rule of INJECTION_PATTERNS) {
    if (rule.pattern.test(input)) {
      matchedPatterns.push({ name: rule.name, severity: rule.severity });
    }
  }

  if (matchedPatterns.length === 0) {
    return { sanitizedInput: input, severity: null, detected: false, patterns: [], blocked: false };
  }

  const severity = computeSeverity(matchedPatterns);
  const blocked = severity === 'high';

  let sanitizedInput = input;
  if (blocked) {
    sanitizedInput = '[Content blocked: potential prompt injection detected]';
  }

  return {
    sanitizedInput,
    severity,
    detected: true,
    patterns: matchedPatterns.map(p => p.name),
    blocked,
  };
}

export function wrapWithBoundaries(userContent: string): string {
  return `${BOUNDARY_START}\n${userContent}\n${BOUNDARY_END}`;
}

export function wrapToolOutput(toolOutput: string): string {
  return `${TOOL_BOUNDARY_START}\n${toolOutput}\n${TOOL_BOUNDARY_END}`;
}

export function sanitizeOutput(output: string): OutputSanitizationResult {
  if (!output || typeof output !== 'string') {
    return { sanitizedOutput: output || '', leaksDetected: [] };
  }

  let sanitizedOutput = output;
  const leaksDetected: string[] = [];

  for (const pattern of SYSTEM_PROMPT_LEAK_PATTERNS) {
    if (pattern.test(sanitizedOutput)) {
      leaksDetected.push(pattern.source);
    }
  }

  sanitizedOutput = sanitizedOutput
    .replace(/<<<[A-Z_]+>>>/g, '')
    .replace(/\[INTERNAL\][^\n]*/gi, '')
    .replace(/\[SYSTEM_NOTE\][^\n]*/gi, '')
    .replace(/api[_-]?key\s*[:=]\s*[a-zA-Z0-9_-]{20,}/gi, '[REDACTED]')
    .replace(/sk-[a-zA-Z0-9]{20,}/g, '[REDACTED]')
    .replace(/bearer\s+[a-zA-Z0-9._-]{20,}/gi, 'bearer [REDACTED]');

  return { sanitizedOutput, leaksDetected };
}

export function sanitizeMessages(
  messages: Array<{ role: string; content: string }>
): { messages: Array<{ role: string; content: string }>; result: SanitizationResult } {
  let worstResult: SanitizationResult = {
    sanitizedInput: '',
    severity: null,
    detected: false,
    patterns: [],
    blocked: false,
  };

  const sanitizedMessages = messages.map(msg => {
    if (msg.role !== 'user') return msg;

    const result = sanitizeInput(msg.content);
    if (result.detected) {
      const worstSev = worstResult.severity;
      const currentSev = result.severity;
      const sevOrder: Record<string, number> = { low: 1, medium: 2, high: 3 };
      if (!worstSev || (currentSev && sevOrder[currentSev] > sevOrder[worstSev])) {
        worstResult = {
          ...result,
          patterns: [...worstResult.patterns, ...result.patterns],
        };
      } else {
        worstResult.patterns = [...worstResult.patterns, ...result.patterns];
      }
    }

    return { ...msg, content: result.sanitizedInput };
  });

  return { messages: sanitizedMessages, result: worstResult };
}

export const CONTENT_BOUNDARIES = {
  BOUNDARY_START,
  BOUNDARY_END,
  TOOL_BOUNDARY_START,
  TOOL_BOUNDARY_END,
};
