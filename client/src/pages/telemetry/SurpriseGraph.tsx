import React, { useMemo } from 'react';
import ReactECharts from 'echarts-for-react';

interface SurpriseGraphProps {
    data: { timestamp: number; surprise_before: number; surprise_after: number }[];
}

export const SurpriseGraph: React.FC<SurpriseGraphProps> = ({ data }) => {
    const options = useMemo(() => {
        return {
            title: {
                text: 'Agent Free Energy (Surprise) Over Time',
                textStyle: { color: '#e5e7eb', fontSize: 16 }
            },
            tooltip: {
                trigger: 'axis'
            },
            legend: {
                data: ['Surprise Before Action', 'Surprise After Action'],
                textStyle: { color: '#9ca3af' },
                top: 25
            },
            grid: {
                left: '3%',
                right: '4%',
                bottom: '3%',
                containLabel: true
            },
            xAxis: {
                type: 'time',
                boundaryGap: false,
                axisLabel: { color: '#9ca3af' }
            },
            yAxis: {
                type: 'value',
                axisLabel: { color: '#9ca3af' },
                splitLine: { lineStyle: { color: '#374151' } }
            },
            series: [
                {
                    name: 'Surprise Before Action',
                    type: 'line',
                    data: data.map(item => [item.timestamp, item.surprise_before]),
                    itemStyle: { color: '#ef4444' }, // Red
                    areaStyle: { color: 'rgba(239, 68, 68, 0.2)' }
                },
                {
                    name: 'Surprise After Action',
                    type: 'line',
                    data: data.map(item => [item.timestamp, item.surprise_after]),
                    itemStyle: { color: '#10b981' }, // Green
                    areaStyle: { color: 'rgba(16, 185, 129, 0.2)' }
                }
            ]
        };
    }, [data]);

    return (
        <div className="bg-gray-800 p-4 rounded-xl shadow-lg border border-gray-700">
            <ReactECharts option={options} style={{ height: '350px', width: '100%' }} />
        </div>
    );
};
