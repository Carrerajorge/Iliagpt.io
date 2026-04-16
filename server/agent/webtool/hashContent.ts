import { createHash } from "crypto";
import { z } from "zod";

export const ContentInputSchema = z.string();

export function hashContent(content: string): string {
  const result = ContentInputSchema.safeParse(content);
  if (!result.success || !result.data) {
    return createHash("sha256").update("").digest("hex");
  }
  const validatedContent = result.data;
  
  const normalized = normalizeContent(validatedContent);
  
  return createHash("sha256").update(normalized, "utf8").digest("hex");
}

function normalizeContent(content: string): string {
  let normalized = content;
  
  normalized = normalized.replace(/\s+/g, " ");
  
  normalized = normalized.trim();
  
  normalized = normalized.toLowerCase();
  
  normalized = normalized.replace(/[^\w\s]/g, "");
  
  return normalized;
}

export function hashContentRaw(content: string): string {
  if (!content || typeof content !== "string") {
    return createHash("sha256").update("").digest("hex");
  }
  
  return createHash("sha256").update(content, "utf8").digest("hex");
}

export function hashUrl(url: string): string {
  return createHash("sha256").update(url, "utf8").digest("hex");
}

export function shortHash(content: string, length: number = 8): string {
  return hashContent(content).slice(0, length);
}
