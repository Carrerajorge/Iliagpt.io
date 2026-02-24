import { useState, useMemo, useRef, useCallback, useEffect } from 'react';
import {
  useReactTable,
  getCoreRowModel,
  getSortedRowModel,
  getFilteredRowModel,
  getPaginationRowModel,
  flexRender,
  createColumnHelper,
  SortingState,
  ColumnFiltersState,
  RowSelectionState,
  Row,
} from '@tanstack/react-table';
import { useVirtualizer } from '@tanstack/react-virtual';
import { TableConfig, ColumnDef as ColumnDefConfig, ColumnType } from '@shared/schemas/visualization';
import { cn } from '@/lib/utils';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  ChevronUp,
  ChevronDown,
  ChevronsUpDown,
  ChevronLeft,
  ChevronRight,
  ChevronsLeft,
  ChevronsRight,
  Search,
  X,
  Copy,
  Download,
  Check,
  Maximize2,
  Minimize2,
} from 'lucide-react';
import { autoSaveToMediaLibrary } from '@/lib/mediaAutoSave';
import { usePlatformSettings } from '@/contexts/PlatformSettingsContext';
import { formatZonedDate, normalizeTimeZone, type PlatformDateFormat } from '@/lib/platformDateTime';

export interface SmartTableProps {
  config: TableConfig;
  className?: string;
  onRowClick?: (row: any) => void;
}

function formatCellValue(
  value: any,
  type: ColumnType,
  format: string | undefined,
  opts?: { timeZone: string; dateFormat: PlatformDateFormat }
): string {
  if (value === null || value === undefined) return '-';
  
  switch (type) {
    case 'number':
      return typeof value === 'number' ? value.toLocaleString() : String(value);
    case 'currency':
      return typeof value === 'number' 
        ? new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(value)
        : String(value);
    case 'date':
      try {
        return formatZonedDate(value, {
          timeZone: opts?.timeZone || "UTC",
          dateFormat: opts?.dateFormat || "YYYY-MM-DD",
        });
      } catch {
        return String(value);
      }
    case 'boolean':
      return value ? 'Yes' : 'No';
    default:
      return String(value);
  }
}

interface ColumnFilterProps {
  column: any;
  columnDef: ColumnDefConfig;
}

function ColumnFilter({ column, columnDef }: ColumnFilterProps) {
  const filterValue = column.getFilterValue();

  switch (columnDef.type) {
    case 'number':
    case 'currency':
      return (
        <div className="flex gap-1" data-testid={`filter-number-${columnDef.id}`}>
          <Input
            type="number"
            placeholder="Min"
            value={(filterValue as [number, number])?.[0] ?? ''}
            onChange={(e) => {
              const val = e.target.value ? Number(e.target.value) : undefined;
              column.setFilterValue((old: [number, number]) => [val, old?.[1]]);
            }}
            className="h-7 w-16 text-xs"
            data-testid={`filter-min-${columnDef.id}`}
          />
          <Input
            type="number"
            placeholder="Max"
            value={(filterValue as [number, number])?.[1] ?? ''}
            onChange={(e) => {
              const val = e.target.value ? Number(e.target.value) : undefined;
              column.setFilterValue((old: [number, number]) => [old?.[0], val]);
            }}
            className="h-7 w-16 text-xs"
            data-testid={`filter-max-${columnDef.id}`}
          />
        </div>
      );

    case 'date':
      return (
        <div className="flex gap-1" data-testid={`filter-date-${columnDef.id}`}>
          <Input
            type="date"
            value={(filterValue as [string, string])?.[0] ?? ''}
            onChange={(e) => {
              column.setFilterValue((old: [string, string]) => [e.target.value || undefined, old?.[1]]);
            }}
            className="h-7 w-28 text-xs"
            data-testid={`filter-date-from-${columnDef.id}`}
          />
          <Input
            type="date"
            value={(filterValue as [string, string])?.[1] ?? ''}
            onChange={(e) => {
              column.setFilterValue((old: [string, string]) => [old?.[0], e.target.value || undefined]);
            }}
            className="h-7 w-28 text-xs"
            data-testid={`filter-date-to-${columnDef.id}`}
          />
        </div>
      );

    case 'select':
      return (
        <Select
          value={filterValue as string ?? ''}
          onValueChange={(value) => column.setFilterValue(value || undefined)}
        >
          <SelectTrigger className="h-7 w-32 text-xs" data-testid={`filter-select-${columnDef.id}`}>
            <SelectValue placeholder="All" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="">All</SelectItem>
            {columnDef.filterOptions?.map((option) => (
              <SelectItem key={option} value={option}>
                {option}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      );

    case 'boolean':
      return (
        <Select
          value={filterValue as string ?? ''}
          onValueChange={(value) => column.setFilterValue(value === '' ? undefined : value === 'true')}
        >
          <SelectTrigger className="h-7 w-24 text-xs" data-testid={`filter-boolean-${columnDef.id}`}>
            <SelectValue placeholder="All" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="">All</SelectItem>
            <SelectItem value="true">Yes</SelectItem>
            <SelectItem value="false">No</SelectItem>
          </SelectContent>
        </Select>
      );

    default:
      return (
        <Input
          type="text"
          placeholder="Filter..."
          value={(filterValue ?? '') as string}
          onChange={(e) => column.setFilterValue(e.target.value || undefined)}
          className="h-7 w-32 text-xs"
          data-testid={`filter-text-${columnDef.id}`}
        />
      );
  }
}

function numberRangeFilter(row: Row<any>, columnId: string, filterValue: [number, number]) {
  const value = row.getValue(columnId) as number;
  const [min, max] = filterValue;
  if (min !== undefined && value < min) return false;
  if (max !== undefined && value > max) return false;
  return true;
}

function dateRangeFilter(row: Row<any>, columnId: string, filterValue: [string, string]) {
  const value = new Date(row.getValue(columnId) as string).getTime();
  const [from, to] = filterValue;
  if (from && value < new Date(from).getTime()) return false;
  if (to && value > new Date(to).getTime()) return false;
  return true;
}

export function SmartTable({ config, className, onRowClick }: SmartTableProps) {
  const { settings: platformSettings } = usePlatformSettings();
  const platformTimeZone = normalizeTimeZone(platformSettings.timezone_default);
  const platformDateFormat = platformSettings.date_format;

  const {
    columns: configColumns,
    data,
    pageSize = 10,
    serverSide = false,
    totalRows,
    enableSorting = true,
    enableFiltering = true,
    enableGlobalSearch = true,
    enableRowSelection = false,
    enableVirtualization = false,
    onPageChange,
    onSortChange,
    onFilterChange,
    onSearchChange,
  } = config;

  const [sorting, setSorting] = useState<SortingState>([]);
  const [columnFilters, setColumnFilters] = useState<ColumnFiltersState>([]);
  const [globalFilter, setGlobalFilter] = useState('');
  const [rowSelection, setRowSelection] = useState<RowSelectionState>({});
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [copied, setCopied] = useState(false);
  const [isExpanded, setIsExpanded] = useState(false);

  const parentRef = useRef<HTMLDivElement>(null);
  const tableContainerRef = useRef<HTMLDivElement>(null);

  const handleCopyTable = useCallback(async () => {
    if (!tableContainerRef.current) return;
    const tableEl = tableContainerRef.current.querySelector('table');
    if (!tableEl) return;
    
    const rows = tableEl.querySelectorAll('tr');
    const text = Array.from(rows).map(row => {
      const cells = row.querySelectorAll('th, td');
      return Array.from(cells).map(cell => cell.textContent?.trim() || '').join('\t');
    }).join('\n');
    
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch (err) {
      console.error('Failed to copy table:', err);
    }
  }, []);

  const handleDownloadCSV = useCallback(() => {
    if (!tableContainerRef.current) return;
    const tableEl = tableContainerRef.current.querySelector('table');
    if (!tableEl) return;
    
    const rows = tableEl.querySelectorAll('tr');
    const csv = Array.from(rows).map(row => {
      const cells = row.querySelectorAll('th, td');
      return Array.from(cells).map(cell => {
        const text = cell.textContent?.trim() || '';
        return text.includes(',') ? `"${text}"` : text;
      }).join(',');
    }).join('\n');
    
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = 'tabla.csv';
    link.click();
    URL.revokeObjectURL(url);
    autoSaveToMediaLibrary(blob, 'tabla.csv', { source: 'smart-table' });
  }, []);

  useEffect(() => {
    const timer = setTimeout(() => {
      setDebouncedSearch(globalFilter);
      if (onSearchChange) {
        onSearchChange(globalFilter);
      }
    }, 300);
    return () => clearTimeout(timer);
  }, [globalFilter, onSearchChange]);

  useEffect(() => {
    if (onSortChange && sorting.length > 0) {
      onSortChange(sorting.map((s) => ({ id: s.id, desc: s.desc })));
    }
  }, [sorting, onSortChange]);

  useEffect(() => {
    if (onFilterChange && columnFilters.length > 0) {
      onFilterChange(columnFilters.map((f) => ({ id: f.id, value: f.value })));
    }
  }, [columnFilters, onFilterChange]);

  const columnHelper = createColumnHelper<Record<string, any>>();

  const columns = useMemo(() => {
    const cols: any[] = [];

    if (enableRowSelection) {
      cols.push(
        columnHelper.display({
          id: 'select',
          header: ({ table }) => (
            <Checkbox
              checked={table.getIsAllPageRowsSelected()}
              onCheckedChange={(value) => table.toggleAllPageRowsSelected(!!value)}
              aria-label="Select all"
              data-testid="select-all-checkbox"
            />
          ),
          cell: ({ row }) => (
            <Checkbox
              checked={row.getIsSelected()}
              onCheckedChange={(value) => row.toggleSelected(!!value)}
              aria-label="Select row"
              data-testid={`select-row-${row.index}`}
            />
          ),
          size: 40,
        })
      );
    }

	    configColumns.forEach((col) => {
	      cols.push(
	        columnHelper.accessor(col.accessorKey, {
	          id: col.id,
	          header: col.header,
	          cell: (info) =>
	            formatCellValue(info.getValue(), col.type, col.format, {
	              timeZone: platformTimeZone,
	              dateFormat: platformDateFormat,
	            }),
	          enableSorting: col.sortable !== false && enableSorting,
	          enableColumnFilter: col.filterable !== false && enableFiltering,
	          filterFn: col.type === 'number' || col.type === 'currency'
	            ? numberRangeFilter
            : col.type === 'date'
            ? dateRangeFilter
            : 'includesString',
          size: typeof col.width === 'number' ? col.width : undefined,
          meta: { columnDef: col },
        })
      );
    });

	    return cols;
	  }, [
	    configColumns,
	    enableRowSelection,
	    enableSorting,
	    enableFiltering,
	    columnHelper,
	    platformTimeZone,
	    platformDateFormat,
	  ]);

  const table = useReactTable({
    data,
    columns,
    state: {
      sorting,
      columnFilters,
      globalFilter: debouncedSearch,
      rowSelection,
    },
    enableRowSelection,
    onSortingChange: setSorting,
    onColumnFiltersChange: setColumnFilters,
    onRowSelectionChange: setRowSelection,
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: enableSorting ? getSortedRowModel() : undefined,
    getFilteredRowModel: enableFiltering || enableGlobalSearch ? getFilteredRowModel() : undefined,
    getPaginationRowModel: !enableVirtualization ? getPaginationRowModel() : undefined,
    manualPagination: serverSide,
    pageCount: serverSide && totalRows ? Math.ceil(totalRows / pageSize) : undefined,
    initialState: {
      pagination: {
        pageSize,
      },
    },
  });

  const { rows } = table.getRowModel();
  const shouldVirtualize = enableVirtualization && rows.length > 100;

  const virtualizer = useVirtualizer({
    count: shouldVirtualize ? rows.length : 0,
    getScrollElement: () => parentRef.current,
    estimateSize: () => 48,
    overscan: 10,
  });

  const handleRowClick = useCallback(
    (row: Row<Record<string, any>>) => {
      if (onRowClick) {
        onRowClick(row.original);
      }
    },
    [onRowClick]
  );

  const renderSortIcon = (column: any) => {
    if (!column.getCanSort()) return null;
    const sorted = column.getIsSorted();
    if (sorted === 'asc') return <ChevronUp className="h-4 w-4" />;
    if (sorted === 'desc') return <ChevronDown className="h-4 w-4" />;
    return <ChevronsUpDown className="h-4 w-4 opacity-50" />;
  };

  const virtualRows = virtualizer.getVirtualItems();
  const totalSize = virtualizer.getTotalSize();

  return (
    <div 
      ref={tableContainerRef}
      className={cn(
        'w-full space-y-4 relative group',
        className,
        isExpanded && 'fixed inset-4 z-50 bg-background rounded-lg border shadow-2xl overflow-auto p-4'
      )} 
      data-testid="smart-table"
    >
      <div className="absolute top-2 right-2 flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity z-20">
        <Button
          variant="ghost"
          size="sm"
          onClick={handleCopyTable}
          className="h-8 w-8 p-0 bg-muted/80 hover:bg-muted border border-border/50"
          title={copied ? "Copiado" : "Copiar tabla"}
          data-testid="button-copy-smart-table"
        >
          {copied ? (
            <Check className="h-4 w-4 text-green-500" />
          ) : (
            <Copy className="h-4 w-4" />
          )}
        </Button>
        <Button
          variant="ghost"
          size="sm"
          onClick={handleDownloadCSV}
          className="h-8 w-8 p-0 bg-muted/80 hover:bg-muted border border-border/50"
          title="Descargar CSV"
          data-testid="button-download-smart-table"
        >
          <Download className="h-4 w-4" />
        </Button>
        <Button
          variant="ghost"
          size="sm"
          onClick={() => setIsExpanded(!isExpanded)}
          className="h-8 w-8 p-0 bg-muted/80 hover:bg-muted border border-border/50"
          title={isExpanded ? "Minimizar" : "Expandir"}
          data-testid="button-expand-smart-table"
        >
          {isExpanded ? (
            <Minimize2 className="h-4 w-4" />
          ) : (
            <Maximize2 className="h-4 w-4" />
          )}
        </Button>
      </div>

      {enableGlobalSearch && (
        <div className="relative" data-testid="global-search">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            placeholder="Search all columns..."
            value={globalFilter}
            onChange={(e) => setGlobalFilter(e.target.value)}
            className="pl-9 pr-9"
            data-testid="global-search-input"
          />
          {globalFilter && (
            <Button
              variant="ghost"
              size="icon"
              className="absolute right-1 top-1/2 h-7 w-7 -translate-y-1/2"
              onClick={() => setGlobalFilter('')}
              data-testid="clear-search"
            >
              <X className="h-4 w-4" />
            </Button>
          )}
        </div>
      )}

      <div
        ref={parentRef}
        className={cn(
          'rounded-md border border-border overflow-auto',
          shouldVirtualize && 'max-h-[600px]'
        )}
        data-testid="table-container"
      >
        <table className="w-full border-collapse">
          <thead className="sticky top-0 z-10 bg-muted/80 backdrop-blur-sm">
            {table.getHeaderGroups().map((headerGroup) => (
              <tr key={headerGroup.id} className="border-b border-border">
                {headerGroup.headers.map((header) => {
                  const columnDef = (header.column.columnDef.meta as any)?.columnDef as ColumnDefConfig | undefined;
                  return (
                    <th
                      key={header.id}
                      className={cn(
                        'px-4 py-3 text-sm font-medium text-foreground',
                        columnDef?.align === 'center' && 'text-center',
                        columnDef?.align === 'right' && 'text-right',
                        !columnDef?.align && 'text-left'
                      )}
                      style={{ width: header.getSize() !== 150 ? header.getSize() : undefined }}
                    >
                      <div className="space-y-2">
                        <div
                          className={cn(
                            'flex items-center gap-1',
                            header.column.getCanSort() && 'cursor-pointer select-none',
                            columnDef?.align === 'center' && 'justify-center',
                            columnDef?.align === 'right' && 'justify-end'
                          )}
                          onClick={header.column.getToggleSortingHandler()}
                          data-testid={`header-${header.id}`}
                        >
                          {header.isPlaceholder
                            ? null
                            : flexRender(header.column.columnDef.header, header.getContext())}
                          {renderSortIcon(header.column)}
                        </div>
                        {enableFiltering && header.column.getCanFilter() && columnDef && (
                          <ColumnFilter column={header.column} columnDef={columnDef} />
                        )}
                      </div>
                    </th>
                  );
                })}
              </tr>
            ))}
          </thead>
          <tbody>
            {shouldVirtualize ? (
              <>
                {virtualRows.length > 0 && (
                  <tr>
                    <td style={{ height: `${virtualRows[0].start}px` }} />
                  </tr>
                )}
                {virtualRows.map((virtualRow) => {
                  const row = rows[virtualRow.index];
                  return (
                    <tr
                      key={row.id}
                      className={cn(
                        'border-b border-border transition-colors',
                        onRowClick && 'cursor-pointer hover:bg-muted/30',
                        row.getIsSelected() && 'bg-muted/50'
                      )}
                      onClick={() => handleRowClick(row)}
                      data-testid={`table-row-${virtualRow.index}`}
                      style={{ height: `${virtualRow.size}px` }}
                    >
                      {row.getVisibleCells().map((cell) => {
                        const columnDef = (cell.column.columnDef.meta as any)?.columnDef as ColumnDefConfig | undefined;
                        return (
                          <td
                            key={cell.id}
                            className={cn(
                              'px-4 py-3 text-sm text-foreground',
                              columnDef?.align === 'center' && 'text-center',
                              columnDef?.align === 'right' && 'text-right',
                              !columnDef?.align && 'text-left'
                            )}
                          >
                            {flexRender(cell.column.columnDef.cell, cell.getContext())}
                          </td>
                        );
                      })}
                    </tr>
                  );
                })}
                {virtualRows.length > 0 && (
                  <tr>
                    <td style={{ height: `${totalSize - (virtualRows[virtualRows.length - 1]?.end ?? 0)}px` }} />
                  </tr>
                )}
              </>
            ) : (
              table.getRowModel().rows.map((row, rowIndex) => (
                <tr
                  key={row.id}
                  className={cn(
                    'border-b border-border transition-colors',
                    onRowClick && 'cursor-pointer hover:bg-muted/30',
                    row.getIsSelected() && 'bg-muted/50'
                  )}
                  onClick={() => handleRowClick(row)}
                  data-testid={`table-row-${rowIndex}`}
                >
                  {row.getVisibleCells().map((cell) => {
                    const columnDef = (cell.column.columnDef.meta as any)?.columnDef as ColumnDefConfig | undefined;
                    return (
                      <td
                        key={cell.id}
                        className={cn(
                          'px-4 py-3 text-sm text-foreground',
                          columnDef?.align === 'center' && 'text-center',
                          columnDef?.align === 'right' && 'text-right',
                          !columnDef?.align && 'text-left'
                        )}
                      >
                        {flexRender(cell.column.columnDef.cell, cell.getContext())}
                      </td>
                    );
                  })}
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {!enableVirtualization && (
        <div className="flex items-center justify-between" data-testid="pagination">
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <span>
              Showing {table.getState().pagination.pageIndex * table.getState().pagination.pageSize + 1} to{' '}
              {Math.min(
                (table.getState().pagination.pageIndex + 1) * table.getState().pagination.pageSize,
                serverSide && totalRows ? totalRows : table.getFilteredRowModel().rows.length
              )}{' '}
              of {serverSide && totalRows ? totalRows : table.getFilteredRowModel().rows.length} results
            </span>
            {enableRowSelection && Object.keys(rowSelection).length > 0 && (
              <span className="text-primary">
                ({Object.keys(rowSelection).length} selected)
              </span>
            )}
          </div>

          <div className="flex items-center gap-2">
            <Select
              value={String(table.getState().pagination.pageSize)}
              onValueChange={(value) => {
                table.setPageSize(Number(value));
              }}
            >
              <SelectTrigger className="h-8 w-20" data-testid="page-size-select">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {[10, 20, 30, 50, 100].map((size) => (
                  <SelectItem key={size} value={String(size)}>
                    {size}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>

            <div className="flex items-center gap-1">
              <Button
                variant="outline"
                size="icon"
                className="h-8 w-8"
                onClick={() => {
                  table.setPageIndex(0);
                  if (onPageChange) onPageChange(0);
                }}
                disabled={!table.getCanPreviousPage()}
                data-testid="first-page"
              >
                <ChevronsLeft className="h-4 w-4" />
              </Button>
              <Button
                variant="outline"
                size="icon"
                className="h-8 w-8"
                onClick={() => {
                  table.previousPage();
                  if (onPageChange) onPageChange(table.getState().pagination.pageIndex - 1);
                }}
                disabled={!table.getCanPreviousPage()}
                data-testid="prev-page"
              >
                <ChevronLeft className="h-4 w-4" />
              </Button>
              <span className="px-2 text-sm text-muted-foreground">
                Page {table.getState().pagination.pageIndex + 1} of {table.getPageCount()}
              </span>
              <Button
                variant="outline"
                size="icon"
                className="h-8 w-8"
                onClick={() => {
                  table.nextPage();
                  if (onPageChange) onPageChange(table.getState().pagination.pageIndex + 1);
                }}
                disabled={!table.getCanNextPage()}
                data-testid="next-page"
              >
                <ChevronRight className="h-4 w-4" />
              </Button>
              <Button
                variant="outline"
                size="icon"
                className="h-8 w-8"
                onClick={() => {
                  table.setPageIndex(table.getPageCount() - 1);
                  if (onPageChange) onPageChange(table.getPageCount() - 1);
                }}
                disabled={!table.getCanNextPage()}
                data-testid="last-page"
              >
                <ChevronsRight className="h-4 w-4" />
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
