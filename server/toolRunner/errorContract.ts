export const TOOL_RUNNER_ERROR_CODES = {
  INVALID_ARGS: "TR_0001_INVALID_ARGS",
  INVALID_INPUT: "TR_0002_INVALID_INPUT",
  PRECHECK_FAILED: "TR_0003_PREFLIGHT_FAILED",
  TOOL_NOT_FOUND: "TR_0004_TOOL_NOT_FOUND",
  TOOL_TIMEOUT: "TR_0005_TOOL_TIMEOUT",
  TOOL_EXECUTION_FAILED: "TR_0006_TOOL_EXECUTION_FAILED",
  OUTPUT_MISSING: "TR_0007_OUTPUT_MISSING",
  SANDBOX_FAILED: "TR_0008_SANDBOX_FAILED",
  OPENXML_INVALID: "TR_0009_OPENXML_INVALID",
  VERSION_MISMATCH: "TR_0010_VERSION_MISMATCH",
  FALLBACK_FAILED: "TR_0011_FALLBACK_FAILED",
  INTERNAL: "TR_0012_INTERNAL",
} as const;

export type ToolRunnerErrorCode =
  (typeof TOOL_RUNNER_ERROR_CODES)[keyof typeof TOOL_RUNNER_ERROR_CODES];

export const TOOL_RUNNER_EXIT_CODES: Record<ToolRunnerErrorCode, number> = {
  [TOOL_RUNNER_ERROR_CODES.INVALID_ARGS]: 2,
  [TOOL_RUNNER_ERROR_CODES.INVALID_INPUT]: 10,
  [TOOL_RUNNER_ERROR_CODES.PRECHECK_FAILED]: 11,
  [TOOL_RUNNER_ERROR_CODES.TOOL_NOT_FOUND]: 12,
  [TOOL_RUNNER_ERROR_CODES.TOOL_TIMEOUT]: 13,
  [TOOL_RUNNER_ERROR_CODES.TOOL_EXECUTION_FAILED]: 14,
  [TOOL_RUNNER_ERROR_CODES.OUTPUT_MISSING]: 15,
  [TOOL_RUNNER_ERROR_CODES.SANDBOX_FAILED]: 16,
  [TOOL_RUNNER_ERROR_CODES.OPENXML_INVALID]: 17,
  [TOOL_RUNNER_ERROR_CODES.VERSION_MISMATCH]: 18,
  [TOOL_RUNNER_ERROR_CODES.FALLBACK_FAILED]: 19,
  [TOOL_RUNNER_ERROR_CODES.INTERNAL]: 99,
};

const LOCALIZED_MESSAGES: Record<string, Record<ToolRunnerErrorCode, string>> = {
  es: {
    [TOOL_RUNNER_ERROR_CODES.INVALID_ARGS]: "Argumentos inválidos para el comando solicitado.",
    [TOOL_RUNNER_ERROR_CODES.INVALID_INPUT]: "Entrada inválida: falta información obligatoria o el formato no coincide.",
    [TOOL_RUNNER_ERROR_CODES.PRECHECK_FAILED]: "El preflight detectó problemas que impiden continuar con seguridad.",
    [TOOL_RUNNER_ERROR_CODES.TOOL_NOT_FOUND]: "La herramienta solicitada no está registrada o no es compatible.",
    [TOOL_RUNNER_ERROR_CODES.TOOL_TIMEOUT]: "La herramienta excedió el tiempo máximo configurado.",
    [TOOL_RUNNER_ERROR_CODES.TOOL_EXECUTION_FAILED]: "La herramienta falló durante la ejecución.",
    [TOOL_RUNNER_ERROR_CODES.OUTPUT_MISSING]: "La herramienta finalizó pero no generó los artefactos esperados.",
    [TOOL_RUNNER_ERROR_CODES.SANDBOX_FAILED]: "No se pudo iniciar o mantener el entorno sandbox.",
    [TOOL_RUNNER_ERROR_CODES.OPENXML_INVALID]: "La validación MSO/OpenXML detectó un paquete inválido.",
    [TOOL_RUNNER_ERROR_CODES.VERSION_MISMATCH]: "La versión fijada de la herramienta no coincide con la versión disponible.",
    [TOOL_RUNNER_ERROR_CODES.FALLBACK_FAILED]: "También falló la degradación elegante y no fue posible recuperar un artefacto válido.",
    [TOOL_RUNNER_ERROR_CODES.INTERNAL]: "Error interno del Tool Runner.",
  },
  en: {
    [TOOL_RUNNER_ERROR_CODES.INVALID_ARGS]: "Invalid command arguments.",
    [TOOL_RUNNER_ERROR_CODES.INVALID_INPUT]: "Invalid input: required fields are missing or malformed.",
    [TOOL_RUNNER_ERROR_CODES.PRECHECK_FAILED]: "Preflight checks failed and execution cannot continue safely.",
    [TOOL_RUNNER_ERROR_CODES.TOOL_NOT_FOUND]: "Requested tool is not registered or not compatible.",
    [TOOL_RUNNER_ERROR_CODES.TOOL_TIMEOUT]: "Tool execution exceeded the configured timeout.",
    [TOOL_RUNNER_ERROR_CODES.TOOL_EXECUTION_FAILED]: "Tool execution failed.",
    [TOOL_RUNNER_ERROR_CODES.OUTPUT_MISSING]: "Tool finished but did not produce the expected artifacts.",
    [TOOL_RUNNER_ERROR_CODES.SANDBOX_FAILED]: "Failed to start or maintain the sandbox environment.",
    [TOOL_RUNNER_ERROR_CODES.OPENXML_INVALID]: "MSO/OpenXML validation reported an invalid package.",
    [TOOL_RUNNER_ERROR_CODES.VERSION_MISMATCH]: "Pinned tool version does not match the available version.",
    [TOOL_RUNNER_ERROR_CODES.FALLBACK_FAILED]: "Graceful degradation also failed; no valid artifact could be recovered.",
    [TOOL_RUNNER_ERROR_CODES.INTERNAL]: "Tool Runner internal error.",
  },
};

export function localizeToolRunnerError(
  code: ToolRunnerErrorCode,
  locale: string,
  details?: string
): string {
  const lang = locale.startsWith("es") ? "es" : "en";
  const base = LOCALIZED_MESSAGES[lang]?.[code] ?? LOCALIZED_MESSAGES.en[code];
  if (!details) {
    return base;
  }
  return `${base} ${details}`;
}

export function getExitCodeForError(code: ToolRunnerErrorCode): number {
  return TOOL_RUNNER_EXIT_CODES[code] ?? TOOL_RUNNER_EXIT_CODES[TOOL_RUNNER_ERROR_CODES.INTERNAL];
}

export interface ToolRunnerErrorPayload {
  code: ToolRunnerErrorCode;
  locale: string;
  details?: string;
}

export function buildToolRunnerErrorMessage(payload: ToolRunnerErrorPayload): string {
  return localizeToolRunnerError(payload.code, payload.locale, payload.details);
}
