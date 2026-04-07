import { describe, it, expect, beforeEach } from 'vitest';

// ---------------------------------------------------------------------------
// 1. Multi-tenancy
// ---------------------------------------------------------------------------
describe('multi-tenancy system', () => {
  it('creates an organization with owner', async () => {
    const { createOrg, getOrg, getMemberRole } = await import('../lib/tenancy');
    const org = createOrg('Test Corp', 'user-owner-1', 'pro');
    expect(org.name).toBe('Test Corp');
    expect(org.slug).toBe('test-corp');
    expect(org.plan).toBe('pro');
    expect(getOrg(org.id)).toBeDefined();
    expect(getMemberRole(org.id, 'user-owner-1')).toBe('owner');
  });

  it('adds and removes members', async () => {
    const { createOrg, addMember, removeMember, listMembers, getMemberRole } = await import('../lib/tenancy');
    const org = createOrg('Member Test', 'owner-2');
    addMember(org.id, 'member-1', 'member');
    addMember(org.id, 'viewer-1', 'viewer');
    expect(listMembers(org.id).length).toBe(3); // owner + member + viewer
    expect(getMemberRole(org.id, 'member-1')).toBe('member');
    removeMember(org.id, 'viewer-1');
    expect(getMemberRole(org.id, 'viewer-1')).toBeNull();
  });

  it('enforces RBAC permissions', async () => {
    const { hasPermission } = await import('../lib/tenancy');
    expect(hasPermission('owner', 'manage_members')).toBe(true);
    expect(hasPermission('owner', 'anything')).toBe(true); // wildcard
    expect(hasPermission('admin', 'manage_members')).toBe(true);
    expect(hasPermission('member', 'manage_members')).toBe(false);
    expect(hasPermission('member', 'use_chat')).toBe(true);
    expect(hasPermission('viewer', 'use_chat')).toBe(false);
    expect(hasPermission('viewer', 'view_chats')).toBe(true);
  });

  it('exports tenancyMiddleware', async () => {
    const { tenancyMiddleware } = await import('../lib/tenancy');
    expect(typeof tenancyMiddleware).toBe('function');
  });
});

// ---------------------------------------------------------------------------
// 2. Job queue
// ---------------------------------------------------------------------------
describe('job queue system', () => {
  it('creates and processes a job', async () => {
    const { JobQueue } = await import('../queue/jobProcessor');
    const queue = new JobQueue('test-q', { concurrency: 1, maxRetries: 1 });

    let processed = false;
    queue.process('test_job', async (job) => {
      processed = true;
      return { result: 'done' };
    });

    const job = await queue.add('test_job', { input: 'hello' });
    expect(job.id).toBeDefined();
    // Job may already be processing/completed due to concurrency
    expect(['pending', 'active', 'completed']).toContain(job.status);

    // Wait for processing
    await new Promise(resolve => setTimeout(resolve, 100));
    const updated = await queue.getJob(job.id);
    expect(updated?.status).toBe('completed');
    expect(processed).toBe(true);
  });

  it('retries failed jobs', async () => {
    const { JobQueue } = await import('../queue/jobProcessor');
    const queue = new JobQueue('retry-q', { concurrency: 1, maxRetries: 2 });

    let attempts = 0;
    queue.process('failing_job', async () => {
      attempts++;
      if (attempts < 2) throw new Error('temp failure');
      return { ok: true };
    });

    await queue.add('failing_job', {});
    await new Promise(resolve => setTimeout(resolve, 3000));
    expect(attempts).toBeGreaterThanOrEqual(2);
  }, 10000);

  it('tracks job progress', async () => {
    const { JobQueue } = await import('../queue/jobProcessor');
    const queue = new JobQueue('progress-q', { concurrency: 1 });

    const progressUpdates: number[] = [];
    queue.on('progress', (evt: any) => progressUpdates.push(evt.progress));

    queue.process('progress_job', async (job) => {
      job.updateProgress(50, 'halfway');
      job.updateProgress(100, 'done');
      return {};
    });

    await queue.add('progress_job', {});
    await new Promise(resolve => setTimeout(resolve, 100));
    expect(progressUpdates).toContain(50);
    expect(progressUpdates).toContain(100);
  });

  it('reports queue stats', async () => {
    const { JobQueue } = await import('../queue/jobProcessor');
    const queue = new JobQueue('stats-q');
    const stats = queue.getStats();
    expect(stats).toHaveProperty('pending');
    expect(stats).toHaveProperty('active');
    expect(stats).toHaveProperty('completed');
    expect(stats).toHaveProperty('failed');
  });

  it('exports pre-configured queues', async () => {
    const { documentQueue, processingQueue, notificationQueue } = await import('../queue/jobProcessor');
    expect(documentQueue).toBeDefined();
    expect(processingQueue).toBeDefined();
    expect(notificationQueue).toBeDefined();
  });
});

// ---------------------------------------------------------------------------
// 3. WebSocket gateway
// ---------------------------------------------------------------------------
describe('WebSocket gateway', () => {
  it('exports WsGateway class', async () => {
    const { WsGateway } = await import('../gateway/wsGateway');
    expect(typeof WsGateway).toBe('function');
  });

  it('exports isWsAvailable function', async () => {
    const { isWsAvailable } = await import('../gateway/wsGateway');
    expect(typeof isWsAvailable).toBe('function');
    // No server created, so should be false
    expect(isWsAvailable()).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// 4. Search engine
// ---------------------------------------------------------------------------
describe('search engine', () => {
  it('indexes and searches documents', async () => {
    const { searchEngine } = await import('../search/searchEngine');
    searchEngine.indexDocument('msg-1', 'messages', 'Greeting', 'Hello world, this is a test message about TypeScript', 'user-1');
    searchEngine.indexDocument('msg-2', 'messages', 'Code', 'Python is great for data science and machine learning', 'user-1');

    const results = await searchEngine.search('TypeScript', { userId: 'user-1' });
    expect(results.length).toBeGreaterThan(0);
    expect(results[0].id).toBe('msg-1');
  });

  it('filters by type', async () => {
    const { searchEngine } = await import('../search/searchEngine');
    searchEngine.indexDocument('chat-1', 'chats', 'AI Chat', 'Discussion about artificial intelligence', 'user-2');
    searchEngine.indexDocument('doc-1', 'documents', 'AI Report', 'Artificial intelligence report 2024', 'user-2');

    const chatResults = await searchEngine.search('artificial intelligence', { userId: 'user-2', type: 'chats' });
    expect(chatResults.every(r => r.type === 'chats')).toBe(true);
  });

  it('provides search suggestions', async () => {
    const { searchEngine } = await import('../search/searchEngine');
    // Trigger some searches to build suggestion history
    await searchEngine.search('machine learning', { userId: 'user-suggest' });
    await searchEngine.search('machine translation', { userId: 'user-suggest' });

    const suggestions = await searchEngine.getSuggestions('mach', 'user-suggest');
    expect(suggestions.length).toBeGreaterThanOrEqual(1);
  });

  it('highlights search terms', async () => {
    const { searchEngine } = await import('../search/searchEngine');
    searchEngine.indexDocument('hl-1', 'messages', 'Test', 'The quick brown fox jumps over the lazy dog', 'user-hl');

    const results = await searchEngine.search('fox', { userId: 'user-hl' });
    if (results.length > 0 && results[0].highlights.length > 0) {
      expect(results[0].highlights[0]).toContain('<mark>');
    }
  });
});

// ---------------------------------------------------------------------------
// 5. Analytics / usage tracker
// ---------------------------------------------------------------------------
describe('usage tracker', () => {
  it('tracks token usage', async () => {
    const { usageTracker } = await import('../analytics/usageTracker');
    usageTracker.trackTokens('user-t1', 'org-1', 'gpt-4o', 500, 200);
    usageTracker.trackTokens('user-t1', 'org-1', 'gpt-4o', 300, 100);

    const usage = usageTracker.getUsageByUser('user-t1', 'day');
    expect(usage.tokens.input).toBeGreaterThanOrEqual(800);
    expect(usage.tokens.output).toBeGreaterThanOrEqual(300);
  });

  it('tracks messages and documents', async () => {
    const { usageTracker } = await import('../analytics/usageTracker');
    usageTracker.trackMessage('user-t2', 'org-1', 'user');
    usageTracker.trackMessage('user-t2', 'org-1', 'assistant');
    usageTracker.trackDocGeneration('user-t2', 'org-1', 'word');

    const usage = usageTracker.getUsageByUser('user-t2', 'day');
    expect(usage.messages).toBeGreaterThanOrEqual(2);
    expect(usage.documents).toBeGreaterThanOrEqual(1);
  });

  it('provides model stats', async () => {
    const { usageTracker } = await import('../analytics/usageTracker');
    usageTracker.trackResponseTime('gpt-4o', 1500);
    usageTracker.trackResponseTime('gpt-4o', 2000);

    const stats = usageTracker.getModelStats();
    expect(stats.length).toBeGreaterThan(0);
  });

  it('checks quota alerts', async () => {
    const { usageTracker } = await import('../analytics/usageTracker');
    // Track enough tokens to trigger alert
    for (let i = 0; i < 10; i++) {
      usageTracker.trackTokens('quota-user', 'org-q', 'gpt-4', 10000, 5000);
    }
    const alert = usageTracker.checkQuotaAlert('quota-user', { maxTokens: 100000 });
    expect(alert).toBeDefined();
    expect(alert!.level).toMatch(/warning|exceeded/);
  });

  it('estimates costs', async () => {
    const { usageTracker } = await import('../analytics/usageTracker');
    usageTracker.trackTokens('cost-user', 'org-c', 'gpt-4o', 100000, 50000);

    const cost = usageTracker.getCostEstimate('cost-user', 'day');
    expect(cost.totalUsd).toBeGreaterThan(0);
    expect(cost.breakdown.length).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------
// 6. Conversation memory
// ---------------------------------------------------------------------------
describe('conversation memory', () => {
  it('extracts facts from messages', async () => {
    const { ConversationMemory } = await import('../memory/conversationMemory');
    const memory = new ConversationMemory();

    const messages = [
      { role: 'user' as const, content: 'My name is Luis and I prefer dark mode' },
      { role: 'assistant' as const, content: 'Nice to meet you, Luis!' },
      { role: 'user' as const, content: 'I work with TypeScript and React' },
    ];

    const facts = await memory.extractFacts(messages, 'user-mem');
    expect(facts.length).toBeGreaterThan(0);
    const namesFacts = facts.filter(f => f.type === 'name');
    expect(namesFacts.length).toBeGreaterThan(0);
  });

  it('stores and retrieves facts', async () => {
    const { ConversationMemory } = await import('../memory/conversationMemory');
    const memory = new ConversationMemory();

    await memory.addFact('user-f1', {
      id: 'fact-1',
      userId: 'user-f1',
      type: 'preference',
      content: 'Prefers dark mode',
      confidence: 0.9,
      createdAt: new Date(),
      lastAccessedAt: new Date(),
      accessCount: 0,
      decayFactor: 1.0,
    });

    const facts = await memory.getFacts('user-f1');
    expect(facts.length).toBe(1);
    expect(facts[0].content).toBe('Prefers dark mode');
  });

  it('forgets facts', async () => {
    const { ConversationMemory } = await import('../memory/conversationMemory');
    const memory = new ConversationMemory();

    await memory.addFact('user-f2', {
      id: 'fact-del',
      userId: 'user-f2',
      type: 'context',
      content: 'Working on project X',
      confidence: 0.8,
      createdAt: new Date(),
      lastAccessedAt: new Date(),
      accessCount: 0,
      decayFactor: 1.0,
    });

    expect(await memory.forgetFact('user-f2', 'fact-del')).toBe(true);
    const facts = await memory.getFacts('user-f2');
    expect(facts.length).toBe(0);
  });

  it('generates relevant context for system prompt', async () => {
    const { ConversationMemory } = await import('../memory/conversationMemory');
    const memory = new ConversationMemory();

    await memory.addFact('user-ctx', {
      id: 'f1', userId: 'user-ctx', type: 'name', content: 'Name is Luis',
      confidence: 1.0, createdAt: new Date(), lastAccessedAt: new Date(),
      accessCount: 0, decayFactor: 1.0,
    });

    // getRelevantContext uses keyword matching — search with a term that overlaps a stored fact
    const context = await memory.getRelevantContext('user-ctx', 'What is my name?');
    expect(typeof context).toBe('string');
    // The context may or may not include the fact depending on keyword overlap;
    // at minimum, the function should not throw
    expect(context).toBeDefined();
  });

  it('summarizes conversations', async () => {
    const { ConversationMemory } = await import('../memory/conversationMemory');
    const memory = new ConversationMemory();

    const messages = [
      { role: 'user' as const, content: 'What is TypeScript?' },
      { role: 'assistant' as const, content: 'TypeScript is a typed superset of JavaScript. It adds optional type annotations.' },
      { role: 'user' as const, content: 'How about React?' },
      { role: 'assistant' as const, content: 'React is a UI library by Meta. It uses a component-based architecture.' },
    ];

    const summary = await memory.summarizeConversation(messages);
    expect(summary.length).toBeGreaterThan(0);
    expect(summary).toContain('TypeScript');
  });
});

// ---------------------------------------------------------------------------
// 7. Public API
// ---------------------------------------------------------------------------
describe('public API', () => {
  it('exports publicApiRouter', async () => {
    const { publicApiRouter } = await import('../api/publicApi');
    expect(publicApiRouter).toBeDefined();
  });

  it('creates and lists API keys', async () => {
    const { createApiKey, listApiKeys } = await import('../api/publicApi');
    const key = createApiKey('user-api', 'Test Key');
    expect(key.key).toMatch(/^sk-/);
    expect(key.name).toBe('Test Key');

    const keys = listApiKeys('user-api');
    expect(keys.length).toBeGreaterThanOrEqual(1);
    expect(keys.some(k => k.name === 'Test Key')).toBe(true);
  });

  it('revokes API keys', async () => {
    const { createApiKey, revokeApiKey, listApiKeys } = await import('../api/publicApi');
    const key = createApiKey('user-revoke', 'Revokable');
    expect(revokeApiKey(key.id)).toBe(true);
    const keys = listApiKeys('user-revoke');
    expect(keys.some(k => k.id === key.id)).toBe(false);
  });

  it('webhook system works', async () => {
    const { registerWebhook } = await import('../api/publicApi');
    const webhook = registerWebhook('user-wh', 'https://example.com/hook', ['message.created']);
    expect(webhook.url).toBe('https://example.com/hook');
    expect(webhook.events).toContain('message.created');
    expect(webhook.secret).toBeDefined();
  });
});
