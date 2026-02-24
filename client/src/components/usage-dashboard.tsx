/**
 * Usage Dashboard Component - ILIAGPT PRO 3.0
 *
 * Analytics dashboard for usage metrics.
 * Charts, trends, and insights.
 */

import React, { useState, useMemo } from "react";

// ============== Types ==============

interface UsageMetrics {
    period: string;
    messages: number;
    tokens: { input: number; output: number };
    cost: number;
    responseTime: number;
    models: Record<string, number>;
}

interface DailyUsage {
    date: string;
    messages: number;
    tokens: number;
    cost: number;
}

// ============== Mock Data ==============

const MOCK_DAILY_USAGE: DailyUsage[] = Array.from({ length: 30 }, (_, i) => {
    const date = new Date();
    date.setDate(date.getDate() - (29 - i));
    return {
        date: date.toISOString().split("T")[0],
        messages: Math.floor(Math.random() * 100) + 20,
        tokens: Math.floor(Math.random() * 50000) + 10000,
        cost: Math.random() * 2 + 0.5,
    };
});

const MOCK_TOTALS: UsageMetrics = {
    period: "Last 30 days",
    messages: 2547,
    tokens: { input: 1245000, output: 892000 },
    cost: 45.67,
    responseTime: 1240,
    models: {
        "grok-3": 1200,
        "grok-3-fast": 850,
        "gemini-2.5-flash": 497,
    },
};

// ============== Component ==============

export function UsageDashboard() {
    const [period, setPeriod] = useState<"7d" | "30d" | "90d">("30d");
    const [activeMetric, setActiveMetric] = useState<"messages" | "tokens" | "cost">("messages");

    const maxValue = useMemo(() => {
        return Math.max(...MOCK_DAILY_USAGE.map(d => d[activeMetric] as number));
    }, [activeMetric]);

    const formatNumber = (n: number): string => {
        if (n >= 1000000) return `${(n / 1000000).toFixed(1)}M`;
        if (n >= 1000) return `${(n / 1000).toFixed(1)}K`;
        return n.toFixed(n < 10 ? 2 : 0);
    };

    return (
        <div className="h-full overflow-auto bg-gray-900 text-white p-6">
            {/* Header */}
            <div className="flex items-center justify-between mb-6">
                <h1 className="text-2xl font-bold">📊 Usage Dashboard</h1>
                <div className="flex gap-2">
                    {(["7d", "30d", "90d"] as const).map(p => (
                        <button
                            key={p}
                            className={`px-4 py-2 rounded ${period === p ? "bg-blue-600" : "bg-gray-800 hover:bg-gray-700"}`}
                            onClick={() => setPeriod(p)}
                        >
                            {p === "7d" ? "7 Days" : p === "30d" ? "30 Days" : "90 Days"}
                        </button>
                    ))}
                </div>
            </div>

            {/* Stats Cards */}
            <div className="grid grid-cols-4 gap-4 mb-6">
                <StatCard
                    label="Total Messages"
                    value={formatNumber(MOCK_TOTALS.messages)}
                    change={+12.5}
                    icon="💬"
                />
                <StatCard
                    label="Total Tokens"
                    value={formatNumber(MOCK_TOTALS.tokens.input + MOCK_TOTALS.tokens.output)}
                    change={+8.3}
                    icon="🔤"
                />
                <StatCard
                    label="Total Cost"
                    value={`$${MOCK_TOTALS.cost.toFixed(2)}`}
                    change={-5.2}
                    icon="💰"
                />
                <StatCard
                    label="Avg Response Time"
                    value={`${MOCK_TOTALS.responseTime}ms`}
                    change={-15.0}
                    icon="⚡"
                />
            </div>

            {/* Chart */}
            <div className="bg-gray-800 rounded-lg p-4 mb-6">
                <div className="flex items-center justify-between mb-4">
                    <h2 className="text-lg font-medium">Usage Over Time</h2>
                    <div className="flex gap-2">
                        {(["messages", "tokens", "cost"] as const).map(m => (
                            <button
                                key={m}
                                className={`px-3 py-1 rounded text-sm capitalize ${activeMetric === m ? "bg-blue-600" : "bg-gray-700 hover:bg-gray-600"
                                    }`}
                                onClick={() => setActiveMetric(m)}
                            >
                                {m}
                            </button>
                        ))}
                    </div>
                </div>

                {/* Bar Chart */}
                <div className="h-48 flex items-end gap-1">
                    {MOCK_DAILY_USAGE.map((day, i) => {
                        const value = day[activeMetric] as number;
                        const height = (value / maxValue) * 100;
                        return (
                            <div
                                key={i}
                                className="flex-1 group relative"
                            >
                                <div
                                    className="bg-blue-500 hover:bg-blue-400 rounded-t transition-all"
                                    style={{ height: `${height}%` }}
                                />
                                <div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-2 hidden group-hover:block bg-gray-700 px-2 py-1 rounded text-xs whitespace-nowrap z-10">
                                    {day.date}: {activeMetric === "cost" ? `$${value.toFixed(2)}` : formatNumber(value)}
                                </div>
                            </div>
                        );
                    })}
                </div>
                <div className="flex justify-between mt-2 text-xs text-gray-500">
                    <span>{MOCK_DAILY_USAGE[0].date}</span>
                    <span>{MOCK_DAILY_USAGE[MOCK_DAILY_USAGE.length - 1].date}</span>
                </div>
            </div>

            {/* Model Usage & Breakdown */}
            <div className="grid grid-cols-2 gap-6">
                {/* Model Distribution */}
                <div className="bg-gray-800 rounded-lg p-4">
                    <h2 className="text-lg font-medium mb-4">Model Usage</h2>
                    <div className="space-y-3">
                        {Object.entries(MOCK_TOTALS.models).map(([model, count]) => {
                            const percentage = (count / MOCK_TOTALS.messages) * 100;
                            return (
                                <div key={model}>
                                    <div className="flex justify-between text-sm mb-1">
                                        <span>{model}</span>
                                        <span className="text-gray-400">{count} ({percentage.toFixed(1)}%)</span>
                                    </div>
                                    <div className="h-2 bg-gray-700 rounded-full overflow-hidden">
                                        <div
                                            className="h-full bg-gradient-to-r from-blue-500 to-purple-500"
                                            style={{ width: `${percentage}%` }}
                                        />
                                    </div>
                                </div>
                            );
                        })}
                    </div>
                </div>

                {/* Token Breakdown */}
                <div className="bg-gray-800 rounded-lg p-4">
                    <h2 className="text-lg font-medium mb-4">Token Breakdown</h2>
                    <div className="flex items-center justify-center h-40">
                        <div className="relative w-32 h-32">
                            <svg viewBox="0 0 100 100" className="w-full h-full -rotate-90">
                                <circle
                                    cx="50" cy="50" r="40"
                                    fill="none" stroke="#374151" strokeWidth="12"
                                />
                                <circle
                                    cx="50" cy="50" r="40"
                                    fill="none" stroke="#3b82f6" strokeWidth="12"
                                    strokeDasharray={`${(MOCK_TOTALS.tokens.input / (MOCK_TOTALS.tokens.input + MOCK_TOTALS.tokens.output)) * 251.3} 251.3`}
                                />
                            </svg>
                            <div className="absolute inset-0 flex items-center justify-center flex-col">
                                <span className="text-2xl font-bold">
                                    {formatNumber(MOCK_TOTALS.tokens.input + MOCK_TOTALS.tokens.output)}
                                </span>
                                <span className="text-xs text-gray-400">Total</span>
                            </div>
                        </div>
                        <div className="ml-6 space-y-2">
                            <div className="flex items-center gap-2">
                                <div className="w-3 h-3 rounded bg-blue-500" />
                                <span className="text-sm">Input: {formatNumber(MOCK_TOTALS.tokens.input)}</span>
                            </div>
                            <div className="flex items-center gap-2">
                                <div className="w-3 h-3 rounded bg-gray-600" />
                                <span className="text-sm">Output: {formatNumber(MOCK_TOTALS.tokens.output)}</span>
                            </div>
                        </div>
                    </div>
                </div>
            </div>
        </div>
    );
}

// ======== Sub-components ========

interface StatCardProps {
    label: string;
    value: string;
    change: number;
    icon: string;
}

function StatCard({ label, value, change, icon }: StatCardProps) {
    const isPositive = change >= 0;

    return (
        <div className="bg-gray-800 rounded-lg p-4">
            <div className="flex items-center justify-between mb-2">
                <span className="text-2xl">{icon}</span>
                <span className={`text-sm ${isPositive ? "text-green-400" : "text-red-400"}`}>
                    {isPositive ? "↑" : "↓"} {Math.abs(change)}%
                </span>
            </div>
            <div className="text-2xl font-bold">{value}</div>
            <div className="text-sm text-gray-400">{label}</div>
        </div>
    );
}

export default UsageDashboard;
