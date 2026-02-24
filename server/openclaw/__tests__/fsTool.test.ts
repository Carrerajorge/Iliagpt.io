import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createFsTools } from '../tools/fsTool';
import fs from 'fs/promises';
import path from 'path';
import os from 'os';

describe('FS Tools', () => {
  let workspaceRoot: string;
  let tools: ReturnType<typeof createFsTools>;
  const ctx = { userId: 'test', chatId: 'c1', runId: 'r1' } as any;

  beforeEach(async () => {
    workspaceRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'oclw-test-'));
    tools = createFsTools(workspaceRoot, true);
  });

  afterEach(async () => {
    await fs.rm(workspaceRoot, { recursive: true, force: true });
  });

  it('reads files within workspace', async () => {
    await fs.writeFile(path.join(workspaceRoot, 'test.txt'), 'hello world');
    const readTool = tools.find(t => t.name === 'openclaw_read');
    const result = await readTool!.execute({ path: 'test.txt' }, ctx);
    expect(result.success).toBe(true);
    expect(result.output).toBe('hello world');
  });

  it('writes files within workspace', async () => {
    const writeTool = tools.find(t => t.name === 'openclaw_write');
    const result = await writeTool!.execute({ path: 'out.txt', content: 'new content' }, ctx);
    expect(result.success).toBe(true);
    const content = await fs.readFile(path.join(workspaceRoot, 'out.txt'), 'utf-8');
    expect(content).toBe('new content');
  });

  it('blocks reads outside workspace when workspaceOnly=true', async () => {
    const readTool = tools.find(t => t.name === 'openclaw_read');
    const result = await readTool!.execute({ path: '/etc/passwd' }, ctx);
    expect(result.success).toBe(false);
    expect(result.error?.code).toBe('BLOCKED');
  });

  it('edits files with search-and-replace', async () => {
    await fs.writeFile(path.join(workspaceRoot, 'edit-me.txt'), 'foo bar baz');
    const editTool = tools.find(t => t.name === 'openclaw_edit');
    const result = await editTool!.execute({
      path: 'edit-me.txt',
      oldText: 'bar',
      newText: 'qux',
    }, ctx);
    expect(result.success).toBe(true);
    const content = await fs.readFile(path.join(workspaceRoot, 'edit-me.txt'), 'utf-8');
    expect(content).toBe('foo qux baz');
  });

  it('lists files in workspace', async () => {
    await fs.writeFile(path.join(workspaceRoot, 'a.txt'), '');
    await fs.writeFile(path.join(workspaceRoot, 'b.txt'), '');
    await fs.mkdir(path.join(workspaceRoot, 'subdir'));

    const listTool = tools.find(t => t.name === 'openclaw_list');
    const result = await listTool!.execute({ path: '.' }, ctx);
    expect(result.success).toBe(true);
    expect(Array.isArray(result.output)).toBe(true);
    const names = (result.output as any[]).map((e: any) => e.name);
    expect(names).toContain('a.txt');
    expect(names).toContain('b.txt');
    expect(names).toContain('subdir');
  });

  it('creates nested directories on write', async () => {
    const writeTool = tools.find(t => t.name === 'openclaw_write');
    const result = await writeTool!.execute({
      path: 'deep/nested/dir/file.txt',
      content: 'nested content',
    }, ctx);
    expect(result.success).toBe(true);
    const content = await fs.readFile(
      path.join(workspaceRoot, 'deep/nested/dir/file.txt'), 'utf-8',
    );
    expect(content).toBe('nested content');
  });

  it('supports read with offset and limit', async () => {
    await fs.writeFile(
      path.join(workspaceRoot, 'lines.txt'),
      'line0\nline1\nline2\nline3\nline4',
    );
    const readTool = tools.find(t => t.name === 'openclaw_read');
    const result = await readTool!.execute({ path: 'lines.txt', offset: 1, limit: 2 }, ctx);
    expect(result.success).toBe(true);
    expect(result.output).toBe('line1\nline2');
  });
});
