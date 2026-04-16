import React, { useMemo, useState, useCallback, useRef, useEffect } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  useReactTable,
  getCoreRowModel,
  flexRender,
  ColumnDef,
} from '@tanstack/react-table';
import { useVirtualizer } from '@tanstack/react-virtual';
import { Download, Maximize2, Loader2, AlertCircle, ChevronDown, Sparkles, Code } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { cn } from '@/lib/utils';

interface SheetInfo {
  name: string;
  rowCount: number;
  columnCount: number;
}

interface ChatSpreadsheetViewerProps {
  uploadId: string;
  filename: string;
  sheets: SheetInfo[];
  initialSheet?: string;
  previewData?: { headers: string[]; data: any[][] };
  onAnalyze?: () => void;
  onDownload?: () => void;
  onExpand?: () => void;
}

interface SheetDataResponse {
  rows: Record<string, any>[];
  columns: { name: string; type: string }[];
  totalRows: number;
}

interface CachedSheetData {
  [sheetName: string]: SheetDataResponse;
}

export function ChatSpreadsheetViewer({
  uploadId,
  filename,
  sheets = [],
  initialSheet,
  previewData,
  onDownload,
  onExpand,
}: ChatSpreadsheetViewerProps) {
  const validSheets = Array.isArray(sheets) ? sheets.filter(s => s && s.name) : [];
  
  const [activeSheet, setActiveSheet] = useState<string>(
    initialSheet || validSheets[0]?.name || ''
  );
  const [cachedData, setCachedData] = useState<CachedSheetData>({});
  const tableContainerRef = useRef<HTMLDivElement>(null);

  const [analysisState, setAnalysisState] = useState<'idle' | 'analyzing' | 'complete' | 'error'>('idle');
  const [analysisSessionId, setAnalysisSessionId] = useState<string | null>(null);
  const [analysisResult, setAnalysisResult] = useState<{
    generatedCode?: string;
    summary?: string;
    metrics?: Array<{ label: string; value: string }>;
    tables?: Array<{ title: string; headers: string[]; rows: any[][] }>;
    error?: string;
  } | null>(null);
  const [showCode, setShowCode] = useState(false);

  const { data, isLoading, error } = useQuery<SheetDataResponse>({
    queryKey: ['chatSheetData', uploadId, activeSheet],
    queryFn: async () => {
      if (cachedData[activeSheet]) {
        return cachedData[activeSheet];
      }
      const res = await fetch(
        `/api/spreadsheet/${uploadId}/sheet/${encodeURIComponent(activeSheet)}/data`
      );
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.message || 'Failed to fetch sheet data');
      }
      return res.json();
    },
    staleTime: 300000,
    enabled: !!activeSheet && !!uploadId,
  });

  useEffect(() => {
    if (data && activeSheet && !cachedData[activeSheet]) {
      setCachedData(prev => ({ ...prev, [activeSheet]: data }));
    }
  }, [data, activeSheet, cachedData]);

  const displayData = useMemo(() => {
    if (cachedData[activeSheet]) return cachedData[activeSheet];
    if (data) return data;
    if (previewData && activeSheet === (initialSheet || validSheets[0]?.name)) {
      return {
        rows: previewData.data.map((row, idx) => {
          const rowObj: Record<string, any> = { __rowNum: idx + 1 };
          previewData.headers.forEach((header, colIdx) => {
            rowObj[header] = row[colIdx];
          });
          return rowObj;
        }),
        columns: previewData.headers.map(h => ({ name: h, type: 'text' })),
        totalRows: previewData.data.length,
      };
    }
    return null;
  }, [cachedData, activeSheet, data, previewData, initialSheet, validSheets]);

  const columns = useMemo<ColumnDef<Record<string, any>>[]>(() => {
    if (!displayData?.columns) return [];

    const rowNumColumn: ColumnDef<Record<string, any>> = {
      id: '__rowNum',
      header: () => <span className="text-gray-400 text-xs">#</span>,
      cell: ({ row }) => (
        <span className="text-gray-400 text-xs font-mono">
          {row.index + 1}
        </span>
      ),
      size: 36,
    };

    const dataColumns = displayData.columns.map((col) => ({
      id: col.name,
      accessorKey: col.name,
      header: () => (
        <span className="text-xs font-medium text-gray-700 truncate block" title={col.name}>{col.name}</span>
      ),
      cell: ({ getValue }: { getValue: () => any }) => {
        const value = getValue();
        if (value === null || value === undefined || value === '') {
          return <span className="text-gray-300 text-xs">—</span>;
        }
        const strValue = String(value);
        return (
          <span 
            className="text-xs text-gray-600 block line-clamp-2" 
            title={strValue.length > 40 ? strValue : undefined}
          >
            {strValue}
          </span>
        );
      },
    }));

    return [rowNumColumn, ...dataColumns];
  }, [displayData?.columns]);

  const tableData = useMemo(() => {
    return displayData?.rows || [];
  }, [displayData?.rows]);

  const table = useReactTable({
    data: tableData,
    columns,
    getCoreRowModel: getCoreRowModel(),
  });

  const { rows } = table.getRowModel();

  const rowVirtualizer = useVirtualizer({
    count: rows.length,
    getScrollElement: () => tableContainerRef.current,
    estimateSize: () => 38,
    overscan: 10,
  });

  const virtualRows = rowVirtualizer.getVirtualItems();
  const totalSize = rowVirtualizer.getTotalSize();

  const paddingTop = virtualRows.length > 0 ? virtualRows[0]?.start ?? 0 : 0;
  const paddingBottom =
    virtualRows.length > 0
      ? totalSize - (virtualRows[virtualRows.length - 1]?.end ?? 0)
      : 0;

  const handleSheetChange = useCallback((sheetName: string) => {
    setActiveSheet(sheetName);
  }, []);

  const handleAnalyze = async () => {
    if (!uploadId || !activeSheet) return;
    setAnalysisState('analyzing');
    setAnalysisResult(null);
    
    try {
      const startRes = await fetch('/api/spreadsheet/analyze/start', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          uploadId,
          sheetName: activeSheet,
          analysisMode: 'full',
        }),
      });
      if (!startRes.ok) throw new Error('Failed to start analysis');
      const { sessionId } = await startRes.json();
      setAnalysisSessionId(sessionId);
      
      const pollResult = async () => {
        const statusRes = await fetch(`/api/spreadsheet/analyze/status/${sessionId}`);
        const status = await statusRes.json();
        
        if (status.status === 'complete') {
          setAnalysisResult({
            generatedCode: status.generatedCode,
            summary: status.outputs?.summary,
            metrics: status.outputs?.metrics,
            tables: status.outputs?.tables,
          });
          setAnalysisState('complete');
        } else if (status.status === 'error') {
          setAnalysisResult({ error: status.error });
          setAnalysisState('error');
        } else {
          setTimeout(pollResult, 1500);
        }
      };
      pollResult();
    } catch (err: any) {
      setAnalysisResult({ error: err.message });
      setAnalysisState('error');
    }
  };

  const displayFilename = useMemo(() => {
    const maxLen = 40;
    if (filename.length <= maxLen) return filename;
    const ext = filename.split('.').pop() || '';
    const name = filename.slice(0, filename.length - ext.length - 1);
    const truncatedName = name.slice(0, maxLen - ext.length - 4) + '...';
    return `${truncatedName}.${ext}`;
  }, [filename]);

  return (
    <div 
      className="w-full max-w-2xl overflow-hidden rounded-lg border border-gray-200 bg-white shadow-sm" 
      data-testid="chat-spreadsheet-viewer"
    >
      <div className="flex items-center justify-between px-3 py-2 border-b border-gray-100 bg-gray-50/50">
        <div className="flex items-center gap-1.5 min-w-0 flex-1">
          <span 
            className="text-xs font-medium text-gray-700 truncate max-w-[180px] sm:max-w-[280px]" 
            title={filename}
            data-testid="spreadsheet-filename"
          >
            {displayFilename}
          </span>
        </div>

        <div className="flex items-center gap-1">
          {validSheets.length > 1 ? (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <button 
                  className="flex items-center gap-1 px-2 py-1 text-xs text-gray-600 hover:bg-gray-100 rounded transition-colors"
                  data-testid="sheet-selector"
                >
                  <span className="truncate max-w-[80px] sm:max-w-[120px]">{activeSheet}</span>
                  <ChevronDown className="h-3 w-3 text-gray-400 shrink-0" />
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="min-w-[100px] max-w-[200px]">
                {validSheets.map((sheet) => (
                  <DropdownMenuItem 
                    key={`dropdown-sheet-${sheet.name}`}
                    onClick={() => handleSheetChange(sheet.name)}
                    className={cn(
                      "text-xs cursor-pointer truncate",
                      activeSheet === sheet.name && "bg-gray-100"
                    )}
                    data-testid={`sheet-option-${sheet.name}`}
                  >
                    {sheet.name}
                  </DropdownMenuItem>
                ))}
              </DropdownMenuContent>
            </DropdownMenu>
          ) : validSheets.length === 1 ? (
            <span className="text-xs text-gray-500 px-1 truncate max-w-[100px]">
              {validSheets[0].name}
            </span>
          ) : null}

          {onDownload && (
            <button
              className="p-1.5 text-gray-400 hover:text-gray-600 hover:bg-gray-100 rounded transition-colors"
              onClick={onDownload}
              title="Download"
              data-testid="download-button"
            >
              <Download className="h-3.5 w-3.5" />
            </button>
          )}

          {onExpand && (
            <button
              className="p-1.5 text-gray-400 hover:text-gray-600 hover:bg-gray-100 rounded transition-colors"
              onClick={onExpand}
              title="Expand"
              data-testid="expand-button"
            >
              <Maximize2 className="h-3.5 w-3.5" />
            </button>
          )}
        </div>
      </div>

      <div
        ref={tableContainerRef}
        className="max-h-[320px] sm:max-h-[420px] overflow-auto bg-white"
        data-testid="spreadsheet-table-container"
      >
        {isLoading && !displayData && (
          <div className="flex items-center justify-center h-[200px]">
            <div className="flex flex-col items-center gap-2">
              <Loader2 className="h-5 w-5 animate-spin text-gray-500" />
              <span className="text-sm text-gray-500">Loading...</span>
            </div>
          </div>
        )}

        {error && !displayData && (
          <div className="flex items-center justify-center h-[200px]">
            <div className="flex flex-col items-center gap-2 text-red-500">
              <AlertCircle className="h-5 w-5" />
              <span className="text-sm">{(error as Error).message}</span>
            </div>
          </div>
        )}

        {displayData && (
          <table className="w-full text-xs border-collapse">
            <thead className="sticky top-0 bg-gray-50 z-10">
              {table.getHeaderGroups().map((headerGroup) => (
                <tr key={headerGroup.id}>
                  {headerGroup.headers.map((header, idx) => (
                    <th
                      key={header.id}
                      className={cn(
                        "text-left px-2 py-1.5 border-b border-gray-200 font-medium whitespace-nowrap",
                        idx === 0 && "w-9 text-center bg-gray-100 border-r border-gray-100",
                        idx > 0 && "bg-gray-50"
                      )}
                      style={header.column.getSize() ? { width: header.column.getSize() } : undefined}
                    >
                      {header.isPlaceholder
                        ? null
                        : flexRender(
                            header.column.columnDef.header,
                            header.getContext()
                          )}
                    </th>
                  ))}
                </tr>
              ))}
            </thead>
            <tbody>
              {paddingTop > 0 && (
                <tr>
                  <td style={{ height: `${paddingTop}px` }} colSpan={columns.length} />
                </tr>
              )}
              {virtualRows.map((virtualRow) => {
                const row = rows[virtualRow.index];
                return (
                  <tr
                    key={row.id}
                    data-index={virtualRow.index}
                    className="hover:bg-gray-50/50 transition-colors"
                  >
                    {row.getVisibleCells().map((cell, idx) => (
                      <td 
                        key={cell.id} 
                        className={cn(
                          "px-2 py-1 border-b border-gray-100 bg-white align-top",
                          idx === 0 && "text-center bg-gray-50/50 border-r border-gray-100"
                        )}
                      >
                        {flexRender(cell.column.columnDef.cell, cell.getContext())}
                      </td>
                    ))}
                  </tr>
                );
              })}
              {paddingBottom > 0 && (
                <tr>
                  <td style={{ height: `${paddingBottom}px` }} colSpan={columns.length} />
                </tr>
              )}
            </tbody>
          </table>
        )}

        {displayData && displayData.rows.length === 0 && (
          <div className="flex items-center justify-center h-[100px] text-gray-500 text-sm">
            No data in this sheet
          </div>
        )}
      </div>

      {displayData && displayData.totalRows > 0 && (
        <div className="px-3 py-1.5 border-t border-gray-100 bg-gray-50/50 text-xs text-gray-500">
          {displayData.totalRows.toLocaleString()} rows × {displayData.columns?.length || 0} columns
        </div>
      )}

      <div className="border-t border-gray-100">
        {analysisState === 'idle' && (
          <div className="px-3 py-2">
            <Button
              variant="outline"
              size="sm"
              className="w-full h-7 text-xs border-gray-200 hover:bg-gray-50"
              onClick={handleAnalyze}
              data-testid="analyze-button"
            >
              <Sparkles className="h-3 w-3 mr-1.5" />
              Analyze with AI
            </Button>
          </div>
        )}

        {analysisState === 'analyzing' && (
          <div className="px-3 py-2.5 flex items-center justify-center gap-1.5">
            <Loader2 className="h-3 w-3 animate-spin" />
            <span className="text-xs text-gray-500">Analyzing...</span>
          </div>
        )}

        {analysisState === 'complete' && analysisResult && (
          <div className="p-4 space-y-3">
            <Collapsible open={showCode} onOpenChange={setShowCode}>
              <CollapsibleTrigger asChild>
                <Button variant="ghost" size="sm" className="w-full justify-between hover:bg-gray-50">
                  <span className="flex items-center gap-2">
                    <Code className="h-4 w-4" />
                    Generated Code
                  </span>
                  <ChevronDown className={cn("h-4 w-4 transition-transform", showCode && "rotate-180")} />
                </Button>
              </CollapsibleTrigger>
              <CollapsibleContent>
                <pre className="mt-2 p-3 bg-gray-100 rounded-lg text-sm overflow-x-auto max-h-[200px]">
                  <code>{analysisResult.generatedCode}</code>
                </pre>
              </CollapsibleContent>
            </Collapsible>

            {analysisResult.summary && (
              <p className="text-sm text-gray-700">{analysisResult.summary}</p>
            )}

            {analysisResult.metrics && analysisResult.metrics.length > 0 && (
              <div className="grid grid-cols-2 gap-2">
                {analysisResult.metrics.map((m, i) => (
                  <div key={i} className="bg-gray-50 rounded-lg p-3 border border-gray-200">
                    <div className="text-sm text-gray-500">{m.label}</div>
                    <div className="text-sm font-medium text-gray-900">{m.value}</div>
                  </div>
                ))}
              </div>
            )}

            {analysisResult.tables?.map((t, i) => (
              <div key={i} className="rounded-lg border border-gray-200 overflow-hidden">
                <div className="px-3 py-2 bg-gray-50 text-sm font-medium text-gray-700 border-b border-gray-200">{t.title}</div>
                <table className="w-full text-sm">
                  <thead>
                    <tr className="bg-gray-50">
                      {t.headers.map((h, j) => (
                        <th key={j} className="px-3 py-2 text-left border-b border-gray-200 font-medium">{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {t.rows.slice(0, 10).map((row, ri) => (
                      <tr key={ri} className="hover:bg-gray-50">
                        {row.map((cell, ci) => (
                          <td key={ci} className="px-3 py-2 border-b border-gray-200">{cell}</td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ))}
          </div>
        )}

        {analysisState === 'error' && analysisResult?.error && (
          <div className="px-4 py-3 text-red-500 text-sm flex items-center gap-2">
            <AlertCircle className="h-4 w-4" />
            {analysisResult.error}
          </div>
        )}
      </div>
    </div>
  );
}
