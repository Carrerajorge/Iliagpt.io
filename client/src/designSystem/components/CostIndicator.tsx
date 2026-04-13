import React, { useMemo, useState, useRef, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Info, TrendingDown, DollarSign, Zap } from 'lucide-react';
import { cn } from '@/lib/utils';

// ---------------------------------------------------------------------------
// Model pricing table (USD per 1M tokens)
// ---------------------------------------------------------------------------

interface ModelPricing {
  input: number;
  output: number;
  name: string;
}

const MODEL_PRICING: Record<string, ModelPricing> = {
  'claude-opus-4-6':   { input: 15,    output: 75,   name: 'Claude Opus 4.6'    },
  'claude-sonnet-4-6': { input: 3,     output: 15,   name: 'Claude Sonnet 4.6'  },
  'claude-haiku-4-5':  { input: 0.8,   output: 4,    name: 'Claude Haiku 4.5'   },
  'gpt-4o':            { input: 2.5,   output: 10,   name: 'GPT-4o'             },
  'gpt-4o-mini':       { input: 0.15,  output: 0.6,  name: 'GPT-4o mini'        },
  'gemini-1.5-pro':    { input: 1.25,  output: 5,    name: 'Gemini 1.5 Pro'     },
  'gemini-1.5-flash':  { input: 0.075, output: 0.3,  name: 'Gemini 1.5 Flash'   },
};

// Cheapest reference model for comparison
const CHEAPEST_MODEL_ID = 'gemini-1.5-flash';

function getCost(modelId: string, tokensIn: number, tokensOut: number): number {
  const p = MODEL_PRICING[modelId] ?? { input: 3, output: 15 };
  return (tokensIn / 1_000_000) * p.input + (tokensOut / 1_000_000) * p.output;
}

function formatCost(usd: number): string {
  if (usd === 0) return '$0.000';
  if (usd < 0.0001) return '<$0.0001';
  if (usd < 0.001)  return `$${usd.toFixed(5)}`;
  if (usd < 0.01)   return `$${usd.toFixed(4)}`;
  if (usd < 1)      return `$${usd.toFixed(3)}`;
  return `$${usd.toFixed(2)}`;
}

function formatTokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(2)}M`;
  if (n >= 1_000)     return `${(n / 1_000).toFixed(1)}K`;
  return String(n);
}

// ---------------------------------------------------------------------------
// Animated counter
// ---------------------------------------------------------------------------

function useAnimatedNumber(target: number, decimals = 4): string {
  const [display, setDisplay] = useState(target);
  const rafRef = useRef<number | null>(null);
  const startRef = useRef(display);
  const startTimeRef = useRef<number | null>(null);
  const DURATION = 400; // ms

  useEffect(() => {
    const from = startRef.current;
    if (from === target) return;

    const animate = (ts: number) => {
      if (!startTimeRef.current) startTimeRef.current = ts;
      const elapsed = ts - startTimeRef.current;
      const progress = Math.min(elapsed / DURATION, 1);
      // easeOut
      const eased = 1 - Math.pow(1 - progress, 3);
      setDisplay(from + (target - from) * eased);

      if (progress < 1) {
        rafRef.current = requestAnimationFrame(animate);
      } else {
        startRef.current = target;
        startTimeRef.current = null;
      }
    };

    rafRef.current = requestAnimationFrame(animate);
    return () => {
      if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
    };
  }, [target]);

  return display.toFixed(decimals);
}

// ---------------------------------------------------------------------------
// Info tooltip
// ---------------------------------------------------------------------------

function InfoTooltip({ modelId, tokensIn, tokensOut }: { modelId: string; tokensIn: number; tokensOut: number }) {
  const [visible, setVisible] = useState(false);
  const p = MODEL_PRICING[modelId] ?? { input: 3, output: 15 };
  const pName = MODEL_PRICING[modelId]?.name ?? modelId;

  return (
    <div className="relative inline-block">
      <button
        onMouseEnter={() => setVisible(true)}
        onMouseLeave={() => setVisible(false)}
        onFocus={() => setVisible(true)}
        onBlur={() => setVisible(false)}
        className="p-0.5 rounded-full hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors"
        aria-label="Cost calculation info"
      >
        <Info size={12} className="text-slate-400" />
      </button>

      <AnimatePresence>
        {visible && (
          <motion.div
            initial={{ opacity: 0, y: 4, scale: 0.95 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 4, scale: 0.95 }}
            transition={{ duration: 0.12 }}
            className={cn(
              'absolute bottom-full right-0 mb-2 z-50',
              'w-56 p-3 rounded-xl',
              'bg-slate-800 dark:bg-slate-950',
              'border border-slate-700 dark:border-slate-800',
              'shadow-xl text-left',
            )}
          >
            <p className="text-xs font-semibold text-white mb-2">{pName}</p>
            <div className="space-y-1 text-[11px] text-slate-300">
              <div className="flex justify-between">
                <span className="text-slate-400">Input rate</span>
                <span>${p.input}/M tokens</span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-400">Output rate</span>
                <span>${p.output}/M tokens</span>
              </div>
              <div className="border-t border-slate-700 my-1.5" />
              <div className="flex justify-between">
                <span className="text-slate-400">Input tokens</span>
                <span>{formatTokens(tokensIn)}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-400">Output tokens</span>
                <span>{formatTokens(tokensOut)}</span>
              </div>
              <div className="border-t border-slate-700 my-1.5" />
              <div className="flex justify-between font-medium">
                <span className="text-slate-400">Formula</span>
                <span className="font-mono text-[10px]">(in/1M)×$in + (out/1M)×$out</span>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Budget progress bar
// ---------------------------------------------------------------------------

function BudgetBar({ current, limit }: { current: number; limit: number }) {
  const pct = Math.min((current / limit) * 100, 100);

  const color = pct < 60
    ? 'from-emerald-500 to-green-400'
    : pct < 85
      ? 'from-amber-500 to-yellow-400'
      : 'from-red-500 to-rose-400';

  return (
    <div className="mt-2">
      <div className="flex items-center justify-between mb-1">
        <span className="text-[10px] text-slate-500 dark:text-slate-400">
          Budget used
        </span>
        <span className={cn(
          'text-[10px] font-semibold',
          pct < 60  && 'text-emerald-600 dark:text-emerald-400',
          pct >= 60 && pct < 85 && 'text-amber-600 dark:text-amber-400',
          pct >= 85 && 'text-red-600 dark:text-red-400',
        )}>
          {pct.toFixed(0)}% · {formatCost(current)} / {formatCost(limit)}
        </span>
      </div>
      <div className="h-1.5 rounded-full bg-slate-200 dark:bg-slate-700 overflow-hidden">
        <motion.div
          className={cn('h-full rounded-full bg-gradient-to-r', color)}
          initial={{ width: 0 }}
          animate={{ width: `${pct}%` }}
          transition={{ duration: 0.5, ease: [0, 0, 0.2, 1] }}
        />
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

interface CostIndicatorProps {
  tokensIn: number;
  tokensOut: number;
  modelId: string;
  budgetLimit?: number;
  className?: string;
  compact?: boolean;
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

export function CostIndicator({
  tokensIn,
  tokensOut,
  modelId,
  budgetLimit,
  className,
  compact = false,
}: CostIndicatorProps) {
  const cost         = useMemo(() => getCost(modelId, tokensIn, tokensOut), [modelId, tokensIn, tokensOut]);
  const cheapestCost = useMemo(() => getCost(CHEAPEST_MODEL_ID, tokensIn, tokensOut), [tokensIn, tokensOut]);
  const savings      = cost - cheapestCost;
  const hasSavings   = savings > 0.0001 && modelId !== CHEAPEST_MODEL_ID;
  const animatedCost = useAnimatedNumber(cost, cost < 0.001 ? 6 : 4);

  if (compact) {
    return (
      <div className={cn('inline-flex items-center gap-1.5', className)}>
        <DollarSign size={12} className="text-slate-400" />
        <span className="text-xs font-medium text-slate-700 dark:text-slate-300 tabular-nums">
          {formatCost(cost)}
        </span>
        <InfoTooltip modelId={modelId} tokensIn={tokensIn} tokensOut={tokensOut} />
      </div>
    );
  }

  return (
    <div
      className={cn(
        'rounded-xl border border-slate-200 dark:border-slate-700 p-4',
        'bg-white dark:bg-slate-900',
        className,
      )}
    >
      {/* Header */}
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-1.5">
          <DollarSign size={14} className="text-slate-500 dark:text-slate-400" />
          <span className="text-xs font-semibold text-slate-600 dark:text-slate-400 uppercase tracking-wider">
            Cost Estimate
          </span>
        </div>
        <InfoTooltip modelId={modelId} tokensIn={tokensIn} tokensOut={tokensOut} />
      </div>

      {/* Main cost display */}
      <div className="flex items-baseline gap-1 mb-3">
        <motion.span
          className="text-2xl font-bold text-slate-900 dark:text-slate-100 tabular-nums"
          key={Math.round(cost * 10000)}
          initial={{ opacity: 0.6 }}
          animate={{ opacity: 1 }}
          transition={{ duration: 0.2 }}
        >
          ${animatedCost}
        </motion.span>
        <span className="text-xs text-slate-500 dark:text-slate-400">USD</span>
      </div>

      {/* Token breakdown */}
      <div className="grid grid-cols-2 gap-2 mb-3">
        <div className="bg-slate-50 dark:bg-slate-800/60 rounded-lg p-2.5">
          <div className="flex items-center gap-1 mb-1">
            <Zap size={10} className="text-indigo-500" />
            <span className="text-[10px] font-medium text-slate-500 dark:text-slate-400">
              Input
            </span>
          </div>
          <div className="text-sm font-semibold text-slate-800 dark:text-slate-200 tabular-nums">
            {formatTokens(tokensIn)}
          </div>
          <div className="text-[10px] text-slate-400 dark:text-slate-500 tabular-nums">
            {formatCost((tokensIn / 1_000_000) * (MODEL_PRICING[modelId]?.input ?? 3))}
          </div>
        </div>
        <div className="bg-slate-50 dark:bg-slate-800/60 rounded-lg p-2.5">
          <div className="flex items-center gap-1 mb-1">
            <Zap size={10} className="text-violet-500" />
            <span className="text-[10px] font-medium text-slate-500 dark:text-slate-400">
              Output
            </span>
          </div>
          <div className="text-sm font-semibold text-slate-800 dark:text-slate-200 tabular-nums">
            {formatTokens(tokensOut)}
          </div>
          <div className="text-[10px] text-slate-400 dark:text-slate-500 tabular-nums">
            {formatCost((tokensOut / 1_000_000) * (MODEL_PRICING[modelId]?.output ?? 15))}
          </div>
        </div>
      </div>

      {/* Comparison vs cheapest */}
      <AnimatePresence>
        {hasSavings && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: 'auto' }}
            exit={{ opacity: 0, height: 0 }}
            className="overflow-hidden"
          >
            <div className="flex items-center gap-1.5 py-2 px-2.5 rounded-lg bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-800/50 mb-3">
              <TrendingDown size={12} className="text-amber-600 dark:text-amber-400 flex-shrink-0" />
              <p className="text-[11px] text-amber-700 dark:text-amber-300">
                {formatCost(savings)} more than{' '}
                <span className="font-semibold">
                  {MODEL_PRICING[CHEAPEST_MODEL_ID]?.name ?? CHEAPEST_MODEL_ID}
                </span>
              </p>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Budget progress */}
      {budgetLimit !== undefined && budgetLimit > 0 && (
        <BudgetBar current={cost} limit={budgetLimit} />
      )}
    </div>
  );
}

export default CostIndicator;
