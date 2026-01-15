export type MichatErrorCode =
  | "E_TIMEOUT"
  | "E_RATE_LIMIT"
  | "E_CIRCUIT_OPEN"
  | "E_POLICY_DENIED"
  | "E_TOOL_NOT_FOUND"
  | "E_AGENT_NOT_FOUND"
  | "E_BAD_PARAMS"
  | "E_LLM"
  | "E_WORKFLOW_DAG"
  | "E_INTERNAL"
  | "E_INJECTION_DETECTED"
  | "E_SESSION_NOT_FOUND"
  | "E_IDEMPOTENCY_CONFLICT"
  | "E_QUEUE_FULL";

export class MichatError extends Error {
  readonly code: MichatErrorCode;
  readonly context: Record<string, unknown>;
  readonly timestamp: string;
  readonly isRetryable: boolean;

  constructor(
    code: MichatErrorCode,
    message: string,
    context: Record<string, unknown> = {}
  ) {
    super(`[${code}] ${message}`);
    this.name = "MichatError";
    this.code = code;
    this.context = context;
    this.timestamp = new Date().toISOString();
    this.isRetryable = this.determineRetryable(code);
    Object.setPrototypeOf(this, MichatError.prototype);
  }

  private determineRetryable(code: MichatErrorCode): boolean {
    const nonRetryableCodes: MichatErrorCode[] = [
      "E_POLICY_DENIED",
      "E_TOOL_NOT_FOUND",
      "E_AGENT_NOT_FOUND",
      "E_BAD_PARAMS",
      "E_WORKFLOW_DAG",
    ];
    return !nonRetryableCodes.includes(code);
  }

  toJSON() {
    return {
      name: this.name,
      code: this.code,
      message: this.message,
      context: this.context,
      timestamp: this.timestamp,
      isRetryable: this.isRetryable,
      stack: this.stack,
    };
  }

  static isRateLimitError(err: unknown): err is MichatError {
    return err instanceof MichatError && err.code === "E_RATE_LIMIT";
  }

  static isCircuitOpenError(err: unknown): err is MichatError {
    return err instanceof MichatError && err.code === "E_CIRCUIT_OPEN";
  }

  static isTimeoutError(err: unknown): err is MichatError {
    return err instanceof MichatError && err.code === "E_TIMEOUT";
  }

  static isPolicyError(err: unknown): err is MichatError {
    return err instanceof MichatError && err.code === "E_POLICY_DENIED";
  }

  static isMichatError(err: unknown): err is MichatError {
    return err instanceof MichatError;
  }
}

export function wrapError(err: unknown, fallbackCode: MichatErrorCode = "E_INTERNAL"): MichatError {
  if (err instanceof MichatError) {
    return err;
  }
  
  const message = err instanceof Error 
    ? err.message 
    : typeof err === "string" 
      ? err 
      : "Unknown error";
  
  return new MichatError(fallbackCode, message, {
    originalError: err instanceof Error ? err.name : typeof err,
    stack: err instanceof Error ? err.stack : undefined,
  });
}

export interface UserFacingErrorResult {
  code: MichatErrorCode;
  msg: string;
  showRequestId: boolean;
}

export function userFacingError(err: unknown): UserFacingErrorResult {
  const e = err as any;
  const code: MichatErrorCode = e?.code || "E_INTERNAL";

  const messages: Record<MichatErrorCode, string> = {
    E_RATE_LIMIT: "Estás haciendo muchas solicitudes. Intenta de nuevo en unos segundos.",
    E_TIMEOUT: "Se demoró demasiado. Probemos con un enfoque más corto o por pasos.",
    E_POLICY_DENIED: "No tengo permiso para ejecutar esa acción con tu perfil.",
    E_TOOL_NOT_FOUND: "Esa herramienta no existe (o no está habilitada).",
    E_AGENT_NOT_FOUND: "No encontré el agente para procesar tu solicitud.",
    E_LLM: "Hubo un problema con el modelo. Reintenta o cambia el modo.",
    E_CIRCUIT_OPEN: "El servicio está temporalmente no disponible. Intenta en unos minutos.",
    E_BAD_PARAMS: "Los parámetros de la solicitud no son válidos.",
    E_WORKFLOW_DAG: "El workflow tiene dependencias inválidas.",
    E_INJECTION_DETECTED: "Se detectó un intento de inyección. Por seguridad, no puedo procesar esta solicitud.",
    E_SESSION_NOT_FOUND: "No encontré tu sesión. Inicia una nueva conversación.",
    E_IDEMPOTENCY_CONFLICT: "Esta solicitud ya fue procesada.",
    E_QUEUE_FULL: "El sistema está ocupado. Intenta más tarde.",
    E_INTERNAL: "Ocurrió un error inesperado. Si persiste, envía el requestId.",
  };

  return {
    code,
    msg: messages[code] || messages.E_INTERNAL,
    showRequestId: code === "E_INTERNAL" || code === "E_LLM",
  };
}
