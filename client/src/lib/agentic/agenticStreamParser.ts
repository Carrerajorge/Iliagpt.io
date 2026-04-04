/**
 * agenticStreamParser.ts
 *
 * Parser for the agentic SSE stream. Handles all event types and builds a
 * typed, ordered message node tree suitable for rendering interleaved
 * text + tool-call sequences.
 */

import { useState, useCallback, useRef } from 'react';

// ---------------------------------------------------------------------------
// Event type union
// ---------------------------------------------------------------------------

export type AgenticEventType =
  | 'text_delta'
  | 'tool_call_start'
  | 'tool_call_delta'
  | 'tool_call_end'
  | 'tool_result'
  | 'task_spawned'
  | 'thinking_delta'
  | 'error'
  | 'done'
  | 'heartbeat';

// ---------------------------------------------------------------------------
// Core types
// ---------------------------------------------------------------------------

export interface AgenticStreamEvent {
  type: AgenticEventType;
  id?: string;
  index?: number;
  delta?: string;
  toolName?: string;
  toolArgs?: Record<string, unknown>;
  toolArgsDelta?: string;
  result?: unknown;
  error?: string;
  taskId?: string;
  thinking?: string;
  metadata?: Record<string, unknown>;
}

export type ToolCallStatus = 'pending' | 'running' | 'success' | 'error';

export interface ToolCall {
  id: string;
  index: number;
  toolName: string;
  args: Record<string, unknown>;
  argsDelta: string; // accumulated raw JSON delta
  status: ToolCallStatus;
  result?: unknown;
  error?: string;
  startedAt: number;
  endedAt?: number;
  durationMs?: number;
}

export type MessageNodeType = 'text' | 'tool_call' | 'thinking' | 'error' | 'task_spawn';

export interface MessageNode {
  id: string;
  type: MessageNodeType;
  // for text/thinking nodes:
  content?: string;
  // for tool_call nodes:
  toolCall?: ToolCall;
  // for task_spawn nodes:
  taskId?: string;
  taskLabel?: string;
  // for error nodes:
  errorMessage?: string;
  createdAt: number;
}

export interface ParsedAgenticMessage {
  id: string;
  nodes: MessageNode[];
  isComplete: boolean;
  hasError: boolean;
  totalToolCalls: number;
  completedToolCalls: number;
  startedAt: number;
  completedAt?: number;
}

export interface ParserState {
  message: ParsedAgenticMessage;
  activeToolCalls: Map<number, ToolCall>; // keyed by index
  currentTextNodeId: string | null;
  currentThinkingNodeId: string | null;
}

// ---------------------------------------------------------------------------
// Utilities
// ---------------------------------------------------------------------------

let _nodeCounter = 0;
function generateNodeId(prefix: string): string {
  return `${prefix}-${Date.now()}-${++_nodeCounter}`;
}

function tryParsePartialJson(raw: string): Record<string, unknown> | null {
  // Fast path: try straight parse first
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (parsed !== null && typeof parsed === 'object' && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>;
    }
    return null;
  } catch {
    // Attempt to close open JSON objects/arrays for partial streaming
    let attempt = raw.trimEnd();
    // Count unclosed braces/brackets
    let braces = 0;
    let brackets = 0;
    let inString = false;
    let escape = false;
    for (let i = 0; i < attempt.length; i++) {
      const ch = attempt[i];
      if (escape) { escape = false; continue; }
      if (ch === '\\' && inString) { escape = true; continue; }
      if (ch === '"') { inString = !inString; continue; }
      if (inString) continue;
      if (ch === '{') braces++;
      else if (ch === '}') braces--;
      else if (ch === '[') brackets++;
      else if (ch === ']') brackets--;
    }
    if (inString) attempt += '"';
    for (let i = 0; i < brackets; i++) attempt += ']';
    for (let i = 0; i < braces; i++) attempt += '}';
    try {
      const parsed = JSON.parse(attempt) as unknown;
      if (parsed !== null && typeof parsed === 'object' && !Array.isArray(parsed)) {
        return parsed as Record<string, unknown>;
      }
      return null;
    } catch {
      return null;
    }
  }
}

// ---------------------------------------------------------------------------
// parseSSELine
// ---------------------------------------------------------------------------

export function parseSSELine(line: string): { event?: string; data?: string } | null {
  if (!line || line.startsWith(':')) return null; // comment / empty
  const colonIdx = line.indexOf(':');
  if (colonIdx === -1) return null;
  const field = line.slice(0, colonIdx).trim();
  const value = line.slice(colonIdx + 1).trimStart();
  if (field === 'event') return { event: value };
  if (field === 'data') return { data: value };
  return null;
}

// ---------------------------------------------------------------------------
// AgenticStreamParser class
// ---------------------------------------------------------------------------

export class AgenticStreamParser {
  private state: ParserState;

  constructor(messageId: string) {
    this.state = {
      message: {
        id: messageId,
        nodes: [],
        isComplete: false,
        hasError: false,
        totalToolCalls: 0,
        completedToolCalls: 0,
        startedAt: Date.now(),
        completedAt: undefined,
      },
      activeToolCalls: new Map(),
      currentTextNodeId: null,
      currentThinkingNodeId: null,
    };
  }

  // -------------------------------------------------------------------------
  // Public API
  // -------------------------------------------------------------------------

  processEvent(raw: string): AgenticStreamEvent | null {
    const trimmed = raw.trim();
    if (!trimmed) return null;

    // Strip leading "data: " prefix from SSE
    const dataPrefix = 'data:';
    const payload = trimmed.startsWith(dataPrefix)
      ? trimmed.slice(dataPrefix.length).trimStart()
      : trimmed;

    if (payload === '[DONE]') return null;

    try {
      const parsed = JSON.parse(payload) as unknown;
      if (
        parsed === null ||
        typeof parsed !== 'object' ||
        Array.isArray(parsed)
      ) {
        return null;
      }
      return parsed as AgenticStreamEvent;
    } catch {
      return null;
    }
  }

  handleEvent(event: AgenticStreamEvent): void {
    switch (event.type) {
      case 'text_delta':
        this._handleTextDelta(event);
        break;
      case 'thinking_delta':
        this._handleThinkingDelta(event);
        break;
      case 'tool_call_start':
        this._handleToolCallStart(event);
        break;
      case 'tool_call_delta':
        this._handleToolCallDelta(event);
        break;
      case 'tool_call_end':
        this._handleToolCallEnd(event);
        break;
      case 'tool_result':
        this._handleToolResult(event);
        break;
      case 'task_spawned':
        this._handleTaskSpawned(event);
        break;
      case 'error':
        this._handleError(event);
        break;
      case 'done':
        this._handleDone();
        break;
      case 'heartbeat':
        // no-op
        break;
      default:
        // exhaustive guard — unknown event types are silently ignored
        break;
    }
  }

  getSnapshot(): ParsedAgenticMessage {
    // Return a deep-enough copy so consumers can safely read
    const msg = this.state.message;
    return {
      ...msg,
      nodes: msg.nodes.map((n) => ({
        ...n,
        toolCall: n.toolCall ? { ...n.toolCall } : undefined,
      })),
    };
  }

  isComplete(): boolean {
    return this.state.message.isComplete;
  }

  // -------------------------------------------------------------------------
  // Private handlers
  // -------------------------------------------------------------------------

  private _handleTextDelta(event: AgenticStreamEvent): void {
    if (!event.delta) return;
    const node = this._getOrCreateTextNode();
    node.content = (node.content ?? '') + event.delta;
  }

  private _handleThinkingDelta(event: AgenticStreamEvent): void {
    const delta = event.delta ?? event.thinking;
    if (!delta) return;

    let node: MessageNode;
    if (this.state.currentThinkingNodeId) {
      const existing = this.state.message.nodes.find(
        (n) => n.id === this.state.currentThinkingNodeId
      );
      if (existing) {
        existing.content = (existing.content ?? '') + delta;
        return;
      }
    }

    // Create new thinking node
    node = {
      id: generateNodeId('thinking'),
      type: 'thinking',
      content: delta,
      createdAt: Date.now(),
    };
    this.state.message.nodes.push(node);
    this.state.currentThinkingNodeId = node.id;
    // thinking interrupts a text sequence
    this.state.currentTextNodeId = null;
  }

  private _handleToolCallStart(event: AgenticStreamEvent): void {
    const index = event.index ?? 0;
    const id = event.id ?? generateNodeId('tc');
    const toolName = event.toolName ?? 'unknown';

    const toolCall: ToolCall = {
      id,
      index,
      toolName,
      args: {},
      argsDelta: '',
      status: 'pending',
      startedAt: Date.now(),
    };

    this.state.activeToolCalls.set(index, toolCall);
    this.state.message.totalToolCalls++;

    const node: MessageNode = {
      id: generateNodeId('tool-node'),
      type: 'tool_call',
      toolCall,
      createdAt: Date.now(),
    };
    this.state.message.nodes.push(node);

    // Tool call breaks current text node sequence
    this.state.currentTextNodeId = null;
    this.state.currentThinkingNodeId = null;
  }

  private _handleToolCallDelta(event: AgenticStreamEvent): void {
    const index = event.index ?? 0;
    const tc = this.state.activeToolCalls.get(index);
    if (!tc) return;

    const delta = event.toolArgsDelta ?? event.delta ?? '';
    tc.argsDelta += delta;

    // Attempt partial parse so the UI can show live args
    const partial = tryParsePartialJson(tc.argsDelta);
    if (partial !== null) {
      tc.args = partial;
    }

    // Keep node reference in sync (it shares the same object reference)
    // because nodes store the ToolCall by reference this is automatic.
  }

  private _handleToolCallEnd(event: AgenticStreamEvent): void {
    const index = event.index ?? 0;
    const tc = this.state.activeToolCalls.get(index);
    if (!tc) return;

    // Finalise args from the complete accumulated delta
    if (tc.argsDelta) {
      const final = tryParsePartialJson(tc.argsDelta);
      if (final !== null) {
        tc.args = final;
      }
    }

    // Merge any args provided directly with the end event
    if (event.toolArgs) {
      tc.args = { ...tc.args, ...event.toolArgs };
    }

    tc.status = 'running';

    // Any text that follows this tool call should start a fresh node
    this.state.currentTextNodeId = null;
  }

  private _handleToolResult(event: AgenticStreamEvent): void {
    const index = event.index ?? 0;
    const tc = this.state.activeToolCalls.get(index);
    if (!tc) return;

    const now = Date.now();
    tc.endedAt = now;
    tc.durationMs = now - tc.startedAt;

    if (event.error) {
      tc.status = 'error';
      tc.error = event.error;
    } else {
      tc.status = 'success';
      tc.result = event.result;
    }

    this.state.message.completedToolCalls++;
    this.state.activeToolCalls.delete(index);
  }

  private _handleTaskSpawned(event: AgenticStreamEvent): void {
    const node: MessageNode = {
      id: generateNodeId('task-spawn'),
      type: 'task_spawn',
      taskId: event.taskId,
      taskLabel: (event.metadata?.['label'] as string | undefined) ?? event.taskId,
      createdAt: Date.now(),
    };
    this.state.message.nodes.push(node);
    // Task spawns reset text continuity
    this.state.currentTextNodeId = null;
  }

  private _handleError(event: AgenticStreamEvent): void {
    const node: MessageNode = {
      id: generateNodeId('error'),
      type: 'error',
      errorMessage: event.error ?? 'Unknown error',
      createdAt: Date.now(),
    };
    this.state.message.nodes.push(node);
    this.state.message.hasError = true;
    this.state.currentTextNodeId = null;
  }

  private _handleDone(): void {
    this.state.message.isComplete = true;
    this.state.message.completedAt = Date.now();
  }

  // -------------------------------------------------------------------------
  // Helpers
  // -------------------------------------------------------------------------

  private _getOrCreateTextNode(): MessageNode {
    if (this.state.currentTextNodeId) {
      const existing = this.state.message.nodes.find(
        (n) => n.id === this.state.currentTextNodeId
      );
      if (existing) return existing;
    }

    const node: MessageNode = {
      id: generateNodeId('text'),
      type: 'text',
      content: '',
      createdAt: Date.now(),
    };
    this.state.message.nodes.push(node);
    this.state.currentTextNodeId = node.id;
    // A new text node resets thinking continuity
    this.state.currentThinkingNodeId = null;
    return node;
  }
}

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

export function createStreamParser(messageId: string): AgenticStreamParser {
  return new AgenticStreamParser(messageId);
}

// ---------------------------------------------------------------------------
// useSseParser React hook
// ---------------------------------------------------------------------------

export function useSseParser(messageId: string): {
  processLine: (line: string) => void;
  snapshot: ParsedAgenticMessage;
  reset: () => void;
} {
  const parserRef = useRef<AgenticStreamParser>(new AgenticStreamParser(messageId));

  const [snapshot, setSnapshot] = useState<ParsedAgenticMessage>(() =>
    parserRef.current.getSnapshot()
  );

  const processLine = useCallback((line: string) => {
    const parser = parserRef.current;
    const event = parser.processEvent(line);
    if (event) {
      parser.handleEvent(event);
      setSnapshot(parser.getSnapshot());
    }
  }, []);

  const reset = useCallback(() => {
    parserRef.current = new AgenticStreamParser(messageId);
    setSnapshot(parserRef.current.getSnapshot());
  }, [messageId]);

  return { processLine, snapshot, reset };
}
