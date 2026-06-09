/**
 * thinkTagParser — incremental splitter for models that emit extended
 * thinking as <think>…</think> tags inside the content stream (self-hosted
 * DeepSeek-R1 distills, QwQ, etc. — capability `reasoning: "think-tag"`).
 *
 * Stream-safe: a tag can be split across chunk boundaries ("<thi" + "nk>"),
 * so the parser carries a small tail between pushes. Everything inside the
 * tags is routed to `reasoning`, everything outside to `content`. A single
 * leading think block is the norm; nested/multiple blocks are handled too.
 */

const OPEN_TAG = "<think>";
const CLOSE_TAG = "</think>";
// Longest prefix we may need to withhold while waiting for the rest of a tag.
const MAX_CARRY = CLOSE_TAG.length - 1;

export interface ThinkSplit {
  reasoning: string;
  content: string;
}

/** True when the tail of `text` could be the start of `tag`. */
function danglingPrefixLength(text: string, tag: string): number {
  const max = Math.min(text.length, tag.length - 1);
  for (let len = max; len > 0; len--) {
    if (text.endsWith(tag.slice(0, len))) return len;
  }
  return 0;
}

export class ThinkTagStreamParser {
  private inThink = false;
  private carry = "";
  private sawAnyTag = false;

  /** Feed a content delta; returns the split for THIS push. */
  push(delta: string): ThinkSplit {
    let text = this.carry + String(delta ?? "");
    this.carry = "";
    let reasoning = "";
    let content = "";

    while (text.length > 0) {
      if (this.inThink) {
        const close = text.indexOf(CLOSE_TAG);
        if (close >= 0) {
          reasoning += text.slice(0, close);
          text = text.slice(close + CLOSE_TAG.length);
          this.inThink = false;
          continue;
        }
        const dangling = danglingPrefixLength(text, CLOSE_TAG);
        if (dangling > 0) {
          reasoning += text.slice(0, text.length - dangling);
          this.carry = text.slice(text.length - dangling);
        } else {
          reasoning += text;
        }
        text = "";
      } else {
        const open = text.indexOf(OPEN_TAG);
        if (open >= 0) {
          content += text.slice(0, open);
          text = text.slice(open + OPEN_TAG.length);
          this.inThink = true;
          this.sawAnyTag = true;
          continue;
        }
        const dangling = danglingPrefixLength(text, OPEN_TAG);
        if (dangling > 0) {
          content += text.slice(0, text.length - dangling);
          this.carry = text.slice(text.length - dangling);
        } else {
          content += text;
        }
        text = "";
      }
    }

    return { reasoning, content };
  }

  /** Flush at end of stream: any withheld tail is emitted as-is. */
  flush(): ThinkSplit {
    const tail = this.carry;
    this.carry = "";
    if (!tail) return { reasoning: "", content: "" };
    // An unterminated think block ends the stream → treat tail as reasoning;
    // otherwise the dangling "<thi…" turned out to be ordinary text.
    return this.inThink ? { reasoning: tail, content: "" } : { reasoning: "", content: tail };
  }

  /** Whether the stream used think tags at all (for telemetry). */
  get usedThinkTags(): boolean {
    return this.sawAnyTag;
  }
}

export const __testing = { OPEN_TAG, CLOSE_TAG, MAX_CARRY, danglingPrefixLength };
