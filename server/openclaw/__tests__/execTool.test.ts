import { describe, it, expect } from 'vitest';
import { createExecTool } from '../tools/execTool';
import { ToolPolicyEngine } from '../tools/toolPolicies';

describe('Exec Tool', () => {
  const policy = new ToolPolicyEngine({
    safeBins: ['echo', 'ls', 'cat', 'python3', 'sh'],
    security: 'allow',
    timeout: 5000,
  });

  const ctx = { userId: 'test', chatId: 'c1', runId: 'r1' } as any;

  it('executes allowed commands', async () => {
    const tool = createExecTool(policy, '/tmp/oclw-test-exec');
    const result = await tool.execute({ command: 'echo hello' }, ctx);
    expect(result.success).toBe(true);
    expect(result.output).toContain('hello');
  });

  it('blocks commands not in safe-bins', async () => {
    const tool = createExecTool(policy, '/tmp/oclw-test-exec');
    const result = await tool.execute({ command: 'rm -rf /' }, ctx);
    expect(result.success).toBe(false);
    expect(result.error?.code).toBe('BLOCKED');
  });

  it('blocks dangerous patterns even for allowed binaries', async () => {
    const dangerousPolicy = new ToolPolicyEngine({
      safeBins: ['rm'],
      security: 'allow',
      timeout: 5000,
    });
    const tool = createExecTool(dangerousPolicy, '/tmp/oclw-test-exec');
    const result = await tool.execute({ command: 'rm -rf /var' }, ctx);
    expect(result.success).toBe(false);
    expect(result.error?.code).toBe('BLOCKED');
  });

  it('enforces timeout', async () => {
    const shortPolicy = new ToolPolicyEngine({
      safeBins: ['sleep', 'sh'],
      security: 'allow',
      timeout: 500,
    });
    const tool = createExecTool(shortPolicy, '/tmp/oclw-test-exec');
    const result = await tool.execute({ command: 'sleep 10' }, ctx);
    expect(result.success).toBe(false);
    expect(result.error?.code).toBe('TIMEOUT');
  }, 10000);

  it('captures stderr on non-zero exit', async () => {
    const tool = createExecTool(policy, '/tmp/oclw-test-exec');
    const result = await tool.execute({ command: 'sh -c "echo err >&2; exit 1"' }, ctx);
    expect(result.success).toBe(false);
    expect(result.error?.code).toBe('EXIT_CODE');
  });
});

describe('Tool Policy Engine', () => {
  it('allows whitelisted binaries', () => {
    const policy = new ToolPolicyEngine({ safeBins: ['node', 'python'], security: 'allow', timeout: 5000 });
    expect(policy.isCommandAllowed('node script.js').allowed).toBe(true);
    expect(policy.isCommandAllowed('python -c "print(1)"').allowed).toBe(true);
  });

  it('blocks non-whitelisted binaries', () => {
    const policy = new ToolPolicyEngine({ safeBins: ['echo'], security: 'allow', timeout: 5000 });
    const result = policy.isCommandAllowed('wget http://evil.com');
    expect(result.allowed).toBe(false);
    expect(result.binary).toBe('wget');
  });

  it('handles path-qualified binaries', () => {
    const policy = new ToolPolicyEngine({ safeBins: ['python'], security: 'allow', timeout: 5000 });
    expect(policy.isCommandAllowed('/usr/bin/python script.py').allowed).toBe(true);
  });

  it('handles env var prefixes', () => {
    const policy = new ToolPolicyEngine({ safeBins: ['node'], security: 'allow', timeout: 5000 });
    expect(policy.isCommandAllowed('NODE_ENV=production node app.js').allowed).toBe(true);
  });
});
