import { VisualizationConfig } from '@shared/schemas/visualization';
import { RechartsChart } from './recharts-chart';
import { EChartsChart } from './echarts-chart';
import { SmartTable } from './smart-table';
import { cn } from '@/lib/utils';

interface VisualizationRendererProps {
  config: VisualizationConfig;
  className?: string;
  onDataClick?: (data: any) => void;
}

export function VisualizationRenderer({ config, className, onDataClick }: VisualizationRendererProps) {
  if (config.type === 'table' && config.table) {
    return <SmartTable config={config.table} className={className} />;
  }
  
  if (config.type === 'chart' && config.chart) {
    if (config.chart.type === 'map' || config.chart.type === 'heatmap') {
      return <EChartsChart config={config.chart} className={className} onDataClick={onDataClick} />;
    }
    return <RechartsChart config={config.chart} className={className} onDataClick={onDataClick} />;
  }
  
  return (
    <div 
      className={cn('w-full flex items-center justify-center p-8 bg-muted/20 rounded-lg border border-border', className)}
      data-testid="visualization-error"
    >
      <p className="text-sm text-muted-foreground">Invalid visualization config</p>
    </div>
  );
}

export { SmartTable } from './smart-table';
export type { SmartTableProps } from './smart-table';
export type { VisualizationRendererProps };
