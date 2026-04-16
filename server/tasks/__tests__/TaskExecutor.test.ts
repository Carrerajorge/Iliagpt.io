import { describe, expect, it, beforeEach, afterEach } from 'vitest';

import type { TaskRecord } from '../BackgroundTaskManager';
import { resolveTaskModel } from '../TaskExecutor';
import { initModelWiring } from '../../integration/modelWiring';

function makeTask(metadata?: Record<string, unknown>): TaskRecord {
  return {
    id: 'task_test',
    userId: 'user_test',
    chatId: 'chat_test',
    objective: 'Test objective',
    status: 'queued',
    priority: 'normal',
    createdAt: Date.now(),
    output: '',
    steps: [],
    metadata,
  };
}

describe('resolveTaskModel', () => {
  const originalEnv = {
    DEFAULT_AGENT_MODEL: process.env.DEFAULT_AGENT_MODEL,
    XAI_API_KEY: process.env.XAI_API_KEY,
    OPENAI_API_KEY: process.env.OPENAI_API_KEY,
    ANTHROPIC_API_KEY: process.env.ANTHROPIC_API_KEY,
    GEMINI_API_KEY: process.env.GEMINI_API_KEY,
    GOOGLE_API_KEY: process.env.GOOGLE_API_KEY,
    DEEPSEEK_API_KEY: process.env.DEEPSEEK_API_KEY,
    LOCAL_LLM_URL: process.env.LOCAL_LLM_URL,
  };

  beforeEach(() => {
    process.env.DEFAULT_AGENT_MODEL = '';
    process.env.OPENAI_API_KEY = '';
    process.env.ANTHROPIC_API_KEY = '';
    process.env.GEMINI_API_KEY = '';
    process.env.GOOGLE_API_KEY = '';
    process.env.DEEPSEEK_API_KEY = '';
    process.env.LOCAL_LLM_URL = '';
    process.env.XAI_API_KEY = 'test-xai-key';
    initModelWiring();
  });

  afterEach(() => {
    process.env.DEFAULT_AGENT_MODEL = originalEnv.DEFAULT_AGENT_MODEL;
    process.env.XAI_API_KEY = originalEnv.XAI_API_KEY;
    process.env.OPENAI_API_KEY = originalEnv.OPENAI_API_KEY;
    process.env.ANTHROPIC_API_KEY = originalEnv.ANTHROPIC_API_KEY;
    process.env.GEMINI_API_KEY = originalEnv.GEMINI_API_KEY;
    process.env.GOOGLE_API_KEY = originalEnv.GOOGLE_API_KEY;
    process.env.DEEPSEEK_API_KEY = originalEnv.DEEPSEEK_API_KEY;
    process.env.LOCAL_LLM_URL = originalEnv.LOCAL_LLM_URL;
    initModelWiring();
  });

  it('falls back to the configured available provider instead of Anthropic', () => {
    const model = resolveTaskModel(makeTask());
    expect(model).toBe('grok-beta');
  });

  it('prefers a model explicitly attached to task metadata', () => {
    const model = resolveTaskModel(makeTask({ model: 'grok-4' }));
    expect(model).toBe('grok-4');
  });
});
