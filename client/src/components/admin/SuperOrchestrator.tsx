import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  AlertTriangle, Play, Pause, Square, CheckCircle, XCircle, Clock,
  Shield, Zap, Users, Activity, ChevronDown, ChevronRight,
  BarChart3, Target, ShieldAlert, Bot, Loader2
} from "lucide-react";
import { apiFetch } from "@/lib/apiClient";

const statusColors: Record<string, string> = {
  queued: "bg-gray-500",
  planning: "bg-blue-400",
  running: "bg-green-500",
  paused: "bg-yellow-500",
  completed: "bg-green-600",
  completed_with_errors: "bg-orange-500",
  failed: "bg-red-500",
  cancelled: "bg-gray-400",
  killed: "bg-red-700",
  timed_out: "bg-orange-600",
  pending: "bg-gray-400",
  awaiting_approval: "bg-yellow-400",
  skipped: "bg-gray-300",
  denied: "bg-red-400",
};

function StatusBadge({ status }: { status: string }) {
  return (
    <Badge className={`${statusColors[status] || "bg-gray-500"} text-white text-xs`} data-testid={`badge-status-${status}`}>
      {status.replace(/_/g, " ")}
    </Badge>
  );
}

export default function SuperOrchestratorDashboard() {
  const queryClient = useQueryClient();
  const [selectedRunId, setSelectedRunId] = useState<string | null>(null);
  const [showNewRun, setShowNewRun] = useState(false);
  const [activeTab, setActiveTab] = useState<"runs" | "roles" | "governance">("runs");

  const { data: stats } = useQuery({
    queryKey: ["/api/orchestrator/stats"],
    queryFn: async () => {
      const res = await apiFetch("/api/orchestrator/stats", { credentials: "include" });
      return res.json();
    },
    refetchInterval: 5000,
  });

  const { data: runsData } = useQuery({
    queryKey: ["/api/orchestrator/runs"],
    queryFn: async () => {
      const res = await apiFetch("/api/orchestrator/runs", { credentials: "include" });
      return res.json();
    },
    refetchInterval: 5000,
  });

  const { data: roles } = useQuery({
    queryKey: ["/api/orchestrator/roles"],
    queryFn: async () => {
      const res = await apiFetch("/api/orchestrator/roles", { credentials: "include" });
      return res.json();
    },
    enabled: activeTab === "roles",
  });

  const { data: killSwitchStatus } = useQuery({
    queryKey: ["/api/orchestrator/kill-switch"],
    queryFn: async () => {
      const res = await apiFetch("/api/orchestrator/kill-switch", { credentials: "include" });
      return res.json();
    },
    refetchInterval: 3000,
  });

  const killSwitchMutation = useMutation({
    mutationFn: async (arm: boolean) => {
      const res = await apiFetch("/api/orchestrator/kill-switch", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ arm }),
        credentials: "include",
      });
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/orchestrator/kill-switch"] });
      queryClient.invalidateQueries({ queryKey: ["/api/orchestrator/stats"] });
      queryClient.invalidateQueries({ queryKey: ["/api/orchestrator/runs"] });
    },
  });

  const cancelRunMutation = useMutation({
    mutationFn: async (runId: string) => {
      const res = await apiFetch(`/api/orchestrator/runs/${runId}/cancel`, {
        method: "POST",
        credentials: "include",
      });
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/orchestrator/runs"] });
      queryClient.invalidateQueries({ queryKey: ["/api/orchestrator/stats"] });
    },
  });

  const pauseRunMutation = useMutation({
    mutationFn: async (runId: string) => {
      const res = await apiFetch(`/api/orchestrator/runs/${runId}/pause`, {
        method: "POST",
        credentials: "include",
      });
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/orchestrator/runs"] });
    },
  });

  const resumeRunMutation = useMutation({
    mutationFn: async (runId: string) => {
      const res = await apiFetch(`/api/orchestrator/runs/${runId}/resume`, {
        method: "POST",
        credentials: "include",
      });
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/orchestrator/runs"] });
    },
  });

  return (
    <div className="space-y-6" data-testid="super-orchestrator-dashboard">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold" data-testid="text-title">SuperOrchestrator v1</h2>
          <p className="text-muted-foreground">Distributed agent execution with DAG scheduling</p>
        </div>
        <div className="flex gap-2">
          <Button
            variant={killSwitchStatus?.active ? "destructive" : "outline"}
            onClick={() => killSwitchMutation.mutate(!killSwitchStatus?.active)}
            disabled={killSwitchMutation.isPending}
            data-testid="button-kill-switch"
          >
            <ShieldAlert className="h-4 w-4 mr-2" />
            {killSwitchStatus?.active ? "Disarm Kill Switch" : "Arm Kill Switch"}
          </Button>
        </div>
      </div>

      {killSwitchStatus?.active && (
        <div className="bg-red-500/10 border border-red-500/30 rounded-lg p-4 flex items-center gap-3" data-testid="alert-kill-switch">
          <AlertTriangle className="h-5 w-5 text-red-500" />
          <div>
            <p className="font-semibold text-red-500">KILL SWITCH ACTIVE</p>
            <p className="text-sm text-muted-foreground">
              All orchestrator runs are halted. Activated at {killSwitchStatus.activatedAt || "unknown"}
            </p>
          </div>
        </div>
      )}

      <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-6 gap-4">
        <Card>
          <CardContent className="pt-4">
            <div className="text-2xl font-bold" data-testid="text-total-runs">{stats?.totalRuns || 0}</div>
            <p className="text-xs text-muted-foreground">Total Runs</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4">
            <div className="text-2xl font-bold text-green-500" data-testid="text-active-runs">{stats?.activeRuns || 0}</div>
            <p className="text-xs text-muted-foreground">Active Runs</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4">
            <div className="text-2xl font-bold" data-testid="text-total-tasks">{stats?.totalTasks || 0}</div>
            <p className="text-xs text-muted-foreground">Total Tasks</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4">
            <div className="text-2xl font-bold text-green-600" data-testid="text-completed-tasks">{stats?.completedTasks || 0}</div>
            <p className="text-xs text-muted-foreground">Completed</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4">
            <div className="text-2xl font-bold text-red-500" data-testid="text-failed-tasks">{stats?.failedTasks || 0}</div>
            <p className="text-xs text-muted-foreground">Failed</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4">
            <div className="text-2xl font-bold text-yellow-500" data-testid="text-pending-approvals">{stats?.pendingApprovals || 0}</div>
            <p className="text-xs text-muted-foreground">Pending Approvals</p>
          </CardContent>
        </Card>
      </div>

      <div className="grid grid-cols-3 gap-4">
        <Card>
          <CardContent className="pt-4 flex items-center gap-3">
            <BarChart3 className="h-5 w-5 text-blue-500" />
            <div>
              <div className="text-lg font-bold">${(stats?.totalCostUsd || 0).toFixed(4)}</div>
              <p className="text-xs text-muted-foreground">Total Cost</p>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4 flex items-center gap-3">
            <Bot className="h-5 w-5 text-purple-500" />
            <div>
              <div className="text-lg font-bold" data-testid="text-available-roles">{stats?.availableRoles || 0}</div>
              <p className="text-xs text-muted-foreground">Agent Roles</p>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4 flex items-center gap-3">
            <Activity className="h-5 w-5 text-green-500" />
            <div>
              <div className="text-lg font-bold">
                {stats?.queueStats?.active || 0} / {stats?.queueStats?.waiting || 0}
              </div>
              <p className="text-xs text-muted-foreground">Queue Active / Waiting</p>
            </div>
          </CardContent>
        </Card>
      </div>

      <div className="flex gap-2 border-b border-border pb-2">
        {(["runs", "roles", "governance"] as const).map((tab) => (
          <Button
            key={tab}
            variant={activeTab === tab ? "default" : "ghost"}
            size="sm"
            onClick={() => setActiveTab(tab)}
            data-testid={`button-tab-${tab}`}
          >
            {tab === "runs" ? "Runs" : tab === "roles" ? "Agent Roles" : "Governance"}
          </Button>
        ))}
      </div>

      {activeTab === "runs" && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center justify-between">
              <span>Orchestrator Runs</span>
              <Button size="sm" onClick={() => setShowNewRun(!showNewRun)} data-testid="button-new-run">
                <Play className="h-4 w-4 mr-1" /> New Run
              </Button>
            </CardTitle>
          </CardHeader>
          <CardContent>
            {showNewRun && <NewRunForm onClose={() => setShowNewRun(false)} />}
            <div className="space-y-3 mt-4">
              {(!runsData?.runs || runsData.runs.length === 0) ? (
                <p className="text-muted-foreground text-center py-8">No runs yet</p>
              ) : (
                runsData.runs.map((run: any) => (
                  <div
                    key={run.id}
                    className="border border-border rounded-lg p-4 hover:bg-muted/30 cursor-pointer transition-colors"
                    onClick={() => setSelectedRunId(selectedRunId === run.id ? null : run.id)}
                    data-testid={`card-run-${run.id}`}
                  >
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-3">
                        {selectedRunId === run.id ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
                        <div>
                          <p className="font-medium text-sm truncate max-w-md">{run.objective}</p>
                          <p className="text-xs text-muted-foreground">
                            {run.completedTasks}/{run.totalTasks} tasks | ${(run.totalCostUsd || 0).toFixed(4)}
                          </p>
                        </div>
                      </div>
                      <div className="flex items-center gap-2">
                        <StatusBadge status={run.status} />
                        {run.status === "running" && (
                          <>
                            <Button size="sm" variant="outline" onClick={(e) => { e.stopPropagation(); pauseRunMutation.mutate(run.id); }} data-testid={`button-pause-${run.id}`}>
                              <Pause className="h-3 w-3" />
                            </Button>
                            <Button size="sm" variant="destructive" onClick={(e) => { e.stopPropagation(); cancelRunMutation.mutate(run.id); }} data-testid={`button-cancel-${run.id}`}>
                              <Square className="h-3 w-3" />
                            </Button>
                          </>
                        )}
                        {run.status === "paused" && (
                          <Button size="sm" variant="outline" onClick={(e) => { e.stopPropagation(); resumeRunMutation.mutate(run.id); }} data-testid={`button-resume-${run.id}`}>
                            <Play className="h-3 w-3" />
                          </Button>
                        )}
                      </div>
                    </div>
                    {selectedRunId === run.id && <RunDetail runId={run.id} />}
                  </div>
                ))
              )}
            </div>
          </CardContent>
        </Card>
      )}

      {activeTab === "roles" && (
        <Card>
          <CardHeader>
            <CardTitle>100 Agent Roles</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
              {(roles || []).map((role: any) => (
                <div key={role.id} className="border border-border rounded-lg p-3" data-testid={`card-role-${role.id}`}>
                  <div className="flex items-center justify-between mb-1">
                    <span className="font-medium text-sm">{role.name}</span>
                    <Badge variant="outline" className="text-xs">{role.riskLevel}</Badge>
                  </div>
                  <p className="text-xs text-muted-foreground line-clamp-2">{role.description}</p>
                  <div className="flex gap-1 mt-2 flex-wrap">
                    {(role.capabilities || []).slice(0, 3).map((cap: string, i: number) => (
                      <Badge key={i} variant="secondary" className="text-[10px]">{cap}</Badge>
                    ))}
                    {role.capabilities?.length > 3 && (
                      <Badge variant="secondary" className="text-[10px]">+{role.capabilities.length - 3}</Badge>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {activeTab === "governance" && (
        <div className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Shield className="h-5 w-5" /> Kill Switch Control
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="flex items-center justify-between">
                <div>
                  <p className="font-medium">Global Kill Switch</p>
                  <p className="text-sm text-muted-foreground">
                    Immediately halts all running tasks and drains the queue (&lt;2s SLA)
                  </p>
                </div>
                <Button
                  variant={killSwitchStatus?.active ? "default" : "destructive"}
                  onClick={() => killSwitchMutation.mutate(!killSwitchStatus?.active)}
                  disabled={killSwitchMutation.isPending}
                  data-testid="button-governance-kill-switch"
                >
                  {killSwitchMutation.isPending ? (
                    <Loader2 className="h-4 w-4 animate-spin mr-2" />
                  ) : killSwitchStatus?.active ? (
                    <CheckCircle className="h-4 w-4 mr-2" />
                  ) : (
                    <ShieldAlert className="h-4 w-4 mr-2" />
                  )}
                  {killSwitchStatus?.active ? "Disarm" : "Arm Kill Switch"}
                </Button>
              </div>
              {killSwitchStatus?.active && (
                <div className="mt-3 p-3 bg-red-500/10 border border-red-500/20 rounded-lg">
                  <p className="text-sm text-red-500 font-medium">Active since: {killSwitchStatus.activatedAt}</p>
                </div>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Target className="h-5 w-5" /> Governance Policies
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-2 gap-4">
                <div className="p-3 border border-border rounded-lg">
                  <p className="text-sm font-medium">Max Concurrent Runs/User</p>
                  <p className="text-2xl font-bold">5</p>
                </div>
                <div className="p-3 border border-border rounded-lg">
                  <p className="text-sm font-medium">Max Tasks/Run</p>
                  <p className="text-2xl font-bold">1,000</p>
                </div>
                <div className="p-3 border border-border rounded-lg">
                  <p className="text-sm font-medium">Default Budget Limit</p>
                  <p className="text-2xl font-bold">$10.00</p>
                </div>
                <div className="p-3 border border-border rounded-lg">
                  <p className="text-sm font-medium">Default Time Limit</p>
                  <p className="text-2xl font-bold">30 min</p>
                </div>
              </div>
              <div className="mt-4">
                <p className="text-sm font-medium mb-2">Risk Approval Thresholds</p>
                <div className="flex gap-2">
                  <Badge variant="outline" className="bg-green-500/10">safe: auto</Badge>
                  <Badge variant="outline" className="bg-blue-500/10">moderate: auto</Badge>
                  <Badge variant="outline" className="bg-yellow-500/10">dangerous: needs approval</Badge>
                  <Badge variant="outline" className="bg-red-500/10">critical: needs approval</Badge>
                </div>
              </div>
            </CardContent>
          </Card>
        </div>
      )}
    </div>
  );
}

function RunDetail({ runId }: { runId: string }) {
  const { data } = useQuery({
    queryKey: ["/api/orchestrator/runs", runId],
    queryFn: async () => {
      const res = await apiFetch(`/api/orchestrator/runs/${runId}`, { credentials: "include" });
      return res.json();
    },
    refetchInterval: 3000,
  });

  if (!data) return <div className="mt-3 text-sm text-muted-foreground">Loading...</div>;

  const tasks = data.tasks || [];
  const statusCounts: Record<string, number> = {};
  for (const t of tasks) {
    statusCounts[t.status] = (statusCounts[t.status] || 0) + 1;
  }

  return (
    <div className="mt-4 space-y-3 border-t border-border pt-3" data-testid={`detail-run-${runId}`}>
      <div className="flex gap-2 flex-wrap">
        {Object.entries(statusCounts).map(([status, count]) => (
          <Badge key={status} variant="outline" className="text-xs">
            {status}: {count}
          </Badge>
        ))}
      </div>
      {data.approvalsPending > 0 && (
        <div className="p-2 bg-yellow-500/10 border border-yellow-500/20 rounded-lg text-sm">
          <AlertTriangle className="h-4 w-4 inline mr-1 text-yellow-500" />
          {data.approvalsPending} tasks awaiting approval
        </div>
      )}
      <div className="space-y-2 max-h-64 overflow-y-auto">
        {tasks.map((task: any) => (
          <div key={task.id} className="flex items-center justify-between text-sm p-2 bg-muted/30 rounded" data-testid={`row-task-${task.id}`}>
            <div className="flex items-center gap-2">
              <StatusBadge status={task.status} />
              <span className="font-mono text-xs">{task.agentRole}</span>
              <span className="text-muted-foreground truncate max-w-48">{task.label}</span>
            </div>
            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              {task.durationMs && <span>{(task.durationMs / 1000).toFixed(1)}s</span>}
              {task.costUsd > 0 && <span>${task.costUsd.toFixed(4)}</span>}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function NewRunForm({ onClose }: { onClose: () => void }) {
  const queryClient = useQueryClient();
  const [objective, setObjective] = useState("");
  const [tasksJson, setTasksJson] = useState('[\n  {"agentRole": "research_web", "label": "Research topic"}\n]');

  const submitMutation = useMutation({
    mutationFn: async () => {
      const tasks = JSON.parse(tasksJson);
      const res = await apiFetch("/api/orchestrator/runs", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ objective, tasks }),
        credentials: "include",
      });
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/orchestrator/runs"] });
      queryClient.invalidateQueries({ queryKey: ["/api/orchestrator/stats"] });
      onClose();
    },
  });

  return (
    <div className="border border-border rounded-lg p-4 space-y-3" data-testid="form-new-run">
      <Input
        placeholder="Run objective..."
        value={objective}
        onChange={(e) => setObjective(e.target.value)}
        data-testid="input-objective"
      />
      <Textarea
        placeholder="Tasks JSON array..."
        value={tasksJson}
        onChange={(e) => setTasksJson(e.target.value)}
        rows={6}
        className="font-mono text-xs"
        data-testid="textarea-tasks"
      />
      <div className="flex gap-2 justify-end">
        <Button variant="outline" size="sm" onClick={onClose} data-testid="button-cancel-new-run">Cancel</Button>
        <Button
          size="sm"
          onClick={() => submitMutation.mutate()}
          disabled={!objective || submitMutation.isPending}
          data-testid="button-submit-run"
        >
          {submitMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin mr-1" /> : <Play className="h-4 w-4 mr-1" />}
          Submit Run
        </Button>
      </div>
      {submitMutation.isError && (
        <p className="text-sm text-red-500">{(submitMutation.error as Error)?.message}</p>
      )}
    </div>
  );
}
