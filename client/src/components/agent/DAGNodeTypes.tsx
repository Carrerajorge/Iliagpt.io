import { memo } from 'react';
import { Handle, Position, NodeProps } from 'reactflow';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';
import {
  Loader2,
  CheckCircle2,
  AlertCircle,
  Clock,
  Play,
  GitBranch,
  GitMerge,
  Circle,
  Zap,
} from 'lucide-react';

export type DAGNodeStatus = 'pending' | 'running' | 'completed' | 'failed' | 'cancelled';

export interface TaskNodeData {
  label: string;
  description: string;
  status: DAGNodeStatus;
  progress: number;
  agentName?: string;
  toolHint?: string;
  complexity?: string;
  estimatedTokens?: number;
  durationMs?: number;
  error?: string;
  inputs?: Record<string, any>;
  outputs?: Record<string, any>;
  logs?: string[];
  onInspect?: (nodeId: string) => void;
}

export interface DecisionNodeData {
  label: string;
  description: string;
  status: DAGNodeStatus;
  riskLevel: 'low' | 'medium' | 'high';
  condition?: string;
  result?: string;
  onInspect?: (nodeId: string) => void;
}

export interface MergeNodeData {
  label: string;
  status: DAGNodeStatus;
  inputCount: number;
  completedInputs: number;
  aggregationType?: string;
  onInspect?: (nodeId: string) => void;
}

export interface StartEndNodeData {
  label: string;
  status: DAGNodeStatus;
}

const statusConfig: Record<DAGNodeStatus, { icon: typeof Clock; color: string; bg: string; border: string; animate?: boolean }> = {
  pending: { icon: Clock, color: 'text-muted-foreground', bg: 'bg-muted/50', border: 'border-muted-foreground/30' },
  running: { icon: Loader2, color: 'text-blue-500', bg: 'bg-blue-500/10', border: 'border-blue-500', animate: true },
  completed: { icon: CheckCircle2, color: 'text-green-500', bg: 'bg-green-500/10', border: 'border-green-500' },
  failed: { icon: AlertCircle, color: 'text-red-500', bg: 'bg-red-500/10', border: 'border-red-500' },
  cancelled: { icon: Circle, color: 'text-gray-400', bg: 'bg-gray-400/10', border: 'border-gray-400' },
};

const riskColors = {
  low: 'bg-green-500/20 text-green-600 border-green-500/40',
  medium: 'bg-yellow-500/20 text-yellow-600 border-yellow-500/40',
  high: 'bg-red-500/20 text-red-600 border-red-500/40',
};

export const TaskNode = memo(({ data, id }: NodeProps<TaskNodeData>) => {
  const config = statusConfig[data.status];
  const Icon = config.icon;

  return (
    <div
      className={cn(
        'rounded-lg border-2 shadow-sm min-w-[200px] max-w-[280px] cursor-pointer transition-all hover:shadow-md',
        config.bg,
        config.border,
        data.status === 'running' && 'ring-2 ring-blue-500/30 ring-offset-1'
      )}
      onClick={() => data.onInspect?.(id)}
      data-testid={`dag-node-task-${id}`}
    >
      <Handle type="target" position={Position.Top} className="!bg-primary !w-2 !h-2" />

      <div className="p-3 space-y-2">
        <div className="flex items-start justify-between gap-2">
          <div className="flex items-center gap-1.5 flex-1 min-w-0">
            <Icon className={cn('h-4 w-4 shrink-0', config.color, config.animate && 'animate-spin')} />
            <span className="font-medium text-sm truncate">{data.label}</span>
          </div>
          {data.complexity && (
            <Badge variant="outline" className="text-[9px] h-4 px-1 shrink-0 uppercase">
              {data.complexity}
            </Badge>
          )}
        </div>

        <p className="text-xs text-muted-foreground line-clamp-2">{data.description}</p>

        {data.status === 'running' && data.progress > 0 && (
          <div className="space-y-1">
            <div className="h-1.5 w-full bg-secondary rounded-full overflow-hidden">
              <div
                className="h-full bg-blue-500 transition-all duration-300 rounded-full"
                style={{ width: `${Math.min(data.progress, 100)}%` }}
              />
            </div>
            <span className="text-[10px] text-muted-foreground">{Math.round(data.progress)}%</span>
          </div>
        )}

        <div className="flex items-center gap-1.5 flex-wrap">
          {data.agentName && (
            <Badge variant="secondary" className="text-[9px] h-4 px-1 gap-0.5">
              <Zap className="h-2.5 w-2.5" />
              {data.agentName}
            </Badge>
          )}
          {data.toolHint && (
            <Badge variant="outline" className="text-[9px] h-4 px-1">
              {data.toolHint}
            </Badge>
          )}
          {data.durationMs !== undefined && data.status === 'completed' && (
            <span className="text-[9px] text-muted-foreground">
              {data.durationMs < 1000 ? `${data.durationMs}ms` : `${(data.durationMs / 1000).toFixed(1)}s`}
            </span>
          )}
        </div>

        {data.error && (
          <div className="text-[10px] text-red-500 bg-red-500/10 p-1.5 rounded truncate">
            {data.error}
          </div>
        )}
      </div>

      <Handle type="source" position={Position.Bottom} className="!bg-primary !w-2 !h-2" />
    </div>
  );
});
TaskNode.displayName = 'TaskNode';

export const DecisionNode = memo(({ data, id }: NodeProps<DecisionNodeData>) => {
  const config = statusConfig[data.status];
  const Icon = config.icon;

  return (
    <div
      className={cn(
        'rounded-lg border-2 shadow-sm min-w-[180px] max-w-[240px] cursor-pointer transition-all hover:shadow-md',
        config.bg,
        config.border
      )}
      onClick={() => data.onInspect?.(id)}
      data-testid={`dag-node-decision-${id}`}
    >
      <Handle type="target" position={Position.Top} className="!bg-primary !w-2 !h-2" />

      <div className="p-3 space-y-2">
        <div className="flex items-center gap-1.5">
          <GitBranch className={cn('h-4 w-4 shrink-0', config.color)} />
          <span className="font-medium text-sm truncate">{data.label}</span>
        </div>

        <p className="text-xs text-muted-foreground line-clamp-2">{data.description}</p>

        <div className="flex items-center gap-1.5">
          <Badge className={cn('text-[9px] h-4 px-1.5 border', riskColors[data.riskLevel])}>
            Risk: {data.riskLevel}
          </Badge>
          <Icon className={cn('h-3 w-3', config.color, config.animate && 'animate-spin')} />
        </div>

        {data.condition && (
          <div className="text-[10px] text-muted-foreground bg-muted/50 p-1.5 rounded font-mono">
            {data.condition}
          </div>
        )}

        {data.result && (
          <div className="text-[10px] font-medium text-primary">→ {data.result}</div>
        )}
      </div>

      <Handle type="source" position={Position.Bottom} className="!bg-primary !w-2 !h-2" />
    </div>
  );
});
DecisionNode.displayName = 'DecisionNode';

export const MergeNode = memo(({ data, id }: NodeProps<MergeNodeData>) => {
  const config = statusConfig[data.status];
  const completionPct = data.inputCount > 0 ? Math.round((data.completedInputs / data.inputCount) * 100) : 0;

  return (
    <div
      className={cn(
        'rounded-lg border-2 shadow-sm min-w-[160px] max-w-[220px] cursor-pointer transition-all hover:shadow-md',
        config.bg,
        config.border
      )}
      onClick={() => data.onInspect?.(id)}
      data-testid={`dag-node-merge-${id}`}
    >
      <Handle type="target" position={Position.Top} className="!bg-primary !w-2 !h-2" />

      <div className="p-3 space-y-2">
        <div className="flex items-center gap-1.5">
          <GitMerge className={cn('h-4 w-4 shrink-0', config.color)} />
          <span className="font-medium text-sm truncate">{data.label}</span>
        </div>

        <div className="flex items-center gap-2">
          <div className="h-1.5 flex-1 bg-secondary rounded-full overflow-hidden">
            <div
              className="h-full bg-primary transition-all duration-300 rounded-full"
              style={{ width: `${completionPct}%` }}
            />
          </div>
          <span className="text-[10px] text-muted-foreground whitespace-nowrap">
            {data.completedInputs}/{data.inputCount}
          </span>
        </div>

        {data.aggregationType && (
          <Badge variant="outline" className="text-[9px] h-4 px-1">
            {data.aggregationType}
          </Badge>
        )}
      </div>

      <Handle type="source" position={Position.Bottom} className="!bg-primary !w-2 !h-2" />
    </div>
  );
});
MergeNode.displayName = 'MergeNode';

export const StartNode = memo(({ data }: NodeProps<StartEndNodeData>) => {
  return (
    <div
      className="rounded-full border-2 border-green-500 bg-green-500/10 px-5 py-2.5 shadow-sm"
      data-testid="dag-node-start"
    >
      <div className="flex items-center gap-2">
        <Play className="h-4 w-4 text-green-500" />
        <span className="font-medium text-sm text-green-600">{data.label}</span>
      </div>
      <Handle type="source" position={Position.Bottom} className="!bg-green-500 !w-2 !h-2" />
    </div>
  );
});
StartNode.displayName = 'StartNode';

export const EndNode = memo(({ data }: NodeProps<StartEndNodeData>) => {
  const isCompleted = data.status === 'completed';
  const isFailed = data.status === 'failed';

  return (
    <div
      className={cn(
        'rounded-full border-2 px-5 py-2.5 shadow-sm',
        isCompleted ? 'border-green-500 bg-green-500/10' :
          isFailed ? 'border-red-500 bg-red-500/10' :
            'border-muted-foreground/30 bg-muted/50'
      )}
      data-testid="dag-node-end"
    >
      <Handle type="target" position={Position.Top} className="!bg-primary !w-2 !h-2" />
      <div className="flex items-center gap-2">
        {isCompleted ? (
          <CheckCircle2 className="h-4 w-4 text-green-500" />
        ) : isFailed ? (
          <AlertCircle className="h-4 w-4 text-red-500" />
        ) : (
          <Circle className="h-4 w-4 text-muted-foreground" />
        )}
        <span className={cn(
          'font-medium text-sm',
          isCompleted ? 'text-green-600' : isFailed ? 'text-red-600' : 'text-muted-foreground'
        )}>
          {data.label}
        </span>
      </div>
    </div>
  );
});
EndNode.displayName = 'EndNode';

export const dagNodeTypes = {
  task: TaskNode,
  decision: DecisionNode,
  merge: MergeNode,
  start: StartNode,
  end: EndNode,
};
