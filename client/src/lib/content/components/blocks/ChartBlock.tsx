/**
 * ChartBlock Component
 * 
 * Renders charts (line, bar, pie, etc.).
 * Placeholder - integrate with Chart.js or Recharts.
 */

import React from 'react';
import type { ChartBlock as ChartBlockType } from '../../types/blocks';
import type { RenderContext } from '../../types/content';
import { useContentTheme } from '../../renderers/block-renderer';
import { BarChart3, LineChart, PieChart } from 'lucide-react';

interface Props {
    block: ChartBlockType;
    context: RenderContext;
}

export default function ChartBlock({ block, context }: Props) {
    const theme = useContentTheme();
    const { chartType, data, title, height = 300 } = block;

    const getIcon = () => {
        switch (chartType) {
            case 'line':
            case 'area':
                return LineChart;
            case 'pie':
            case 'doughnut':
                return PieChart;
            default:
                return BarChart3;
        }
    };

    const Icon = getIcon();

    // Simplified bar chart rendering
    const maxValue = Math.max(...data.datasets.flatMap(d => d.data));

    return (
        <div className="my-4">
            {title && (
                <h4
                    className="font-semibold mb-3 flex items-center gap-2"
                    style={{ color: theme.colors.foreground }}
                >
                    <Icon size={18} />
                    {title}
                </h4>
            )}

            <div
                className="rounded-lg p-4 border"
                style={{
                    height,
                    borderColor: theme.colors.border,
                    backgroundColor: theme.colors.muted,
                }}
            >
                {/* Simple bar chart visualization */}
                {(chartType === 'bar' || chartType === 'line') && (
                    <div className="h-full flex items-end gap-2">
                        {data.labels.map((label, i) => {
                            const value = data.datasets[0]?.data[i] || 0;
                            const pct = (value / maxValue) * 100;

                            return (
                                <div key={i} className="flex-1 flex flex-col items-center gap-1">
                                    <div
                                        className="w-full rounded-t transition-all"
                                        style={{
                                            height: `${pct}%`,
                                            backgroundColor: theme.colors.primary,
                                            minHeight: 4,
                                        }}
                                    />
                                    <span
                                        className="text-xs truncate w-full text-center"
                                        style={{ color: theme.colors.mutedForeground }}
                                    >
                                        {label}
                                    </span>
                                </div>
                            );
                        })}
                    </div>
                )}

                {/* Pie chart placeholder */}
                {(chartType === 'pie' || chartType === 'doughnut') && (
                    <div className="h-full flex items-center justify-center">
                        <div
                            className="w-32 h-32 rounded-full flex items-center justify-center"
                            style={{
                                background: `conic-gradient(${data.datasets[0]?.data.map((v, i) => {
                                    const total = data.datasets[0].data.reduce((a, b) => a + b, 0);
                                    const pct = (v / total) * 100;
                                    const colors = ['#3b82f6', '#22c55e', '#f59e0b', '#ef4444', '#8b5cf6'];
                                    return `${colors[i % colors.length]} ${pct}%`;
                                }).join(', ')
                                    })`,
                            }}
                        >
                            {chartType === 'doughnut' && (
                                <div
                                    className="w-20 h-20 rounded-full"
                                    style={{ backgroundColor: theme.colors.background }}
                                />
                            )}
                        </div>
                    </div>
                )}
            </div>

            {/* Legend */}
            <div className="flex flex-wrap gap-4 mt-3">
                {data.datasets.map((dataset, i) => (
                    <div key={i} className="flex items-center gap-2">
                        <div
                            className="w-3 h-3 rounded"
                            style={{ backgroundColor: typeof dataset.backgroundColor === 'string' ? dataset.backgroundColor : theme.colors.primary }}
                        />
                        <span className="text-sm" style={{ color: theme.colors.mutedForeground }}>
                            {dataset.label}
                        </span>
                    </div>
                ))}
            </div>
        </div>
    );
}
