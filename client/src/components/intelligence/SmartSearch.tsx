import {
  memo,
  useCallback,
  useRef,
  useState,
  useEffect,
  useMemo,
} from "react";
import { motion, AnimatePresence } from "framer-motion";
import { useQuery } from "@tanstack/react-query";
import {
  Search,
  X,
  FileText,
  MessageSquare,
  Brain,
  Globe,
  Code2,
  Layers,
  Calendar,
  Clock,
  Tag,
  Info,
  ChevronRight,
  Sparkles,
  History,
  Loader2,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";

// ─── Types ────────────────────────────────────────────────────────────────────

type SearchSourceType =
  | "conversations"
  | "documents"
  | "memory"
  | "web"
  | "code"
  | "all";

interface SearchResult {
  id: string;
  type: SearchSourceType;
  title: string;
  content: string;
  score: number;
  date?: Date;
  url?: string;
  tags?: string[];
  metadata?: Record<string, any>;
  highlights?: string[];
}

interface SearchFilters {
  types: SearchSourceType[];
  dateFrom?: Date;
  dateTo?: Date;
  minScore: number;
}

interface SmartSearchProps {
  isOpen: boolean;
  onClose: () => void;
  onResultSelect?: (result: SearchResult) => void;
  defaultQuery?: string;
  className?: string;
}

// ─── Constants ────────────────────────────────────────────────────────────────

const SOURCE_CONFIG: Record<
  SearchSourceType,
  { label: string; icon: React.ComponentType<{ className?: string }>; color: string; bg: string }
> = {
  all: { label: "All", icon: Layers, color: "text-slate-600", bg: "bg-slate-100" },
  conversations: {
    label: "Conversations",
    icon: MessageSquare,
    color: "text-blue-600",
    bg: "bg-blue-100",
  },
  documents: {
    label: "Documents",
    icon: FileText,
    color: "text-amber-600",
    bg: "bg-amber-100",
  },
  memory: { label: "Memory", icon: Brain, color: "text-violet-600", bg: "bg-violet-100" },
  web: { label: "Web", icon: Globe, color: "text-emerald-600", bg: "bg-emerald-100" },
  code: { label: "Code", icon: Code2, color: "text-rose-600", bg: "bg-rose-100" },
};

const MOCK_COUNTS: Record<SearchSourceType, number> = {
  all: 0,
  conversations: 0,
  documents: 0,
  memory: 0,
  web: 0,
  code: 0,
};

const SEARCH_HISTORY_KEY = "iliagpt_search_history";

// ─── Utility ─────────────────────────────────────────────────────────────────

function useDebounce<T>(value: T, delay: number): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const id = setTimeout(() => setDebounced(value), delay);
    return () => clearTimeout(id);
  }, [value, delay]);
  return debounced;
}

function highlightText(text: string, highlights: string[]): React.ReactNode {
  if (!highlights.length) return text;
  const escaped = highlights.map((h) => h.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
  const regex = new RegExp(`(${escaped.join("|")})`, "gi");
  const parts = text.split(regex);
  return (
    <>
      {parts.map((part, i) =>
        regex.test(part) ? (
          <mark
            key={i}
            className="bg-yellow-200 dark:bg-yellow-800/60 text-inherit rounded-sm font-semibold px-0.5"
          >
            {part}
          </mark>
        ) : (
          <span key={i}>{part}</span>
        )
      )}
    </>
  );
}

function formatDate(date?: Date): string {
  if (!date) return "";
  const d = date instanceof Date ? date : new Date(date);
  return d.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
}

function loadHistory(): string[] {
  try {
    return JSON.parse(localStorage.getItem(SEARCH_HISTORY_KEY) ?? "[]");
  } catch {
    return [];
  }
}

function saveHistory(queries: string[]): void {
  try {
    localStorage.setItem(SEARCH_HISTORY_KEY, JSON.stringify(queries.slice(0, 10)));
  } catch {
    // ignore
  }
}

// ─── Sub-components ───────────────────────────────────────────────────────────

const SourceChip = memo(
  ({
    source,
    active,
    count,
    onClick,
  }: {
    source: SearchSourceType;
    active: boolean;
    count: number;
    onClick: () => void;
  }) => {
    const cfg = SOURCE_CONFIG[source];
    const Icon = cfg.icon;
    return (
      <button
        onClick={onClick}
        className={cn(
          "flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-medium transition-all duration-150 border select-none",
          active
            ? `${cfg.bg} ${cfg.color} border-transparent ring-2 ring-offset-1 ring-current/30`
            : "bg-white dark:bg-zinc-800 text-zinc-500 border-zinc-200 dark:border-zinc-700 hover:bg-zinc-50 dark:hover:bg-zinc-700"
        )}
      >
        <Icon className="w-3.5 h-3.5" />
        {cfg.label}
        {count > 0 && (
          <span
            className={cn(
              "rounded-full px-1.5 py-0.5 text-[10px] leading-none font-bold",
              active ? "bg-white/60 text-current" : "bg-zinc-100 dark:bg-zinc-700 text-zinc-500"
            )}
          >
            {count}
          </span>
        )}
      </button>
    );
  }
);
SourceChip.displayName = "SourceChip";

const ScoreBar = memo(({ score }: { score: number }) => {
  const pct = Math.round(score * 100);
  const color =
    pct >= 80
      ? "bg-emerald-400"
      : pct >= 60
      ? "bg-amber-400"
      : pct >= 40
      ? "bg-orange-400"
      : "bg-rose-400";
  return (
    <div className="flex items-center gap-1.5">
      <div className="w-16 h-1.5 bg-zinc-100 dark:bg-zinc-700 rounded-full overflow-hidden">
        <div
          className={cn("h-full rounded-full transition-all", color)}
          style={{ width: `${pct}%` }}
        />
      </div>
      <span className="text-[10px] text-zinc-400">{pct}%</span>
    </div>
  );
});
ScoreBar.displayName = "ScoreBar";

const ResultCard = memo(
  ({
    result,
    isActive,
    onClick,
  }: {
    result: SearchResult;
    isActive: boolean;
    onClick: () => void;
  }) => {
    const cfg = SOURCE_CONFIG[result.type];
    const Icon = cfg.icon;
    const highlights = result.highlights ?? [];

    return (
      <motion.div
        layout
        initial={{ opacity: 0, y: 6 }}
        animate={{ opacity: 1, y: 0 }}
        exit={{ opacity: 0, y: -6 }}
        transition={{ duration: 0.15 }}
        onClick={onClick}
        className={cn(
          "group flex gap-3 p-3 rounded-xl border cursor-pointer transition-all duration-150 select-none",
          isActive
            ? "bg-blue-50 dark:bg-blue-900/20 border-blue-200 dark:border-blue-700 shadow-sm"
            : "bg-white dark:bg-zinc-800/80 border-zinc-100 dark:border-zinc-700/60 hover:bg-zinc-50 dark:hover:bg-zinc-700/50 hover:border-zinc-200 dark:hover:border-zinc-600"
        )}
      >
        {/* Icon */}
        <div
          className={cn(
            "flex-shrink-0 w-9 h-9 rounded-lg flex items-center justify-center",
            cfg.bg
          )}
        >
          <Icon className={cn("w-4.5 h-4.5", cfg.color)} />
        </div>

        {/* Content */}
        <div className="flex-1 min-w-0">
          <div className="flex items-start justify-between gap-2 mb-0.5">
            <h4 className="text-sm font-semibold text-zinc-800 dark:text-zinc-100 truncate leading-tight">
              {highlightText(result.title, highlights)}
            </h4>
            <ChevronRight
              className={cn(
                "w-4 h-4 flex-shrink-0 mt-0.5 transition-opacity",
                isActive ? "opacity-100 text-blue-500" : "opacity-0 group-hover:opacity-50 text-zinc-400"
              )}
            />
          </div>

          <p className="text-xs text-zinc-500 dark:text-zinc-400 line-clamp-2 leading-relaxed mb-2">
            {highlightText(result.content, highlights)}
          </p>

          <div className="flex items-center flex-wrap gap-2">
            <Badge
              variant="secondary"
              className={cn("text-[10px] px-1.5 py-0.5 h-auto font-medium", cfg.bg, cfg.color, "border-0")}
            >
              {cfg.label}
            </Badge>

            {result.date && (
              <span className="flex items-center gap-0.5 text-[10px] text-zinc-400">
                <Clock className="w-3 h-3" />
                {formatDate(result.date)}
              </span>
            )}

            {result.tags?.slice(0, 2).map((tag) => (
              <span
                key={tag}
                className="flex items-center gap-0.5 text-[10px] text-zinc-400 bg-zinc-100 dark:bg-zinc-700 px-1.5 py-0.5 rounded-full"
              >
                <Tag className="w-2.5 h-2.5" />
                {tag}
              </span>
            ))}

            <div className="ml-auto">
              <ScoreBar score={result.score} />
            </div>
          </div>
        </div>
      </motion.div>
    );
  }
);
ResultCard.displayName = "ResultCard";

const SkeletonCard = memo(() => (
  <div className="flex gap-3 p-3 rounded-xl border border-zinc-100 dark:border-zinc-700/60 bg-white dark:bg-zinc-800/80 animate-pulse">
    <div className="flex-shrink-0 w-9 h-9 rounded-lg bg-zinc-100 dark:bg-zinc-700" />
    <div className="flex-1 space-y-2">
      <div className="h-4 bg-zinc-100 dark:bg-zinc-700 rounded w-3/4" />
      <div className="h-3 bg-zinc-100 dark:bg-zinc-700 rounded w-full" />
      <div className="h-3 bg-zinc-100 dark:bg-zinc-700 rounded w-2/3" />
    </div>
  </div>
));
SkeletonCard.displayName = "SkeletonCard";

const DateFilterPopover = memo(
  ({
    filters,
    onChange,
  }: {
    filters: SearchFilters;
    onChange: (f: Partial<SearchFilters>) => void;
  }) => {
    const [open, setOpen] = useState(false);
    const fromStr = filters.dateFrom ? filters.dateFrom.toISOString().slice(0, 10) : "";
    const toStr = filters.dateTo ? filters.dateTo.toISOString().slice(0, 10) : "";
    const hasFilter = !!filters.dateFrom || !!filters.dateTo;

    return (
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <button
            className={cn(
              "flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-medium border transition-all duration-150",
              hasFilter
                ? "bg-blue-50 dark:bg-blue-900/20 text-blue-600 border-blue-300 dark:border-blue-700"
                : "bg-white dark:bg-zinc-800 text-zinc-500 border-zinc-200 dark:border-zinc-700 hover:bg-zinc-50 dark:hover:bg-zinc-700"
            )}
          >
            <Calendar className="w-3.5 h-3.5" />
            {hasFilter ? "Date filtered" : "Date range"}
          </button>
        </PopoverTrigger>
        <PopoverContent className="w-64 p-4" align="start">
          <div className="space-y-3">
            <h4 className="text-sm font-semibold text-zinc-800 dark:text-zinc-100">Date Range</h4>
            <div className="space-y-2">
              <label className="text-xs text-zinc-500">From</label>
              <Input
                type="date"
                value={fromStr}
                onChange={(e) =>
                  onChange({ dateFrom: e.target.value ? new Date(e.target.value) : undefined })
                }
                className="h-8 text-xs"
              />
            </div>
            <div className="space-y-2">
              <label className="text-xs text-zinc-500">To</label>
              <Input
                type="date"
                value={toStr}
                onChange={(e) =>
                  onChange({ dateTo: e.target.value ? new Date(e.target.value) : undefined })
                }
                className="h-8 text-xs"
              />
            </div>
            {hasFilter && (
              <Button
                variant="ghost"
                size="sm"
                className="w-full text-xs text-zinc-500"
                onClick={() => {
                  onChange({ dateFrom: undefined, dateTo: undefined });
                  setOpen(false);
                }}
              >
                Clear dates
              </Button>
            )}
          </div>
        </PopoverContent>
      </Popover>
    );
  }
);
DateFilterPopover.displayName = "DateFilterPopover";

// ─── Main Component ───────────────────────────────────────────────────────────

export const SmartSearch = memo(
  ({ isOpen, onClose, onResultSelect, defaultQuery = "", className }: SmartSearchProps) => {
    const inputRef = useRef<HTMLInputElement>(null);
    const listRef = useRef<HTMLDivElement>(null);
    const [query, setQuery] = useState(defaultQuery);
    const [activeIndex, setActiveIndex] = useState(0);
    const [filters, setFilters] = useState<SearchFilters>({
      types: ["all"],
      minScore: 0,
    });
    const [history, setHistory] = useState<string[]>(() => loadHistory());
    const [activeSource, setActiveSource] = useState<SearchSourceType>("all");

    const debouncedQuery = useDebounce(query, 300);

    // Global Cmd+K listener
    useEffect(() => {
      const handler = (e: KeyboardEvent) => {
        if ((e.metaKey || e.ctrlKey) && e.key === "k") {
          e.preventDefault();
          // Caller handles isOpen toggle; this is a safety valve
        }
      };
      window.addEventListener("keydown", handler);
      return () => window.removeEventListener("keydown", handler);
    }, []);

    // Focus input when opened
    useEffect(() => {
      if (isOpen) {
        setTimeout(() => inputRef.current?.focus(), 60);
        setQuery(defaultQuery);
        setActiveIndex(0);
      }
    }, [isOpen, defaultQuery]);

    // Fetch results
    const { data, isLoading } = useQuery<{ results: SearchResult[]; counts: Record<SearchSourceType, number> }>({
      queryKey: ["/api/search/rag", debouncedQuery, filters],
      queryFn: () =>
        fetch("/api/search/rag", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ query: debouncedQuery, filters }),
        }).then((r) => r.json()),
      enabled: debouncedQuery.length > 2,
    });

    const results: SearchResult[] = useMemo(() => {
      if (!data?.results) return [];
      if (activeSource === "all") return data.results;
      return data.results.filter((r) => r.type === activeSource);
    }, [data, activeSource]);

    const counts: Record<SearchSourceType, number> = useMemo(
      () => ({ ...MOCK_COUNTS, ...data?.counts }),
      [data]
    );

    // Keyboard navigation
    useEffect(() => {
      if (!isOpen) return;
      const handler = (e: KeyboardEvent) => {
        if (e.key === "Escape") {
          onClose();
          return;
        }
        if (e.key === "ArrowDown") {
          e.preventDefault();
          setActiveIndex((i) => Math.min(i + 1, results.length - 1));
        }
        if (e.key === "ArrowUp") {
          e.preventDefault();
          setActiveIndex((i) => Math.max(i - 1, 0));
        }
        if (e.key === "Enter" && results[activeIndex]) {
          e.preventDefault();
          handleSelect(results[activeIndex]);
        }
      };
      window.addEventListener("keydown", handler);
      return () => window.removeEventListener("keydown", handler);
    }, [isOpen, results, activeIndex]);

    // Scroll active item into view
    useEffect(() => {
      if (!listRef.current) return;
      const active = listRef.current.querySelector(`[data-idx="${activeIndex}"]`);
      active?.scrollIntoView({ block: "nearest" });
    }, [activeIndex]);

    const handleSelect = useCallback(
      (result: SearchResult) => {
        onResultSelect?.(result);
        // Persist query to history
        setHistory((prev) => {
          const next = [query, ...prev.filter((q) => q !== query)].slice(0, 10);
          saveHistory(next);
          return next;
        });
        onClose();
      },
      [onResultSelect, query, onClose]
    );

    const removeFromHistory = useCallback((item: string) => {
      setHistory((prev) => {
        const next = prev.filter((q) => q !== item);
        saveHistory(next);
        return next;
      });
    }, []);

    const updateFilters = useCallback((partial: Partial<SearchFilters>) => {
      setFilters((prev) => ({ ...prev, ...partial }));
    }, []);

    const showResults = debouncedQuery.length > 2;
    const showHistory = !showResults && history.length > 0;
    const showEmpty = showResults && !isLoading && results.length === 0;

    return (
      <AnimatePresence>
        {isOpen && (
          <>
            {/* Backdrop */}
            <motion.div
              key="backdrop"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.15 }}
              onClick={onClose}
              className="fixed inset-0 z-50 bg-black/50 backdrop-blur-sm"
            />

            {/* Dialog */}
            <motion.div
              key="dialog"
              initial={{ opacity: 0, scale: 0.96, y: -12 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.96, y: -12 }}
              transition={{ duration: 0.18, ease: [0.16, 1, 0.3, 1] }}
              className={cn(
                "fixed left-1/2 top-[10vh] z-50 w-full max-w-2xl -translate-x-1/2",
                "flex flex-col bg-white dark:bg-zinc-900 rounded-2xl shadow-2xl border border-zinc-200 dark:border-zinc-700 overflow-hidden",
                className
              )}
              style={{ maxHeight: "80vh" }}
            >
              {/* Search bar */}
              <div className="flex items-center gap-3 px-4 py-3 border-b border-zinc-100 dark:border-zinc-800">
                <Search className="w-5 h-5 flex-shrink-0 text-zinc-400" />
                <input
                  ref={inputRef}
                  value={query}
                  onChange={(e) => {
                    setQuery(e.target.value);
                    setActiveIndex(0);
                  }}
                  placeholder="Search conversations, documents, memory…"
                  className="flex-1 bg-transparent text-base text-zinc-800 dark:text-zinc-100 placeholder:text-zinc-400 outline-none"
                />
                <div className="flex items-center gap-2 flex-shrink-0">
                  {isLoading && <Loader2 className="w-4 h-4 text-zinc-400 animate-spin" />}
                  <kbd className="hidden sm:flex items-center gap-0.5 px-1.5 py-0.5 rounded text-[10px] font-mono bg-zinc-100 dark:bg-zinc-800 text-zinc-400 border border-zinc-200 dark:border-zinc-700">
                    <span>⌘</span>K
                  </kbd>
                  {query && (
                    <button
                      onClick={() => { setQuery(""); inputRef.current?.focus(); }}
                      className="p-0.5 rounded hover:bg-zinc-100 dark:hover:bg-zinc-800 text-zinc-400 transition-colors"
                    >
                      <X className="w-4 h-4" />
                    </button>
                  )}
                </div>
              </div>

              {/* Filters row */}
              <div className="flex items-center gap-2 px-4 py-2.5 bg-zinc-50 dark:bg-zinc-800/50 border-b border-zinc-100 dark:border-zinc-800 overflow-x-auto">
                {(["all", "conversations", "documents", "memory", "web", "code"] as SearchSourceType[]).map(
                  (src) => (
                    <SourceChip
                      key={src}
                      source={src}
                      active={activeSource === src}
                      count={src === "all" ? Object.values(counts).reduce((a, b) => a + b, 0) : counts[src]}
                      onClick={() => { setActiveSource(src); setActiveIndex(0); }}
                    />
                  )
                )}
                <div className="ml-2 flex-shrink-0">
                  <DateFilterPopover filters={filters} onChange={updateFilters} />
                </div>
              </div>

              {/* Semantic hint */}
              {showResults && (
                <div className="flex items-center gap-1.5 px-4 pt-2.5 pb-0">
                  <div className="flex items-center gap-1.5 text-[11px] text-zinc-400">
                    <Sparkles className="w-3 h-3 text-violet-400" />
                    Searching by meaning, not just keywords
                  </div>
                  {data?.results && (
                    <span className="ml-auto text-[11px] text-zinc-400">
                      {results.length} result{results.length !== 1 ? "s" : ""}
                    </span>
                  )}
                </div>
              )}

              {/* Body */}
              <ScrollArea className="flex-1 min-h-0">
                <div ref={listRef} className="p-3 space-y-2">

                  {/* Loading skeletons */}
                  {isLoading && (
                    <div className="space-y-2 pt-1">
                      {[...Array(4)].map((_, i) => <SkeletonCard key={i} />)}
                    </div>
                  )}

                  {/* Results */}
                  {!isLoading && showResults && (
                    <AnimatePresence mode="popLayout">
                      {results.map((result, idx) => (
                        <div key={result.id} data-idx={idx}>
                          <ResultCard
                            result={result}
                            isActive={idx === activeIndex}
                            onClick={() => handleSelect(result)}
                          />
                        </div>
                      ))}
                    </AnimatePresence>
                  )}

                  {/* Empty state */}
                  {showEmpty && (
                    <motion.div
                      initial={{ opacity: 0 }}
                      animate={{ opacity: 1 }}
                      className="flex flex-col items-center gap-3 py-12 text-center"
                    >
                      <div className="w-12 h-12 rounded-2xl bg-zinc-100 dark:bg-zinc-800 flex items-center justify-center">
                        <Search className="w-5 h-5 text-zinc-400" />
                      </div>
                      <div>
                        <p className="text-sm font-medium text-zinc-600 dark:text-zinc-400">
                          No results for &ldquo;{query}&rdquo;
                        </p>
                        <div className="mt-3 space-y-1.5 text-xs text-zinc-400 flex flex-col items-center">
                          <span className="flex items-center gap-1.5">
                            <Info className="w-3.5 h-3.5" /> Try broader search terms
                          </span>
                          <span className="flex items-center gap-1.5">
                            <Info className="w-3.5 h-3.5" /> Check your source filters
                          </span>
                          <span className="flex items-center gap-1.5">
                            <Info className="w-3.5 h-3.5" /> Use natural language queries
                          </span>
                        </div>
                      </div>
                    </motion.div>
                  )}

                  {/* History */}
                  {showHistory && (
                    <div className="pt-1">
                      <div className="flex items-center gap-2 mb-2 px-1">
                        <History className="w-3.5 h-3.5 text-zinc-400" />
                        <span className="text-xs font-medium text-zinc-400 uppercase tracking-wider">
                          Recent searches
                        </span>
                      </div>
                      <div className="flex flex-wrap gap-2">
                        {history.map((item) => (
                          <div key={item} className="flex items-center gap-0.5">
                            <button
                              onClick={() => { setQuery(item); inputRef.current?.focus(); }}
                              className="flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-zinc-100 dark:bg-zinc-800 text-xs text-zinc-600 dark:text-zinc-400 hover:bg-zinc-200 dark:hover:bg-zinc-700 transition-colors"
                            >
                              <Search className="w-3 h-3" />
                              {item}
                            </button>
                            <button
                              onClick={() => removeFromHistory(item)}
                              className="p-1 text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-300 transition-colors"
                            >
                              <X className="w-3 h-3" />
                            </button>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* Initial empty state (no query) */}
                  {!showResults && !showHistory && (
                    <motion.div
                      initial={{ opacity: 0 }}
                      animate={{ opacity: 1 }}
                      className="flex flex-col items-center gap-3 py-12 text-center"
                    >
                      <div className="w-14 h-14 rounded-2xl bg-gradient-to-br from-violet-100 to-blue-100 dark:from-violet-900/30 dark:to-blue-900/30 flex items-center justify-center">
                        <Sparkles className="w-6 h-6 text-violet-500" />
                      </div>
                      <div>
                        <p className="text-sm font-medium text-zinc-700 dark:text-zinc-300">
                          Semantic search across all your data
                        </p>
                        <p className="text-xs text-zinc-400 mt-1">
                          Type at least 3 characters to start searching
                        </p>
                      </div>
                      <div className="grid grid-cols-3 gap-2 mt-2 w-full max-w-sm">
                        {(
                          [
                            "conversations",
                            "documents",
                            "memory",
                          ] as SearchSourceType[]
                        ).map((src) => {
                          const cfg = SOURCE_CONFIG[src];
                          const Icon = cfg.icon;
                          return (
                            <button
                              key={src}
                              onClick={() => { setActiveSource(src); inputRef.current?.focus(); }}
                              className={cn(
                                "flex flex-col items-center gap-1.5 p-3 rounded-xl border text-xs font-medium transition-all",
                                "bg-white dark:bg-zinc-800 border-zinc-100 dark:border-zinc-700 hover:border-zinc-300 dark:hover:border-zinc-600"
                              )}
                            >
                              <div className={cn("w-8 h-8 rounded-lg flex items-center justify-center", cfg.bg)}>
                                <Icon className={cn("w-4 h-4", cfg.color)} />
                              </div>
                              <span className="text-zinc-600 dark:text-zinc-400">{cfg.label}</span>
                            </button>
                          );
                        })}
                      </div>
                    </motion.div>
                  )}
                </div>
              </ScrollArea>

              {/* Footer */}
              <div className="flex items-center justify-between px-4 py-2 border-t border-zinc-100 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-800/50">
                <div className="flex items-center gap-3 text-[11px] text-zinc-400">
                  <span className="flex items-center gap-1">
                    <kbd className="px-1 py-0.5 rounded bg-zinc-200 dark:bg-zinc-700 font-mono text-[10px]">↑↓</kbd>
                    navigate
                  </span>
                  <span className="flex items-center gap-1">
                    <kbd className="px-1 py-0.5 rounded bg-zinc-200 dark:bg-zinc-700 font-mono text-[10px]">↵</kbd>
                    select
                  </span>
                  <span className="flex items-center gap-1">
                    <kbd className="px-1 py-0.5 rounded bg-zinc-200 dark:bg-zinc-700 font-mono text-[10px]">esc</kbd>
                    close
                  </span>
                </div>
                <div className="flex items-center gap-1 text-[11px] text-zinc-400">
                  <Brain className="w-3 h-3 text-violet-400" />
                  Powered by RAG
                </div>
              </div>
            </motion.div>
          </>
        )}
      </AnimatePresence>
    );
  }
);
SmartSearch.displayName = "SmartSearch";

export default SmartSearch;
