import React, { useState, useCallback, useMemo, useEffect, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Search, Star, ChevronDown, ChevronUp, Check, Zap, Clock } from 'lucide-react';
import { cn } from '@/lib/utils';

// ---------------------------------------------------------------------------
// Model catalog
// ---------------------------------------------------------------------------

type Latency = 'fast' | 'medium' | 'slow';
type Provider = 'anthropic' | 'openai' | 'google';

interface ModelInfo {
  id: string;
  name: string;
  provider: Provider;
  contextWindow: number;    // tokens
  pricePerMTokIn: number;   // USD per 1M input tokens
  pricePerMTokOut: number;  // USD per 1M output tokens
  latency: Latency;
  capabilities: string[];
  isNew?: boolean;
}

export const MODELS: ModelInfo[] = [
  {
    id: 'claude-opus-4-6',
    name: 'Claude Opus 4.6',
    provider: 'anthropic',
    contextWindow: 200_000,
    pricePerMTokIn: 15,
    pricePerMTokOut: 75,
    latency: 'slow',
    capabilities: ['reasoning', 'code', 'analysis', 'vision', 'long context'],
    isNew: true,
  },
  {
    id: 'claude-sonnet-4-6',
    name: 'Claude Sonnet 4.6',
    provider: 'anthropic',
    contextWindow: 200_000,
    pricePerMTokIn: 3,
    pricePerMTokOut: 15,
    latency: 'medium',
    capabilities: ['reasoning', 'code', 'analysis', 'vision', 'long context'],
    isNew: true,
  },
  {
    id: 'claude-haiku-4-5',
    name: 'Claude Haiku 4.5',
    provider: 'anthropic',
    contextWindow: 200_000,
    pricePerMTokIn: 0.8,
    pricePerMTokOut: 4,
    latency: 'fast',
    capabilities: ['code', 'summarization', 'classification', 'vision'],
  },
  {
    id: 'gpt-4o',
    name: 'GPT-4o',
    provider: 'openai',
    contextWindow: 128_000,
    pricePerMTokIn: 2.5,
    pricePerMTokOut: 10,
    latency: 'medium',
    capabilities: ['reasoning', 'code', 'vision', 'function calling'],
  },
  {
    id: 'gpt-4o-mini',
    name: 'GPT-4o mini',
    provider: 'openai',
    contextWindow: 128_000,
    pricePerMTokIn: 0.15,
    pricePerMTokOut: 0.6,
    latency: 'fast',
    capabilities: ['code', 'summarization', 'vision', 'function calling'],
  },
  {
    id: 'gemini-1.5-pro',
    name: 'Gemini 1.5 Pro',
    provider: 'google',
    contextWindow: 2_000_000,
    pricePerMTokIn: 1.25,
    pricePerMTokOut: 5,
    latency: 'medium',
    capabilities: ['reasoning', 'code', 'vision', 'long context', 'audio'],
  },
  {
    id: 'gemini-1.5-flash',
    name: 'Gemini 1.5 Flash',
    provider: 'google',
    contextWindow: 1_000_000,
    pricePerMTokIn: 0.075,
    pricePerMTokOut: 0.3,
    latency: 'fast',
    capabilities: ['code', 'summarization', 'vision', 'long context'],
  },
];

const PROVIDER_META: Record<Provider, { emoji: string; label: string }> = {
  anthropic: { emoji: '🤖', label: 'Anthropic' },
  openai:    { emoji: '🟢', label: 'OpenAI' },
  google:    { emoji: '🔷', label: 'Google' },
};

const LATENCY_CONFIG: Record<Latency, { color: string; label: string }> = {
  fast:   { color: 'bg-emerald-500', label: 'Fast' },
  medium: { color: 'bg-amber-500',   label: 'Medium' },
  slow:   { color: 'bg-red-500',     label: 'Slow' },
};

function formatContext(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(0)}M`;
  if (n >= 1_000)     return `${(n / 1_000).toFixed(0)}K`;
  return String(n);
}

const FAVORITES_KEY = 'iliaGPT_modelFavorites';

function loadFavorites(): Set<string> {
  try {
    const raw = localStorage.getItem(FAVORITES_KEY);
    return new Set(raw ? JSON.parse(raw) : []);
  } catch {
    return new Set();
  }
}

function saveFavorites(favs: Set<string>): void {
  try {
    localStorage.setItem(FAVORITES_KEY, JSON.stringify([...favs]));
  } catch {
    // storage full or SSR
  }
}

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

function LatencyDot({ latency }: { latency: Latency }) {
  const cfg = LATENCY_CONFIG[latency];
  return (
    <span
      title={cfg.label}
      className={cn('inline-block w-2 h-2 rounded-full flex-shrink-0', cfg.color)}
    />
  );
}

interface ModelRowProps {
  model: ModelInfo;
  isSelected: boolean;
  isFavorite: boolean;
  onSelect: (id: string) => void;
  onToggleFavorite: (id: string) => void;
}

function ModelRow({ model, isSelected, isFavorite, onSelect, onToggleFavorite }: ModelRowProps) {
  const pm = PROVIDER_META[model.provider];

  return (
    <button
      onClick={() => onSelect(model.id)}
      className={cn(
        'w-full text-left px-3 py-2.5 rounded-lg transition-colors',
        'hover:bg-slate-100 dark:hover:bg-slate-800',
        isSelected && 'bg-indigo-50 dark:bg-indigo-950/40 border border-indigo-200 dark:border-indigo-800',
        !isSelected && 'border border-transparent',
      )}
    >
      <div className="flex items-center gap-2">
        {/* Provider emoji */}
        <span className="text-base leading-none flex-shrink-0">{pm.emoji}</span>

        {/* Name + badges */}
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-1.5 flex-wrap">
            <span className={cn(
              'text-sm font-medium truncate',
              isSelected
                ? 'text-indigo-700 dark:text-indigo-300'
                : 'text-slate-800 dark:text-slate-200',
            )}>
              {model.name}
            </span>
            {model.isNew && (
              <span className="px-1.5 py-0.5 rounded-full bg-violet-100 dark:bg-violet-900/50 text-violet-700 dark:text-violet-300 text-[9px] font-bold uppercase tracking-wide flex-shrink-0">
                New
              </span>
            )}
          </div>

          {/* Meta row */}
          <div className="flex items-center gap-2 mt-0.5 flex-wrap">
            <span className="text-[10px] text-slate-500 dark:text-slate-400">
              {formatContext(model.contextWindow)} ctx
            </span>
            <span className="text-[10px] text-slate-400">·</span>
            <span className="text-[10px] text-slate-500 dark:text-slate-400">
              ${model.pricePerMTokIn}/M in
            </span>
            <LatencyDot latency={model.latency} />
            <span className="text-[10px] text-slate-500 dark:text-slate-400">
              {LATENCY_CONFIG[model.latency].label}
            </span>
          </div>
        </div>

        {/* Right side: favorite + check */}
        <div className="flex items-center gap-1.5 flex-shrink-0">
          <button
            onClick={(e) => {
              e.stopPropagation();
              onToggleFavorite(model.id);
            }}
            className="p-1 rounded-md hover:bg-slate-200 dark:hover:bg-slate-700 transition-colors"
            aria-label={isFavorite ? 'Remove from favorites' : 'Add to favorites'}
          >
            <Star
              size={12}
              className={cn(
                'transition-colors',
                isFavorite
                  ? 'fill-amber-400 text-amber-400'
                  : 'text-slate-400 dark:text-slate-600',
              )}
            />
          </button>
          {isSelected && (
            <Check size={14} className="text-indigo-600 dark:text-indigo-400" />
          )}
        </div>
      </div>
    </button>
  );
}

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

interface ModelSelectorProps {
  value: string;
  onChange: (modelId: string) => void;
  className?: string;
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

export function ModelSelector({ value, onChange, className }: ModelSelectorProps) {
  const [open, setOpen]           = useState(false);
  const [query, setQuery]         = useState('');
  const [favorites, setFavorites] = useState<Set<string>>(loadFavorites);
  const containerRef              = useRef<HTMLDivElement>(null);
  const inputRef                  = useRef<HTMLInputElement>(null);

  const selectedModel = MODELS.find((m) => m.id === value);

  // Close on outside click
  useEffect(() => {
    if (!open) return;
    const handle = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener('mousedown', handle);
    return () => document.removeEventListener('mousedown', handle);
  }, [open]);

  // Focus search when opened
  useEffect(() => {
    if (open) {
      setTimeout(() => inputRef.current?.focus(), 50);
    } else {
      setQuery('');
    }
  }, [open]);

  const handleToggleFavorite = useCallback((id: string) => {
    setFavorites((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      saveFavorites(next);
      return next;
    });
  }, []);

  const handleSelect = useCallback((id: string) => {
    onChange(id);
    setOpen(false);
  }, [onChange]);

  // Filter + group
  const { favoriteModels, grouped } = useMemo(() => {
    const q = query.toLowerCase();
    const filtered = MODELS.filter((m) =>
      !q ||
      m.name.toLowerCase().includes(q) ||
      m.provider.includes(q) ||
      m.capabilities.some((c) => c.includes(q)),
    );

    const favs = filtered.filter((m) => favorites.has(m.id));
    const groups: Record<Provider, ModelInfo[]> = {
      anthropic: [],
      openai:    [],
      google:    [],
    };
    for (const m of filtered) {
      if (!favorites.has(m.id)) groups[m.provider].push(m);
    }

    return { favoriteModels: favs, grouped: groups };
  }, [query, favorites]);

  const pm = selectedModel ? PROVIDER_META[selectedModel.provider] : null;

  return (
    <div ref={containerRef} className={cn('relative', className)}>
      {/* Trigger button */}
      <button
        onClick={() => setOpen((p) => !p)}
        className={cn(
          'w-full flex items-center gap-2 px-3 py-2.5 rounded-xl',
          'border border-slate-200 dark:border-slate-700',
          'bg-white dark:bg-slate-900',
          'hover:border-indigo-300 dark:hover:border-indigo-700',
          'transition-colors text-left',
          open && 'border-indigo-400 dark:border-indigo-600 ring-2 ring-indigo-200 dark:ring-indigo-900',
        )}
      >
        {pm && (
          <span className="text-lg leading-none flex-shrink-0">{pm.emoji}</span>
        )}
        <div className="flex-1 min-w-0">
          <div className="text-sm font-medium text-slate-800 dark:text-slate-200 truncate">
            {selectedModel?.name ?? 'Select a model'}
          </div>
          {selectedModel && (
            <div className="flex items-center gap-1.5 mt-0.5">
              <LatencyDot latency={selectedModel.latency} />
              <span className="text-[10px] text-slate-500 dark:text-slate-400">
                {formatContext(selectedModel.contextWindow)} ctx · ${selectedModel.pricePerMTokIn}/M
              </span>
            </div>
          )}
        </div>
        {open ? (
          <ChevronUp size={16} className="text-slate-400 flex-shrink-0" />
        ) : (
          <ChevronDown size={16} className="text-slate-400 flex-shrink-0" />
        )}
      </button>

      {/* Dropdown */}
      <AnimatePresence>
        {open && (
          <motion.div
            initial={{ opacity: 0, y: -6, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -6, scale: 0.98 }}
            transition={{ duration: 0.15, ease: [0, 0, 0.2, 1] }}
            className={cn(
              'absolute z-50 mt-2 w-full min-w-[320px]',
              'rounded-xl border border-slate-200 dark:border-slate-700',
              'bg-white dark:bg-slate-900',
              'shadow-xl shadow-slate-900/10 dark:shadow-slate-950/50',
              'overflow-hidden',
            )}
          >
            {/* Search */}
            <div className="p-2 border-b border-slate-100 dark:border-slate-800">
              <div className="relative">
                <Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400" />
                <input
                  ref={inputRef}
                  type="text"
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder="Search models, providers, capabilities…"
                  className={cn(
                    'w-full pl-8 pr-3 py-2 text-sm rounded-lg',
                    'bg-slate-50 dark:bg-slate-800',
                    'border border-transparent focus:border-indigo-300 dark:focus:border-indigo-700',
                    'text-slate-800 dark:text-slate-200',
                    'placeholder:text-slate-400 dark:placeholder:text-slate-600',
                    'outline-none transition-colors',
                  )}
                />
              </div>
            </div>

            {/* Model list */}
            <div className="max-h-[360px] overflow-y-auto p-2 space-y-1">
              {/* Favorites section */}
              {favoriteModels.length > 0 && (
                <div>
                  <div className="flex items-center gap-1.5 px-3 py-1.5">
                    <Star size={10} className="fill-amber-400 text-amber-400" />
                    <span className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">
                      Favorites
                    </span>
                  </div>
                  {favoriteModels.map((model) => (
                    <ModelRow
                      key={model.id}
                      model={model}
                      isSelected={model.id === value}
                      isFavorite={favorites.has(model.id)}
                      onSelect={handleSelect}
                      onToggleFavorite={handleToggleFavorite}
                    />
                  ))}
                  <div className="my-1.5 border-t border-slate-100 dark:border-slate-800" />
                </div>
              )}

              {/* Grouped by provider */}
              {(Object.entries(grouped) as [Provider, ModelInfo[]][]).map(([provider, models]) => {
                if (models.length === 0) return null;
                const { emoji, label } = PROVIDER_META[provider];
                return (
                  <div key={provider}>
                    <div className="flex items-center gap-1.5 px-3 py-1.5">
                      <span className="text-sm leading-none">{emoji}</span>
                      <span className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">
                        {label}
                      </span>
                    </div>
                    {models.map((model) => (
                      <ModelRow
                        key={model.id}
                        model={model}
                        isSelected={model.id === value}
                        isFavorite={favorites.has(model.id)}
                        onSelect={handleSelect}
                        onToggleFavorite={handleToggleFavorite}
                      />
                    ))}
                  </div>
                );
              })}

              {/* Empty state */}
              {favoriteModels.length === 0 &&
                Object.values(grouped).every((g) => g.length === 0) && (
                <div className="py-8 text-center">
                  <p className="text-sm text-slate-400">No models found</p>
                  <p className="text-xs text-slate-500 mt-1">Try a different search term</p>
                </div>
              )}
            </div>

            {/* Footer legend */}
            <div className="px-3 py-2 border-t border-slate-100 dark:border-slate-800 flex items-center gap-3">
              {(['fast', 'medium', 'slow'] as Latency[]).map((l) => (
                <div key={l} className="flex items-center gap-1">
                  <LatencyDot latency={l} />
                  <span className="text-[10px] text-slate-400">{LATENCY_CONFIG[l].label}</span>
                </div>
              ))}
              <div className="ml-auto flex items-center gap-1">
                <Zap size={10} className="text-slate-400" />
                <span className="text-[10px] text-slate-400">Price per 1M input tokens</span>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

export default ModelSelector;
