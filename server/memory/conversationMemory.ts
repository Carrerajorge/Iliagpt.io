import { randomUUID } from 'crypto';

export type FactType = 'name' | 'preference' | 'skill' | 'context' | 'instruction';

export interface MemoryFact {
  id: string;
  userId: string;
  type: FactType;
  content: string;
  confidence: number;
  createdAt: Date;
  lastAccessedAt: Date;
  accessCount: number;
  decayFactor: number;
}

interface Message {
  role: string;
  content: string;
}

const DECAY_RATE = 0.1; // 10% per week
const PRUNE_THRESHOLD = 0.1;
const MS_PER_WEEK = 7 * 24 * 60 * 60 * 1000;

const PATTERNS: { type: FactType; regex: RegExp; confidence: number }[] = [
  { type: 'name', regex: /my name is\s+([A-Z][a-z]+(?:\s+[A-Z][a-z]+)?)/i, confidence: 0.95 },
  { type: 'name', regex: /(?:call me|i'm|i am)\s+([A-Z][a-z]+)/i, confidence: 0.8 },
  { type: 'preference', regex: /i (?:prefer|like|love|enjoy)\s+(.{3,60})/i, confidence: 0.7 },
  { type: 'preference', regex: /i (?:don't like|hate|dislike|avoid)\s+(.{3,60})/i, confidence: 0.7 },
  { type: 'skill', regex: /i (?:work with|use|develop (?:in|with)|code (?:in|with))\s+(.{3,40})/i, confidence: 0.75 },
  { type: 'skill', regex: /i(?:'m| am) (?:a|an)\s+([\w\s]{3,40}(?:developer|engineer|designer|analyst|scientist))/i, confidence: 0.85 },
  { type: 'context', regex: /(?:my|our) (?:project|app|company|team)\s+(?:is|uses|runs)\s+(.{3,60})/i, confidence: 0.7 },
  { type: 'instruction', regex: /(?:always|never|please always|please never)\s+(.{3,80})/i, confidence: 0.8 },
];

export class ConversationMemory {
  private store = new Map<string, MemoryFact[]>();

  async extractFacts(messages: Message[], userId: string): Promise<MemoryFact[]> {
    const facts: MemoryFact[] = [];
    for (const msg of messages) {
      if (msg.role !== 'user' || !msg.content) continue;
      for (const { type, regex, confidence } of PATTERNS) {
        const match = msg.content.match(regex);
        if (match?.[1]) {
          facts.push(this.createFact(userId, type, match[1].trim(), confidence));
        }
      }
    }
    return facts;
  }

  async addFact(userId: string, fact: MemoryFact): Promise<void> {
    const facts = this.store.get(userId) ?? [];
    const existing = facts.find(
      (f) => f.type === fact.type && f.content.toLowerCase() === fact.content.toLowerCase(),
    );
    if (existing) {
      existing.confidence = Math.max(existing.confidence, fact.confidence);
      existing.lastAccessedAt = new Date();
      existing.accessCount++;
    } else {
      facts.push(fact);
      this.store.set(userId, facts);
    }
  }

  async getFacts(userId: string, query?: string, limit = 20): Promise<MemoryFact[]> {
    this.applyDecay(userId);
    let facts = this.store.get(userId) ?? [];
    if (query) {
      const keywords = query.toLowerCase().split(/\s+/);
      facts = facts
        .map((f) => {
          const content = f.content.toLowerCase();
          const overlap = keywords.filter((k) => content.includes(k)).length;
          return { fact: f, score: overlap / keywords.length };
        })
        .filter((r) => r.score > 0)
        .sort((a, b) => b.score - a.score)
        .map((r) => r.fact);
    }
    facts.forEach((f) => {
      f.lastAccessedAt = new Date();
      f.accessCount++;
    });
    return facts.slice(0, limit);
  }

  async forgetFact(userId: string, factId: string): Promise<boolean> {
    const facts = this.store.get(userId);
    if (!facts) return false;
    const idx = facts.findIndex((f) => f.id === factId);
    if (idx === -1) return false;
    facts.splice(idx, 1);
    return true;
  }

  async getRelevantContext(userId: string, currentMessage: string): Promise<string> {
    const facts = await this.getFacts(userId, currentMessage, 10);
    if (facts.length === 0) return '';
    const lines = facts.map((f) => `- [${f.type}] ${f.content} (confidence: ${f.confidence.toFixed(2)})`);
    return `## User Memory\n${lines.join('\n')}`;
  }

  async summarizeConversation(messages: Message[]): Promise<string> {
    return messages
      .filter((m) => m.role === 'assistant' && m.content)
      .map((m) => m.content.split(/[.!?]\s/)[0]?.trim())
      .filter(Boolean)
      .join('. ');
  }

  private createFact(userId: string, type: FactType, content: string, confidence: number): MemoryFact {
    const now = new Date();
    return {
      id: randomUUID(),
      userId,
      type,
      content,
      confidence,
      createdAt: now,
      lastAccessedAt: now,
      accessCount: 0,
      decayFactor: 1.0,
    };
  }

  private applyDecay(userId: string): void {
    const facts = this.store.get(userId);
    if (!facts) return;
    const now = Date.now();
    for (let i = facts.length - 1; i >= 0; i--) {
      const weeksSinceAccess = (now - facts[i].lastAccessedAt.getTime()) / MS_PER_WEEK;
      facts[i].decayFactor = Math.max(0, 1 - DECAY_RATE * weeksSinceAccess);
      if (facts[i].decayFactor < PRUNE_THRESHOLD) {
        facts.splice(i, 1);
      }
    }
  }
}
