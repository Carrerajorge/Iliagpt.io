import { z } from 'zod';
import fs from 'fs/promises';
import path from 'path';
import type { ToolDefinition, ToolContext, ToolResult } from '../../agent/toolRegistry';

const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10MB

function resolveAndCheck(
  filepath: string,
  workspaceRoot: string,
  workspaceOnly: boolean,
): { resolved: string; allowed: boolean } {
  const resolved = path.isAbsolute(filepath)
    ? filepath
    : path.resolve(workspaceRoot, filepath);

  if (workspaceOnly && !resolved.startsWith(path.resolve(workspaceRoot))) {
    return { resolved, allowed: false };
  }
  return { resolved, allowed: true };
}

export function createFsTools(workspaceRoot: string, workspaceOnly: boolean): ToolDefinition[] {
  const readTool: ToolDefinition = {
    name: 'openclaw_read',
    description: 'Read a file from the agent workspace. Supports text files up to 10MB.',
    inputSchema: z.object({
      path: z.string().describe('File path (relative to workspace or absolute if allowed)'),
      offset: z.number().optional().describe('Line offset to start reading from'),
      limit: z.number().optional().describe('Maximum lines to read'),
    }),
    execute: async (input: any, _ctx: ToolContext): Promise<ToolResult> => {
      const { resolved, allowed } = resolveAndCheck(input.path, workspaceRoot, workspaceOnly);
      if (!allowed) {
        return {
          success: false,
          output: null,
          error: { code: 'BLOCKED', message: 'Path outside workspace', retryable: false },
        };
      }
      try {
        const stat = await fs.stat(resolved);
        if (stat.size > MAX_FILE_SIZE) {
          return {
            success: false,
            output: null,
            error: { code: 'TOO_LARGE', message: `File exceeds ${MAX_FILE_SIZE} bytes`, retryable: false },
          };
        }
        let content = await fs.readFile(resolved, 'utf-8');
        if (input.offset !== undefined || input.limit !== undefined) {
          const lines = content.split('\n');
          const start = input.offset || 0;
          const end = input.limit ? start + input.limit : lines.length;
          content = lines.slice(start, end).join('\n');
        }
        return { success: true, output: content };
      } catch (err: any) {
        return {
          success: false,
          output: null,
          error: { code: 'READ_ERROR', message: err.message, retryable: false },
        };
      }
    },
  };

  const writeTool: ToolDefinition = {
    name: 'openclaw_write',
    description: 'Write or create a file in the agent workspace.',
    inputSchema: z.object({
      path: z.string().describe('File path (relative to workspace)'),
      content: z.string().describe('Content to write'),
    }),
    execute: async (input: any, _ctx: ToolContext): Promise<ToolResult> => {
      const { resolved, allowed } = resolveAndCheck(input.path, workspaceRoot, workspaceOnly);
      if (!allowed) {
        return {
          success: false,
          output: null,
          error: { code: 'BLOCKED', message: 'Path outside workspace', retryable: false },
        };
      }
      try {
        await fs.mkdir(path.dirname(resolved), { recursive: true });
        await fs.writeFile(resolved, input.content, 'utf-8');
        return { success: true, output: `Written ${input.content.length} bytes to ${input.path}` };
      } catch (err: any) {
        return {
          success: false,
          output: null,
          error: { code: 'WRITE_ERROR', message: err.message, retryable: false },
        };
      }
    },
  };

  const editTool: ToolDefinition = {
    name: 'openclaw_edit',
    description: 'Edit a file by replacing a string or applying a regex patch.',
    inputSchema: z.object({
      path: z.string(),
      oldText: z.string().describe('Text to find'),
      newText: z.string().describe('Replacement text'),
      replaceAll: z.boolean().optional().default(false),
    }),
    execute: async (input: any, _ctx: ToolContext): Promise<ToolResult> => {
      const { resolved, allowed } = resolveAndCheck(input.path, workspaceRoot, workspaceOnly);
      if (!allowed) {
        return {
          success: false,
          output: null,
          error: { code: 'BLOCKED', message: 'Path outside workspace', retryable: false },
        };
      }
      try {
        let content = await fs.readFile(resolved, 'utf-8');
        if (!content.includes(input.oldText)) {
          return {
            success: false,
            output: null,
            error: { code: 'NOT_FOUND', message: 'oldText not found in file', retryable: false },
          };
        }
        if (input.replaceAll) {
          content = content.replaceAll(input.oldText, input.newText);
        } else {
          content = content.replace(input.oldText, input.newText);
        }
        await fs.writeFile(resolved, content, 'utf-8');
        return { success: true, output: `Edited ${input.path}` };
      } catch (err: any) {
        return {
          success: false,
          output: null,
          error: { code: 'EDIT_ERROR', message: err.message, retryable: false },
        };
      }
    },
  };

  const listTool: ToolDefinition = {
    name: 'openclaw_list',
    description: 'List files and directories in the agent workspace.',
    inputSchema: z.object({
      path: z.string().optional().default('.'),
      recursive: z.boolean().optional().default(false),
    }),
    execute: async (input: any, _ctx: ToolContext): Promise<ToolResult> => {
      const { resolved, allowed } = resolveAndCheck(input.path || '.', workspaceRoot, workspaceOnly);
      if (!allowed) {
        return {
          success: false,
          output: null,
          error: { code: 'BLOCKED', message: 'Path outside workspace', retryable: false },
        };
      }
      try {
        const entries = await fs.readdir(resolved, { withFileTypes: true });
        const listing = entries.map(e => ({
          name: e.name,
          type: e.isDirectory() ? 'directory' : 'file',
        }));
        return { success: true, output: listing };
      } catch (err: any) {
        return {
          success: false,
          output: null,
          error: { code: 'LIST_ERROR', message: err.message, retryable: false },
        };
      }
    },
  };

  return [readTool, writeTool, editTool, listTool];
}
