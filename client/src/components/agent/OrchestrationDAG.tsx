import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import ReactFlow, {
  Background,
  Controls,
  MiniMap,
  useNodesState,
  useEdgesState,
  MarkerType,
  type Node,
  type Edge,
  type NodeMouseHandler,
} from 'reactflow';
import 'reactflow/dist/style.css';
import { dagNodeTypes, type DAGNodeStatus, type TaskNodeData } from './DAGNodeTypes';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription } from '@/components/ui/sheet';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { cn } from '@/lib/utils';
import {
  Loader2,
  CheckCircle2,
  AlertCircle,
  Clock,
  Activity,
  Maximize2,
  X,
  FileText,
  Terminal,
  Zap,
} from 'lucide-react';

interface DAGTask {
  id: string;
  label: string;
  description: string;
  status: DAGNodeStatus;
  progress: number;
  type: 'task' | 'decision' | 'merge' | 'start' | 'end';
  dependsOn: string[];
  agentName?: string;
  toolHint?: string;
  complexity?: string;
  estimatedTokens?: number;
  durationMs?: number;
  error?: string;
  inputs?: Record<string, any>;
  outputs?: Record<string, any>;
  logs?: string[];
  riskLevel?: 'low' | 'medium' | 'high';
  condition?: string;
  result?: string;
  inputCount?: number;
  completedInputs?: number;
  aggregationType?: string;
}

interface DAGState {
  runId: string;
  objective: string;
  status: 'pending' | 'running' | 'completed' | 'failed';
  tasks: DAGTask[];
  startedAt?: number;
  completedAt?: number;
  totalTokens?: number;
}

interface OrchestrationDAGProps {
  runId: string;
  className?: string;
}

function buildNodesAndEdges(
  state: DAGState,
  onInspect: (nodeId: string) => void,
): { nodes: Node[]; edges: Edge[] } {
  const nodes: Node[] = [];
  const edges: Edge[] = [];
  const taskMap = new Map(state.tasks.map(t => [t.id, t]));

  const nodesByDepth = new Map<number, string[]>();
  const depthMap = new Map<string, number>();

  const computeDepth = (id: string, visited = new Set<string>()): number => {
    if (depthMap.has(id)) return depthMap.get(id)!;
    if (visited.has(id)) return 0;
    visited.add(id);

    const task = taskMap.get(id);
    if (!task || task.dependsOn.length === 0) {
      depthMap.set(id, 0);
      return 0;
    }

    const maxParent = Math.max(
      ...task.dependsOn.map(dep => computeDepth(dep, visited) + 1)
    );
    depthMap.set(id, maxParent);
    return maxParent;
  };

  for (const task of state.tasks) {
    const depth = computeDepth(task.id);
    if (!nodesByDepth.has(depth)) nodesByDepth.set(depth, []);
    nodesByDepth.get(depth)!.push(task.id);
  }

  const maxDepth = Math.max(...Array.from(nodesByDepth.keys()), 0);
  const X_SPACING = 320;
  const Y_SPACING = 160;

  nodes.push({
    id: '__start__',
    type: 'start',
    position: { x: 0, y: -Y_SPACING },
    data: { label: 'Start', status: 'completed' as DAGNodeStatus },
    draggable: true,
  });

  for (const [depth, taskIds] of nodesByDepth) {
    const totalWidth = (taskIds.length - 1) * X_SPACING;
    const startX = -totalWidth / 2;

    taskIds.forEach((taskId, idx) => {
      const task = taskMap.get(taskId)!;
      const x = startX + idx * X_SPACING;
      const y = depth * Y_SPACING;

      const nodeData: any = {
        label: task.label,
        description: task.description,
        status: task.status,
        onInspect,
      };

      if (task.type === 'task') {
        nodeData.progress = task.progress;
        nodeData.agentName = task.agentName;
        nodeData.toolHint = task.toolHint;
        nodeData.complexity = task.complexity;
        nodeData.estimatedTokens = task.estimatedTokens;
        nodeData.durationMs = task.durationMs;
        nodeData.error = task.error;
        nodeData.inputs = task.inputs;
        nodeData.outputs = task.outputs;
        nodeData.logs = task.logs;
      } else if (task.type === 'decision') {
        nodeData.riskLevel = task.riskLevel || 'low';
        nodeData.condition = task.condition;
        nodeData.result = task.result;
      } else if (task.type === 'merge') {
        nodeData.inputCount = task.inputCount || task.dependsOn.length;
        nodeData.completedInputs = task.completedInputs || 0;
        nodeData.aggregationType = task.aggregationType;
      }

      nodes.push({
        id: taskId,
        type: task.type === 'start' || task.type === 'end' ? task.type : task.type,
        position: { x, y },
        data: nodeData,
        draggable: true,
      });
    });
  }

  const rootTasks = state.tasks.filter(t => t.dependsOn.length === 0);
  for (const rt of rootTasks) {
    edges.push({
      id: `__start__->${rt.id}`,
      source: '__start__',
      target: rt.id,
      animated: rt.status === 'running',
      style: { stroke: rt.status === 'running' ? '#3b82f6' : '#6b7280', strokeWidth: 2 },
      markerEnd: { type: MarkerType.ArrowClosed, width: 12, height: 12 },
    });
  }

  for (const task of state.tasks) {
    for (const dep of task.dependsOn) {
      const depTask = taskMap.get(dep);
      const isActive = task.status === 'running' || (depTask?.status === 'completed' && task.status === 'pending');

      edges.push({
        id: `${dep}->${task.id}`,
        source: dep,
        target: task.id,
        animated: task.status === 'running',
        style: {
          stroke: task.status === 'running' ? '#3b82f6' :
            depTask?.status === 'completed' ? '#22c55e' :
              task.status === 'failed' ? '#ef4444' : '#6b7280',
          strokeWidth: isActive ? 2.5 : 1.5,
        },
        markerEnd: { type: MarkerType.ArrowClosed, width: 12, height: 12 },
      });
    }
  }

  const leafTasks = state.tasks.filter(t => {
    return !state.tasks.some(other => other.dependsOn.includes(t.id));
  });

  if (leafTasks.length > 0) {
    const endY = (maxDepth + 1) * Y_SPACING;
    const endStatus: DAGNodeStatus = state.status === 'completed' ? 'completed' :
      state.status === 'failed' ? 'failed' : 'pending';

    nodes.push({
      id: '__end__',
      type: 'end',
      position: { x: 0, y: endY },
      data: { label: 'End', status: endStatus },
      draggable: true,
    });

    for (const lt of leafTasks) {
      edges.push({
        id: `${lt.id}->__end__`,
        source: lt.id,
        target: '__end__',
        animated: lt.status === 'running',
        style: { stroke: lt.status === 'completed' ? '#22c55e' : '#6b7280', strokeWidth: 1.5 },
        markerEnd: { type: MarkerType.ArrowClosed, width: 12, height: 12 },
      });
    }
  }

  return { nodes, edges };
}

export default function OrchestrationDAG({ runId, className }: OrchestrationDAGProps) {
  const [dagState, setDagState] = useState<DAGState | null>(null);
  const [nodes, setNodes, onNodesChange] = useNodesState([]);
  const [edges, setEdges, onEdgesChange] = useEdgesState([]);
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  const [connectionStatus, setConnectionStatus] = useState<'connecting' | 'connected' | 'disconnected' | 'error'>('connecting');
  const eventSourceRef = useRef<EventSource | null>(null);

  const handleInspect = useCallback((nodeId: string) => {
    setSelectedNodeId(nodeId);
  }, []);

  useEffect(() => {
    if (!dagState) return;
    const { nodes: newNodes, edges: newEdges } = buildNodesAndEdges(dagState, handleInspect);
    setNodes(newNodes);
    setEdges(newEdges);
  }, [dagState, handleInspect, setNodes, setEdges]);

  useEffect(() => {
    if (!runId) return;

    setConnectionStatus('connecting');

    const baseUrl = window.location.origin;
    const es = new EventSource(`${baseUrl}/api/agent/dag/${runId}/stream`);
    eventSourceRef.current = es;

    es.onopen = () => {
      setConnectionStatus('connected');
    };

    es.addEventListener('dag_init', (event) => {
      try {
        const data = JSON.parse(event.data);
        setDagState(data);
      } catch (e) {
        console.error('[OrchestrationDAG] Failed to parse dag_init:', e);
      }
    });

    es.addEventListener('task_update', (event) => {
      try {
        const update = JSON.parse(event.data);
        setDagState(prev => {
          if (!prev) return prev;
          return {
            ...prev,
            tasks: prev.tasks.map(t =>
              t.id === update.taskId ? { ...t, ...update.changes } : t
            ),
            status: update.runStatus || prev.status,
          };
        });
      } catch (e) {
        console.error('[OrchestrationDAG] Failed to parse task_update:', e);
      }
    });

    es.addEventListener('dag_complete', (event) => {
      try {
        const data = JSON.parse(event.data);
        setDagState(prev => prev ? { ...prev, ...data } : prev);
        setConnectionStatus('disconnected');
        es.close();
      } catch (e) {
        console.error('[OrchestrationDAG] Failed to parse dag_complete:', e);
      }
    });

    es.onerror = () => {
      if (es.readyState === EventSource.CLOSED) {
        setConnectionStatus('disconnected');
      } else {
        setConnectionStatus('error');
      }
    };

    return () => {
      es.close();
      eventSourceRef.current = null;
    };
  }, [runId]);

  const selectedTask = useMemo(() => {
    if (!selectedNodeId || !dagState) return null;
    return dagState.tasks.find(t => t.id === selectedNodeId) || null;
  }, [selectedNodeId, dagState]);

  const stats = useMemo(() => {
    if (!dagState) return null;
    const tasks = dagState.tasks;
    return {
      total: tasks.length,
      completed: tasks.filter(t => t.status === 'completed').length,
      running: tasks.filter(t => t.status === 'running').length,
      failed: tasks.filter(t => t.status === 'failed').length,
      pending: tasks.filter(t => t.status === 'pending').length,
    };
  }, [dagState]);

  if (!dagState) {
    return (
      <div className={cn('flex items-center justify-center h-full min-h-[400px]', className)} data-testid="dag-loading">
        <div className="flex flex-col items-center gap-3">
          <Loader2 className="h-8 w-8 animate-spin text-primary" />
          <span className="text-sm text-muted-foreground">
            {connectionStatus === 'connecting' ? 'Connecting to DAG stream...' :
              connectionStatus === 'error' ? 'Connection error. Retrying...' :
                'Loading orchestration DAG...'}
          </span>
        </div>
      </div>
    );
  }

  return (
    <div className={cn('flex flex-col h-full', className)} data-testid="orchestration-dag">
      <div className="flex items-center justify-between px-4 py-3 border-b shrink-0">
        <div className="flex items-center gap-3">
          <div className="space-y-0.5">
            <h2 className="text-sm font-semibold flex items-center gap-2" data-testid="text-dag-objective">
              {dagState.objective}
              <DAGStatusBadge status={dagState.status} />
            </h2>
            <p className="text-xs text-muted-foreground" data-testid="text-dag-run-id">
              Run: {runId.slice(0, 8)}...
            </p>
          </div>
        </div>

        {stats && (
          <div className="flex items-center gap-3 text-xs" data-testid="dag-stats">
            <div className="flex items-center gap-1">
              <CheckCircle2 className="h-3.5 w-3.5 text-green-500" />
              <span>{stats.completed}/{stats.total}</span>
            </div>
            {stats.running > 0 && (
              <div className="flex items-center gap-1">
                <Loader2 className="h-3.5 w-3.5 text-blue-500 animate-spin" />
                <span>{stats.running}</span>
              </div>
            )}
            {stats.failed > 0 && (
              <div className="flex items-center gap-1">
                <AlertCircle className="h-3.5 w-3.5 text-red-500" />
                <span>{stats.failed}</span>
              </div>
            )}
            <ConnectionIndicator status={connectionStatus} />
          </div>
        )}
      </div>

      <div className="flex-1 min-h-0" data-testid="dag-canvas">
        <ReactFlow
          nodes={nodes}
          edges={edges}
          onNodesChange={onNodesChange}
          onEdgesChange={onEdgesChange}
          nodeTypes={dagNodeTypes}
          fitView
          fitViewOptions={{ padding: 0.3 }}
          minZoom={0.1}
          maxZoom={2}
          attributionPosition="bottom-left"
          proOptions={{ hideAttribution: true }}
        >
          <Background gap={20} size={1} />
          <Controls showInteractive={false} />
          <MiniMap
            nodeColor={(node) => {
              const status = node.data?.status as DAGNodeStatus | undefined;
              if (status === 'completed') return '#22c55e';
              if (status === 'running') return '#3b82f6';
              if (status === 'failed') return '#ef4444';
              return '#6b7280';
            }}
            maskColor="rgba(0,0,0,0.1)"
            className="!bg-background/80 !border-border"
          />
        </ReactFlow>
      </div>

      <Sheet open={!!selectedNodeId} onOpenChange={(open) => { if (!open) setSelectedNodeId(null); }}>
        <SheetContent side="right" className="w-[400px] sm:w-[480px]">
          {selectedTask && (
            <>
              <SheetHeader>
                <SheetTitle className="flex items-center gap-2" data-testid="text-inspect-title">
                  {selectedTask.label}
                  <DAGNodeStatusBadge status={selectedTask.status} />
                </SheetTitle>
                <SheetDescription>{selectedTask.description}</SheetDescription>
              </SheetHeader>

              <Tabs defaultValue="details" className="mt-4">
                <TabsList className="grid w-full grid-cols-3 h-8">
                  <TabsTrigger value="details" className="text-xs gap-1" data-testid="tab-details">
                    <Activity className="h-3 w-3" />
                    Details
                  </TabsTrigger>
                  <TabsTrigger value="io" className="text-xs gap-1" data-testid="tab-io">
                    <FileText className="h-3 w-3" />
                    I/O
                  </TabsTrigger>
                  <TabsTrigger value="logs" className="text-xs gap-1" data-testid="tab-logs">
                    <Terminal className="h-3 w-3" />
                    Logs
                  </TabsTrigger>
                </TabsList>

                <TabsContent value="details" className="mt-3 space-y-3">
                  <div className="grid grid-cols-2 gap-2 text-sm">
                    <div className="space-y-1">
                      <span className="text-xs text-muted-foreground">Status</span>
                      <p className="font-medium">{selectedTask.status}</p>
                    </div>
                    <div className="space-y-1">
                      <span className="text-xs text-muted-foreground">Type</span>
                      <p className="font-medium">{selectedTask.type}</p>
                    </div>
                    {selectedTask.agentName && (
                      <div className="space-y-1">
                        <span className="text-xs text-muted-foreground">Agent</span>
                        <p className="font-medium">{selectedTask.agentName}</p>
                      </div>
                    )}
                    {selectedTask.toolHint && (
                      <div className="space-y-1">
                        <span className="text-xs text-muted-foreground">Tool</span>
                        <p className="font-medium">{selectedTask.toolHint}</p>
                      </div>
                    )}
                    {selectedTask.complexity && (
                      <div className="space-y-1">
                        <span className="text-xs text-muted-foreground">Complexity</span>
                        <p className="font-medium capitalize">{selectedTask.complexity}</p>
                      </div>
                    )}
                    {selectedTask.durationMs !== undefined && (
                      <div className="space-y-1">
                        <span className="text-xs text-muted-foreground">Duration</span>
                        <p className="font-medium">
                          {selectedTask.durationMs < 1000
                            ? `${selectedTask.durationMs}ms`
                            : `${(selectedTask.durationMs / 1000).toFixed(1)}s`}
                        </p>
                      </div>
                    )}
                    {selectedTask.estimatedTokens && (
                      <div className="space-y-1">
                        <span className="text-xs text-muted-foreground">Est. Tokens</span>
                        <p className="font-medium">{selectedTask.estimatedTokens}</p>
                      </div>
                    )}
                  </div>
                  {selectedTask.dependsOn.length > 0 && (
                    <div className="space-y-1">
                      <span className="text-xs text-muted-foreground">Dependencies</span>
                      <div className="flex flex-wrap gap-1">
                        {selectedTask.dependsOn.map(dep => (
                          <Badge key={dep} variant="outline" className="text-xs cursor-pointer" onClick={() => setSelectedNodeId(dep)}>
                            {dagState.tasks.find(t => t.id === dep)?.label || dep}
                          </Badge>
                        ))}
                      </div>
                    </div>
                  )}
                  {selectedTask.error && (
                    <div className="p-3 rounded bg-red-500/10 text-red-500 text-sm">
                      <AlertCircle className="h-4 w-4 inline mr-1" />
                      {selectedTask.error}
                    </div>
                  )}
                </TabsContent>

                <TabsContent value="io" className="mt-3 space-y-3">
                  {selectedTask.inputs && Object.keys(selectedTask.inputs).length > 0 && (
                    <div className="space-y-1">
                      <span className="text-xs text-muted-foreground font-medium">Inputs</span>
                      <ScrollArea className="h-[200px] rounded border bg-muted/30 p-3">
                        <pre className="text-xs font-mono whitespace-pre-wrap">
                          {JSON.stringify(selectedTask.inputs, null, 2)}
                        </pre>
                      </ScrollArea>
                    </div>
                  )}
                  {selectedTask.outputs && Object.keys(selectedTask.outputs).length > 0 && (
                    <div className="space-y-1">
                      <span className="text-xs text-muted-foreground font-medium">Outputs</span>
                      <ScrollArea className="h-[200px] rounded border bg-muted/30 p-3">
                        <pre className="text-xs font-mono whitespace-pre-wrap">
                          {JSON.stringify(selectedTask.outputs, null, 2)}
                        </pre>
                      </ScrollArea>
                    </div>
                  )}
                  {(!selectedTask.inputs || Object.keys(selectedTask.inputs).length === 0) &&
                    (!selectedTask.outputs || Object.keys(selectedTask.outputs).length === 0) && (
                      <p className="text-sm text-muted-foreground text-center py-6">No input/output data available yet</p>
                    )}
                </TabsContent>

                <TabsContent value="logs" className="mt-3">
                  {selectedTask.logs && selectedTask.logs.length > 0 ? (
                    <ScrollArea className="h-[300px] rounded border bg-black p-3">
                      <div className="font-mono text-xs text-green-400 space-y-0.5">
                        {selectedTask.logs.map((log, i) => (
                          <div key={i} className="text-gray-300 whitespace-pre-wrap">{log}</div>
                        ))}
                      </div>
                    </ScrollArea>
                  ) : (
                    <p className="text-sm text-muted-foreground text-center py-6">No logs available</p>
                  )}
                </TabsContent>
              </Tabs>
            </>
          )}
        </SheetContent>
      </Sheet>
    </div>
  );
}

function DAGStatusBadge({ status }: { status: string }) {
  const variants: Record<string, "default" | "secondary" | "destructive" | "outline"> = {
    completed: "default",
    running: "default",
    failed: "destructive",
    pending: "outline",
  };

  return (
    <Badge
      variant={variants[status] || "outline"}
      className={cn(
        'text-[10px]',
        status === 'completed' && 'bg-green-500 hover:bg-green-600 border-transparent',
        status === 'running' && 'bg-blue-500 hover:bg-blue-600 border-transparent animate-pulse'
      )}
      data-testid={`badge-dag-status-${status}`}
    >
      {status}
    </Badge>
  );
}

function DAGNodeStatusBadge({ status }: { status: DAGNodeStatus }) {
  const config: Record<DAGNodeStatus, { color: string; label: string }> = {
    pending: { color: 'bg-muted text-muted-foreground', label: 'Pending' },
    running: { color: 'bg-blue-500/10 text-blue-500', label: 'Running' },
    completed: { color: 'bg-green-500/10 text-green-500', label: 'Completed' },
    failed: { color: 'bg-red-500/10 text-red-500', label: 'Failed' },
    cancelled: { color: 'bg-gray-500/10 text-gray-400', label: 'Cancelled' },
  };

  return (
    <Badge variant="outline" className={cn('text-[10px]', config[status].color)}>
      {config[status].label}
    </Badge>
  );
}

function ConnectionIndicator({ status }: { status: string }) {
  return (
    <div className="flex items-center gap-1" data-testid="dag-connection-status">
      <div className={cn(
        'w-1.5 h-1.5 rounded-full',
        status === 'connected' && 'bg-green-500',
        status === 'connecting' && 'bg-yellow-500 animate-pulse',
        status === 'disconnected' && 'bg-gray-400',
        status === 'error' && 'bg-red-500',
      )} />
      <span className="text-[10px] text-muted-foreground capitalize">{status}</span>
    </div>
  );
}
