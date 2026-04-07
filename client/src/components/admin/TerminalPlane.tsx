import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  Card, CardContent, CardHeader, CardTitle
} from "@/components/ui/card";
import {
  Terminal,
  Shield,
  ShieldAlert,
  Activity,
  AlertTriangle,
  RefreshCw,
  Loader2,
  Clock,
  Play,
  Filter,
  ChevronDown,
  ChevronUp,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { apiFetchJson, apiFetchJsonNullable } from "@/lib/adminApi";
import { toast } from "sonner";

interface AuditEntry {
  id: string;
  timestamp: number;
  userId: string;
  role: string;
  action: string;
  command?: string;
  host: string;
  exitCode?: number;
  durationMs: number;
  allowed: boolean;
  deniedReason?: string;
}

interface TerminalStats {
  totalExecutions: number;
  allowedExecutions: number;
  deniedExecutions: number;
  averageDurationMs: number;
  topCommands: { command: string; count: number }[];
  riskBreakdown: Record<string, number>;
}

interface ComputerControlStatus {
  killSwitch: {
    armed: boolean;
    armedAt: number | null;
    armedBy: string | null;
    reason: string | null;
    activationsCount: number;
  };
  activeRuns: string[];
  activeRunCount: number;
}

function RiskBadge({ level }: { level: string }) {
  const colors: Record<string, string> = {
    safe: "bg-green-500/10 text-green-700 border-green-500/20",
    moderate: "bg-yellow-500/10 text-yellow-700 border-yellow-500/20",
    dangerous: "bg-orange-500/10 text-orange-700 border-orange-500/20",
    critical: "bg-red-500/10 text-red-700 border-red-500/20",
  };
  return (
    <Badge variant="outline" className={cn("text-xs", colors[level] || "")}>
      {level}
    </Badge>
  );
}

export default function TerminalPlane() {
  const queryClient = useQueryClient();
  const [auditFilter, setAuditFilter] = useState<string>("all");
  const [auditSearch, setAuditSearch] = useState("");
  const [expandedEntry, setExpandedEntry] = useState<string | null>(null);

  const { data: stats, isLoading: statsLoading } = useQuery<TerminalStats>({
    queryKey: ["/api/terminal-plane/stats"],
    queryFn: () => apiFetchJson("/api/terminal-plane/stats"),
    refetchInterval: 15000,
    throwOnError: true,
  });

  const { data: audit, isLoading: auditLoading } = useQuery<AuditEntry[]>({
    queryKey: ["/api/terminal-plane/audit"],
    queryFn: () => apiFetchJson("/api/terminal-plane/audit"),
    refetchInterval: 10000,
    throwOnError: true,
  });

  const { data: controlStatus, isLoading: controlLoading } = useQuery<ComputerControlStatus>({
    queryKey: ["/api/computer-control/status"],
    queryFn: () => apiFetchJson("/api/computer-control/status"),
    refetchInterval: 5000,
    throwOnError: true,
  });

  const killSwitchMutation = useMutation({
    mutationFn: async ({ arm, reason }: { arm: boolean; reason: string }) => {
      return apiFetchJson<{ event?: { type?: string } }>("/api/computer-control/kill-switch", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ arm, reason }),
        credentials: "include",
      });
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ["/api/computer-control/status"] });
      toast.success(data.event?.type === "armed" ? "Kill switch armed" : "Kill switch disarmed");
    },
    onError: () => {
      toast.error("Failed to toggle kill switch");
    },
  });

  const execMutation = useMutation({
    mutationFn: async ({ command, confirmed }: { command: string; confirmed?: boolean }) => {
      return apiFetchJsonNullable<any>("/api/terminal-plane/exec", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ command, confirmed: confirmed || false }),
        credentials: "include",
      });
    },
    onSuccess: (data) => {
      if (data?.requiresConfirmation) {
        if (window.confirm(`⚠️ High-risk command detected:\n\n${data.command}\n\nRisk: ${data.riskLevel}\n${data.message}\n\nProceed?`)) {
          execMutation.mutate({ command: data.command, confirmed: true });
        }
        return;
      }
      queryClient.invalidateQueries({ queryKey: ["/api/terminal-plane/audit"] });
      queryClient.invalidateQueries({ queryKey: ["/api/terminal-plane/stats"] });
    },
  });

  const [commandInput, setCommandInput] = useState("");

  const filteredAudit = (audit || []).filter((entry) => {
    if (auditFilter === "allowed" && !entry.allowed) return false;
    if (auditFilter === "denied" && entry.allowed) return false;
    if (auditSearch && !entry.command?.toLowerCase().includes(auditSearch.toLowerCase()) && !entry.action.toLowerCase().includes(auditSearch.toLowerCase())) return false;
    return true;
  });

  const killSwitchArmed = controlStatus?.killSwitch?.armed ?? false;

  return (
    <div className="space-y-6" data-testid="terminal-plane-dashboard">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-medium flex items-center gap-2">
            <Terminal className="h-5 w-5" />
            Terminal & Computer Control Plane
          </h2>
          <p className="text-sm text-muted-foreground">
            Monitor terminal executions, audit logs, and computer control status
          </p>
        </div>
        <Button
          variant="ghost"
          size="sm"
          onClick={() => {
            queryClient.invalidateQueries({ queryKey: ["/api/terminal-plane/stats"] });
            queryClient.invalidateQueries({ queryKey: ["/api/terminal-plane/audit"] });
            queryClient.invalidateQueries({ queryKey: ["/api/computer-control/status"] });
          }}
          data-testid="button-refresh-terminal"
        >
          <RefreshCw className="h-4 w-4" />
        </Button>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        <Card data-testid="card-total-executions">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground flex items-center gap-2">
              <Play className="h-4 w-4" />
              Total Executions
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-2xl font-bold" data-testid="text-total-executions">
              {statsLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : stats?.totalExecutions ?? 0}
            </p>
          </CardContent>
        </Card>

        <Card data-testid="card-allowed-executions">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground flex items-center gap-2">
              <Shield className="h-4 w-4 text-green-500" />
              Allowed
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-2xl font-bold text-green-600" data-testid="text-allowed-executions">
              {statsLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : stats?.allowedExecutions ?? 0}
            </p>
          </CardContent>
        </Card>

        <Card data-testid="card-denied-executions">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground flex items-center gap-2">
              <ShieldAlert className="h-4 w-4 text-red-500" />
              Denied
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-2xl font-bold text-red-600" data-testid="text-denied-executions">
              {statsLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : stats?.deniedExecutions ?? 0}
            </p>
          </CardContent>
        </Card>

        <Card data-testid="card-avg-duration">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground flex items-center gap-2">
              <Clock className="h-4 w-4" />
              Avg Duration
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-2xl font-bold" data-testid="text-avg-duration">
              {statsLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : `${(stats?.averageDurationMs ?? 0).toFixed(0)}ms`}
            </p>
          </CardContent>
        </Card>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <Card className="lg:col-span-1" data-testid="card-kill-switch">
          <CardHeader>
            <CardTitle className="text-sm font-medium flex items-center gap-2">
              <AlertTriangle className={cn("h-4 w-4", killSwitchArmed ? "text-red-500" : "text-green-500")} />
              Kill Switch
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-medium" data-testid="text-kill-switch-status">
                  Status: {killSwitchArmed ? "ARMED" : "DISARMED"}
                </p>
                {killSwitchArmed && controlStatus?.killSwitch?.reason && (
                  <p className="text-xs text-muted-foreground mt-1">
                    Reason: {controlStatus.killSwitch.reason}
                  </p>
                )}
                {killSwitchArmed && controlStatus?.killSwitch?.armedBy && (
                  <p className="text-xs text-muted-foreground">
                    By: {controlStatus.killSwitch.armedBy}
                  </p>
                )}
              </div>
              <Switch
                checked={killSwitchArmed}
                onCheckedChange={(checked) => {
                  killSwitchMutation.mutate({
                    arm: checked,
                    reason: checked ? "Manual arm from admin dashboard" : "Manual disarm from admin dashboard",
                  });
                }}
                data-testid="switch-kill-switch"
              />
            </div>

            <div className="border-t pt-3 space-y-2">
              <div className="flex items-center justify-between text-sm">
                <span className="text-muted-foreground">Active Runs</span>
                <Badge variant="secondary" data-testid="text-active-runs">
                  {controlLoading ? "..." : controlStatus?.activeRunCount ?? 0}
                </Badge>
              </div>
              <div className="flex items-center justify-between text-sm">
                <span className="text-muted-foreground">Total Activations</span>
                <span data-testid="text-activations-count">
                  {controlStatus?.killSwitch?.activationsCount ?? 0}
                </span>
              </div>
            </div>

            {(controlStatus?.activeRuns?.length ?? 0) > 0 && (
              <div className="border-t pt-3">
                <p className="text-xs font-medium mb-2">Active Run IDs:</p>
                <div className="space-y-1">
                  {controlStatus?.activeRuns?.map((runId) => (
                    <div key={runId} className="text-xs font-mono bg-muted px-2 py-1 rounded" data-testid={`text-run-${runId}`}>
                      {runId}
                    </div>
                  ))}
                </div>
              </div>
            )}
          </CardContent>
        </Card>

        <Card className="lg:col-span-2" data-testid="card-risk-breakdown">
          <CardHeader>
            <CardTitle className="text-sm font-medium flex items-center gap-2">
              <Activity className="h-4 w-4" />
              Risk Classification Breakdown
            </CardTitle>
          </CardHeader>
          <CardContent>
            {statsLoading ? (
              <Loader2 className="h-6 w-6 animate-spin" />
            ) : (
              <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                {Object.entries(stats?.riskBreakdown ?? { safe: 0, moderate: 0, dangerous: 0, critical: 0 }).map(([level, count]) => (
                  <div key={level} className="text-center p-3 rounded-lg border" data-testid={`card-risk-${level}`}>
                    <RiskBadge level={level} />
                    <p className="text-2xl font-bold mt-2" data-testid={`text-risk-count-${level}`}>{count}</p>
                    <p className="text-xs text-muted-foreground capitalize">{level}</p>
                  </div>
                ))}
              </div>
            )}

            {stats?.topCommands && stats.topCommands.length > 0 && (
              <div className="mt-4 border-t pt-4">
                <p className="text-xs font-medium mb-2">Top Commands</p>
                <div className="space-y-1">
                  {stats.topCommands.slice(0, 5).map((cmd, i) => (
                    <div key={i} className="flex items-center justify-between text-xs" data-testid={`text-top-command-${i}`}>
                      <code className="font-mono bg-muted px-1.5 py-0.5 rounded truncate max-w-[300px]">
                        {cmd.command}
                      </code>
                      <Badge variant="secondary">{cmd.count}</Badge>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      <Card data-testid="card-command-exec">
        <CardHeader>
          <CardTitle className="text-sm font-medium flex items-center gap-2">
            <Terminal className="h-4 w-4" />
            Execute Command
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex gap-2">
            <Input
              placeholder="Enter command..."
              value={commandInput}
              onChange={(e) => setCommandInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && commandInput.trim()) {
                  execMutation.mutate({ command: commandInput.trim() });
                  setCommandInput("");
                }
              }}
              data-testid="input-command"
            />
            <Button
              onClick={() => {
                if (commandInput.trim()) {
                  execMutation.mutate({ command: commandInput.trim() });
                  setCommandInput("");
                }
              }}
              disabled={execMutation.isPending || !commandInput.trim()}
              data-testid="button-exec-command"
            >
              {execMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Play className="h-4 w-4" />}
            </Button>
          </div>
          {execMutation.data && (
            <div className="mt-3 p-3 rounded-lg border bg-muted/50" data-testid="text-exec-result">
              <div className="flex items-center gap-2 mb-1">
                <Badge variant={execMutation.data.success ? "default" : "destructive"}>
                  {execMutation.data.success ? "Success" : "Failed"}
                </Badge>
                {execMutation.data.exitCode !== undefined && (
                  <span className="text-xs text-muted-foreground">exit: {execMutation.data.exitCode}</span>
                )}
                {execMutation.data.durationMs !== undefined && (
                  <span className="text-xs text-muted-foreground">{execMutation.data.durationMs}ms</span>
                )}
              </div>
              {execMutation.data.stdout && (
                <pre className="text-xs font-mono whitespace-pre-wrap max-h-40 overflow-auto mt-1">{execMutation.data.stdout}</pre>
              )}
              {execMutation.data.stderr && (
                <pre className="text-xs font-mono text-red-500 whitespace-pre-wrap max-h-20 overflow-auto mt-1">{execMutation.data.stderr}</pre>
              )}
              {execMutation.data.error && (
                <p className="text-xs text-red-500 mt-1">{execMutation.data.error}</p>
              )}
            </div>
          )}
        </CardContent>
      </Card>

      <Card data-testid="card-audit-log">
        <CardHeader>
          <CardTitle className="text-sm font-medium flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Shield className="h-4 w-4" />
              Audit Log
            </div>
            <div className="flex items-center gap-2">
              <Input
                placeholder="Search..."
                className="h-8 w-40"
                value={auditSearch}
                onChange={(e) => setAuditSearch(e.target.value)}
                data-testid="input-audit-search"
              />
              <Select value={auditFilter} onValueChange={setAuditFilter}>
                <SelectTrigger className="h-8 w-32" data-testid="select-audit-filter">
                  <Filter className="h-3 w-3 mr-1" />
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All</SelectItem>
                  <SelectItem value="allowed">Allowed</SelectItem>
                  <SelectItem value="denied">Denied</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </CardTitle>
        </CardHeader>
        <CardContent>
          {auditLoading ? (
            <div className="flex justify-center py-8">
              <Loader2 className="h-6 w-6 animate-spin" />
            </div>
          ) : filteredAudit.length === 0 ? (
            <p className="text-sm text-muted-foreground text-center py-8" data-testid="text-no-audit-entries">
              No audit entries found
            </p>
          ) : (
            <ScrollArea className="h-[400px]">
              <div className="space-y-1">
                {filteredAudit.map((entry) => (
                  <div
                    key={entry.id}
                    className={cn(
                      "rounded-lg border p-3 text-sm cursor-pointer hover:bg-muted/50 transition-colors",
                      !entry.allowed && "border-red-500/20 bg-red-500/5"
                    )}
                    onClick={() => setExpandedEntry(expandedEntry === entry.id ? null : entry.id)}
                    data-testid={`audit-entry-${entry.id}`}
                  >
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <Badge variant={entry.allowed ? "secondary" : "destructive"} className="text-xs">
                          {entry.allowed ? "ALLOWED" : "DENIED"}
                        </Badge>
                        <span className="font-medium">{entry.action}</span>
                        {entry.command && (
                          <code className="text-xs bg-muted px-1.5 py-0.5 rounded font-mono truncate max-w-[250px]">
                            {entry.command}
                          </code>
                        )}
                      </div>
                      <div className="flex items-center gap-2">
                        <span className="text-xs text-muted-foreground">
                          {new Date(entry.timestamp).toLocaleTimeString()}
                        </span>
                        {expandedEntry === entry.id ? (
                          <ChevronUp className="h-3 w-3" />
                        ) : (
                          <ChevronDown className="h-3 w-3" />
                        )}
                      </div>
                    </div>
                    {expandedEntry === entry.id && (
                      <div className="mt-2 pt-2 border-t space-y-1 text-xs text-muted-foreground">
                        <div className="grid grid-cols-2 gap-2">
                          <div>User: <span className="font-mono">{entry.userId}</span></div>
                          <div>Role: <Badge variant="outline" className="text-xs">{entry.role}</Badge></div>
                          <div>Host: {entry.host}</div>
                          <div>Duration: {entry.durationMs}ms</div>
                          {entry.exitCode !== undefined && <div>Exit Code: {entry.exitCode}</div>}
                          {entry.deniedReason && (
                            <div className="col-span-2 text-red-500">Reason: {entry.deniedReason}</div>
                          )}
                        </div>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </ScrollArea>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
