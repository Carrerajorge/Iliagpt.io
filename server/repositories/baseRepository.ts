import { db } from "../db";

export class OwnershipError extends Error {
  constructor(message: string = "Access denied: resource ownership mismatch") {
    super(message);
    this.name = "OwnershipError";
  }
}

export class ValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ValidationError";
  }
}

export class NotFoundError extends Error {
  constructor(resource: string, id: string) {
    super(`${resource} with id '${id}' not found`);
    this.name = "NotFoundError";
  }
}

export function validateOwnership(userId: string, resourceUserId: string | null | undefined): void {
  if (!userId) {
    throw new ValidationError("userId is required for ownership validation");
  }
  if (!resourceUserId) {
    throw new OwnershipError("Resource has no owner");
  }
  if (userId !== resourceUserId) {
    throw new OwnershipError(`User ${userId} does not own resource belonging to ${resourceUserId}`);
  }
}

export function validateUserId(userId: string | null | undefined): asserts userId is string {
  if (!userId || typeof userId !== "string" || userId.trim() === "") {
    throw new ValidationError("Valid userId is required");
  }
}

export function validateResourceId(resourceId: string | null | undefined, resourceName: string = "Resource"): asserts resourceId is string {
  if (!resourceId || typeof resourceId !== "string" || resourceId.trim() === "") {
    throw new ValidationError(`Valid ${resourceName} id is required`);
  }
}

export interface LogContext {
  userId?: string;
  resourceId?: string;
  action: string;
  metadata?: Record<string, any>;
}

export function logRepositoryAction(context: LogContext): void {
  const timestamp = new Date().toISOString();
  const { userId, resourceId, action, metadata } = context;
  console.log(JSON.stringify({
    timestamp,
    layer: "repository",
    action,
    userId: userId || "anonymous",
    resourceId: resourceId || "n/a",
    ...metadata,
  }));
}

export async function withTransaction<T>(
  callback: (tx: typeof db) => Promise<T>
): Promise<T> {
  return db.transaction(async (tx) => {
    return callback(tx as typeof db);
  });
}

export const BaseRepository = {
  validateOwnership,
  validateUserId,
  validateResourceId,
  logRepositoryAction,
  withTransaction,
  OwnershipError,
  ValidationError,
  NotFoundError,
};

export default BaseRepository;
