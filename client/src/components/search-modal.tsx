import { useState, useEffect, useRef, useMemo, useCallback } from "react";
import { Search, X, MessageSquare, Clock, ArrowRight, FileText, Database, Filter, Loader2 } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { VisuallyHidden } from "@radix-ui/react-visually-hidden";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { Chat } from "@/hooks/use-chats";
import { usePlatformSettings } from "@/contexts/PlatformSettingsContext";
import { diffZonedDays, formatZonedDate, formatZonedIntl, normalizeTimeZone, type PlatformDateFormat } from "@/lib/platformDateTime";
import Fuse, { FuseResultMatch, IFuseOptions, RangeTuple } from "fuse.js";
import DOMPurify from "dompurify";

interface SearchModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  chats: Chat[];
  onSelectChat: (id: string) => void;
  triggerRef?: React.RefObject<HTMLButtonElement | null>;
}

interface ChatSearchItem {
  id: string;
  title: string;
  lastMessage: string;
  timestamp: number;
}

interface LocalSearchResult {
  item: ChatSearchItem;
  score?: number;
  matches?: readonly FuseResultMatch[];
}

// Server-side hybrid search result types
type HybridResultType = "message" | "chat" | "document";

interface HybridSearchResult {
  id: string;
  type: HybridResultType;
  title: string;
  content: string;
  highlight: string;
  score: number;
  chatId?: string;
  userId?: string;
  createdAt: string;
  metadata?: Record<string, unknown>;
}

interface HybridSearchResponse {
  results: HybridSearchResult[];
  total: number;
  query: string;
  took: number;
}

type SearchMode = "local" | "deep";
type TypeFilter = "all" | "messages" | "chats" | "documents";

const FUSE_OPTIONS: IFuseOptions<ChatSearchItem> = {
  keys: [
    { name: "title", weight: 0.7 },
    { name: "lastMessage", weight: 0.3 },
  ],
  threshold: 0.4,
  includeScore: true,
  includeMatches: true,
  ignoreLocation: true,
  minMatchCharLength: 1,
};

function formatChatDate(date: Date, opts: { timeZone: string; dateFormat: PlatformDateFormat }): string {
  const now = Date.now();
  const diff = diffZonedDays(date, now, opts.timeZone);
  if (diff === 0) return "Hoy";
  if (diff === 1) return "Ayer";
  if (diff !== null && diff > 1 && diff < 7) {
    return (
      formatZonedIntl(date, {
        timeZone: opts.timeZone,
        locale: "es-ES",
        options: { weekday: "long" },
      }) || ""
    );
  }
  return formatZonedDate(date, { timeZone: opts.timeZone, dateFormat: opts.dateFormat, includeYear: false });
}

function getLastMessage(chat: Chat): string {
  const lastMsg = chat.messages[chat.messages.length - 1];
  if (!lastMsg) return "";
  return lastMsg.content.slice(0, 120);
}

function HighlightedText({ text, indices }: { text: string; indices?: readonly RangeTuple[] }) {
  if (!indices || indices.length === 0) {
    return <>{text}</>;
  }

  const parts: React.ReactNode[] = [];
  let lastIndex = 0;

  const sortedIndices = [...indices].sort((a, b) => a[0] - b[0]);

  for (const [start, end] of sortedIndices) {
    if (start > lastIndex) {
      parts.push(<span key={`text-${lastIndex}`}>{text.slice(lastIndex, start)}</span>);
    }
    parts.push(
      <mark key={`mark-${start}`} className="bg-yellow-200/80 dark:bg-yellow-700/60 text-foreground rounded-sm">
        {text.slice(start, end + 1)}
      </mark>
    );
    lastIndex = end + 1;
  }

  if (lastIndex < text.length) {
    parts.push(<span key={`text-${lastIndex}`}>{text.slice(lastIndex)}</span>);
  }

  return <>{parts}</>;
}

/** Renders HTML highlight strings from the server (ts_headline <mark> tags) safely via DOMPurify */
function ServerHighlight({ html }: { html: string }) {
  const sanitized = DOMPurify.sanitize(html, { ALLOWED_TAGS: ["mark"] });
  return (
    <span
      className="[&_mark]:bg-yellow-200/80 [&_mark]:dark:bg-yellow-700/60 [&_mark]:text-foreground [&_mark]:rounded-sm"
      dangerouslySetInnerHTML={{ __html: sanitized }}
    />
  );
}

const TYPE_ICON: Record<HybridResultType, typeof MessageSquare> = {
  message: MessageSquare,
  chat: MessageSquare,
  document: FileText,
};

export function SearchModal({
  open,
  onOpenChange,
  chats,
  onSelectChat,
  triggerRef,
}: SearchModalProps) {
  const { settings: platformSettings } = usePlatformSettings();
  const platformTimeZone = normalizeTimeZone(platformSettings.timezone_default);
  const platformDateFormat = platformSettings.date_format;

  const [query, setQuery] = useState("");
  const [debouncedQuery, setDebouncedQuery] = useState("");
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [searchMode, setSearchMode] = useState<SearchMode>("local");
  const [typeFilter, setTypeFilter] = useState<TypeFilter>("all");
  const [showFilters, setShowFilters] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const debounceRef = useRef<NodeJS.Timeout | null>(null);
  const fuseRef = useRef<Fuse<ChatSearchItem> | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  // Local Fuse.js results
  const [localResults, setLocalResults] = useState<LocalSearchResult[]>([]);

  // Server-side hybrid results
  const [hybridResults, setHybridResults] = useState<HybridSearchResult[]>([]);
  const [hybridTotal, setHybridTotal] = useState(0);
  const [hybridTook, setHybridTook] = useState(0);
  const [hybridLoading, setHybridLoading] = useState(false);

  const searchItems = useMemo<ChatSearchItem[]>(() => {
    return chats.map(chat => ({
      id: chat.id,
      title: chat.title,
      lastMessage: getLastMessage(chat),
      timestamp: chat.timestamp,
    }));
  }, [chats]);

  useEffect(() => {
    fuseRef.current = new Fuse(searchItems, FUSE_OPTIONS);
  }, [searchItems]);

  // Debounce the query
  useEffect(() => {
    if (debounceRef.current) {
      clearTimeout(debounceRef.current);
    }
    debounceRef.current = setTimeout(() => {
      setDebouncedQuery(query);
    }, 300);

    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [query]);

  // Run local Fuse search
  useEffect(() => {
    if (searchMode !== "local" || !debouncedQuery.trim() || !fuseRef.current) {
      setLocalResults([]);
      return;
    }

    const fuseResults = fuseRef.current.search(debouncedQuery);
    const sorted = fuseResults
      .sort((a, b) => {
        const scoreDiff = (a.score ?? 1) - (b.score ?? 1);
        if (Math.abs(scoreDiff) > 0.15) return scoreDiff;
        return new Date(b.item.timestamp).getTime() - new Date(a.item.timestamp).getTime();
      })
      .slice(0, 10);

    setLocalResults(sorted);
    setSelectedIndex(0);
  }, [debouncedQuery, searchMode]);

  // Run server-side hybrid search
  useEffect(() => {
    if (searchMode !== "deep" || !debouncedQuery.trim()) {
      setHybridResults([]);
      setHybridTotal(0);
      setHybridTook(0);
      return;
    }

    // Cancel previous request
    if (abortRef.current) {
      abortRef.current.abort();
    }

    const controller = new AbortController();
    abortRef.current = controller;

    const typeParam = typeFilter === "all" ? "all" : typeFilter === "messages" ? "message" : typeFilter === "chats" ? "chat" : "document";
    const params = new URLSearchParams({
      q: debouncedQuery,
      type: typeParam,
      limit: "20",
    });

    setHybridLoading(true);

    fetch(`/api/search?${params.toString()}`, { signal: controller.signal })
      .then((res) => {
        if (!res.ok) throw new Error(`Search failed: ${res.status}`);
        return res.json() as Promise<HybridSearchResponse>;
      })
      .then((data) => {
        setHybridResults(data.results);
        setHybridTotal(data.total);
        setHybridTook(data.took);
        setSelectedIndex(0);
      })
      .catch((err) => {
        if (err instanceof DOMException && err.name === "AbortError") return;
        console.error("Hybrid search error:", err);
        setHybridResults([]);
      })
      .finally(() => {
        if (!controller.signal.aborted) {
          setHybridLoading(false);
        }
      });

    return () => {
      controller.abort();
    };
  }, [debouncedQuery, searchMode, typeFilter]);

  const recentChats = useMemo(() => {
    return [...chats]
      .sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime())
      .slice(0, 8);
  }, [chats]);

  // Global keyboard shortcut: Ctrl+Shift+F to open the search modal
  useEffect(() => {
    const handleGlobalKeyDown = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.shiftKey && e.key.toLowerCase() === "f") {
        e.preventDefault();
        onOpenChange(true);
      }
    };
    window.addEventListener("keydown", handleGlobalKeyDown);
    return () => window.removeEventListener("keydown", handleGlobalKeyDown);
  }, [onOpenChange]);

  useEffect(() => {
    if (open) {
      setQuery("");
      setDebouncedQuery("");
      setLocalResults([]);
      setHybridResults([]);
      setHybridTotal(0);
      setSelectedIndex(0);
      setShowFilters(false);
      setTimeout(() => inputRef.current?.focus(), 50);
    } else {
      triggerRef?.current?.focus();
    }
  }, [open, triggerRef]);

  // Unified display items count for keyboard navigation
  const displayCount = searchMode === "local"
    ? (debouncedQuery.trim() ? localResults.length : recentChats.length)
    : hybridResults.length;

  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setSelectedIndex(prev => Math.min(prev + 1, displayCount - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setSelectedIndex(prev => Math.max(prev - 1, 0));
    } else if (e.key === "Enter" && displayCount > 0) {
      e.preventDefault();
      if (searchMode === "local") {
        const items = debouncedQuery.trim()
          ? localResults
          : recentChats.map(c => ({ item: { id: c.id, title: c.title, lastMessage: getLastMessage(c), timestamp: c.timestamp } }));
        if (items[selectedIndex]) {
          handleSelectResult(items[selectedIndex].item.id);
        }
      } else {
        const result = hybridResults[selectedIndex];
        if (result) {
          const targetId = result.chatId || result.id;
          handleSelectResult(targetId);
        }
      }
    } else if (e.key === "Tab") {
      e.preventDefault();
      setSearchMode(prev => prev === "local" ? "deep" : "local");
    }
  }, [displayCount, selectedIndex, searchMode, localResults, hybridResults, recentChats, debouncedQuery]);

  const handleSelectResult = useCallback((chatId: string) => {
    onSelectChat(chatId);
    onOpenChange(false);
  }, [onSelectChat, onOpenChange]);

  const getMatchIndices = (result: LocalSearchResult, key: string): readonly RangeTuple[] | undefined => {
    return result.matches?.find(m => m.key === key)?.indices;
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className="max-w-2xl p-0 gap-0 overflow-hidden rounded-xl shadow-2xl"
        onKeyDown={handleKeyDown}
        data-testid="modal-search"
      >
        <VisuallyHidden>
          <DialogTitle>Buscar chats y documentos</DialogTitle>
          <DialogDescription>Buscar en conversaciones, mensajes y documentos</DialogDescription>
        </VisuallyHidden>

        {/* Search input + mode toggle */}
        <div className="flex items-center gap-3 px-4 py-3 border-b">
          <Search className="h-4 w-4 text-muted-foreground flex-shrink-0" />
          <Input
            ref={inputRef}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={searchMode === "local" ? "Buscar conversaciones..." : "Buscar en todo (mensajes, chats, documentos)..."}
            className="border-0 focus-visible:ring-0 focus-visible:ring-offset-0 p-0 h-8 text-sm bg-transparent"
            data-testid="input-search-modal"
          />
          {query && (
            <Button
              variant="ghost"
              size="icon"
              className="h-6 w-6 flex-shrink-0"
              onClick={() => setQuery("")}
              data-testid="button-clear-search"
            >
              <X className="h-3.5 w-3.5" />
            </Button>
          )}
          {searchMode === "deep" && (
            <Button
              variant="ghost"
              size="icon"
              className={cn("h-6 w-6 flex-shrink-0", showFilters && "bg-accent")}
              onClick={() => setShowFilters(prev => !prev)}
              data-testid="button-toggle-filters"
            >
              <Filter className="h-3.5 w-3.5" />
            </Button>
          )}
        </div>

        {/* Mode tabs */}
        <div className="flex items-center gap-1 px-4 py-1.5 border-b bg-muted/30">
          <button
            className={cn(
              "px-2.5 py-1 text-xs rounded-md transition-colors",
              searchMode === "local" ? "bg-background text-foreground shadow-sm font-medium" : "text-muted-foreground hover:text-foreground"
            )}
            onClick={() => setSearchMode("local")}
          >
            Rapida
          </button>
          <button
            className={cn(
              "px-2.5 py-1 text-xs rounded-md transition-colors flex items-center gap-1.5",
              searchMode === "deep" ? "bg-background text-foreground shadow-sm font-medium" : "text-muted-foreground hover:text-foreground"
            )}
            onClick={() => setSearchMode("deep")}
          >
            <Database className="h-3 w-3" />
            Profunda
          </button>
          {searchMode === "deep" && hybridTook > 0 && (
            <span className="ml-auto text-[10px] text-muted-foreground">
              {hybridTotal} resultado{hybridTotal !== 1 ? "s" : ""} en {hybridTook}ms
            </span>
          )}
        </div>

        {/* Type filters (deep mode only) */}
        {searchMode === "deep" && showFilters && (
          <div className="flex items-center gap-1.5 px-4 py-2 border-b bg-muted/10">
            {(["all", "messages", "chats", "documents"] as TypeFilter[]).map((t) => (
              <button
                key={t}
                className={cn(
                  "px-2 py-0.5 text-[11px] rounded-full border transition-colors",
                  typeFilter === t
                    ? "bg-primary text-primary-foreground border-primary"
                    : "text-muted-foreground border-border hover:border-foreground/30"
                )}
                onClick={() => setTypeFilter(t)}
              >
                {t === "all" ? "Todo" : t === "messages" ? "Mensajes" : t === "chats" ? "Chats" : "Documentos"}
              </button>
            ))}
          </div>
        )}

        <ScrollArea className="max-h-[50vh]">
          <div className="py-2">
            {/* LOCAL MODE */}
            {searchMode === "local" && (
              <>
                {!debouncedQuery.trim() && recentChats.length > 0 && (
                  <>
                    <div className="px-4 py-1.5 flex items-center gap-2">
                      <Clock className="h-3.5 w-3.5 text-muted-foreground" />
                      <span className="text-xs font-medium text-muted-foreground">Recientes</span>
                    </div>
                    {recentChats.map((chat, index) => (
                      <button
                        key={chat.id}
                        className={cn(
                          "w-full px-4 py-2.5 flex items-center gap-3 transition-colors text-left",
                          selectedIndex === index ? "bg-accent" : "hover:bg-muted/50"
                        )}
                        onClick={() => handleSelectResult(chat.id)}
                        data-testid={`search-result-${chat.id}`}
                      >
                        <MessageSquare className="h-4 w-4 text-muted-foreground flex-shrink-0" />
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-medium truncate">{chat.title}</p>
                          {getLastMessage(chat) && (
                            <p className="text-xs text-muted-foreground truncate mt-0.5">
                              {getLastMessage(chat).slice(0, 60)}
                            </p>
                          )}
                        </div>
                        <span className="text-[10px] text-muted-foreground flex-shrink-0">
                          {formatChatDate(new Date(chat.timestamp), { timeZone: platformTimeZone, dateFormat: platformDateFormat })}
                        </span>
                      </button>
                    ))}
                  </>
                )}

                {debouncedQuery.trim() && localResults.length === 0 && (
                  <div className="py-12 text-center">
                    <Search className="h-8 w-8 text-muted-foreground/30 mx-auto mb-3" />
                    <p className="text-sm text-muted-foreground">Sin resultados para &quot;{debouncedQuery}&quot;</p>
                    <button
                      className="mt-2 text-xs text-primary hover:underline"
                      onClick={() => setSearchMode("deep")}
                    >
                      Probar busqueda profunda
                    </button>
                  </div>
                )}

                {debouncedQuery.trim() && localResults.length > 0 && (
                  <>
                    <div className="px-4 py-1.5">
                      <span className="text-xs font-medium text-muted-foreground">
                        {localResults.length} resultado{localResults.length !== 1 ? "s" : ""}
                      </span>
                    </div>
                    {localResults.map((result, index) => (
                      <button
                        key={result.item.id}
                        className={cn(
                          "w-full px-4 py-2.5 flex items-center gap-3 transition-colors text-left group",
                          selectedIndex === index ? "bg-accent" : "hover:bg-muted/50"
                        )}
                        onClick={() => handleSelectResult(result.item.id)}
                        data-testid={`search-result-${result.item.id}`}
                      >
                        <MessageSquare className="h-4 w-4 text-muted-foreground flex-shrink-0" />
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-medium truncate">
                            <HighlightedText
                              text={result.item.title}
                              indices={getMatchIndices(result, "title")}
                            />
                          </p>
                          {result.item.lastMessage && (
                            <p className="text-xs text-muted-foreground truncate mt-0.5">
                              <HighlightedText
                                text={result.item.lastMessage.slice(0, 80)}
                                indices={getMatchIndices(result, "lastMessage")}
                              />
                            </p>
                          )}
                        </div>
                        <div className="flex items-center gap-2 flex-shrink-0">
                          <span className="text-[10px] text-muted-foreground">
                            {formatChatDate(new Date(result.item.timestamp), { timeZone: platformTimeZone, dateFormat: platformDateFormat })}
                          </span>
                          <ArrowRight className="h-3.5 w-3.5 text-muted-foreground opacity-0 group-hover:opacity-100 transition-opacity" />
                        </div>
                      </button>
                    ))}
                  </>
                )}

                {!debouncedQuery.trim() && recentChats.length === 0 && (
                  <div className="py-12 text-center">
                    <MessageSquare className="h-8 w-8 text-muted-foreground/30 mx-auto mb-3" />
                    <p className="text-sm text-muted-foreground">No hay conversaciones aun</p>
                  </div>
                )}
              </>
            )}

            {/* DEEP (HYBRID) MODE */}
            {searchMode === "deep" && (
              <>
                {hybridLoading && (
                  <div className="py-12 text-center">
                    <Loader2 className="h-6 w-6 animate-spin text-muted-foreground mx-auto mb-3" />
                    <p className="text-sm text-muted-foreground">Buscando en mensajes, chats y documentos...</p>
                  </div>
                )}

                {!hybridLoading && !debouncedQuery.trim() && (
                  <div className="py-12 text-center">
                    <Database className="h-8 w-8 text-muted-foreground/30 mx-auto mb-3" />
                    <p className="text-sm text-muted-foreground">Escribe para buscar con IA en todos tus datos</p>
                    <p className="text-[11px] text-muted-foreground/60 mt-1">Combina busqueda textual + semantica</p>
                  </div>
                )}

                {!hybridLoading && debouncedQuery.trim() && hybridResults.length === 0 && (
                  <div className="py-12 text-center">
                    <Search className="h-8 w-8 text-muted-foreground/30 mx-auto mb-3" />
                    <p className="text-sm text-muted-foreground">Sin resultados para &quot;{debouncedQuery}&quot;</p>
                  </div>
                )}

                {!hybridLoading && hybridResults.length > 0 && (
                  <>
                    {hybridResults.map((result, index) => {
                      const Icon = TYPE_ICON[result.type];
                      return (
                        <button
                          key={`${result.type}-${result.id}`}
                          className={cn(
                            "w-full px-4 py-2.5 flex items-start gap-3 transition-colors text-left group",
                            selectedIndex === index ? "bg-accent" : "hover:bg-muted/50"
                          )}
                          onClick={() => handleSelectResult(result.chatId || result.id)}
                          data-testid={`hybrid-result-${result.id}`}
                        >
                          <div className="mt-0.5 flex-shrink-0">
                            <Icon className="h-4 w-4 text-muted-foreground" />
                          </div>
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-2">
                              <span className={cn(
                                "text-[10px] px-1.5 py-0.5 rounded-full font-medium",
                                result.type === "message" && "bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300",
                                result.type === "chat" && "bg-green-100 text-green-700 dark:bg-green-900/40 dark:text-green-300",
                                result.type === "document" && "bg-purple-100 text-purple-700 dark:bg-purple-900/40 dark:text-purple-300",
                              )}>
                                {result.type === "message" ? "Mensaje" : result.type === "chat" ? "Chat" : "Documento"}
                              </span>
                              <span className="text-[10px] text-muted-foreground">
                                {formatChatDate(new Date(result.createdAt), { timeZone: platformTimeZone, dateFormat: platformDateFormat })}
                              </span>
                            </div>
                            <p className="text-sm font-medium truncate mt-1">{result.title}</p>
                            {result.highlight && (
                              <p className="text-xs text-muted-foreground mt-0.5 line-clamp-2">
                                <ServerHighlight html={result.highlight} />
                              </p>
                            )}
                          </div>
                          <div className="flex-shrink-0 mt-0.5">
                            <ArrowRight className="h-3.5 w-3.5 text-muted-foreground opacity-0 group-hover:opacity-100 transition-opacity" />
                          </div>
                        </button>
                      );
                    })}
                  </>
                )}
              </>
            )}
          </div>
        </ScrollArea>

        <div className="border-t px-4 py-2 flex items-center justify-between text-[10px] text-muted-foreground bg-muted/20">
          <div className="flex items-center gap-4">
            <div className="flex items-center gap-1">
              <kbd className="px-1 py-0.5 bg-background border rounded font-mono">↑↓</kbd>
              <span>navegar</span>
            </div>
            <div className="flex items-center gap-1">
              <kbd className="px-1 py-0.5 bg-background border rounded font-mono">↵</kbd>
              <span>seleccionar</span>
            </div>
            <div className="flex items-center gap-1">
              <kbd className="px-1 py-0.5 bg-background border rounded font-mono">Tab</kbd>
              <span>{searchMode === "local" ? "profunda" : "rapida"}</span>
            </div>
            <div className="flex items-center gap-1">
              <kbd className="px-1 py-0.5 bg-background border rounded font-mono">esc</kbd>
              <span>cerrar</span>
            </div>
            <div className="flex items-center gap-1">
              <kbd className="px-1 py-0.5 bg-background border rounded font-mono">Ctrl+Shift+F</kbd>
              <span>abrir</span>
            </div>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
