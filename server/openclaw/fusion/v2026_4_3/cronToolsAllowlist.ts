import { createLogger } from '../../../utils/logger';
import { ToolPolicyEngine } from '../../tools/toolPolicies';

const log = createLogger('openclaw-cron-allowlist');

const DEFAULT_SAFE_BINS = [
  'node', 'npm', 'npx', 'python', 'python3', 'pip', 'pip3',
  'git', 'curl', 'wget', 'grep', 'sed', 'awk', 'cat', 'echo',
  'ls', 'pwd', 'mkdir', 'cp', 'mv', 'touch', 'find', 'sort',
  'unzip', 'tar', 'gzip', 'gunzip', 'jq', 'yq', 'ffmpeg',
  'convert', 'mogrify', 'pandoc', 'pdftotext', 'wkhtmltopdf',
  'ts-node', 'tsx', 'deno', 'bun',
];

let policyEngine: ToolPolicyEngine | null = null;

const cronAllowlistMap = new Map<string, Set<string>>();

export function initCronToolsAllowlist(extraBins: string[] = []): void {
  const bins = [...new Set([...DEFAULT_SAFE_BINS, ...extraBins])];

  policyEngine = new ToolPolicyEngine({
    safeBins: bins,
    security: 'warn',
    timeout: 30_000,
  });

  log.info(`[OpenClaw:CronAllowlist] Initialized with ${bins.length} safe binaries`);
}

export function registerCronAllowlist(cronId: string, allowedTools: string[]): void {
  cronAllowlistMap.set(cronId, new Set(allowedTools));
  log.debug(`[CronAllowlist] Registered ${allowedTools.length} tools for cron "${cronId}"`);
}

export function isCronToolAllowed(cronId: string, toolId: string): boolean {
  const list = cronAllowlistMap.get(cronId);
  if (!list) return false;
  return list.has(toolId) || list.has('*');
}

export function isCommandAllowedForCron(cronId: string, command: string): boolean {
  if (!policyEngine) return false;
  const result = policyEngine.isCommandAllowed(command);
  if (!result.allowed) {
    log.warn(`[CronAllowlist] Command blocked for cron "${cronId}": ${result.reason}`);
  }
  return result.allowed;
}

export function getAllowlistStats(): { cronCount: number; binCount: number } {
  return {
    cronCount: cronAllowlistMap.size,
    binCount: DEFAULT_SAFE_BINS.length,
  };
}
