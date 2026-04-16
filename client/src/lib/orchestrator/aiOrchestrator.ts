import { commandBus, type CommandResult } from '@/lib/commands';
import { apiFetch } from '@/lib/apiClient';

export interface DocumentPlan {
  intent: string;
  commands: PlannedCommand[];
  validation?: ValidationResult;
}

export interface PlannedCommand {
  name: string;
  payload?: Record<string, unknown>;
  description?: string;
}

export interface ValidationResult {
  valid: boolean;
  errors: string[];
  warnings: string[];
}

export interface OrchestratorOptions {
  onProgress?: (step: string, index: number, total: number) => void;
  onError?: (error: string) => void;
  onComplete?: (results: CommandResult[]) => void;
}

export interface ExecutionResult {
  success: boolean;
  results: CommandResult[];
  rollbackAvailable: boolean;
  snapshot?: string;
}

class AIOrchestrator {
  private snapshot: string | null = null;

  async planFromPrompt(
    prompt: string,
    context: {
      selectedText?: string;
      documentContent?: string;
    }
  ): Promise<DocumentPlan> {
    try {
      const response = await apiFetch('/api/documents/plan', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          prompt,
          selectedText: context.selectedText,
          documentContent: context.documentContent,
        }),
      });

      if (!response.ok) {
        throw new Error('Failed to generate plan');
      }

      const plan = await response.json();
      return this.validatePlan(plan);
    } catch (error) {
      return {
        intent: prompt,
        commands: [],
        validation: {
          valid: false,
          errors: [error instanceof Error ? error.message : 'Unknown error'],
          warnings: [],
        },
      };
    }
  }

  validatePlan(plan: DocumentPlan): DocumentPlan {
    const errors: string[] = [];
    const warnings: string[] = [];
    const seenTOC = new Set<number>();

    for (const cmd of plan.commands) {
      if (!commandBus.getCommand(cmd.name)) {
        warnings.push(`Unknown command: ${cmd.name}`);
      }

      if (cmd.name === 'insertTOC') {
        const position = (cmd.payload?.position as number) || 0;
        if (seenTOC.has(position)) {
          errors.push('Duplicate TOC insertion at same position');
        }
        seenTOC.add(position);
      }

      if (cmd.name === 'insertTable') {
        const rows = cmd.payload?.rows as number;
        const cols = cmd.payload?.cols as number;
        if (rows && rows > 100) {
          errors.push('Table rows exceed maximum (100)');
        }
        if (cols && cols > 26) {
          errors.push('Table columns exceed maximum (26)');
        }
      }
    }

    return {
      ...plan,
      validation: {
        valid: errors.length === 0,
        errors,
        warnings,
      },
    };
  }

  async executePlan(
    plan: DocumentPlan,
    options: OrchestratorOptions = {}
  ): Promise<ExecutionResult> {
    const { onProgress, onError, onComplete } = options;

    this.snapshot = commandBus.createSnapshot();

    if (!plan.validation?.valid) {
      const errorMsg = plan.validation?.errors.join(', ') || 'Invalid plan';
      onError?.(errorMsg);
      return {
        success: false,
        results: [],
        rollbackAvailable: !!this.snapshot,
        snapshot: this.snapshot || undefined,
      };
    }

    const results: CommandResult[] = [];
    const total = plan.commands.length;

    for (let i = 0; i < plan.commands.length; i++) {
      const cmd = plan.commands[i];
      onProgress?.(cmd.description || cmd.name, i, total);

      const result = commandBus.applyCommand(cmd.name, cmd.payload || {}, 'ai');
      results.push(result);

      if (!result.success) {
        onError?.(`Command failed: ${cmd.name} - ${result.error}`);
        if (this.snapshot) {
          commandBus.restoreSnapshot(this.snapshot);
        }
        return {
          success: false,
          results,
          rollbackAvailable: false,
          snapshot: undefined,
        };
      }

      await new Promise((resolve) => setTimeout(resolve, 50));
    }

    onComplete?.(results);

    return {
      success: true,
      results,
      rollbackAvailable: !!this.snapshot,
      snapshot: this.snapshot || undefined,
    };
  }

  rollback(): boolean {
    if (!this.snapshot) return false;
    const success = commandBus.restoreSnapshot(this.snapshot);
    if (success) {
      this.snapshot = null;
    }
    return success;
  }

  parseQuickAction(action: string): PlannedCommand[] {
    const actions: Record<string, PlannedCommand[]> = {
      summarize: [
        {
          name: 'replaceSelection',
          payload: { content: '[AI will summarize selected text]' },
          description: 'Summarize selected text',
        },
      ],
      improve: [
        {
          name: 'replaceSelection',
          payload: { content: '[AI will improve selected text]' },
          description: 'Improve writing quality',
        },
      ],
      simplify: [
        {
          name: 'replaceSelection',
          payload: { content: '[AI will simplify selected text]' },
          description: 'Simplify text',
        },
      ],
      'make-formal': [
        {
          name: 'replaceSelection',
          payload: { content: '[AI will make text more formal]' },
          description: 'Make text more formal',
        },
      ],
      'make-casual': [
        {
          name: 'replaceSelection',
          payload: { content: '[AI will make text more casual]' },
          description: 'Make text more casual',
        },
      ],
    };

    return actions[action] || [];
  }
}

export const aiOrchestrator = new AIOrchestrator();
