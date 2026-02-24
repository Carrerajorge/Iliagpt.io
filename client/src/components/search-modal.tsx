import { useState, useEffect, useRef, useMemo } from "react";
import { Search, X, MessageSquare, Clock, ArrowRight } from "lucide-react";
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

interface SearchResult {
  item: ChatSearchItem;
  score?: number;
  matches?: readonly FuseResultMatch[];
}

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
  const [results, setResults] = useState<SearchResult[]>([]);
  const [selectedIndex, setSelectedIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const debounceRef = useRef<NodeJS.Timeout | null>(null);
  const fuseRef = useRef<Fuse<ChatSearchItem> | null>(null);

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

  useEffect(() => {
    if (!debouncedQuery.trim() || !fuseRef.current) {
      setResults([]);
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

    setResults(sorted);
    setSelectedIndex(0);
  }, [debouncedQuery]);

  const recentChats = useMemo(() => {
    return [...chats]
      .sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime())
      .slice(0, 8);
  }, [chats]);

  useEffect(() => {
    if (open) {
      setQuery("");
      setDebouncedQuery("");
      setResults([]);
      setSelectedIndex(0);
      setTimeout(() => inputRef.current?.focus(), 50);
    } else {
      triggerRef?.current?.focus();
    }
  }, [open, triggerRef]);

  const displayedItems = debouncedQuery.trim() ? results : recentChats.map(c => ({ 
    item: { id: c.id, title: c.title, lastMessage: getLastMessage(c), timestamp: c.timestamp } 
  }));

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setSelectedIndex(prev => Math.min(prev + 1, displayedItems.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setSelectedIndex(prev => Math.max(prev - 1, 0));
    } else if (e.key === "Enter" && displayedItems.length > 0) {
      e.preventDefault();
      handleSelectResult(displayedItems[selectedIndex].item.id);
    }
  };

  const handleSelectResult = (chatId: string) => {
    onSelectChat(chatId);
    onOpenChange(false);
  };

  const getMatchIndices = (result: SearchResult, key: string): readonly RangeTuple[] | undefined => {
    return result.matches?.find(m => m.key === key)?.indices;
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className="max-w-lg p-0 gap-0 overflow-hidden rounded-xl shadow-2xl"
        onKeyDown={handleKeyDown}
        data-testid="modal-search"
      >
        <VisuallyHidden>
          <DialogTitle>Buscar chats</DialogTitle>
          <DialogDescription>Buscar en tus conversaciones</DialogDescription>
        </VisuallyHidden>

        <div className="flex items-center gap-3 px-4 py-3 border-b">
          <Search className="h-4 w-4 text-muted-foreground flex-shrink-0" />
          <Input
            ref={inputRef}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Buscar conversaciones..."
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
        </div>

        <ScrollArea className="max-h-[50vh]">
          <div className="py-2">
            {!debouncedQuery.trim() && recentChats.length > 0 && (
              <>
                <div className="px-4 py-1.5 flex items-center gap-2">
                  <Clock className="h-3.5 w-3.5 text-muted-foreground" />
                  <span className="text-xs font-medium text-muted-foreground">Recientes</span>
                </div>
                {displayedItems.map((result, index) => (
                  <button
                    key={result.item.id}
                    className={cn(
                      "w-full px-4 py-2.5 flex items-center gap-3 transition-colors text-left",
                      selectedIndex === index ? "bg-accent" : "hover:bg-muted/50"
                    )}
                    onClick={() => handleSelectResult(result.item.id)}
                    data-testid={`search-result-${result.item.id}`}
                  >
                    <MessageSquare className="h-4 w-4 text-muted-foreground flex-shrink-0" />
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium truncate">{result.item.title}</p>
                      {result.item.lastMessage && (
                        <p className="text-xs text-muted-foreground truncate mt-0.5">
                          {result.item.lastMessage.slice(0, 60)}
                        </p>
                      )}
                    </div>
                    <span className="text-[10px] text-muted-foreground flex-shrink-0">
                      {formatChatDate(new Date(result.item.timestamp), { timeZone: platformTimeZone, dateFormat: platformDateFormat })}
                    </span>
                  </button>
                ))}
              </>
            )}

            {debouncedQuery.trim() && results.length === 0 && (
              <div className="py-12 text-center">
                <Search className="h-8 w-8 text-muted-foreground/30 mx-auto mb-3" />
                <p className="text-sm text-muted-foreground">Sin resultados para "{debouncedQuery}"</p>
              </div>
            )}

            {debouncedQuery.trim() && results.length > 0 && (
              <>
                <div className="px-4 py-1.5">
                  <span className="text-xs font-medium text-muted-foreground">
                    {results.length} resultado{results.length !== 1 ? "s" : ""}
                  </span>
                </div>
                {results.map((result, index) => (
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
                <p className="text-sm text-muted-foreground">No hay conversaciones aún</p>
              </div>
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
              <kbd className="px-1 py-0.5 bg-background border rounded font-mono">esc</kbd>
              <span>cerrar</span>
            </div>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
