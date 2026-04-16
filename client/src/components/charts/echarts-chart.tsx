import React, { Suspense } from 'react';
import { Spinner } from '@/components/ui/spinner';
import { cn } from '@/lib/utils';
import type { ChartConfig } from '@shared/schemas/visualization';

export interface EChartsChartProps {
  config: ChartConfig;
  className?: string;
  onDataClick?: (data: any) => void;
}

const EChartsChartLazy = React.lazy(() => import('./echarts-chart-impl'));

function ChartLoadingState({ className }: { className?: string }) {
  return (
    <div 
      className={cn(
        'w-full flex items-center justify-center bg-muted/20 rounded-lg border border-border',
        className
      )}
      style={{ minHeight: 400 }}
      data-testid="chart-loading"
    >
      <div className="flex flex-col items-center gap-3">
        <Spinner className="h-8 w-8 text-primary" />
        <p className="text-sm text-muted-foreground">Loading chart...</p>
      </div>
    </div>
  );
}

function ChartErrorBoundary({ children }: { children: React.ReactNode }) {
  const [hasError, setHasError] = React.useState(false);
  const [error, setError] = React.useState<Error | null>(null);

  React.useEffect(() => {
    const handleError = (event: ErrorEvent) => {
      if (event.message.includes('echarts')) {
        setHasError(true);
        setError(new Error(event.message));
      }
    };
    window.addEventListener('error', handleError);
    return () => window.removeEventListener('error', handleError);
  }, []);

  if (hasError) {
    return (
      <div 
        className="w-full flex items-center justify-center bg-destructive/10 rounded-lg border border-destructive/30 p-6"
        style={{ minHeight: 400 }}
        data-testid="chart-error"
      >
        <div className="flex flex-col items-center gap-3 text-center">
          <p className="text-sm font-medium text-destructive">Failed to load chart</p>
          <p className="text-xs text-muted-foreground max-w-md">
            {error?.message || 'An error occurred while loading the chart component.'}
          </p>
          <button
            onClick={() => {
              setHasError(false);
              setError(null);
            }}
            className="text-xs text-primary hover:underline"
            data-testid="button-retry"
          >
            Try again
          </button>
        </div>
      </div>
    );
  }

  return <>{children}</>;
}

export function EChartsChart(props: EChartsChartProps) {
  return (
    <ChartErrorBoundary>
      <Suspense fallback={<ChartLoadingState className={props.className} />}>
        <EChartsChartLazy {...props} />
      </Suspense>
    </ChartErrorBoundary>
  );
}

export type { ChartConfig };
