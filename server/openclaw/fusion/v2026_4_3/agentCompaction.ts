import { createLogger } from '../../../utils/logger';

const log = createLogger('openclaw-compaction');

export interface CompactionOptions {
  maxTokens?: number;
  strategy?: 'sliding-window' | 'summarize-oldest' | 'keep-system';
}

interface Message {
  role: string;
  content: string;
}

const DEFAULT_MAX_TOKENS = 100_000;
const CHARS_PER_TOKEN = 4;

function estimateTokens(messages: Message[]): number {
  return messages.reduce((sum, m) => {
    const content = typeof m.content === 'string' ? m.content : JSON.stringify(m.content);
    return sum + Math.ceil(content.length / CHARS_PER_TOKEN);
  }, 0);
}

function summarizeMessage(msg: Message): Message {
  const content = typeof msg.content === 'string' ? msg.content : JSON.stringify(msg.content);
  if (content.length <= 200) return msg;
  return { ...msg, content: content.slice(0, 180) + '… [compacted]' };
}

export function compactMessages(
  messages: Message[],
  options: CompactionOptions = {}
): { messages: Message[]; compacted: boolean; removedCount: number } {
  const maxTokens = options.maxTokens ?? DEFAULT_MAX_TOKENS;
  const strategy = options.strategy ?? 'sliding-window';

  const estimated = estimateTokens(messages);
  if (estimated <= maxTokens) {
    return { messages, compacted: false, removedCount: 0 };
  }

  log.info(`[Compaction] Context ${estimated} tokens > ${maxTokens} limit — applying ${strategy}`);

  const systemMessages = messages.filter(m => m.role === 'system');
  const nonSystem = messages.filter(m => m.role !== 'system');

  if (strategy === 'sliding-window') {
    let result = [...systemMessages, ...nonSystem];
    let removed = 0;

    while (estimateTokens(result) > maxTokens && result.length > systemMessages.length + 2) {
      const removeIdx = systemMessages.length;
      result.splice(removeIdx, 1);
      removed++;
    }

    log.info(`[Compaction] sliding-window removed ${removed} messages`);
    return { messages: result, compacted: true, removedCount: removed };
  }

  if (strategy === 'summarize-oldest') {
    const keepRecent = Math.max(4, Math.floor(nonSystem.length * 0.4));
    const toSummarize = nonSystem.slice(0, nonSystem.length - keepRecent);
    const toKeep = nonSystem.slice(nonSystem.length - keepRecent);

    const summarized = toSummarize.map(summarizeMessage);
    const result = [...systemMessages, ...summarized, ...toKeep];

    log.info(`[Compaction] summarize-oldest summarized ${toSummarize.length} messages`);
    return { messages: result, compacted: true, removedCount: 0 };
  }

  if (strategy === 'keep-system') {
    const keepRecent = Math.max(2, Math.floor(nonSystem.length * 0.6));
    const result = [...systemMessages, ...nonSystem.slice(nonSystem.length - keepRecent)];
    const removed = nonSystem.length - keepRecent;
    log.info(`[Compaction] keep-system removed ${removed} oldest non-system messages`);
    return { messages: result, compacted: true, removedCount: removed };
  }

  return { messages, compacted: false, removedCount: 0 };
}

let initialized = false;

export function initAgentCompaction(): void {
  if (initialized) return;
  initialized = true;
  log.info('[OpenClaw:Compaction] Agent compaction initialized');
}

export function getCompactionStatus(): { initialized: boolean; defaultMaxTokens: number } {
  return { initialized, defaultMaxTokens: DEFAULT_MAX_TOKENS };
}
