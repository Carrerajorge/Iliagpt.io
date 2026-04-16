import type { OpenClawConfig } from '../config';
import { BlockStreamAccumulator } from './blockStreaming';
import { PreviewStream } from './previewStreaming';
import { broadcastEvent } from '../gateway/wsServer';
import { Logger } from '../../lib/logger';

export function initStreaming(config: OpenClawConfig): void {
  Logger.info(
    `[OpenClaw:Streaming] Initialized: block(${config.streaming.blockMinChars}-${config.streaming.blockMaxChars}), preview(${config.streaming.previewMode})`,
  );
}

export function createStreamingPair(
  runId: string,
  config: OpenClawConfig,
): { block: BlockStreamAccumulator; preview: PreviewStream } {
  const preview = new PreviewStream(runId, config.streaming.previewMode);

  const block = new BlockStreamAccumulator({
    minChars: config.streaming.blockMinChars,
    maxChars: config.streaming.blockMaxChars,
    onBlock: (text, index) => {
      broadcastEvent('chat.delta', {
        runId,
        blockIndex: index,
        content: text,
        timestamp: Date.now(),
      });
    },
  });

  return { block, preview };
}
