import { useCallback, useEffect, useRef, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Send,
  Paperclip,
  X,
  Brain,
  AlertTriangle,
  ExternalLink,
  Loader2,
  Square,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';
import { useAgenticChat } from '@/hooks/useAgenticChat';
import { ToolCallCard } from './ToolCallCard';
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from '@/components/ui/collapsible';
import { ChevronDown } from 'lucide-react';

// ─── Types ───────────────────────────────────────────────────────────────────

type ToolCallStatus = 'pending' | 'running' | 'success' | 'error';

interface ToolCall {
  id: string;
  index: number;
  toolName: string;
  args: Record<string, unknown>;
  argsDelta: string;
  status: ToolCallStatus;
  result?: unknown;
  error?: string;
  startedAt: number;
  endedAt?: number;
  durationMs?: number;
}

type MessageNodeType = 'text' | 'tool_call' | 'thinking' | 'error' | 'task_spawn';

interface MessageNode {
  id: string;
  type: MessageNodeType;
  content?: string;
  toolCall?: ToolCall;
  taskId?: string;
  taskLabel?: string;
  errorMessage?: string;
  createdAt: number;
}

interface ParsedAgenticMessage {
  id: string;
  nodes: MessageNode[];
  isComplete: boolean;
  hasError: boolean;
  totalToolCalls: number;
  completedToolCalls: number;
  startedAt: number;
  completedAt?: number;
}

// ─── Props ────────────────────────────────────────────────────────────────────

interface AgenticChatProps {
  chatId: string;
  className?: string;
  placeholder?: string;
  onMessageSent?: (text: string) => void;
}

// ─── Streaming Cursor ─────────────────────────────────────────────────────────

function StreamingCursor() {
  return (
    <motion.span
      className="inline-block w-[2px] h-[1em] bg-foreground align-middle ml-[1px]"
      animate={{ opacity: [1, 0, 1] }}
      transition={{ duration: 0.9, repeat: Infinity, ease: 'steps(2)' }}
    />
  );
}

// ─── Thinking Node ────────────────────────────────────────────────────────────

interface ThinkingNodeProps {
  content: string;
  isStreaming: boolean;
}

function ThinkingNode({ content, isStreaming }: ThinkingNodeProps) {
  const [open, setOpen] = useState(false);

  return (
    <Collapsible open={open} onOpenChange={setOpen}>
      <CollapsibleTrigger asChild>
        <button
          className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors group"
          aria-label="Toggle thinking"
        >
          <Brain className="h-3.5 w-3.5 text-purple-400" />
          <span className="italic">Thinking</span>
          <ChevronDown
            className={cn(
              'h-3 w-3 transition-transform duration-200',
              open && 'rotate-180',
            )}
          />
        </button>
      </CollapsibleTrigger>
      <CollapsibleContent>
        <div className="mt-1.5 pl-5 border-l-2 border-purple-400/30">
          <p className="text-xs text-muted-foreground italic whitespace-pre-wrap leading-relaxed">
            {content}
            {isStreaming && <StreamingCursor />}
          </p>
        </div>
      </CollapsibleContent>
    </Collapsible>
  );
}

// ─── Error Node ───────────────────────────────────────────────────────────────

function ErrorNode({ message }: { message: string }) {
  return (
    <div className="flex items-start gap-2 rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2">
      <AlertTriangle className="h-4 w-4 text-destructive mt-0.5 shrink-0" />
      <p className="text-sm text-destructive">{message}</p>
    </div>
  );
}

// ─── Task Spawn Node ──────────────────────────────────────────────────────────

function TaskSpawnNode({ taskId, taskLabel }: { taskId?: string; taskLabel?: string }) {
  return (
    <div className="flex items-center gap-1.5">
      <Badge variant="secondary" className="gap-1 text-xs font-normal">
        <ExternalLink className="h-3 w-3" />
        {taskLabel ?? taskId ?? 'Spawned task'}
      </Badge>
    </div>
  );
}

// ─── Assistant Message ────────────────────────────────────────────────────────

interface AssistantMessageProps {
  message: ParsedAgenticMessage;
  isLatest: boolean;
  isStreaming: boolean;
}

function AssistantMessage({ message, isLatest, isStreaming }: AssistantMessageProps) {
  return (
    <div className="flex flex-col gap-2 max-w-[85%]">
      {message.nodes.map((node, idx) => {
        const isLastNode = idx === message.nodes.length - 1;
        const showCursor = isStreaming && isLatest && isLastNode;

        if (node.type === 'text') {
          return (
            <div key={node.id} className="rounded-2xl rounded-tl-sm bg-muted px-4 py-2.5">
              <p className="text-sm leading-relaxed whitespace-pre-wrap">
                {node.content ?? ''}
                {showCursor && <StreamingCursor />}
              </p>
            </div>
          );
        }

        if (node.type === 'thinking') {
          return (
            <div key={node.id} className="px-1">
              <ThinkingNode
                content={node.content ?? ''}
                isStreaming={showCursor}
              />
            </div>
          );
        }

        if (node.type === 'tool_call' && node.toolCall) {
          return (
            <ToolCallCard
              key={node.id}
              toolCall={node.toolCall}
              className="w-full max-w-[520px]"
            />
          );
        }

        if (node.type === 'error') {
          return <ErrorNode key={node.id} message={node.errorMessage ?? 'Unknown error'} />;
        }

        if (node.type === 'task_spawn') {
          return (
            <TaskSpawnNode key={node.id} taskId={node.taskId} taskLabel={node.taskLabel} />
          );
        }

        return null;
      })}
    </div>
  );
}

// ─── User Message ─────────────────────────────────────────────────────────────

function UserMessage({ text }: { text: string }) {
  return (
    <div className="flex justify-end">
      <div className="max-w-[75%] rounded-2xl rounded-tr-sm bg-primary px-4 py-2.5 text-primary-foreground">
        <p className="text-sm leading-relaxed whitespace-pre-wrap">{text}</p>
      </div>
    </div>
  );
}

// ─── AgenticChat ──────────────────────────────────────────────────────────────

export function AgenticChat({
  chatId,
  className,
  placeholder = 'Message the agent…',
  onMessageSent,
}: AgenticChatProps) {
  const { state, sendMessage, cancelStream } = useAgenticChat(chatId);

  const [input, setInput] = useState('');
  const [errorDismissed, setErrorDismissed] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const scrollViewportRef = useRef<HTMLDivElement>(null);
  const bottomAnchorRef = useRef<HTMLDivElement>(null);
  const isStreamingRef = useRef(false);

  const isStreaming = state.isStreaming ?? false;
  isStreamingRef.current = isStreaming;

  // Auto-resize textarea
  const adjustTextarea = useCallback(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${Math.min(el.scrollHeight, 180)}px`;
  }, []);

  const handleInputChange = useCallback(
    (e: React.ChangeEvent<HTMLTextAreaElement>) => {
      setInput(e.target.value);
      adjustTextarea();
    },
    [adjustTextarea],
  );

  const handleSend = useCallback(() => {
    const text = input.trim();
    if (!text) return;
    setInput('');
    if (textareaRef.current) {
      textareaRef.current.style.height = 'auto';
    }
    sendMessage(text);
    onMessageSent?.(text);
    setErrorDismissed(false);
  }, [input, sendMessage, onMessageSent]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        handleSend();
      }
    },
    [handleSend],
  );

  const handleFileClick = useCallback(() => {
    fileInputRef.current?.click();
  }, []);

  const handleFileChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      if (file) {
        // Hook can handle file attachment — pass through message with metadata
        sendMessage(`[Attached file: ${file.name}]`);
        onMessageSent?.(`[Attached file: ${file.name}]`);
      }
      e.target.value = '';
    },
    [sendMessage, onMessageSent],
  );

  // Scroll to bottom when messages update
  useEffect(() => {
    bottomAnchorRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [state.messages]);

  // Dismiss error when new message sent
  useEffect(() => {
    if (!state.error) setErrorDismissed(false);
  }, [state.error]);

  const showError = !!state.error && !errorDismissed;

  const messages = state.messages ?? [];
  const isEmpty = messages.length === 0;

  return (
    <div className={cn('flex flex-col h-full bg-background', className)}>
      {/* Error Banner */}
      <AnimatePresence>
        {showError && (
          <motion.div
            initial={{ opacity: 0, y: -8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -8 }}
            className="flex items-center gap-2 mx-3 mt-2 px-3 py-2 rounded-md border border-destructive/40 bg-destructive/10 text-sm text-destructive"
          >
            <AlertTriangle className="h-4 w-4 shrink-0" />
            <span className="flex-1">{state.error}</span>
            <button
              onClick={() => setErrorDismissed(true)}
              className="shrink-0 hover:opacity-70 transition-opacity"
              aria-label="Dismiss error"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Message List */}
      <ScrollArea className="flex-1 px-4" ref={scrollViewportRef as React.Ref<HTMLDivElement>}>
        {isEmpty ? (
          <div className="flex flex-col items-center justify-center h-full min-h-[300px] gap-3 text-center">
            <div className="rounded-full bg-muted p-4">
              <Brain className="h-8 w-8 text-muted-foreground" />
            </div>
            <div>
              <p className="text-sm font-medium text-foreground">Start a conversation</p>
              <p className="text-xs text-muted-foreground mt-0.5">
                with the agent
              </p>
            </div>
          </div>
        ) : (
          <div className="flex flex-col gap-4 py-4">
            <AnimatePresence initial={false}>
              {messages.map(
                (msg: { id: string; role: 'user' | 'assistant'; text?: string; parsed?: ParsedAgenticMessage }, msgIdx: number) => {
                  const isLatest = msgIdx === messages.length - 1;

                  if (msg.role === 'user') {
                    return (
                      <motion.div
                        key={msg.id}
                        initial={{ opacity: 0, y: 6 }}
                        animate={{ opacity: 1, y: 0 }}
                        transition={{ duration: 0.18 }}
                      >
                        <UserMessage text={msg.text ?? ''} />
                      </motion.div>
                    );
                  }

                  if (msg.role === 'assistant' && msg.parsed) {
                    return (
                      <motion.div
                        key={msg.id}
                        initial={{ opacity: 0, y: 6 }}
                        animate={{ opacity: 1, y: 0 }}
                        transition={{ duration: 0.18 }}
                        className="flex"
                      >
                        <AssistantMessage
                          message={msg.parsed}
                          isLatest={isLatest}
                          isStreaming={isStreaming && isLatest}
                        />
                      </motion.div>
                    );
                  }

                  return null;
                },
              )}
            </AnimatePresence>

            {/* Thinking status */}
            <AnimatePresence>
              {state.isThinking && (
                <motion.div
                  initial={{ opacity: 0, y: 4 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: 4 }}
                  className="flex items-center gap-2 text-xs text-muted-foreground pl-1"
                >
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  <span className="italic">
                    {state.currentToolName
                      ? `Using ${state.currentToolName}…`
                      : 'Thinking…'}
                  </span>
                </motion.div>
              )}
            </AnimatePresence>

            <div ref={bottomAnchorRef} />
          </div>
        )}
      </ScrollArea>

      {/* Streaming Status Bar */}
      <AnimatePresence>
        {isStreaming && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: 'auto' }}
            exit={{ opacity: 0, height: 0 }}
            className="flex items-center justify-between px-4 py-1.5 border-t bg-muted/30 text-xs text-muted-foreground"
          >
            <div className="flex items-center gap-1.5">
              <Loader2 className="h-3 w-3 animate-spin" />
              <span>Agent is working…</span>
            </div>
            <Button
              size="sm"
              variant="ghost"
              onClick={cancelStream}
              className="h-6 px-2 text-xs gap-1 text-muted-foreground hover:text-foreground"
            >
              <Square className="h-2.5 w-2.5 fill-current" />
              Cancel
            </Button>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Input Area */}
      <div className="border-t px-3 py-3">
        <div className="flex items-end gap-2 rounded-xl border bg-background px-3 py-2 shadow-sm focus-within:ring-1 focus-within:ring-ring transition-shadow">
          {/* File Attachment */}
          <button
            type="button"
            onClick={handleFileClick}
            className="shrink-0 mb-1 text-muted-foreground hover:text-foreground transition-colors"
            aria-label="Attach file"
          >
            <Paperclip className="h-4 w-4" />
          </button>
          <input
            ref={fileInputRef}
            type="file"
            className="sr-only"
            onChange={handleFileChange}
            aria-hidden="true"
            tabIndex={-1}
          />

          {/* Textarea */}
          <textarea
            ref={textareaRef}
            value={input}
            onChange={handleInputChange}
            onKeyDown={handleKeyDown}
            placeholder={placeholder}
            rows={1}
            className={cn(
              'flex-1 resize-none bg-transparent text-sm leading-relaxed outline-none placeholder:text-muted-foreground',
              'min-h-[24px] max-h-[180px] scrollbar-hide',
            )}
            aria-label="Chat input"
          />

          {/* Send */}
          <Button
            type="button"
            size="icon"
            disabled={!input.trim()}
            onClick={handleSend}
            className="h-7 w-7 shrink-0 rounded-lg mb-0.5"
            aria-label="Send message"
          >
            <Send className="h-3.5 w-3.5" />
          </Button>
        </div>

        <p className="mt-1.5 text-center text-[10px] text-muted-foreground/60">
          Shift + Enter for newline
        </p>
      </div>
    </div>
  );
}
