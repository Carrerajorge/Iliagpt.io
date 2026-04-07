import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Progress } from "@/components/ui/progress";
import { cn } from "@/lib/utils";
import { apiFetchJson } from "@/lib/adminApi";
import {
  Shield,
  ShieldAlert,
  ShieldCheck,
  AlertTriangle,
  RefreshCw,
  Loader2,
  Activity,
  Eye,
  Lock,
  TrendingUp,
  TrendingDown,
  Minus,
  Bug,
  FileWarning,
  Siren,
  CheckCircle,
  Clock,
} from "lucide-react";

interface ThreatScore {
  overall: number;
  injectionRisk: number;
  outputLeakRisk: number;
  anomalyRisk: number;
  trend: "increasing" | "stable" | "decreasing";
  lastUpdated: number;
}

interface SecurityEvent {
  id: string;
  type: string;
  severity: string;
  source: string;
  message: string;
  details: Record<string, any>;
  timestamp: number;
  acknowledged: boolean;
}

interface SecurityAlert {
  id: string;
  eventId: string;
  severity: string;
  title: string;
  message: string;
  actionRequired: boolean;
  autoEscalate: boolean;
  timestamp: number;
  resolved: boolean;
}

interface InjectionStats {
  totalDetections: number;
  totalBlocked: number;
  byType: Record<string, number>;
  bySeverity: Record<string, number>;
  bySource: Record<string, number>;
}

interface SanitizationStats {
  totalSanitizations: number;
  byCategory: Record<string, number>;
  averageConfidence: number;
}

interface SecuritySummary {
  threatScore: ThreatScore;
  recentEvents: number;
  unresolvedAlerts: number;
  injectionStats: InjectionStats;
  sanitizationStats: SanitizationStats;
}

const SEVERITY_COLORS: Record<string, string> = {
  low: "bg-green-500/10 text-green-600",
  medium: "bg-yellow-500/10 text-yellow-600",
  high: "bg-orange-500/10 text-orange-600",
  critical: "bg-red-500/10 text-red-600",
};

const EVENT_TYPE_LABELS: Record<string, { label: string; icon: React.ElementType; color: string }> = {
  injection_detected: { label: "Injection Detected", icon: Bug, color: "text-orange-500" },
  injection_blocked: { label: "Injection Blocked", icon: ShieldAlert, color: "text-red-500" },
  output_sanitized: { label: "Output Sanitized", icon: FileWarning, color: "text-yellow-500" },
  threat_escalation: { label: "Threat Escalation", icon: TrendingUp, color: "text-red-600" },
  emergency_stop_triggered: { label: "Emergency Stop", icon: Siren, color: "text-red-700" },
  anomaly_detected: { label: "Anomaly Detected", icon: AlertTriangle, color: "text-purple-500" },
};

function ThreatGauge({ score, label }: { score: number; label: string }) {
  const pct = Math.round(score * 100);
  const color = pct >= 70 ? "text-red-500" : pct >= 40 ? "text-yellow-500" : "text-green-500";
  const progressColor = pct >= 70 ? "bg-red-500" : pct >= 40 ? "bg-yellow-500" : "bg-green-500";

  return (
    <div className="space-y-1">
      <div className="flex items-center justify-between text-xs">
        <span className="text-muted-foreground">{label}</span>
        <span className={cn("font-bold", color)}>{pct}%</span>
      </div>
      <div className="h-2 rounded-full bg-muted overflow-hidden">
        <div
          className={cn("h-full rounded-full transition-all", progressColor)}
          style={{ width: `${pct}%` }}
        />
      </div>
    </div>
  );
}

export default function SecurityDashboard() {
  const queryClient = useQueryClient();
  const [severityFilter, setSeverityFilter] = useState<string | null>(null);

  const { data: summary, isLoading: summaryLoading } = useQuery<SecuritySummary>({
    queryKey: ["/api/admin/security/summary"],
    queryFn: () => apiFetchJson("/api/admin/security/summary"),
    refetchInterval: 5000,
    throwOnError: true,
  });

  const { data: eventsData, isLoading: eventsLoading } = useQuery<SecurityEvent[]>({
    queryKey: ["/api/admin/security/events"],
    queryFn: () => apiFetchJson("/api/admin/security/events?limit=100"),
    refetchInterval: 5000,
    throwOnError: true,
  });

  const { data: alertsData } = useQuery<SecurityAlert[]>({
    queryKey: ["/api/admin/security/alerts"],
    queryFn: () => apiFetchJson("/api/admin/security/alerts"),
    refetchInterval: 5000,
    throwOnError: true,
  });

  const threatScore = summary?.threatScore || { overall: 0, injectionRisk: 0, outputLeakRisk: 0, anomalyRisk: 0, trend: "stable", lastUpdated: Date.now() };
  const injectionStats = summary?.injectionStats || { totalDetections: 0, totalBlocked: 0, byType: {}, bySeverity: {}, bySource: {} };
  const sanitizationStats = summary?.sanitizationStats || { totalSanitizations: 0, byCategory: {}, averageConfidence: 0 };
  const events = eventsData || [];
  const alerts = alertsData || [];
  const unresolvedAlerts = alerts.filter((a) => !a.resolved);

  const filteredEvents = severityFilter
    ? events.filter((e) => e.severity === severityFilter)
    : events;

  const TrendIcon = threatScore.trend === "increasing" ? TrendingUp : threatScore.trend === "decreasing" ? TrendingDown : Minus;
  const trendColor = threatScore.trend === "increasing" ? "text-red-500" : threatScore.trend === "decreasing" ? "text-green-500" : "text-muted-foreground";

  if (summaryLoading) {
    return (
      <div className="flex items-center justify-center py-12" data-testid="security-loading">
        <Loader2 className="h-6 w-6 animate-spin" />
      </div>
    );
  }

  return (
    <div className="space-y-6" data-testid="security-dashboard">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-medium" data-testid="text-security-title">Security Dashboard</h2>
          <p className="text-sm text-muted-foreground">Real-time security monitoring, threat detection, and sanitization stats</p>
        </div>
        <Button variant="ghost" size="sm" onClick={() => {
          queryClient.invalidateQueries({ queryKey: ["/api/admin/security/summary"] });
          queryClient.invalidateQueries({ queryKey: ["/api/admin/security/events"] });
          queryClient.invalidateQueries({ queryKey: ["/api/admin/security/alerts"] });
        }} data-testid="button-refresh-security">
          <RefreshCw className="h-4 w-4" />
        </Button>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <Card data-testid="card-threat-score">
          <CardContent className="pt-4 pb-3">
            <div className="flex items-center gap-3 mb-2">
              <div className={cn("p-2 rounded-md", threatScore.overall >= 0.7 ? "bg-red-500/10" : threatScore.overall >= 0.4 ? "bg-yellow-500/10" : "bg-green-500/10")}>
                <Shield className={cn("h-4 w-4", threatScore.overall >= 0.7 ? "text-red-500" : threatScore.overall >= 0.4 ? "text-yellow-500" : "text-green-500")} />
              </div>
              <span className="text-sm text-muted-foreground">Threat Score</span>
            </div>
            <div className="flex items-center gap-2">
              <p className={cn("text-2xl font-bold", threatScore.overall >= 0.7 ? "text-red-500" : threatScore.overall >= 0.4 ? "text-yellow-500" : "text-green-500")} data-testid="text-threat-score">
                {Math.round(threatScore.overall * 100)}%
              </p>
              <TrendIcon className={cn("h-4 w-4", trendColor)} />
            </div>
          </CardContent>
        </Card>

        <Card data-testid="card-injection-count">
          <CardContent className="pt-4 pb-3">
            <div className="flex items-center gap-3 mb-2">
              <div className="p-2 rounded-md bg-orange-500/10">
                <Bug className="h-4 w-4 text-orange-500" />
              </div>
              <span className="text-sm text-muted-foreground">Injections Detected</span>
            </div>
            <p className="text-2xl font-bold" data-testid="text-injection-count">{injectionStats.totalDetections}</p>
            <p className="text-xs text-muted-foreground mt-1">{injectionStats.totalBlocked} blocked</p>
          </CardContent>
        </Card>

        <Card data-testid="card-sanitization-count">
          <CardContent className="pt-4 pb-3">
            <div className="flex items-center gap-3 mb-2">
              <div className="p-2 rounded-md bg-blue-500/10">
                <FileWarning className="h-4 w-4 text-blue-500" />
              </div>
              <span className="text-sm text-muted-foreground">Output Sanitizations</span>
            </div>
            <p className="text-2xl font-bold" data-testid="text-sanitization-count">{sanitizationStats.totalSanitizations}</p>
            <p className="text-xs text-muted-foreground mt-1">Avg confidence: {(sanitizationStats.averageConfidence * 100).toFixed(0)}%</p>
          </CardContent>
        </Card>

        <Card data-testid="card-alerts-count">
          <CardContent className="pt-4 pb-3">
            <div className="flex items-center gap-3 mb-2">
              <div className={cn("p-2 rounded-md", unresolvedAlerts.length > 0 ? "bg-red-500/10" : "bg-green-500/10")}>
                <AlertTriangle className={cn("h-4 w-4", unresolvedAlerts.length > 0 ? "text-red-500" : "text-green-500")} />
              </div>
              <span className="text-sm text-muted-foreground">Unresolved Alerts</span>
            </div>
            <p className="text-2xl font-bold" data-testid="text-unresolved-alerts">{unresolvedAlerts.length}</p>
            <p className="text-xs text-muted-foreground mt-1">{alerts.length} total alerts</p>
          </CardContent>
        </Card>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <Card className="lg:col-span-2" data-testid="card-threat-gauges">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium">Threat Breakdown</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <ThreatGauge score={threatScore.injectionRisk} label="Injection Risk" />
            <ThreatGauge score={threatScore.outputLeakRisk} label="Output Leak Risk" />
            <ThreatGauge score={threatScore.anomalyRisk} label="Anomaly Risk" />
            <div className="pt-2 border-t mt-3">
              <ThreatGauge score={threatScore.overall} label="Overall Threat" />
            </div>
          </CardContent>
        </Card>

        <Card data-testid="card-injection-breakdown">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium">Injection Types</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-2">
              {Object.entries(injectionStats.byType || {}).map(([type, count]) => (
                <div key={type} className="flex items-center justify-between text-xs">
                  <span className="text-muted-foreground">{type.replace(/_/g, " ")}</span>
                  <Badge variant="outline" className="text-[10px]">{count as number}</Badge>
                </div>
              ))}
              {Object.keys(injectionStats.byType || {}).length === 0 && (
                <p className="text-xs text-muted-foreground text-center py-4">No injection data</p>
              )}
            </div>
            <div className="mt-4 pt-3 border-t">
              <p className="text-xs font-medium mb-2">By Severity</p>
              <div className="space-y-1">
                {Object.entries(injectionStats.bySeverity || {}).map(([sev, count]) => (
                  <div key={sev} className="flex items-center justify-between text-xs">
                    <Badge variant="outline" className={cn("text-[10px]", SEVERITY_COLORS[sev])}>{sev}</Badge>
                    <span>{count as number}</span>
                  </div>
                ))}
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      <Tabs defaultValue="events" className="space-y-4">
        <TabsList data-testid="security-tabs">
          <TabsTrigger value="events" data-testid="tab-events">
            <Activity className="h-4 w-4 mr-1" />
            Events Timeline
          </TabsTrigger>
          <TabsTrigger value="alerts" data-testid="tab-alerts">
            <AlertTriangle className="h-4 w-4 mr-1" />
            Alerts
            {unresolvedAlerts.length > 0 && (
              <Badge variant="destructive" className="ml-1 h-5 px-1.5 text-[10px]">{unresolvedAlerts.length}</Badge>
            )}
          </TabsTrigger>
          <TabsTrigger value="sanitization" data-testid="tab-sanitization">
            <Lock className="h-4 w-4 mr-1" />
            Sanitization
          </TabsTrigger>
        </TabsList>

        <TabsContent value="events" className="space-y-3">
          <div className="flex items-center gap-2">
            {["low", "medium", "high", "critical"].map((sev) => (
              <Button
                key={sev}
                variant={severityFilter === sev ? "secondary" : "ghost"}
                size="sm"
                className="h-7 text-xs"
                onClick={() => setSeverityFilter(severityFilter === sev ? null : sev)}
                data-testid={`button-filter-${sev}`}
              >
                {sev}
              </Button>
            ))}
            {severityFilter && (
              <Button variant="ghost" size="sm" className="h-7 text-xs" onClick={() => setSeverityFilter(null)} data-testid="button-clear-filter">
                Clear
              </Button>
            )}
          </div>

          {eventsLoading ? (
            <div className="flex items-center justify-center py-8">
              <Loader2 className="h-5 w-5 animate-spin" />
            </div>
          ) : filteredEvents.length === 0 ? (
            <Card>
              <CardContent className="py-8 text-center text-sm text-muted-foreground" data-testid="text-no-events">
                <ShieldCheck className="h-8 w-8 mx-auto mb-2 text-green-500/50" />
                No security events recorded
              </CardContent>
            </Card>
          ) : (
            <div className="space-y-1.5 max-h-[500px] overflow-y-auto">
              {[...filteredEvents].reverse().map((event) => {
                const typeInfo = EVENT_TYPE_LABELS[event.type] || { label: event.type, icon: Activity, color: "text-muted-foreground" };
                const TypeIcon = typeInfo.icon;
                return (
                  <div
                    key={event.id}
                    className="flex items-start gap-3 py-2 px-3 rounded-md border hover:bg-muted/50"
                    data-testid={`row-event-${event.id}`}
                  >
                    <TypeIcon className={cn("h-4 w-4 mt-0.5 shrink-0", typeInfo.color)} />
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="text-xs font-medium">{typeInfo.label}</span>
                        <Badge variant="outline" className={cn("text-[10px]", SEVERITY_COLORS[event.severity])}>{event.severity}</Badge>
                        <span className="text-[10px] text-muted-foreground">{event.source}</span>
                      </div>
                      <p className="text-xs text-muted-foreground mt-0.5 truncate">{event.message}</p>
                    </div>
                    <span className="text-[10px] text-muted-foreground shrink-0">{new Date(event.timestamp).toLocaleTimeString()}</span>
                  </div>
                );
              })}
            </div>
          )}
        </TabsContent>

        <TabsContent value="alerts" className="space-y-3">
          {unresolvedAlerts.length === 0 && alerts.length === 0 ? (
            <Card>
              <CardContent className="py-8 text-center text-sm text-muted-foreground" data-testid="text-no-alerts">
                <CheckCircle className="h-8 w-8 mx-auto mb-2 text-green-500/50" />
                No security alerts
              </CardContent>
            </Card>
          ) : (
            <div className="space-y-2">
              {unresolvedAlerts.map((alert) => (
                <Card key={alert.id} className="border-l-4 border-l-red-500" data-testid={`card-alert-${alert.id}`}>
                  <CardContent className="pt-3 pb-2">
                    <div className="flex items-start justify-between">
                      <div>
                        <div className="flex items-center gap-2">
                          <Siren className="h-3.5 w-3.5 text-red-500" />
                          <span className="text-sm font-medium">{alert.title}</span>
                          <Badge variant="outline" className={cn("text-[10px]", SEVERITY_COLORS[alert.severity])}>{alert.severity}</Badge>
                          {alert.actionRequired && <Badge variant="destructive" className="text-[10px]">Action Required</Badge>}
                        </div>
                        <p className="text-xs text-muted-foreground mt-1">{alert.message}</p>
                        <p className="text-[10px] text-muted-foreground mt-1">{new Date(alert.timestamp).toLocaleString()}</p>
                      </div>
                    </div>
                  </CardContent>
                </Card>
              ))}
              {alerts.filter((a) => a.resolved).length > 0 && (
                <>
                  <p className="text-xs text-muted-foreground pt-2">Resolved ({alerts.filter((a) => a.resolved).length})</p>
                  {alerts.filter((a) => a.resolved).slice(-10).reverse().map((alert) => (
                    <div key={alert.id} className="flex items-center gap-3 py-1.5 px-3 rounded-md border text-xs opacity-60" data-testid={`row-resolved-alert-${alert.id}`}>
                      <CheckCircle className="h-3.5 w-3.5 text-green-500" />
                      <span className="flex-1 truncate">{alert.title}</span>
                      <span className="text-muted-foreground">{new Date(alert.timestamp).toLocaleString()}</span>
                    </div>
                  ))}
                </>
              )}
            </div>
          )}
        </TabsContent>

        <TabsContent value="sanitization" className="space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <Card data-testid="card-sanitization-categories">
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-medium">Sanitization by Category</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="space-y-3">
                  {Object.entries(sanitizationStats.byCategory || {}).map(([cat, count]) => (
                    <div key={cat} className="flex items-center justify-between">
                      <span className="text-xs text-muted-foreground">{cat.replace(/_/g, " ")}</span>
                      <Badge variant="outline" className="text-[10px]">{count as number}</Badge>
                    </div>
                  ))}
                  {Object.keys(sanitizationStats.byCategory || {}).length === 0 && (
                    <p className="text-xs text-muted-foreground text-center py-4">No sanitization data</p>
                  )}
                </div>
              </CardContent>
            </Card>

            <Card data-testid="card-sanitization-summary">
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-medium">Sanitization Summary</CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <div>
                  <p className="text-xs text-muted-foreground">Total Sanitizations</p>
                  <p className="text-2xl font-bold" data-testid="text-total-sanitizations">{sanitizationStats.totalSanitizations}</p>
                </div>
                <div>
                  <p className="text-xs text-muted-foreground">Average Confidence</p>
                  <p className="text-2xl font-bold" data-testid="text-avg-confidence">{(sanitizationStats.averageConfidence * 100).toFixed(0)}%</p>
                </div>
                <div>
                  <p className="text-xs text-muted-foreground mb-1">Detection Sources</p>
                  <div className="space-y-1">
                    {Object.entries(injectionStats.bySource || {}).map(([source, count]) => (
                      <div key={source} className="flex items-center justify-between text-xs">
                        <span className="text-muted-foreground">{source.replace(/_/g, " ")}</span>
                        <span>{count as number}</span>
                      </div>
                    ))}
                  </div>
                </div>
              </CardContent>
            </Card>
          </div>
        </TabsContent>
      </Tabs>
    </div>
  );
}
