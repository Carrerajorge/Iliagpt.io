import React, { useState, useMemo, useCallback, useEffect } from 'react';
import {
  BarChart,
  Bar,
  LineChart,
  Line,
  PieChart,
  Pie,
  AreaChart,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  Cell,
  ResponsiveContainer,
} from 'recharts';
import { SparseGrid } from '@/lib/sparseGrid';
import { X } from 'lucide-react';

export const CHART_COLORS = [
  '#3b82f6',
  '#10b981',
  '#f59e0b',
  '#ef4444',
  '#8b5cf6',
  '#ec4899',
  '#06b6d4',
  '#84cc16',
];

export interface ChartDataRange {
  labels: { startRow: number; endRow: number; col: number };
  values: { startRow: number; endRow: number; col: number };
}

export interface ChartConfig {
  id: string;
  type: 'bar' | 'line' | 'pie' | 'area';
  title: string;
  dataRange: ChartDataRange;
  position: { row: number; col: number };
  size: { width: number; height: number };
}

interface GridConfig {
  ROW_HEIGHT: number;
  COL_WIDTH: number;
  ROW_HEADER_WIDTH: number;
  COL_HEADER_HEIGHT: number;
}

const useChartData = (
  grid: SparseGrid | null,
  dataRange: ChartDataRange | undefined
): Array<{ name: string; value: number }> => {
  return useMemo(() => {
    if (!dataRange || !grid) return [];
    const { labels, values } = dataRange;
    const data: Array<{ name: string; value: number }> = [];
    for (let r = labels.startRow; r <= labels.endRow; r++) {
      const labelCell = grid.getCell(r, labels.col);
      const valueCell = grid.getCell(r, values.col);
      const label = labelCell?.value || `Item ${r}`;
      const value = parseFloat(String(valueCell?.value).replace(/[^\d.-]/g, '')) || 0;
      if (label) {
        data.push({ name: String(label), value });
      }
    }
    return data;
  }, [grid, dataRange]);
};

interface ExcelChartProps {
  chart: ChartConfig;
  grid: SparseGrid | null;
  gridConfig: GridConfig;
  onMove: (chartId: string, position: { row: number; col: number }) => void;
  onResize: (chartId: string, size: { width: number; height: number }) => void;
  onDelete: (chartId: string) => void;
  isSelected: boolean;
  onSelect: (chartId: string) => void;
}

const ExcelChart: React.FC<ExcelChartProps> = ({
  chart,
  grid,
  gridConfig,
  onMove,
  onResize,
  onDelete,
  isSelected,
  onSelect,
}) => {
  const [isDragging, setIsDragging] = useState(false);
  const [isResizing, setIsResizing] = useState(false);
  const [dragStart, setDragStart] = useState({ x: 0, y: 0 });
  const [resizeStart, setResizeStart] = useState({ x: 0, y: 0, width: 0, height: 0 });

  const chartData = useChartData(grid, chart.dataRange);

  const pixelPosition = {
    left: chart.position.col * gridConfig.COL_WIDTH + gridConfig.ROW_HEADER_WIDTH,
    top: chart.position.row * gridConfig.ROW_HEIGHT + gridConfig.COL_HEADER_HEIGHT,
  };

  const handleMouseDown = (e: React.MouseEvent) => {
    if ((e.target as HTMLElement).classList.contains('resize-handle')) return;
    e.stopPropagation();
    onSelect(chart.id);
    setIsDragging(true);
    setDragStart({
      x: e.clientX - pixelPosition.left,
      y: e.clientY - pixelPosition.top,
    });
  };

  const handleResizeMouseDown = (e: React.MouseEvent) => {
    e.stopPropagation();
    onSelect(chart.id);
    setIsResizing(true);
    setResizeStart({
      x: e.clientX,
      y: e.clientY,
      width: chart.size.width,
      height: chart.size.height,
    });
  };

  const handleMouseMove = useCallback(
    (e: MouseEvent) => {
      if (isDragging) {
        const newLeft = e.clientX - dragStart.x;
        const newTop = e.clientY - dragStart.y;
        const newCol = Math.max(0, Math.round((newLeft - gridConfig.ROW_HEADER_WIDTH) / gridConfig.COL_WIDTH));
        const newRow = Math.max(0, Math.round((newTop - gridConfig.COL_HEADER_HEIGHT) / gridConfig.ROW_HEIGHT));
        onMove(chart.id, { row: newRow, col: newCol });
      }
      if (isResizing) {
        const deltaX = e.clientX - resizeStart.x;
        const deltaY = e.clientY - resizeStart.y;
        const newWidth = Math.max(200, resizeStart.width + deltaX);
        const newHeight = Math.max(150, resizeStart.height + deltaY);
        onResize(chart.id, { width: newWidth, height: newHeight });
      }
    },
    [isDragging, isResizing, dragStart, resizeStart, gridConfig, chart.id, onMove, onResize]
  );

  const handleMouseUp = useCallback(() => {
    setIsDragging(false);
    setIsResizing(false);
  }, []);

  useEffect(() => {
    if (isDragging || isResizing) {
      window.addEventListener('mousemove', handleMouseMove);
      window.addEventListener('mouseup', handleMouseUp);
      return () => {
        window.removeEventListener('mousemove', handleMouseMove);
        window.removeEventListener('mouseup', handleMouseUp);
      };
    }
  }, [isDragging, isResizing, handleMouseMove, handleMouseUp]);

  const renderChart = () => {
    if (chartData.length === 0) {
      return (
        <div className="flex flex-col items-center justify-center h-full text-gray-500">
          <span className="text-2xl mb-2">📊</span>
          <p className="text-sm">No data to display</p>
          <small className="text-xs">Check the data range</small>
        </div>
      );
    }

    const commonProps = {
      data: chartData,
      margin: { top: 20, right: 30, left: 20, bottom: 40 },
    };

    switch (chart.type) {
      case 'bar':
        return (
          <ResponsiveContainer width="100%" height="100%">
            <BarChart {...commonProps}>
              <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
              <XAxis
                dataKey="name"
                tick={{ fontSize: 11, fill: '#64748b' }}
                angle={-45}
                textAnchor="end"
                height={60}
              />
              <YAxis tick={{ fontSize: 11, fill: '#64748b' }} />
              <Tooltip
                contentStyle={{
                  background: '#fff',
                  border: '1px solid #e2e8f0',
                  borderRadius: '8px',
                  boxShadow: '0 4px 12px rgba(0,0,0,0.1)',
                }}
              />
              <Bar dataKey="value" radius={[4, 4, 0, 0]} animationDuration={800}>
                {chartData.map((_, index) => (
                  <Cell key={`cell-${index}`} fill={CHART_COLORS[index % CHART_COLORS.length]} />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        );

      case 'line':
        return (
          <ResponsiveContainer width="100%" height="100%">
            <LineChart {...commonProps}>
              <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
              <XAxis dataKey="name" tick={{ fontSize: 11, fill: '#64748b' }} />
              <YAxis tick={{ fontSize: 11, fill: '#64748b' }} />
              <Tooltip
                contentStyle={{
                  background: '#fff',
                  border: '1px solid #e2e8f0',
                  borderRadius: '8px',
                  boxShadow: '0 4px 12px rgba(0,0,0,0.1)',
                }}
              />
              <Line
                type="monotone"
                dataKey="value"
                stroke={CHART_COLORS[0]}
                strokeWidth={3}
                dot={{ fill: CHART_COLORS[0], strokeWidth: 2, r: 5 }}
                activeDot={{ r: 8 }}
                animationDuration={800}
              />
            </LineChart>
          </ResponsiveContainer>
        );

      case 'area':
        return (
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart {...commonProps}>
              <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
              <XAxis dataKey="name" tick={{ fontSize: 11, fill: '#64748b' }} />
              <YAxis tick={{ fontSize: 11, fill: '#64748b' }} />
              <Tooltip
                contentStyle={{
                  background: '#fff',
                  border: '1px solid #e2e8f0',
                  borderRadius: '8px',
                  boxShadow: '0 4px 12px rgba(0,0,0,0.1)',
                }}
              />
              <Area
                type="monotone"
                dataKey="value"
                stroke={CHART_COLORS[0]}
                fill={`${CHART_COLORS[0]}40`}
                strokeWidth={2}
                animationDuration={800}
              />
            </AreaChart>
          </ResponsiveContainer>
        );

      case 'pie':
        return (
          <ResponsiveContainer width="100%" height="100%">
            <PieChart>
              <Pie
                data={chartData}
                dataKey="value"
                nameKey="name"
                cx="50%"
                cy="50%"
                outerRadius={Math.min(chart.size.width, chart.size.height) / 3}
                label={({ name, percent }) => `${name}: ${(percent * 100).toFixed(0)}%`}
                labelLine={{ stroke: '#94a3b8' }}
                animationDuration={800}
              >
                {chartData.map((_, index) => (
                  <Cell key={`cell-${index}`} fill={CHART_COLORS[index % CHART_COLORS.length]} />
                ))}
              </Pie>
              <Tooltip
                contentStyle={{
                  background: '#fff',
                  border: '1px solid #e2e8f0',
                  borderRadius: '8px',
                  boxShadow: '0 4px 12px rgba(0,0,0,0.1)',
                }}
              />
              <Legend />
            </PieChart>
          </ResponsiveContainer>
        );

      default:
        return <div>Unsupported chart type: {chart.type}</div>;
    }
  };

  return (
    <div
      className={`absolute bg-white dark:bg-gray-900 border rounded-lg shadow-lg overflow-hidden ${
        isSelected ? 'border-blue-500 ring-2 ring-blue-200' : 'border-gray-300 dark:border-gray-700'
      } ${isDragging ? 'cursor-grabbing opacity-90' : 'cursor-grab'}`}
      style={{
        left: pixelPosition.left,
        top: pixelPosition.top,
        width: chart.size.width,
        height: chart.size.height,
        zIndex: isSelected ? 100 : 10,
      }}
      onMouseDown={handleMouseDown}
      data-testid={`excel-chart-${chart.id}`}
    >
      <div className="flex items-center justify-between px-3 py-2 bg-gray-50 dark:bg-gray-800 border-b border-gray-200 dark:border-gray-700">
        <span className="text-sm font-medium text-gray-700 dark:text-gray-300 truncate">
          {chart.title}
        </span>
        <button
          className="p-1 text-gray-400 hover:text-red-500 hover:bg-red-50 dark:hover:bg-red-900/20 rounded transition-colors"
          onClick={(e) => {
            e.stopPropagation();
            onDelete(chart.id);
          }}
          title="Delete chart"
          data-testid={`delete-chart-${chart.id}`}
        >
          <X className="w-4 h-4" />
        </button>
      </div>

      <div className="p-2" style={{ height: 'calc(100% - 40px)' }}>
        {renderChart()}
      </div>

      {isSelected && (
        <>
          <div
            className="resize-handle absolute bottom-0 right-0 w-4 h-4 cursor-se-resize bg-blue-500 rounded-tl"
            onMouseDown={handleResizeMouseDown}
            data-testid={`resize-handle-se-${chart.id}`}
          />
          <div
            className="resize-handle absolute bottom-0 right-4 left-4 h-2 cursor-s-resize"
            onMouseDown={handleResizeMouseDown}
          />
          <div
            className="resize-handle absolute top-10 bottom-4 right-0 w-2 cursor-e-resize"
            onMouseDown={handleResizeMouseDown}
          />
        </>
      )}
    </div>
  );
};

interface ChartLayerProps {
  charts: ChartConfig[];
  grid: SparseGrid;
  gridConfig: GridConfig;
  onUpdateChart: (chartId: string, updates: Partial<ChartConfig>) => void;
  onDeleteChart: (chartId: string) => void;
}

export const ChartLayer: React.FC<ChartLayerProps> = ({
  charts,
  grid,
  gridConfig,
  onUpdateChart,
  onDeleteChart,
}) => {
  const [selectedChartId, setSelectedChartId] = useState<string | null>(null);

  const handleMoveChart = (chartId: string, newPosition: { row: number; col: number }) => {
    onUpdateChart(chartId, { position: newPosition });
  };

  const handleResizeChart = (chartId: string, newSize: { width: number; height: number }) => {
    onUpdateChart(chartId, { size: newSize });
  };

  const handleSelectChart = (chartId: string) => {
    setSelectedChartId(chartId);
  };

  const handleLayerClick = (e: React.MouseEvent) => {
    if ((e.target as HTMLElement).classList.contains('chart-layer')) {
      setSelectedChartId(null);
    }
  };

  if (!charts || charts.length === 0) return null;

  return (
    <div
      className="chart-layer"
      onClick={handleLayerClick}
      data-testid="chart-layer"
      style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, pointerEvents: 'none' }}
    >
      {charts.map((chart) => (
        <div key={chart.id} className="pointer-events-auto">
          <ExcelChart
            chart={chart}
            grid={grid}
            gridConfig={gridConfig}
            onMove={handleMoveChart}
            onResize={handleResizeChart}
            onDelete={onDeleteChart}
            isSelected={selectedChartId === chart.id}
            onSelect={handleSelectChart}
          />
        </div>
      ))}
    </div>
  );
};

export const createChartFromSelection = (
  type: ChartConfig['type'],
  title: string,
  selectedRange: { startRow: number; endRow: number; startCol: number; endCol: number }
): ChartConfig => {
  return {
    id: `chart_${Date.now()}`,
    type,
    title: title || `${type.charAt(0).toUpperCase() + type.slice(1)} Chart`,
    dataRange: {
      labels: {
        startRow: selectedRange.startRow,
        endRow: selectedRange.endRow,
        col: selectedRange.startCol,
      },
      values: {
        startRow: selectedRange.startRow,
        endRow: selectedRange.endRow,
        col: selectedRange.endCol,
      },
    },
    position: {
      row: selectedRange.startRow,
      col: selectedRange.endCol + 2,
    },
    size: { width: 400, height: 300 },
  };
};

export default ChartLayer;
