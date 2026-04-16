import type { Editor } from '@tiptap/react';

export type CommandSource = 'ribbon' | 'keyboard' | 'ai' | 'context-menu';

export interface CommandPayload {
  [key: string]: unknown;
}

export interface CommandContext {
  editor: Editor;
  source: CommandSource;
  payload: CommandPayload;
}

export type CommandHandler = (ctx: CommandContext) => boolean;

export interface CommandDefinition {
  name: string;
  handler: CommandHandler;
  label?: string;
  icon?: string;
  shortcut?: string;
}

export interface CommandResult {
  success: boolean;
  commandName: string;
  source: CommandSource;
  error?: string;
}

type CommandListener = (result: CommandResult) => void;

class CommandBus {
  private commands: Map<string, CommandDefinition> = new Map();
  private listeners: Set<CommandListener> = new Set();
  private editor: Editor | null = null;

  setEditor(editor: Editor) {
    this.editor = editor;
  }

  getEditor(): Editor | null {
    return this.editor;
  }

  registerCommand(definition: CommandDefinition): void {
    this.commands.set(definition.name, definition);
  }

  registerCommands(definitions: CommandDefinition[]): void {
    definitions.forEach((def) => this.registerCommand(def));
  }

  unregisterCommand(name: string): void {
    this.commands.delete(name);
  }

  getCommand(name: string): CommandDefinition | undefined {
    return this.commands.get(name);
  }

  getAllCommands(): CommandDefinition[] {
    return Array.from(this.commands.values());
  }

  applyCommand(
    commandName: string,
    payload: CommandPayload = {},
    source: CommandSource = 'ribbon'
  ): CommandResult {
    const definition = this.commands.get(commandName);
    
    if (!definition) {
      const result: CommandResult = {
        success: false,
        commandName,
        source,
        error: `Command "${commandName}" not found`,
      };
      this.notifyListeners(result);
      return result;
    }

    if (!this.editor) {
      const result: CommandResult = {
        success: false,
        commandName,
        source,
        error: 'Editor not initialized',
      };
      this.notifyListeners(result);
      return result;
    }

    try {
      const success = definition.handler({
        editor: this.editor,
        source,
        payload,
      });

      const result: CommandResult = {
        success,
        commandName,
        source,
      };
      this.notifyListeners(result);
      return result;
    } catch (error) {
      const result: CommandResult = {
        success: false,
        commandName,
        source,
        error: error instanceof Error ? error.message : 'Unknown error',
      };
      this.notifyListeners(result);
      return result;
    }
  }

  applyCommands(
    commands: Array<{ name: string; payload?: CommandPayload }>,
    source: CommandSource = 'ai'
  ): CommandResult[] {
    return commands.map(({ name, payload }) =>
      this.applyCommand(name, payload || {}, source)
    );
  }

  subscribe(listener: CommandListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private notifyListeners(result: CommandResult): void {
    this.listeners.forEach((listener) => listener(result));
  }

  createSnapshot(): string | null {
    if (!this.editor) return null;
    return JSON.stringify(this.editor.getJSON());
  }

  restoreSnapshot(snapshot: string): boolean {
    if (!this.editor) return false;
    try {
      const content = JSON.parse(snapshot);
      this.editor.commands.setContent(content);
      return true;
    } catch {
      return false;
    }
  }
}

export const commandBus = new CommandBus();

export function useCommandBus() {
  return commandBus;
}
