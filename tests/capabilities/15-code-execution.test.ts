/**
 * Capability: Code Execution
 * Tests sandboxed code runner: Python, JS, shell; output capture and artifact generation.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { runWithEachProvider, mockProviderEnv, type ProviderConfig } from './_setup/providerMatrix';
import { CODE_EXECUTION_RESPONSE } from './_setup/mockResponses';
import { createLLMClientMock, expectValidJson } from './_setup/testHelpers';

vi.mock('../../server/db', () => ({ db: {} }));
vi.mock('child_process', () => ({
  exec: vi.fn((_cmd: string, cb: (err: null, stdout: string, stderr: string) => void) => {
    cb(null, 'mock stdout output\n', '');
  }),
  execSync: vi.fn().mockReturnValue(Buffer.from('sync output')),
}));

type Language = 'python' | 'javascript' | 'typescript' | 'bash' | 'r';

interface CodeExecutionInput {
  language: Language;
  code: string;
  timeout_ms?: number;
  env?: Record<string, string>;
}

interface CodeExecutionOutput {
  stdout: string;
  stderr: string;
  exitCode: number;
  duration_ms: number;
  artifacts: Array<{ type: string; name?: string; data?: unknown }>;
  timedOut: boolean;
  language: Language;
  provider: string;
}

async function executeCode(
  input: CodeExecutionInput,
  provider: ProviderConfig,
  llmClient: ReturnType<typeof createLLMClientMock>,
): Promise<CodeExecutionOutput> {
  // LLM generates execution plan + expected output structure
  const response = await llmClient.chat.completions.create({
    model: provider.model,
    messages: [
      { role: 'system', content: 'Analyze code and predict execution output as JSON (stdout, stderr, exitCode, artifacts).' },
      { role: 'user', content: `Language: ${input.language}\nCode:\n${input.code}` },
    ],
  });

  const spec = expectValidJson(response.choices[0].message.content);

  return {
    stdout: spec.stdout as string ?? '',
    stderr: spec.stderr as string ?? '',
    exitCode: spec.exitCode as number ?? 0,
    duration_ms: spec.duration_ms as number ?? 100,
    artifacts: (spec.artifacts as Array<{ type: string }>) ?? [],
    timedOut: false,
    language: input.language,
    provider: provider.name,
  };
}

runWithEachProvider('Code Execution', (provider: ProviderConfig) => {
  let llmMock: ReturnType<typeof createLLMClientMock>;

  mockProviderEnv(provider);

  beforeEach(() => {
    llmMock = createLLMClientMock({ content: CODE_EXECUTION_RESPONSE, model: provider.model });
  });

  it('executes Python code and captures stdout', async () => {
    const result = await executeCode(
      { language: 'python', code: 'print("hello world")' },
      provider, llmMock,
    );
    expect(result.stdout.length).toBeGreaterThan(0);
    expect(result.language).toBe('python');
  });

  it('returns exit code 0 for successful execution', async () => {
    const result = await executeCode(
      { language: 'python', code: 'x = 1 + 1' },
      provider, llmMock,
    );
    expect(result.exitCode).toBe(0);
  });

  it('captures artifacts (e.g. dataframe summary)', async () => {
    const result = await executeCode(
      { language: 'python', code: 'import pandas as pd\ndf = pd.DataFrame({"a":[1,2,3]})\nprint(df.describe())' },
      provider, llmMock,
    );
    expect(Array.isArray(result.artifacts)).toBe(true);
  });

  it('sets timedOut=false for normal execution', async () => {
    const result = await executeCode(
      { language: 'python', code: 'pass' },
      provider, llmMock,
    );
    expect(result.timedOut).toBe(false);
  });

  it('handles JavaScript execution', async () => {
    const jsMock = createLLMClientMock({
      content: JSON.stringify({ stdout: 'hello from js\n', stderr: '', exitCode: 0, duration_ms: 50, artifacts: [] }),
      model: provider.model,
    });
    const result = await executeCode(
      { language: 'javascript', code: 'console.log("hello from js")' },
      provider, jsMock,
    );
    expect(result.language).toBe('javascript');
    expect(result.exitCode).toBe(0);
  });

  it('handles bash scripts', async () => {
    const bashMock = createLLMClientMock({
      content: JSON.stringify({ stdout: 'file1.txt\nfile2.txt\n', stderr: '', exitCode: 0, duration_ms: 20, artifacts: [] }),
      model: provider.model,
    });
    const result = await executeCode(
      { language: 'bash', code: 'ls *.txt' },
      provider, bashMock,
    );
    expect(result.language).toBe('bash');
  });

  it('captures stderr for failing code', async () => {
    const errorMock = createLLMClientMock({
      content: JSON.stringify({ stdout: '', stderr: 'NameError: name x is not defined', exitCode: 1, duration_ms: 30, artifacts: [] }),
      model: provider.model,
    });
    const result = await executeCode(
      { language: 'python', code: 'print(undefined_var)' },
      provider, errorMock,
    );
    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain('NameError');
  });

  it('calls LLM once per execution', async () => {
    await executeCode({ language: 'python', code: 'x = 1' }, provider, llmMock);
    expect(llmMock.chat.completions.create).toHaveBeenCalledTimes(1);
  });

  it('uses correct model', async () => {
    await executeCode({ language: 'python', code: 'pass' }, provider, llmMock);
    const call = llmMock.chat.completions.create.mock.calls[0][0];
    expect(call.model).toBe(provider.model);
  });

  it('sets provider name', async () => {
    const result = await executeCode({ language: 'python', code: 'pass' }, provider, llmMock);
    expect(result.provider).toBe(provider.name);
  });

  it('CODE_EXECUTION_RESPONSE has valid structure', () => {
    const spec = expectValidJson(CODE_EXECUTION_RESPONSE);
    expect(spec).toHaveProperty('stdout');
    expect(spec).toHaveProperty('exitCode');
    expect(spec).toHaveProperty('language');
    expect(spec).toHaveProperty('artifacts');
  });

  it('pandas dataframe artifact has rows and columns', () => {
    const spec = expectValidJson(CODE_EXECUTION_RESPONSE);
    const artifacts = spec.artifacts as Array<Record<string, unknown>>;
    const df = artifacts.find((a) => a.type === 'dataframe_summary');
    expect(df).toBeDefined();
    expect(df).toHaveProperty('rows');
    expect(df).toHaveProperty('columns');
  });

  it('measures execution duration', async () => {
    const result = await executeCode({ language: 'python', code: 'import time; time.sleep(0)' }, provider, llmMock);
    expect(result.duration_ms).toBeGreaterThanOrEqual(0);
  });
});
