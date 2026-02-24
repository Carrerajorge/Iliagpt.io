import React, { useState, useEffect } from 'react';
import { useLocation } from 'wouter';
import {
  Activity,
  AlertTriangle,
  CheckCircle,
  Clock,
  RefreshCw,
  Server,
  Zap,
  Cpu,
  Shield,
  ArrowLeft,
  TrendingUp,
  XCircle,
  AlertCircle
} from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Progress } from '@/components/ui/progress';
import { Button } from '@/components/ui/button';
import { usePlatformSettings } from '@/contexts/PlatformSettingsContext';
import { formatZonedTime, normalizeTimeZone } from '@/lib/platformDateTime';

interface ExecutionAnalytics {
  totalExecutions: number;
  successRate: number;
  averageExecutionTime: number;
  activeExecutions: number;
  toolAnalytics: Record<string, { executions: number; successRate: number; avgTime: number }>;
}

interface PythonToolsHealth {
  success: boolean;
  status?: string;
  tools_count?: number;
  agents_count?: number;
  circuit_breakers?: Record<string, { state: string; failures: number }>;
}

interface SystemHealth {
  status: string;
  uptime?: number;
  version?: string;
  connections?: number;
}

interface ObservabilityHealth {
  status: string;
  services?: Record<string, { status: string; latency?: number }>;
}

interface RecentExecution {
  executionId: string;
  toolName: string;
  success: boolean;
  duration: number;
  timestamp: string;
  error?: string;
}

export default function MonitoringDashboard() {
  const [, setLocation] = useLocation();
  const [loading, setLoading] = useState(true);
  const [autoRefresh, setAutoRefresh] = useState(true);
  const [lastUpdate, setLastUpdate] = useState<Date>(new Date());
  const { settings: platformSettings } = usePlatformSettings();
  const platformTimeZone = normalizeTimeZone(platformSettings.timezone_default);
  
  const [executionAnalytics, setExecutionAnalytics] = useState<ExecutionAnalytics | null>(null);
  const [pythonHealth, setPythonHealth] = useState<PythonToolsHealth | null>(null);
  const [systemHealth, setSystemHealth] = useState<SystemHealth | null>(null);
  const [observabilityHealth, setObservabilityHealth] = useState<ObservabilityHealth | null>(null);
  const [recentExecutions, setRecentExecutions] = useState<RecentExecution[]>([]);

  const fetchData = async () => {
    try {
      const [analyticsRes, pythonRes, healthRes, obsRes, historyRes] = await Promise.allSettled([
        fetch('/api/execution/analytics'),
        fetch('/api/python-tools/health'),
        fetch('/health'),
        fetch('/api/observability/health'),
        fetch('/api/execution/history?limit=10')
      ]);

      if (analyticsRes.status === 'fulfilled' && analyticsRes.value.ok) {
        const data = await analyticsRes.value.json();
        setExecutionAnalytics(data.analytics || data);
      }

      if (pythonRes.status === 'fulfilled' && pythonRes.value.ok) {
        setPythonHealth(await pythonRes.value.json());
      }

      if (healthRes.status === 'fulfilled' && healthRes.value.ok) {
        setSystemHealth(await healthRes.value.json());
      }

      if (obsRes.status === 'fulfilled' && obsRes.value.ok) {
        setObservabilityHealth(await obsRes.value.json());
      }

      if (historyRes.status === 'fulfilled' && historyRes.value.ok) {
        const data = await historyRes.value.json();
        setRecentExecutions(data.history || []);
      }

      setLastUpdate(new Date());
    } catch (error) {
      console.error('Error fetching monitoring data:', error);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchData();

    if (autoRefresh) {
      const interval = setInterval(fetchData, 15000);
      return () => clearInterval(interval);
    }
  }, [autoRefresh]);

  const getStatusColor = (status: string) => {
    switch (status?.toLowerCase()) {
      case 'healthy':
      case 'ok':
      case 'running':
        return 'success';
      case 'degraded':
      case 'warning':
        return 'warning';
      default:
        return 'destructive';
    }
  };

  const getStatusIcon = (status: string) => {
    switch (status?.toLowerCase()) {
      case 'healthy':
      case 'ok':
      case 'running':
        return <CheckCircle className="w-5 h-5 text-green-500" />;
      case 'degraded':
      case 'warning':
        return <AlertCircle className="w-5 h-5 text-amber-500" />;
      default:
        return <XCircle className="w-5 h-5 text-red-500" />;
    }
  };

  const formatUptime = (seconds?: number) => {
    if (!seconds) return 'N/A';
    const days = Math.floor(seconds / 86400);
    const hours = Math.floor((seconds % 86400) / 3600);
    const mins = Math.floor((seconds % 3600) / 60);
    if (days > 0) return `${days}d ${hours}h`;
    if (hours > 0) return `${hours}h ${mins}m`;
    return `${mins}m`;
  };

  const formatDuration = (ms: number) => {
    if (ms < 1000) return `${Math.round(ms)}ms`;
    return `${(ms / 1000).toFixed(2)}s`;
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-screen" data-testid="loading-spinner">
        <RefreshCw className="w-8 h-8 text-primary animate-spin" />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background p-6" data-testid="monitoring-dashboard">
      <div className="max-w-7xl mx-auto space-y-6">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-4">
            <Button
              variant="ghost"
              size="icon"
              onClick={() => setLocation('/')}
              data-testid="button-back"
            >
              <ArrowLeft className="w-5 h-5" />
            </Button>
            <div>
              <h1 className="text-2xl font-bold flex items-center gap-3" data-testid="dashboard-title">
                <Activity className="w-7 h-7 text-primary" />
                Monitoring Dashboard
              </h1>
              <p className="text-muted-foreground mt-1">
                Last updated: {formatZonedTime(lastUpdate, { timeZone: platformTimeZone, includeSeconds: true })}
              </p>
            </div>
          </div>

          <div className="flex items-center gap-3">
            <label className="flex items-center gap-2 text-sm text-muted-foreground">
              <input
                type="checkbox"
                checked={autoRefresh}
                onChange={(e) => setAutoRefresh(e.target.checked)}
                className="rounded"
                data-testid="checkbox-auto-refresh"
              />
              Auto-refresh
            </label>
            <Button
              variant="outline"
              size="sm"
              onClick={fetchData}
              data-testid="button-refresh"
            >
              <RefreshCw className="w-4 h-4 mr-2" />
              Refresh
            </Button>
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
          <Card data-testid="card-system-status">
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium flex items-center gap-2">
                <Server className="w-4 h-4" />
                System Status
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="flex items-center gap-2">
                {getStatusIcon(systemHealth?.status || 'unknown')}
                <Badge variant={getStatusColor(systemHealth?.status || 'unknown')} data-testid="badge-system-status">
                  {systemHealth?.status || 'Unknown'}
                </Badge>
              </div>
              <p className="text-sm text-muted-foreground mt-2">
                Uptime: {formatUptime(systemHealth?.uptime)}
              </p>
            </CardContent>
          </Card>

          <Card data-testid="card-active-connections">
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium flex items-center gap-2">
                <Zap className="w-4 h-4" />
                Active Connections
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-3xl font-bold" data-testid="text-connections">
                {systemHealth?.connections || 0}
              </div>
              <p className="text-sm text-muted-foreground">Current connections</p>
            </CardContent>
          </Card>

          <Card data-testid="card-total-executions">
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium flex items-center gap-2">
                <TrendingUp className="w-4 h-4" />
                Total Executions
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-3xl font-bold" data-testid="text-executions">
                {executionAnalytics?.totalExecutions || 0}
              </div>
              <p className="text-sm text-muted-foreground">
                Active: {executionAnalytics?.activeExecutions || 0}
              </p>
            </CardContent>
          </Card>

          <Card data-testid="card-success-rate">
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium flex items-center gap-2">
                <CheckCircle className="w-4 h-4" />
                Success Rate
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-3xl font-bold" data-testid="text-success-rate">
                {executionAnalytics?.successRate?.toFixed(1) || 0}%
              </div>
              <Progress 
                value={executionAnalytics?.successRate || 0} 
                className="mt-2"
              />
            </CardContent>
          </Card>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          <Card data-testid="card-python-tools">
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Cpu className="w-5 h-5" />
                Python Agent Tools
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="flex items-center justify-between">
                <span className="text-sm text-muted-foreground">Health Status</span>
                <div className="flex items-center gap-2">
                  {pythonHealth?.success ? (
                    <Badge variant="success" data-testid="badge-python-health">Healthy</Badge>
                  ) : (
                    <Badge variant="destructive" data-testid="badge-python-health">Unavailable</Badge>
                  )}
                </div>
              </div>
              
              <div className="flex items-center justify-between">
                <span className="text-sm text-muted-foreground">Available Tools</span>
                <span className="font-medium" data-testid="text-tools-count">
                  {pythonHealth?.tools_count || 0}
                </span>
              </div>
              
              <div className="flex items-center justify-between">
                <span className="text-sm text-muted-foreground">Active Agents</span>
                <span className="font-medium" data-testid="text-agents-count">
                  {pythonHealth?.agents_count || 0}
                </span>
              </div>

              {pythonHealth?.circuit_breakers && Object.keys(pythonHealth.circuit_breakers).length > 0 && (
                <div className="pt-2 border-t">
                  <h4 className="text-sm font-medium mb-2">Circuit Breakers</h4>
                  <div className="space-y-2">
                    {Object.entries(pythonHealth.circuit_breakers).slice(0, 5).map(([name, cb]) => (
                      <div key={name} className="flex items-center justify-between text-sm" data-testid={`circuit-breaker-${name}`}>
                        <span className="text-muted-foreground truncate">{name}</span>
                        <Badge variant={cb.state === 'closed' ? 'success' : 'warning'}>
                          {cb.state}
                        </Badge>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </CardContent>
          </Card>

          <Card data-testid="card-llm-gateway">
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Shield className="w-5 h-5" />
                LLM Gateway Status
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              {observabilityHealth?.services ? (
                Object.entries(observabilityHealth.services).map(([provider, info]) => (
                  <div key={provider} className="flex items-center justify-between" data-testid={`llm-provider-${provider}`}>
                    <div>
                      <span className="font-medium capitalize">{provider}</span>
                      {info.latency && (
                        <span className="text-sm text-muted-foreground ml-2">
                          ({info.latency}ms)
                        </span>
                      )}
                    </div>
                    <Badge variant={getStatusColor(info.status)}>
                      {info.status}
                    </Badge>
                  </div>
                ))
              ) : (
                <>
                  <div className="flex items-center justify-between" data-testid="llm-provider-gemini">
                    <span className="font-medium">Gemini</span>
                    <Badge variant={observabilityHealth?.status === 'healthy' ? 'success' : 'secondary'}>
                      {observabilityHealth?.status || 'Unknown'}
                    </Badge>
                  </div>
                  <div className="flex items-center justify-between" data-testid="llm-provider-xai">
                    <span className="font-medium">xAI</span>
                    <Badge variant={observabilityHealth?.status === 'healthy' ? 'success' : 'secondary'}>
                      {observabilityHealth?.status || 'Unknown'}
                    </Badge>
                  </div>
                </>
              )}

              <div className="pt-2 border-t">
                <div className="flex items-center justify-between">
                  <span className="text-sm text-muted-foreground">Avg Execution Time</span>
                  <span className="font-medium" data-testid="text-avg-execution-time">
                    {formatDuration(executionAnalytics?.averageExecutionTime || 0)}
                  </span>
                </div>
              </div>
            </CardContent>
          </Card>
        </div>

        <Card data-testid="card-recent-activity">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Clock className="w-5 h-5" />
              Recent Activity
            </CardTitle>
          </CardHeader>
          <CardContent>
            {recentExecutions.length > 0 ? (
              <div className="overflow-x-auto">
                <table className="w-full" data-testid="table-recent-executions">
                  <thead>
                    <tr className="border-b">
                      <th className="px-4 py-3 text-left text-sm font-medium text-muted-foreground">Tool</th>
                      <th className="px-4 py-3 text-left text-sm font-medium text-muted-foreground">Status</th>
                      <th className="px-4 py-3 text-left text-sm font-medium text-muted-foreground">Duration</th>
                      <th className="px-4 py-3 text-left text-sm font-medium text-muted-foreground">Time</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y">
                    {recentExecutions.map((exec) => (
                      <tr key={exec.executionId} className="hover:bg-muted/50" data-testid={`execution-row-${exec.executionId}`}>
                        <td className="px-4 py-3 text-sm font-medium">
                          {exec.toolName}
                        </td>
                        <td className="px-4 py-3">
                          {exec.success ? (
                            <Badge variant="success" className="text-xs">Success</Badge>
                          ) : (
                            <Badge variant="destructive" className="text-xs">Failed</Badge>
                          )}
                        </td>
                        <td className="px-4 py-3 text-sm text-muted-foreground">
                          {formatDuration(exec.duration)}
                        </td>
                        <td className="px-4 py-3 text-sm text-muted-foreground">
                          {formatZonedTime(exec.timestamp, { timeZone: platformTimeZone, includeSeconds: true })}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <div className="flex flex-col items-center justify-center py-12">
                <Activity className="w-12 h-12 text-muted-foreground/50 mb-3" />
                <p className="text-muted-foreground">No recent activity</p>
              </div>
            )}
          </CardContent>
        </Card>

        {recentExecutions.some(e => !e.success) && (
          <Card data-testid="card-recent-errors">
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-destructive">
                <AlertTriangle className="w-5 h-5" />
                Recent Errors
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="space-y-3">
                {recentExecutions
                  .filter(e => !e.success)
                  .slice(0, 5)
                  .map((exec) => (
                    <div
                      key={exec.executionId}
                      className="p-3 bg-destructive/10 border border-destructive/20 rounded-lg"
                      data-testid={`error-${exec.executionId}`}
                    >
                      <div className="flex items-center justify-between">
                        <span className="font-medium text-sm">{exec.toolName}</span>
                        <span className="text-xs text-muted-foreground">
                          {formatZonedTime(exec.timestamp, { timeZone: platformTimeZone, includeSeconds: true })}
                        </span>
                      </div>
                      {exec.error && (
                        <p className="text-sm text-muted-foreground mt-1">{exec.error}</p>
                      )}
                    </div>
                  ))}
              </div>
            </CardContent>
          </Card>
        )}
      </div>
    </div>
  );
}
