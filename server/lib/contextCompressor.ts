import { GoogleGenAI } from "@google/genai";
import * as crypto from "crypto";
import { LargeDocumentProcessor, estimateTokens as ldpEstimateTokens } from "./largeDocumentProcessor";

export interface ContextCompressorConfig {
  maxTokens: number;
  compressionRatio: number;
  preserveRecent: number;
  compressionThreshold: number;
  summaryMaxTokens: number;
  cacheEnabled: boolean;
  cacheTTLMs: number;
  modelId: string;
  minMessagesForCompression: number;
  chunkSize: number;
  enableDeduplication: boolean;
  enablePruning: boolean;
  enableSemanticClustering: boolean;
  pruningRelevanceThreshold: number;
  clusterSimilarityThreshold: number;
}

export interface Message {
  role: string;
  content: string;
  timestamp?: number;
  id?: string;
  metadata?: Record<string, unknown>;
}

export interface CompressedBlock {
  id: string;
  type: 'summary' | 'preserved' | 'system';
  content: string;
  originalMessageCount: number;
  originalTokenCount: number;
  compressedTokenCount: number;
  startIndex: number;
  endIndex: number;
  timestamp: number;
}

export interface CompressedContext {
  blocks: CompressedBlock[];
  preservedMessages: Message[];
  systemPrompt?: Message;
  totalOriginalTokens: number;
  totalCompressedTokens: number;
  compressionRatio: number;
  compressedMessageCount: number;
  preservedMessageCount: number;
  compressionApplied: boolean;
  strategies: string[];
}

export interface CompressionStats {
  original: number;
  compressed: number;
  ratio: number;
  tokensReclaimed: number;
  summaryGenerations: number;
  cacheHits: number;
  deduplicatedMessages: number;
  prunedMessages: number;
  clusteredMessages: number;
  compressionTimeMs: number;
}

interface CachedSummary {
  summary: string;
  timestamp: number;
  hash: string;
  tokenCount: number;
}

interface MessageCluster {
  centroidContent: string;
  messages: Message[];
  similarity: number;
}

interface CompressionMetrics {
  compressionRatioHistogram: number[];
  summaryGenerationTimesMs: number[];
  tokensReclaimedCounter: number;
  totalCompressions: number;
  cacheHitRate: number;
}

const DEFAULT_CONFIG: ContextCompressorConfig = {
  maxTokens: 100000,
  compressionRatio: 0.3,
  preserveRecent: 5,
  compressionThreshold: 0.8,
  summaryMaxTokens: 500,
  cacheEnabled: true,
  cacheTTLMs: 3600000,
  modelId: "gemini-2.0-flash",
  minMessagesForCompression: 10,
  chunkSize: 10,
  enableDeduplication: true,
  enablePruning: true,
  enableSemanticClustering: true,
  pruningRelevanceThreshold: 0.3,
  clusterSimilarityThreshold: 0.7,
};

function generateMessageHash(messages: Message[]): string {
  const content = messages.map(m => `${m.role}:${m.content}`).join("|");
  return crypto.createHash("sha256").update(content).digest("hex");
}

function generateBlockId(content: string, index: number): string {
  const hash = crypto.createHash("sha256").update(content).digest("hex").slice(0, 12);
  return `block_${index}_${hash}`;
}

export function estimateContextTokens(messages: Message[]): number {
  if (!messages || messages.length === 0) return 0;
  return messages.reduce((total, msg) => total + ldpEstimateTokens(msg.content), 0);
}

function calculateJaccardSimilarity(text1: string, text2: string): number {
  const wordsArray1 = text1.toLowerCase().split(/\s+/).filter(Boolean);
  const wordsArray2 = text2.toLowerCase().split(/\s+/).filter(Boolean);
  const words1 = new Set(wordsArray1);
  const words2 = new Set(wordsArray2);
  
  if (words1.size === 0 && words2.size === 0) return 1;
  if (words1.size === 0 || words2.size === 0) return 0;
  
  const intersectionArray = wordsArray1.filter(w => words2.has(w));
  const unionArray = Array.from(words1).concat(Array.from(words2).filter(w => !words1.has(w)));
  
  return intersectionArray.length > 0 ? new Set(intersectionArray).size / new Set(unionArray).size : 0;
}

function extractKeyPhrases(text: string): string[] {
  const sentences = text.split(/[.!?]+/).filter(Boolean);
  const keywords: string[] = [];
  
  const importantPatterns = [
    /\b(important|critical|key|main|primary|essential)\b/gi,
    /\b(should|must|need|require)\b/gi,
    /\b(because|therefore|thus|hence)\b/gi,
    /\b(goal|objective|purpose|target)\b/gi,
  ];
  
  for (const sentence of sentences) {
    for (const pattern of importantPatterns) {
      if (pattern.test(sentence)) {
        keywords.push(sentence.trim());
        break;
      }
    }
  }
  
  return keywords.slice(0, 5);
}

function calculateRelevanceScore(message: Message, allMessages: Message[]): number {
  let score = 0.5;
  
  const content = message.content.toLowerCase();
  
  if (/\?$/.test(message.content.trim())) score += 0.2;
  
  if (/important|critical|must|need|urgent/i.test(content)) score += 0.15;
  
  if (/yes|no|ok|okay|sure|thanks|thank you/i.test(content) && content.length < 50) score -= 0.3;
  
  const tokenCount = ldpEstimateTokens(message.content);
  if (tokenCount > 100) score += 0.1;
  else if (tokenCount < 20) score -= 0.1;
  
  if (message.role === "user") score += 0.1;
  
  if (/```|\bcode\b|function|class|import/i.test(content)) score += 0.15;
  
  return Math.max(0, Math.min(1, score));
}

export class ContextCompressor {
  private config: ContextCompressorConfig;
  private genai: GoogleGenAI;
  private summaryCache: Map<string, CachedSummary> = new Map();
  private largeDocProcessor: LargeDocumentProcessor;
  private metrics: CompressionMetrics = {
    compressionRatioHistogram: [],
    summaryGenerationTimesMs: [],
    tokensReclaimedCounter: 0,
    totalCompressions: 0,
    cacheHitRate: 0,
  };
  private stats: CompressionStats = {
    original: 0,
    compressed: 0,
    ratio: 1,
    tokensReclaimed: 0,
    summaryGenerations: 0,
    cacheHits: 0,
    deduplicatedMessages: 0,
    prunedMessages: 0,
    clusteredMessages: 0,
    compressionTimeMs: 0,
  };

  constructor(config?: Partial<ContextCompressorConfig>) {
    this.config = { ...DEFAULT_CONFIG, ...config };
    
    const apiKey = process.env.GEMINI_API_KEY || process.env.GOOGLE_GENERATIVE_AI_API_KEY || "";
    if (!apiKey) {
      console.warn("[ContextCompressor] No Gemini API key found");
    }
    
    this.genai = new GoogleGenAI({ apiKey });
    this.largeDocProcessor = new LargeDocumentProcessor({
      summaryMaxTokens: this.config.summaryMaxTokens,
      cacheEnabled: this.config.cacheEnabled,
      cacheTTLMs: this.config.cacheTTLMs,
    });
    
    setInterval(() => this.cleanupCache(), 300000);
  }

  async compress(messages: Message[]): Promise<CompressedContext> {
    const startTime = performance.now();
    this.resetStats();
    
    if (!messages || messages.length === 0) {
      return this.createEmptyContext();
    }
    
    const totalTokens = estimateContextTokens(messages);
    this.stats.original = totalTokens;
    
    const compressionTriggerThreshold = this.config.maxTokens * this.config.compressionThreshold;
    
    if (totalTokens <= compressionTriggerThreshold || messages.length < this.config.minMessagesForCompression) {
      return this.createUncompressedContext(messages, totalTokens);
    }
    
    const { systemPrompt, conversationMessages } = this.separateSystemPrompt(messages);
    const { preserved, toCompress } = this.separatePreservedMessages(conversationMessages);
    
    const strategies: string[] = [];
    let processedMessages = [...toCompress];
    
    if (this.config.enableDeduplication) {
      const beforeCount = processedMessages.length;
      processedMessages = this.deduplicateMessages(processedMessages);
      const deduped = beforeCount - processedMessages.length;
      if (deduped > 0) {
        this.stats.deduplicatedMessages = deduped;
        strategies.push("deduplication");
      }
    }
    
    if (this.config.enablePruning) {
      const beforeCount = processedMessages.length;
      processedMessages = this.pruneMessages(processedMessages);
      const pruned = beforeCount - processedMessages.length;
      if (pruned > 0) {
        this.stats.prunedMessages = pruned;
        strategies.push("pruning");
      }
    }
    
    if (this.config.enableSemanticClustering && processedMessages.length > this.config.chunkSize) {
      const beforeCount = processedMessages.length;
      processedMessages = this.clusterMessages(processedMessages);
      const clustered = beforeCount - processedMessages.length;
      if (clustered > 0) {
        this.stats.clusteredMessages = clustered;
        strategies.push("semantic_clustering");
      }
    }
    
    const blocks = await this.createCompressedBlocks(processedMessages);
    strategies.push("summarization");
    
    const compressedTokens = this.calculateCompressedTokens(blocks, preserved, systemPrompt);
    this.stats.compressed = compressedTokens;
    this.stats.ratio = compressedTokens / totalTokens;
    this.stats.tokensReclaimed = totalTokens - compressedTokens;
    this.stats.compressionTimeMs = performance.now() - startTime;
    
    this.updateMetrics();
    
    return {
      blocks,
      preservedMessages: preserved,
      systemPrompt: systemPrompt || undefined,
      totalOriginalTokens: totalTokens,
      totalCompressedTokens: compressedTokens,
      compressionRatio: this.stats.ratio,
      compressedMessageCount: toCompress.length,
      preservedMessageCount: preserved.length,
      compressionApplied: true,
      strategies,
    };
  }

  estimateTokens(messages: Message[]): number {
    return estimateContextTokens(messages);
  }

  getCompressionStats(): CompressionStats {
    return { ...this.stats };
  }

  getMetrics(): CompressionMetrics {
    return { ...this.metrics };
  }

  private resetStats(): void {
    this.stats = {
      original: 0,
      compressed: 0,
      ratio: 1,
      tokensReclaimed: 0,
      summaryGenerations: 0,
      cacheHits: 0,
      deduplicatedMessages: 0,
      prunedMessages: 0,
      clusteredMessages: 0,
      compressionTimeMs: 0,
    };
  }

  private createEmptyContext(): CompressedContext {
    return {
      blocks: [],
      preservedMessages: [],
      systemPrompt: undefined,
      totalOriginalTokens: 0,
      totalCompressedTokens: 0,
      compressionRatio: 1,
      compressedMessageCount: 0,
      preservedMessageCount: 0,
      compressionApplied: false,
      strategies: [],
    };
  }

  private createUncompressedContext(messages: Message[], totalTokens: number): CompressedContext {
    const { systemPrompt, conversationMessages } = this.separateSystemPrompt(messages);
    
    return {
      blocks: [],
      preservedMessages: conversationMessages,
      systemPrompt: systemPrompt || undefined,
      totalOriginalTokens: totalTokens,
      totalCompressedTokens: totalTokens,
      compressionRatio: 1,
      compressedMessageCount: 0,
      preservedMessageCount: conversationMessages.length,
      compressionApplied: false,
      strategies: [],
    };
  }

  private separateSystemPrompt(messages: Message[]): { systemPrompt: Message | null; conversationMessages: Message[] } {
    const systemMessages = messages.filter(m => m.role === "system");
    const conversationMessages = messages.filter(m => m.role !== "system");
    
    const systemPrompt = systemMessages.length > 0 
      ? { ...systemMessages[0], content: systemMessages.map(m => m.content).join("\n\n") }
      : null;
    
    return { systemPrompt, conversationMessages };
  }

  private separatePreservedMessages(messages: Message[]): { preserved: Message[]; toCompress: Message[] } {
    const preserveCount = Math.min(this.config.preserveRecent, messages.length);
    
    if (preserveCount >= messages.length) {
      return { preserved: messages, toCompress: [] };
    }
    
    const toCompress = messages.slice(0, -preserveCount);
    const preserved = messages.slice(-preserveCount);
    
    return { preserved, toCompress };
  }

  private deduplicateMessages(messages: Message[]): Message[] {
    if (messages.length <= 1) return messages;
    
    const seen = new Map<string, number>();
    const result: Message[] = [];
    
    for (let i = 0; i < messages.length; i++) {
      const msg = messages[i];
      const normalizedContent = msg.content.toLowerCase().trim();
      const contentHash = crypto.createHash("md5").update(normalizedContent).digest("hex");
      
      if (seen.has(contentHash)) {
        continue;
      }
      
      let isDuplicate = false;
      const seenEntries = Array.from(seen.entries());
      for (let j = 0; j < seenEntries.length; j++) {
        const [, existingIdx] = seenEntries[j];
        const existingMsg = result[existingIdx];
        if (existingMsg && calculateJaccardSimilarity(msg.content, existingMsg.content) > 0.85) {
          isDuplicate = true;
          break;
        }
      }
      
      if (!isDuplicate) {
        seen.set(contentHash, result.length);
        result.push(msg);
      }
    }
    
    return result;
  }

  private pruneMessages(messages: Message[]): Message[] {
    if (messages.length <= 1) return messages;
    
    const scoredMessages = messages.map((msg, index) => ({
      message: msg,
      index,
      score: calculateRelevanceScore(msg, messages),
    }));
    
    const filtered = scoredMessages.filter(sm => sm.score >= this.config.pruningRelevanceThreshold);
    
    if (filtered.length < messages.length * 0.5) {
      const sorted = [...scoredMessages].sort((a, b) => b.score - a.score);
      return sorted.slice(0, Math.ceil(messages.length * 0.5)).map(sm => sm.message);
    }
    
    return filtered.map(sm => sm.message);
  }

  private clusterMessages(messages: Message[]): Message[] {
    if (messages.length <= this.config.chunkSize) return messages;
    
    const clusters: MessageCluster[] = [];
    
    for (const msg of messages) {
      let addedToCluster = false;
      
      for (const cluster of clusters) {
        const similarity = calculateJaccardSimilarity(msg.content, cluster.centroidContent);
        if (similarity >= this.config.clusterSimilarityThreshold) {
          cluster.messages.push(msg);
          cluster.similarity = (cluster.similarity + similarity) / 2;
          addedToCluster = true;
          break;
        }
      }
      
      if (!addedToCluster) {
        clusters.push({
          centroidContent: msg.content,
          messages: [msg],
          similarity: 1,
        });
      }
    }
    
    const result: Message[] = [];
    for (const cluster of clusters) {
      if (cluster.messages.length === 1) {
        result.push(cluster.messages[0]);
      } else {
        const merged = this.mergeCluster(cluster);
        result.push(merged);
      }
    }
    
    return result;
  }

  private mergeCluster(cluster: MessageCluster): Message {
    const combinedContent = cluster.messages.map(m => m.content).join("\n---\n");
    const keyPhrases = extractKeyPhrases(combinedContent);
    
    let mergedContent: string;
    if (keyPhrases.length > 0) {
      mergedContent = `[Merged ${cluster.messages.length} related messages]\n${keyPhrases.join("\n")}`;
    } else {
      mergedContent = `[Merged ${cluster.messages.length} related messages]\n${cluster.centroidContent.slice(0, 500)}`;
    }
    
    return {
      role: cluster.messages[0].role,
      content: mergedContent,
      timestamp: cluster.messages[0].timestamp,
      metadata: { merged: true, originalCount: cluster.messages.length },
    };
  }

  private async createCompressedBlocks(messages: Message[]): Promise<CompressedBlock[]> {
    if (messages.length === 0) return [];
    
    const blocks: CompressedBlock[] = [];
    const chunkSize = this.config.chunkSize;
    
    for (let i = 0; i < messages.length; i += chunkSize) {
      const chunk = messages.slice(i, Math.min(i + chunkSize, messages.length));
      const block = await this.compressMessageChunk(chunk, i, blocks.length);
      blocks.push(block);
    }
    
    return blocks;
  }

  private async compressMessageChunk(
    messages: Message[],
    startIndex: number,
    blockIndex: number
  ): Promise<CompressedBlock> {
    const originalTokens = estimateContextTokens(messages);
    const messagesHash = generateMessageHash(messages);
    
    const cached = this.getCachedSummary(messagesHash);
    if (cached) {
      this.stats.cacheHits++;
      return {
        id: generateBlockId(cached.summary, blockIndex),
        type: 'summary',
        content: cached.summary,
        originalMessageCount: messages.length,
        originalTokenCount: originalTokens,
        compressedTokenCount: cached.tokenCount,
        startIndex,
        endIndex: startIndex + messages.length - 1,
        timestamp: Date.now(),
      };
    }
    
    const startTime = performance.now();
    const summary = await this.generateSummary(messages);
    const summaryTime = performance.now() - startTime;
    
    this.metrics.summaryGenerationTimesMs.push(summaryTime);
    this.stats.summaryGenerations++;
    
    const summaryTokens = ldpEstimateTokens(summary);
    
    this.cacheSummary(messagesHash, summary, summaryTokens);
    
    return {
      id: generateBlockId(summary, blockIndex),
      type: 'summary',
      content: summary,
      originalMessageCount: messages.length,
      originalTokenCount: originalTokens,
      compressedTokenCount: summaryTokens,
      startIndex,
      endIndex: startIndex + messages.length - 1,
      timestamp: Date.now(),
    };
  }

  private async generateSummary(messages: Message[]): Promise<string> {
    const transcript = messages
      .map(m => `${m.role === "user" ? "User" : "Assistant"}: ${m.content}`)
      .join("\n\n");

    const prompt = `Summarize this conversation segment concisely, preserving:
1. Key decisions and conclusions
2. Important facts and data mentioned
3. Action items or commitments
4. Critical context for future reference

Keep the summary under 200 words. Respond only with the summary text.

Conversation:
${transcript}`;

    try {
      const result = await this.genai.models.generateContent({
        model: this.config.modelId,
        contents: [{ role: "user", parts: [{ text: prompt }] }],
        config: {
          maxOutputTokens: this.config.summaryMaxTokens,
          temperature: 0.3,
        },
      });

      return result.text?.trim() || this.fallbackSummary(messages);
    } catch (error: any) {
      console.error("[ContextCompressor] Summary generation error:", error.message);
      return this.fallbackSummary(messages);
    }
  }

  private fallbackSummary(messages: Message[]): string {
    const parts: string[] = [];
    
    for (const msg of messages.slice(0, 3)) {
      const preview = msg.content.slice(0, 150);
      parts.push(`[${msg.role}] ${preview}${msg.content.length > 150 ? "..." : ""}`);
    }
    
    if (messages.length > 3) {
      parts.push(`[...and ${messages.length - 3} more messages]`);
    }
    
    return parts.join("\n");
  }

  private calculateCompressedTokens(
    blocks: CompressedBlock[],
    preserved: Message[],
    systemPrompt: Message | null
  ): number {
    let total = 0;
    
    for (const block of blocks) {
      total += block.compressedTokenCount;
    }
    
    total += estimateContextTokens(preserved);
    
    if (systemPrompt) {
      total += ldpEstimateTokens(systemPrompt.content);
    }
    
    return total;
  }

  private getCachedSummary(hash: string): CachedSummary | undefined {
    const cached = this.summaryCache.get(hash);
    if (cached && Date.now() - cached.timestamp < this.config.cacheTTLMs) {
      return cached;
    }
    if (cached) {
      this.summaryCache.delete(hash);
    }
    return undefined;
  }

  private cacheSummary(hash: string, summary: string, tokenCount: number): void {
    this.summaryCache.set(hash, {
      summary,
      timestamp: Date.now(),
      hash,
      tokenCount,
    });
  }

  private cleanupCache(): void {
    const now = Date.now();
    const expiredKeys: string[] = [];
    
    const cacheEntries = Array.from(this.summaryCache.entries());
    for (let i = 0; i < cacheEntries.length; i++) {
      const [key, value] = cacheEntries[i];
      if (now - value.timestamp > this.config.cacheTTLMs) {
        expiredKeys.push(key);
      }
    }
    
    for (let i = 0; i < expiredKeys.length; i++) {
      this.summaryCache.delete(expiredKeys[i]);
    }
    
    if (expiredKeys.length > 0) {
      console.log(`[ContextCompressor] Cleaned ${expiredKeys.length} expired cache entries`);
    }
  }

  private updateMetrics(): void {
    this.metrics.compressionRatioHistogram.push(this.stats.ratio);
    this.metrics.tokensReclaimedCounter += this.stats.tokensReclaimed;
    this.metrics.totalCompressions++;
    
    if (this.metrics.compressionRatioHistogram.length > 1000) {
      this.metrics.compressionRatioHistogram = this.metrics.compressionRatioHistogram.slice(-500);
    }
    if (this.metrics.summaryGenerationTimesMs.length > 1000) {
      this.metrics.summaryGenerationTimesMs = this.metrics.summaryGenerationTimesMs.slice(-500);
    }
    
    const totalLookups = this.stats.summaryGenerations + this.stats.cacheHits;
    this.metrics.cacheHitRate = totalLookups > 0 ? this.stats.cacheHits / totalLookups : 0;
  }

  getCacheSize(): number {
    return this.summaryCache.size;
  }

  clearCache(): void {
    this.summaryCache.clear();
  }

  getConfig(): ContextCompressorConfig {
    return { ...this.config };
  }

  updateConfig(updates: Partial<ContextCompressorConfig>): void {
    this.config = { ...this.config, ...updates };
  }
}

export async function compressContext(
  messages: Message[],
  config?: Partial<ContextCompressorConfig>
): Promise<CompressedContext> {
  const compressor = new ContextCompressor(config);
  return compressor.compress(messages);
}
