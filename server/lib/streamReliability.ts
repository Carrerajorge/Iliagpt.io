import crypto from "crypto";

export interface StreamChunk {
  content: string;
  done?: boolean;
  provider?: string;
  sequenceId?: number;
  requestId?: string;
  status?: string;
  incompleteDetails?: { reason: string } | null;
  providerSwitch?: { fromProvider: string; toProvider: string };
  [key: string]: unknown;
}

export interface ResponseValidationResult {
  valid: boolean;
  reason?: string;
  severity: "ok" | "warning" | "critical";
  suggestedAction?: "none" | "retry" | "fallback" | "truncation_warn";
}

const GARBAGE_PATTERNS = [
  /^(.)\1{20,}$/,
  /^[\s\n\r]+$/,
  /^\[?\{?\s*"error"/i,
  /^undefined$/i,
  /^null$/i,
  /^NaN$/i,
  /^\[object Object\]$/i,
];

const GENERIC_REFUSAL_PATTERNS = [
  /^i('m| am) (sorry|unable|not able),? (i )?(can'?t|cannot|am unable)/i,
  /^(lo siento|disculpa),? no (puedo|me es posible)/i,
  /^as an ai( language model)?,? i (can'?t|cannot|don'?t|do not)/i,
  /^como (un )?modelo de (lenguaje|ia),? no (puedo|me es posible)/i,
];

export function validateLLMResponse(
  content: string,
  originalPromptLength: number,
): ResponseValidationResult {
  if (!content || content.trim().length === 0) {
    return {
      valid: false,
      reason: "empty_response",
      severity: "critical",
      suggestedAction: "retry",
    };
  }

  const trimmed = content.trim();

  for (const pattern of GARBAGE_PATTERNS) {
    if (pattern.test(trimmed)) {
      return {
        valid: false,
        reason: "garbage_output",
        severity: "critical",
        suggestedAction: "retry",
      };
    }
  }

  if (trimmed.length < 3 && originalPromptLength > 50) {
    return {
      valid: false,
      reason: "suspiciously_short",
      severity: "critical",
      suggestedAction: "retry",
    };
  }

  for (const pattern of GENERIC_REFUSAL_PATTERNS) {
    if (pattern.test(trimmed) && trimmed.length < 200) {
      return {
        valid: false,
        reason: "generic_refusal",
        severity: "warning",
        suggestedAction: "fallback",
      };
    }
  }

  if (originalPromptLength > 500 && trimmed.length < 10) {
    return {
      valid: false,
      reason: "length_mismatch",
      severity: "warning",
      suggestedAction: "retry",
    };
  }

  const repetitionRatio = detectRepetition(trimmed);
  if (repetitionRatio > 0.6 && trimmed.length > 100) {
    return {
      valid: false,
      reason: "excessive_repetition",
      severity: "warning",
      suggestedAction: "retry",
    };
  }

  const unclosedCodeBlocks = (trimmed.match(/```/g) || []).length % 2 !== 0;
  if (unclosedCodeBlocks) {
    return {
      valid: true,
      reason: "unclosed_code_block",
      severity: "warning",
      suggestedAction: "truncation_warn",
    };
  }

  return { valid: true, severity: "ok", suggestedAction: "none" };
}

function detectRepetition(text: string): number {
  if (text.length < 50) return 0;
  const words = text.split(/\s+/);
  if (words.length < 10) return 0;

  const windowSize = Math.min(20, Math.floor(words.length / 3));
  let repeats = 0;
  const seen = new Set<string>();

  for (let i = 0; i <= words.length - windowSize; i++) {
    const window = words.slice(i, i + windowSize).join(" ");
    if (seen.has(window)) repeats++;
    seen.add(window);
  }

  return repeats / Math.max(1, words.length - windowSize);
}

export function computePromptHash(content: string): string {
  return crypto.createHash("sha256").update(content.normalize("NFC")).digest("hex");
}

export function verifyPromptIntegrity(
  content: string,
  expectedHash?: string,
  expectedLength?: number,
): { valid: boolean; reason?: string } {
  if (expectedLength !== undefined && expectedLength > 0) {
    const actualLen = content.length;
    if (Math.abs(actualLen - expectedLength) > 2) {
      return { valid: false, reason: `length_mismatch: expected=${expectedLength}, actual=${actualLen}` };
    }
  }

  if (expectedHash) {
    const actualHash = computePromptHash(content);
    if (actualHash !== expectedHash) {
      return { valid: false, reason: "hash_mismatch" };
    }
  }

  return { valid: true };
}

export interface RAGRelevanceDecision {
  shouldSearch: boolean;
  reason: string;
  confidence: number;
}

const NON_RAG_PATTERNS = [
  /^(hola|hello|hi|hey|buenos?\s*d[ií]as?|buenas?\s*(tardes?|noches?)|good\s*(morning|afternoon|evening)|what's?\s*up|qué\s*tal|cómo\s*est[áa]s?|how\s*are\s*you)\s*[!?.]*$/i,
  /^(gracias|thanks?|thank\s*you|de\s*nada|you'?re?\s*welcome|ok|okay|sí|yes|no|vale|bien|sure|got\s*it|entendido|perfecto)\s*[!?.]*$/i,
  /^(quién\s*eres|who\s*are\s*you|qué\s*(eres|haces)|what\s*(are\s*you|do\s*you\s*do)|cuál\s*es\s*tu\s*nombre|what'?s?\s*your\s*name)\s*[!?.]*$/i,
  /^(cu[aá]nto\s*es|what\s*is)\s*\d+\s*[\+\-\*\/×÷]\s*\d+\s*[?]?$/i,
  /^(dime\s*un\s*chiste|tell\s*me\s*a\s*joke|cu[eé]ntame\s*(algo|un\s*chiste))\s*[!?.]*$/i,
  /^(repite|repeat|rephrase|reformula|resume|summarize|simplifica|simplify)\s/i,
  /^(traduce|translate|convierte|convert)\s/i,
];

const FOLLOW_UP_PATTERNS = [
  /^(s[ií]|yes|no|ok|okay|vale|bien|sure|correcto|exacto|exactly|right|perfect|genial|great)\s*[,.]?\s*/i,
  /^(y |and |pero |but |también |also |además |furthermore |entonces |then |so )/i,
  /^(qué más|what else|algo más|anything else|continúa|continue|sigue|go on)\s*[?!.]*$/i,
  /^(por qué|why|cómo|how)\s*[?!]*$/i,
  /^(me puedes|can you|could you|podrías)\s+(explicar|explain|decir|tell|dar|give)\s+(más|more)/i,
];

export function shouldTriggerRAG(
  userMessage: string,
  hasDocumentContext: boolean,
  hasFileAttachments: boolean,
): RAGRelevanceDecision {
  const trimmed = userMessage.trim();

  if (!trimmed || trimmed.length < 2) {
    return { shouldSearch: false, reason: "empty_or_too_short", confidence: 1.0 };
  }

  if (hasFileAttachments) {
    return { shouldSearch: true, reason: "file_attachments_present", confidence: 0.95 };
  }

  for (const pattern of NON_RAG_PATTERNS) {
    if (pattern.test(trimmed)) {
      return { shouldSearch: false, reason: "greeting_or_meta_query", confidence: 0.9 };
    }
  }

  if (trimmed.length < 15) {
    for (const pattern of FOLLOW_UP_PATTERNS) {
      if (pattern.test(trimmed)) {
        return {
          shouldSearch: hasDocumentContext,
          reason: hasDocumentContext ? "follow_up_with_doc_context" : "follow_up_no_context",
          confidence: 0.7,
        };
      }
    }
  }

  if (trimmed.length < 8 && !hasDocumentContext) {
    return { shouldSearch: false, reason: "too_short_no_context", confidence: 0.6 };
  }

  return { shouldSearch: true, reason: "substantive_query", confidence: 0.8 };
}

export interface MessageDeliveryAck {
  requestId: string;
  messageId: string;
  status: "received" | "processing" | "rejected";
  timestamp: number;
  promptHash: string;
  reason?: string;
}

export function createDeliveryAck(
  requestId: string,
  messageId: string,
  content: string,
  status: "received" | "processing" | "rejected" = "received",
  reason?: string,
): MessageDeliveryAck {
  return {
    requestId,
    messageId,
    status,
    timestamp: Date.now(),
    promptHash: computePromptHash(content),
    reason,
  };
}

export async function* withResponseValidation(
  source: AsyncIterable<StreamChunk>,
  originalPromptLength: number,
  requestId: string,
  onValidationFailure?: (result: ResponseValidationResult) => void,
): AsyncGenerator<StreamChunk, void, unknown> {
  let accumulatedContent = "";
  let chunkCount = 0;
  let lastChunk: StreamChunk | null = null;

  for await (const chunk of source) {
    chunkCount++;
    accumulatedContent += chunk.content || "";
    lastChunk = chunk;

    if (chunk.done) {
      const validation = validateLLMResponse(accumulatedContent, originalPromptLength);

      if (!validation.valid && validation.severity === "critical") {
        console.warn(`[ResponseValidation] ${validation.reason} for request ${requestId}`, {
          contentLength: accumulatedContent.length,
          chunkCount,
        });
        if (onValidationFailure) {
          onValidationFailure(validation);
        }
        yield {
          ...chunk,
          status: "incomplete",
          incompleteDetails: { reason: validation.reason || "validation_failed" },
          _validationResult: validation,
        };
        return;
      }

      if (validation.severity === "warning") {
        console.info(`[ResponseValidation] Warning: ${validation.reason} for request ${requestId}`);
        yield {
          ...chunk,
          _validationWarning: validation.reason,
        };
        return;
      }

      yield chunk;
      return;
    }

    yield chunk;
  }

  if (chunkCount === 0) {
    console.warn(`[ResponseValidation] No chunks received for request ${requestId}`);
    yield {
      content: "",
      done: true,
      status: "failed",
      incompleteDetails: { reason: "no_chunks_received" },
    };
  }
}

export class ConnectionAliveMonitor {
  private isAlive = true;
  private abortController: AbortController;
  private cleanupCallbacks: Array<() => void> = [];

  constructor(
    private req: any,
    private res: any,
    private requestId: string,
  ) {
    this.abortController = new AbortController();

    const onClose = () => {
      this.isAlive = false;
      this.abortController.abort();
      console.log(`[ConnectionMonitor] Client disconnected: ${requestId}`);
      this.runCleanup();
    };

    const onError = (err: Error) => {
      this.isAlive = false;
      this.abortController.abort();
      console.warn(`[ConnectionMonitor] Connection error: ${requestId}`, err.message);
      this.runCleanup();
    };

    req.once("close", onClose);
    req.once("error", onError);
    if (req.socket) {
      req.socket.once("error", onError);
    }
  }

  get connected(): boolean {
    if (!this.isAlive) return false;
    if (this.res.writableEnded || this.res.destroyed) {
      this.isAlive = false;
      return false;
    }
    if (this.req.socket?.destroyed) {
      this.isAlive = false;
      return false;
    }
    return true;
  }

  get signal(): AbortSignal {
    return this.abortController.signal;
  }

  onCleanup(cb: () => void): void {
    this.cleanupCallbacks.push(cb);
  }

  private runCleanup(): void {
    for (const cb of this.cleanupCallbacks) {
      try { cb(); } catch {}
    }
    this.cleanupCallbacks = [];
  }
}

export class HeartbeatManager {
  private interval: NodeJS.Timeout | null = null;
  private lastWriteTime = Date.now();

  constructor(
    private res: any,
    private intervalMs: number = 15_000,
    private onConnectionLost?: () => void,
  ) {}

  start(): void {
    if (this.interval) return;

    this.interval = setInterval(() => {
      if (this.res.writableEnded || this.res.destroyed) {
        this.stop();
        if (this.onConnectionLost) this.onConnectionLost();
        return;
      }

      try {
        this.res.write(`: heartbeat ${Date.now()}\n\n`);
        if (typeof this.res.flush === "function") {
          this.res.flush();
        } else if (this.res.socket && typeof this.res.socket.write === "function") {
          this.res.socket.write("");
        }
        this.lastWriteTime = Date.now();
      } catch {
        this.stop();
        if (this.onConnectionLost) this.onConnectionLost();
      }
    }, this.intervalMs);
  }

  notifyWrite(): void {
    this.lastWriteTime = Date.now();
  }

  stop(): void {
    if (this.interval) {
      clearInterval(this.interval);
      this.interval = null;
    }
  }

  get timeSinceLastWrite(): number {
    return Date.now() - this.lastWriteTime;
  }
}

export interface StreamRecoveryCheckpoint {
  accumulatedContent: string;
  lastSequenceId: number;
  chunkCount: number;
  provider?: string;
  timestamp: number;
}

export class StreamRecoveryManager {
  private checkpoints = new Map<string, StreamRecoveryCheckpoint>();
  private static readonly MAX_CHECKPOINTS = 100;
  private static readonly CHECKPOINT_TTL_MS = 5 * 60 * 1000;

  saveCheckpoint(requestId: string, checkpoint: StreamRecoveryCheckpoint): void {
    this.checkpoints.set(requestId, checkpoint);

    if (this.checkpoints.size > StreamRecoveryManager.MAX_CHECKPOINTS) {
      this.pruneOldCheckpoints();
    }
  }

  getCheckpoint(requestId: string): StreamRecoveryCheckpoint | undefined {
    return this.checkpoints.get(requestId);
  }

  removeCheckpoint(requestId: string): void {
    this.checkpoints.delete(requestId);
  }

  private pruneOldCheckpoints(): void {
    const now = Date.now();
    for (const [key, cp] of this.checkpoints) {
      if (now - cp.timestamp > StreamRecoveryManager.CHECKPOINT_TTL_MS) {
        this.checkpoints.delete(key);
      }
    }
  }
}

export const streamRecoveryManager = new StreamRecoveryManager();

export function buildSSEHeaders(): Record<string, string> {
  return {
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache, no-transform",
    "Connection": "keep-alive",
    "Transfer-Encoding": "chunked",
    "X-Accel-Buffering": "no",
    "X-Content-Type-Options": "nosniff",
    "Access-Control-Allow-Origin": "*",
  };
}

export function sanitizeForSSE(text: string, maxLength: number = 65536): string {
  if (!text) return "";
  let safe = text.replace(/\0/g, "");
  if (safe.length > maxLength) {
    safe = safe.slice(0, maxLength);
  }
  return safe;
}

export function createFallbackResponse(
  requestId: string,
  error: string,
  locale: string = "es",
): string {
  const messages: Record<string, string> = {
    es: "Hubo un problema procesando tu mensaje. Por favor intenta de nuevo.",
    en: "There was a problem processing your message. Please try again.",
  };
  return messages[locale] || messages.es;
}
