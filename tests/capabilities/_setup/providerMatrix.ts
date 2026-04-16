/**
 * Provider Matrix — test harness for multi-provider capability tests.
 * Defines all supported LLM providers and the runWithEachProvider helper.
 */

import { describe, vi, beforeEach, afterEach } from 'vitest';

// ── Provider definitions ────────────────────────────────────────────────────

export interface ProviderConfig {
  name: string;
  label: string;
  model: string;
  apiKey: string;
  baseUrl?: string;
  maxTokens: number;
  supportsVision: boolean;
  supportsTools: boolean;
  supportsStreaming: boolean;
  costPer1kIn: number;   // USD
  costPer1kOut: number;  // USD
}

export const TEST_PROVIDERS: ProviderConfig[] = [
  {
    name: 'claude',
    label: 'Anthropic Claude',
    model: 'claude-sonnet-4-6',
    apiKey: 'test-anthropic-key-sk-ant-xxx',
    maxTokens: 200_000,
    supportsVision: true,
    supportsTools: true,
    supportsStreaming: true,
    costPer1kIn: 0.003,
    costPer1kOut: 0.015,
  },
  {
    name: 'openai',
    label: 'OpenAI GPT-4o',
    model: 'gpt-4o',
    apiKey: 'test-openai-key-sk-openai-xxx',
    maxTokens: 128_000,
    supportsVision: true,
    supportsTools: true,
    supportsStreaming: true,
    costPer1kIn: 0.005,
    costPer1kOut: 0.015,
  },
  {
    name: 'gemini',
    label: 'Google Gemini',
    model: 'gemini-1.5-pro',
    apiKey: 'test-gemini-key-AIzaSy-xxx',
    maxTokens: 1_000_000,
    supportsVision: true,
    supportsTools: true,
    supportsStreaming: true,
    costPer1kIn: 0.00125,
    costPer1kOut: 0.005,
  },
  {
    name: 'grok',
    label: 'xAI Grok',
    model: 'grok-2',
    apiKey: 'test-grok-key-xai-xxx',
    baseUrl: 'https://api.x.ai/v1',
    maxTokens: 131_072,
    supportsVision: false,
    supportsTools: true,
    supportsStreaming: true,
    costPer1kIn: 0.002,
    costPer1kOut: 0.010,
  },
  {
    name: 'mistral',
    label: 'Mistral Large',
    model: 'mistral-large-latest',
    apiKey: 'test-mistral-key-xxx',
    baseUrl: 'https://api.mistral.ai/v1',
    maxTokens: 128_000,
    supportsVision: false,
    supportsTools: true,
    supportsStreaming: true,
    costPer1kIn: 0.002,
    costPer1kOut: 0.006,
  },
];

// ── Core helper ─────────────────────────────────────────────────────────────

/**
 * Run the same test suite against every provider in TEST_PROVIDERS.
 * Each provider gets its own describe block labeled "[providerName] suiteName".
 */
export function runWithEachProvider(
  suiteName: string,
  testFactory: (provider: ProviderConfig) => void,
): void {
  for (const provider of TEST_PROVIDERS) {
    describe(`[${provider.name}] ${suiteName}`, () => {
      testFactory(provider);
    });
  }
}

// ── Response builders ────────────────────────────────────────────────────────

export interface MockChatCompletion {
  id: string;
  object: string;
  model: string;
  choices: Array<{
    index: number;
    message: { role: string; content: string; tool_calls?: unknown[] };
    finish_reason: string;
  }>;
  usage: { prompt_tokens: number; completion_tokens: number; total_tokens: number };
}

export function buildProviderResponse(
  provider: ProviderConfig,
  content: string,
  toolCalls?: unknown[],
): MockChatCompletion {
  return {
    id: `chatcmpl-test-${provider.name}-${Date.now()}`,
    object: 'chat.completion',
    model: provider.model,
    choices: [
      {
        index: 0,
        message: { role: 'assistant', content, ...(toolCalls ? { tool_calls: toolCalls } : {}) },
        finish_reason: toolCalls ? 'tool_calls' : 'stop',
      },
    ],
    usage: { prompt_tokens: 120, completion_tokens: 80, total_tokens: 200 },
  };
}

export function buildStreamChunk(provider: ProviderConfig, delta: string, done = false) {
  return {
    id: `chatcmpl-stream-${provider.name}`,
    object: 'chat.completion.chunk',
    model: provider.model,
    choices: [
      {
        index: 0,
        delta: done ? {} : { role: 'assistant', content: delta },
        finish_reason: done ? 'stop' : null,
      },
    ],
  };
}

// ── Provider-specific env mock helper ────────────────────────────────────────

export function mockProviderEnv(provider: ProviderConfig) {
  const origEnv = { ...process.env };

  beforeEach(() => {
    process.env.ANTHROPIC_API_KEY = 'test-anthropic-key';
    process.env.OPENAI_API_KEY = 'test-openai-key';
    process.env.GEMINI_API_KEY = 'test-gemini-key';
    process.env.XAI_API_KEY = 'test-grok-key';
    process.env.MISTRAL_API_KEY = 'test-mistral-key';
    process.env.DEFAULT_LLM_PROVIDER = provider.name;
    process.env.DEFAULT_LLM_MODEL = provider.model;
  });

  afterEach(() => {
    Object.assign(process.env, origEnv);
  });
}
