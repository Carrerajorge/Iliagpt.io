const OPTIONAL_PERSISTENCE_SQL_CODES = new Set([
  "42P01",
  "42703",
  "42704",
  "42883",
]);

const OPTIONAL_CHAT_RUN_TOKENS = [
  "chat_runs",
  "tool_invocations",
  "claim_pending_run",
  "client_request_id",
  "user_message_id",
];

const OPTIONAL_CONVERSATION_STATE_TOKENS = [
  "conversation_states",
  "conversation_state_messages",
  "conversation_state_artifacts",
  "conversation_state_images",
  "latest-image",
];

function getSqlCode(error: unknown): string | undefined {
  const anyError = error as {
    code?: string;
    cause?: { code?: string };
  } | null;

  return anyError?.cause?.code || anyError?.code;
}

function getErrorTextParts(error: unknown): string[] {
  const anyError = error as {
    message?: string;
    detail?: string;
    hint?: string;
    routine?: string;
    query?: string;
    cause?: {
      message?: string;
      detail?: string;
      hint?: string;
      routine?: string;
      query?: string;
    };
  } | null;

  return [
    anyError?.cause?.message,
    anyError?.cause?.detail,
    anyError?.cause?.hint,
    anyError?.cause?.routine,
    anyError?.cause?.query,
    anyError?.message,
    anyError?.detail,
    anyError?.hint,
    anyError?.routine,
    anyError?.query,
  ].filter((value): value is string => typeof value === "string" && value.trim().length > 0);
}

function matchesOptionalPersistenceError(
  error: unknown,
  tokens: string[],
): boolean {
  const code = getSqlCode(error);
  const textBlob = getErrorTextParts(error).join("\n").toLowerCase();

  if (!textBlob) {
    return false;
  }

  const matchesToken = tokens.some((token) => textBlob.includes(token));
  if (!matchesToken) {
    return false;
  }

  return !code || OPTIONAL_PERSISTENCE_SQL_CODES.has(code);
}

export function isOptionalChatRunPersistenceError(error: unknown): boolean {
  return matchesOptionalPersistenceError(error, OPTIONAL_CHAT_RUN_TOKENS);
}

export function isOptionalConversationStatePersistenceError(
  error: unknown,
): boolean {
  return matchesOptionalPersistenceError(
    error,
    OPTIONAL_CONVERSATION_STATE_TOKENS,
  );
}

export function summarizePersistenceCompatibilityError(
  error: unknown,
): string {
  const code = getSqlCode(error);
  const summary =
    getErrorTextParts(error)[0] || "unknown persistence compatibility error";

  return code ? `${code}: ${summary}` : summary;
}
