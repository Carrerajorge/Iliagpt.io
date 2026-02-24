import { err, ok } from "../../shared/result";
import type { Result } from "../../shared/result";

const MAX_ERROR_ID_LENGTH = 128;
const MAX_MESSAGE_LENGTH = 2000;
const MAX_STACK_LENGTH = 4000;
const MAX_URL_LENGTH = 2048;
const MAX_UA_LENGTH = 512;
const MAX_COMPONENT_NAME_LENGTH = 128;

export type ClientErrorLog = Readonly<{
  errorId: string;
  message: string;
  stack?: string;
  componentStack?: string;
  componentName?: string;
  url: string;
  userAgent: string;
  timestampIso: string;
  userId?: number;
  sessionId?: string;
}>;

export type ClientErrorLogInput = Readonly<{
  errorId?: string;
  message: string;
  stack?: string;
  componentStack?: string;
  componentName?: string;
  url: string;
  userAgent: string;
  userId?: number;
  sessionId?: string;
  now?: Date;
}>;

export type ClientErrorLogValidationErrorCode =
  | "invalid_payload"
  | "invalid_error_id"
  | "invalid_message"
  | "invalid_url"
  | "invalid_user_agent";

export type ClientErrorLogValidationError = Readonly<{
  code: ClientErrorLogValidationErrorCode;
  message: string;
}>;

function stripBidiControls(value: string): string {
  return value.replace(/[\u202A-\u202E\u2066-\u2069]/g, "");
}

function stripControlChars(value: string, allowNewlines: boolean): string {
  return allowNewlines
    ? value.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f-\u009f]/g, "")
    : value.replace(/[\u0000-\u001f\u007f-\u009f]/g, "");
}

function sanitizeText(value: unknown, maxLength: number, options?: { allowNewlines?: boolean }): string {
  const allowNewlines = options?.allowNewlines ?? false;
  const normalized = String(value ?? "")
    .normalize("NFKC")
    .replace(/\u0000/g, "")
    .trim()
    .slice(0, maxLength);

  return stripBidiControls(stripControlChars(normalized, allowNewlines));
}

function sanitizeErrorId(value: unknown): string {
  const raw = sanitizeText(value, MAX_ERROR_ID_LENGTH);
  return raw.replace(/[^a-zA-Z0-9._:-]/g, "");
}

function canonicalizeUrl(rawUrl: unknown): Result<string, ClientErrorLogValidationError> {
  const candidate = sanitizeText(rawUrl, MAX_URL_LENGTH);
  if (!candidate) {
    return err({ code: "invalid_url", message: "Missing url" });
  }

  let parsed: URL;
  try {
    parsed = new URL(candidate);
  } catch {
    return err({ code: "invalid_url", message: "Invalid url" });
  }

  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    return err({ code: "invalid_url", message: "Unsupported url protocol" });
  }

  // Drop sensitive fragments and query params. Keep only origin + path.
  parsed.username = "";
  parsed.password = "";
  parsed.hash = "";
  parsed.search = "";

  const normalized = parsed.toString();
  if (!normalized || normalized.length > MAX_URL_LENGTH) {
    return err({ code: "invalid_url", message: "Invalid url" });
  }

  return ok(normalized);
}

export function createClientErrorLog(input: ClientErrorLogInput): Result<ClientErrorLog, ClientErrorLogValidationError> {
  if (!input || typeof input !== "object") {
    return err({ code: "invalid_payload", message: "Invalid payload" });
  }

  const now = input.now ?? new Date();

  const errorId = sanitizeErrorId(input.errorId) || `err_${now.getTime()}`;
  if (!errorId) {
    return err({ code: "invalid_error_id", message: "Invalid errorId" });
  }

  const message = sanitizeText(input.message, MAX_MESSAGE_LENGTH, { allowNewlines: true });
  if (!message) {
    return err({ code: "invalid_message", message: "Missing message" });
  }

  const urlResult = canonicalizeUrl(input.url);
  if (!urlResult.ok) {
    return urlResult;
  }

  const userAgent = sanitizeText(input.userAgent, MAX_UA_LENGTH);
  if (!userAgent) {
    return err({ code: "invalid_user_agent", message: "Missing userAgent" });
  }

  const stack = input.stack ? sanitizeText(input.stack, MAX_STACK_LENGTH, { allowNewlines: true }) : undefined;
  const componentStack = input.componentStack
    ? sanitizeText(input.componentStack, MAX_STACK_LENGTH, { allowNewlines: true })
    : undefined;
  const componentName = input.componentName ? sanitizeText(input.componentName, MAX_COMPONENT_NAME_LENGTH) : undefined;

  const log: ClientErrorLog = {
    errorId,
    message,
    stack,
    componentStack,
    componentName,
    url: urlResult.value,
    userAgent,
    timestampIso: now.toISOString(),
    userId: typeof input.userId === "number" ? input.userId : undefined,
    sessionId: typeof input.sessionId === "string" ? input.sessionId : undefined,
  };

  return ok(log);
}
