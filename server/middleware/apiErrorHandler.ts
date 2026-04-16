import { Request, Response, NextFunction } from "express";
import { ZodError } from "zod";
import { Logger } from "../lib/logger";

// RFC 7807 Problem Details
interface ProblemDetails {
  type: string;
  title: string;
  status: number;
  detail: string;
  instance?: string;
  code?: string;
  requestId?: string;
  timestamp?: string;
  errors?: Record<string, string[]>;
  // Extension members (RFC 7807 allows extra fields).
  [key: string]: any;
}

export const apiErrorHandler = (
  err: any,
  req: Request,
  res: Response,
  next: NextFunction
) => {
  // If headers are already sent, delegate to default Express handler
  if (res.headersSent) {
    return next(err);
  }

  const isProduction = process.env.NODE_ENV === "production";

  const requestId =
    (typeof (res.locals as any)?.requestId === "string" ? String((res.locals as any).requestId).trim() : "") ||
    (typeof (req as any)?.requestId === "string" ? String((req as any).requestId).trim() : "") ||
    (typeof (req as any)?.correlationId === "string" ? String((req as any).correlationId).trim() : "") ||
    undefined;

  const instance =
    typeof req.originalUrl === "string" && req.originalUrl
      ? req.originalUrl.split("?")[0]
      : req.baseUrl
        ? `${req.baseUrl}${req.path}`
        : req.path;

  function normalizeStatus(raw: unknown): number {
    const parsed = Number(raw);
    if (!Number.isFinite(parsed)) return 500;
    const status = Math.trunc(parsed);
    if (status < 400 || status > 599) return 500;
    return status;
  }

  // Default Error Status and Message
  let status = normalizeStatus(err?.statusCode ?? err?.status ?? 500);
  let code =
    typeof err?.code === "string" && err.code.trim()
      ? err.code.trim()
      : typeof err?.errorCode === "string" && err.errorCode.trim()
        ? err.errorCode.trim()
        : undefined;
  let title = "Internal Server Error";
  let detail = typeof err?.message === "string" && err.message.trim()
    ? err.message.trim()
    : "An unexpected error occurred.";
  let errors: Record<string, string[]> | undefined;

  const statusTitles: Record<number, string> = {
    400: "Bad Request",
    401: "Unauthorized",
    403: "Forbidden",
    404: "Not Found",
    409: "Conflict",
    413: "Payload Too Large",
    422: "Validation Error",
    429: "Too Many Requests",
    500: "Internal Server Error",
    502: "Bad Gateway",
    503: "Service Unavailable",
    504: "Gateway Timeout",
  };

  const statusCodes: Record<number, string> = {
    400: "BAD_REQUEST",
    401: "UNAUTHORIZED",
    403: "FORBIDDEN",
    404: "NOT_FOUND",
    409: "CONFLICT",
    413: "PAYLOAD_TOO_LARGE",
    422: "VALIDATION_ERROR",
    429: "RATE_LIMITED",
    500: "INTERNAL_ERROR",
    502: "BAD_GATEWAY",
    503: "SERVICE_UNAVAILABLE",
    504: "TIMEOUT",
  };

  // Handle Zod Validation Errors
  if (err instanceof ZodError) {
    status = 400;
    title = "Validation Error";
    detail = "The request parameters failed validation.";
    code = code || "VALIDATION_ERROR";

    const flat = err.flatten();
    const fieldErrors = flat.fieldErrors as Record<string, string[] | undefined>;
    const normalized: Record<string, string[]> = {};
    for (const [key, value] of Object.entries(fieldErrors)) {
      if (Array.isArray(value) && value.length > 0) {
        normalized[key] = value;
      }
    }
    if (flat.formErrors.length > 0) {
      normalized._root = flat.formErrors;
    }
    if (Object.keys(normalized).length > 0) {
      errors = normalized;
    }
  } else {
    title = statusTitles[status] || (status >= 500 ? "Internal Server Error" : "Error");
    code = code || statusCodes[status] || (status >= 500 ? "INTERNAL_ERROR" : "BAD_REQUEST");
  }

  const isOperational = Boolean(err?.isOperational);
  if (isProduction && status >= 500 && !isOperational) {
    // Avoid leaking internal error details to clients in production.
    detail = "An unexpected error occurred.";
  }

  const method = req.method;

  // Log strict errors (request context already includes traceId/requestId via AsyncLocalStorage)
  const logLine = `[APIErrorHandler] [${method}] ${instance} - ${title}: ${detail}`;
  if (status >= 500) {
    Logger.error(logLine, err);
  } else if (status === 404) {
    Logger.debug(logLine, { status, code });
  } else {
    Logger.warn(logLine, { status, code });
  }

  // Construct RFC 7807 response (Problem Details)
  const problem: ProblemDetails = {
    type: "about:blank",
    title,
    status,
    detail,
    instance,
    code,
    requestId,
    timestamp: new Date().toISOString(),
  };

  if (errors) {
    problem.errors = errors;
  }

  // Include stack trace only in non-production and only for 5xx.
  if (!isProduction && status >= 500 && err?.stack) {
    problem.stack = err.stack;
  }

  res
    .status(status)
    .type("application/problem+json")
    .json(problem);
};
