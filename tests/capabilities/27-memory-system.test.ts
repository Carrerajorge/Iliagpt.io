/**
 * Capability: Memory System
 * Tests long-term memory extraction, storage, retrieval, and injection into prompts.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { runWithEachProvider, mockProviderEnv, type ProviderConfig } from './_setup/providerMatrix';
import { createLLMClientMock, expectValidJson, createDbMock } from './_setup/testHelpers';

vi.mock('../../server/db', () => ({ db: {} }));

interface MemoryFact {
  id: string;
  userId: number;
  content: string;
  category: 'preference' | 'personal' | 'work' | 'context';
  importance: number; // 0-1
  mentionCount: number;
  embedding?: number[];
  createdAt: Date;
  lastAccessed: Date;
}

interface MemoryExtractionResult {
  facts: Array<{ content: string; category: MemoryFact['category']; importance: number }>;
  provider: string;
}

class MemorySystem {
  private memories = new Map<string, MemoryFact>();
  private counter = 0;

  async extractFacts(
    conversation: string,
    userId: number,
    provider: ProviderConfig,
    llmClient: ReturnType<typeof createLLMClientMock>,
  ): Promise<MemoryExtractionResult> {
    const response = await llmClient.chat.completions.create({
      model: provider.model,
      messages: [
        {
          role: 'system',
          content: 'Extract important facts from this conversation. Return JSON array of facts with category and importance.',
        },
        { role: 'user', content: conversation },
      ],
    });

    const spec = expectValidJson(response.choices[0].message.content);
    const facts = spec.facts as Array<{ content: string; category: MemoryFact['category']; importance: number }> ?? [];

    // Store extracted facts
    for (const fact of facts) {
      await this.store(userId, fact.content, fact.category, fact.importance);
    }

    return { facts, provider: provider.name };
  }

  async store(
    userId: number,
    content: string,
    category: MemoryFact['category'],
    importance: number,
  ): Promise<MemoryFact> {
    const id = `mem_${++this.counter}`;
    const now = new Date();
    const fact: MemoryFact = {
      id,
      userId,
      content,
      category,
      importance: Math.min(1, Math.max(0, importance)),
      mentionCount: 1,
      createdAt: now,
      lastAccessed: now,
    };
    this.memories.set(id, fact);
    return fact;
  }

  getByUser(userId: number): MemoryFact[] {
    return Array.from(this.memories.values()).filter((m) => m.userId === userId);
  }

  getByCategory(userId: number, category: MemoryFact['category']): MemoryFact[] {
    return this.getByUser(userId).filter((m) => m.category === category);
  }

  getTopByImportance(userId: number, limit: number): MemoryFact[] {
    return this.getByUser(userId)
      .sort((a, b) => b.importance - a.importance)
      .slice(0, limit);
  }

  buildPromptInjection(userId: number, maxFacts = 10): string {
    const facts = this.getTopByImportance(userId, maxFacts);
    if (facts.length === 0) return '';
    return `User context:\n${facts.map((f) => `- ${f.content}`).join('\n')}`;
  }

  incrementMention(id: string): boolean {
    const mem = this.memories.get(id);
    if (!mem) return false;
    mem.mentionCount++;
    mem.importance = Math.min(1, mem.mentionCount / 10);
    mem.lastAccessed = new Date();
    return true;
  }

  delete(id: string, userId: number): boolean {
    const mem = this.memories.get(id);
    if (!mem || mem.userId !== userId) return false;
    return this.memories.delete(id);
  }

  count(userId: number): number {
    return this.getByUser(userId).length;
  }
}

const MEMORY_EXTRACTION_RESPONSE = JSON.stringify({
  facts: [
    { content: 'User prefers Python over JavaScript for scripting tasks', category: 'preference', importance: 0.8 },
    { content: 'User works as a Senior Data Scientist at Acme Corp', category: 'work', importance: 0.9 },
    { content: 'User has 8 years of experience in machine learning', category: 'work', importance: 0.85 },
    { content: 'User dislikes verbose responses — prefers concise answers', category: 'preference', importance: 0.7 },
    { content: 'User is based in San Francisco, PT timezone', category: 'personal', importance: 0.6 },
  ],
});

runWithEachProvider('Memory System', (provider: ProviderConfig) => {
  let llmMock: ReturnType<typeof createLLMClientMock>;
  let memorySystem: MemorySystem;

  mockProviderEnv(provider);

  beforeEach(() => {
    llmMock = createLLMClientMock({ content: MEMORY_EXTRACTION_RESPONSE, model: provider.model });
    memorySystem = new MemorySystem();
  });

  it('extracts facts from a conversation', async () => {
    const result = await memorySystem.extractFacts(
      'I prefer Python for scripting. I work as a data scientist.',
      1, provider, llmMock,
    );
    expect(result.facts.length).toBeGreaterThan(0);
  });

  it('stores extracted facts for the user', async () => {
    await memorySystem.extractFacts('User context here', 1, provider, llmMock);
    expect(memorySystem.count(1)).toBeGreaterThan(0);
  });

  it('each fact has content and category', async () => {
    const result = await memorySystem.extractFacts('Conversation', 1, provider, llmMock);
    for (const fact of result.facts) {
      expect(fact.content).toBeTruthy();
      expect(['preference', 'personal', 'work', 'context']).toContain(fact.category);
    }
  });

  it('importance scores are between 0 and 1', async () => {
    const result = await memorySystem.extractFacts('Test', 1, provider, llmMock);
    for (const fact of result.facts) {
      expect(fact.importance).toBeGreaterThanOrEqual(0);
      expect(fact.importance).toBeLessThanOrEqual(1);
    }
  });

  it('retrieves memories by category', async () => {
    await memorySystem.extractFacts('Conversation', 1, provider, llmMock);
    const preferences = memorySystem.getByCategory(1, 'preference');
    expect(preferences.length).toBeGreaterThan(0);
  });

  it('isolates memories between users', async () => {
    await memorySystem.extractFacts('User 1 data', 1, provider, llmMock);
    expect(memorySystem.count(2)).toBe(0);
  });

  it('returns top memories by importance', async () => {
    await memorySystem.store(1, 'Low importance fact', 'context', 0.1);
    await memorySystem.store(1, 'High importance fact', 'work', 0.9);
    await memorySystem.store(1, 'Medium importance fact', 'preference', 0.5);

    const top2 = memorySystem.getTopByImportance(1, 2);
    expect(top2[0].importance).toBeGreaterThanOrEqual(top2[1].importance);
  });

  it('builds prompt injection string', async () => {
    await memorySystem.extractFacts('Context', 1, provider, llmMock);
    const injection = memorySystem.buildPromptInjection(1);
    expect(injection).toContain('User context:');
    expect(injection.length).toBeGreaterThan(20);
  });

  it('returns empty string when no memories exist', () => {
    const injection = memorySystem.buildPromptInjection(999);
    expect(injection).toBe('');
  });

  it('increments mention count', async () => {
    const fact = await memorySystem.store(1, 'Mentioned fact', 'work', 0.5);
    memorySystem.incrementMention(fact.id);
    const updated = memorySystem.getByUser(1).find((m) => m.id === fact.id);
    expect(updated?.mentionCount).toBe(2);
  });

  it('deletes memory by id and user', async () => {
    const fact = await memorySystem.store(1, 'Deletable fact', 'context', 0.3);
    const deleted = memorySystem.delete(fact.id, 1);
    expect(deleted).toBe(true);
    expect(memorySystem.count(1)).toBe(0);
  });

  it('prevents deleting another user\'s memory', async () => {
    const fact = await memorySystem.store(1, 'Private fact', 'personal', 0.5);
    const deleted = memorySystem.delete(fact.id, 99);
    expect(deleted).toBe(false);
  });

  it('calls LLM once per extraction', async () => {
    await memorySystem.extractFacts('Single call test', 1, provider, llmMock);
    expect(llmMock.chat.completions.create).toHaveBeenCalledTimes(1);
  });

  it('MEMORY_EXTRACTION_RESPONSE has 5 facts', () => {
    const spec = expectValidJson(MEMORY_EXTRACTION_RESPONSE);
    expect((spec.facts as unknown[]).length).toBe(5);
  });
});
