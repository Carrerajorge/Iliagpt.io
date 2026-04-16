import React, { useState, useCallback, useEffect, useMemo } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import {
  Play,
  Code,
  Copy,
  Check,
  ChevronDown,
  ChevronRight,
  Loader2,
  AlertCircle,
  BarChart3,
  Table,
  FileText,
  Sparkles,
  Layers,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Progress } from '@/components/ui/progress';
import { cn } from '@/lib/utils';

type AnalysisMode = 'full' | 'text_only' | 'numbers_only';
type AnalysisStatus = 'idle' | 'pending' | 'generating' | 'executing' | 'success' | 'error';
type AnalysisScope = 'active' | 'selected' | 'all';

interface SheetJobResult {
  tables?: Array<{
    title: string;
    headers: string[];
    rows: any[][];
  }>;
  metrics?: Array<{
    label: string;
    value: string | number;
    change?: string;
  }>;
  charts?: Array<{
    type: 'bar' | 'line' | 'pie';
    title: string;
    data: any;
  }>;
  summary?: string;
  logs?: string[];
}

interface AnalysisJob {
  sheetName: string;
  status: 'queued' | 'running' | 'done' | 'failed';
  result?: SheetJobResult;
  error?: string;
}

interface MultiSheetProgress {
  status: 'pending' | 'running' | 'completed' | 'failed';
  progress: { completedJobs: number; totalJobs: number };
  jobs: AnalysisJob[];
  summary?: string;
}

interface AnalysisResult {
  sessionId: string;
  status: AnalysisStatus;
  generatedCode?: string;
  results?: SheetJobResult;
  error?: string;
  multiSheet?: {
    jobs: AnalysisJob[];
    crossSheetSummary?: string;
  };
}

interface AnalysisPanelProps {
  uploadId: string;
  sheetName: string;
  selectedSheets: string[];
  allSheets: string[];
  analysisSession: AnalysisResult | null;
  onAnalysisComplete: (result: AnalysisResult) => void;
}

const STATUS_CONFIG: Record<AnalysisStatus, { label: string; variant: 'default' | 'secondary' | 'success' | 'destructive' | 'warning' }> = {
  idle: { label: 'Ready', variant: 'secondary' },
  pending: { label: 'Pending', variant: 'warning' },
  generating: { label: 'Generating Code', variant: 'warning' },
  executing: { label: 'Executing', variant: 'warning' },
  success: { label: 'Complete', variant: 'success' },
  error: { label: 'Error', variant: 'destructive' },
};

export function AnalysisPanel({
  uploadId,
  sheetName,
  selectedSheets,
  allSheets,
  analysisSession,
  onAnalysisComplete,
}: AnalysisPanelProps) {
  const [mode, setMode] = useState<AnalysisMode>('full');
  const [scope, setScope] = useState<AnalysisScope>('active');
  const [prompt, setPrompt] = useState('');
  const [codeExpanded, setCodeExpanded] = useState(false);
  const [codeCopied, setCodeCopied] = useState(false);
  const [currentSessionId, setCurrentSessionId] = useState<string | null>(null);
  const [isMultiSheetAnalysis, setIsMultiSheetAnalysis] = useState(false);
  const [activeResultTab, setActiveResultTab] = useState<string>('summary');

  const isPolling = !!currentSessionId;
  
  const { data: sessionData } = useQuery({
    queryKey: ['analysis-session', currentSessionId, isMultiSheetAnalysis],
    queryFn: async () => {
      if (!currentSessionId) return null;
      const endpoint = isMultiSheetAnalysis 
        ? `/api/spreadsheet/analyze/progress/${currentSessionId}`
        : `/api/spreadsheet/analysis/${currentSessionId}`;
      const res = await fetch(endpoint);
      if (!res.ok) throw new Error('Failed to fetch analysis');
      return res.json();
    },
    enabled: isPolling,
    refetchInterval: isPolling ? 2000 : false,
  });

  useEffect(() => {
    if (!sessionData) return;

    if (isMultiSheetAnalysis) {
      const progress = sessionData as MultiSheetProgress;
      const mappedStatus: AnalysisStatus = 
        progress.status === 'completed' ? 'success' :
        progress.status === 'failed' ? 'error' :
        progress.status === 'running' ? 'executing' :
        'pending';

      const result: AnalysisResult = {
        sessionId: currentSessionId!,
        status: mappedStatus,
        multiSheet: {
          jobs: progress.jobs,
          crossSheetSummary: progress.summary,
        },
      };
      onAnalysisComplete(result);

      if (progress.status === 'completed' || progress.status === 'failed') {
        setCurrentSessionId(null);
      }
    } else if (sessionData.session) {
      const status = sessionData.session.status;
      const mappedStatus: AnalysisStatus = 
        status === 'generating_code' ? 'generating' :
        status === 'executing' ? 'executing' :
        status === 'succeeded' ? 'success' :
        status === 'failed' ? 'error' :
        status === 'pending' ? 'pending' : 'idle';

      const outputs = sessionData.outputs || [];
      const summaryOutput = outputs.find((o: any) => o.type === 'summary');
      const metricsOutput = outputs.find((o: any) => o.type === 'metric');
      const tableOutputs = outputs.filter((o: any) => o.type === 'table');
      const chartOutputs = outputs.filter((o: any) => o.type === 'chart');
      const logOutput = outputs.find((o: any) => o.type === 'log');

      const summaryValue = summaryOutput?.payload 
        ? (typeof summaryOutput.payload === 'string' ? summaryOutput.payload : summaryOutput.payload?.summary)
        : undefined;

      const logsValue = logOutput?.payload
        ? (Array.isArray(logOutput.payload) ? logOutput.payload : logOutput.payload?.logs)
        : undefined;

      const result: AnalysisResult = {
        sessionId: sessionData.session.id,
        status: mappedStatus,
        generatedCode: sessionData.session.generatedCode,
        error: sessionData.session.errorMessage,
        results: {
          summary: summaryValue,
          metrics: metricsOutput ? Object.entries(metricsOutput.payload).map(([label, value]) => ({ label, value: value as string | number })) : [],
          tables: tableOutputs.map((o: any) => ({
            title: o.payload?.name || o.title || 'Data Table',
            headers: o.payload?.data?.[0] ? Object.keys(o.payload.data[0]) : [],
            rows: o.payload?.data?.map((row: any) => Object.values(row)) || [],
          })),
          charts: chartOutputs.map((o: any) => o.payload),
          logs: logsValue,
        },
      };
      onAnalysisComplete(result);

      if (status === 'succeeded' || status === 'failed') {
        setCurrentSessionId(null);
      }
    }
  }, [sessionData, onAnalysisComplete, isMultiSheetAnalysis, currentSessionId]);

  const analyzeMutation = useMutation({
    mutationFn: async () => {
      const useMultiSheet = scope !== 'active';
      setIsMultiSheetAnalysis(useMultiSheet);

      if (useMultiSheet) {
        const res = await fetch(`/api/spreadsheet/${uploadId}/analyze/start`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            scope,
            selectedSheets: scope === 'selected' ? selectedSheets : allSheets,
            prompt: prompt.trim() || undefined,
          }),
        });
        if (!res.ok) {
          const err = await res.json().catch(() => ({}));
          throw new Error(err.message || 'Analysis failed');
        }
        return res.json();
      } else {
        const res = await fetch(`/api/spreadsheet/${uploadId}/analyze`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            sheetName,
            mode,
            prompt: prompt.trim() || undefined,
          }),
        });
        if (!res.ok) {
          const err = await res.json().catch(() => ({}));
          throw new Error(err.message || 'Analysis failed');
        }
        return res.json();
      }
    },
    onSuccess: (data) => {
      setCurrentSessionId(data.sessionId);
      onAnalysisComplete({ sessionId: data.sessionId, status: 'pending' });
    },
  });

  const handleAnalyze = useCallback(() => {
    analyzeMutation.mutate();
  }, [analyzeMutation]);

  const handleCopyCode = useCallback(async () => {
    if (analysisSession?.generatedCode) {
      await navigator.clipboard.writeText(analysisSession.generatedCode);
      setCodeCopied(true);
      setTimeout(() => setCodeCopied(false), 2000);
    }
  }, [analysisSession?.generatedCode]);

  const currentStatus: AnalysisStatus = analyzeMutation.isPending
    ? 'generating'
    : currentSessionId
    ? (isMultiSheetAnalysis 
       ? ((sessionData as MultiSheetProgress)?.status === 'running' ? 'executing' : 'pending')
       : (sessionData?.session?.status === 'generating_code' ? 'generating' :
          sessionData?.session?.status === 'executing' ? 'executing' :
          'pending'))
    : analysisSession?.status ?? 'idle';
  const statusConfig = STATUS_CONFIG[currentStatus];

  const multiSheetProgress = useMemo(() => {
    if (!isMultiSheetAnalysis || !sessionData) return null;
    const progress = sessionData as MultiSheetProgress;
    return {
      completed: progress.progress?.completedJobs || 0,
      total: progress.progress?.totalJobs || 0,
      percentage: progress.progress?.totalJobs 
        ? Math.round((progress.progress.completedJobs / progress.progress.totalJobs) * 100)
        : 0,
      currentSheet: progress.jobs?.find(j => j.status === 'running')?.sheetName,
    };
  }, [isMultiSheetAnalysis, sessionData]);

  const scopeLabel = useMemo(() => {
    switch (scope) {
      case 'active':
        return 'Active sheet';
      case 'selected':
        return `Selected sheets (${selectedSheets.length})`;
      case 'all':
        return `All sheets (${allSheets.length})`;
      default:
        return 'Active sheet';
    }
  }, [scope, selectedSheets.length, allSheets.length]);

  const renderSheetResult = (result: SheetJobResult) => (
    <div className="space-y-4">
      {result.summary && (
        <div className="p-3 bg-muted/50 rounded-lg">
          <h4 className="text-sm font-medium mb-1">Summary</h4>
          <p className="text-sm text-muted-foreground">{result.summary}</p>
        </div>
      )}

      {result.metrics && result.metrics.length > 0 && (
        <div>
          <h4 className="text-sm font-medium mb-2">Key Metrics</h4>
          <div className="grid grid-cols-2 gap-2">
            {result.metrics.map((metric, idx) => (
              <div key={idx} className="p-3 bg-muted/50 rounded-lg">
                <p className="text-xs text-muted-foreground">{metric.label}</p>
                <p className="text-lg font-semibold">{metric.value}</p>
                {metric.change && (
                  <p className={cn(
                    "text-xs",
                    metric.change.startsWith('+') ? 'text-green-500' : 'text-red-500'
                  )}>
                    {metric.change}
                  </p>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {result.tables && result.tables.length > 0 && (
        <div>
          <h4 className="text-sm font-medium mb-2">Data Tables</h4>
          {result.tables.map((table, idx) => (
            <div key={idx} className="border rounded-lg overflow-hidden mb-2">
              <div className="bg-muted/50 px-3 py-2 border-b">
                <p className="text-sm font-medium">{table.title}</p>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="bg-muted/30">
                    <tr>
                      {table.headers.map((header, hIdx) => (
                        <th key={hIdx} className="text-left p-2 border-b font-medium">
                          {header}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {table.rows.map((row, rIdx) => (
                      <tr key={rIdx} className="hover:bg-muted/20">
                        {row.map((cell, cIdx) => (
                          <td key={cIdx} className="p-2 border-b">
                            {cell}
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          ))}
        </div>
      )}

      {result.charts && result.charts.length > 0 && (
        <div>
          <h4 className="text-sm font-medium mb-2">Charts</h4>
          <div className="grid gap-2">
            {result.charts.map((chart, idx) => (
              <div key={idx} className="p-3 bg-muted/50 rounded-lg">
                <p className="text-sm font-medium mb-2">{chart.title}</p>
                <div className="h-48 flex items-center justify-center text-muted-foreground">
                  <BarChart3 className="h-12 w-12" />
                  <span className="ml-2 text-sm">Chart: {chart.type}</span>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {result.logs && result.logs.length > 0 && (
        <div>
          <h4 className="text-sm font-medium mb-2">Execution Logs</h4>
          <div className="bg-zinc-900 text-zinc-100 rounded-lg p-3 font-mono text-xs overflow-x-auto max-h-[200px] overflow-y-auto">
            {result.logs.map((log, idx) => (
              <div key={idx} className="py-0.5 text-zinc-300 whitespace-pre-wrap">
                <span className="text-zinc-500 mr-2 select-none">{`>`}</span>
                {log}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );

  return (
    <Card className="h-full flex flex-col">
      <CardHeader className="pb-3 flex-shrink-0">
        <div className="flex items-center justify-between">
          <CardTitle className="text-lg flex items-center gap-2">
            <Sparkles className="h-5 w-5" />
            AI Analysis
          </CardTitle>
          <Badge variant={statusConfig.variant} dot>
            {statusConfig.label}
          </Badge>
        </div>
      </CardHeader>

      <CardContent className="flex-1 flex flex-col gap-4 min-h-0 pt-0">
        <div className="flex flex-col gap-3">
          <div className="flex items-center gap-3">
            <div className="flex-1">
              <label className="text-sm font-medium mb-1.5 block">Analysis Scope</label>
              <Select value={scope} onValueChange={(val) => setScope(val as AnalysisScope)}>
                <SelectTrigger data-testid="scope-select">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="active">
                    <div className="flex items-center gap-2">
                      <FileText className="h-4 w-4" />
                      Active sheet
                    </div>
                  </SelectItem>
                  <SelectItem value="selected" disabled={selectedSheets.length === 0}>
                    <div className="flex items-center gap-2">
                      <Layers className="h-4 w-4" />
                      Selected sheets ({selectedSheets.length})
                    </div>
                  </SelectItem>
                  <SelectItem value="all">
                    <div className="flex items-center gap-2">
                      <Table className="h-4 w-4" />
                      All sheets ({allSheets.length})
                    </div>
                  </SelectItem>
                </SelectContent>
              </Select>
            </div>

            {scope === 'active' && (
              <div className="flex-1">
                <label className="text-sm font-medium mb-1.5 block">Analysis Mode</label>
                <Select value={mode} onValueChange={(val) => setMode(val as AnalysisMode)}>
                  <SelectTrigger data-testid="mode-select">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="full">
                      <div className="flex items-center gap-2">
                        <Table className="h-4 w-4" />
                        Full Analysis
                      </div>
                    </SelectItem>
                    <SelectItem value="text_only">
                      <div className="flex items-center gap-2">
                        <FileText className="h-4 w-4" />
                        Text Only
                      </div>
                    </SelectItem>
                    <SelectItem value="numbers_only">
                      <div className="flex items-center gap-2">
                        <BarChart3 className="h-4 w-4" />
                        Numbers Only
                      </div>
                    </SelectItem>
                  </SelectContent>
                </Select>
              </div>
            )}
          </div>

          <div>
            <label className="text-sm font-medium mb-1.5 block">
              Custom Prompt <span className="text-muted-foreground">(optional)</span>
            </label>
            <Textarea
              placeholder="E.g., 'Find the top 5 products by revenue' or 'Calculate monthly growth rates'"
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              className="min-h-[80px] resize-none"
              data-testid="prompt-input"
            />
          </div>

          <Button
            onClick={handleAnalyze}
            disabled={analyzeMutation.isPending || (scope === 'selected' && selectedSheets.length === 0)}
            className="w-full"
            data-testid="analyze-button"
          >
            {analyzeMutation.isPending ? (
              <>
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                Analyzing...
              </>
            ) : (
              <>
                <Play className="h-4 w-4 mr-2" />
                {scope === 'active' ? 'Analyze Sheet' : `Analyze ${scopeLabel}`}
              </>
            )}
          </Button>
        </div>

        {isPolling && isMultiSheetAnalysis && multiSheetProgress && (
          <div className="p-3 bg-muted/50 rounded-lg space-y-2" data-testid="multi-sheet-progress">
            <div className="flex items-center justify-between text-sm">
              <span className="font-medium">
                Analyzing sheet {multiSheetProgress.completed + 1} of {multiSheetProgress.total}
              </span>
              <span className="text-muted-foreground">{multiSheetProgress.percentage}%</span>
            </div>
            <Progress value={multiSheetProgress.percentage} className="h-2" />
            {multiSheetProgress.currentSheet && (
              <p className="text-xs text-muted-foreground">
                Currently processing: {multiSheetProgress.currentSheet}
              </p>
            )}
          </div>
        )}

        {analyzeMutation.isError && (
          <div className="flex items-center gap-2 p-3 bg-destructive/10 text-destructive rounded-lg">
            <AlertCircle className="h-4 w-4 flex-shrink-0" />
            <p className="text-sm">{(analyzeMutation.error as Error).message}</p>
          </div>
        )}

        {analysisSession?.generatedCode && (
          <Collapsible open={codeExpanded} onOpenChange={setCodeExpanded}>
            <CollapsibleTrigger asChild>
              <Button
                variant="outline"
                className="w-full justify-between"
                data-testid="code-toggle"
              >
                <div className="flex items-center gap-2">
                  <Code className="h-4 w-4" />
                  Generated Code
                </div>
                {codeExpanded ? (
                  <ChevronDown className="h-4 w-4" />
                ) : (
                  <ChevronRight className="h-4 w-4" />
                )}
              </Button>
            </CollapsibleTrigger>
            <CollapsibleContent className="mt-2">
              <div className="relative">
                <pre className="p-3 bg-muted rounded-lg text-xs overflow-x-auto max-h-[200px]">
                  <code>{analysisSession.generatedCode}</code>
                </pre>
                <Button
                  variant="ghost"
                  size="icon"
                  className="absolute top-2 right-2 h-7 w-7"
                  onClick={handleCopyCode}
                  data-testid="copy-code-button"
                >
                  {codeCopied ? (
                    <Check className="h-3.5 w-3.5 text-green-500" />
                  ) : (
                    <Copy className="h-3.5 w-3.5" />
                  )}
                </Button>
              </div>
            </CollapsibleContent>
          </Collapsible>
        )}

        {analysisSession?.multiSheet && (
          <div className="flex-1 overflow-auto">
            <Tabs value={activeResultTab} onValueChange={setActiveResultTab} className="h-full flex flex-col">
              <TabsList className="w-full justify-start overflow-x-auto flex-shrink-0" data-testid="result-tabs">
                <TabsTrigger value="summary" data-testid="result-tab-summary">
                  Summary
                </TabsTrigger>
                {analysisSession.multiSheet.jobs.map((job) => (
                  <TabsTrigger 
                    key={job.sheetName} 
                    value={job.sheetName}
                    data-testid={`result-tab-${job.sheetName}`}
                  >
                    <span className="flex items-center gap-1.5">
                      {job.sheetName}
                      {job.status === 'done' && <Check className="h-3 w-3 text-green-500" />}
                      {job.status === 'failed' && <AlertCircle className="h-3 w-3 text-red-500" />}
                      {job.status === 'running' && <Loader2 className="h-3 w-3 animate-spin" />}
                    </span>
                  </TabsTrigger>
                ))}
              </TabsList>

              <TabsContent value="summary" className="flex-1 overflow-auto mt-4">
                {analysisSession.multiSheet.crossSheetSummary ? (
                  <div className="p-3 bg-muted/50 rounded-lg">
                    <h4 className="text-sm font-medium mb-2">Cross-Sheet Summary</h4>
                    <p className="text-sm text-muted-foreground whitespace-pre-wrap">
                      {analysisSession.multiSheet.crossSheetSummary}
                    </p>
                  </div>
                ) : (
                  <div className="text-center p-4 text-muted-foreground">
                    <p className="text-sm">Cross-sheet summary will appear here when analysis completes.</p>
                  </div>
                )}

                <div className="mt-4 space-y-2">
                  <h4 className="text-sm font-medium">Sheet Status</h4>
                  {analysisSession.multiSheet.jobs.map((job) => (
                    <div 
                      key={job.sheetName}
                      className="flex items-center justify-between p-2 bg-muted/30 rounded-lg"
                    >
                      <span className="text-sm">{job.sheetName}</span>
                      <Badge 
                        variant={
                          job.status === 'done' ? 'success' :
                          job.status === 'failed' ? 'destructive' :
                          job.status === 'running' ? 'warning' :
                          'secondary'
                        }
                      >
                        {job.status}
                      </Badge>
                    </div>
                  ))}
                </div>
              </TabsContent>

              {analysisSession.multiSheet.jobs.map((job) => (
                <TabsContent key={job.sheetName} value={job.sheetName} className="flex-1 overflow-auto mt-4">
                  {job.status === 'failed' && job.error && (
                    <div className="flex items-center gap-2 p-3 bg-destructive/10 text-destructive rounded-lg mb-4">
                      <AlertCircle className="h-4 w-4 flex-shrink-0" />
                      <p className="text-sm">{job.error}</p>
                    </div>
                  )}
                  {job.result ? renderSheetResult(job.result) : (
                    <div className="text-center p-4 text-muted-foreground">
                      {job.status === 'queued' && <p className="text-sm">Waiting to analyze...</p>}
                      {job.status === 'running' && (
                        <div className="flex flex-col items-center gap-2">
                          <Loader2 className="h-8 w-8 animate-spin" />
                          <p className="text-sm">Analyzing {job.sheetName}...</p>
                        </div>
                      )}
                    </div>
                  )}
                </TabsContent>
              ))}
            </Tabs>
          </div>
        )}

        {analysisSession?.results && !analysisSession?.multiSheet && (
          <div className="flex-1 overflow-auto">
            {renderSheetResult(analysisSession.results)}
          </div>
        )}

        {!analysisSession?.results && !analysisSession?.multiSheet && currentStatus === 'idle' && (
          <div className="flex-1 flex items-center justify-center text-center p-4">
            <div className="text-muted-foreground">
              <Sparkles className="h-12 w-12 mx-auto mb-3 opacity-50" />
              <p className="text-sm">
                Configure your analysis options and click "Analyze" to get insights.
              </p>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
