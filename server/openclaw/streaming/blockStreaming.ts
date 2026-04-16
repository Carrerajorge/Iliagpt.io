export interface BlockStreamConfig {
  minChars: number;
  maxChars: number;
  onBlock: (text: string, index: number) => void;
}

export class BlockStreamAccumulator {
  private buffer = '';
  private blockIndex = 0;
  private config: BlockStreamConfig;

  constructor(config: BlockStreamConfig) {
    this.config = config;
  }

  push(text: string): void {
    this.buffer += text;
    this.tryEmit();
  }

  end(): void {
    if (this.buffer.length > 0) {
      this.config.onBlock(this.buffer, this.blockIndex++);
      this.buffer = '';
    }
  }

  private tryEmit(): void {
    while (this.buffer.length >= this.config.minChars) {
      const breakPoint = this.findBreakPoint();
      if (breakPoint <= 0) break;

      const block = this.buffer.slice(0, breakPoint);
      this.buffer = this.buffer.slice(breakPoint);
      this.config.onBlock(block, this.blockIndex++);
    }

    // Force emit if over max
    if (this.buffer.length >= this.config.maxChars) {
      const block = this.buffer.slice(0, this.config.maxChars);
      this.buffer = this.buffer.slice(this.config.maxChars);
      this.config.onBlock(block, this.blockIndex++);
    }
  }

  private findBreakPoint(): number {
    // Prefer sentence boundaries
    const sentenceBreaks = ['. ', '! ', '? ', '.\n', '!\n', '?\n'];
    let bestBreak = -1;

    for (const sep of sentenceBreaks) {
      const idx = this.buffer.indexOf(sep, this.config.minChars - sep.length);
      if (idx >= 0 && idx + sep.length <= this.config.maxChars) {
        bestBreak = Math.max(bestBreak, idx + sep.length);
      }
    }

    if (bestBreak > 0) return bestBreak;

    // Fall back to newline boundaries
    const newlineIdx = this.buffer.indexOf('\n', this.config.minChars);
    if (newlineIdx >= 0 && newlineIdx < this.config.maxChars) {
      return newlineIdx + 1;
    }

    // Fall back to word boundaries
    if (this.buffer.length >= this.config.maxChars) {
      const spaceIdx = this.buffer.lastIndexOf(' ', this.config.maxChars);
      if (spaceIdx > this.config.minChars) return spaceIdx + 1;
      return this.config.maxChars;
    }

    return -1; // Not enough text yet
  }

  get bufferedLength(): number {
    return this.buffer.length;
  }
}
