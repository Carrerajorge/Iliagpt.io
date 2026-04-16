import path from 'path';

export interface ExecPolicyConfig {
  safeBins: string[];
  security: 'ask' | 'warn' | 'allow';
  timeout: number;
}

export class ToolPolicyEngine {
  private safeBinsSet: Set<string>;
  private config: ExecPolicyConfig;

  constructor(config: ExecPolicyConfig) {
    this.config = config;
    this.safeBinsSet = new Set(config.safeBins.map(b => b.toLowerCase()));
  }

  get security() { return this.config.security; }
  get timeout() { return this.config.timeout; }

  isCommandAllowed(command: string): { allowed: boolean; binary: string; reason?: string } {
    const trimmed = command.trim();
    const tokens = trimmed.split(/\s+/);

    // Skip env var prefixes (e.g. FOO=bar command)
    let idx = 0;
    while (idx < tokens.length && tokens[idx].includes('=')) idx++;
    const binaryToken = idx < tokens.length ? tokens[idx] : tokens[0];

    // Handle path-qualified binaries
    const binary = path.basename(binaryToken).toLowerCase();

    if (!this.safeBinsSet.has(binary)) {
      return { allowed: false, binary, reason: `Binary '${binary}' is not in safe-bins allowlist` };
    }

    // Block dangerous patterns regardless of binary
    const dangerousPatterns = [
      /rm\s+(-rf?|--recursive).*\//,
      />\s*\/dev\/sd/,
      /mkfs\./,
      /dd\s+if=/,
      /:\(\)\s*\{\s*:\|:\s*&\s*\}/,
    ];

    for (const pattern of dangerousPatterns) {
      if (pattern.test(trimmed)) {
        return { allowed: false, binary, reason: 'Command matches a dangerous pattern' };
      }
    }

    return { allowed: true, binary };
  }

  isPathAllowed(filepath: string, workspaceRoot: string): boolean {
    const resolved = path.resolve(filepath);
    const wsResolved = path.resolve(workspaceRoot);
    return resolved.startsWith(wsResolved);
  }
}
