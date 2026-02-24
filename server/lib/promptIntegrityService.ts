/**
 * Prompt Integrity Service — Server-side
 *
 * Validates that the prompt received by the server matches
 * what the client sent (byte length + SHA-256 hash).
 */

import * as crypto from "crypto";

export interface IntegrityCheckResult {
  valid: boolean;
  serverPromptLen: number;
  serverPromptHash: string;
  mismatchType?: "hash" | "length" | "both";
  clientPromptLen?: number;
  clientPromptHash?: string;
  lenDelta?: number;
}

/**
 * Check prompt integrity by comparing client-supplied metadata
 * with server-computed values.
 *
 * If the client did not send integrity fields (backward compat),
 * the check is skipped and `valid` is always `true`.
 */
export function checkPromptIntegrity(
  content: string,
  clientPromptLen?: number,
  clientPromptHash?: string,
): IntegrityCheckResult {
  const serverBytes = Buffer.from(content, "utf-8");
  const serverPromptLen = serverBytes.byteLength;
  const serverPromptHash = crypto.createHash("sha256").update(serverBytes).digest("hex");

  // Backward compatibility: no client fields → skip validation
  if (clientPromptLen == null && clientPromptHash == null) {
    return { valid: true, serverPromptLen, serverPromptHash };
  }

  const lenMatch = clientPromptLen === serverPromptLen;
  const hashMatch = clientPromptHash === serverPromptHash;

  let mismatchType: IntegrityCheckResult["mismatchType"];
  if (!lenMatch && !hashMatch) mismatchType = "both";
  else if (!lenMatch) mismatchType = "length";
  else if (!hashMatch) mismatchType = "hash";

  return {
    valid: lenMatch && hashMatch,
    serverPromptLen,
    serverPromptHash,
    mismatchType,
    clientPromptLen,
    clientPromptHash,
    lenDelta: clientPromptLen != null ? clientPromptLen - serverPromptLen : undefined,
  };
}
