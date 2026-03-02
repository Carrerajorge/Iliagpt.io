import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Progress } from "@/components/ui/progress";
import {
  Search, Play, Square, FileText, Loader2, Clock,
  ChevronDown, ChevronRight, BarChart3, CheckCircle,
  XCircle, AlertTriangle, Globe, BookOpen, Shield, Beaker, Layers
} from "lucide-react";
import { apiRequest } from "@/lib/queryClient";

const statusColors: Record<string, string> = {
  pending: "bg-gray-500",
  running: "bg-blue-500",
  completed: "bg-green-600",
  failed: "bg-red-500",
  cancelled: "bg-gray-400",
  decomposition: "bg-purple-500",
  search: "bg-blue-400",
  extraction: "bg-yellow-500",
  verification: "bg-orange-500",
  synthesis: "bg-green-500",
};

const phaseIcons: Record<string, typeof Layers> = {
  decomposition: Layers,
  search: Search,
  extraction: BookOpen,
  verification: Shield,
  synthesis: Beaker,
};

const PHASES = ["decomposition", "search", "extraction", "verification", "synthesis"] as const;

function StatusBadge({ status }: { status: string }) {
  return (
    <Badge className={`${statusColors[status] || "bg-gray-500"} text-white text-xs`} data-testid={`badge-status-${status}`}>
      {status.replace(/_/g, " ")}
    </Badge>
  );
}

export default function DeepResearch() {
  const queryClient = useQueryClient();
  const [selectedSessionId, setSelectedSessionId] = useState<string | null>(null);
  const [showNewResearch, setShowNewResearch] = useState(false);
  const [activeTab, setActiveTab] = useState<"sessions" | "stats">("sessions");

  const { data: sessionsData } = useQuery({
    queryKey: ["/api/research/sessions"],
    refetchInterval: 5000,
  });

  const { data: statsData } = useQuery({
    queryKey: ["/api/research/stats"],
    refetchInterval: 10000,
    enabled: activeTab === "stats",
  });

  const cancelMutation = useMutation({
    mutationFn: async (sessionId: string) => {
      const res = await apiRequest("POST", `/api/research/sessions/${sessionId}/cancel`);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/research/sessions"] });
      queryClient.invalidateQueries({ queryKey: ["/api/research/stats"] });
    },
  });

  const sessions: any[] = Array.isArray(sessionsData) ? sessionsData : [];
  const stats: any = (statsData as any) || {};

  return (
    <div className="space-y-6" data-testid="deep-research-dashboard">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold flex items-center gap-2" data-testid="text-title">
            <Search className="h-6 w-6" />
            Deep Research
          </h2>
          <p className="text-muted-foreground text-sm mt-1">Multi-phase research with evidence verification</p>
        </div>
        <Button
          size="sm"
          onClick={() => setShowNewResearch(!showNewResearch)}
          data-testid="button-new-research"
        >
          <Play className="h-4 w-4 mr-1" /> New Research
        </Button>
      </div>

      <div className="flex gap-2 border-b border-border pb-2">
        {(["sessions", "stats"] as const).map((tab) => (
          <Button
            key={tab}
            variant={activeTab === tab ? "default" : "ghost"}
            size="sm"
            onClick={() => setActiveTab(tab)}
            data-testid={`button-tab-${tab}`}
          >
            {tab === "sessions" ? "Sessions" : "Statistics"}
          </Button>
        ))}
      </div>

      {activeTab === "sessions" && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center justify-between">
              <span>Research Sessions</span>
              <Badge variant="outline" data-testid="text-session-count">{sessions.length} sessions</Badge>
            </CardTitle>
          </CardHeader>
          <CardContent>
            {showNewResearch && <NewResearchForm onClose={() => setShowNewResearch(false)} />}
            <div className="space-y-3 mt-4">
              {sessions.length === 0 ? (
                <p className="text-muted-foreground text-center py-8" data-testid="text-no-sessions">No research sessions yet</p>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-sm" data-testid="table-sessions">
                    <thead>
                      <tr className="border-b border-border text-left">
                        <th className="pb-2 pr-3 text-xs text-muted-foreground font-medium">ID</th>
                        <th className="pb-2 pr-3 text-xs text-muted-foreground font-medium">Query</th>
                        <th className="pb-2 pr-3 text-xs text-muted-foreground font-medium">Status</th>
                        <th className="pb-2 pr-3 text-xs text-muted-foreground font-medium">Phase</th>
                        <th className="pb-2 pr-3 text-xs text-muted-foreground font-medium">Created</th>
                        <th className="pb-2 text-xs text-muted-foreground font-medium">Actions</th>
                      </tr>
                    </thead>
                    <tbody>
                      {sessions.map((session: any) => (
                        <tr
                          key={session.id}
                          className="border-b border-border/50 hover:bg-muted/30 cursor-pointer transition-colors"
                          onClick={() => setSelectedSessionId(selectedSessionId === session.id ? null : session.id)}
                          data-testid={`row-session-${session.id}`}
                        >
                          <td className="py-2 pr-3 font-mono text-xs">{String(session.id).slice(0, 8)}</td>
                          <td className="py-2 pr-3 truncate max-w-xs">{session.query}</td>
                          <td className="py-2 pr-3"><StatusBadge status={session.status} /></td>
                          <td className="py-2 pr-3">
                            {(() => {
                              const phases = session.phases || {};
                              const running = Object.keys(phases).find(k => phases[k]?.status === "running");
                              const current = running || (session.status === "completed" ? "synthesis" : null);
                              return current ? (
                                <StatusBadge status={current} />
                              ) : (
                                <span className="text-xs text-muted-foreground">—</span>
                              );
                            })()}
                          </td>
                          <td className="py-2 pr-3 text-xs text-muted-foreground">
                            {session.createdAt ? new Date(session.createdAt).toLocaleString() : "—"}
                          </td>
                          <td className="py-2">
                            <div className="flex items-center gap-1">
                              {(session.status === "running" || session.status === "pending") && (
                                <Button
                                  size="sm"
                                  variant="destructive"
                                  className="h-7 px-2"
                                  onClick={(e) => { e.stopPropagation(); cancelMutation.mutate(session.id); }}
                                  disabled={cancelMutation.isPending}
                                  data-testid={`button-cancel-${session.id}`}
                                >
                                  <Square className="h-3 w-3" />
                                </Button>
                              )}
                              {session.status === "completed" && (
                                <ViewReportButton sessionId={session.id} />
                              )}
                              <Button
                                size="sm"
                                variant="ghost"
                                className="h-7 px-2"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  setSelectedSessionId(selectedSessionId === session.id ? null : session.id);
                                }}
                                data-testid={`button-expand-${session.id}`}
                              >
                                {selectedSessionId === session.id ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
                              </Button>
                            </div>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
              {selectedSessionId && <SessionDetail sessionId={selectedSessionId} />}
            </div>
          </CardContent>
        </Card>
      )}

      {activeTab === "stats" && (
        <div className="space-y-4">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <Card>
              <CardContent className="pt-4">
                <div className="text-2xl font-bold" data-testid="stat-total-sessions">{stats.totalSessions || 0}</div>
                <p className="text-xs text-muted-foreground">Total Sessions</p>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="pt-4">
                <div className="text-2xl font-bold text-green-500" data-testid="stat-completed-sessions">{stats.completed || 0}</div>
                <p className="text-xs text-muted-foreground">Completed</p>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="pt-4">
                <div className="text-2xl font-bold text-blue-500" data-testid="stat-active-sessions">{stats.active || 0}</div>
                <p className="text-xs text-muted-foreground">Active</p>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="pt-4">
                <div className="text-2xl font-bold text-red-500" data-testid="stat-failed-sessions">{stats.failed || 0}</div>
                <p className="text-xs text-muted-foreground">Failed</p>
              </CardContent>
            </Card>
          </div>
          <div className="grid grid-cols-3 gap-4">
            <Card>
              <CardContent className="pt-4 flex items-center gap-3">
                <BarChart3 className="h-5 w-5 text-blue-500" />
                <div>
                  <div className="text-lg font-bold" data-testid="stat-avg-duration">{stats.avgDurationMs ? (stats.avgDurationMs / 1000).toFixed(1) + "s" : "—"}</div>
                  <p className="text-xs text-muted-foreground">Avg Duration</p>
                </div>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="pt-4 flex items-center gap-3">
                <Globe className="h-5 w-5 text-green-500" />
                <div>
                  <div className="text-lg font-bold" data-testid="stat-total-sources">{stats.totalSources || 0}</div>
                  <p className="text-xs text-muted-foreground">Total Sources</p>
                </div>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="pt-4 flex items-center gap-3">
                <BookOpen className="h-5 w-5 text-purple-500" />
                <div>
                  <div className="text-lg font-bold" data-testid="stat-total-claims">{stats.totalClaims || 0}</div>
                  <p className="text-xs text-muted-foreground">Total Claims</p>
                </div>
              </CardContent>
            </Card>
          </div>
        </div>
      )}
    </div>
  );
}

function SessionDetail({ sessionId }: { sessionId: string }) {
  const [evidenceTab, setEvidenceTab] = useState<"phases" | "sources" | "claims">("phases");

  const { data } = useQuery({
    queryKey: ["/api/research/sessions", sessionId],
    queryFn: async () => {
      const res = await apiRequest("GET", `/api/research/sessions/${sessionId}`);
      return res.json();
    },
    refetchInterval: 3000,
  });

  if (!data) {
    return (
      <div className="mt-3 flex items-center justify-center py-4" data-testid="session-loading">
        <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
      </div>
    );
  }

  const phases = data.phases || {};
  const sources: any[] = data.sources || data.evidence?.sources || [];
  const claims: any[] = data.claims || data.evidence?.claims || [];

  const completedPhases = PHASES.filter(p => phases[p]?.status === "completed").length;
  const progressPercent = (completedPhases / PHASES.length) * 100;

  return (
    <div className="mt-4 space-y-4 border-t border-border pt-4" data-testid={`detail-session-${sessionId}`}>
      <div className="flex items-center gap-4">
        <div className="flex-1">
          <p className="text-sm font-medium mb-1">Overall Progress</p>
          <Progress value={progressPercent} className="h-2" data-testid="progress-overall" />
        </div>
        <span className="text-sm text-muted-foreground">{completedPhases}/{PHASES.length} phases</span>
      </div>

      <div className="flex gap-2 border-b border-border pb-2">
        {(["phases", "sources", "claims"] as const).map((tab) => (
          <Button
            key={tab}
            variant={evidenceTab === tab ? "default" : "ghost"}
            size="sm"
            onClick={() => setEvidenceTab(tab)}
            data-testid={`button-evidence-tab-${tab}`}
          >
            {tab === "phases" ? "Phase Progress" : tab === "sources" ? `Sources (${sources.length})` : `Claims (${claims.length})`}
          </Button>
        ))}
      </div>

      {evidenceTab === "phases" && (
        <div className="space-y-2" data-testid="phase-progress">
          {PHASES.map((phase) => {
            const phaseData = phases[phase] || {};
            const Icon = phaseIcons[phase] || Layers;
            const phaseStatus = phaseData.status || "pending";
            return (
              <div
                key={phase}
                className="flex items-center justify-between p-3 border border-border rounded-lg"
                data-testid={`phase-${phase}`}
              >
                <div className="flex items-center gap-3">
                  <Icon className="h-4 w-4 text-muted-foreground" />
                  <div>
                    <p className="text-sm font-medium capitalize">{phase}</p>
                    {phaseData.message && (
                      <p className="text-xs text-muted-foreground">{phaseData.message}</p>
                    )}
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  {phaseData.durationMs && (
                    <span className="text-xs text-muted-foreground">
                      <Clock className="h-3 w-3 inline mr-1" />
                      {(phaseData.durationMs / 1000).toFixed(1)}s
                    </span>
                  )}
                  {phaseStatus === "completed" && <CheckCircle className="h-4 w-4 text-green-500" />}
                  {phaseStatus === "running" && <Loader2 className="h-4 w-4 animate-spin text-blue-500" />}
                  {phaseStatus === "failed" && <XCircle className="h-4 w-4 text-red-500" />}
                  {phaseStatus === "pending" && <Clock className="h-4 w-4 text-gray-400" />}
                  <StatusBadge status={phaseStatus} />
                </div>
              </div>
            );
          })}
        </div>
      )}

      {evidenceTab === "sources" && (
        <div className="space-y-2 max-h-64 overflow-y-auto" data-testid="evidence-sources">
          {sources.length === 0 ? (
            <p className="text-muted-foreground text-center py-4 text-sm">No sources collected yet</p>
          ) : (
            sources.map((source: any, idx: number) => (
              <div key={idx} className="flex items-center justify-between p-2 border border-border rounded" data-testid={`source-${idx}`}>
                <div className="flex items-center gap-2">
                  <Globe className="h-3.5 w-3.5 text-blue-400" />
                  <div>
                    <p className="text-xs font-medium truncate max-w-md">{source.title || source.url || "Unknown source"}</p>
                    {source.url && (
                      <p className="text-[10px] text-muted-foreground truncate max-w-md">{source.url}</p>
                    )}
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  {source.reliability !== undefined && (
                    <Badge variant="outline" className="text-[10px]">
                      {(source.reliability * 100).toFixed(0)}% reliable
                    </Badge>
                  )}
                  {source.type && (
                    <Badge variant="secondary" className="text-[10px]">{source.type}</Badge>
                  )}
                </div>
              </div>
            ))
          )}
        </div>
      )}

      {evidenceTab === "claims" && (
        <div className="space-y-2 max-h-64 overflow-y-auto" data-testid="evidence-claims">
          {claims.length === 0 ? (
            <p className="text-muted-foreground text-center py-4 text-sm">No claims extracted yet</p>
          ) : (
            claims.map((claim: any, idx: number) => (
              <div key={idx} className="p-2 border border-border rounded" data-testid={`claim-${idx}`}>
                <p className="text-xs">{claim.text || claim.claim || "—"}</p>
                <div className="flex items-center gap-2 mt-1">
                  {claim.verified !== undefined && (
                    <Badge
                      className={claim.verified ? "bg-green-500/20 text-green-400" : "bg-yellow-500/20 text-yellow-400"}
                    >
                      {claim.verified ? "Verified" : "Unverified"}
                    </Badge>
                  )}
                  {claim.confidence !== undefined && (
                    <span className="text-[10px] text-muted-foreground">
                      Confidence: {(claim.confidence * 100).toFixed(0)}%
                    </span>
                  )}
                  {claim.sourceCount !== undefined && (
                    <span className="text-[10px] text-muted-foreground">
                      {claim.sourceCount} sources
                    </span>
                  )}
                </div>
              </div>
            ))
          )}
        </div>
      )}
    </div>
  );
}

function ViewReportButton({ sessionId }: { sessionId: string }) {
  const [showReport, setShowReport] = useState(false);

  const { data: reportData, isLoading } = useQuery({
    queryKey: ["/api/research/sessions", sessionId, "report"],
    queryFn: async () => {
      const res = await apiRequest("GET", `/api/research/sessions/${sessionId}/report`);
      return res.json();
    },
    enabled: showReport,
  });

  return (
    <>
      <Button
        size="sm"
        variant="outline"
        className="h-7 px-2"
        onClick={(e) => { e.stopPropagation(); setShowReport(!showReport); }}
        data-testid={`button-report-${sessionId}`}
      >
        <FileText className="h-3 w-3" />
      </Button>
      {showReport && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50" onClick={() => setShowReport(false)}>
          <div
            className="bg-background border border-border rounded-lg p-6 max-w-2xl w-full max-h-[80vh] overflow-y-auto m-4"
            onClick={(e) => e.stopPropagation()}
            data-testid={`report-modal-${sessionId}`}
          >
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-lg font-bold">Research Report</h3>
              <Button variant="ghost" size="sm" onClick={() => setShowReport(false)} data-testid="button-close-report">
                <XCircle className="h-4 w-4" />
              </Button>
            </div>
            {isLoading ? (
              <div className="flex items-center justify-center py-8">
                <Loader2 className="h-6 w-6 animate-spin" />
              </div>
            ) : reportData?.error ? (
              <div className="text-center py-8 text-red-400 text-sm">
                <AlertTriangle className="h-8 w-8 mx-auto mb-2" />
                <p>{reportData.error}</p>
              </div>
            ) : (
              <div className="prose prose-sm dark:prose-invert max-w-none" data-testid="report-content">
                <pre className="whitespace-pre-wrap text-sm bg-muted/50 rounded p-4">
                  {reportData?.report || reportData?.content || JSON.stringify(reportData, null, 2)}
                </pre>
              </div>
            )}
          </div>
        </div>
      )}
    </>
  );
}

function NewResearchForm({ onClose }: { onClose: () => void }) {
  const queryClient = useQueryClient();
  const [query, setQuery] = useState("");
  const [depth, setDepth] = useState("");

  const submitMutation = useMutation({
    mutationFn: async () => {
      const body: any = { query };
      if (depth && parseInt(depth) > 0) {
        body.depth = parseInt(depth);
      }
      const res = await apiRequest("POST", "/api/research/start", body);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/research/sessions"] });
      queryClient.invalidateQueries({ queryKey: ["/api/research/stats"] });
      onClose();
    },
  });

  return (
    <div className="border border-border rounded-lg p-4 space-y-3" data-testid="form-new-research">
      <Input
        placeholder="Research query..."
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        data-testid="input-query"
      />
      <Input
        placeholder="Depth (optional, e.g. 3)"
        value={depth}
        onChange={(e) => setDepth(e.target.value)}
        type="number"
        min="1"
        max="10"
        data-testid="input-depth"
      />
      <div className="flex gap-2 justify-end">
        <Button variant="outline" size="sm" onClick={onClose} data-testid="button-cancel-new-research">Cancel</Button>
        <Button
          size="sm"
          onClick={() => submitMutation.mutate()}
          disabled={!query.trim() || submitMutation.isPending}
          data-testid="button-submit-research"
        >
          {submitMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin mr-1" /> : <Play className="h-4 w-4 mr-1" />}
          Start Research
        </Button>
      </div>
      {submitMutation.isError && (
        <p className="text-sm text-red-500" data-testid="text-error">{(submitMutation.error as Error)?.message}</p>
      )}
    </div>
  );
}
