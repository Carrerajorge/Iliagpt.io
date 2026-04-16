export type WhatsAppPolicyDecision =
  | { allowed: true; category: string }
  | { allowed: false; reason: string; reply: string };

const ALLOW_PATTERNS: Array<{ category: string; re: RegExp }> = [
  { category: "greeting", re: /\b(hola|buenas|hello|hi|hey)\b/i },
  { category: "reservation", re: /\b(reserv(a|ar|acion|ación|as)?|reserve|booking|book|cita|appointment|mesa|restaurant|restaurante|hotel|habitación|habitacion|room)\b/i },
  { category: "support", re: /\b(soporte|support|ayuda|help|problema|issue|reclamo|reclamación|reclamacion|ticket|devoluci[oó]n|refund)\b/i },
  { category: "tracking", re: /\b(estado|status|tracking|seguimiento|pedido|order|env[ií]o|shipment|entrega|delivery)\b/i },
  { category: "business_info", re: /\b(horario|hours|ubicaci[oó]n|location|direcci[oó]n|address|precio|pricing|tarifa|costo|cost)\b/i },
  { category: "account", re: /\b(cuenta|account|factura|invoice|pago|payment|suscripci[oó]n|subscription)\b/i },
];

const DENY_PATTERNS: Array<{ reason: string; re: RegExp }> = [
  { reason: "computer_control", re: /\b(terminal|cmd|powershell|bash|zsh|ssh|script|ejecuta|run\s+command|comando)\b/i },
  { reason: "filesystem", re: /\b(archivo|file|carpeta|folder|escritorio|desktop|descarga|download|sube|upload)\b/i },
  { reason: "general_assistant", re: /\b(haz lo que sea|cualquier cosa|asistente general|general assistant)\b/i },
];

export function getWhatsAppOutOfScopeReply(baseUrl?: string): string {
  const app = baseUrl ? ` ${baseUrl}` : "";
  return (
    "Por WhatsApp solo gestionamos reservas, soporte y seguimiento de pedidos. " +
    `Para un asistente libre usa Telegram o la web.${app}`.trim()
  );
}

export function evaluateWhatsAppPolicy(text: string, opts?: { baseUrl?: string }): WhatsAppPolicyDecision {
  const t = String(text || "").trim();
  if (!t) {
    return { allowed: false, reason: "empty", reply: getWhatsAppOutOfScopeReply(opts?.baseUrl) };
  }

  for (const deny of DENY_PATTERNS) {
    if (deny.re.test(t)) {
      return { allowed: false, reason: deny.reason, reply: getWhatsAppOutOfScopeReply(opts?.baseUrl) };
    }
  }

  for (const allow of ALLOW_PATTERNS) {
    if (allow.re.test(t)) {
      return { allowed: true, category: allow.category };
    }
  }

  return { allowed: false, reason: "out_of_scope", reply: getWhatsAppOutOfScopeReply(opts?.baseUrl) };
}

