import { useRef, useState, useCallback, useMemo } from 'react';
import {
  ResponsiveContainer,
  BarChart,
  Bar,
  LineChart,
  Line,
  AreaChart,
  Area,
  PieChart,
  Pie,
  Cell,
  ScatterChart,
  Scatter,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ReferenceArea,
  TooltipProps,
} from 'recharts';
import { Download, Image, FileCode, ZoomIn, ZoomOut, RotateCcw } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import type { ChartConfig, DataPoint } from '@shared/schemas/visualization';
import { autoSaveToMediaLibrary } from '@/lib/mediaAutoSave';

export interface RechartsChartProps {
  config: ChartConfig;
  className?: string;
  onDataClick?: (data: any) => void;
}

export function getDefaultColors(): string[] {
  return [
    '#3b82f6', // blue-500
    '#10b981', // emerald-500
    '#f59e0b', // amber-500
    '#ef4444', // red-500
    '#8b5cf6', // violet-500
    '#ec4899', // pink-500
    '#06b6d4', // cyan-500
    '#84cc16', // lime-500
    '#f97316', // orange-500
    '#6366f1', // indigo-500
  ];
}

export async function exportChartAsPNG(elementRef: React.RefObject<HTMLDivElement | null>): Promise<void> {
  if (!elementRef.current) return;

  const svgElement = elementRef.current.querySelector('svg');
  if (!svgElement) return;

  const svgData = new XMLSerializer().serializeToString(svgElement);
  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext('2d');
  if (!ctx) return;

  const img = new window.Image();
  const svgBlob = new Blob([svgData], { type: 'image/svg+xml;charset=utf-8' });
  const url = URL.createObjectURL(svgBlob);

  return new Promise((resolve, reject) => {
    img.onload = () => {
      canvas.width = img.width * 2;
      canvas.height = img.height * 2;
      ctx.scale(2, 2);
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.drawImage(img, 0, 0);
      URL.revokeObjectURL(url);

      canvas.toBlob((blob) => {
        if (blob) {
          const link = document.createElement('a');
          const filename = `chart-${Date.now()}.png`;
          link.download = filename;
          link.href = URL.createObjectURL(blob);
          link.click();
          URL.revokeObjectURL(link.href);
          autoSaveToMediaLibrary(blob, filename, { source: 'recharts' });
        }
        resolve();
      }, 'image/png');
    };
    img.onerror = reject;
    img.src = url;
  });
}

export function exportChartAsSVG(elementRef: React.RefObject<HTMLDivElement | null>): void {
  if (!elementRef.current) return;

  const svgElement = elementRef.current.querySelector('svg');
  if (!svgElement) return;

  const svgClone = svgElement.cloneNode(true) as SVGElement;
  svgClone.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
  
  const svgData = new XMLSerializer().serializeToString(svgClone);
  const blob = new Blob([svgData], { type: 'image/svg+xml;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  
  const link = document.createElement('a');
  const filename = `chart-${Date.now()}.svg`;
  link.download = filename;
  link.href = url;
  link.click();
  URL.revokeObjectURL(url);
  autoSaveToMediaLibrary(blob, filename, { source: 'recharts' });
}

interface CustomTooltipProps extends TooltipProps<number, string> {
  colors?: string[];
}

function CustomTooltip({ active, payload, label, colors = [] }: CustomTooltipProps) {
  if (!active || !payload || !payload.length) return null;

  return (
    <div className="bg-popover border border-border rounded-lg shadow-lg p-3 min-w-[120px]" data-testid="chart-tooltip">
      {label && <p className="text-sm font-medium text-foreground mb-2">{label}</p>}
      <div className="space-y-1">
        {payload.map((entry, index) => (
          <div key={index} className="flex items-center justify-between gap-4">
            <div className="flex items-center gap-2">
              <div
                className="w-3 h-3 rounded-full"
                style={{ backgroundColor: entry.color || colors[index] || getDefaultColors()[index] }}
              />
              <span className="text-xs text-muted-foreground">{entry.name || entry.dataKey}</span>
            </div>
            <span className="text-sm font-medium text-foreground">
              {typeof entry.value === 'number' ? entry.value.toLocaleString() : entry.value}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

interface ZoomState {
  refAreaLeft: string | number | null;
  refAreaRight: string | number | null;
  left: string | number | 'dataMin';
  right: string | number | 'dataMax';
  top: string | number | 'dataMax+10%';
  bottom: string | number | 'dataMin-10%';
}

const initialZoomState: ZoomState = {
  refAreaLeft: null,
  refAreaRight: null,
  left: 'dataMin',
  right: 'dataMax',
  top: 'dataMax+10%',
  bottom: 'dataMin-10%',
};

export function RechartsChart({ config, className, onDataClick }: RechartsChartProps) {
  const chartRef = useRef<HTMLDivElement>(null);
  const [zoomState, setZoomState] = useState<ZoomState>(initialZoomState);
  const [isZooming, setIsZooming] = useState(false);

  const {
    type,
    title,
    subtitle,
    data,
    xAxisKey = 'label',
    yAxisKey = 'value',
    colors = getDefaultColors(),
    showLegend = true,
    showGrid = true,
    showTooltip = true,
    enableZoom = false,
    enableExport = true,
    height = 400,
  } = config;

  const chartData = useMemo(() => {
    return data.map((item: any, index: number) => ({
      ...item,
      name: item.label || item.name || `Item ${index + 1}`,
    }));
  }, [data]);

  const uniqueKeys = useMemo(() => {
    if (!chartData.length) return [yAxisKey];
    const firstItem = chartData[0];
    const keys = Object.keys(firstItem).filter(
      (key) => typeof firstItem[key] === 'number' && key !== 'lat' && key !== 'lng'
    );
    return keys.length ? keys : [yAxisKey];
  }, [chartData, yAxisKey]);

  const handleMouseDown = useCallback((e: any) => {
    if (!enableZoom || !e) return;
    setZoomState((prev) => ({ ...prev, refAreaLeft: e.activeLabel }));
    setIsZooming(true);
  }, [enableZoom]);

  const handleMouseMove = useCallback((e: any) => {
    if (!isZooming || !e) return;
    setZoomState((prev) => ({ ...prev, refAreaRight: e.activeLabel }));
  }, [isZooming]);

  const handleMouseUp = useCallback(() => {
    if (!isZooming) return;
    setIsZooming(false);

    const { refAreaLeft, refAreaRight } = zoomState;
    if (refAreaLeft === refAreaRight || refAreaRight === null) {
      setZoomState((prev) => ({ ...prev, refAreaLeft: null, refAreaRight: null }));
      return;
    }

    let left = refAreaLeft;
    let right = refAreaRight;
    if (typeof left === 'string' && typeof right === 'string' && left > right) {
      [left, right] = [right, left];
    }

    setZoomState({
      refAreaLeft: null,
      refAreaRight: null,
      left: left as string,
      right: right as string,
      top: 'dataMax+10%',
      bottom: 'dataMin-10%',
    });
  }, [isZooming, zoomState]);

  const handleZoomReset = useCallback(() => {
    setZoomState(initialZoomState);
  }, []);

  const handleDataClick = useCallback((data: any) => {
    if (onDataClick && data?.payload) {
      onDataClick(data.payload);
    }
  }, [onDataClick]);

  const handleExportPNG = useCallback(async () => {
    await exportChartAsPNG(chartRef);
  }, []);

  const handleExportSVG = useCallback(() => {
    exportChartAsSVG(chartRef);
  }, []);

  const commonCartesianProps = {
    data: chartData,
    margin: { top: 20, right: 30, left: 20, bottom: 20 },
    onMouseDown: enableZoom ? handleMouseDown : undefined,
    onMouseMove: enableZoom ? handleMouseMove : undefined,
    onMouseUp: enableZoom ? handleMouseUp : undefined,
  };

  const renderCartesianChart = () => {
    const xDomain = enableZoom ? [zoomState.left, zoomState.right] as [string, string] : undefined;
    const yDomain = enableZoom ? [zoomState.bottom, zoomState.top] as [string, string] : undefined;

    switch (type) {
      case 'bar':
        return (
          <BarChart {...commonCartesianProps}>
            {showGrid && <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />}
            <XAxis dataKey={xAxisKey} className="text-xs" domain={xDomain} allowDataOverflow={enableZoom} />
            <YAxis className="text-xs" domain={yDomain} allowDataOverflow={enableZoom} />
            {showTooltip && <Tooltip content={<CustomTooltip colors={colors} />} />}
            {showLegend && <Legend />}
            {uniqueKeys.map((key, index) => (
              <Bar
                key={key}
                dataKey={key}
                fill={colors[index % colors.length]}
                radius={[4, 4, 0, 0]}
                onClick={handleDataClick}
                cursor={onDataClick ? 'pointer' : 'default'}
              />
            ))}
            {enableZoom && zoomState.refAreaLeft && zoomState.refAreaRight && (
              <ReferenceArea
                x1={zoomState.refAreaLeft}
                x2={zoomState.refAreaRight}
                strokeOpacity={0.3}
                fill="hsl(var(--primary))"
                fillOpacity={0.1}
              />
            )}
          </BarChart>
        );

      case 'line':
        return (
          <LineChart {...commonCartesianProps}>
            {showGrid && <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />}
            <XAxis dataKey={xAxisKey} className="text-xs" domain={xDomain} allowDataOverflow={enableZoom} />
            <YAxis className="text-xs" domain={yDomain} allowDataOverflow={enableZoom} />
            {showTooltip && <Tooltip content={<CustomTooltip colors={colors} />} />}
            {showLegend && <Legend />}
            {uniqueKeys.map((key, index) => (
              <Line
                key={key}
                type="monotone"
                dataKey={key}
                stroke={colors[index % colors.length]}
                strokeWidth={2}
                dot={{ r: 4, fill: colors[index % colors.length] }}
                activeDot={{ r: 6, onClick: handleDataClick }}
              />
            ))}
            {enableZoom && zoomState.refAreaLeft && zoomState.refAreaRight && (
              <ReferenceArea
                x1={zoomState.refAreaLeft}
                x2={zoomState.refAreaRight}
                strokeOpacity={0.3}
                fill="hsl(var(--primary))"
                fillOpacity={0.1}
              />
            )}
          </LineChart>
        );

      case 'area':
        return (
          <AreaChart {...commonCartesianProps}>
            <defs>
              {uniqueKeys.map((key, index) => (
                <linearGradient key={key} id={`gradient-${key}`} x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor={colors[index % colors.length]} stopOpacity={0.8} />
                  <stop offset="95%" stopColor={colors[index % colors.length]} stopOpacity={0.1} />
                </linearGradient>
              ))}
            </defs>
            {showGrid && <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />}
            <XAxis dataKey={xAxisKey} className="text-xs" domain={xDomain} allowDataOverflow={enableZoom} />
            <YAxis className="text-xs" domain={yDomain} allowDataOverflow={enableZoom} />
            {showTooltip && <Tooltip content={<CustomTooltip colors={colors} />} />}
            {showLegend && <Legend />}
            {uniqueKeys.map((key, index) => (
              <Area
                key={key}
                type="monotone"
                dataKey={key}
                stroke={colors[index % colors.length]}
                strokeWidth={2}
                fill={`url(#gradient-${key})`}
                onClick={handleDataClick}
              />
            ))}
            {enableZoom && zoomState.refAreaLeft && zoomState.refAreaRight && (
              <ReferenceArea
                x1={zoomState.refAreaLeft}
                x2={zoomState.refAreaRight}
                strokeOpacity={0.3}
                fill="hsl(var(--primary))"
                fillOpacity={0.1}
              />
            )}
          </AreaChart>
        );

      case 'scatter':
        return (
          <ScatterChart {...commonCartesianProps}>
            {showGrid && <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />}
            <XAxis type="number" dataKey={xAxisKey} className="text-xs" name={xAxisKey} domain={xDomain} allowDataOverflow={enableZoom} />
            <YAxis type="number" dataKey={yAxisKey} className="text-xs" name={yAxisKey} domain={yDomain} allowDataOverflow={enableZoom} />
            {showTooltip && <Tooltip content={<CustomTooltip colors={colors} />} cursor={{ strokeDasharray: '3 3' }} />}
            {showLegend && <Legend />}
            <Scatter
              name="Data"
              data={chartData}
              fill={colors[0]}
              onClick={handleDataClick}
              cursor={onDataClick ? 'pointer' : 'default'}
            />
            {enableZoom && zoomState.refAreaLeft && zoomState.refAreaRight && (
              <ReferenceArea
                x1={zoomState.refAreaLeft}
                x2={zoomState.refAreaRight}
                strokeOpacity={0.3}
                fill="hsl(var(--primary))"
                fillOpacity={0.1}
              />
            )}
          </ScatterChart>
        );

      default:
        return null;
    }
  };

  const renderPieChart = () => {
    const isDonut = type === 'donut';
    const innerRadius = isDonut ? '60%' : 0;
    const outerRadius = '80%';

    return (
      <PieChart>
        <Pie
          data={chartData}
          dataKey={yAxisKey}
          nameKey={xAxisKey}
          cx="50%"
          cy="50%"
          innerRadius={innerRadius}
          outerRadius={outerRadius}
          paddingAngle={2}
          onClick={handleDataClick}
          cursor={onDataClick ? 'pointer' : 'default'}
          label={({ name, percent }) => `${name}: ${(percent * 100).toFixed(0)}%`}
          labelLine={{ stroke: 'hsl(var(--muted-foreground))' }}
        >
          {chartData.map((_, index) => (
            <Cell key={`cell-${index}`} fill={colors[index % colors.length]} />
          ))}
        </Pie>
        {showTooltip && <Tooltip content={<CustomTooltip colors={colors} />} />}
        {showLegend && <Legend />}
      </PieChart>
    );
  };

  const renderChart = () => {
    if (type === 'pie' || type === 'donut') {
      return renderPieChart();
    }
    return renderCartesianChart();
  };

  const chartHeight = typeof height === 'number' ? height : parseInt(height as string, 10) || 400;

  return (
    <div className={cn('w-full relative group', className)} data-testid="recharts-chart">
      {(title || subtitle) && (
        <div className="mb-4">
          {title && <h3 className="text-lg font-semibold text-foreground" data-testid="chart-title">{title}</h3>}
          {subtitle && <p className="text-sm text-muted-foreground" data-testid="chart-subtitle">{subtitle}</p>}
        </div>
      )}
      
      <div className="absolute top-2 right-2 flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity z-10">
        {enableZoom && (zoomState.left !== 'dataMin' || zoomState.right !== 'dataMax') && (
          <Button
            variant="ghost"
            size="sm"
            onClick={handleZoomReset}
            className="h-8 w-8 p-0 bg-muted/80 hover:bg-muted border border-border/50"
            title="Restablecer zoom"
            data-testid="button-zoom-reset"
          >
            <RotateCcw className="h-4 w-4" />
          </Button>
        )}
        <Button
          variant="ghost"
          size="sm"
          onClick={handleExportPNG}
          className="h-8 w-8 p-0 bg-muted/80 hover:bg-muted border border-border/50"
          title="Descargar PNG"
          data-testid="button-export-png"
        >
          <Image className="h-4 w-4" />
        </Button>
        <Button
          variant="ghost"
          size="sm"
          onClick={handleExportSVG}
          className="h-8 w-8 p-0 bg-muted/80 hover:bg-muted border border-border/50"
          title="Descargar SVG"
          data-testid="button-export-svg"
        >
          <FileCode className="h-4 w-4" />
        </Button>
      </div>
      
      <div ref={chartRef} className="w-full" style={{ height: chartHeight }} data-testid="chart-container">
        <ResponsiveContainer width="100%" height="100%">
          {renderChart() as React.ReactElement}
        </ResponsiveContainer>
      </div>
      
      {enableZoom && type !== 'pie' && type !== 'donut' && (
        <p className="text-xs text-muted-foreground mt-2 text-center" data-testid="zoom-hint">
          Click and drag to zoom. Click reset to restore original view.
        </p>
      )}
    </div>
  );
}

export type { ChartConfig, DataPoint };
