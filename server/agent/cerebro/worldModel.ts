export interface FileModification {
  path: string;
  action: 'created' | 'modified' | 'deleted' | 'read';
  timestamp: number;
}

export interface CommandExecution {
  command: string;
  exitCode: number;
  timestamp: number;
}

export interface Discovery {
  key: string;
  value: string;
  source: string;
  timestamp: number;
}

export interface EnvironmentState {
  workingDirectory: string;
  filesModified: FileModification[];
  commandsRun: CommandExecution[];
  discoveries: Discovery[];
  errors: string[];
  toolCallCount: number;
  tokensSoFar: number;
  startedAt: number;
}

export interface SubtaskState {
  id: string;
  label: string;
  status: 'pending' | 'running' | 'completed' | 'failed' | 'retrying';
  retries: number;
  result?: string;
  error?: string;
  startedAt?: number;
  completedAt?: number;
}

export class CerebroWorldModel {
  private env: EnvironmentState;
  private subtasks: Map<string, SubtaskState> = new Map();

  constructor() {
    this.env = {
      workingDirectory: process.cwd(),
      filesModified: [],
      commandsRun: [],
      discoveries: [],
      errors: [],
      toolCallCount: 0,
      tokensSoFar: 0,
      startedAt: Date.now(),
    };
  }

  recordFileModification(path: string, action: FileModification['action']): void {
    this.env.filesModified.push({ path, action, timestamp: Date.now() });
  }

  recordCommandExecution(command: string, exitCode: number): void {
    this.env.commandsRun.push({ command, exitCode, timestamp: Date.now() });
  }

  recordDiscovery(key: string, value: string, source: string): void {
    const existing = this.env.discoveries.findIndex(d => d.key === key);
    if (existing >= 0) {
      this.env.discoveries[existing] = { key, value, source, timestamp: Date.now() };
    } else {
      this.env.discoveries.push({ key, value, source, timestamp: Date.now() });
    }
  }

  recordError(error: string): void {
    this.env.errors.push(error);
  }

  incrementToolCalls(): void {
    this.env.toolCallCount++;
  }

  addTokens(count: number): void {
    this.env.tokensSoFar += count;
  }

  registerSubtask(id: string, label: string): void {
    this.subtasks.set(id, {
      id,
      label,
      status: 'pending',
      retries: 0,
    });
  }

  updateSubtask(id: string, update: Partial<SubtaskState>): void {
    const existing = this.subtasks.get(id);
    if (existing) {
      this.subtasks.set(id, { ...existing, ...update });
    }
  }

  getSubtask(id: string): SubtaskState | undefined {
    return this.subtasks.get(id);
  }

  getAllSubtasks(): SubtaskState[] {
    return Array.from(this.subtasks.values());
  }

  getEnvironment(): EnvironmentState {
    return { ...this.env };
  }

  getSnapshot(): string {
    const subtaskList = this.getAllSubtasks();
    const completedCount = subtaskList.filter(s => s.status === 'completed').length;
    const failedCount = subtaskList.filter(s => s.status === 'failed').length;

    const lines: string[] = [
      `[World Model Snapshot]`,
      `Elapsed: ${Math.round((Date.now() - this.env.startedAt) / 1000)}s`,
      `Tool calls: ${this.env.toolCallCount}`,
      `Tokens used: ${this.env.tokensSoFar}`,
      `Files modified: ${this.env.filesModified.length}`,
      `Commands run: ${this.env.commandsRun.length}`,
      `Discoveries: ${this.env.discoveries.length}`,
      `Errors: ${this.env.errors.length}`,
      `Subtasks: ${completedCount}/${subtaskList.length} completed, ${failedCount} failed`,
    ];

    if (this.env.discoveries.length > 0) {
      lines.push(`Key discoveries:`);
      for (const d of this.env.discoveries.slice(-5)) {
        lines.push(`  - ${d.key}: ${d.value.substring(0, 100)}`);
      }
    }

    if (this.env.errors.length > 0) {
      lines.push(`Recent errors:`);
      for (const e of this.env.errors.slice(-3)) {
        lines.push(`  - ${e.substring(0, 100)}`);
      }
    }

    return lines.join('\n');
  }

  updateFromToolResult(toolName: string, args: Record<string, any>, result: any): void {
    this.incrementToolCalls();

    if (toolName === 'write_file' || toolName === 'edit_file') {
      this.recordFileModification(args.file_path || args.filepath || 'unknown', 'modified');
    } else if (toolName === 'read_file') {
      this.recordFileModification(args.filepath || args.file_path || 'unknown', 'read');
    } else if (toolName === 'bash' || toolName === 'run_code') {
      const cmd = args.command || args.code || '';
      const exitCode = typeof result?.exitCode === 'number' ? result.exitCode : 0;
      this.recordCommandExecution(cmd.substring(0, 200), exitCode);
    } else if (toolName === 'web_search') {
      const resultCount = Array.isArray(result) ? result.length : 0;
      this.recordDiscovery(`search:${args.query?.substring(0, 50)}`, `${resultCount} results`, 'web_search');
    } else if (toolName === 'fetch_url') {
      this.recordDiscovery(`url:${args.url?.substring(0, 80)}`, 'fetched', 'fetch_url');
    }

    if (result?.error) {
      this.recordError(`${toolName}: ${String(result.error).substring(0, 200)}`);
    }
  }
}
