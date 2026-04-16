/**
 * Test helpers — file/temp/HTTP mocking utilities for capability tests.
 */

import { vi, beforeEach, afterEach } from 'vitest';
import path from 'path';
import os from 'os';

// ── Temp directory management ─────────────────────────────────────────────────

let _tmpDir: string | null = null;

export function getTmpDir(): string {
  if (!_tmpDir) {
    _tmpDir = path.join(os.tmpdir(), `iliagpt-tests-${Date.now()}`);
  }
  return _tmpDir;
}

export function resetTmpDir(): void {
  _tmpDir = null;
}

// ── File system mocks ─────────────────────────────────────────────────────────

export interface MockFile {
  name: string;
  size: number;
  type: string;
  content: Buffer | string;
}

export function createMockFile(overrides: Partial<MockFile> = {}): MockFile {
  return {
    name: 'test-document.txt',
    size: 1024,
    type: 'text/plain',
    content: 'This is test file content for capability testing.',
    ...overrides,
  };
}

export function createMockExcelFile(): MockFile {
  return createMockFile({
    name: 'data.xlsx',
    size: 48_432,
    type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    content: Buffer.from('PK mock-xlsx-content'),
  });
}

export function createMockPdfFile(): MockFile {
  return createMockFile({
    name: 'report.pdf',
    size: 124_800,
    type: 'application/pdf',
    content: Buffer.from('%PDF-1.4 mock-pdf-content'),
  });
}

export function createMockWordFile(): MockFile {
  return createMockFile({
    name: 'contract.docx',
    size: 32_768,
    type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    content: Buffer.from('PK mock-docx-content'),
  });
}

export function createMockPptFile(): MockFile {
  return createMockFile({
    name: 'presentation.pptx',
    size: 256_000,
    type: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
    content: Buffer.from('PK mock-pptx-content'),
  });
}

export function createMockCsvFile(rows = 100): MockFile {
  const header = 'id,name,revenue,category,date\n';
  const dataRows = Array.from({ length: rows }, (_, i) =>
    `${i + 1},Customer ${i + 1},${Math.floor(Math.random() * 100_000)},enterprise,2026-0${(i % 12) + 1}-01`
  ).join('\n');
  return createMockFile({
    name: 'data.csv',
    size: (header + dataRows).length,
    type: 'text/csv',
    content: header + dataRows,
  });
}

// ── HTTP / fetch mocking ──────────────────────────────────────────────────────

export interface MockHttpOptions {
  status?: number;
  headers?: Record<string, string>;
  body?: unknown;
  delay?: number;
}

export function mockFetch(responses: MockHttpOptions | MockHttpOptions[]) {
  const queue = Array.isArray(responses) ? [...responses] : [responses];

  return vi.fn().mockImplementation(async (_url: string, _init?: RequestInit) => {
    const opts = queue.length > 1 ? queue.shift()! : queue[0];
    if (opts.delay) {
      await new Promise((r) => setTimeout(r, opts.delay));
    }
    const bodyStr = typeof opts.body === 'string' ? opts.body : JSON.stringify(opts.body ?? {});
    return {
      ok: (opts.status ?? 200) < 400,
      status: opts.status ?? 200,
      statusText: opts.status === 200 ? 'OK' : 'Error',
      headers: new Headers({ 'content-type': 'application/json', ...opts.headers }),
      json: async () => (typeof opts.body === 'string' ? JSON.parse(opts.body) : (opts.body ?? {})),
      text: async () => bodyStr,
      body: null,
    };
  });
}

// ── LLM client mock factory ───────────────────────────────────────────────────

export interface LLMMockConfig {
  content: string;
  toolCalls?: Array<{ id: string; type: string; function: { name: string; arguments: string } }>;
  model?: string;
  latency?: number;
}

export function createLLMClientMock(defaultConfig: LLMMockConfig) {
  const mock = {
    chat: {
      completions: {
        create: vi.fn().mockImplementation(async (params: { model?: string }) => {
          if (defaultConfig.latency) {
            await new Promise((r) => setTimeout(r, defaultConfig.latency));
          }
          return {
            id: `chatcmpl-${Date.now()}`,
            object: 'chat.completion',
            model: params.model ?? defaultConfig.model ?? 'test-model',
            choices: [
              {
                index: 0,
                message: {
                  role: 'assistant',
                  content: defaultConfig.content,
                  ...(defaultConfig.toolCalls ? { tool_calls: defaultConfig.toolCalls } : {}),
                },
                finish_reason: defaultConfig.toolCalls ? 'tool_calls' : 'stop',
              },
            ],
            usage: { prompt_tokens: 100, completion_tokens: 80, total_tokens: 180 },
          };
        }),
      },
    },
    embeddings: {
      create: vi.fn().mockResolvedValue({
        data: [{ embedding: Array.from({ length: 1536 }, () => Math.random()), index: 0 }],
        model: 'text-embedding-3-small',
        usage: { prompt_tokens: 10, total_tokens: 10 },
      }),
    },
  };
  return mock;
}

// ── Streaming mock ────────────────────────────────────────────────────────────

export function createStreamingMock(chunks: string[]) {
  const encoder = new TextEncoder();
  let i = 0;

  const readable = new ReadableStream({
    pull(controller) {
      if (i < chunks.length) {
        const data = `data: ${JSON.stringify({
          id: 'chatcmpl-stream',
          object: 'chat.completion.chunk',
          choices: [{ delta: { content: chunks[i++] }, finish_reason: null }],
        })}\n\n`;
        controller.enqueue(encoder.encode(data));
      } else {
        controller.enqueue(encoder.encode('data: [DONE]\n\n'));
        controller.close();
      }
    },
  });

  return readable;
}

// ── Tool call mock builder ────────────────────────────────────────────────────

export function buildToolCallMock(name: string, args: Record<string, unknown>) {
  return [
    {
      id: `call_${name}_${Date.now()}`,
      type: 'function',
      function: {
        name,
        arguments: JSON.stringify(args),
      },
    },
  ];
}

// ── Database mock ─────────────────────────────────────────────────────────────

export function createDbMock() {
  return {
    query: vi.fn(),
    insert: vi.fn().mockReturnThis(),
    values: vi.fn().mockReturnThis(),
    returning: vi.fn().mockResolvedValue([{ id: 1 }]),
    select: vi.fn().mockReturnThis(),
    from: vi.fn().mockReturnThis(),
    where: vi.fn().mockReturnThis(),
    limit: vi.fn().mockResolvedValue([]),
    update: vi.fn().mockReturnThis(),
    set: vi.fn().mockReturnThis(),
    delete: vi.fn().mockReturnThis(),
    transaction: vi.fn().mockImplementation((fn: (tx: unknown) => Promise<unknown>) => fn({})),
  };
}

// ── Request / Response mocks ──────────────────────────────────────────────────

export function createMockReq(overrides: Record<string, unknown> = {}) {
  return {
    user: { id: 1, email: 'test@example.com', role: 'user' },
    body: {},
    params: {},
    query: {},
    headers: { 'content-type': 'application/json' },
    ...overrides,
  };
}

export function createMockRes() {
  const res = {
    status: vi.fn().mockReturnThis(),
    json: vi.fn().mockReturnThis(),
    send: vi.fn().mockReturnThis(),
    setHeader: vi.fn().mockReturnThis(),
    write: vi.fn().mockReturnThis(),
    end: vi.fn().mockReturnThis(),
    locals: {},
  };
  return res;
}

// ── Assertion helpers ─────────────────────────────────────────────────────────

export function expectValidJson(value: unknown): Record<string, unknown> {
  if (typeof value === 'string') {
    return JSON.parse(value) as Record<string, unknown>;
  }
  if (typeof value === 'object' && value !== null) {
    return value as Record<string, unknown>;
  }
  throw new Error(`Expected JSON, got: ${typeof value}`);
}

export function expectWithinRange(value: number, min: number, max: number): void {
  if (value < min || value > max) {
    throw new Error(`Expected ${value} to be within [${min}, ${max}]`);
  }
}

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
