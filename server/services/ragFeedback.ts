import { db } from '../db';
import { sql } from 'drizzle-orm';
import { LRUCache } from 'lru-cache';
import crypto from 'crypto';

interface FeedbackSignal {
  queryHash: string;
  chunkId: string;
  signal: 'click' | 'dwell' | 'copy' | 'cite' | 'thumbsUp' | 'thumbsDown';
  weight: number;
  timestamp: number;
  sessionId: string;
}

interface ChunkRelevanceScore {
  chunkId: string;
  implicitScore: number;
  explicitScore: number;
  totalSignals: number;
  lastUpdated: number;
}

interface QueryChunkAssociation {
  queryPattern: string;
  chunkIds: string[];
  scores: number[];
  frequency: number;
}

const feedbackBuffer: FeedbackSignal[] = [];
const BUFFER_FLUSH_INTERVAL = 30000;
const MAX_BUFFER_SIZE = 100;

const chunkScores = new LRUCache<string, ChunkRelevanceScore>({
  max: 10000,
  ttl: 1000 * 60 * 60 * 24 * 7,
});

const queryAssociations = new LRUCache<string, QueryChunkAssociation>({
  max: 5000,
  ttl: 1000 * 60 * 60 * 24 * 30,
});

const SIGNAL_WEIGHTS: Record<FeedbackSignal['signal'], number> = {
  click: 0.3,
  dwell: 0.4,
  copy: 0.6,
  cite: 0.8,
  thumbsUp: 1.0,
  thumbsDown: -1.0
};

function normalizeQuery(query: string): string {
  return query
    .toLowerCase()
    .replace(/[^\w\sáéíóúñü]/g, '')
    .split(/\s+/)
    .filter(w => w.length > 2)
    .sort()
    .slice(0, 10)
    .join(' ');
}

function generateQueryHash(query: string): string {
  const normalized = normalizeQuery(query);
  return crypto.createHash('md5').update(normalized).digest('hex');
}

export function recordFeedback(
  query: string,
  chunkId: string,
  signal: FeedbackSignal['signal'],
  sessionId: string,
  metadata?: { dwellTimeMs?: number; scrollDepth?: number }
): void {
  let weight = SIGNAL_WEIGHTS[signal];
  
  if (signal === 'dwell' && metadata?.dwellTimeMs) {
    weight = Math.min(1, metadata.dwellTimeMs / 30000) * 0.5;
  }
  
  if (metadata?.scrollDepth) {
    weight *= (0.5 + metadata.scrollDepth * 0.5);
  }
  
  const feedback: FeedbackSignal = {
    queryHash: generateQueryHash(query),
    chunkId,
    signal,
    weight,
    timestamp: Date.now(),
    sessionId
  };
  
  feedbackBuffer.push(feedback);
  
  if (feedbackBuffer.length >= MAX_BUFFER_SIZE) {
    flushFeedbackBuffer();
  }
}

export function recordImplicitSignals(
  query: string,
  retrievedChunks: Array<{ id: string; position: number }>,
  selectedChunkId: string | null,
  sessionId: string
): void {
  const queryHash = generateQueryHash(query);
  
  for (const chunk of retrievedChunks) {
    const positionDecay = 1 / (1 + chunk.position * 0.1);
    
    if (chunk.id === selectedChunkId) {
      recordFeedback(query, chunk.id, 'click', sessionId);
    } else {
      updateChunkScore(chunk.id, queryHash, positionDecay * 0.1, 'implicit');
    }
  }
  
  updateQueryAssociation(query, retrievedChunks.map(c => c.id));
}

function updateChunkScore(
  chunkId: string,
  queryHash: string,
  delta: number,
  type: 'implicit' | 'explicit'
): void {
  const key = `${chunkId}:${queryHash}`;
  const existing = chunkScores.get(key) || {
    chunkId,
    implicitScore: 0,
    explicitScore: 0,
    totalSignals: 0,
    lastUpdated: Date.now()
  };
  
  if (type === 'implicit') {
    existing.implicitScore = Math.max(-1, Math.min(1, existing.implicitScore + delta * 0.1));
  } else {
    existing.explicitScore = Math.max(-1, Math.min(1, existing.explicitScore + delta));
  }
  
  existing.totalSignals++;
  existing.lastUpdated = Date.now();
  
  chunkScores.set(key, existing);
}

function updateQueryAssociation(query: string, chunkIds: string[]): void {
  const pattern = normalizeQuery(query);
  const existing = queryAssociations.get(pattern);
  
  if (existing) {
    for (const id of chunkIds) {
      const idx = existing.chunkIds.indexOf(id);
      if (idx >= 0) {
        existing.scores[idx] += 0.1;
      } else {
        existing.chunkIds.push(id);
        existing.scores.push(0.1);
      }
    }
    existing.frequency++;
    queryAssociations.set(pattern, existing);
  } else {
    queryAssociations.set(pattern, {
      queryPattern: pattern,
      chunkIds,
      scores: chunkIds.map(() => 0.1),
      frequency: 1
    });
  }
}

export function getChunkBoost(chunkId: string, queryHash: string): number {
  const key = `${chunkId}:${queryHash}`;
  const score = chunkScores.get(key);
  
  if (!score) return 0;
  
  const ageDecay = Math.exp(-(Date.now() - score.lastUpdated) / (1000 * 60 * 60 * 24 * 7));
  const confidenceBoost = Math.min(1, score.totalSignals / 10);
  
  const combinedScore = score.explicitScore * 0.7 + score.implicitScore * 0.3;
  
  return combinedScore * ageDecay * confidenceBoost;
}

export function getSimilarQueryBoosts(query: string): Map<string, number> {
  const pattern = normalizeQuery(query);
  const boosts = new Map<string, number>();
  
  const exact = queryAssociations.get(pattern);
  if (exact) {
    for (let i = 0; i < exact.chunkIds.length; i++) {
      boosts.set(exact.chunkIds[i], exact.scores[i] * 0.5);
    }
  }
  
  const queryWords = new Set(pattern.split(' '));
  
  for (const [key, assoc] of queryAssociations.entries()) {
    if (key === pattern) continue;
    
    const assocWords = new Set(key.split(' '));
    const intersection = [...queryWords].filter(w => assocWords.has(w));
    const similarity = intersection.length / Math.max(queryWords.size, assocWords.size);
    
    if (similarity > 0.5) {
      for (let i = 0; i < assoc.chunkIds.length; i++) {
        const currentBoost = boosts.get(assoc.chunkIds[i]) || 0;
        boosts.set(assoc.chunkIds[i], currentBoost + assoc.scores[i] * similarity * 0.3);
      }
    }
  }
  
  return boosts;
}

async function flushFeedbackBuffer(): Promise<void> {
  if (feedbackBuffer.length === 0) return;
  
  const signals = feedbackBuffer.splice(0, feedbackBuffer.length);
  
  for (const signal of signals) {
    updateChunkScore(
      signal.chunkId,
      signal.queryHash,
      signal.weight,
      signal.signal === 'thumbsUp' || signal.signal === 'thumbsDown' ? 'explicit' : 'implicit'
    );
  }
  
  console.log(`[RAG Feedback] Flushed ${signals.length} feedback signals`);
}

setInterval(flushFeedbackBuffer, BUFFER_FLUSH_INTERVAL);

export function applyFeedbackBoosts(
  query: string,
  chunks: Array<{ id: string; score: number }>
): Array<{ id: string; score: number; feedbackBoost: number }> {
  const queryHash = generateQueryHash(query);
  const similarBoosts = getSimilarQueryBoosts(query);
  
  return chunks.map(chunk => {
    const directBoost = getChunkBoost(chunk.id, queryHash);
    const similarBoost = similarBoosts.get(chunk.id) || 0;
    const totalBoost = directBoost + similarBoost;
    
    return {
      ...chunk,
      score: chunk.score + totalBoost * 0.2,
      feedbackBoost: totalBoost
    };
  }).sort((a, b) => b.score - a.score);
}

export function recordAnswerFeedback(
  query: string,
  chunkIds: string[],
  rating: 'thumbsUp' | 'thumbsDown',
  sessionId: string
): void {
  for (const chunkId of chunkIds) {
    recordFeedback(query, chunkId, rating, sessionId);
  }
  
  console.log(`[RAG Feedback] Recorded ${rating} for ${chunkIds.length} chunks`);
}

export interface FeedbackStats {
  totalSignals: number;
  uniqueQueries: number;
  topChunks: Array<{ chunkId: string; score: number }>;
  recentSignals: number;
}

export function getFeedbackStats(): FeedbackStats {
  const allScores = Array.from(chunkScores.values());
  const uniqueQueries = new Set(
    Array.from(chunkScores.keys()).map(k => k.split(':')[1])
  ).size;
  
  const topChunks = allScores
    .map(s => ({
      chunkId: s.chunkId,
      score: s.explicitScore * 0.7 + s.implicitScore * 0.3
    }))
    .sort((a, b) => b.score - a.score)
    .slice(0, 10);
  
  const recentThreshold = Date.now() - 1000 * 60 * 60;
  const recentSignals = allScores.filter(s => s.lastUpdated > recentThreshold).length;
  
  return {
    totalSignals: allScores.reduce((sum, s) => sum + s.totalSignals, 0),
    uniqueQueries,
    topChunks,
    recentSignals
  };
}

export const ragFeedback = {
  recordFeedback,
  recordImplicitSignals,
  recordAnswerFeedback,
  applyFeedbackBoosts,
  getChunkBoost,
  getSimilarQueryBoosts,
  getFeedbackStats
};
