import { GoogleGenAI } from "@google/genai";
import * as crypto from "crypto";
import { EventEmitter } from "events";

export interface LargeDocumentConfig {
  maxChunkTokens: number;
  overlapTokens: number;
  memoryLimitMB: number;
  memoryThresholdPercent: number;
  chunkTimeoutMs: number;
  maxConcurrentChunks: number;
  summaryMaxTokens: number;
  cacheEnabled: boolean;
  cacheTTLMs: number;
  maxInFlightPromises: number;
  promiseTimeoutMs: number;
}

export interface DocumentChunk {
  id: string;
  index: number;
  content: string;
  tokenCount: number;
  startOffset: number;
  endOffset: number;
  overlapStart: number;
  overlapEnd: number;
  priority: number;
}

export interface ChunkResult {
  chunkId: string;
  chunkIndex: number;
  processed: boolean;
  summary?: string;
  relevantInfo?: string[];
  error?: string;
  processingTimeMs: number;
  tokenCount: number;
}

export interface ProcessingProgress {
  totalChunks: number;
  processedChunks: number;
  currentChunkIndex: number;
  estimatedRemainingMs: number;
  memoryUsageMB: number;
  memoryPercent: number;
  isPaused: boolean;
  errors: string[];
}

export interface ChunkingResult {
  chunks: DocumentChunk[];
  totalTokens: number;
  totalChunks: number;
  documentHash: string;
}

interface CachedSummary {
  summary: string;
  relevantInfo: string[];
  timestamp: number;
  chunkHash: string;
}

interface PriorityQueueItem {
  chunk: DocumentChunk;
  priority: number;
  addedAt: number;
}

interface TrackedPromise {
  promise: Promise<ChunkResult>;
  chunkId: string;
  startTime: number;
  timeoutId: NodeJS.Timeout;
}

const DEFAULT_CONFIG: LargeDocumentConfig = {
  maxChunkTokens: 50000,
  overlapTokens: 500,
  memoryLimitMB: 512,
  memoryThresholdPercent: 80,
  chunkTimeoutMs: 30000,
  maxConcurrentChunks: 3,
  summaryMaxTokens: 1000,
  cacheEnabled: true,
  cacheTTLMs: 3600000,
  maxInFlightPromises: 5,
  promiseTimeoutMs: 60000,
};

const MAX_ALLOWED_TOKENS = 10000000;
const HARD_CHUNK_TOKEN_LIMIT = 50000;

export function estimateTokens(text: string): number {
  if (!text) return 0;
  return Math.ceil(text.length / 4);
}

export function estimateTokensAccurate(text: string): number {
  if (!text) return 0;
  const words = text.split(/\s+/).filter(Boolean);
  const wordTokens = words.length * 1.3;
  const punctuationTokens = (text.match(/[^\w\s]/g) || []).length * 0.5;
  return Math.ceil(wordTokens + punctuationTokens);
}

function generateChunkId(content: string, index: number): string {
  const hash = crypto.createHash("sha256").update(content).digest("hex").slice(0, 12);
  return `chunk_${index}_${hash}`;
}

function generateDocumentHash(content: string): string {
  return crypto.createHash("sha256").update(content).digest("hex");
}

function findSentenceBoundary(text: string, targetIndex: number, searchRadius: number): number {
  const searchStart = Math.max(0, targetIndex - searchRadius);
  const searchEnd = Math.min(text.length, targetIndex + searchRadius);
  const searchWindow = text.slice(searchStart, searchEnd);
  
  const sentenceEnders = ['.', '!', '?', '。', '！', '？'];
  let bestBoundary = targetIndex;
  let closestDistance = searchRadius;
  
  for (let i = 0; i < searchWindow.length; i++) {
    const char = searchWindow[i];
    const nextChar = searchWindow[i + 1] || '';
    
    if (sentenceEnders.includes(char) && /\s/.test(nextChar)) {
      const absolutePosition = searchStart + i + 1;
      const distance = Math.abs(absolutePosition - targetIndex);
      
      if (distance < closestDistance) {
        closestDistance = distance;
        bestBoundary = absolutePosition;
      }
    }
  }
  
  if (bestBoundary === targetIndex) {
    for (let i = 0; i < searchWindow.length; i++) {
      if (searchWindow[i] === '\n') {
        const absolutePosition = searchStart + i + 1;
        const distance = Math.abs(absolutePosition - targetIndex);
        
        if (distance < closestDistance) {
          closestDistance = distance;
          bestBoundary = absolutePosition;
        }
      }
    }
  }
  
  if (bestBoundary === targetIndex) {
    for (let i = 0; i < searchWindow.length; i++) {
      if (/\s/.test(searchWindow[i])) {
        const absolutePosition = searchStart + i + 1;
        const distance = Math.abs(absolutePosition - targetIndex);
        
        if (distance < closestDistance) {
          closestDistance = distance;
          bestBoundary = absolutePosition;
        }
      }
    }
  }
  
  return bestBoundary;
}

function subdivideChunk(chunk: DocumentChunk, maxTokens: number): DocumentChunk[] {
  const tokenCount = estimateTokens(chunk.content);
  
  if (tokenCount <= maxTokens) {
    return [chunk];
  }
  
  const subChunks: DocumentChunk[] = [];
  const charsPerToken = 4;
  const maxChars = maxTokens * charsPerToken;
  const searchRadius = Math.min(500, maxChars * 0.1);
  
  let currentPos = 0;
  let subIndex = 0;
  
  while (currentPos < chunk.content.length) {
    const targetEnd = Math.min(currentPos + maxChars, chunk.content.length);
    
    let actualEnd: number;
    if (targetEnd >= chunk.content.length) {
      actualEnd = chunk.content.length;
    } else {
      actualEnd = findSentenceBoundary(chunk.content, targetEnd, searchRadius);
    }
    
    const subContent = chunk.content.slice(currentPos, actualEnd);
    const subTokenCount = estimateTokens(subContent);
    
    subChunks.push({
      id: `${chunk.id}_sub${subIndex}`,
      index: chunk.index * 1000 + subIndex,
      content: subContent,
      tokenCount: subTokenCount,
      startOffset: chunk.startOffset + currentPos,
      endOffset: chunk.startOffset + actualEnd,
      overlapStart: chunk.overlapStart,
      overlapEnd: chunk.overlapEnd,
      priority: chunk.priority,
    });
    
    currentPos = actualEnd;
    subIndex++;
    
    if (subChunks.length > 100) {
      console.warn("[LargeDocumentProcessor] Subdivision limit reached");
      break;
    }
  }
  
  return subChunks;
}

export function chunkDocument(
  content: string,
  config: Partial<LargeDocumentConfig> = {}
): ChunkingResult {
  const cfg = { ...DEFAULT_CONFIG, ...config };
  const totalTokens = estimateTokens(content);
  const documentHash = generateDocumentHash(content);
  
  if (totalTokens <= cfg.maxChunkTokens) {
    const chunk: DocumentChunk = {
      id: generateChunkId(content, 0),
      index: 0,
      content,
      tokenCount: totalTokens,
      startOffset: 0,
      endOffset: content.length,
      overlapStart: 0,
      overlapEnd: 0,
      priority: 1,
    };
    
    return {
      chunks: [chunk],
      totalTokens,
      totalChunks: 1,
      documentHash,
    };
  }
  
  const chunks: DocumentChunk[] = [];
  const charsPerToken = 4;
  const maxChunkChars = cfg.maxChunkTokens * charsPerToken;
  const overlapChars = cfg.overlapTokens * charsPerToken;
  const searchRadius = Math.min(1000, maxChunkChars * 0.1);
  
  let currentPosition = 0;
  let chunkIndex = 0;
  
  while (currentPosition < content.length) {
    const targetEndPosition = Math.min(currentPosition + maxChunkChars, content.length);
    
    let actualEndPosition: number;
    if (targetEndPosition >= content.length) {
      actualEndPosition = content.length;
    } else {
      actualEndPosition = findSentenceBoundary(content, targetEndPosition, searchRadius);
    }
    
    const chunkContent = content.slice(currentPosition, actualEndPosition);
    const tokenCount = estimateTokens(chunkContent);
    
    const overlapStart = chunkIndex > 0 ? currentPosition : 0;
    const overlapEnd = actualEndPosition < content.length 
      ? Math.min(actualEndPosition + overlapChars, content.length)
      : actualEndPosition;
    
    const chunk: DocumentChunk = {
      id: generateChunkId(chunkContent, chunkIndex),
      index: chunkIndex,
      content: chunkContent,
      tokenCount,
      startOffset: currentPosition,
      endOffset: actualEndPosition,
      overlapStart,
      overlapEnd,
      priority: calculateChunkPriority(chunkContent, chunkIndex, tokenCount),
    };
    
    chunks.push(chunk);
    
    const nextPosition = actualEndPosition - overlapChars;
    currentPosition = nextPosition > currentPosition ? nextPosition : actualEndPosition;
    chunkIndex++;
    
    if (chunks.length > 10000) {
      console.warn("[LargeDocumentProcessor] Excessive chunk count, breaking to prevent infinite loop");
      break;
    }
  }
  
  return {
    chunks,
    totalTokens,
    totalChunks: chunks.length,
    documentHash,
  };
}

function calculateChunkPriority(content: string, index: number, tokenCount: number): number {
  let priority = 1.0;
  
  if (index === 0) priority += 0.5;
  
  const hasHeadings = /^#+\s|^[A-Z][A-Z\s]+$/m.test(content);
  if (hasHeadings) priority += 0.3;
  
  const hasKeywords = /important|critical|summary|conclusion|abstract|introduction/i.test(content);
  if (hasKeywords) priority += 0.2;
  
  const densityFactor = Math.min(tokenCount / 10000, 1.0) * 0.2;
  priority += densityFactor;
  
  return Math.min(priority, 2.0);
}

function getMemoryUsage(): { usedMB: number; percent: number; heapLimit: number } {
  const usage = process.memoryUsage();
  const usedMB = usage.heapUsed / (1024 * 1024);
  const totalMB = usage.heapTotal / (1024 * 1024);
  const percent = (usedMB / totalMB) * 100;
  
  return { usedMB, percent, heapLimit: totalMB };
}

class Semaphore {
  private permits: number;
  private waitQueue: Array<() => void> = [];
  
  constructor(permits: number) {
    this.permits = permits;
  }
  
  async acquire(): Promise<void> {
    if (this.permits > 0) {
      this.permits--;
      return;
    }
    
    return new Promise<void>((resolve) => {
      this.waitQueue.push(resolve);
    });
  }
  
  release(): void {
    this.permits++;
    const next = this.waitQueue.shift();
    if (next) {
      this.permits--;
      setImmediate(next);
    }
  }
  
  available(): number {
    return this.permits;
  }
  
  waiting(): number {
    return this.waitQueue.length;
  }
  
  drain(): void {
    while (this.waitQueue.length > 0) {
      const next = this.waitQueue.shift();
      if (next) {
        setImmediate(next);
      }
    }
  }
}

class AsyncPriorityQueue extends EventEmitter {
  private items: PriorityQueueItem[] = [];
  private drainResolvers: Array<() => void> = [];
  
  enqueue(chunk: DocumentChunk, priority: number): void {
    const item: PriorityQueueItem = {
      chunk,
      priority,
      addedAt: Date.now(),
    };
    
    let inserted = false;
    for (let i = 0; i < this.items.length; i++) {
      if (priority > this.items[i].priority) {
        this.items.splice(i, 0, item);
        inserted = true;
        break;
      }
    }
    
    if (!inserted) {
      this.items.push(item);
    }
    
    this.emit('enqueue', chunk);
  }
  
  async dequeue(): Promise<DocumentChunk | undefined> {
    await new Promise<void>(resolve => setImmediate(resolve));
    
    const item = this.items.shift();
    
    if (this.items.length === 0) {
      this.emit('drain');
      for (const resolver of this.drainResolvers) {
        resolver();
      }
      this.drainResolvers = [];
    }
    
    return item?.chunk;
  }
  
  peek(): DocumentChunk | undefined {
    return this.items[0]?.chunk;
  }
  
  isEmpty(): boolean {
    return this.items.length === 0;
  }
  
  size(): number {
    return this.items.length;
  }
  
  clear(): void {
    this.items = [];
    this.emit('drain');
    for (const resolver of this.drainResolvers) {
      resolver();
    }
    this.drainResolvers = [];
  }
  
  async waitForDrain(): Promise<void> {
    if (this.isEmpty()) return;
    return new Promise<void>(resolve => {
      this.drainResolvers.push(resolve);
    });
  }
}

class ConcurrencyController {
  private semaphore: Semaphore;
  private inFlightPromises: Map<string, TrackedPromise> = new Map();
  private maxInFlight: number;
  private promiseTimeout: number;
  private destroyed: boolean = false;
  
  constructor(maxConcurrent: number, maxInFlight: number, promiseTimeoutMs: number) {
    this.semaphore = new Semaphore(maxConcurrent);
    this.maxInFlight = maxInFlight;
    this.promiseTimeout = promiseTimeoutMs;
  }
  
  async acquire(): Promise<boolean> {
    if (this.destroyed) return false;
    
    while (this.inFlightPromises.size >= this.maxInFlight) {
      if (this.destroyed) return false;
      await new Promise<void>(resolve => setTimeout(resolve, 100));
      this.cleanupCompleted();
    }
    
    await this.semaphore.acquire();
    return !this.destroyed;
  }
  
  track(chunkId: string, promise: Promise<ChunkResult>): void {
    const timeoutId = setTimeout(() => {
      this.timeout(chunkId);
    }, this.promiseTimeout);
    
    this.inFlightPromises.set(chunkId, {
      promise,
      chunkId,
      startTime: Date.now(),
      timeoutId,
    });
    
    promise.finally(() => {
      this.complete(chunkId);
    });
  }
  
  private complete(chunkId: string): void {
    const tracked = this.inFlightPromises.get(chunkId);
    if (tracked) {
      clearTimeout(tracked.timeoutId);
      this.inFlightPromises.delete(chunkId);
    }
    this.semaphore.release();
  }
  
  private timeout(chunkId: string): void {
    console.warn(`[ConcurrencyController] Promise timeout for chunk ${chunkId}`);
    this.inFlightPromises.delete(chunkId);
    this.semaphore.release();
  }
  
  private cleanupCompleted(): void {
    const now = Date.now();
    const entries = Array.from(this.inFlightPromises.entries());
    for (const [id, tracked] of entries) {
      if (now - tracked.startTime > this.promiseTimeout) {
        console.warn(`[ConcurrencyController] Cleaning up stale promise ${id}`);
        clearTimeout(tracked.timeoutId);
        this.inFlightPromises.delete(id);
        this.semaphore.release();
      }
    }
  }
  
  getInflightCount(): number {
    return this.inFlightPromises.size;
  }
  
  async drain(): Promise<void> {
    const promises = Array.from(this.inFlightPromises.values()).map(t => t.promise);
    await Promise.allSettled(promises);
  }
  
  destroy(): void {
    this.destroyed = true;
    
    const entries = Array.from(this.inFlightPromises.entries());
    for (const [id, tracked] of entries) {
      clearTimeout(tracked.timeoutId);
      this.inFlightPromises.delete(id);
    }
    
    this.semaphore.drain();
  }
}

class BackpressureMonitor extends EventEmitter {
  private threshold: number;
  private isPaused: boolean = false;
  private checkInterval: NodeJS.Timeout | null = null;
  private drainResolvers: Array<() => void> = [];
  
  constructor(thresholdPercent: number) {
    super();
    this.threshold = thresholdPercent;
  }
  
  start(intervalMs: number = 1000): void {
    this.checkInterval = setInterval(() => {
      this.check();
    }, intervalMs);
  }
  
  stop(): void {
    if (this.checkInterval) {
      clearInterval(this.checkInterval);
      this.checkInterval = null;
    }
    this.drainResolvers.forEach(r => r());
    this.drainResolvers = [];
  }
  
  check(): boolean {
    const memory = getMemoryUsage();
    const shouldPause = memory.percent > this.threshold;
    
    if (shouldPause && !this.isPaused) {
      this.isPaused = true;
      this.emit('pause', memory);
    } else if (!shouldPause && this.isPaused) {
      this.isPaused = false;
      this.emit('resume', memory);
      for (const resolver of this.drainResolvers) {
        resolver();
      }
      this.drainResolvers = [];
    }
    
    return this.isPaused;
  }
  
  async waitForDrain(): Promise<void> {
    if (!this.isPaused) return;
    
    return new Promise<void>((resolve) => {
      this.drainResolvers.push(resolve);
    });
  }
  
  paused(): boolean {
    return this.isPaused;
  }
  
  forceGC(): void {
    if (typeof global.gc === "function") {
      global.gc();
    }
  }
}

export class LargeDocumentProcessor {
  private config: LargeDocumentConfig;
  private genai: GoogleGenAI;
  private summaryCache: Map<string, CachedSummary> = new Map();
  private processingQueue: AsyncPriorityQueue = new AsyncPriorityQueue();
  private concurrencyController: ConcurrencyController;
  private backpressureMonitor: BackpressureMonitor;
  private isPaused: boolean = false;
  private isDestroyed: boolean = false;
  private cacheCleanupInterval: NodeJS.Timeout | null = null;
  private processingStats = {
    totalProcessed: 0,
    totalErrors: 0,
    totalTimeMs: 0,
    cacheHits: 0,
    backpressurePauses: 0,
    subdivisions: 0,
  };

  constructor(config?: Partial<LargeDocumentConfig>) {
    this.config = { ...DEFAULT_CONFIG, ...config };
    
    const apiKey = process.env.GEMINI_API_KEY || process.env.GOOGLE_GENERATIVE_AI_API_KEY || "";
    if (!apiKey) {
      console.warn("[LargeDocumentProcessor] No Gemini API key found");
    }
    
    this.genai = new GoogleGenAI({ apiKey });
    
    this.concurrencyController = new ConcurrencyController(
      this.config.maxConcurrentChunks,
      this.config.maxInFlightPromises,
      this.config.promiseTimeoutMs
    );
    
    this.backpressureMonitor = new BackpressureMonitor(this.config.memoryThresholdPercent);
    
    this.backpressureMonitor.on('pause', (memory) => {
      this.isPaused = true;
      this.processingStats.backpressurePauses++;
      console.warn(`[LargeDocumentProcessor] Backpressure pause - Memory: ${memory.usedMB.toFixed(1)}MB (${memory.percent.toFixed(1)}%)`);
    });
    
    this.backpressureMonitor.on('resume', (memory) => {
      this.isPaused = false;
      console.log(`[LargeDocumentProcessor] Backpressure resume - Memory: ${memory.usedMB.toFixed(1)}MB (${memory.percent.toFixed(1)}%)`);
    });
    
    this.cacheCleanupInterval = setInterval(() => this.cleanupCache(), 300000);
  }

  validateDocument(content: string): { valid: boolean; reason?: string; tokenCount: number } {
    const tokenCount = estimateTokens(content);
    
    if (!content || content.trim().length === 0) {
      return { valid: false, reason: "Document is empty", tokenCount: 0 };
    }
    
    if (tokenCount > MAX_ALLOWED_TOKENS) {
      return { 
        valid: false, 
        reason: `Document exceeds maximum allowed tokens (${tokenCount} > ${MAX_ALLOWED_TOKENS})`,
        tokenCount 
      };
    }
    
    return { valid: true, tokenCount };
  }

  validateChunk(chunk: DocumentChunk): { valid: boolean; needsSubdivision: boolean; reason?: string } {
    if (chunk.tokenCount > HARD_CHUNK_TOKEN_LIMIT) {
      return {
        valid: true,
        needsSubdivision: true,
        reason: `Chunk exceeds ${HARD_CHUNK_TOKEN_LIMIT} tokens, will be subdivided`
      };
    }
    
    if (!chunk.content || chunk.content.trim().length === 0) {
      return { valid: false, needsSubdivision: false, reason: "Empty chunk content" };
    }
    
    return { valid: true, needsSubdivision: false };
  }

  async *processLargeDocument(
    content: string,
    options: {
      onProgress?: (progress: ProcessingProgress) => void;
      signal?: AbortSignal;
      summarize?: boolean;
    } = {}
  ): AsyncGenerator<ChunkResult, void, unknown> {
    if (this.isDestroyed) {
      yield {
        chunkId: "destroyed",
        chunkIndex: -1,
        processed: false,
        error: "Processor has been destroyed",
        processingTimeMs: 0,
        tokenCount: 0,
      };
      return;
    }
    
    const { onProgress, signal, summarize = true } = options;
    
    this.backpressureMonitor.start(500);
    
    try {
      const validation = this.validateDocument(content);
      if (!validation.valid) {
        yield {
          chunkId: "validation_error",
          chunkIndex: -1,
          processed: false,
          error: validation.reason,
          processingTimeMs: 0,
          tokenCount: validation.tokenCount,
        };
        return;
      }
      
      const chunkingResult = chunkDocument(content, this.config);
      const { chunks } = chunkingResult;
      
      let effectiveChunks: DocumentChunk[] = [];
      for (const chunk of chunks) {
        const chunkValidation = this.validateChunk(chunk);
        
        if (!chunkValidation.valid) {
          yield {
            chunkId: chunk.id,
            chunkIndex: chunk.index,
            processed: false,
            error: chunkValidation.reason,
            processingTimeMs: 0,
            tokenCount: chunk.tokenCount,
          };
          continue;
        }
        
        if (chunkValidation.needsSubdivision) {
          const subChunks = subdivideChunk(chunk, HARD_CHUNK_TOKEN_LIMIT);
          this.processingStats.subdivisions += subChunks.length - 1;
          effectiveChunks.push(...subChunks);
        } else {
          effectiveChunks.push(chunk);
        }
      }
      
      for (const chunk of effectiveChunks) {
        this.processingQueue.enqueue(chunk, chunk.priority);
      }
      
      const effectiveTotalChunks = effectiveChunks.length;
      const errors: string[] = [];
      let processedCount = 0;
      const startTime = Date.now();
      const avgProcessingTimes: number[] = [];
      
      while (!this.processingQueue.isEmpty()) {
        if (this.isDestroyed) {
          yield {
            chunkId: "destroyed",
            chunkIndex: -1,
            processed: false,
            error: "Processor was destroyed during processing",
            processingTimeMs: Date.now() - startTime,
            tokenCount: 0,
          };
          break;
        }
        
        if (signal?.aborted) {
          yield {
            chunkId: "aborted",
            chunkIndex: -1,
            processed: false,
            error: "Processing aborted by user",
            processingTimeMs: Date.now() - startTime,
            tokenCount: 0,
          };
          break;
        }
        
        if (this.backpressureMonitor.paused()) {
          const memory = getMemoryUsage();
          if (onProgress) {
            onProgress({
              totalChunks: effectiveTotalChunks,
              processedChunks: processedCount,
              currentChunkIndex: -1,
              estimatedRemainingMs: 0,
              memoryUsageMB: memory.usedMB,
              memoryPercent: memory.percent,
              isPaused: true,
              errors,
            });
          }
          
          this.backpressureMonitor.forceGC();
          await this.backpressureMonitor.waitForDrain();
          continue;
        }
        
        const canAcquire = await this.concurrencyController.acquire();
        if (!canAcquire) {
          break;
        }
        
        const chunk = await this.processingQueue.dequeue();
        if (!chunk) {
          break;
        }
        
        const chunkStartTime = Date.now();
        
        try {
          const processPromise = this.processChunkWithTimeout(chunk, summarize);
          this.concurrencyController.track(chunk.id, processPromise);
          
          const result = await processPromise;
          const processingTime = Date.now() - chunkStartTime;
          avgProcessingTimes.push(processingTime);
          
          if (avgProcessingTimes.length > 20) {
            avgProcessingTimes.shift();
          }
          
          processedCount++;
          this.processingStats.totalProcessed++;
          this.processingStats.totalTimeMs += processingTime;
          
          const memory = getMemoryUsage();
          if (onProgress) {
            const avgTime = avgProcessingTimes.reduce((a, b) => a + b, 0) / avgProcessingTimes.length;
            const remainingChunks = effectiveTotalChunks - processedCount;
            
            onProgress({
              totalChunks: effectiveTotalChunks,
              processedChunks: processedCount,
              currentChunkIndex: chunk.index,
              estimatedRemainingMs: remainingChunks * avgTime,
              memoryUsageMB: memory.usedMB,
              memoryPercent: memory.percent,
              isPaused: false,
              errors,
            });
          }
          
          yield result;
          
          await new Promise<void>(resolve => setImmediate(resolve));
          
        } catch (error: any) {
          const errorMessage = error.message || "Unknown error";
          errors.push(`Chunk ${chunk.index}: ${errorMessage}`);
          this.processingStats.totalErrors++;
          
          yield {
            chunkId: chunk.id,
            chunkIndex: chunk.index,
            processed: false,
            error: errorMessage,
            processingTimeMs: Date.now() - chunkStartTime,
            tokenCount: chunk.tokenCount,
          };
          
          await new Promise<void>(resolve => setImmediate(resolve));
        }
      }
      
    } finally {
      this.backpressureMonitor.stop();
    }
  }

  private async processChunkWithTimeout(
    chunk: DocumentChunk,
    summarize: boolean
  ): Promise<ChunkResult> {
    const startTime = Date.now();
    
    if (chunk.tokenCount > HARD_CHUNK_TOKEN_LIMIT) {
      return {
        chunkId: chunk.id,
        chunkIndex: chunk.index,
        processed: false,
        error: `Chunk exceeds hard token limit of ${HARD_CHUNK_TOKEN_LIMIT}`,
        processingTimeMs: Date.now() - startTime,
        tokenCount: chunk.tokenCount,
      };
    }
    
    if (this.config.cacheEnabled) {
      const cached = this.getCachedSummary(chunk.id);
      if (cached) {
        this.processingStats.cacheHits++;
        return {
          chunkId: chunk.id,
          chunkIndex: chunk.index,
          processed: true,
          summary: cached.summary,
          relevantInfo: cached.relevantInfo,
          processingTimeMs: Date.now() - startTime,
          tokenCount: chunk.tokenCount,
        };
      }
    }
    
    return new Promise<ChunkResult>((resolve, reject) => {
      const timeoutId = setTimeout(() => {
        resolve(this.fallbackProcessChunk(chunk, startTime));
      }, this.config.chunkTimeoutMs);
      
      this.processChunk(chunk, summarize)
        .then(result => {
          clearTimeout(timeoutId);
          resolve(result);
        })
        .catch(error => {
          clearTimeout(timeoutId);
          if (error.message === "Chunk processing timeout") {
            resolve(this.fallbackProcessChunk(chunk, startTime));
          } else {
            reject(error);
          }
        });
    });
  }

  private async processChunk(chunk: DocumentChunk, summarize: boolean): Promise<ChunkResult> {
    const startTime = Date.now();
    
    if (!summarize) {
      return {
        chunkId: chunk.id,
        chunkIndex: chunk.index,
        processed: true,
        processingTimeMs: Date.now() - startTime,
        tokenCount: chunk.tokenCount,
      };
    }
    
    try {
      const prompt = `Analyze the following text chunk and provide:
1. A concise summary (max 200 words)
2. Key information points as a JSON array

Respond in JSON format:
{
  "summary": "...",
  "relevantInfo": ["point1", "point2", ...]
}

Text:
${chunk.content.slice(0, 100000)}`;

      const result = await this.genai.models.generateContent({
        model: "gemini-2.0-flash",
        contents: [{ role: "user", parts: [{ text: prompt }] }],
        config: {
          maxOutputTokens: this.config.summaryMaxTokens,
          temperature: 0.3,
        },
      });

      const responseText = result.text ?? "";
      const parsed = this.parseChunkResponse(responseText);
      
      if (this.config.cacheEnabled) {
        this.cacheSummary(chunk.id, parsed.summary, parsed.relevantInfo);
      }
      
      return {
        chunkId: chunk.id,
        chunkIndex: chunk.index,
        processed: true,
        summary: parsed.summary,
        relevantInfo: parsed.relevantInfo,
        processingTimeMs: Date.now() - startTime,
        tokenCount: chunk.tokenCount,
      };
    } catch (error: any) {
      console.error(`[LargeDocumentProcessor] Error processing chunk ${chunk.index}:`, error.message);
      throw error;
    }
  }

  private fallbackProcessChunk(chunk: DocumentChunk, startTime: number): ChunkResult {
    const sentences = chunk.content.split(/[.!?。！？]+/).filter(Boolean);
    const firstSentences = sentences.slice(0, 3).join(". ").trim();
    const fallbackSummary = firstSentences.length > 0 
      ? firstSentences + "..." 
      : chunk.content.slice(0, 200) + "...";
    
    return {
      chunkId: chunk.id,
      chunkIndex: chunk.index,
      processed: true,
      summary: `[Fallback] ${fallbackSummary}`,
      relevantInfo: [`Chunk ${chunk.index + 1}: ${chunk.tokenCount} tokens`],
      processingTimeMs: Date.now() - startTime,
      tokenCount: chunk.tokenCount,
    };
  }

  private parseChunkResponse(responseText: string): { summary: string; relevantInfo: string[] } {
    const cleaned = responseText
      .replace(/```json\s*/gi, "")
      .replace(/```\s*/g, "")
      .trim();

    try {
      const parsed = JSON.parse(cleaned);
      return {
        summary: typeof parsed.summary === "string" ? parsed.summary : "",
        relevantInfo: Array.isArray(parsed.relevantInfo)
          ? parsed.relevantInfo.filter((item: unknown) => typeof item === "string")
          : [],
      };
    } catch {
      return {
        summary: cleaned.slice(0, 500),
        relevantInfo: [],
      };
    }
  }

  private getCachedSummary(chunkId: string): CachedSummary | undefined {
    const cached = this.summaryCache.get(chunkId);
    if (cached && Date.now() - cached.timestamp < this.config.cacheTTLMs) {
      return cached;
    }
    if (cached) {
      this.summaryCache.delete(chunkId);
    }
    return undefined;
  }

  private cacheSummary(chunkId: string, summary: string, relevantInfo: string[]): void {
    const chunkHash = crypto.createHash("sha256").update(summary).digest("hex").slice(0, 16);
    
    this.summaryCache.set(chunkId, {
      summary,
      relevantInfo,
      timestamp: Date.now(),
      chunkHash,
    });
    
    if (this.summaryCache.size > 1000) {
      this.cleanupCache();
    }
  }

  private cleanupCache(): void {
    const now = Date.now();
    const entries = Array.from(this.summaryCache.entries());
    
    for (const [key, value] of entries) {
      if (now - value.timestamp > this.config.cacheTTLMs) {
        this.summaryCache.delete(key);
      }
    }
    
    if (this.summaryCache.size > 500) {
      const sorted = entries
        .filter(([key]) => this.summaryCache.has(key))
        .sort((a, b) => a[1].timestamp - b[1].timestamp);
      
      const toRemove = sorted.slice(0, sorted.length - 500);
      for (const [key] of toRemove) {
        this.summaryCache.delete(key);
      }
    }
  }

  abort(): void {
    this.processingQueue.clear();
    this.isPaused = false;
  }

  destroy(): void {
    this.isDestroyed = true;
    
    if (this.cacheCleanupInterval) {
      clearInterval(this.cacheCleanupInterval);
      this.cacheCleanupInterval = null;
    }
    
    this.backpressureMonitor.stop();
    this.concurrencyController.destroy();
    this.processingQueue.clear();
    this.summaryCache.clear();
    
    this.isPaused = false;
  }

  getStats() {
    return {
      ...this.processingStats,
      cacheSize: this.summaryCache.size,
      queueSize: this.processingQueue.size(),
      isPaused: this.isPaused,
      isDestroyed: this.isDestroyed,
      inFlightPromises: this.concurrencyController.getInflightCount(),
    };
  }

  clearCache(): void {
    this.summaryCache.clear();
  }
}

export async function processLargeDocument(
  content: string,
  options: {
    config?: Partial<LargeDocumentConfig>;
    onProgress?: (progress: ProcessingProgress) => void;
    onChunk?: (result: ChunkResult) => void;
    signal?: AbortSignal;
    summarize?: boolean;
  } = {}
): Promise<{
  results: ChunkResult[];
  totalChunks: number;
  totalTokens: number;
  processingTimeMs: number;
  errors: string[];
}> {
  const { config, onProgress, onChunk, signal, summarize = true } = options;
  const processor = new LargeDocumentProcessor(config);
  const startTime = Date.now();
  
  const results: ChunkResult[] = [];
  const errors: string[] = [];
  let totalTokens = 0;
  
  const chunkingResult = chunkDocument(content, config);
  totalTokens = chunkingResult.totalTokens;
  
  try {
    for await (const result of processor.processLargeDocument(content, {
      onProgress,
      signal,
      summarize,
    })) {
      results.push(result);
      
      if (result.error) {
        errors.push(result.error);
      }
      
      if (onChunk) {
        onChunk(result);
      }
    }
  } finally {
    processor.destroy();
  }
  
  return {
    results,
    totalChunks: chunkingResult.totalChunks,
    totalTokens,
    processingTimeMs: Date.now() - startTime,
    errors,
  };
}

export async function* streamChunkDocument(
  content: string,
  config?: Partial<LargeDocumentConfig>
): AsyncGenerator<DocumentChunk, void, unknown> {
  const chunkingResult = chunkDocument(content, config);
  
  for (const chunk of chunkingResult.chunks) {
    yield chunk;
    await new Promise<void>(resolve => setImmediate(resolve));
  }
}

export function compressContext(
  summaries: string[],
  maxTokens: number = 4000
): string {
  if (summaries.length === 0) return "";
  
  const combined = summaries.join("\n\n---\n\n");
  const tokens = estimateTokens(combined);
  
  if (tokens <= maxTokens) {
    return combined;
  }
  
  const targetLength = Math.floor((maxTokens * 4) / summaries.length);
  const compressed = summaries
    .map(s => s.slice(0, targetLength))
    .join("\n\n");
  
  return compressed;
}

export function mergeChunkResults(results: ChunkResult[]): {
  combinedSummary: string;
  allRelevantInfo: string[];
  successRate: number;
  totalProcessingTimeMs: number;
} {
  const successful = results.filter(r => r.processed && !r.error);
  const summaries = successful
    .sort((a, b) => a.chunkIndex - b.chunkIndex)
    .map(r => r.summary)
    .filter(Boolean) as string[];
  
  const allInfo = successful
    .flatMap(r => r.relevantInfo || []);
  
  const uniqueInfo = Array.from(new Set(allInfo));
  
  return {
    combinedSummary: summaries.join("\n\n"),
    allRelevantInfo: uniqueInfo,
    successRate: results.length > 0 ? successful.length / results.length : 0,
    totalProcessingTimeMs: results.reduce((sum, r) => sum + r.processingTimeMs, 0),
  };
}
