import path from 'path';
import os from 'os';

export interface OpenClawConfig {
  gateway: { enabled: boolean; path: string };
  tools: {
    enabled: boolean;
    safeBins: string[];
    workspaceRoot: string;
    execTimeout: number;
    execSecurity: 'ask' | 'warn' | 'allow';
  };
  plugins: { enabled: boolean; directory: string };
  skills: {
    enabled: boolean;
    directory: string;
    extraDirectories: string[];
    workspaceDirectory: string;
    includeBuiltins: boolean;
    autoImportClawi: boolean;
    maxSkillFileBytes: number;
  };
  streaming: {
    enabled: boolean;
    blockMinChars: number;
    blockMaxChars: number;
    previewMode: 'off' | 'partial' | 'block' | 'progress';
  };
}

const DEFAULT_SAFE_BINS = [
  'python', 'python3', 'node', 'npm', 'npx', 'pnpm', 'yarn', 'bun',
  'git', 'curl', 'wget', 'jq', 'cat', 'ls', 'find', 'grep', 'sed', 'awk',
  'echo', 'mkdir', 'cp', 'mv', 'rm', 'touch', 'head', 'tail', 'wc',
  'sort', 'uniq', 'diff', 'tar', 'gzip', 'gunzip', 'zip', 'unzip',
  'docker', 'docker-compose', 'make', 'cmake',
];

export function getOpenClawConfig(): OpenClawConfig {
  const workspaceDirectory = process.env.OPENCLAW_WORKSPACE_DIR
    ? path.resolve(process.env.OPENCLAW_WORKSPACE_DIR)
    : process.cwd();
  const defaultSkillsDir = path.join(workspaceDirectory, 'server', 'openclaw', 'skills');
  const legacyHomeSkillsDir = path.join(os.homedir(), '.iliagpt', 'skills');

  return {
    gateway: {
      enabled: process.env.ENABLE_OPENCLAW_GATEWAY === 'true',
      path: process.env.OPENCLAW_WS_PATH || '/ws/openclaw',
    },
    tools: {
      enabled: process.env.ENABLE_OPENCLAW_TOOLS !== 'false',
      safeBins: process.env.OPENCLAW_SAFE_BINS
        ? process.env.OPENCLAW_SAFE_BINS.split(',').map(s => s.trim())
        : DEFAULT_SAFE_BINS,
      workspaceRoot: process.env.OPENCLAW_WORKSPACE_ROOT || '/tmp/openclaw-workspaces',
      execTimeout: Number(process.env.OPENCLAW_EXEC_TIMEOUT) || 120_000,
      execSecurity: (process.env.OPENCLAW_EXEC_SECURITY as any) || 'warn',
    },
    plugins: {
      enabled: process.env.ENABLE_OPENCLAW_PLUGINS === 'true',
      directory: process.env.OPENCLAW_PLUGINS_DIR || '~/.iliagpt/plugins',
    },
    skills: {
      enabled: process.env.ENABLE_OPENCLAW_SKILLS !== 'false',
      directory: process.env.OPENCLAW_SKILLS_DIR
        ? path.resolve(process.env.OPENCLAW_SKILLS_DIR)
        : defaultSkillsDir,
      extraDirectories: process.env.OPENCLAW_SKILLS_EXTRA_DIRS
        ? process.env.OPENCLAW_SKILLS_EXTRA_DIRS.split(',').map(s => s.trim()).filter(Boolean)
        : [legacyHomeSkillsDir],
      workspaceDirectory,
      includeBuiltins: process.env.OPENCLAW_SKILLS_INCLUDE_BUILTINS !== 'false',
      autoImportClawi: process.env.OPENCLAW_SKILLS_AUTO_IMPORT_CLAWI !== 'false',
      maxSkillFileBytes: Number(process.env.OPENCLAW_SKILL_MAX_BYTES) || 256_000,
    },
    streaming: {
      enabled: process.env.ENABLE_OPENCLAW_STREAMING === 'true',
      blockMinChars: Number(process.env.OPENCLAW_BLOCK_MIN_CHARS) || 50,
      blockMaxChars: Number(process.env.OPENCLAW_BLOCK_MAX_CHARS) || 500,
      previewMode: (process.env.OPENCLAW_PREVIEW_MODE as any) || 'partial',
    },
  };
}
