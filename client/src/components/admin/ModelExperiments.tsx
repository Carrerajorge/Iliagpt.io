import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Progress } from "@/components/ui/progress";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { apiFetchJson } from "@/lib/adminApi";
import {
  FlaskConical,
  Play,
  Pause,
  Trophy,
  TrendingUp,
  AlertTriangle,
  Activity,
  Loader2,
  RefreshCw,
  BarChart3,
  Zap,
  Shield,
  Target,
  Gauge,
  GitBranch,
} from "lucide-react";

interface Experiment {
  id: string;
  name: string;
  status: string;
  controlModel: string;
  treatmentModel: string;
  trafficSplit: number;
  metrics: {
    control: { requests: number; avgLatency: number; avgQuality: number; avgCost: number; errorRate: number };
    treatment: { requests: number; avgLatency: number; avgQuality: number; avgCost: number; errorRate: number };
  };
  significance: { isSignificant: boolean; pValue: number; winner: string | null };
  createdAt: number;
}

interface CanaryStatus {
  active: boolean;
  primaryModel?: string;
  canaryModel?: string;
  stage?: string;
  trafficPercent?: number;
  metrics?: { errorRate: number; avgLatency: number; requestCount: number };
}

interface ProviderScorecard {
  provider: string;
  health: string;
  trend: string;
  overallScore: number;
  scores: Record<string, number>;
  evalCount: number;
  lastEval: number;
}

const statusColors: Record<string, string> = {
  running: "bg-green-500/20 text-green-400 border-green-500/30",
  paused: "bg-yellow-500/20 text-yellow-400 border-yellow-500/30",
  completed: "bg-blue-500/20 text-blue-400 border-blue-500/30",
  created: "bg-gray-500/20 text-gray-400 border-gray-500/30",
};

const healthColors: Record<string, string> = {
  healthy: "bg-green-500/20 text-green-400",
  degraded: "bg-yellow-500/20 text-yellow-400",
  unhealthy: "bg-red-500/20 text-red-400",
};

export default function ModelExperiments() {
  const queryClient = useQueryClient();
  const [newExperiment, setNewExperiment] = useState({ name: "", controlModel: "", treatmentModel: "", trafficSplit: 50 });

  const { data, isLoading, refetch } = useQuery({
    queryKey: ["/api/models/experiments"],
    refetchInterval: 10000,
    throwOnError: true,
  });

  const createMutation = useMutation({
    mutationFn: async (exp: typeof newExperiment) => {
      return apiFetchJson("/api/models/experiments", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(exp),
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/models/experiments"] });
      setNewExperiment({ name: "", controlModel: "", treatmentModel: "", trafficSplit: 50 });
    },
  });

  const experiments: Experiment[] = (data as any)?.experiments || [];
  const canary: CanaryStatus = (data as any)?.canary || { active: false };
  const evaluations: ProviderScorecard[] = (data as any)?.evaluations || [];

  if (isLoading) {
    return (
      <div className="flex items-center justify-center p-12" data-testid="experiments-loading">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="space-y-6" data-testid="model-experiments-dashboard">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold flex items-center gap-2">
            <FlaskConical className="h-6 w-6" />
            Model Experiments
          </h2>
          <p className="text-muted-foreground text-sm mt-1">A/B testing, canary deployments, and provider evaluation</p>
        </div>
        <Button variant="outline" size="sm" onClick={() => refetch()} data-testid="btn-refresh-experiments">
          <RefreshCw className="h-4 w-4 mr-1" /> Refresh
        </Button>
      </div>

      <Tabs defaultValue="experiments">
        <TabsList>
          <TabsTrigger value="experiments" data-testid="tab-experiments">
            <FlaskConical className="h-4 w-4 mr-1" /> A/B Tests
          </TabsTrigger>
          <TabsTrigger value="canary" data-testid="tab-canary">
            <GitBranch className="h-4 w-4 mr-1" /> Canary
          </TabsTrigger>
          <TabsTrigger value="evaluations" data-testid="tab-evaluations">
            <Target className="h-4 w-4 mr-1" /> Provider Evals
          </TabsTrigger>
        </TabsList>

        <TabsContent value="experiments" className="space-y-4 mt-4">
          <Card>
            <CardHeader>
              <CardTitle className="text-sm">Create New Experiment</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-4 gap-3">
                <Input
                  placeholder="Experiment name"
                  value={newExperiment.name}
                  onChange={(e) => setNewExperiment((p) => ({ ...p, name: e.target.value }))}
                  data-testid="input-experiment-name"
                />
                <Input
                  placeholder="Control model"
                  value={newExperiment.controlModel}
                  onChange={(e) => setNewExperiment((p) => ({ ...p, controlModel: e.target.value }))}
                  data-testid="input-control-model"
                />
                <Input
                  placeholder="Treatment model"
                  value={newExperiment.treatmentModel}
                  onChange={(e) => setNewExperiment((p) => ({ ...p, treatmentModel: e.target.value }))}
                  data-testid="input-treatment-model"
                />
                <Button
                  onClick={() => createMutation.mutate(newExperiment)}
                  disabled={!newExperiment.name || !newExperiment.controlModel || !newExperiment.treatmentModel}
                  data-testid="btn-create-experiment"
                >
                  <Play className="h-4 w-4 mr-1" /> Create
                </Button>
              </div>
            </CardContent>
          </Card>

          {experiments.length === 0 ? (
            <Card>
              <CardContent className="py-8 text-center text-muted-foreground">
                No experiments yet. Create one above to start A/B testing models.
              </CardContent>
            </Card>
          ) : (
            experiments.map((exp) => (
              <Card key={exp.id} data-testid={`experiment-card-${exp.id}`}>
                <CardHeader className="pb-2">
                  <div className="flex items-center justify-between">
                    <CardTitle className="text-base flex items-center gap-2">
                      {exp.name}
                      <Badge className={statusColors[exp.status] || statusColors.created}>{exp.status}</Badge>
                    </CardTitle>
                    <div className="flex gap-2">
                      {exp.significance?.isSignificant && (
                        <Badge className="bg-purple-500/20 text-purple-400 border-purple-500/30">
                          <Trophy className="h-3 w-3 mr-1" /> Winner: {exp.significance.winner}
                        </Badge>
                      )}
                    </div>
                  </div>
                </CardHeader>
                <CardContent>
                  <div className="grid grid-cols-2 gap-4">
                    <div className="space-y-2">
                      <div className="text-xs text-muted-foreground uppercase tracking-wider">Control: {exp.controlModel}</div>
                      <div className="grid grid-cols-4 gap-2 text-sm">
                        <div><span className="text-muted-foreground">Requests:</span> {exp.metrics?.control?.requests || 0}</div>
                        <div><span className="text-muted-foreground">Latency:</span> {(exp.metrics?.control?.avgLatency || 0).toFixed(0)}ms</div>
                        <div><span className="text-muted-foreground">Quality:</span> {(exp.metrics?.control?.avgQuality || 0).toFixed(2)}</div>
                        <div><span className="text-muted-foreground">Cost:</span> ${(exp.metrics?.control?.avgCost || 0).toFixed(4)}</div>
                      </div>
                    </div>
                    <div className="space-y-2">
                      <div className="text-xs text-muted-foreground uppercase tracking-wider">Treatment: {exp.treatmentModel}</div>
                      <div className="grid grid-cols-4 gap-2 text-sm">
                        <div><span className="text-muted-foreground">Requests:</span> {exp.metrics?.treatment?.requests || 0}</div>
                        <div><span className="text-muted-foreground">Latency:</span> {(exp.metrics?.treatment?.avgLatency || 0).toFixed(0)}ms</div>
                        <div><span className="text-muted-foreground">Quality:</span> {(exp.metrics?.treatment?.avgQuality || 0).toFixed(2)}</div>
                        <div><span className="text-muted-foreground">Cost:</span> ${(exp.metrics?.treatment?.avgCost || 0).toFixed(4)}</div>
                      </div>
                    </div>
                  </div>
                  {exp.significance && (
                    <div className="mt-3 pt-3 border-t text-xs text-muted-foreground">
                      <span>p-value: {exp.significance.pValue?.toFixed(4)}</span>
                      <span className="ml-4">Significant: {exp.significance.isSignificant ? "Yes" : "Not yet"}</span>
                      <span className="ml-4">Traffic split: {exp.trafficSplit}% / {100 - exp.trafficSplit}%</span>
                    </div>
                  )}
                </CardContent>
              </Card>
            ))
          )}
        </TabsContent>

        <TabsContent value="canary" className="mt-4">
          <Card>
            <CardHeader>
              <CardTitle className="text-base flex items-center gap-2">
                <GitBranch className="h-5 w-5" />
                Canary Deployment Status
              </CardTitle>
            </CardHeader>
            <CardContent>
              {canary.active ? (
                <div className="space-y-4">
                  <div className="grid grid-cols-3 gap-4">
                    <div>
                      <div className="text-xs text-muted-foreground">Primary Model</div>
                      <div className="font-mono text-sm">{canary.primaryModel}</div>
                    </div>
                    <div>
                      <div className="text-xs text-muted-foreground">Canary Model</div>
                      <div className="font-mono text-sm">{canary.canaryModel}</div>
                    </div>
                    <div>
                      <div className="text-xs text-muted-foreground">Stage</div>
                      <Badge>{canary.stage}</Badge>
                    </div>
                  </div>
                  <div>
                    <div className="flex justify-between text-xs text-muted-foreground mb-1">
                      <span>Canary Traffic</span>
                      <span>{canary.trafficPercent}%</span>
                    </div>
                    <Progress value={canary.trafficPercent} className="h-2" />
                  </div>
                  {canary.metrics && (
                    <div className="grid grid-cols-3 gap-4 pt-2 border-t">
                      <div className="flex items-center gap-2">
                        <AlertTriangle className="h-4 w-4 text-yellow-400" />
                        <div>
                          <div className="text-xs text-muted-foreground">Error Rate</div>
                          <div className="text-sm font-mono">{(canary.metrics.errorRate * 100).toFixed(1)}%</div>
                        </div>
                      </div>
                      <div className="flex items-center gap-2">
                        <Gauge className="h-4 w-4 text-blue-400" />
                        <div>
                          <div className="text-xs text-muted-foreground">Avg Latency</div>
                          <div className="text-sm font-mono">{canary.metrics.avgLatency?.toFixed(0)}ms</div>
                        </div>
                      </div>
                      <div className="flex items-center gap-2">
                        <Activity className="h-4 w-4 text-green-400" />
                        <div>
                          <div className="text-xs text-muted-foreground">Requests</div>
                          <div className="text-sm font-mono">{canary.metrics.requestCount}</div>
                        </div>
                      </div>
                    </div>
                  )}
                </div>
              ) : (
                <div className="text-center py-6 text-muted-foreground">
                  <GitBranch className="h-8 w-8 mx-auto mb-2 opacity-50" />
                  <p>No active canary deployment</p>
                  <p className="text-xs mt-1">Canary deployments gradually ramp traffic to new models with automatic rollback</p>
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="evaluations" className="mt-4 space-y-4">
          {evaluations.length === 0 ? (
            <Card>
              <CardContent className="py-8 text-center text-muted-foreground">
                <Target className="h-8 w-8 mx-auto mb-2 opacity-50" />
                <p>No provider evaluations yet</p>
                <p className="text-xs mt-1">Provider evaluations run periodically to score model quality and reliability</p>
              </CardContent>
            </Card>
          ) : (
            evaluations.map((sc) => (
              <Card key={sc.provider} data-testid={`scorecard-${sc.provider}`}>
                <CardHeader className="pb-2">
                  <div className="flex items-center justify-between">
                    <CardTitle className="text-base">{sc.provider}</CardTitle>
                    <div className="flex items-center gap-2">
                      <Badge className={healthColors[sc.health] || healthColors.healthy}>{sc.health}</Badge>
                      {sc.trend === "improving" && <TrendingUp className="h-4 w-4 text-green-400" />}
                      {sc.trend === "degrading" && <TrendingUp className="h-4 w-4 text-red-400 rotate-180" />}
                    </div>
                  </div>
                </CardHeader>
                <CardContent>
                  <div className="flex items-center gap-4 mb-3">
                    <div className="text-3xl font-bold">{(sc.overallScore * 100).toFixed(0)}</div>
                    <div className="text-xs text-muted-foreground">
                      <div>Overall Score</div>
                      <div>{sc.evalCount} evaluations</div>
                    </div>
                  </div>
                  <div className="grid grid-cols-4 gap-3">
                    {Object.entries(sc.scores || {}).map(([key, val]) => (
                      <div key={key}>
                        <div className="text-xs text-muted-foreground capitalize">{key.replace(/_/g, " ")}</div>
                        <Progress value={(val as number) * 100} className="h-1.5 mt-1" />
                        <div className="text-xs mt-0.5">{((val as number) * 100).toFixed(0)}%</div>
                      </div>
                    ))}
                  </div>
                </CardContent>
              </Card>
            ))
          )}
        </TabsContent>
      </Tabs>
    </div>
  );
}
