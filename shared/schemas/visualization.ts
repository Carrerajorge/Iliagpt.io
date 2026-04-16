import { z } from "zod";

// Base data point types
export interface DataPoint {
  label: string;
  value: number;
  [key: string]: any;
}

export interface TimeSeriesPoint {
  timestamp: string | Date;
  value: number;
  series?: string;
}

export interface GeoPoint {
  lat: number;
  lng: number;
  value: number;
  label?: string;
}

// Chart configuration types
export type ChartType = 'bar' | 'line' | 'area' | 'pie' | 'donut' | 'scatter' | 'heatmap' | 'map';

export interface ChartConfig {
  type: ChartType;
  title?: string;
  subtitle?: string;
  width?: number | string;
  height?: number | string;
  responsive?: boolean;
  
  data: DataPoint[] | TimeSeriesPoint[] | GeoPoint[];
  xAxisKey?: string;
  yAxisKey?: string;
  seriesKey?: string;
  
  colors?: string[];
  showLegend?: boolean;
  showGrid?: boolean;
  showTooltip?: boolean;
  
  enableZoom?: boolean;
  enablePan?: boolean;
  enableExport?: boolean;
  
  mapCenter?: [number, number];
  mapZoom?: number;
}

// Table configuration types
export type ColumnType = 'text' | 'number' | 'date' | 'boolean' | 'select' | 'currency';
export type FilterOperator = 'equals' | 'contains' | 'startsWith' | 'endsWith' | 'gt' | 'lt' | 'gte' | 'lte' | 'between' | 'in';

export interface ColumnDef {
  id: string;
  header: string;
  accessorKey: string;
  type: ColumnType;
  sortable?: boolean;
  filterable?: boolean;
  filterOptions?: string[];
  width?: number | string;
  align?: 'left' | 'center' | 'right';
  format?: string;
}

export interface SortConfig {
  id: string;
  desc: boolean;
}

export interface FilterConfig {
  id: string;
  value: any;
}

export interface TableConfig {
  columns: ColumnDef[];
  data: Record<string, any>[];
  
  pageSize?: number;
  serverSide?: boolean;
  totalRows?: number;
  
  enableSorting?: boolean;
  enableFiltering?: boolean;
  enableGlobalSearch?: boolean;
  enableRowSelection?: boolean;
  enableVirtualization?: boolean;
  
  onPageChange?: (page: number) => void;
  onSortChange?: (sortBy: SortConfig[]) => void;
  onFilterChange?: (filters: FilterConfig[]) => void;
  onSearchChange?: (search: string) => void;
}

// Unified visualization config
export interface VisualizationConfig {
  id: string;
  type: 'chart' | 'table';
  chart?: ChartConfig;
  table?: TableConfig;
}

// Zod Schemas for runtime validation

export const DataPointSchema = z.object({
  label: z.string(),
  value: z.number(),
}).passthrough();

export const TimeSeriesPointSchema = z.object({
  timestamp: z.union([z.string(), z.date()]),
  value: z.number(),
  series: z.string().optional(),
});

export const GeoPointSchema = z.object({
  lat: z.number(),
  lng: z.number(),
  value: z.number(),
  label: z.string().optional(),
});

export const ChartTypeSchema = z.enum(['bar', 'line', 'area', 'pie', 'donut', 'scatter', 'heatmap', 'map']);

export const ChartConfigSchema = z.object({
  type: ChartTypeSchema,
  title: z.string().optional(),
  subtitle: z.string().optional(),
  width: z.union([z.number(), z.string()]).optional(),
  height: z.union([z.number(), z.string()]).optional(),
  responsive: z.boolean().optional(),
  
  data: z.union([
    z.array(DataPointSchema),
    z.array(TimeSeriesPointSchema),
    z.array(GeoPointSchema),
  ]),
  xAxisKey: z.string().optional(),
  yAxisKey: z.string().optional(),
  seriesKey: z.string().optional(),
  
  colors: z.array(z.string()).optional(),
  showLegend: z.boolean().optional(),
  showGrid: z.boolean().optional(),
  showTooltip: z.boolean().optional(),
  
  enableZoom: z.boolean().optional(),
  enablePan: z.boolean().optional(),
  enableExport: z.boolean().optional(),
  
  mapCenter: z.tuple([z.number(), z.number()]).optional(),
  mapZoom: z.number().optional(),
});

export const ColumnTypeSchema = z.enum(['text', 'number', 'date', 'boolean', 'select', 'currency']);
export const FilterOperatorSchema = z.enum(['equals', 'contains', 'startsWith', 'endsWith', 'gt', 'lt', 'gte', 'lte', 'between', 'in']);

export const ColumnDefSchema = z.object({
  id: z.string(),
  header: z.string(),
  accessorKey: z.string(),
  type: ColumnTypeSchema,
  sortable: z.boolean().optional(),
  filterable: z.boolean().optional(),
  filterOptions: z.array(z.string()).optional(),
  width: z.union([z.number(), z.string()]).optional(),
  align: z.enum(['left', 'center', 'right']).optional(),
  format: z.string().optional(),
});

export const SortConfigSchema = z.object({
  id: z.string(),
  desc: z.boolean(),
});

export const FilterConfigSchema = z.object({
  id: z.string(),
  value: z.any(),
});

export const TableConfigSchema = z.object({
  columns: z.array(ColumnDefSchema),
  data: z.array(z.record(z.any())),
  
  pageSize: z.number().optional(),
  serverSide: z.boolean().optional(),
  totalRows: z.number().optional(),
  
  enableSorting: z.boolean().optional(),
  enableFiltering: z.boolean().optional(),
  enableGlobalSearch: z.boolean().optional(),
  enableRowSelection: z.boolean().optional(),
  enableVirtualization: z.boolean().optional(),
});

export const VisualizationTypeSchema = z.enum(['chart', 'table']);

export const VisualizationConfigSchema = z.object({
  id: z.string(),
  type: VisualizationTypeSchema,
  chart: ChartConfigSchema.optional(),
  table: TableConfigSchema.optional(),
});

// Inferred types from Zod schemas
export type DataPointZod = z.infer<typeof DataPointSchema>;
export type TimeSeriesPointZod = z.infer<typeof TimeSeriesPointSchema>;
export type GeoPointZod = z.infer<typeof GeoPointSchema>;
export type ChartConfigZod = z.infer<typeof ChartConfigSchema>;
export type ColumnDefZod = z.infer<typeof ColumnDefSchema>;
export type TableConfigZod = z.infer<typeof TableConfigSchema>;
export type VisualizationConfigZod = z.infer<typeof VisualizationConfigSchema>;
