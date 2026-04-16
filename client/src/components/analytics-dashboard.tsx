/**
 * Analytics Dashboard - ILIAGPT PRO 3.0
 * 
 * Usage metrics and performance analytics.
 */

import { memo, useMemo } from "react";
import { motion } from "framer-motion";
import {
    BarChart3,
    Clock,
    Zap,
    MessageSquare,
    TrendingUp,
    TrendingDown,
    DollarSign,
    Activity
} from "lucide-react";
import { cn } from "@/lib/utils";

// ============== Types ==============

export interface AnalyticsData {
    totalMessages: number;
    totalTokens: number;
    averageResponseTime: number; // ms
    successRate: number; // 0-1
    costEstimate: number; // USD
    messagesPerDay: number[];
    topModels: { name: string; count: number }[];
    errorRate: number;
}

interface MetricCardProps {
    title: string;
    value: string | number;
    change?: number;
    icon: React.ReactNode;
    color?: string;
}

interface AnalyticsDashboardProps {
    data: AnalyticsData;
    className?: string;
}

// ============== Components ==============

function MetricCard({ title, value, change, icon, color = "blue" }: MetricCardProps) {
    const colorClasses: Record<string, string> = {
        blue: "from-blue-500/20 to-blue-600/10 text-blue-600",
        green: "from-green-500/20 to-green-600/10 text-green-600",
        purple: "from-purple-500/20 to-purple-600/10 text-purple-600",
        orange: "from-orange-500/20 to-orange-600/10 text-orange-600",
    };

    return (
        <motion.div
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            className={cn(
                "relative p-4 rounded-xl border bg-gradient-to-br",
                colorClasses[color]
            )}
        >
            <div className="flex items-start justify-between">
                <div>
                    <p className="text-sm text-muted-foreground">{title}</p>
                    <p className="text-2xl font-bold mt-1">{value}</p>
                    {change !== undefined && (
                        <div className="flex items-center gap-1 mt-1">
                            {change >= 0 ? (
                                <TrendingUp className="w-3 h-3 text-green-500" />
                            ) : (
                                <TrendingDown className="w-3 h-3 text-red-500" />
                            )}
                            <span className={cn(
                                "text-xs",
                                change >= 0 ? "text-green-500" : "text-red-500"
                            )}>
                                {change >= 0 ? "+" : ""}{change}%
                            </span>
                        </div>
                    )}
                </div>
                <div className="p-2 rounded-lg bg-background/50">
                    {icon}
                </div>
            </div>
        </motion.div>
    );
}

function MiniChart({ data, height = 40 }: { data: number[]; height?: number }) {
    const max = Math.max(...data, 1);
    const normalized = data.map(d => (d / max) * height);

    return (
        <div className="flex items-end gap-0.5 h-10">
            {normalized.map((h, i) => (
                <motion.div
                    key={i}
                    initial={{ height: 0 }}
                    animate={{ height: h }}
                    transition={{ delay: i * 0.05 }}
                    className="flex-1 bg-primary/60 rounded-t-sm min-w-[4px]"
                />
            ))}
        </div>
    );
}

export const AnalyticsDashboard = memo(function AnalyticsDashboard({
    data,
    className,
}: AnalyticsDashboardProps) {
    const formattedCost = useMemo(() =>
        `$${data.costEstimate.toFixed(2)}`,
        [data.costEstimate]
    );

    const formattedTime = useMemo(() =>
        `${(data.averageResponseTime / 1000).toFixed(1)}s`,
        [data.averageResponseTime]
    );

    const formattedSuccessRate = useMemo(() =>
        `${(data.successRate * 100).toFixed(1)}%`,
        [data.successRate]
    );

    return (
        <div className={cn("space-y-4", className)}>
            <div className="flex items-center gap-2 mb-4">
                <BarChart3 className="w-5 h-5 text-primary" />
                <h2 className="text-lg font-semibold">Analíticas</h2>
            </div>

            {/* Metric Cards */}
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                <MetricCard
                    title="Mensajes totales"
                    value={data.totalMessages.toLocaleString()}
                    icon={<MessageSquare className="w-4 h-4" />}
                    color="blue"
                />
                <MetricCard
                    title="Tiempo promedio"
                    value={formattedTime}
                    icon={<Clock className="w-4 h-4" />}
                    color="purple"
                />
                <MetricCard
                    title="Tasa de éxito"
                    value={formattedSuccessRate}
                    icon={<Zap className="w-4 h-4" />}
                    color="green"
                />
                <MetricCard
                    title="Costo estimado"
                    value={formattedCost}
                    icon={<DollarSign className="w-4 h-4" />}
                    color="orange"
                />
            </div>

            {/* Activity Chart */}
            <div className="p-4 rounded-xl border bg-card">
                <div className="flex items-center justify-between mb-3">
                    <span className="text-sm font-medium">Actividad (últimos 7 días)</span>
                    <Activity className="w-4 h-4 text-muted-foreground" />
                </div>
                <MiniChart data={data.messagesPerDay} />
            </div>

            {/* Top Models */}
            <div className="p-4 rounded-xl border bg-card">
                <span className="text-sm font-medium">Modelos más usados</span>
                <div className="mt-3 space-y-2">
                    {data.topModels.slice(0, 3).map((model, i) => (
                        <div key={model.name} className="flex items-center gap-2">
                            <div
                                className="w-2 h-2 rounded-full"
                                style={{
                                    backgroundColor: ["#3b82f6", "#8b5cf6", "#10b981"][i]
                                }}
                            />
                            <span className="flex-1 text-sm truncate">{model.name}</span>
                            <span className="text-xs text-muted-foreground">{model.count}</span>
                        </div>
                    ))}
                </div>
            </div>
        </div>
    );
});

export default AnalyticsDashboard;
