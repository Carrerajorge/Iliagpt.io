import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  AlertTriangle,
  Play,
  Square,
  Zap,
  Activity,
  Bug,
  Loader2,
  FlaskConical,
} from "lucide-react";
import { apiRequest } from "@/lib/queryClient";

const EXPERIMENT_TYPES = [
  { value: "kill-random-agent", label: "Kill Random Agent", description: "Picks a random running task and marks it failed" },
  { value: "inject-latency", label: "Inject Latency", description: "Adds configurable delay to task execution" },
  { value: "fail-percentage", label: "Fail Percentage", description: "Sets a global failure rate for tasks" },
  { value: "budget-spike", label: "Budget Spike", description: "Multiplies cost of running tasks" },
  { value: "network-partition", label: "Network Partition", description: "Pauses DAG scheduler to simulate network failure" },
  { value: "queue-flood", label: "Queue Flood", description: "Submits N dummy tasks to the queue" },
] as const;

const statusColors: Record<string, string> = {
  pending: "bg-gray-500",
  running: "bg-green-500",
  completed: "bg-blue-500",
  stopped: "bg-yellow-500",
};

const PARAM_FIELDS: Record<string, Array<{ key: string; label: string; type: string; defaultValue: string }>> = {
  "kill-random-agent": [],
  "inject-latency": [{ key: "delayMs", label: "Delay (ms)", type: "number", defaultValue: "2000" }],
  "fail-percentage": [{ key: "percentage", label: "Fail Rate (%)", type: "number", defaultValue: "10" }],
  "budget-spike": [{ key: "multiplier", label: "Cost Multiplier", type: "number", defaultValue: "10" }],
  "network-partition": [],
  "queue-flood": [{ key: "count", label: "Task Count", type: "number", defaultValue: "100" }],
};

function formatDuration(startedAt: string | null, stoppedAt: string | null): string {
  if (!startedAt) return "-";
  const start = new Date(startedAt).getTime();
  const end = stoppedAt ? new Date(stoppedAt).getTime() : Date.now();
  const seconds = Math.round((end - start) / 1000);
  if (seconds < 60) return `${seconds}s`;
  return `${Math.floor(seconds / 60)}m ${seconds % 60}s`;
}

export default function ChaosTestingDashboard() {
  const queryClient = useQueryClient();
  const [selectedType, setSelectedType] = useState<string>("kill-random-agent");
  const [params, setParams] = useState<Record<string, string>>({});
  const [selectedExperiment, setSelectedExperiment] = useState<string | null>(null);

  const { data: experiments, isLoading: experimentsLoading } = useQuery({
    queryKey: ["/api/chaos/experiments"],
    queryFn: async () => {
      const res = await apiRequest("GET", "/api/chaos/experiments");
      return res.json();
    },
    refetchInterval: 3000,
  });

  const { data: stats } = useQuery({
    queryKey: ["/api/chaos/stats"],
    queryFn: async () => {
      const res = await apiRequest("GET", "/api/chaos/stats");
      return res.json();
    },
    refetchInterval: 5000,
  });

  const startMutation = useMutation({
    mutationFn: async () => {
      const parsedParams: Record<string, any> = {};
      const fields = PARAM_FIELDS[selectedType] || [];
      for (const field of fields) {
        if (params[field.key]) {
          parsedParams[field.key] = field.type === "number" ? Number(params[field.key]) : params[field.key];
        }
      }
      const res = await apiRequest("POST", "/api/chaos/experiments", {
        type: selectedType,
        params: parsedParams,
      });
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/chaos/experiments"] });
      queryClient.invalidateQueries({ queryKey: ["/api/chaos/stats"] });
      setParams({});
    },
  });

  const stopMutation = useMutation({
    mutationFn: async (id: string) => {
      const res = await apiRequest("POST", `/api/chaos/experiments/${id}/stop`);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/chaos/experiments"] });
      queryClient.invalidateQueries({ queryKey: ["/api/chaos/stats"] });
    },
  });

  const activeExperiments = (experiments || []).filter((e: any) => e.status === "running");
  const currentFields = PARAM_FIELDS[selectedType] || [];
  const viewedExperiment = selectedExperiment
    ? (experiments || []).find((e: any) => e.id === selectedExperiment)
    : null;

  return (
    <div className="space-y-6" data-testid="chaos-testing-dashboard">
      <Alert variant="destructive" data-testid="alert-safety-warning">
        <AlertTriangle className="h-4 w-4" />
        <AlertTitle>Chaos Testing - Non-Production Only</AlertTitle>
        <AlertDescription>
          These experiments intentionally break system components. They are disabled in production environments.
          Experiments auto-stop after 60 seconds by default.
        </AlertDescription>
      </Alert>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-4" data-testid="stats-panel">
        <Card>
          <CardContent className="pt-4">
            <div className="text-2xl font-bold" data-testid="text-total-experiments">
              {stats?.totalExperiments || 0}
            </div>
            <p className="text-xs text-muted-foreground">Total Experiments</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4">
            <div className="text-2xl font-bold text-green-500" data-testid="text-active-experiments">
              {stats?.activeExperiments || 0}
            </div>
            <p className="text-xs text-muted-foreground">Active</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4">
            <div className="text-2xl font-bold text-red-500" data-testid="text-total-errors">
              {stats?.totalErrorsInjected || 0}
            </div>
            <p className="text-xs text-muted-foreground">Errors Injected</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4">
            <div className="text-2xl font-bold text-yellow-500" data-testid="text-affected-tasks">
              {stats?.totalAffectedTasks || 0}
            </div>
            <p className="text-xs text-muted-foreground">Affected Tasks</p>
          </CardContent>
        </Card>
      </div>

      <Card data-testid="experiment-launcher">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <FlaskConical className="h-5 w-5" />
            Launch Experiment
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="space-y-4">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <label className="text-sm font-medium mb-2 block">Experiment Type</label>
                <Select value={selectedType} onValueChange={setSelectedType} data-testid="select-experiment-type">
                  <SelectTrigger data-testid="select-trigger-type">
                    <SelectValue placeholder="Select experiment type" />
                  </SelectTrigger>
                  <SelectContent>
                    {EXPERIMENT_TYPES.map((t) => (
                      <SelectItem key={t.value} value={t.value} data-testid={`option-type-${t.value}`}>
                        {t.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <p className="text-xs text-muted-foreground mt-1">
                  {EXPERIMENT_TYPES.find((t) => t.value === selectedType)?.description}
                </p>
              </div>

              <div className="space-y-3">
                {currentFields.map((field) => (
                  <div key={field.key}>
                    <label className="text-sm font-medium mb-1 block">{field.label}</label>
                    <Input
                      type={field.type}
                      placeholder={field.defaultValue}
                      value={params[field.key] || ""}
                      onChange={(e) =>
                        setParams((prev) => ({ ...prev, [field.key]: e.target.value }))
                      }
                      data-testid={`input-param-${field.key}`}
                    />
                  </div>
                ))}
                {currentFields.length === 0 && (
                  <p className="text-sm text-muted-foreground pt-6">No additional parameters needed.</p>
                )}
              </div>
            </div>

            <div className="flex justify-end">
              <Button
                onClick={() => startMutation.mutate()}
                disabled={startMutation.isPending}
                data-testid="button-start-experiment"
              >
                {startMutation.isPending ? (
                  <Loader2 className="h-4 w-4 animate-spin mr-2" />
                ) : (
                  <Play className="h-4 w-4 mr-2" />
                )}
                Start Experiment
              </Button>
            </div>

            {startMutation.isError && (
              <p className="text-sm text-red-500" data-testid="text-start-error">
                {(startMutation.error as Error)?.message}
              </p>
            )}
          </div>
        </CardContent>
      </Card>

      <Card data-testid="experiments-list">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Activity className="h-5 w-5" />
            Experiments ({(experiments || []).length})
            {activeExperiments.length > 0 && (
              <Badge variant="destructive" className="ml-2" data-testid="badge-active-count">
                {activeExperiments.length} active
              </Badge>
            )}
          </CardTitle>
        </CardHeader>
        <CardContent>
          {experimentsLoading ? (
            <div className="flex justify-center py-8">
              <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
            </div>
          ) : (experiments || []).length === 0 ? (
            <p className="text-muted-foreground text-center py-8" data-testid="text-no-experiments">
              No experiments yet. Launch one above.
            </p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Type</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Duration</TableHead>
                  <TableHead>Errors</TableHead>
                  <TableHead>Affected</TableHead>
                  <TableHead>Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {(experiments || []).map((experiment: any) => (
                  <TableRow
                    key={experiment.id}
                    className="cursor-pointer hover:bg-muted/30"
                    onClick={() =>
                      setSelectedExperiment(
                        selectedExperiment === experiment.id ? null : experiment.id
                      )
                    }
                    data-testid={`row-experiment-${experiment.id}`}
                  >
                    <TableCell>
                      <div className="flex items-center gap-2">
                        <Bug className="h-4 w-4 text-muted-foreground" />
                        <span className="font-mono text-sm">{experiment.type}</span>
                      </div>
                    </TableCell>
                    <TableCell>
                      <Badge
                        className={`${statusColors[experiment.status] || "bg-gray-500"} text-white`}
                        data-testid={`badge-status-${experiment.id}`}
                      >
                        {experiment.status}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-sm">
                      {formatDuration(experiment.startedAt, experiment.stoppedAt)}
                    </TableCell>
                    <TableCell className="text-sm font-medium text-red-500">
                      {experiment.results?.errorsInjected || 0}
                    </TableCell>
                    <TableCell className="text-sm">
                      {experiment.results?.affectedTasks?.length || 0}
                    </TableCell>
                    <TableCell>
                      {experiment.status === "running" && (
                        <Button
                          size="sm"
                          variant="destructive"
                          onClick={(e) => {
                            e.stopPropagation();
                            stopMutation.mutate(experiment.id);
                          }}
                          disabled={stopMutation.isPending}
                          data-testid={`button-stop-${experiment.id}`}
                        >
                          <Square className="h-3 w-3 mr-1" />
                          Stop
                        </Button>
                      )}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      {viewedExperiment && (
        <Card data-testid={`results-viewer-${viewedExperiment.id}`}>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Zap className="h-5 w-5" />
              Results: {viewedExperiment.type}
              <Badge
                className={`${statusColors[viewedExperiment.status] || "bg-gray-500"} text-white ml-2`}
              >
                {viewedExperiment.status}
              </Badge>
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <h4 className="text-sm font-medium mb-2">Parameters</h4>
                <pre className="text-xs bg-muted p-3 rounded-lg overflow-auto" data-testid="text-experiment-params">
                  {JSON.stringify(viewedExperiment.params, null, 2)}
                </pre>
              </div>
              <div>
                <h4 className="text-sm font-medium mb-2">Timing</h4>
                <div className="text-sm space-y-1">
                  <p>
                    <span className="text-muted-foreground">Started: </span>
                    {viewedExperiment.startedAt
                      ? new Date(viewedExperiment.startedAt).toLocaleString()
                      : "-"}
                  </p>
                  <p>
                    <span className="text-muted-foreground">Stopped: </span>
                    {viewedExperiment.stoppedAt
                      ? new Date(viewedExperiment.stoppedAt).toLocaleString()
                      : "-"}
                  </p>
                  <p>
                    <span className="text-muted-foreground">Duration: </span>
                    {formatDuration(viewedExperiment.startedAt, viewedExperiment.stoppedAt)}
                  </p>
                </div>
              </div>
              <div>
                <h4 className="text-sm font-medium mb-2">Metrics Before</h4>
                <pre className="text-xs bg-muted p-3 rounded-lg overflow-auto" data-testid="text-metrics-before">
                  {JSON.stringify(viewedExperiment.results?.metricsBefore || {}, null, 2)}
                </pre>
              </div>
              <div>
                <h4 className="text-sm font-medium mb-2">Metrics After</h4>
                <pre className="text-xs bg-muted p-3 rounded-lg overflow-auto" data-testid="text-metrics-after">
                  {JSON.stringify(viewedExperiment.results?.metricsAfter || {}, null, 2)}
                </pre>
              </div>
              {viewedExperiment.results?.affectedTasks?.length > 0 && (
                <div className="col-span-full">
                  <h4 className="text-sm font-medium mb-2">
                    Affected Tasks ({viewedExperiment.results.affectedTasks.length})
                  </h4>
                  <div className="flex flex-wrap gap-2" data-testid="text-affected-tasks-list">
                    {viewedExperiment.results.affectedTasks.map((taskId: string, i: number) => (
                      <Badge key={i} variant="outline" className="font-mono text-xs">
                        {taskId.slice(0, 8)}...
                      </Badge>
                    ))}
                  </div>
                </div>
              )}
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
