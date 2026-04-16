import { z } from "zod";
import { RunSchema, StepSchema, ToolOutputSchema, AgentEventSchema } from "./contracts";

export function validateOrThrow<T>(schema: z.ZodSchema<T>, data: unknown, context: string): T {
  const result = schema.safeParse(data);
  if (!result.success) {
    console.error(`[Validation] ${context} failed:`, result.error.errors);
    throw new ValidationError(context, result.error);
  }
  return result.data;
}

export function validateOrDefault<T>(schema: z.ZodSchema<T>, data: unknown, defaultValue: T, context: string): T {
  const result = schema.safeParse(data);
  if (!result.success) {
    console.warn(`[Validation] ${context} failed, using default:`, result.error.message);
    return defaultValue;
  }
  return result.data;
}

export class ValidationError extends Error {
  public readonly originalStack: string;
  
  constructor(public context: string, public zodError: z.ZodError) {
    super(`Validation failed in ${context}: ${zodError.message}`);
    this.name = "ValidationError";
    this.originalStack = new Error().stack || "";
    
    Error.captureStackTrace?.(this, ValidationError);
  }

  getFormattedErrors(): string[] {
    return this.zodError.errors.map(e => 
      `${e.path.join(".")}: ${e.message}`
    );
  }

  toJSON(): object {
    return {
      name: this.name,
      context: this.context,
      message: this.message,
      errors: this.getFormattedErrors(),
    };
  }
}
