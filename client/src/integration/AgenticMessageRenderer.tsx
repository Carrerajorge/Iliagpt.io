/**
 * AgenticMessageRenderer.tsx
 *
 * Smart message renderer that handles both regular and agentic assistant
 * messages. Iterates the parsed message node tree from AgenticStreamParser
 * and renders the correct sub-component for each node type.
 *
 * Rendering decision tree:
 *   role === 'user'       → right-aligned user bubble
 *   parsedMessage exists  → node-by-node agentic rendering
 *   plain content         → MarkdownContent fallback
 */

import React, { useState, useCallback, useMemo } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Brain,
  AlertTriangle,
  ExternalLink,
  Loader2,
  ChevronDown,
  ChevronRight,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { ToolCallCard } from '@/components/agentic/ToolCallCard';
import { CodeExecutionView, type CodeExecutionResult } from '@/components/agentic/CodeExecutionView';
import type { ToolCall, ParsedAgenticMessage } from '@/hooks/useAgenticChat';
import type { MessageNode } from '@/lib/agentic/agenticStreamParser';
import { useAgenticChatContext } from './AgenticChatProvider';

// ─── Props ────────────────────────────────────────────────────────────────────

interface AgenticMessageRendererProps {
  message: {
    id: string;
    role: 'user' | 'assistant';
    content: string;
    parsedMessage?: ParsedAgenticMessage;
    isStreaming?: boolean;
    createdAt?: number;
  };
  className?: string;
  onRetryToolCall?: (toolCall: ToolCall) => void;
}

// ─── MarkdownContent ──────────────────────────────────────────────────────────

interface MarkdownContentProps {
  text: string;
  isStreaming?: boolean;
}

/**
 * Lightweight inline markdown renderer — no external dependency.
 * Handles: bold, italic, inline code, headers, ordered/unordered lists,
 * fenced code blocks, and horizontal rules.
 */
function MarkdownContent({ text, isStreaming }: MarkdownContentProps) {
  const segments = useMemo(() => parseMarkdown(text), [text]);

  return (
    <div className="markdown-content prose prose-sm dark:prose-invert max-w-none text-sm leading-relaxed">
      {segments}
      {isStreaming && (
        <span
          className="inline-block w-0.5 h-4 bg-current opacity-70 ml-0.5 align-middle animate-pulse"
          aria-hidden="true"
        />
      )}
    </div>
  );
}

type MarkdownSegment =
  | { type: 'text'; content: string }
  | { type: 'bold'; content: string }
  | { type: 'italic'; content: string }
  | { type: 'code_inline'; content: string }
  | { type: 'heading'; level: 1 | 2 | 3; content: string }
  | { type: 'list_item'; ordered: boolean; index: number; content: string }
  | { type: 'code_block'; lang: string; content: string }
  | { type: 'hr' };

function parseMarkdown(raw: string): React.ReactNode[] {
  const lines = raw.split('\n');
  const nodes: React.ReactNode[] = [];
  let i = 0;
  let listBuffer: { ordered: boolean; index: number; content: string }[] = [];
  let inOrderedList = false;

  const flushList = (key: string) => {
    if (listBuffer.length === 0) return;
    const Tag = inOrderedList ? 'ol' : 'ul';
    nodes.push(
      <Tag key={key} className={inOrderedList ? 'list-decimal pl-5 my-1' : 'list-disc pl-5 my-1'}>
        {listBuffer.map((item, idx) => (
          <li key={idx} className="my-0.5">
            {renderInline(item.content)}
          </li>
        ))}
      </Tag>
    );
    listBuffer = [];
  };

  while (i < lines.length) {
    const line = lines[i];

    // Fenced code block
    if (line.startsWith('```')) {
      flushList(`list-${i}`);
      const lang = line.slice(3).trim();
      const codeLines: string[] = [];
      i++;
      while (i < lines.length && !lines[i].startsWith('```')) {
        codeLines.push(lines[i]);
        i++;
      }
      nodes.push(
        <div key={`cb-${i}`} className="my-2 rounded-md overflow-hidden">
          {lang && (
            <div className="bg-muted/60 dark:bg-zinc-800 px-3 py-1 text-xs text-muted-foreground font-mono border-b border-border">
              {lang}
            </div>
          )}
          <pre className="bg-muted/30 dark:bg-zinc-900 p-3 overflow-x-auto">
            <code className="text-xs font-mono">{codeLines.join('\n')}</code>
          </pre>
        </div>
      );
      i++;
      continue;
    }

    // Heading
    const headingMatch = line.match(/^(#{1,3})\s+(.+)$/);
    if (headingMatch) {
      flushList(`list-${i}`);
      const level = headingMatch[1].length as 1 | 2 | 3;
      const content = headingMatch[2];
      const Tag = `h${level}` as keyof JSX.IntrinsicElements;
      const sizeClass = level === 1 ? 'text-lg font-bold' : level === 2 ? 'text-base font-bold' : 'text-sm font-semibold';
      nodes.push(
        <Tag key={`h-${i}`} className={cn(sizeClass, 'mt-3 mb-1')}>
          {renderInline(content)}
        </Tag>
      );
      i++;
      continue;
    }

    // Horizontal rule
    if (/^[-*_]{3,}$/.test(line.trim())) {
      flushList(`list-${i}`);
      nodes.push(<hr key={`hr-${i}`} className="my-3 border-border" />);
      i++;
      continue;
    }

    // Unordered list item
    const ulMatch = line.match(/^[\s]*[-*+]\s+(.+)$/);
    if (ulMatch) {
      if (inOrderedList) flushList(`list-${i}`);
      inOrderedList = false;
      listBuffer.push({ ordered: false, index: 0, content: ulMatch[1] });
      i++;
      continue;
    }

    // Ordered list item
    const olMatch = line.match(/^[\s]*(\d+)\.\s+(.+)$/);
    if (olMatch) {
      if (!inOrderedList) flushList(`list-${i}`);
      inOrderedList = true;
      listBuffer.push({ ordered: true, index: parseInt(olMatch[1], 10), content: olMatch[2] });
      i++;
      continue;
    }

    // Regular paragraph — flush any pending list first
    flushList(`list-${i}`);

    if (line.trim() === '') {
      nodes.push(<div key={`br-${i}`} className="h-2" />);
    } else {
      nodes.push(
        <p key={`p-${i}`} className="my-0.5">
          {renderInline(line)}
        </p>
      );
    }
    i++;
  }

  flushList('list-end');
  return nodes;
}

function renderInline(text: string): React.ReactNode {
  // Split on inline code, bold, italic patterns
  const parts: React.ReactNode[] = [];
  let remaining = text;
  let key = 0;

  while (remaining.length > 0) {
    // Inline code
    const codeIdx = remaining.indexOf('`');
    const boldIdx = remaining.indexOf('**');
    const italicIdx = remaining.indexOf('_');

    const first = Math.min(
      codeIdx === -1 ? Infinity : codeIdx,
      boldIdx === -1 ? Infinity : boldIdx,
      italicIdx === -1 ? Infinity : italicIdx
    );

    if (first === Infinity) {
      parts.push(remaining);
      break;
    }

    if (first > 0) {
      parts.push(remaining.slice(0, first));
      remaining = remaining.slice(first);
      key++;
      continue;
    }

    // Code
    if (remaining.startsWith('`')) {
      const end = remaining.indexOf('`', 1);
      if (end === -1) { parts.push(remaining); break; }
      parts.push(
        <code key={key++} className="bg-muted/50 dark:bg-zinc-800 px-1 py-0.5 rounded text-xs font-mono">
          {remaining.slice(1, end)}
        </code>
      );
      remaining = remaining.slice(end + 1);
      continue;
    }

    // Bold
    if (remaining.startsWith('**')) {
      const end = remaining.indexOf('**', 2);
      if (end === -1) { parts.push(remaining); break; }
      parts.push(<strong key={key++}>{remaining.slice(2, end)}</strong>);
      remaining = remaining.slice(end + 2);
      continue;
    }

    // Italic
    if (remaining.startsWith('_')) {
      const end = remaining.indexOf('_', 1);
      if (end === -1) { parts.push(remaining); break; }
      parts.push(<em key={key++}>{remaining.slice(1, end)}</em>);
      remaining = remaining.slice(end + 1);
      continue;
    }

    parts.push(remaining);
    break;
  }

  return <>{parts}</>;
}

// ─── ThinkingBlock ────────────────────────────────────────────────────────────

interface ThinkingBlockProps {
  content: string;
}

function ThinkingBlock({ content }: ThinkingBlockProps) {
  const [expanded, setExpanded] = useState(false);
  const preview = content.slice(0, 100) + (content.length > 100 ? '…' : '');

  return (
    <div className="my-2 rounded-md border border-purple-200 dark:border-purple-800 bg-purple-50/50 dark:bg-purple-950/30 overflow-hidden">
      <button
        type="button"
        onClick={() => setExpanded((v) => !v)}
        className="flex items-center gap-2 w-full px-3 py-2 text-xs text-purple-700 dark:text-purple-300 hover:bg-purple-100/50 dark:hover:bg-purple-900/30 transition-colors"
        aria-expanded={expanded}
      >
        <Brain className="w-3.5 h-3.5 flex-shrink-0" />
        <span className="font-medium mr-1">Thinking</span>
        {!expanded && (
          <span className="text-purple-500 dark:text-purple-400 truncate flex-1 text-left">
            {preview}
          </span>
        )}
        <span className="ml-auto flex-shrink-0">
          {expanded ? (
            <ChevronDown className="w-3.5 h-3.5" />
          ) : (
            <ChevronRight className="w-3.5 h-3.5" />
          )}
        </span>
      </button>

      <AnimatePresence initial={false}>
        {expanded && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.2, ease: 'easeInOut' }}
            className="overflow-hidden"
          >
            <div className="px-3 pb-3 pt-1 text-xs text-purple-800 dark:text-purple-200 font-mono whitespace-pre-wrap leading-relaxed border-t border-purple-200 dark:border-purple-800">
              {content}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

// ─── ErrorBlock ───────────────────────────────────────────────────────────────

interface ErrorBlockProps {
  message: string;
}

function ErrorBlock({ message }: ErrorBlockProps) {
  return (
    <div className="my-2 flex items-start gap-2 rounded-md border border-red-200 dark:border-red-800 bg-red-50/50 dark:bg-red-950/30 px-3 py-2">
      <AlertTriangle className="w-4 h-4 text-red-500 dark:text-red-400 mt-0.5 flex-shrink-0" />
      <p className="text-xs text-red-700 dark:text-red-300 leading-relaxed">{message}</p>
    </div>
  );
}

// ─── TaskSpawnBadge ───────────────────────────────────────────────────────────

interface TaskSpawnBadgeProps {
  taskId: string;
  label: string;
}

function TaskSpawnBadge({ taskId: _taskId, label }: TaskSpawnBadgeProps) {
  const { setTaskPanelOpen } = useAgenticChatContext();

  return (
    <button
      type="button"
      onClick={() => setTaskPanelOpen(true)}
      className="inline-flex items-center gap-1.5 my-1 px-2.5 py-1 rounded-full border border-blue-200 dark:border-blue-700 bg-blue-50 dark:bg-blue-950/40 text-xs text-blue-700 dark:text-blue-300 hover:bg-blue-100 dark:hover:bg-blue-900/40 transition-colors"
    >
      <Loader2 className="w-3 h-3 animate-spin" />
      <span className="font-medium">{label}</span>
      <ExternalLink className="w-3 h-3 opacity-60" />
    </button>
  );
}

// ─── buildExecution ───────────────────────────────────────────────────────────

function buildExecution(toolCall: ToolCall): CodeExecutionResult {
  const args = (toolCall.args ?? {}) as Record<string, unknown>;
  const result = toolCall.result as Record<string, unknown> | null | undefined;

  return {
    code: typeof args.code === 'string' ? args.code : '',
    language: typeof args.language === 'string' ? args.language : 'python',
    status:
      toolCall.status === 'succeeded'
        ? 'success'
        : toolCall.status === 'failed'
        ? 'error'
        : 'running',
    stdout:
      result && typeof result.stdout === 'string'
        ? result.stdout
        : result && typeof result.output === 'string'
        ? result.output
        : undefined,
    stderr:
      result && typeof result.stderr === 'string'
        ? result.stderr
        : undefined,
    exitCode:
      result && typeof result.exit_code === 'number'
        ? result.exit_code
        : undefined,
  };
}

// ─── UserBubble ───────────────────────────────────────────────────────────────

interface UserBubbleProps {
  content: string;
  className?: string;
}

function UserBubble({ content, className }: UserBubbleProps) {
  return (
    <div className={cn('flex justify-end', className)}>
      <div className="max-w-[80%] rounded-2xl rounded-tr-sm bg-primary text-primary-foreground px-4 py-2.5 text-sm leading-relaxed shadow-sm">
        {content}
      </div>
    </div>
  );
}

// ─── AgenticMessageRenderer (main export) ────────────────────────────────────

export function AgenticMessageRenderer({
  message,
  className,
  onRetryToolCall,
}: AgenticMessageRendererProps) {
  const { role, content, parsedMessage, isStreaming } = message;

  // User messages
  if (role === 'user') {
    return <UserBubble content={content} className={className} />;
  }

  // No parsed agentic data — plain assistant message
  if (!parsedMessage) {
    return (
      <div className={cn('flex justify-start', className)}>
        <div className="max-w-[90%] text-sm">
          <MarkdownContent text={content} isStreaming={isStreaming} />
        </div>
      </div>
    );
  }

  // Agentic: render nodes in order
  const nodes: MessageNode[] = parsedMessage.nodes ?? [];
  const lastNodeIndex = nodes.length - 1;

  const renderedNodes = nodes.map((node, idx) => {
    const isLastNode = idx === lastNodeIndex;
    const nodeKey = `${message.id}-node-${idx}`;

    switch (node.type) {
      case 'text':
        return (
          <MarkdownContent
            key={nodeKey}
            text={node.content ?? ''}
            isStreaming={isStreaming && isLastNode}
          />
        );

      case 'thinking':
        return (
          <ThinkingBlock key={nodeKey} content={node.content ?? ''} />
        );

      case 'tool_call': {
        if (!node.toolCall) return null;

        // Code execution — use specialised view
        if (
          node.toolCall.toolName === 'execute_code' ||
          node.toolCall.toolName === 'code_interpreter'
        ) {
          return (
            <CodeExecutionView
              key={nodeKey}
              execution={buildExecution(node.toolCall)}
            />
          );
        }

        // Bash tool — show output in terminal-style pre block if available
        if (node.toolCall.toolName === 'bash' || node.toolCall.toolName === 'shell') {
          const result = node.toolCall.result;
          const output =
            typeof result === 'string'
              ? result
              : result && typeof (result as Record<string, unknown>).stdout === 'string'
              ? (result as Record<string, unknown>).stdout as string
              : null;

          return (
            <div key={nodeKey} className="space-y-1">
              <ToolCallCard toolCall={node.toolCall} onRetry={onRetryToolCall} />
              {output && (
                <pre className="mt-1 rounded-md bg-zinc-900 dark:bg-black px-3 py-2 text-xs font-mono text-green-400 overflow-x-auto whitespace-pre-wrap max-h-48 overflow-y-auto">
                  {output}
                </pre>
              )}
            </div>
          );
        }

        // Default tool call card
        return (
          <ToolCallCard
            key={nodeKey}
            toolCall={node.toolCall}
            onRetry={onRetryToolCall}
          />
        );
      }

      case 'error':
        return (
          <ErrorBlock
            key={nodeKey}
            message={node.errorMessage ?? 'An unknown error occurred.'}
          />
        );

      case 'task_spawn':
        return (
          <TaskSpawnBadge
            key={nodeKey}
            taskId={node.taskId ?? ''}
            label={node.taskLabel ?? 'Background task'}
          />
        );

      default:
        return null;
    }
  });

  return (
    <div className={cn('flex justify-start', className)}>
      <div className="max-w-[90%] space-y-1 min-w-0">
        <AnimatePresence initial={false} mode="popLayout">
          {renderedNodes.map((node, idx) =>
            node ? (
              <motion.div
                key={`${message.id}-motion-${idx}`}
                initial={{ opacity: 0, y: 4 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.15, ease: 'easeOut' }}
              >
                {node}
              </motion.div>
            ) : null
          )}
        </AnimatePresence>

        {/* Streaming indicator when no nodes yet */}
        {isStreaming && nodes.length === 0 && (
          <div className="flex items-center gap-1.5 text-muted-foreground text-xs">
            <Loader2 className="w-3.5 h-3.5 animate-spin" />
            <span>Thinking…</span>
          </div>
        )}
      </div>
    </div>
  );
}
