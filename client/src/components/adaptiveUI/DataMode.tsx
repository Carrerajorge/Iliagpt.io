/**
 * DataMode.tsx
 * Split-pane layout with chat and a data visualization area.
 * Uses pure SVG/CSS charts — no chart library imports.
 */

import React, { useState, useMemo } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  BarChart2,
  LineChart,
  PieChart,
  Table2,
  Download,
  FileText,
  Image,
} from 'lucide-react';

// ─── Types ────────────────────────────────────────────────────────────────────

interface DataModeProps {
  chatId: string;
  children: React.ReactNode;
}

type ChartType = 'bar' | 'line' | 'pie' | 'table';

interface DataPoint {
  label: string;
  value: number;
  color: string;
}

// ─── Demo data ────────────────────────────────────────────────────────────────

const DEMO_DATA: DataPoint[] = [
  { label: 'Jan', value: 42, color: '#3b82f6' },
  { label: 'Feb', value: 67, color: '#8b5cf6' },
  { label: 'Mar', value: 55, color: '#06b6d4' },
  { label: 'Apr', value: 89, color: '#10b981' },
  { label: 'May', value: 73, color: '#f59e0b' },
  { label: 'Jun', value: 95, color: '#ef4444' },
  { label: 'Jul', value: 61, color: '#ec4899' },
];

// ─── Bar Chart ────────────────────────────────────────────────────────────────

function BarChartSVG({ data }: { data: DataPoint[] }) {
  const maxValue = Math.max(...data.map((d) => d.value));
  const svgWidth = 560;
  const svgHeight = 200;
  const padding = { top: 20, right: 20, bottom: 36, left: 40 };
  const chartWidth = svgWidth - padding.left - padding.right;
  const chartHeight = svgHeight - padding.top - padding.bottom;

  const barWidth = (chartWidth / data.length) * 0.6;
  const barGap = (chartWidth / data.length) * 0.4;

  const yTicks = [0, 25, 50, 75, 100];

  return (
    <svg
      viewBox={`0 0 ${svgWidth} ${svgHeight}`}
      className="w-full"
      style={{ maxHeight: 220 }}
      role="img"
      aria-label="Bar chart"
    >
      {/* Y-axis grid lines and labels */}
      {yTicks.map((tick) => {
        const y = padding.top + chartHeight - (tick / maxValue) * chartHeight;
        return (
          <g key={tick}>
            <line
              x1={padding.left}
              y1={y}
              x2={padding.left + chartWidth}
              y2={y}
              stroke="rgba(255,255,255,0.06)"
              strokeWidth={1}
            />
            <text
              x={padding.left - 6}
              y={y + 4}
              textAnchor="end"
              fontSize={9}
              fill="rgba(255,255,255,0.3)"
            >
              {tick}
            </text>
          </g>
        );
      })}

      {/* Bars */}
      {data.map((d, i) => {
        const barHeight = (d.value / maxValue) * chartHeight;
        const x = padding.left + i * (chartWidth / data.length) + barGap / 2;
        const y = padding.top + chartHeight - barHeight;

        return (
          <g key={d.label}>
            <motion.rect
              x={x}
              width={barWidth}
              y={svgHeight - padding.bottom}
              height={0}
              rx={3}
              fill={d.color}
              opacity={0.85}
              animate={{
                y,
                height: barHeight,
              }}
              transition={{
                duration: 0.6,
                delay: i * 0.07,
                ease: [0.16, 1, 0.3, 1],
              }}
            />
            {/* Value label */}
            <motion.text
              x={x + barWidth / 2}
              y={y - 4}
              textAnchor="middle"
              fontSize={9}
              fill="rgba(255,255,255,0.6)"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ delay: i * 0.07 + 0.4 }}
            >
              {d.value}
            </motion.text>
            {/* X-axis label */}
            <text
              x={x + barWidth / 2}
              y={svgHeight - padding.bottom + 14}
              textAnchor="middle"
              fontSize={10}
              fill="rgba(255,255,255,0.4)"
            >
              {d.label}
            </text>
          </g>
        );
      })}

      {/* Y axis line */}
      <line
        x1={padding.left}
        y1={padding.top}
        x2={padding.left}
        y2={padding.top + chartHeight}
        stroke="rgba(255,255,255,0.1)"
        strokeWidth={1}
      />
    </svg>
  );
}

// ─── Line Chart ───────────────────────────────────────────────────────────────

function LineChartSVG({ data }: { data: DataPoint[] }) {
  const maxValue = Math.max(...data.map((d) => d.value));
  const svgWidth = 560;
  const svgHeight = 200;
  const padding = { top: 20, right: 20, bottom: 36, left: 40 };
  const chartWidth = svgWidth - padding.left - padding.right;
  const chartHeight = svgHeight - padding.top - padding.bottom;

  const points = data.map((d, i) => {
    const x = padding.left + (i / (data.length - 1)) * chartWidth;
    const y = padding.top + chartHeight - (d.value / maxValue) * chartHeight;
    return { x, y, ...d };
  });

  const pathD = points
    .map((p, i) => `${i === 0 ? 'M' : 'L'} ${p.x} ${p.y}`)
    .join(' ');

  const areaD =
    pathD + ` L ${points[points.length - 1].x} ${padding.top + chartHeight} L ${points[0].x} ${padding.top + chartHeight} Z`;

  const yTicks = [0, 25, 50, 75, 100];

  return (
    <svg viewBox={`0 0 ${svgWidth} ${svgHeight}`} className="w-full" style={{ maxHeight: 220 }} role="img" aria-label="Line chart">
      <defs>
        <linearGradient id="lineArea" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#3b82f6" stopOpacity={0.3} />
          <stop offset="100%" stopColor="#3b82f6" stopOpacity={0} />
        </linearGradient>
      </defs>

      {yTicks.map((tick) => {
        const y = padding.top + chartHeight - (tick / maxValue) * chartHeight;
        return (
          <g key={tick}>
            <line x1={padding.left} y1={y} x2={padding.left + chartWidth} y2={y} stroke="rgba(255,255,255,0.06)" strokeWidth={1} />
            <text x={padding.left - 6} y={y + 4} textAnchor="end" fontSize={9} fill="rgba(255,255,255,0.3)">{tick}</text>
          </g>
        );
      })}

      {/* Area fill */}
      <motion.path
        d={areaD}
        fill="url(#lineArea)"
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ duration: 0.8 }}
      />

      {/* Line */}
      <motion.path
        d={pathD}
        fill="none"
        stroke="#3b82f6"
        strokeWidth={2}
        strokeLinecap="round"
        strokeLinejoin="round"
        initial={{ pathLength: 0, opacity: 0 }}
        animate={{ pathLength: 1, opacity: 1 }}
        transition={{ duration: 1, ease: 'easeInOut' }}
      />

      {/* Dots */}
      {points.map((p, i) => (
        <motion.circle
          key={p.label}
          cx={p.x}
          cy={p.y}
          r={4}
          fill="#3b82f6"
          stroke="#0f0f0f"
          strokeWidth={2}
          initial={{ scale: 0, opacity: 0 }}
          animate={{ scale: 1, opacity: 1 }}
          transition={{ delay: 0.6 + i * 0.06, duration: 0.2 }}
        />
      ))}

      {/* X labels */}
      {points.map((p) => (
        <text key={p.label} x={p.x} y={svgHeight - padding.bottom + 14} textAnchor="middle" fontSize={10} fill="rgba(255,255,255,0.4)">
          {p.label}
        </text>
      ))}
    </svg>
  );
}

// ─── Pie Chart ────────────────────────────────────────────────────────────────

function PieChartSVG({ data }: { data: DataPoint[] }) {
  const total = data.reduce((s, d) => s + d.value, 0);
  const cx = 110;
  const cy = 100;
  const r = 80;

  let cumAngle = -Math.PI / 2;

  const slices = data.map((d) => {
    const fraction = d.value / total;
    const startAngle = cumAngle;
    const endAngle = cumAngle + fraction * 2 * Math.PI;
    cumAngle = endAngle;

    const x1 = cx + r * Math.cos(startAngle);
    const y1 = cy + r * Math.sin(startAngle);
    const x2 = cx + r * Math.cos(endAngle);
    const y2 = cy + r * Math.sin(endAngle);
    const largeArc = fraction > 0.5 ? 1 : 0;

    const midAngle = (startAngle + endAngle) / 2;
    const labelR = r * 0.65;
    const lx = cx + labelR * Math.cos(midAngle);
    const ly = cy + labelR * Math.sin(midAngle);

    const pathD = fraction > 0.999
      ? `M ${cx} ${cy} m ${-r} 0 a ${r} ${r} 0 1 1 ${2 * r} 0 a ${r} ${r} 0 1 1 ${-2 * r} 0`
      : `M ${cx} ${cy} L ${x1} ${y1} A ${r} ${r} 0 ${largeArc} 1 ${x2} ${y2} Z`;

    return { ...d, pathD, lx, ly, fraction, midAngle };
  });

  return (
    <svg viewBox="0 0 360 200" className="w-full" style={{ maxHeight: 220 }} role="img" aria-label="Pie chart">
      {slices.map((s, i) => (
        <g key={s.label}>
          <motion.path
            d={s.pathD}
            fill={s.color}
            opacity={0.85}
            initial={{ scale: 0, transformOrigin: `${cx}px ${cy}px` }}
            animate={{ scale: 1 }}
            transition={{ delay: i * 0.08, duration: 0.4, ease: 'easeOut' }}
          />
          {s.fraction > 0.08 && (
            <motion.text
              x={s.lx}
              y={s.ly}
              textAnchor="middle"
              dominantBaseline="middle"
              fontSize={9}
              fill="rgba(255,255,255,0.9)"
              fontWeight="600"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ delay: i * 0.08 + 0.3 }}
            >
              {Math.round(s.fraction * 100)}%
            </motion.text>
          )}
        </g>
      ))}

      {/* Legend */}
      {slices.map((s, i) => (
        <g key={`legend-${s.label}`} transform={`translate(240, ${20 + i * 22})`}>
          <rect x={0} y={-7} width={10} height={10} rx={2} fill={s.color} />
          <text x={15} y={2} fontSize={11} fill="rgba(255,255,255,0.7)">{s.label}: {s.value}</text>
        </g>
      ))}
    </svg>
  );
}

// ─── Data Table ───────────────────────────────────────────────────────────────

function DataTable({ data }: { data: DataPoint[] }) {
  const total = data.reduce((s, d) => s + d.value, 0);
  const max = Math.max(...data.map((d) => d.value));

  return (
    <div className="overflow-auto">
      <table className="w-full text-xs">
        <thead>
          <tr className="border-b border-white/8">
            <th className="text-left px-4 py-2.5 text-white/40 font-medium">Label</th>
            <th className="text-right px-4 py-2.5 text-white/40 font-medium">Value</th>
            <th className="text-right px-4 py-2.5 text-white/40 font-medium">% of Total</th>
            <th className="px-4 py-2.5 text-white/40 font-medium">Distribution</th>
          </tr>
        </thead>
        <tbody>
          {data.map((d, i) => (
            <motion.tr
              key={d.label}
              initial={{ opacity: 0, x: -8 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ delay: i * 0.05 }}
              className="border-b border-white/5 hover:bg-white/3 transition-colors"
            >
              <td className="px-4 py-2.5">
                <div className="flex items-center gap-2">
                  <div className="w-2.5 h-2.5 rounded-sm flex-shrink-0" style={{ backgroundColor: d.color }} />
                  <span className="text-white/80">{d.label}</span>
                </div>
              </td>
              <td className="px-4 py-2.5 text-right text-white/70 font-mono">{d.value}</td>
              <td className="px-4 py-2.5 text-right text-white/50 font-mono">
                {((d.value / total) * 100).toFixed(1)}%
              </td>
              <td className="px-4 py-2.5">
                <div className="h-1.5 bg-white/5 rounded-full overflow-hidden w-24">
                  <motion.div
                    className="h-full rounded-full"
                    style={{ backgroundColor: d.color }}
                    initial={{ width: 0 }}
                    animate={{ width: `${(d.value / max) * 100}%` }}
                    transition={{ delay: i * 0.05 + 0.2, duration: 0.5 }}
                  />
                </div>
              </td>
            </motion.tr>
          ))}
        </tbody>
        <tfoot>
          <tr className="border-t border-white/8">
            <td className="px-4 py-2 text-white/40 text-xs font-medium">Total</td>
            <td className="px-4 py-2 text-right text-white/60 font-mono text-xs">{total}</td>
            <td className="px-4 py-2 text-right text-white/40 text-xs">100%</td>
            <td />
          </tr>
        </tfoot>
      </table>
    </div>
  );
}

// ─── Chart Type Selector ──────────────────────────────────────────────────────

interface ChartTypeSelectorProps {
  active: ChartType;
  onChange: (type: ChartType) => void;
}

function ChartTypeSelector({ active, onChange }: ChartTypeSelectorProps) {
  const types: { type: ChartType; icon: React.ReactNode; label: string }[] = [
    { type: 'bar', icon: <BarChart2 className="w-3.5 h-3.5" />, label: 'Bar' },
    { type: 'line', icon: <LineChart className="w-3.5 h-3.5" />, label: 'Line' },
    { type: 'pie', icon: <PieChart className="w-3.5 h-3.5" />, label: 'Pie' },
    { type: 'table', icon: <Table2 className="w-3.5 h-3.5" />, label: 'Table' },
  ];

  return (
    <div className="flex items-center gap-0.5 rounded-lg bg-white/5 p-0.5">
      {types.map((t) => (
        <button
          key={t.type}
          onClick={() => onChange(t.type)}
          className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium transition-all ${
            active === t.type
              ? 'bg-white/15 text-white shadow-sm'
              : 'text-white/40 hover:text-white/70'
          }`}
          aria-pressed={active === t.type}
        >
          {t.icon}
          {t.label}
        </button>
      ))}
    </div>
  );
}

// ─── Main Component ───────────────────────────────────────────────────────────

export default function DataMode({ chatId: _chatId, children }: DataModeProps) {
  const [chartType, setChartType] = useState<ChartType>('bar');
  const total = useMemo(() => DEMO_DATA.reduce((s, d) => s + d.value, 0), []);
  const avg = useMemo(() => Math.round(total / DEMO_DATA.length), [total]);
  const max = useMemo(() => Math.max(...DEMO_DATA.map((d) => d.value)), []);

  const renderChart = () => {
    switch (chartType) {
      case 'bar': return <BarChartSVG data={DEMO_DATA} />;
      case 'line': return <LineChartSVG data={DEMO_DATA} />;
      case 'pie': return <PieChartSVG data={DEMO_DATA} />;
      case 'table': return <DataTable data={DEMO_DATA} />;
    }
  };

  return (
    <div className="flex h-full overflow-hidden">
      {/* Chat panel — 35% */}
      <div
        className="flex flex-col overflow-hidden flex-shrink-0 border-r border-white/8"
        style={{ width: '35%' }}
      >
        {children}
      </div>

      {/* Visualization panel — 65% */}
      <motion.div
        className="flex-1 flex flex-col overflow-hidden bg-[#0d0d0d]"
        initial={{ opacity: 0, x: 24 }}
        animate={{ opacity: 1, x: 0 }}
        transition={{ duration: 0.35, ease: [0.16, 1, 0.3, 1] }}
      >
        {/* Toolbar */}
        <div className="flex items-center gap-3 px-4 py-2.5 border-b border-white/8 flex-shrink-0">
          <BarChart2 className="w-4 h-4 text-cyan-400" />
          <span className="text-xs font-medium text-white/60">Data Visualization</span>
          <div className="flex-1" />
          <ChartTypeSelector active={chartType} onChange={setChartType} />
          <div className="w-px h-4 bg-white/10" />
          {/* Export buttons */}
          <button className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-md text-xs text-white/50 hover:text-white/80 hover:bg-white/8 border border-white/10 hover:border-white/20 transition-all">
            <FileText className="w-3 h-3" />
            CSV
          </button>
          <button className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-md text-xs text-white/50 hover:text-white/80 hover:bg-white/8 border border-white/10 hover:border-white/20 transition-all">
            <Image className="w-3 h-3" />
            PNG
          </button>
        </div>

        {/* Stats row */}
        <div className="flex gap-4 px-6 py-3 border-b border-white/5 flex-shrink-0">
          {[
            { label: 'Total', value: total, color: 'text-blue-400' },
            { label: 'Average', value: avg, color: 'text-purple-400' },
            { label: 'Max', value: max, color: 'text-emerald-400' },
            { label: 'Samples', value: DEMO_DATA.length, color: 'text-amber-400' },
          ].map((stat) => (
            <div key={stat.label} className="flex flex-col">
              <span className="text-[10px] text-white/30 uppercase tracking-wide">{stat.label}</span>
              <span className={`text-lg font-semibold font-mono ${stat.color}`}>{stat.value}</span>
            </div>
          ))}
        </div>

        {/* Chart area */}
        <div className="flex-1 overflow-auto p-6">
          <AnimatePresence mode="wait">
            <motion.div
              key={chartType}
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -8 }}
              transition={{ duration: 0.25 }}
              className="h-full"
            >
              {renderChart()}
            </motion.div>
          </AnimatePresence>
        </div>
      </motion.div>
    </div>
  );
}
