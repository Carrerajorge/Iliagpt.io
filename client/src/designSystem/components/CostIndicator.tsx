import React, { useState, useRef, useEffect, useMemo } from "react";
import { motion, AnimatePresence } from "framer-motion";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface CostIndicatorProps {
  inputTokens: number;
  outputTokens: number;
  /** Real-time USD cost for the current message */
  costUSD: number;
  /** Model ID used for pricing lookup */
  model: string;
  /** Session totals (across all messages) */
  sessionInputTokens?: number;
  sessionOutputTokens?: number;
  sessionCostUSD?: number;
  /** Whether to show the expanded panel by default */
  defaultExpanded?: boolean;
  className?: string;
}

// ---------------------------------------------------------------------------
// Pricing table (per 1k tokens, blended input / output)
// ---------------------------------------------------------------------------

interface ModelPricing {
  name: string;
  inputPer1k: number;   // USD per 1k input tokens
  outputPer1k: number;  // USD per 1k output tokens
}

const MODEL_PRICING: Record<string, ModelPricing> = {
  // Anthropic
  "claude-opus-4-5":    { name: "Claude Opus 4.5",    inputPer1k: 0.015,   outputPer1k: 0.075 },
  "claude-sonnet-4-5":  { name: "Claude Sonnet 4.5",  inputPer1k: 0.003,   outputPer1k: 0.015 },
  "claude-haiku-3-5":   { name: "Claude Haiku 3.5",   inputPer1k: 0.0008,  outputPer1k: 0.004 },
  "claude-opus-3":      { name: "Claude Opus 3",      inputPer1k: 0.015,   outputPer1k: 0.075 },
  "claude-sonnet-3-7":  { name: "Claude Sonnet 3.7",  inputPer1k: 0.003,   outputPer1k: 0.015 },
  // OpenAI
  "gpt-4o":             { name: "GPT-4o",             inputPer1k: 0.005,   outputPer1k: 0.015 },
  "gpt-4o-mini":        { name: "GPT-4o mini",        inputPer1k: 0.00015, outputPer1k: 0.0006 },
  "o3":                 { name: "o3",                 inputPer1k: 0.010,   outputPer1k: 0.040 },
  "o4-mini":            { name: "o4-mini",            inputPer1k: 0.0011,  outputPer1k: 0.0044 },
  "gpt-4-turbo":        { name: "GPT-4 Turbo",        inputPer1k: 0.010,   outputPer1k: 0.030 },
  // Google
  "gemini-2.0-flash":   { name: "Gemini 2.0 Flash",   inputPer1k: 0.000075, outputPer1k: 0.0003 },
  "gemini-2.5-pro":     { name: "Gemini 2.5 Pro",     inputPer1k: 0.00125,  outputPer1k: 0.010 },
  "gemini-1.5-pro":     { name: "Gemini 1.5 Pro",     inputPer1k: 0.00125,  outputPer1k: 0.005 },
  // Meta (via API providers)
  "llama-3.3-70b":      { name: "Llama 3.3 70B",      inputPer1k: 0.00065, outputPer1k: 0.00065 },
};

const FALLBACK_PRICING: ModelPricing = {
  name: "Unknown Model",
  inputPer1k: 0.001,
  outputPer1k: 0.002,
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function formatCostUSD(usd: number): string {
  if (usd === 0) return "$0.00";
  if (usd < 0.0001) return `<$0.0001`;
  if (usd < 0.01) return `$${usd.toFixed(4)}`;
  if (usd < 1) return `$${usd.toFixed(3)}`;
  return `$${usd.toFixed(2)}`;
}

function formatTokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(2)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}k`;
  return String(n);
}

function computeCost(
  inputTokens: number,
  outputTokens: number,
  pricing: ModelPricing
): number {
  return (
    (inputTokens / 1000) * pricing.inputPer1k +
    (outputTokens / 1000) * pricing.outputPer1k
  );
}

type CostTier = "low" | "medium" | "high";

function getCostTier(usd: number): CostTier {
  if (usd < 0.01) return "low";
  if (usd <= 0.10) return "medium";
  return "high";
}

const TIER_STYLES: Record<CostTier, { badge: string; dot: string; bar: string; label: string }> = {
  low: {
    badge: "text-green-400 bg-green-950/40 border-green-800/40",
    dot: "bg-green-500",
    bar: "bg-green-500",
    label: "Low cost",
  },
  medium: {
    badge: "text-amber-400 bg-amber-950/40 border-amber-800/40",
    dot: "bg-amber-500",
    bar: "bg-amber-500",
    label: "Moderate",
  },
  high: {
    badge: "text-red-400 bg-red-950/40 border-red-800/40",
    dot: "bg-red-500",
    bar: "bg-red-500",
    label: "High cost",
  },
};

// ---------------------------------------------------------------------------
// Animated number hook
// ---------------------------------------------------------------------------

function useAnimatedNumber(value: number, decimals = 0): string {
  const [display, setDisplay] = useState(value);
  const prevRef = useRef(value);
  const frameRef = useRef<number | null>(null);

  useEffect(() => {
    const start = prevRef.current;
    const end = value;
    if (start === end) return;

    const duration = 400;
    const startTime = performance.now();

    const animate = (now: number) => {
      const elapsed = now - startTime;
      const progress = Math.min(elapsed / duration, 1);
      // Ease out
      const eased = 1 - Math.pow(1 - progress, 3);
      setDisplay(start + (end - start) * eased);

      if (progress < 1) {
        frameRef.current = requestAnimationFrame(animate);
      } else {
        prevRef.current = end;
      }
    };

    if (frameRef.current) cancelAnimationFrame(frameRef.current);
    frameRef.current = requestAnimationFrame(animate);

    return () => {
      if (frameRef.current) cancelAnimationFrame(frameRef.current);
    };
  }, [value]);

  return display.toFixed(decimals);
}

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

function TokenPill({
  label,
  value,
  color,
}: {
  label: string;
  value: number;
  color: string;
}) {
  const animated = useAnimatedNumber(value);

  return (
    <div className="flex flex-col items-center gap-0.5">
      <span className={`text-sm font-semibold tabular-nums ${color}`}>
        {formatTokens(Number(animated))}
      </span>
      <span className="text-[10px] text-gray-600 uppercase tracking-wide">{label}</span>
    </div>
  );
}

interface BreakdownRowProps {
  label: string;
  tokens: number;
  cost: number;
  colorClass: string;
}

function BreakdownRow({ label, tokens, cost, colorClass }: BreakdownRowProps) {
  return (
    <div className="flex items-center justify-between py-1.5 border-b border-gray-800/60 last:border-0">
      <div className="flex items-center gap-2">
        <span className={`w-2 h-2 rounded-full ${colorClass}`} />
        <span className="text-xs text-gray-400">{label}</span>
      </div>
      <div className="flex items-center gap-4 text-xs tabular-nums">
        <span className="text-gray-500">{formatTokens(tokens)} tok</span>
        <span className="text-gray-300 w-16 text-right">{formatCostUSD(cost)}</span>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

export function CostIndicator({
  inputTokens,
  outputTokens,
  costUSD,
  model,
  sessionInputTokens,
  sessionOutputTokens,
  sessionCostUSD,
  defaultExpanded = false,
  className = "",
}: CostIndicatorProps) {
  const [expanded, setExpanded] = useState(defaultExpanded);

  const pricing = MODEL_PRICING[model] ?? FALLBACK_PRICING;
  const totalTokens = inputTokens + outputTokens;
  const tier = getCostTier(costUSD);
  const styles = TIER_STYLES[tier];

  // Derived cost breakdown
  const inputCost = useMemo(
    () => (inputTokens / 1000) * pricing.inputPer1k,
    [inputTokens, pricing.inputPer1k]
  );
  const outputCost = useMemo(
    () => (outputTokens / 1000) * pricing.outputPer1k,
    [outputTokens, pricing.outputPer1k]
  );

  // Session totals
  const sessIn = sessionInputTokens ?? inputTokens;
  const sessOut = sessionOutputTokens ?? outputTokens;
  const sessCost = sessionCostUSD ?? costUSD;
  const sessTotal = sessIn + sessOut;
  const sessTier = getCostTier(sessCost);
  const sessStyles = TIER_STYLES[sessTier];

  // Animated values
  const animatedCost = useAnimatedNumber(costUSD, 4);
  const animatedTotal = useAnimatedNumber(totalTokens);

  // Progress bar: show where we are relative to a $1 session budget
  const sessionBudget = 1.0;
  const sessionPct = Math.min((sessCost / sessionBudget) * 100, 100);

  return (
    <div className={`text-xs ${className}`}>
      {/* Compact inline trigger */}
      <button
        onClick={() => setExpanded((v) => !v)}
        aria-expanded={expanded}
        aria-label="Toggle cost details"
        className={[
          "flex items-center gap-2 px-3 py-1.5 rounded-lg border transition-all duration-150",
          "hover:opacity-90",
          styles.badge,
        ].join(" ")}
      >
        {/* Live dot */}
        <motion.span
          className={`inline-block w-1.5 h-1.5 rounded-full ${styles.dot}`}
          animate={inputTokens + outputTokens > 0 ? { scale: [1, 1.4, 1], opacity: [1, 0.6, 1] } : {}}
          transition={{ duration: 1.5, repeat: Infinity }}
        />

        {/* Cost */}
        <span className="font-semibold tabular-nums">${animatedCost}</span>

        {/* Token count */}
        <span className="text-current opacity-60 tabular-nums">
          {formatTokens(Number(animatedTotal))} tok
        </span>

        {/* Chevron */}
        <motion.svg
          animate={{ rotate: expanded ? 180 : 0 }}
          transition={{ duration: 0.2 }}
          className="w-3 h-3 opacity-60 ml-0.5"
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
          strokeWidth={2.5}
        >
          <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
        </motion.svg>
      </button>

      {/* Expanded panel */}
      <AnimatePresence initial={false}>
        {expanded && (
          <motion.div
            key="panel"
            initial={{ opacity: 0, y: -4, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -4, scale: 0.98 }}
            transition={{ duration: 0.18 }}
            className="absolute z-30 mt-1.5 w-72 rounded-xl border border-gray-700/60 bg-gray-900 shadow-2xl shadow-black/50 overflow-hidden"
          >
            {/* Header */}
            <div className="flex items-center justify-between px-4 py-3 border-b border-gray-800">
              <div>
                <p className="text-xs font-semibold text-gray-200">Cost Breakdown</p>
                <p className="text-[10px] text-gray-600 mt-0.5">{pricing.name}</p>
              </div>
              <span className={`text-sm font-bold tabular-nums ${styles.badge} px-2.5 py-1 rounded-lg border`}>
                {formatCostUSD(costUSD)}
              </span>
            </div>

            {/* Token summary row */}
            <div className="flex items-center justify-around px-4 py-3 border-b border-gray-800">
              <TokenPill label="Input" value={inputTokens} color="text-blue-400" />
              <div className="w-px h-8 bg-gray-800" />
              <TokenPill label="Output" value={outputTokens} color="text-purple-400" />
              <div className="w-px h-8 bg-gray-800" />
              <TokenPill label="Total" value={totalTokens} color="text-gray-200" />
            </div>

            {/* Per-token breakdown */}
            <div className="px-4 py-2 border-b border-gray-800">
              <p className="text-[10px] text-gray-600 uppercase tracking-wide mb-2">
                This message
              </p>
              <BreakdownRow
                label={`Input @ $${pricing.inputPer1k}/1k`}
                tokens={inputTokens}
                cost={inputCost}
                colorClass="bg-blue-500"
              />
              <BreakdownRow
                label={`Output @ $${pricing.outputPer1k}/1k`}
                tokens={outputTokens}
                cost={outputCost}
                colorClass="bg-purple-500"
              />
            </div>

            {/* Session totals */}
            <div className="px-4 py-3">
              <div className="flex items-center justify-between mb-2">
                <p className="text-[10px] text-gray-600 uppercase tracking-wide">
                  Session total
                </p>
                <span className={`text-xs font-bold tabular-nums ${sessStyles.badge} px-2 py-0.5 rounded border`}>
                  {formatCostUSD(sessCost)}
                </span>
              </div>

              <div className="flex items-center justify-between text-[11px] text-gray-500 mb-2 tabular-nums">
                <span>{formatTokens(sessIn)} in + {formatTokens(sessOut)} out</span>
                <span>{formatTokens(sessTotal)} total</span>
              </div>

              {/* Session budget bar */}
              <div className="space-y-1">
                <div className="flex items-center justify-between text-[10px] text-gray-700">
                  <span>Session budget</span>
                  <span>{sessionPct.toFixed(1)}% of ${sessionBudget}</span>
                </div>
                <div className="h-1.5 rounded-full bg-gray-800 overflow-hidden">
                  <motion.div
                    className={`h-full rounded-full ${sessStyles.bar}`}
                    initial={{ width: 0 }}
                    animate={{ width: `${sessionPct}%` }}
                    transition={{ duration: 0.5, ease: "easeOut" }}
                  />
                </div>
              </div>
            </div>

            {/* Cost tier label */}
            <div className={`px-4 py-2 text-center text-[11px] font-medium ${styles.badge} border-t border-gray-800/60`}>
              {styles.label}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

export default CostIndicator;
