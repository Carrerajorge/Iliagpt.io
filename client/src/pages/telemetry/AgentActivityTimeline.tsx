import React from 'react';
import ReactECharts from 'echarts-for-react';

interface AgentActivityTimelineProps {
    actions: { timestamp: number; action_type: string; success: boolean; duration_ms: number }[];
}

export const AgentActivityTimeline: React.FC<AgentActivityTimelineProps> = ({ actions }) => {
    const options = {
        title: {
            text: 'Agent Actions Timeline',
            textStyle: { color: '#e5e7eb', fontSize: 16 }
        },
        tooltip: {
            formatter: function (params: any) {
                return `${params.name}<br/>Duration: ${params.value[2]}ms<br/>Status: ${params.data.success ? 'Success' : 'Failed'}`;
            }
        },
        grid: {
            left: '3%',
            right: '4%',
            bottom: '10%',
            containLabel: true
        },
        xAxis: {
            type: 'time',
            axisLabel: { color: '#9ca3af' }
        },
        yAxis: {
            type: 'category',
            data: ['Agent Executions'],
            axisLabel: { color: '#9ca3af' },
            splitLine: { show: false }
        },
        series: [
            {
                type: 'scatter',
                symbolSize: function (data: any) {
                    return Math.min(Math.max(data[2] / 100, 10), 30); // Size based on duration
                },
                itemStyle: {
                    color: function (params: any) {
                        return params.data.success ? '#3b82f6' : '#ef4444'; // Blue for success, Red for failure
                    }
                },
                data: actions.map(a => {
                    return {
                        name: a.action_type,
                        value: [a.timestamp, 'Agent Executions', a.duration_ms],
                        success: a.success
                    };
                })
            }
        ]
    };

    return (
        <div className="bg-gray-800 p-4 rounded-xl shadow-lg border border-gray-700">
            <ReactECharts option={options} style={{ height: '250px', width: '100%' }} />
        </div>
    );
};
