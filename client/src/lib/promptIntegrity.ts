/**
 * Prompt Integrity — Client-side utilities
 *
 * Computes SHA-256 hash and byte-length of prompt content
 * so the server can verify nothing was lost in transit.
 */

export interface PromptIntegrityMeta {
  clientPromptLen: number;      // UTF-8 byte length
  clientPromptHash: string;     // SHA-256 hex digest
  clientPromptCharCount: number; // Unicode codepoint count
  messageId: string;
}

/**
 * Compute integrity metadata for a prompt string.
 *
 * Uses the native Web Crypto API (crypto.subtle) for SHA-256.
 * Falls back to a length-only check if SubtleCrypto is unavailable
 * (e.g. non-secure context in very old browsers).
 */
export async function computePromptIntegrity(content: string): Promise<PromptIntegrityMeta> {
  const encoder = new TextEncoder();
  const data = encoder.encode(content);
  const byteLen = data.byteLength;

  let hashHex = "";
  try {
    const hashBuffer = await crypto.subtle.digest("SHA-256", data);
    const hashArray = new Uint8Array(hashBuffer);
    for (let i = 0; i < hashArray.length; i++) {
      hashHex += hashArray[i].toString(16).padStart(2, "0");
    }
  } catch {
    // SubtleCrypto unavailable — send empty hash; server will skip validation
    hashHex = "";
  }

  return {
    clientPromptLen: byteLen,
    clientPromptHash: hashHex,
    clientPromptCharCount: [...content].length,
    messageId: crypto.randomUUID?.() ?? `msg_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`,
  };
}
