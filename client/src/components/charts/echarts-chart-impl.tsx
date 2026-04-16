import { useRef, useCallback, useMemo } from 'react';
import ReactEChartsCore from 'echarts-for-react/lib/core';
import * as echarts from 'echarts/core';
import { MapChart, ScatterChart, HeatmapChart } from 'echarts/charts';
import {
  GeoComponent,
  TooltipComponent,
  VisualMapComponent,
  LegendComponent,
  GridComponent,
  TitleComponent,
  ToolboxComponent,
} from 'echarts/components';
import { CanvasRenderer } from 'echarts/renderers';
import { Download, Image, FileCode } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import type { ChartConfig, GeoPoint, DataPoint } from '@shared/schemas/visualization';
import { autoSaveFromUrl } from '@/lib/mediaAutoSave';

echarts.use([
  MapChart,
  ScatterChart,
  HeatmapChart,
  GeoComponent,
  TooltipComponent,
  VisualMapComponent,
  LegendComponent,
  GridComponent,
  TitleComponent,
  ToolboxComponent,
  CanvasRenderer,
]);

export interface EChartsChartProps {
  config: ChartConfig;
  className?: string;
  onDataClick?: (data: any) => void;
}

function getDefaultColors(): string[] {
  return [
    '#3b82f6',
    '#10b981',
    '#f59e0b',
    '#ef4444',
    '#8b5cf6',
    '#ec4899',
    '#06b6d4',
    '#84cc16',
    '#f97316',
    '#6366f1',
  ];
}

function isGeoPoint(point: any): point is GeoPoint {
  return typeof point === 'object' && 'lat' in point && 'lng' in point;
}

function EChartsChartImpl({ config, className, onDataClick }: EChartsChartProps) {
  const chartRef = useRef<ReactEChartsCore>(null);

  const {
    type,
    title,
    subtitle,
    data,
    colors = getDefaultColors(),
    showLegend = true,
    showTooltip = true,
    enableExport = true,
    height = 400,
    mapCenter = [0, 20],
    mapZoom = 1.2,
  } = config;

  const handleDataClick = useCallback((params: any) => {
    if (onDataClick && params.data) {
      onDataClick(params.data);
    }
  }, [onDataClick]);

  const handleExportPNG = useCallback(() => {
    const chartInstance = chartRef.current?.getEchartsInstance();
    if (!chartInstance) return;

    const url = chartInstance.getDataURL({
      type: 'png',
      pixelRatio: 2,
      backgroundColor: '#ffffff',
    });

    const link = document.createElement('a');
    const filename = `chart-${Date.now()}.png`;
    link.download = filename;
    link.href = url;
    link.click();
    autoSaveFromUrl(url, filename, { source: 'echarts' });
  }, []);

  const handleExportSVG = useCallback(() => {
    const chartInstance = chartRef.current?.getEchartsInstance();
    if (!chartInstance) return;

    const url = chartInstance.getDataURL({
      type: 'svg',
    });

    const link = document.createElement('a');
    const filename = `chart-${Date.now()}.svg`;
    link.download = filename;
    link.href = url;
    link.click();
    autoSaveFromUrl(url, filename, { source: 'echarts' });
  }, []);

  const option = useMemo(() => {
    if (type === 'map') {
      const geoData = data.filter(isGeoPoint);
      const scatterData = geoData.map((point) => ({
        name: point.label || '',
        value: [point.lng, point.lat, point.value],
      }));

      const values = geoData.map((p) => p.value);
      const minValue = Math.min(...values, 0);
      const maxValue = Math.max(...values, 100);

      return {
        title: title ? { text: title, subtext: subtitle, left: 'center' } : undefined,
        tooltip: showTooltip ? {
          trigger: 'item',
          formatter: (params: any) => {
            if (params.value && Array.isArray(params.value)) {
              return `${params.name || 'Location'}<br/>Value: ${params.value[2]}`;
            }
            return params.name || '';
          },
        } : undefined,
        legend: showLegend ? { orient: 'vertical', left: 'left' } : undefined,
        visualMap: {
          min: minValue,
          max: maxValue,
          calculable: true,
          inRange: {
            color: colors.slice(0, 5),
          },
          textStyle: { color: '#333' },
          left: 'right',
        },
        geo: {
          map: 'world',
          roam: true,
          center: mapCenter,
          zoom: mapZoom,
          itemStyle: {
            areaColor: '#f3f4f6',
            borderColor: '#d1d5db',
          },
          emphasis: {
            itemStyle: {
              areaColor: '#e5e7eb',
            },
          },
        },
        series: [
          {
            name: title || 'Data Points',
            type: 'scatter',
            coordinateSystem: 'geo',
            data: scatterData,
            symbolSize: (val: number[]) => Math.max(8, Math.min(30, val[2] / 5)),
            encode: { value: 2 },
            itemStyle: {
              color: colors[0],
            },
            emphasis: {
              itemStyle: {
                borderColor: '#fff',
                borderWidth: 2,
              },
            },
          },
        ],
      };
    }

    if (type === 'heatmap') {
      const heatmapData: [number, number, number][] = [];
      const xLabels: string[] = [];
      const yLabels: string[] = [];

      if (data.length > 0 && 'x' in data[0] && 'y' in data[0]) {
        const xSet = new Set<string>();
        const ySet = new Set<string>();
        data.forEach((item: any) => {
          xSet.add(String(item.x));
          ySet.add(String(item.y));
        });
        xLabels.push(...Array.from(xSet));
        yLabels.push(...Array.from(ySet));

        data.forEach((item: any) => {
          const xIndex = xLabels.indexOf(String(item.x));
          const yIndex = yLabels.indexOf(String(item.y));
          heatmapData.push([xIndex, yIndex, item.value]);
        });
      } else {
        const gridSize = Math.ceil(Math.sqrt(data.length));
        for (let i = 0; i < gridSize; i++) {
          xLabels.push(`Col ${i + 1}`);
          yLabels.push(`Row ${i + 1}`);
        }
        data.forEach((item: any, index: number) => {
          const x = index % gridSize;
          const y = Math.floor(index / gridSize);
          heatmapData.push([x, y, (item as DataPoint).value]);
        });
      }

      const values = heatmapData.map((d) => d[2]);
      const minValue = Math.min(...values, 0);
      const maxValue = Math.max(...values, 100);

      return {
        title: title ? { text: title, subtext: subtitle, left: 'center' } : undefined,
        tooltip: showTooltip ? {
          position: 'top',
          formatter: (params: any) => {
            const [x, y, value] = params.value;
            return `${xLabels[x] || x}, ${yLabels[y] || y}: ${value}`;
          },
        } : undefined,
        grid: {
          top: title ? 60 : 20,
          bottom: 60,
          left: 80,
          right: 80,
        },
        xAxis: {
          type: 'category',
          data: xLabels,
          splitArea: { show: true },
        },
        yAxis: {
          type: 'category',
          data: yLabels,
          splitArea: { show: true },
        },
        visualMap: {
          min: minValue,
          max: maxValue,
          calculable: true,
          orient: 'horizontal',
          left: 'center',
          bottom: 10,
          inRange: {
            color: ['#f0f9ff', '#bae6fd', '#38bdf8', '#0284c7', '#075985'],
          },
        },
        series: [
          {
            name: title || 'Heatmap',
            type: 'heatmap',
            data: heatmapData,
            label: {
              show: heatmapData.length <= 100,
              formatter: (params: any) => params.value[2],
            },
            emphasis: {
              itemStyle: {
                shadowBlur: 10,
                shadowColor: 'rgba(0, 0, 0, 0.5)',
              },
            },
          },
        ],
      };
    }

    return {
      title: { text: 'Unsupported chart type', left: 'center' },
      series: [],
    };
  }, [type, title, subtitle, data, colors, showLegend, showTooltip, mapCenter, mapZoom]);

  const chartHeight = typeof height === 'number' ? height : parseInt(height as string, 10) || 400;

  const onEvents = useMemo(() => ({
    click: handleDataClick,
  }), [handleDataClick]);

  return (
    <div className={cn('w-full relative group', className)} data-testid="echarts-chart">
      {(title || subtitle) && (
        <div className="mb-4">
          {title && <h3 className="text-lg font-semibold text-foreground" data-testid="chart-title">{title}</h3>}
          {subtitle && <p className="text-sm text-muted-foreground" data-testid="chart-subtitle">{subtitle}</p>}
        </div>
      )}
      
      <div className="absolute top-2 right-2 flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity z-10">
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

      <div className="w-full" style={{ height: chartHeight }} data-testid="chart-container">
        <ReactEChartsCore
          ref={chartRef}
          echarts={echarts}
          option={option}
          style={{ height: '100%', width: '100%' }}
          opts={{ renderer: 'canvas' }}
          onEvents={onEvents}
          notMerge={true}
          lazyUpdate={true}
        />
      </div>
    </div>
  );
}

export default EChartsChartImpl;
