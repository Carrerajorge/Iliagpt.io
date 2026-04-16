import type { Memory, MemoryRecord } from "../types";
import { nowISO } from "../config";

export class InMemoryMemory implements Memory {
  private records = new Map<string, MemoryRecord>();

  async store(rec: { 
    key: string; 
    value: unknown; 
    metadata?: Record<string, unknown>; 
    ttlSeconds?: number 
  }): Promise<void> {
    const now = new Date();
    const expiresAt = rec.ttlSeconds 
      ? new Date(now.getTime() + rec.ttlSeconds * 1000).toISOString() 
      : undefined;

    this.records.set(rec.key, {
      key: rec.key,
      value: rec.value,
      metadata: rec.metadata,
      createdAt: now.toISOString(),
      expiresAt,
    });
  }

  async get(key: string): Promise<MemoryRecord | null> {
    const record = this.records.get(key);
    
    if (!record) return null;
    
    if (record.expiresAt && Date.now() > Date.parse(record.expiresAt)) {
      this.records.delete(key);
      return null;
    }
    
    return record;
  }

  async search(
    query: string, 
    limit: number, 
    threshold: number
  ): Promise<Array<MemoryRecord & { score: number }>> {
    const queryLower = query.toLowerCase();
    const results: Array<MemoryRecord & { score: number }> = [];
    
    for (const record of Array.from(this.records.values())) {
      if (record.expiresAt && Date.now() > Date.parse(record.expiresAt)) {
        this.records.delete(record.key);
        continue;
      }

      const haystack = JSON.stringify(record.value ?? "").toLowerCase();
      const keyMatch = record.key.toLowerCase().includes(queryLower);
      const valueMatch = haystack.includes(queryLower);
      
      let score = 0;
      if (keyMatch) score += 0.5;
      if (valueMatch) score += 0.5;
      
      if (score >= threshold) {
        results.push({ ...record, score });
      }
    }
    
    results.sort((a, b) => b.score - a.score);
    return results.slice(0, limit);
  }

  async delete(key: string): Promise<boolean> {
    return this.records.delete(key);
  }

  async clear(): Promise<void> {
    this.records.clear();
  }

  async keys(): Promise<string[]> {
    return Array.from(this.records.keys());
  }

  async size(): Promise<number> {
    return this.records.size;
  }

  async cleanup(): Promise<number> {
    const now = Date.now();
    let removed = 0;
    
    for (const [key, record] of Array.from(this.records.entries())) {
      if (record.expiresAt && now > Date.parse(record.expiresAt)) {
        this.records.delete(key);
        removed++;
      }
    }
    
    return removed;
  }
}

export interface EmbeddingsAdapter {
  embedText: (text: string) => Promise<number[]>;
}

export interface VectorStore {
  upsert: (args: { id: string; vector: number[]; payload: unknown }) => Promise<void>;
  query: (args: { vector: number[]; topK: number }) => Promise<Array<{ id: string; score: number; payload: unknown }>>;
}

export class VectorMemory implements Memory {
  constructor(
    private embeddings: EmbeddingsAdapter,
    private vectorStore: VectorStore,
    private baseMemory: Memory = new InMemoryMemory()
  ) {}

  async store(rec: { 
    key: string; 
    value: unknown; 
    metadata?: Record<string, unknown>; 
    ttlSeconds?: number 
  }): Promise<void> {
    await this.baseMemory.store(rec);
    
    const text = typeof rec.value === "string" 
      ? rec.value 
      : JSON.stringify(rec.value);
    
    const vector = await this.embeddings.embedText(text);
    
    await this.vectorStore.upsert({
      id: rec.key,
      vector,
      payload: {
        key: rec.key,
        value: rec.value,
        metadata: rec.metadata,
        createdAt: nowISO(),
      },
    });
  }

  async get(key: string): Promise<MemoryRecord | null> {
    return this.baseMemory.get(key);
  }

  async search(
    query: string, 
    limit: number, 
    threshold: number
  ): Promise<Array<MemoryRecord & { score: number }>> {
    const vector = await this.embeddings.embedText(query);
    
    const results = await this.vectorStore.query({
      vector,
      topK: limit,
    });
    
    return results
      .filter((r) => r.score >= threshold)
      .map((r) => ({
        key: (r.payload as any).key,
        value: (r.payload as any).value,
        metadata: (r.payload as any).metadata,
        createdAt: (r.payload as any).createdAt,
        score: r.score,
      }));
  }
}

export const globalMemory = new InMemoryMemory();
