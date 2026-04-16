/**
 * Multi-Layer Token Counter
 *
 * L0: Fast heuristic (Math.ceil(length / 4)) — <0.1ms
 * L1: Accurate via js-tiktoken with encoding selection — ~1-5ms
 * L2: Redis cache for repeated prompts — sub-ms on hit
 *
 * LRU in-memory cache sits between L1 and L2 (max 1000 entries, 60s TTL).
 */

import * as crypto from "crypto";

// js-tiktoken: lazy-load to avoid blocking startup
let _encodingForModel: ((model: any) => any) | null = null;
let _getEncoding: ((enc: any) => any) | null = null;

// gpt-tokenizer: secondary tokenizer with native o200k_base support
let _gptTokenizerEncode: ((text: string) => number[]) | null = null;
let _gptTokenizerO200k: { encode: (text: string) => number[] } | null = null;

async function loadTiktoken() {
  if (_encodingForModel) return;
  try {
    const mod = await import("js-tiktoken");
    _encodingForModel = mod.encodingForModel as (model: any) => any;
    _getEncoding = mod.getEncoding as (enc: any) => any;
  } catch {
    // If js-tiktoken fails to load, try gpt-tokenizer as fallback
  }
}

async function loadGptTokenizer() {
  if (_gptTokenizerEncode) return;
  try {
    const mod = await import("gpt-tokenizer");
    _gptTokenizerEncode = mod.encode;
    // Load o200k_base encoding for O-series models (o1, o2, o3, etc.)
    // Use CJS path for compatibility with current moduleResolution
    const o200k = await import("gpt-tokenizer/cjs/encoding/o200k_base");
    _gptTokenizerO200k = { encode: o200k.encode };
  } catch {
    // gpt-tokenizer not available — js-tiktoken or heuristic will be used
  }
}

// Start loading both tokenizers immediately (non-blocking)
loadTiktoken();
loadGptTokenizer();

/** Map model name patterns to tiktoken encoding names. */
const MODEL_ENCODING_MAP: Array<[RegExp, string]> = [
  [/^gpt-4/i, "cl100k_base"],
  [/^gpt-3\.5/i, "cl100k_base"],
  [/^o[1-9]/i, "o200k_base"],
  [/^gemini/i, "cl100k_base"],
  [/^claude/i, "cl100k_base"],
  [/^deepseek/i, "cl100k_base"],
  [/^grok/i, "cl100k_base"],
  [/^command/i, "cl100k_base"],
  [/^mistral/i, "cl100k_base"],
];

function getEncodingName(model?: string): string {
  if (!model) return "cl100k_base";
  for (const [pattern, encoding] of MODEL_ENCODING_MAP) {
    if (pattern.test(model)) return encoding;
  }
  return "cl100k_base";
}

interface CacheEntry {
  count: number;
  ts: number;
}

const LRU_MAX = 1000;
const LRU_TTL_MS = 60_000;

class TokenCounter {
  private lruCache = new Map<string, CacheEntry>();

  /** L0 — Fast heuristic. Use for quick budget checks. */
  countFast(text: string): number {
    return Math.ceil(text.length / 4);
  }

  /** L1 — Accurate count via js-tiktoken, with gpt-tokenizer fallback. Falls back to L0 if neither is available. */
  countAccurate(text: string, model?: string): number {
    const encName = getEncodingName(model);

    // Primary: js-tiktoken
    if (_getEncoding) {
      try {
        const enc = _getEncoding(encName);
        const tokens = enc.encode(text).length;
        enc.free();
        return tokens;
      } catch {
        // Fall through to gpt-tokenizer
      }
    }

    // Fallback: gpt-tokenizer (especially good for o200k_base)
    if (encName === "o200k_base" && _gptTokenizerO200k) {
      try {
        return _gptTokenizerO200k.encode(text).length;
      } catch {
        // Fall through to default gpt-tokenizer
      }
    }
    if (_gptTokenizerEncode) {
      try {
        return _gptTokenizerEncode(text).length;
      } catch {
        // Fall through to heuristic
      }
    }

    return this.countFast(text);
  }

  /** L1 + LRU cache. Best for repeated/similar prompts in a conversation. */
  countCached(text: string, model?: string): number {
    const key = this.cacheKey(text, model);

    // Check LRU
    const cached = this.lruCache.get(key);
    if (cached && Date.now() - cached.ts < LRU_TTL_MS) {
      // Move to end (most recent)
      this.lruCache.delete(key);
      this.lruCache.set(key, cached);
      return cached.count;
    }

    const count = this.countAccurate(text, model);

    // Evict oldest if at capacity
    if (this.lruCache.size >= LRU_MAX) {
      const oldest = this.lruCache.keys().next().value;
      if (oldest !== undefined) this.lruCache.delete(oldest);
    }

    this.lruCache.set(key, { count, ts: Date.now() });
    return count;
  }

  /** Count tokens for an array of messages (common pattern). */
  countMessages(messages: Array<{ role: string; content: string | unknown }>, model?: string): number {
    let total = 0;
    for (const msg of messages) {
      const text = typeof msg.content === "string" ? msg.content : JSON.stringify(msg.content);
      total += this.countFast(text);
      total += 4; // overhead per message (role, delimiters)
    }
    return total;
  }

  /** Count messages with accurate encoding. */
  countMessagesAccurate(messages: Array<{ role: string; content: string | unknown }>, model?: string): number {
    let total = 0;
    for (const msg of messages) {
      const text = typeof msg.content === "string" ? msg.content : JSON.stringify(msg.content);
      total += this.countAccurate(text, model);
      total += 4;
    }
    return total;
  }

  /** Whether an accurate tokenizer (js-tiktoken or gpt-tokenizer) is loaded and available. */
  get isAccurateAvailable(): boolean {
    return _getEncoding !== null || _gptTokenizerEncode !== null;
  }

  /** Clear the in-memory cache. */
  clearCache(): void {
    this.lruCache.clear();
  }

  /** Current cache size. */
  get cacheSize(): number {
    return this.lruCache.size;
  }

  private cacheKey(text: string, model?: string): string {
    const hash = crypto.createHash("md5").update(text).digest("hex");
    return `${model || "default"}:${hash}`;
  }
}

export const tokenCounter = new TokenCounter();
export { TokenCounter };
