import React, { useState, useMemo, useCallback } from "react";
import * as Popover from "@radix-ui/react-popover";
import { motion, AnimatePresence } from "framer-motion";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type ModelCapability =
  | "vision"
  | "function-calling"
  | "code"
  | "reasoning"
  | "long-context"
  | "streaming"
  | "json-mode"
  | "embeddings"
  | "multilingual"
  | "audio";

export type ModelSpeed = "fast" | "medium" | "slow";

export interface ModelDefinition {
  id: string;
  name: string;
  provider: string;
  description: string;
  /** Maximum context window in tokens */
  contextWindow: number;
  /** Cost per 1k tokens in USD (blended input+output estimate) */
  costPer1k: number;
  speed: ModelSpeed;
  capabilities: ModelCapability[];
  /** Whether this model is deprecated / not recommended */
  deprecated?: boolean;
  /** Whether this is a preview / beta model */
  preview?: boolean;
}

export interface ModelSelectorProps {
  selectedModel: string;
  onSelect: (modelId: string) => void;
  availableModels: ModelDefinition[];
  disabled?: boolean;
  placeholder?: string;
}

// ---------------------------------------------------------------------------
// Default model library
// ---------------------------------------------------------------------------

export const DEFAULT_MODELS: ModelDefinition[] = [
  // Anthropic
  {
    id: "claude-opus-4-5",
    name: "Claude Opus 4.5",
    provider: "Anthropic",
    description: "Most capable model for complex reasoning, analysis, and creative work.",
    contextWindow: 200_000,
    costPer1k: 0.075,
    speed: "slow",
    capabilities: ["vision", "function-calling", "code", "reasoning", "long-context", "streaming", "json-mode", "multilingual"],
  },
  {
    id: "claude-sonnet-4-5",
    name: "Claude Sonnet 4.5",
    provider: "Anthropic",
    description: "Balanced performance and speed for most tasks.",
    contextWindow: 200_000,
    costPer1k: 0.018,
    speed: "medium",
    capabilities: ["vision", "function-calling", "code", "reasoning", "long-context", "streaming", "json-mode", "multilingual"],
  },
  {
    id: "claude-haiku-3-5",
    name: "Claude Haiku 3.5",
    provider: "Anthropic",
    description: "Fastest Claude model for lightweight tasks and high-volume use.",
    contextWindow: 200_000,
    costPer1k: 0.004,
    speed: "fast",
    capabilities: ["vision", "function-calling", "code", "streaming", "json-mode"],
  },
  // OpenAI
  {
    id: "gpt-4o",
    name: "GPT-4o",
    provider: "OpenAI",
    description: "Multimodal flagship with fast response times.",
    contextWindow: 128_000,
    costPer1k: 0.0075,
    speed: "fast",
    capabilities: ["vision", "function-calling", "code", "reasoning", "streaming", "json-mode", "audio"],
  },
  {
    id: "gpt-4o-mini",
    name: "GPT-4o mini",
    provider: "OpenAI",
    description: "Affordable and intelligent small model for focused tasks.",
    contextWindow: 128_000,
    costPer1k: 0.0003,
    speed: "fast",
    capabilities: ["vision", "function-calling", "code", "streaming", "json-mode"],
  },
  {
    id: "o3",
    name: "o3",
    provider: "OpenAI",
    description: "Advanced reasoning model for complex multi-step problems.",
    contextWindow: 200_000,
    costPer1k: 0.06,
    speed: "slow",
    capabilities: ["reasoning", "code", "function-calling", "json-mode"],
    preview: true,
  },
  // Google
  {
    id: "gemini-2.0-flash",
    name: "Gemini 2.0 Flash",
    provider: "Google",
    description: "Fastest and most efficient Gemini model with multimodal capabilities.",
    contextWindow: 1_000_000,
    costPer1k: 0.00035,
    speed: "fast",
    capabilities: ["vision", "function-calling", "code", "long-context", "streaming", "json-mode", "audio"],
  },
  {
    id: "gemini-2.5-pro",
    name: "Gemini 2.5 Pro",
    provider: "Google",
    description: "State-of-the-art thinking model with extreme context.",
    contextWindow: 1_000_000,
    costPer1k: 0.015,
    speed: "medium",
    capabilities: ["vision", "function-calling", "code", "reasoning", "long-context", "streaming", "json-mode"],
    preview: true,
  },
  // Meta
  {
    id: "llama-3.3-70b",
    name: "Llama 3.3 70B",
    provider: "Meta",
    description: "Open source model with strong performance across tasks.",
    contextWindow: 128_000,
    costPer1k: 0.001,
    speed: "medium",
    capabilities: ["function-calling", "code", "streaming", "json-mode", "multilingual"],
  },
];

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function formatContext(tokens: number): string {
  if (tokens >= 1_000_000) return `${tokens / 1_000_000}M`;
  if (tokens >= 1_000) return `${tokens / 1_000}k`;
  return String(tokens);
}

function formatCost(costPer1k: number): string {
  if (costPer1k === 0) return "Free";
  if (costPer1k < 0.001) return `$${(costPer1k * 1000).toFixed(2)}/M`;
  return `$${costPer1k.toFixed(3)}/1k`;
}

const PROVIDER_COLORS: Record<string, string> = {
  Anthropic: "text-purple-400 bg-purple-950/60 border-purple-800/50",
  OpenAI: "text-green-400 bg-green-950/60 border-green-800/50",
  Google: "text-blue-400 bg-blue-950/60 border-blue-800/50",
  Meta: "text-amber-400 bg-amber-950/60 border-amber-800/50",
};

const CAPABILITY_ICONS: Record<ModelCapability, { icon: string; label: string }> = {
  vision: { icon: "👁", label: "Vision" },
  "function-calling": { icon: "⚡", label: "Tools" },
  code: { icon: "💻", label: "Code" },
  reasoning: { icon: "🧠", label: "Reasoning" },
  "long-context": { icon: "📜", label: "Long ctx" },
  streaming: { icon: "🌊", label: "Streaming" },
  "json-mode": { icon: "{ }", label: "JSON" },
  embeddings: { icon: "🔢", label: "Embeddings" },
  multilingual: { icon: "🌍", label: "Multilingual" },
  audio: { icon: "🎤", label: "Audio" },
};

const SPEED_CONFIG: Record<ModelSpeed, { label: string; class: string }> = {
  fast: { label: "Fast", class: "text-green-400" },
  medium: { label: "Balanced", class: "text-amber-400" },
  slow: { label: "Deliberate", class: "text-red-400" },
};

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

function CapabilityBadge({ capability }: { capability: ModelCapability }) {
  const { icon, label } = CAPABILITY_ICONS[capability];
  return (
    <span
      title={label}
      className="inline-flex items-center text-xs text-gray-400 bg-gray-800/80 border border-gray-700/50 rounded px-1.5 py-0.5 gap-0.5"
    >
      <span className="text-[10px]">{icon}</span>
    </span>
  );
}

function ProviderBadge({ provider }: { provider: string }) {
  const cls = PROVIDER_COLORS[provider] ?? "text-gray-400 bg-gray-800 border-gray-700";
  return (
    <span className={`text-[10px] font-semibold uppercase tracking-wider px-1.5 py-0.5 rounded border ${cls}`}>
      {provider}
    </span>
  );
}

interface ModelItemProps {
  model: ModelDefinition;
  selected: boolean;
  onSelect: (id: string) => void;
}

function ModelItem({ model, selected, onSelect }: ModelItemProps) {
  const speedCfg = SPEED_CONFIG[model.speed];

  return (
    <button
      onClick={() => onSelect(model.id)}
      className={[
        "w-full text-left px-3 py-3 rounded-lg transition-all duration-150",
        "border",
        selected
          ? "bg-purple-950/50 border-purple-700/60"
          : "bg-transparent border-transparent hover:bg-gray-800/60 hover:border-gray-700/40",
      ].join(" ")}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap mb-0.5">
            <span className={`text-sm font-medium ${selected ? "text-purple-100" : "text-gray-100"}`}>
              {model.name}
            </span>
            {model.preview && (
              <span className="text-[10px] font-semibold uppercase tracking-wider px-1.5 py-0.5 rounded border text-blue-400 bg-blue-950/60 border-blue-800/50">
                Preview
              </span>
            )}
            {model.deprecated && (
              <span className="text-[10px] font-semibold uppercase tracking-wider px-1.5 py-0.5 rounded border text-gray-500 bg-gray-800 border-gray-700">
                Deprecated
              </span>
            )}
          </div>

          <p className="text-xs text-gray-500 leading-relaxed line-clamp-2 mb-2">
            {model.description}
          </p>

          {/* Capability icons */}
          <div className="flex items-center gap-1 flex-wrap">
            {model.capabilities.slice(0, 6).map((cap) => (
              <CapabilityBadge key={cap} capability={cap} />
            ))}
          </div>
        </div>

        {/* Right stats */}
        <div className="flex flex-col items-end gap-1 flex-shrink-0 text-xs">
          <span className="text-gray-400 bg-gray-800/80 border border-gray-700/50 rounded px-1.5 py-0.5 tabular-nums">
            {formatContext(model.contextWindow)}
          </span>
          <span className="text-gray-400 tabular-nums">{formatCost(model.costPer1k)}</span>
          <span className={`${speedCfg.class} font-medium`}>{speedCfg.label}</span>
        </div>
      </div>

      {/* Selected indicator */}
      {selected && (
        <div className="mt-2 flex items-center gap-1 text-xs text-purple-400 font-medium">
          <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
          </svg>
          Selected
        </div>
      )}
    </button>
  );
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

export function ModelSelector({
  selectedModel,
  onSelect,
  availableModels,
  disabled = false,
  placeholder = "Select a model",
}: ModelSelectorProps) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");

  const selected = useMemo(
    () => availableModels.find((m) => m.id === selectedModel),
    [availableModels, selectedModel]
  );

  const filtered = useMemo(() => {
    const q = search.toLowerCase().trim();
    if (!q) return availableModels;
    return availableModels.filter(
      (m) =>
        m.name.toLowerCase().includes(q) ||
        m.provider.toLowerCase().includes(q) ||
        m.description.toLowerCase().includes(q) ||
        m.capabilities.some((c) => c.toLowerCase().includes(q))
    );
  }, [availableModels, search]);

  // Group by provider
  const grouped = useMemo(() => {
    const map: Record<string, ModelDefinition[]> = {};
    for (const model of filtered) {
      if (!map[model.provider]) map[model.provider] = [];
      map[model.provider].push(model);
    }
    return map;
  }, [filtered]);

  const handleSelect = useCallback(
    (id: string) => {
      onSelect(id);
      setOpen(false);
      setSearch("");
    },
    [onSelect]
  );

  return (
    <Popover.Root open={open} onOpenChange={setOpen}>
      {/* Trigger */}
      <Popover.Trigger asChild>
        <button
          disabled={disabled}
          aria-label="Select AI model"
          className={[
            "flex items-center gap-2.5 px-3 py-2 rounded-xl border text-sm transition-all duration-150",
            "bg-gray-900 border-gray-700/60 hover:border-gray-600",
            disabled ? "opacity-50 cursor-not-allowed" : "cursor-pointer hover:bg-gray-800",
            open ? "border-purple-600/60 ring-1 ring-purple-600/30" : "",
          ].join(" ")}
        >
          {selected ? (
            <>
              <ProviderBadge provider={selected.provider} />
              <span className="font-medium text-gray-100">{selected.name}</span>
              <span className="text-xs text-gray-500 tabular-nums">
                {formatContext(selected.contextWindow)}
              </span>
            </>
          ) : (
            <span className="text-gray-500">{placeholder}</span>
          )}
          <svg
            className={`w-4 h-4 text-gray-500 ml-auto transition-transform duration-200 ${open ? "rotate-180" : ""}`}
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
            strokeWidth={2}
          >
            <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
          </svg>
        </button>
      </Popover.Trigger>

      {/* Popover content */}
      <Popover.Portal>
        <Popover.Content
          sideOffset={6}
          align="start"
          className="z-50 w-[440px] max-h-[520px] flex flex-col rounded-2xl border border-gray-700/60 bg-gray-900 shadow-2xl shadow-black/60 overflow-hidden"
          style={{ outline: "none" }}
        >
          <AnimatePresence>
            {open && (
              <motion.div
                initial={{ opacity: 0, y: -6, scale: 0.98 }}
                animate={{ opacity: 1, y: 0, scale: 1 }}
                exit={{ opacity: 0, y: -6, scale: 0.98 }}
                transition={{ duration: 0.15 }}
                className="flex flex-col h-full"
              >
                {/* Search input */}
                <div className="px-3 pt-3 pb-2 border-b border-gray-800">
                  <div className="flex items-center gap-2 px-3 py-2 rounded-lg bg-gray-800/80 border border-gray-700/50">
                    <svg className="w-4 h-4 text-gray-500 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
                    </svg>
                    <input
                      autoFocus
                      value={search}
                      onChange={(e) => setSearch(e.target.value)}
                      placeholder="Search models..."
                      className="flex-1 bg-transparent text-sm text-gray-100 placeholder-gray-600 outline-none"
                    />
                    {search && (
                      <button
                        onClick={() => setSearch("")}
                        className="text-gray-600 hover:text-gray-400 transition-colors"
                      >
                        <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                          <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                        </svg>
                      </button>
                    )}
                  </div>
                </div>

                {/* Model list */}
                <div className="flex-1 overflow-y-auto overscroll-contain px-2 pb-2">
                  {Object.keys(grouped).length === 0 ? (
                    <div className="py-8 text-center text-sm text-gray-600">
                      No models match "{search}"
                    </div>
                  ) : (
                    Object.entries(grouped).map(([provider, models]) => (
                      <div key={provider}>
                        <div className="flex items-center gap-2 px-2 pt-3 pb-1.5">
                          <ProviderBadge provider={provider} />
                          <span className="text-xs text-gray-600">{models.length} model{models.length !== 1 ? "s" : ""}</span>
                        </div>
                        <div className="space-y-0.5">
                          {models.map((model) => (
                            <ModelItem
                              key={model.id}
                              model={model}
                              selected={model.id === selectedModel}
                              onSelect={handleSelect}
                            />
                          ))}
                        </div>
                      </div>
                    ))
                  )}
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}

export default ModelSelector;
