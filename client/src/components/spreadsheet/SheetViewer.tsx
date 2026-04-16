import React, { useMemo, useState, useCallback, useRef } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  useReactTable,
  getCoreRowModel,
  flexRender,
  ColumnDef,
} from '@tanstack/react-table';
import { useVirtualizer } from '@tanstack/react-virtual';
import {
  Type,
  Hash,
  Calendar,
  Loader2,
  AlertCircle,
  Filter,
  X,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';

interface ColumnInfo {
  name: string;
  type: 'text' | 'number' | 'date' | 'unknown';
  sampleValues?: any[];
}

interface SheetDataResponse {
  rows: Record<string, any>[];
  columns: ColumnInfo[];
  totalRows: number;
}

interface SheetViewerProps {
  uploadId: string;
  sheetName: string;
}

const getColumnIcon = (type: string) => {
  switch (type) {
    case 'number':
      return <Hash className="h-3 w-3" />;
    case 'date':
      return <Calendar className="h-3 w-3" />;
    case 'text':
    default:
      return <Type className="h-3 w-3" />;
  }
};

export function SheetViewer({ uploadId, sheetName }: SheetViewerProps) {
  const [columnFilters, setColumnFilters] = useState<Record<string, string>>({});
  const tableContainerRef = useRef<HTMLDivElement>(null);

  const { data, isLoading, error } = useQuery<SheetDataResponse>({
    queryKey: ['sheetData', uploadId, sheetName],
    queryFn: async () => {
      const res = await fetch(
        `/api/spreadsheet/${uploadId}/sheet/${encodeURIComponent(sheetName)}/data`
      );
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.message || 'Failed to fetch sheet data');
      }
      return res.json();
    },
    staleTime: 60000,
  });

  const columns = useMemo<ColumnDef<Record<string, any>>[]>(() => {
    if (!data?.columns) return [];

    return data.columns.map((col) => ({
      id: col.name,
      accessorKey: col.name,
      header: () => (
        <div className="flex items-center gap-1.5">
          <span className="text-muted-foreground">{getColumnIcon(col.type)}</span>
          <span className="truncate">{col.name}</span>
          <Badge variant="outline" className="text-[10px] px-1 py-0">
            {col.type}
          </Badge>
        </div>
      ),
      cell: ({ getValue }) => {
        const value = getValue();
        if (value === null || value === undefined) {
          return <span className="text-muted-foreground italic">null</span>;
        }
        return <span className="truncate block max-w-[200px]">{String(value)}</span>;
      },
    }));
  }, [data?.columns]);

  const filteredData = useMemo(() => {
    if (!data?.rows) return [];
    
    return data.rows.filter((row) => {
      return Object.entries(columnFilters).every(([colName, filterValue]) => {
        if (!filterValue) return true;
        const cellValue = row[colName];
        return String(cellValue ?? '').toLowerCase().includes(filterValue.toLowerCase());
      });
    });
  }, [data?.rows, columnFilters]);

  const table = useReactTable({
    data: filteredData,
    columns,
    getCoreRowModel: getCoreRowModel(),
  });

  const { rows } = table.getRowModel();

  const rowVirtualizer = useVirtualizer({
    count: rows.length,
    getScrollElement: () => tableContainerRef.current,
    estimateSize: () => 40,
    overscan: 15,
  });

  const virtualRows = rowVirtualizer.getVirtualItems();
  const totalSize = rowVirtualizer.getTotalSize();

  const paddingTop = virtualRows.length > 0 ? virtualRows[0]?.start ?? 0 : 0;
  const paddingBottom =
    virtualRows.length > 0
      ? totalSize - (virtualRows[virtualRows.length - 1]?.end ?? 0)
      : 0;

  const handleFilterChange = useCallback((columnName: string, value: string) => {
    setColumnFilters((prev) => ({
      ...prev,
      [columnName]: value,
    }));
  }, []);

  const clearAllFilters = useCallback(() => {
    setColumnFilters({});
  }, []);

  const hasActiveFilters = Object.values(columnFilters).some((v) => v);

  if (isLoading) {
    return (
      <Card className="h-full flex items-center justify-center">
        <div className="flex flex-col items-center gap-3">
          <Loader2 className="h-8 w-8 animate-spin text-primary" />
          <p className="text-sm text-muted-foreground">Loading sheet data...</p>
        </div>
      </Card>
    );
  }

  if (error) {
    return (
      <Card className="h-full flex items-center justify-center">
        <div className="flex flex-col items-center gap-3 text-destructive">
          <AlertCircle className="h-8 w-8" />
          <p className="text-sm">{(error as Error).message}</p>
        </div>
      </Card>
    );
  }

  return (
    <Card className="h-full flex flex-col">
      <CardHeader className="pb-3 flex-shrink-0">
        <div className="flex items-center justify-between">
          <CardTitle className="text-lg">{sheetName}</CardTitle>
          <Badge variant="secondary">
            {filteredData.length === data?.totalRows 
              ? `${data?.totalRows?.toLocaleString() ?? 0} rows`
              : `${filteredData.length} of ${data?.totalRows?.toLocaleString() ?? 0} rows`
            }
          </Badge>
        </div>
      </CardHeader>

      <CardContent className="flex-1 flex flex-col gap-3 min-h-0 pt-0">
        {data?.columns && data.columns.length > 0 && (
          <div className="flex items-center gap-2 flex-wrap">
            <Filter className="h-4 w-4 text-muted-foreground" />
            {data.columns.slice(0, 5).map((col) => (
              <Input
                key={col.name}
                placeholder={`Filter ${col.name}`}
                value={columnFilters[col.name] || ''}
                onChange={(e) => handleFilterChange(col.name, e.target.value)}
                className="h-8 w-32 text-xs"
                data-testid={`filter-${col.name}`}
              />
            ))}
            {hasActiveFilters && (
              <Button
                variant="ghost"
                size="sm"
                onClick={clearAllFilters}
                className="h-8 text-xs"
                data-testid="clear-filters-button"
              >
                <X className="h-3 w-3 mr-1" />
                Clear
              </Button>
            )}
          </div>
        )}

        <div
          ref={tableContainerRef}
          className="flex-1 overflow-auto border rounded-lg scroll-smooth"
          data-testid="sheet-table-container"
        >
          <table className="w-full text-sm">
            <thead className="sticky top-0 bg-muted/80 backdrop-blur-sm z-10">
              {table.getHeaderGroups().map((headerGroup) => (
                <tr key={headerGroup.id}>
                  {headerGroup.headers.map((header) => (
                    <th
                      key={header.id}
                      className="text-left p-2 border-b font-medium whitespace-nowrap"
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
                    className="hover:bg-muted/50 transition-colors"
                  >
                    {row.getVisibleCells().map((cell) => (
                      <td key={cell.id} className="p-2 border-b">
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
        </div>
      </CardContent>
    </Card>
  );
}
