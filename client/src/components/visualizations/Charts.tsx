import { useMemo } from 'react';
import { BarChart3 } from 'lucide-react';
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Line,
  LineChart,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';

const DEFAULT_COLORS = ['#3b82f6', '#10b981', '#f59e0b', '#ef4444', '#8b5cf6', '#ec4899'];

interface ChartsProps {
  data?: Record<string, unknown>[];
  type?: 'bar' | 'line' | 'pie';
  title?: string;
}

type NormalizedRow = { name: string; value: number };

function normalizeRows(data: Record<string, unknown>[] | undefined): NormalizedRow[] {
  if (!data?.length) return [];
  const first = data[0];
  const keys = Object.keys(first);
  const nameKey = keys.find((k) => /^(name|label|category|x)$/i.test(k)) ?? keys[0];
  const valueKey =
    keys.find((k) => /^(value|count|y|amount|total|v)$/i.test(k) && k !== nameKey) ?? keys[1];
  if (valueKey == null) return [];
  return data.map((row, i) => {
    const rawName = row[nameKey];
    const rawVal = row[valueKey];
    const name =
      typeof rawName === 'string' || typeof rawName === 'number'
        ? String(rawName)
        : `Item ${i + 1}`;
    const value = typeof rawVal === 'number' ? rawVal : Number(rawVal);
    return { name, value: Number.isFinite(value) ? value : 0 };
  });
}

export default function Charts({ data, type = 'bar', title = 'Chart' }: ChartsProps) {
  const rows = useMemo(() => normalizeRows(data), [data]);

  return (
    <div className="w-full h-64 border rounded-lg bg-card overflow-hidden">
      <div className="flex items-center gap-2 p-3 border-b bg-muted/50">
        <BarChart3 className="w-4 h-4" />
        <span className="text-sm font-medium">{title}</span>
        <span className="text-xs text-muted-foreground capitalize">({type})</span>
      </div>
      <div className="h-[calc(100%-3rem)] p-2">
        {rows.length === 0 ? (
          <div className="flex items-center justify-center h-full text-muted-foreground">
            <div className="text-center text-sm">No data to display</div>
          </div>
        ) : (
          <ResponsiveContainer width="100%" height="100%">
            {type === 'line' ? (
              <LineChart data={rows} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" className="stroke-border/50" />
                <XAxis dataKey="name" tick={{ fontSize: 11 }} />
                <YAxis tick={{ fontSize: 11 }} width={40} />
                <Tooltip />
                <Line type="monotone" dataKey="value" stroke="#3b82f6" strokeWidth={2} dot={false} />
              </LineChart>
            ) : type === 'pie' ? (
              <PieChart>
                <Tooltip />
                <Pie data={rows} dataKey="value" nameKey="name" cx="50%" cy="50%" outerRadius={72} label>
                  {rows.map((_, i) => (
                    <Cell key={`cell-${i}`} fill={DEFAULT_COLORS[i % DEFAULT_COLORS.length]} />
                  ))}
                </Pie>
              </PieChart>
            ) : (
              <BarChart data={rows} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" className="stroke-border/50" />
                <XAxis dataKey="name" tick={{ fontSize: 11 }} />
                <YAxis tick={{ fontSize: 11 }} width={40} />
                <Tooltip />
                <Bar dataKey="value" radius={[4, 4, 0, 0]}>
                  {rows.map((_, i) => (
                    <Cell key={`bar-${i}`} fill={DEFAULT_COLORS[i % DEFAULT_COLORS.length]} />
                  ))}
                </Bar>
              </BarChart>
            )}
          </ResponsiveContainer>
        )}
      </div>
    </div>
  );
}
