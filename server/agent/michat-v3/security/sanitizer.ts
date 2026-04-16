/**
 * MICHAT v3.1 — Input Sanitization & Prompt Injection Detection
 */

const INJECTION_PATTERNS = [
  "ignore previous",
  "system prompt",
  "developer message",
  "reveal",
  "exfiltrate",
  "jailbreak",
  "prompt injection",
  "override",
  "bypass policy",
  "ignore all previous",
  "disregard previous",
  "forget your instructions",
  "new instructions",
  "pretend you are",
  "act as if",
  "roleplay as",
  "you are now",
  "ignore safety",
  "ignore guidelines",
  "your new role",
  "override your",
  "bypass your",
  "forget everything",
  "ignore everything above",
  "ignore the above",
  "do not follow",
  "stop being",
  "break character",
  "exit character",
  "reveal your prompt",
  "show your prompt",
  "print your instructions",
  "output your system",
  "display your rules",
];

export interface SanitizationResult {
  sanitized: string;
  original: string;
  injectionDetected: boolean;
  injectionPatterns: string[];
  truncated: boolean;
  controlCharsRemoved: number;
}

export function sanitizeUserInput(input: string, maxLength: number = 50_000): SanitizationResult {
  const original = input;
  let controlCharsRemoved = 0;

  let sanitized = input
    .replace(/<\/?script[^>]*>/gi, "")
    .replace(/```[\s\S]*?```/g, (m) => m.slice(0, 3000))
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, () => {
      controlCharsRemoved++;
      return "";
    })
    .trim();

  const truncated = sanitized.length > maxLength;
  sanitized = sanitized.slice(0, maxLength);

  const { detected, patterns } = detectPromptInjection(sanitized);

  return {
    sanitized,
    original,
    injectionDetected: detected,
    injectionPatterns: patterns,
    truncated,
    controlCharsRemoved,
  };
}

export function detectPromptInjection(msg: string): { detected: boolean; patterns: string[] } {
  const lower = msg.toLowerCase();
  const foundPatterns: string[] = [];

  for (const pattern of INJECTION_PATTERNS) {
    if (lower.includes(pattern)) {
      foundPatterns.push(pattern);
    }
  }

  return {
    detected: foundPatterns.length > 0,
    patterns: foundPatterns,
  };
}

export function sanitizeOutput(output: string, maxLength: number = 10_000): string {
  return output
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, "")
    .slice(0, maxLength)
    .trim();
}

export function redactSecrets(text: string): string {
  return text
    .replace(/\b[A-Za-z0-9]{32,}\b/g, "[REDACTED_KEY]")
    .replace(/password[=:]\s*\S+/gi, "password=[REDACTED]")
    .replace(/api[_-]?key[=:]\s*\S+/gi, "api_key=[REDACTED]")
    .replace(/secret[=:]\s*\S+/gi, "secret=[REDACTED]")
    .replace(/token[=:]\s*\S+/gi, "token=[REDACTED]")
    .replace(/bearer\s+\S+/gi, "Bearer [REDACTED]");
}
