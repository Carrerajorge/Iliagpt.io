import type { Request, Response, NextFunction } from "express";
import type { PareContext } from "./pareRequestContract";
import {
  validateAnalyzeRequest,
  validateChatRequest,
  canonicalizeAnalyzeRequest,
  canonicalizeChatRequest,
  type AnalyzeRequest,
  type ChatRequest,
  type ValidationFieldError,
} from "../lib/pareSchemas";

export interface PareContextWithValidation extends PareContext {
  validatedBody?: AnalyzeRequest | ChatRequest;
}

export interface SchemaValidationError {
  code: "VALIDATION_ERROR";
  message: string;
  requestId: string;
  errors: ValidationFieldError[];
}

function buildErrorResponse(
  requestId: string,
  errors: ValidationFieldError[]
): SchemaValidationError {
  const primaryError = errors[0];
  const fieldList = errors.slice(0, 3).map((e) => e.path || "body").join(", ");
  
  return {
    code: "VALIDATION_ERROR",
    message: `Request validation failed: ${primaryError?.message || "Invalid request body"}. Fields with errors: ${fieldList}`,
    requestId,
    errors,
  };
}

export function pareAnalyzeSchemaValidator(
  req: Request,
  res: Response,
  next: NextFunction
): void {
  const pareContext = req.pareContext;
  
  if (!pareContext) {
    console.error(JSON.stringify({
      level: "error",
      event: "PARE_SCHEMA_VALIDATOR_NO_CONTEXT",
      message: "pareRequestContract middleware must be applied before pareSchemaValidator",
      path: req.path,
      timestamp: new Date().toISOString(),
    }));
    return next(new Error("PARE context not initialized"));
  }
  
  const { requestId } = pareContext;
  
  const validationResult = validateAnalyzeRequest(req.body);
  
  if (!validationResult.success) {
    console.log(JSON.stringify({
      level: "warn",
      event: "PARE_SCHEMA_VALIDATION_FAILED",
      requestId,
      errorCount: validationResult.errors?.length || 0,
      errors: validationResult.errors?.slice(0, 5),
      path: req.path,
      timestamp: new Date().toISOString(),
    }));
    
    res.status(400).json({
      error: buildErrorResponse(requestId, validationResult.errors || []),
    });
    return;
  }
  
  const canonicalizedData = canonicalizeAnalyzeRequest(validationResult.data!);
  
  (req.pareContext as PareContextWithValidation).validatedBody = canonicalizedData;
  
  req.body = {
    ...req.body,
    ...canonicalizedData,
  };
  
  console.log(JSON.stringify({
    level: "debug",
    event: "PARE_SCHEMA_VALIDATION_PASSED",
    requestId,
    messagesCount: canonicalizedData.messages.length,
    attachmentsCount: canonicalizedData.attachments.length,
    timestamp: new Date().toISOString(),
  }));
  
  next();
}

export function pareChatSchemaValidator(
  req: Request,
  res: Response,
  next: NextFunction
): void {
  const pareContext = req.pareContext;
  
  if (!pareContext) {
    console.error(JSON.stringify({
      level: "error",
      event: "PARE_SCHEMA_VALIDATOR_NO_CONTEXT",
      message: "pareRequestContract middleware must be applied before pareChatSchemaValidator",
      path: req.path,
      timestamp: new Date().toISOString(),
    }));
    return next(new Error("PARE context not initialized"));
  }
  
  const { requestId } = pareContext;
  
  const validationResult = validateChatRequest(req.body);
  
  if (!validationResult.success) {
    console.log(JSON.stringify({
      level: "warn",
      event: "PARE_CHAT_SCHEMA_VALIDATION_FAILED",
      requestId,
      errorCount: validationResult.errors?.length || 0,
      errors: validationResult.errors?.slice(0, 5),
      path: req.path,
      timestamp: new Date().toISOString(),
    }));
    
    res.status(400).json({
      error: buildErrorResponse(requestId, validationResult.errors || []),
    });
    return;
  }
  
  const canonicalizedData = canonicalizeChatRequest(validationResult.data!);
  
  (req.pareContext as PareContextWithValidation).validatedBody = canonicalizedData;
  
  req.body = {
    ...req.body,
    ...canonicalizedData,
  };
  
  console.log(JSON.stringify({
    level: "debug",
    event: "PARE_CHAT_SCHEMA_VALIDATION_PASSED",
    requestId,
    messagesCount: canonicalizedData.messages.length,
    attachmentsCount: canonicalizedData.attachments?.length || 0,
    timestamp: new Date().toISOString(),
  }));
  
  next();
}

export function createSchemaValidator(schema: "analyze" | "chat") {
  return schema === "analyze" ? pareAnalyzeSchemaValidator : pareChatSchemaValidator;
}
