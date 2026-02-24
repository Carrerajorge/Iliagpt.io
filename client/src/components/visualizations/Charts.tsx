/**
 * Charts - Placeholder Component
 * TODO: Integrate Recharts or similar charting library
 */
import { BarChart3 } from 'lucide-react';

interface ChartsProps {
    data?: any[];
    type?: 'bar' | 'line' | 'pie';
    title?: string;
}

export default function Charts({ data, type = 'bar', title = 'Chart' }: ChartsProps) {
    return (
        <div className="w-full h-64 border rounded-lg bg-card overflow-hidden">
            <div className="flex items-center gap-2 p-3 border-b bg-muted/50">
                <BarChart3 className="w-4 h-4" />
                <span className="text-sm font-medium">{title}</span>
                <span className="text-xs text-muted-foreground capitalize">({type})</span>
            </div>
            <div className="flex items-center justify-center h-48 text-muted-foreground">
                <div className="text-center">
                    <BarChart3 className="w-12 h-12 mx-auto mb-2 opacity-50" />
                    <p className="text-sm">
                        {data && data.length > 0
                            ? `${data.length} data points loaded`
                            : 'No data to display'}
                    </p>
                </div>
            </div>
        </div>
    );
}
