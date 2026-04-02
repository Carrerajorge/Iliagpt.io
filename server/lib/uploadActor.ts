import type { Request } from "express";
import crypto from "node:crypto";
import { getOrCreateSecureUserId } from "./anonUserHelper";

function hashUploadActor(value: string): string {
  if (!value || value.length < 12) return "invalid";
  return crypto.createHash("sha256").update(value).digest("hex").slice(0, 24);
}

export function getUploadActorId(req: Request): string {
  const authHeader = req.headers.authorization;
  if (typeof authHeader === "string" && authHeader.startsWith("Bearer ")) {
    const token = authHeader.slice(7).trim();
    if (token.startsWith("ilgpt_")) {
      return `apiToken:${hashUploadActor(token)}`;
    }
    return `bearer:${hashUploadActor(token)}`;
  }

  const apiKey = (req as any).apiKey;
  if (apiKey && typeof apiKey === "object" && typeof apiKey.id === "string" && apiKey.id.length > 0) {
    return `apiKey:${apiKey.id}`;
  }

  return getOrCreateSecureUserId(req);
}
