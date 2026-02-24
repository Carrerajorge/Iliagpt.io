export type WeChatPolicyDecision =
  | { allowed: true; category: string }
  | { allowed: false; reason: string; reply: string };

const DANGEROUS_PATTERNS = [
  /\b(rm\s+-rf|sudo|chmod|chown|kill\s+-9)\b/i,
  /\b(exec|eval|system|spawn|fork)\s*\(/i,
  /\b(password|contraseña|secret|token)\s*(is|es|=|:)/i,
];

export function evaluateWeChatPolicy(text: string): WeChatPolicyDecision {
  const trimmed = (text || "").trim();
  if (!trimmed) {
    return { allowed: false, reason: "empty_message", reply: "未收到任何消息。" };
  }

  for (const pattern of DANGEROUS_PATTERNS) {
    if (pattern.test(trimmed)) {
      return {
        allowed: false,
        reason: "dangerous_content",
        reply: "出于安全考虑，我无法通过微信处理此类请求。",
      };
    }
  }

  return { allowed: true, category: "general" };
}
