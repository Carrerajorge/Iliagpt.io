import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { resolveOpenAICompatibleConfig } from '../agentic/core/AgenticLoop';

describe('resolveOpenAICompatibleConfig', () => {
  const originalEnv = {
    XAI_API_KEY: process.env.XAI_API_KEY,
    XAI_BASE_URL: process.env.XAI_BASE_URL,
    OPENAI_API_KEY: process.env.OPENAI_API_KEY,
    OPENAI_BASE_URL: process.env.OPENAI_BASE_URL,
    DEEPSEEK_API_KEY: process.env.DEEPSEEK_API_KEY,
    DEEPSEEK_BASE_URL: process.env.DEEPSEEK_BASE_URL,
    OPENROUTER_API_KEY: process.env.OPENROUTER_API_KEY,
  };

  beforeEach(() => {
    process.env.XAI_API_KEY = 'xai-test-key';
    process.env.XAI_BASE_URL = '';
    process.env.OPENAI_API_KEY = '';
    process.env.OPENAI_BASE_URL = '';
    process.env.DEEPSEEK_API_KEY = '';
    process.env.DEEPSEEK_BASE_URL = '';
    process.env.OPENROUTER_API_KEY = '';
  });

  afterEach(() => {
    process.env.XAI_API_KEY = originalEnv.XAI_API_KEY;
    process.env.XAI_BASE_URL = originalEnv.XAI_BASE_URL;
    process.env.OPENAI_API_KEY = originalEnv.OPENAI_API_KEY;
    process.env.OPENAI_BASE_URL = originalEnv.OPENAI_BASE_URL;
    process.env.DEEPSEEK_API_KEY = originalEnv.DEEPSEEK_API_KEY;
    process.env.DEEPSEEK_BASE_URL = originalEnv.DEEPSEEK_BASE_URL;
    process.env.OPENROUTER_API_KEY = originalEnv.OPENROUTER_API_KEY;
  });

  it('uses xAI credentials for grok models', () => {
    const config = resolveOpenAICompatibleConfig('grok-beta');
    expect(config.apiKey).toBe('xai-test-key');
    expect(config.baseURL).toBe('https://api.x.ai/v1');
  });

  it('uses OpenAI-compatible env for openai models', () => {
    process.env.OPENAI_API_KEY = 'openai-test-key';
    process.env.OPENAI_BASE_URL = 'https://api.openai.com/v1';

    const config = resolveOpenAICompatibleConfig('gpt-4o');
    expect(config.apiKey).toBe('openai-test-key');
    expect(config.baseURL).toBe('https://api.openai.com/v1');
  });
});
