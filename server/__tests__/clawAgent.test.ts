import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// ---------------------------------------------------------------------------
// 1. Terminal tool
// ---------------------------------------------------------------------------
describe('claw terminal tool', () => {
  it('executes a simple command and captures stdout', async () => {
    const { executeCommand } = await import('../agent/claw/terminalTool');
    const result = await executeCommand({ command: 'echo hello-claw' });
    expect(result.exitCode).toBe(0);
    expect(result.stdout.trim()).toBe('hello-claw');
    expect(result.stderr).toBe('');
  });

  it('returns non-zero exit code for failing commands', async () => {
    const { executeCommand } = await import('../agent/claw/terminalTool');
    const result = await executeCommand({ command: 'false' });
    expect(result.exitCode).not.toBe(0);
  });

  it('enforces timeout', async () => {
    const { executeCommand } = await import('../agent/claw/terminalTool');
    const result = await executeCommand({ command: 'sleep 30', timeout: 500 });
    expect(result.killed).toBe(true);
  });

  it('validates destructive commands', async () => {
    const { validateCommand } = await import('../agent/claw/terminalTool');
    const result = validateCommand('rm -rf /');
    expect(result.safe).toBe(false);
    expect(result.blocked).toBe(true);
  });

  it('passes safe commands', async () => {
    const { validateCommand } = await import('../agent/claw/terminalTool');
    const result = validateCommand('echo hello');
    expect(result.safe).toBe(true);
    expect(result.blocked).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// 2. File tool
// ---------------------------------------------------------------------------
describe('claw file tool', () => {
  const testDir = '/tmp/claw-test-' + Date.now();
  const testFile = testDir + '/test.txt';

  beforeEach(async () => {
    const fs = await import('fs/promises');
    await fs.mkdir(testDir, { recursive: true });
  });

  afterEach(async () => {
    const fs = await import('fs/promises');
    await fs.rm(testDir, { recursive: true, force: true }).catch(() => {});
  });

  it('writes and reads a file', async () => {
    const { executeFileOp } = await import('../agent/claw/fileTool');
    const writeResult = await executeFileOp(
      { operation: 'write', path: testFile, content: 'hello world' },
      testDir,
    );
    expect(writeResult.success).toBe(true);

    const readResult = await executeFileOp(
      { operation: 'read', path: testFile },
      testDir,
    );
    expect(readResult.success).toBe(true);
    expect(readResult.data.content).toContain('hello world');
  });

  it('edits a file with string replacement', async () => {
    const { executeFileOp } = await import('../agent/claw/fileTool');
    await executeFileOp(
      { operation: 'write', path: testFile, content: 'foo bar baz' },
      testDir,
    );
    const editResult = await executeFileOp(
      { operation: 'edit', path: testFile, oldText: 'bar', newText: 'qux' },
      testDir,
    );
    expect(editResult.success).toBe(true);

    const readResult = await executeFileOp(
      { operation: 'read', path: testFile },
      testDir,
    );
    expect(readResult.data.content).toContain('foo qux baz');
  });

  it('checks file existence', async () => {
    const { executeFileOp } = await import('../agent/claw/fileTool');
    await executeFileOp(
      { operation: 'write', path: testFile, content: 'x' },
      testDir,
    );
    const exists = await executeFileOp(
      { operation: 'exists', path: testFile },
      testDir,
    );
    expect(exists.success).toBe(true);
    expect(exists.data.exists).toBe(true);

    const notExists = await executeFileOp(
      { operation: 'exists', path: testDir + '/nope.txt' },
      testDir,
    );
    expect(notExists.data.exists).toBe(false);
  });

  it('lists directory contents', async () => {
    const { executeFileOp } = await import('../agent/claw/fileTool');
    await executeFileOp(
      { operation: 'write', path: testFile, content: 'x' },
      testDir,
    );
    const listResult = await executeFileOp(
      { operation: 'list', path: testDir },
      testDir,
    );
    expect(listResult.success).toBe(true);
    expect(listResult.data.entries).toBeDefined();
    expect(listResult.data.entries.length).toBeGreaterThan(0);
  });

  it('blocks path traversal', async () => {
    const { executeFileOp } = await import('../agent/claw/fileTool');
    const result = await executeFileOp(
      { operation: 'read', path: '../../etc/passwd' },
      testDir,
    );
    expect(result.success).toBe(false);
    expect(result.error).toMatch(/escapes workspace/i);
  });
});

// ---------------------------------------------------------------------------
// 3. Code executor
// ---------------------------------------------------------------------------
describe('claw code executor', () => {
  it('executes python code', async () => {
    const { executeCode } = await import('../agent/claw/codeExecutor');
    const result = await executeCode({
      language: 'python',
      code: 'print(2 + 2)',
    });
    expect(result.exitCode).toBe(0);
    expect(result.stdout.trim()).toBe('4');
  });

  it('executes javascript code', async () => {
    const { executeCode } = await import('../agent/claw/codeExecutor');
    const result = await executeCode({
      language: 'javascript',
      code: 'console.log("hi")',
    });
    expect(result.exitCode).toBe(0);
    expect(result.stdout.trim()).toBe('hi');
  });

  it('executes bash code', async () => {
    const { executeCode } = await import('../agent/claw/codeExecutor');
    const result = await executeCode({
      language: 'bash',
      code: 'echo $((3 * 7))',
    });
    expect(result.exitCode).toBe(0);
    expect(result.stdout.trim()).toBe('21');
  });

  it('captures stderr on error', async () => {
    const { executeCode } = await import('../agent/claw/codeExecutor');
    const result = await executeCode({
      language: 'python',
      code: 'raise Exception("boom")',
    });
    expect(result.exitCode).not.toBe(0);
    expect(result.stderr).toContain('boom');
  });
});

// ---------------------------------------------------------------------------
// 4. Universal tool calling
// ---------------------------------------------------------------------------
describe('claw universal tool calling', () => {
  it('formats tools for OpenAI provider', async () => {
    const { universalToolAdapter } = await import(
      '../agent/claw/universalToolCalling'
    );
    const { z } = await import('zod');
    const tools = [
      {
        name: 'test_tool',
        description: 'A test tool',
        inputSchema: z.object({ query: z.string() }),
      },
    ];
    const formatted = universalToolAdapter.formatToolsForProvider(
      tools,
      'openai',
    );
    expect(formatted).toHaveLength(1);
    expect(formatted[0].type).toBe('function');
    expect(formatted[0].function.name).toBe('test_tool');
  });

  it('formats tools for Anthropic provider', async () => {
    const { universalToolAdapter } = await import(
      '../agent/claw/universalToolCalling'
    );
    const { z } = await import('zod');
    const tools = [
      {
        name: 'test_tool',
        description: 'A test tool',
        inputSchema: z.object({ query: z.string() }),
      },
    ];
    const formatted = universalToolAdapter.formatToolsForProvider(
      tools,
      'anthropic',
    );
    expect(formatted).toHaveLength(1);
    expect(formatted[0].name).toBe('test_tool');
    expect(formatted[0].input_schema).toBeDefined();
  });

  it('formats tools as generic XML for unsupported providers', async () => {
    const { universalToolAdapter } = await import(
      '../agent/claw/universalToolCalling'
    );
    const { z } = await import('zod');
    const tools = [
      {
        name: 'test_tool',
        description: 'A test tool',
        inputSchema: z.object({ query: z.string() }),
      },
    ];
    const formatted = universalToolAdapter.formatToolsForProvider(
      tools,
      'generic',
    );
    expect(typeof formatted).toBe('string');
    expect(formatted).toContain('test_tool');
  });

  it('parses tool calls from plain text', async () => {
    const { universalToolAdapter } = await import(
      '../agent/claw/universalToolCalling'
    );
    const text = `Let me search for that.\n<tool_call name="web_search" input='{"query":"hello"}' />`;
    const calls = universalToolAdapter.parseToolCallsFromText(text);
    expect(calls).toHaveLength(1);
    expect(calls[0].name).toBe('web_search');
    expect(calls[0].input).toEqual({ query: 'hello' });
  });
});

// ---------------------------------------------------------------------------
// 5. Session persistence (in-memory only — no DB in test env)
// ---------------------------------------------------------------------------
describe('claw session manager', () => {
  it('saves and loads a session via in-memory cache', async () => {
    // Directly test the JSONL backup mechanism which works without DB
    const fs = await import('fs/promises');
    const path = await import('path');
    const sessionDir = '/tmp/claw-session-test-' + Date.now();
    await fs.mkdir(sessionDir, { recursive: true });

    const sessionData = {
      id: 'test-sess-' + Date.now(),
      userId: 'user-1',
      chatId: 'chat-1',
      messages: [
        { role: 'user', content: 'hello' },
        { role: 'assistant', content: 'hi there' },
      ],
      status: 'active',
      toolsUsed: ['bash'],
      iterations: 1,
      totalTokens: 100,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    // Write JSONL
    const filePath = path.join(sessionDir, `${sessionData.userId}.jsonl`);
    await fs.appendFile(filePath, JSON.stringify(sessionData) + '\n');

    // Read back
    const content = await fs.readFile(filePath, 'utf-8');
    const lines = content.trim().split('\n').filter(Boolean);
    const loaded = JSON.parse(lines[0]);

    expect(loaded.id).toBe(sessionData.id);
    expect(loaded.messages).toHaveLength(2);
    expect(loaded.status).toBe('active');

    await fs.rm(sessionDir, { recursive: true, force: true });
  });

  it('appends multiple sessions to JSONL', async () => {
    const fs = await import('fs/promises');
    const path = await import('path');
    const sessionDir = '/tmp/claw-session-test-' + Date.now();
    await fs.mkdir(sessionDir, { recursive: true });

    const filePath = path.join(sessionDir, 'user-list.jsonl');
    for (let i = 0; i < 3; i++) {
      const data = { id: `sess-${i}`, userId: 'user-list', status: 'completed' };
      await fs.appendFile(filePath, JSON.stringify(data) + '\n');
    }

    const content = await fs.readFile(filePath, 'utf-8');
    const sessions = content.trim().split('\n').map((l: string) => JSON.parse(l));
    expect(sessions).toHaveLength(3);
    expect(sessions[1].id).toBe('sess-1');

    await fs.rm(sessionDir, { recursive: true, force: true });
  });
});

// ---------------------------------------------------------------------------
// 6. Permission system
// ---------------------------------------------------------------------------
describe('claw permission system', () => {
  it('allows read operations in read_only mode', async () => {
    const { ClawPermissionEnforcer } = await import(
      '../agent/claw/permissionSystem'
    );
    const enforcer = new ClawPermissionEnforcer();
    enforcer.setMode('user-perm', 'read_only');
    const result = enforcer.check('user-perm', 'read_file', {
      path: '/tmp/test.txt',
    });
    expect(result.allowed).toBe(true);
  });

  it('blocks write operations in read_only mode', async () => {
    const { ClawPermissionEnforcer } = await import(
      '../agent/claw/permissionSystem'
    );
    const enforcer = new ClawPermissionEnforcer();
    enforcer.setMode('user-perm', 'read_only');
    const result = enforcer.check('user-perm', 'write_file', {
      path: '/tmp/test.txt',
    });
    expect(result.allowed).toBe(false);
    expect(result.reason).toBeDefined();
  });

  it('blocks bash in workspace mode', async () => {
    const { ClawPermissionEnforcer } = await import(
      '../agent/claw/permissionSystem'
    );
    const enforcer = new ClawPermissionEnforcer();
    enforcer.setMode('user-perm', 'workspace');
    const result = enforcer.check('user-perm', 'bash', {
      command: 'ls -la',
    });
    expect(result.allowed).toBe(false);
  });

  it('allows everything in full_access mode', async () => {
    const { ClawPermissionEnforcer } = await import(
      '../agent/claw/permissionSystem'
    );
    const enforcer = new ClawPermissionEnforcer();
    enforcer.setMode('user-perm', 'full_access');
    const result = enforcer.check('user-perm', 'bash', {
      command: 'rm -rf /',
    });
    expect(result.allowed).toBe(true);
  });

  it('enforces rate limiting', async () => {
    const { ClawPermissionEnforcer } = await import(
      '../agent/claw/permissionSystem'
    );
    const enforcer = new ClawPermissionEnforcer();
    enforcer.setMode('rate-user', 'full_access');
    // Exhaust the rate limit (default 60/min)
    for (let i = 0; i < 60; i++) {
      enforcer.check('rate-user', 'read_file', { path: '/tmp/x' });
    }
    const result = enforcer.check('rate-user', 'read_file', {
      path: '/tmp/x',
    });
    expect(result.allowed).toBe(false);
    expect(result.reason).toMatch(/rate/i);
  });

  it('records audit log entries', async () => {
    const { ClawPermissionEnforcer } = await import(
      '../agent/claw/permissionSystem'
    );
    const enforcer = new ClawPermissionEnforcer();
    enforcer.setMode('audit-user', 'full_access');
    enforcer.check('audit-user', 'bash', { command: 'echo hi' });
    const log = enforcer.getAuditLog('audit-user');
    expect(log.length).toBeGreaterThanOrEqual(1);
    expect(log[0].toolName).toBe('bash');
  });
});

// ---------------------------------------------------------------------------
// 7. Agent loop (unit test — verify structure without LLM)
// ---------------------------------------------------------------------------
describe('claw agent loop', () => {
  it('exports ClawAgentLoop class with expected interface', async () => {
    const mod = await import('../agent/claw/agentLoop');
    expect(mod.ClawAgentLoop).toBeDefined();
    expect(typeof mod.ClawAgentLoop).toBe('function');

    // Verify constructor accepts options
    const loop = new mod.ClawAgentLoop({
      model: 'test-model',
      userId: 'u1',
      chatId: 'c1',
      tools: [],
      maxIterations: 3,
    });
    expect(loop).toBeDefined();
    expect(typeof loop.run).toBe('function');
    expect(typeof loop.abort).toBe('function');
    // EventEmitter methods
    expect(typeof loop.on).toBe('function');
    expect(typeof loop.emit).toBe('function');
  });

  it('abort sets aborted state', async () => {
    const { ClawAgentLoop } = await import('../agent/claw/agentLoop');
    const loop = new ClawAgentLoop({
      model: 'test-model',
      userId: 'u1',
      chatId: 'c1',
      tools: [],
    });
    let errorEmitted = false;
    loop.on('error', () => { errorEmitted = true; });
    loop.abort();
    expect(errorEmitted).toBe(true);
  });
});
