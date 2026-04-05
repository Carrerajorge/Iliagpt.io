/**
 * AgenticToolbar.tsx
 *
 * Compact toolbar that lives inside the chat input area.
 * Provides quick-access slash-command buttons, a thinking-mode picker,
 * an agentic-mode toggle, and a running-task indicator.
 *
 * Layout (left → right):
 *   [Quick actions: /code /search /analyze /create] | [Thinking mode ▾] | [Agent] [Tasks N]
 *
 * On mobile the quick-action buttons collapse into a single "+" dropdown.
 */

import React from 'react';
import {
  Code2,
  Search,
  BarChart2,
  FilePlus,
  Zap,
  Scale,
  Brain,
  Sparkles,
  Bot,
  Activity,
  Check,
  ChevronDown,
  Plus,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';
import { useAgenticChatContext, type ThinkingMode } from './AgenticChatProvider';

// ─── Types ────────────────────────────────────────────────────────────────────

export interface AgenticToolbarProps {
  chatId: string;
  onQuickAction: (prefix: string) => void;
  className?: string;
}

// ─── Quick action definitions ─────────────────────────────────────────────────

interface QuickAction {
  id: string;
  prefix: string;
  label: string;
  description: string;
  Icon: React.ElementType;
}

const QUICK_ACTIONS: QuickAction[] = [
  {
    id: 'code',
    prefix: '/code ',
    label: '/code',
    description: 'Generate or refactor code',
    Icon: Code2,
  },
  {
    id: 'search',
    prefix: '/search ',
    label: '/search',
    description: 'Search the web or knowledge base',
    Icon: Search,
  },
  {
    id: 'analyze',
    prefix: '/analyze ',
    label: '/analyze',
    description: 'Analyze data, text, or a file',
    Icon: BarChart2,
  },
  {
    id: 'create',
    prefix: '/create ',
    label: '/create',
    description: 'Create a file, document, or artifact',
    Icon: FilePlus,
  },
];

// ─── Thinking mode definitions ────────────────────────────────────────────────

interface ThinkingModeOption {
  value: ThinkingMode;
  label: string;
  description: string;
  Icon: React.ElementType;
}

const THINKING_MODES: ThinkingModeOption[] = [
  {
    value: 'fast',
    label: 'Fast',
    description: 'Quick responses, lower cost',
    Icon: Zap,
  },
  {
    value: 'balanced',
    label: 'Balanced',
    description: 'Good quality, moderate cost',
    Icon: Scale,
  },
  {
    value: 'deep',
    label: 'Deep',
    description: 'Extended thinking, higher quality',
    Icon: Brain,
  },
  {
    value: 'creative',
    label: 'Creative',
    description: 'Divergent, novel responses',
    Icon: Sparkles,
  },
];

// ─── Sub-components ────────────────────────────────────────────────────────────

/** Vertical divider between toolbar sections */
function Divider() {
  return (
    <span
      className="inline-block w-px h-4 bg-border self-center flex-shrink-0 mx-0.5"
      aria-hidden="true"
    />
  );
}

/** Single quick-action button with tooltip */
interface QuickActionButtonProps {
  action: QuickAction;
  onQuickAction: (prefix: string) => void;
}

function QuickActionButton({ action, onQuickAction }: QuickActionButtonProps) {
  const { Icon, prefix, label, description } = action;
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="h-7 px-2 text-xs gap-1 text-muted-foreground hover:text-foreground"
          onClick={() => onQuickAction(prefix)}
          aria-label={`${label}: ${description}`}
        >
          <Icon className="w-3.5 h-3.5" />
          <span className="hidden sm:inline font-mono">{label}</span>
        </Button>
      </TooltipTrigger>
      <TooltipContent side="top" className="text-xs">
        <span className="font-mono font-semibold">{label}</span> — {description}
      </TooltipContent>
    </Tooltip>
  );
}

/** Collapsed quick-actions for mobile */
interface MobileQuickActionsProps {
  onQuickAction: (prefix: string) => void;
}

function MobileQuickActions({ onQuickAction }: MobileQuickActionsProps) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="h-7 w-7 p-0 text-muted-foreground hover:text-foreground sm:hidden"
          aria-label="Quick actions"
        >
          <Plus className="w-3.5 h-3.5" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-48">
        {QUICK_ACTIONS.map((action) => (
          <DropdownMenuItem
            key={action.id}
            onSelect={() => onQuickAction(action.prefix)}
            className="gap-2 text-xs"
          >
            <action.Icon className="w-3.5 h-3.5 flex-shrink-0" />
            <span className="font-mono font-semibold">{action.label}</span>
            <span className="text-muted-foreground truncate">{action.description}</span>
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/** Thinking mode dropdown */
interface ThinkingModePickerProps {
  mode: ThinkingMode;
  onSelect: (mode: ThinkingMode) => void;
}

function ThinkingModePicker({ mode, onSelect }: ThinkingModePickerProps) {
  const current = THINKING_MODES.find((m) => m.value === mode) ?? THINKING_MODES[1];
  const { Icon: CurrentIcon } = current;

  return (
    <DropdownMenu>
      <Tooltip>
        <TooltipTrigger asChild>
          <DropdownMenuTrigger asChild>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="h-7 px-2 text-xs gap-1 text-muted-foreground hover:text-foreground"
              aria-label={`Thinking mode: ${current.label}`}
            >
              <CurrentIcon className="w-3.5 h-3.5" />
              <span className="hidden md:inline">{current.label}</span>
              <ChevronDown className="w-3 h-3 opacity-50" />
            </Button>
          </DropdownMenuTrigger>
        </TooltipTrigger>
        <TooltipContent side="top" className="text-xs">
          Thinking mode: <span className="font-semibold">{current.label}</span> — {current.description}
        </TooltipContent>
      </Tooltip>

      <DropdownMenuContent align="center" className="w-52">
        {THINKING_MODES.map((m, idx) => (
          <React.Fragment key={m.value}>
            {idx > 0 && idx === THINKING_MODES.length - 1 && <DropdownMenuSeparator />}
            <DropdownMenuItem
              onSelect={() => onSelect(m.value)}
              className="gap-2 text-xs cursor-pointer"
            >
              <m.Icon className="w-3.5 h-3.5 flex-shrink-0 text-muted-foreground" />
              <div className="flex-1 min-w-0">
                <div className="font-semibold">{m.label}</div>
                <div className="text-muted-foreground text-[10px]">{m.description}</div>
              </div>
              {mode === m.value && (
                <Check className="w-3.5 h-3.5 text-primary flex-shrink-0" />
              )}
            </DropdownMenuItem>
          </React.Fragment>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/** Agentic mode toggle button */
interface AgentToggleProps {
  active: boolean;
  onToggle: () => void;
}

function AgentToggle({ active, onToggle }: AgentToggleProps) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          type="button"
          variant={active ? 'default' : 'ghost'}
          size="sm"
          className={cn(
            'h-7 px-2 text-xs gap-1 transition-colors',
            active
              ? 'bg-blue-600 hover:bg-blue-700 text-white'
              : 'text-muted-foreground hover:text-foreground'
          )}
          onClick={onToggle}
          aria-pressed={active}
          aria-label={active ? 'Disable agent mode' : 'Enable agent mode'}
        >
          <Bot className="w-3.5 h-3.5" />
          <span className="hidden sm:inline">Agent</span>
        </Button>
      </TooltipTrigger>
      <TooltipContent side="top" className="text-xs">
        {active ? 'Disable' : 'Enable'} agentic mode — tool use, code execution, multi-step tasks
      </TooltipContent>
    </Tooltip>
  );
}

/** Running task indicator button */
interface TaskIndicatorProps {
  count: number;
  onClick: () => void;
}

function TaskIndicator({ count, onClick }: TaskIndicatorProps) {
  if (count === 0) return null;
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="h-7 px-2 text-xs gap-1 text-muted-foreground hover:text-foreground relative"
          onClick={onClick}
          aria-label={`${count} running task${count !== 1 ? 's' : ''}`}
        >
          <Activity className="w-3.5 h-3.5 text-blue-500" />
          <Badge
            variant="secondary"
            className="h-4 min-w-4 px-1 text-[10px] bg-blue-100 text-blue-700 dark:bg-blue-900/50 dark:text-blue-300"
          >
            {count}
          </Badge>
        </Button>
      </TooltipTrigger>
      <TooltipContent side="top" className="text-xs">
        {count} running task{count !== 1 ? 's' : ''} — click to view
      </TooltipContent>
    </Tooltip>
  );
}

// ─── AgenticToolbar (main export) ────────────────────────────────────────────

export function AgenticToolbar({ chatId: _chatId, onQuickAction, className }: AgenticToolbarProps) {
  const {
    thinkingMode,
    setThinkingMode,
    isAgenticMode,
    toggleAgenticMode,
    runningTaskCount,
    setTaskPanelOpen,
    agenticEnabled,
  } = useAgenticChatContext();

  // Don't render if agentic is globally disabled
  if (!agenticEnabled) return null;

  return (
    <TooltipProvider delayDuration={400}>
      <div
        data-testid="agentic-toolbar"
        className={cn(
          'flex items-center gap-0.5 px-1 py-0.5',
          'border-t border-border/60 bg-background/80',
          className
        )}
        role="toolbar"
        aria-label="Agentic actions"
      >
        {/* Mobile: collapsed quick actions */}
        <MobileQuickActions onQuickAction={onQuickAction} />

        {/* Desktop: individual quick action buttons */}
        <div className="hidden sm:flex items-center gap-0.5">
          {QUICK_ACTIONS.map((action) => (
            <QuickActionButton
              key={action.id}
              action={action}
              onQuickAction={onQuickAction}
            />
          ))}
        </div>

        <Divider />

        {/* Thinking mode picker */}
        <ThinkingModePicker mode={thinkingMode} onSelect={setThinkingMode} />

        <Divider />

        {/* Right side: Agent toggle + task indicator */}
        <div className="flex items-center gap-0.5 ml-auto">
          <AgentToggle active={isAgenticMode} onToggle={toggleAgenticMode} />
          <TaskIndicator count={runningTaskCount} onClick={() => setTaskPanelOpen(true)} />
        </div>
      </div>
    </TooltipProvider>
  );
}
