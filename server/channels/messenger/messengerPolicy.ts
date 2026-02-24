export type MessengerPolicyDecision =
  | { allowed: true; category: string }
  | { allowed: false; reason: string; reply: string };

const DANGEROUS_PATTERNS = [
  /\b(rm\s+-rf|sudo|chmod|chown|kill\s+-9)\b/i,
  /\b(exec|eval|system|spawn|fork)\s*\(/i,
  /\b(password|contraseña|secret|token)\s*(is|es|=|:)/i,
];

export function evaluateMessengerPolicy(text: string): MessengerPolicyDecision {
  const trimmed = (text || "").trim();
  if (!trimmed) {
    return { allowed: false, reason: "empty_message", reply: "No se recibió ningún mensaje." };
  }

  for (const pattern of DANGEROUS_PATTERNS) {
    if (pattern.test(trimmed)) {
      return {
        allowed: false,
        reason: "dangerous_content",
        reply: "Por seguridad, no puedo procesar ese tipo de solicitud por Messenger.",
      };
    }
  }

  return { allowed: true, category: "general" };
}
