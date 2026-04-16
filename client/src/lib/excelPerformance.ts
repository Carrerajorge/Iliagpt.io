export interface PositionCache {
  columnPositions: number[];
  rowPositions: number[];
  totalWidth: number;
  totalHeight: number;
}

export interface VisibleRange {
  startRow: number;
  endRow: number;
  startCol: number;
  endCol: number;
}

const DEFAULT_ROW_HEIGHT = 28;
const DEFAULT_COL_WIDTH = 100;

export function buildPositionCache(
  maxRows: number,
  maxCols: number,
  columnWidths: { [col: number]: number } = {},
  rowHeights: { [row: number]: number } = {}
): PositionCache {
  const columnPositions: number[] = new Array(maxCols + 1);
  const rowPositions: number[] = new Array(maxRows + 1);
  
  columnPositions[0] = 0;
  for (let c = 0; c < maxCols; c++) {
    const width = columnWidths[c] ?? DEFAULT_COL_WIDTH;
    columnPositions[c + 1] = columnPositions[c] + width;
  }
  
  rowPositions[0] = 0;
  for (let r = 0; r < maxRows; r++) {
    const height = rowHeights[r] ?? DEFAULT_ROW_HEIGHT;
    rowPositions[r + 1] = rowPositions[r] + height;
  }
  
  return {
    columnPositions,
    rowPositions,
    totalWidth: columnPositions[maxCols],
    totalHeight: rowPositions[maxRows],
  };
}

export function binarySearchPosition(positions: number[], scrollPos: number): number {
  let left = 0;
  let right = positions.length - 2;
  
  while (left <= right) {
    const mid = Math.floor((left + right) / 2);
    
    if (positions[mid] <= scrollPos && scrollPos < positions[mid + 1]) {
      return mid;
    } else if (positions[mid] > scrollPos) {
      right = mid - 1;
    } else {
      left = mid + 1;
    }
  }
  
  return Math.max(0, Math.min(left, positions.length - 2));
}

export function getVisibleRange(
  cache: PositionCache,
  scrollTop: number,
  scrollLeft: number,
  viewportWidth: number,
  viewportHeight: number,
  bufferRows: number = 5,
  bufferCols: number = 3
): VisibleRange {
  const startRow = Math.max(0, binarySearchPosition(cache.rowPositions, scrollTop) - bufferRows);
  const startCol = Math.max(0, binarySearchPosition(cache.columnPositions, scrollLeft) - bufferCols);
  
  const endRow = Math.min(
    cache.rowPositions.length - 1,
    binarySearchPosition(cache.rowPositions, scrollTop + viewportHeight) + bufferRows + 1
  );
  const endCol = Math.min(
    cache.columnPositions.length - 1,
    binarySearchPosition(cache.columnPositions, scrollLeft + viewportWidth) + bufferCols + 1
  );
  
  return { startRow, endRow, startCol, endCol };
}

export function getColumnLeft(cache: PositionCache, col: number): number {
  return cache.columnPositions[col] || 0;
}

export function getRowTop(cache: PositionCache, row: number): number {
  return cache.rowPositions[row] || 0;
}

export function getColumnWidth(
  col: number,
  columnWidths: { [col: number]: number } = {}
): number {
  return columnWidths[col] ?? DEFAULT_COL_WIDTH;
}

export function getRowHeight(
  row: number,
  rowHeights: { [row: number]: number } = {}
): number {
  return rowHeights[row] ?? DEFAULT_ROW_HEIGHT;
}

export class ScrollThrottler {
  private lastScrollTime: number = 0;
  private rafId: number | null = null;
  private pendingCallback: (() => void) | null = null;
  private readonly minInterval: number;
  
  constructor(minIntervalMs: number = 16) {
    this.minInterval = minIntervalMs;
  }
  
  throttle(callback: () => void): void {
    const now = performance.now();
    
    if (this.rafId !== null) {
      cancelAnimationFrame(this.rafId);
    }
    
    if (now - this.lastScrollTime >= this.minInterval) {
      this.lastScrollTime = now;
      callback();
    } else {
      this.pendingCallback = callback;
      this.rafId = requestAnimationFrame(() => {
        this.lastScrollTime = performance.now();
        if (this.pendingCallback) {
          this.pendingCallback();
          this.pendingCallback = null;
        }
        this.rafId = null;
      });
    }
  }
  
  cancel(): void {
    if (this.rafId !== null) {
      cancelAnimationFrame(this.rafId);
      this.rafId = null;
    }
    this.pendingCallback = null;
  }
}

export class RenderScheduler {
  private pendingRender: number | null = null;
  private isRendering: boolean = false;
  private renderQueue: Array<() => void> = [];
  private readonly batchDelayMs: number;
  
  constructor(batchDelayMs: number = 16) {
    this.batchDelayMs = batchDelayMs;
  }
  
  scheduleRender(callback: () => void): void {
    this.renderQueue.push(callback);
    
    if (this.pendingRender === null && !this.isRendering) {
      this.pendingRender = requestAnimationFrame(() => {
        this.flushRenderQueue();
      });
    }
  }
  
  private flushRenderQueue(): void {
    this.isRendering = true;
    this.pendingRender = null;
    
    const queue = [...this.renderQueue];
    this.renderQueue = [];
    
    for (const callback of queue) {
      try {
        callback();
      } catch (e) {
        console.error('[RenderScheduler] Render error:', e);
      }
    }
    
    this.isRendering = false;
  }
  
  cancel(): void {
    if (this.pendingRender !== null) {
      cancelAnimationFrame(this.pendingRender);
      this.pendingRender = null;
    }
    this.renderQueue = [];
  }
}

export interface ChunkConfig {
  chunkSize: number;
  loadAhead: number;
}

export class ChunkLoader {
  private loadedChunks: Set<string> = new Set();
  private loadingChunks: Set<string> = new Set();
  private config: ChunkConfig;
  
  constructor(config: Partial<ChunkConfig> = {}) {
    this.config = {
      chunkSize: config.chunkSize ?? 100,
      loadAhead: config.loadAhead ?? 2,
    };
  }
  
  getChunkKey(row: number, col: number): string {
    const chunkRow = Math.floor(row / this.config.chunkSize);
    const chunkCol = Math.floor(col / this.config.chunkSize);
    return `${chunkRow}:${chunkCol}`;
  }
  
  getRequiredChunks(range: VisibleRange): string[] {
    const chunks: string[] = [];
    const { chunkSize, loadAhead } = this.config;
    
    const startChunkRow = Math.max(0, Math.floor(range.startRow / chunkSize) - loadAhead);
    const endChunkRow = Math.floor(range.endRow / chunkSize) + loadAhead;
    const startChunkCol = Math.max(0, Math.floor(range.startCol / chunkSize) - loadAhead);
    const endChunkCol = Math.floor(range.endCol / chunkSize) + loadAhead;
    
    for (let r = startChunkRow; r <= endChunkRow; r++) {
      for (let c = startChunkCol; c <= endChunkCol; c++) {
        chunks.push(`${r}:${c}`);
      }
    }
    
    return chunks;
  }
  
  isChunkLoaded(chunkKey: string): boolean {
    return this.loadedChunks.has(chunkKey);
  }
  
  markChunkLoaded(chunkKey: string): void {
    this.loadedChunks.add(chunkKey);
    this.loadingChunks.delete(chunkKey);
  }
  
  markChunkLoading(chunkKey: string): void {
    this.loadingChunks.add(chunkKey);
  }
  
  isChunkLoading(chunkKey: string): boolean {
    return this.loadingChunks.has(chunkKey);
  }
  
  getUnloadedChunks(requiredChunks: string[]): string[] {
    return requiredChunks.filter(
      chunk => !this.loadedChunks.has(chunk) && !this.loadingChunks.has(chunk)
    );
  }
  
  pruneDistantChunks(currentRange: VisibleRange, maxChunks: number = 50): string[] {
    if (this.loadedChunks.size <= maxChunks) return [];
    
    const currentChunks = new Set(this.getRequiredChunks(currentRange));
    const pruned: string[] = [];
    
    Array.from(this.loadedChunks).forEach(chunk => {
      if (!currentChunks.has(chunk) && this.loadedChunks.size - pruned.length > maxChunks / 2) {
        pruned.push(chunk);
      }
    });
    
    pruned.forEach(chunk => {
      this.loadedChunks.delete(chunk);
    });
    
    return pruned;
  }
  
  clear(): void {
    this.loadedChunks.clear();
    this.loadingChunks.clear();
  }
}

export function measureTextWidth(
  text: string,
  font: string = '13px -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif'
): number {
  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext('2d');
  if (!ctx) return text.length * 8;
  
  ctx.font = font;
  return ctx.measureText(text).width;
}

export function debounce<T extends (...args: any[]) => void>(
  func: T,
  waitMs: number
): (...args: Parameters<T>) => void {
  let timeoutId: ReturnType<typeof setTimeout> | null = null;
  
  return (...args: Parameters<T>) => {
    if (timeoutId !== null) {
      clearTimeout(timeoutId);
    }
    timeoutId = setTimeout(() => {
      func(...args);
      timeoutId = null;
    }, waitMs);
  };
}

export function throttle<T extends (...args: any[]) => void>(
  func: T,
  limitMs: number
): (...args: Parameters<T>) => void {
  let lastRun = 0;
  let timeoutId: ReturnType<typeof setTimeout> | null = null;
  
  return (...args: Parameters<T>) => {
    const now = Date.now();
    
    if (now - lastRun >= limitMs) {
      func(...args);
      lastRun = now;
    } else {
      if (timeoutId !== null) {
        clearTimeout(timeoutId);
      }
      timeoutId = setTimeout(() => {
        func(...args);
        lastRun = Date.now();
        timeoutId = null;
      }, limitMs - (now - lastRun));
    }
  };
}
