import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import express from 'express';

import { createHttpTestClient } from '../../tests/helpers/httpTestClient';
import { initModelWiring, NO_LLM_PROVIDER_MESSAGE } from '../integration/modelWiring';

const spawnMock = vi.fn();

vi.mock('../tasks/BackgroundTaskManager', () => ({
  backgroundTaskManager: {
    spawn: spawnMock,
    getOrFetch: vi.fn(),
    list: vi.fn(() => []),
    subscribeToTask: vi.fn(() => () => {}),
    cancel: vi.fn(() => false),
    stats: vi.fn(() => ({ total: 0, running: 0, queued: 0, completed: 0, failed: 0 })),
  },
}));

vi.mock('../agent/unifiedChatHandler', () => ({
  createUnifiedRun: vi.fn(),
}));

vi.mock('../agent/runtime/agentRuntimeFacade', () => ({
  streamAgentRuntime: vi.fn(),
}));

vi.mock('../agent/toolRegistry', () => ({
  toolRegistry: {
    list: vi.fn(() => []),
    get: vi.fn(() => null),
    execute: vi.fn(),
  },
}));

async function createTestApp() {
  const { createAgenticChatRouter } = await import('../routes/agenticChatRouter');
  const app = express();
  app.use(express.json());
  app.use('/api/agentic', createAgenticChatRouter());
  return app;
}

describe('agenticChatRouter background task readiness', () => {
  const originalEnv = {
    XAI_API_KEY: process.env.XAI_API_KEY,
    OPENAI_API_KEY: process.env.OPENAI_API_KEY,
    ANTHROPIC_API_KEY: process.env.ANTHROPIC_API_KEY,
    GEMINI_API_KEY: process.env.GEMINI_API_KEY,
    GOOGLE_API_KEY: process.env.GOOGLE_API_KEY,
    DEEPSEEK_API_KEY: process.env.DEEPSEEK_API_KEY,
    LOCAL_LLM_URL: process.env.LOCAL_LLM_URL,
  };

  beforeEach(() => {
    spawnMock.mockReset();
    process.env.XAI_API_KEY = '';
    process.env.OPENAI_API_KEY = '';
    process.env.ANTHROPIC_API_KEY = '';
    process.env.GEMINI_API_KEY = '';
    process.env.GOOGLE_API_KEY = '';
    process.env.DEEPSEEK_API_KEY = '';
    process.env.LOCAL_LLM_URL = '';
    initModelWiring();
  });

  afterEach(() => {
    process.env.XAI_API_KEY = originalEnv.XAI_API_KEY;
    process.env.OPENAI_API_KEY = originalEnv.OPENAI_API_KEY;
    process.env.ANTHROPIC_API_KEY = originalEnv.ANTHROPIC_API_KEY;
    process.env.GEMINI_API_KEY = originalEnv.GEMINI_API_KEY;
    process.env.GOOGLE_API_KEY = originalEnv.GOOGLE_API_KEY;
    process.env.DEEPSEEK_API_KEY = originalEnv.DEEPSEEK_API_KEY;
    process.env.LOCAL_LLM_URL = originalEnv.LOCAL_LLM_URL;
    initModelWiring();
  });

  it('rejects background task creation early when no LLM provider is configured', async () => {
    const app = await createTestApp();
    const { client, close } = await createHttpTestClient(app);

    try {
      const response = await client
        .post('/api/agentic/task')
        .send({ objective: 'Investiga y ejecuta un flujo agentic' });

      expect(response.status).toBe(503);
      expect(response.body).toMatchObject({
        code: 'AGENTIC_LLM_UNAVAILABLE',
        error: NO_LLM_PROVIDER_MESSAGE,
      });
      expect(spawnMock).not.toHaveBeenCalled();
    } finally {
      await close();
    }
  });
});
