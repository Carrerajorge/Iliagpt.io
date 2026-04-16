export { VisualizationRenderer, SmartTable } from './visualization-renderer';
export type { VisualizationRendererProps, SmartTableProps } from './visualization-renderer';

export { RechartsChart, getDefaultColors, exportChartAsPNG, exportChartAsSVG } from './recharts-chart';
export type { RechartsChartProps } from './recharts-chart';

export { EChartsChart } from './echarts-chart';
export type { EChartsChartProps } from './echarts-chart';

export type { 
  ChartConfig, 
  DataPoint, 
  TableConfig, 
  VisualizationConfig,
  ColumnDef,
  ChartType 
} from '@shared/schemas/visualization';
