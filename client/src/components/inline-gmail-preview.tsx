import { useState, useEffect, useCallback, useRef } from "react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import { EmailListSkeleton, ThreadSkeleton, Skeleton } from "@/components/ui/skeleton";
import { 
  Loader2, Mail, Search, RefreshCw, Send, ChevronDown, ChevronUp,
  Inbox, AlertCircle
} from "lucide-react";
import { cn } from "@/lib/utils";
import { motion, AnimatePresence } from "framer-motion";
import {
  useGmailConnection,
  useGmailEmails,
  useGmailThread,
  useGmailReply,
  type SourceMetadata,
  type EmailSummary
} from "@/hooks/use-gmail";
import { usePlatformSettings } from "@/contexts/PlatformSettingsContext";
import { diffZonedDays, formatZonedDate, formatZonedIntl, formatZonedTime, normalizeTimeZone, type PlatformDateFormat } from "@/lib/platformDateTime";

// Get favicon URL for a domain
function getFavicon(email: string): string {
  try {
    const domain = email.split('@')[1];
    if (domain) {
      return `https://www.google.com/s2/favicons?sz=32&domain=${domain}`;
    }
  } catch {}
  return '';
}

// Parse sender name and email from "Name <email@domain.com>" format
function parseSender(from: string): { name: string; email: string } {
  const match = from.match(/^(.+?)\s*<(.+)>$/);
  if (match) {
    return { name: match[1].trim().replace(/"/g, ''), email: match[2] };
  }
  // Check if it's just an email
  if (from.includes('@')) {
    return { name: from.split('@')[0], email: from };
  }
  return { name: from, email: '' };
}

// Format labels for display
function formatLabel(label: string): string {
  // Simplify common Gmail labels
  const labelMap: Record<string, string> = {
    'UNREAD': 'No leído',
    'INBOX': 'Bandeja',
    'CATEGORY_UPDATES': 'Actualizaciones',
    'CATEGORY_PROMOTIONS': 'Promociones',
    'CATEGORY_SOCIAL': 'Social',
    'CATEGORY_PERSONAL': 'Personal',
    'CATEGORY_FORUMS': 'Foros',
    'IMPORTANT': 'Importante',
    'STARRED': 'Destacado',
    'SENT': 'Enviado',
    'DRAFT': 'Borrador',
    'SPAM': 'Spam',
    'TRASH': 'Papelera'
  };
  return labelMap[label] || label;
}

const SourceBadge = ({ source, subject }: { source: SourceMetadata; subject: string }) => (
  <a
    href={source.permalink}
    target="_blank"
    rel="noopener noreferrer"
    className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full bg-red-50 dark:bg-red-900/20 hover:bg-red-100 dark:hover:bg-red-900/30 border border-red-200 dark:border-red-800 text-xs text-red-700 dark:text-red-300 transition-colors cursor-pointer focus:outline-none focus-visible:ring-2 focus-visible:ring-red-500/50"
    aria-label={`Open in Gmail: ${subject}`}
    title={`Abrir en Gmail: ${subject}`}
    onClick={(e) => e.stopPropagation()}
  >
    <svg className="h-3 w-3" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path d="M22 6c0-1.1-.9-2-2-2H4c-1.1 0-2 .9-2 2v12c0 1.1.9 2 2 2h16c1.1 0 2-.9 2-2V6zm-2 0l-8 5-8-5h16zm0 12H4V8l8 5 8-5v10z" fill="currentColor"/>
    </svg>
    <span className="truncate max-w-[120px]">{subject}</span>
  </a>
);

// Email chip component with favicon
const EmailChip = ({ email, snippet }: { email: string; snippet: string }) => {
  const faviconUrl = getFavicon(email);
  const [faviconError, setFaviconError] = useState(false);
  const domain = email.split('@')[1] || '';
  
  return (
    <div className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-gray-50 dark:bg-gray-800 border border-gray-200 dark:border-gray-700 text-xs mt-1.5">
      <Mail className="h-3 w-3 text-red-500 flex-shrink-0" />
      {faviconUrl && !faviconError ? (
        <img 
          src={faviconUrl} 
          alt="" 
          className="w-4 h-4 flex-shrink-0"
          onError={() => setFaviconError(true)}
        />
      ) : (
        <span className="w-4 h-4 rounded bg-gray-300 dark:bg-gray-600 flex items-center justify-center text-[10px] font-medium flex-shrink-0">
          {domain.charAt(0).toUpperCase()}
        </span>
      )}
      <span className="truncate max-w-[180px] text-muted-foreground">{snippet}</span>
    </div>
  );
};

export interface InlineGmailPreviewProps {
  query?: string;
  action?: "search" | "unread" | "recent" | "thread";
  threadId?: string;
  onComplete?: (message: string) => void;
}

type ViewMode = "list" | "thread" | "compose";

function formatEmailDate(dateStr: string, opts: { timeZone: string; dateFormat: PlatformDateFormat }): string {
  try {
    const date = new Date(dateStr);
    const now = Date.now();
    const diffDays = diffZonedDays(date, now, opts.timeZone);

    if (diffDays === 0) {
      return formatZonedTime(date, { timeZone: opts.timeZone, includeSeconds: false });
    }
    if (diffDays !== null && diffDays < 7) {
      return (
        formatZonedIntl(date, {
          timeZone: opts.timeZone,
          locale: "es-ES",
          options: { weekday: "short" },
        }) || ""
      );
    }
    return formatZonedDate(date, { timeZone: opts.timeZone, dateFormat: opts.dateFormat, includeYear: false });
  } catch {
    return dateStr;
  }
}

export function InlineGmailPreview({ 
  query: initialQuery = "",
  action = "recent",
  threadId: initialThreadId,
  onComplete
}: InlineGmailPreviewProps) {
  const { settings: platformSettings } = usePlatformSettings();
  const platformTimeZone = normalizeTimeZone(platformSettings.timezone_default);
  const platformDateFormat = platformSettings.date_format;
  const [viewMode, setViewMode] = useState<ViewMode>(initialThreadId ? "thread" : "list");
  const [searchQuery, setSearchQuery] = useState(initialQuery);
  const [activeSearchQuery, setActiveSearchQuery] = useState(initialQuery);
  const [selectedThreadId, setSelectedThreadId] = useState<string | null>(initialThreadId || null);
  
  const [replyTo, setReplyTo] = useState("");
  const [replySubject, setReplySubject] = useState("");
  const [replyBody, setReplyBody] = useState("");
  const [focusedEmailIndex, setFocusedEmailIndex] = useState<number>(-1);
  const emailListRef = useRef<HTMLDivElement>(null);

  const { isConnected, email: connectionEmail, isLoading: isCheckingConnection } = useGmailConnection();
  
  const {
    emails,
    nextPageToken,
    isLoading: isLoadingEmails,
    isFetching: isFetchingEmails,
    error: emailsError,
    refetch: refetchEmails,
    loadMore,
    isLoadingMore
  } = useGmailEmails(activeSearchQuery, { action, enabled: isConnected });

  const {
    thread: selectedThread,
    isLoading: isLoadingThread,
    error: threadError
  } = useGmailThread(selectedThreadId);

  const {
    sendReply,
    isSending,
    error: replyError,
    isSuccess: replySuccess,
    reset: resetReply
  } = useGmailReply();

  const error = emailsError || threadError || replyError;

  useEffect(() => {
    if (selectedThread?.messages?.length) {
      const lastMessage = selectedThread.messages[selectedThread.messages.length - 1];
      setReplyTo(lastMessage.fromEmail);
      setReplySubject(selectedThread.subject);
    }
  }, [selectedThread]);

  useEffect(() => {
    if (replySuccess && selectedThread) {
      setReplyBody("");
      onComplete?.(`Respuesta enviada a ${replyTo}`);
      resetReply();
    }
  }, [replySuccess, selectedThread, replyTo, onComplete, resetReply]);

  const handleSearch = (e: React.FormEvent) => {
    e.preventDefault();
    setActiveSearchQuery(searchQuery);
  };

  const handleSelectEmail = (email: EmailSummary) => {
    setSelectedThreadId(email.threadId);
    setViewMode("thread");
  };

  const handleSendReply = () => {
    if (!selectedThread || !replyBody.trim()) return;
    
    sendReply({
      threadId: selectedThread.id,
      to: replyTo,
      subject: replySubject,
      body: replyBody
    });
  };

  const handleLoadMore = () => {
    if (nextPageToken) {
      loadMore(nextPageToken);
    }
  };

  const handleEmailListKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (emails.length === 0) return;

    switch (e.key) {
      case "ArrowDown":
        e.preventDefault();
        setFocusedEmailIndex(prev => Math.min(prev + 1, emails.length - 1));
        break;
      case "ArrowUp":
        e.preventDefault();
        setFocusedEmailIndex(prev => Math.max(prev - 1, 0));
        break;
      case "Home":
        e.preventDefault();
        setFocusedEmailIndex(0);
        break;
      case "End":
        e.preventDefault();
        setFocusedEmailIndex(emails.length - 1);
        break;
    }
  }, [emails.length]);

  useEffect(() => {
    if (focusedEmailIndex >= 0 && emailListRef.current) {
      const emailButtons = emailListRef.current.querySelectorAll('[data-email-item]');
      const targetButton = emailButtons[focusedEmailIndex] as HTMLElement;
      if (targetButton) {
        targetButton.focus();
      }
    }
  }, [focusedEmailIndex]);

  if (isCheckingConnection) {
    return (
      <motion.div 
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        className="rounded-xl border border-red-200 dark:border-red-800 bg-gradient-to-br from-red-50 to-white dark:from-red-900/20 dark:to-gray-900 overflow-hidden"
      >
        <div className="p-4 border-b border-red-200 dark:border-red-800">
          <div className="flex items-center gap-3">
            <Skeleton className="w-10 h-10 rounded-lg" />
            <div className="space-y-2">
              <Skeleton className="h-4 w-20" />
              <Skeleton className="h-3 w-32" />
            </div>
          </div>
          <div className="mt-3 flex gap-2">
            <Skeleton className="h-9 flex-1 rounded-md" />
            <Skeleton className="h-9 w-9 rounded-md" />
            <Skeleton className="h-9 w-9 rounded-md" />
          </div>
        </div>
        <EmailListSkeleton count={4} />
      </motion.div>
    );
  }

  if (!isConnected) {
    return (
      <motion.div 
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        className="rounded-xl border border-red-200 dark:border-red-800 bg-gradient-to-br from-red-50 to-white dark:from-red-900/20 dark:to-gray-900 p-6"
      >
        <div className="flex items-center gap-4">
          <div className="w-12 h-12 rounded-full bg-red-100 dark:bg-red-900/30 flex items-center justify-center flex-shrink-0">
            <Mail className="h-7 w-7 text-red-600" />
          </div>
          <div className="flex-1">
            <h4 className="font-medium">Gmail no conectado</h4>
            <p className="text-sm text-muted-foreground mt-1">
              Conecta Gmail desde la configuración de integraciones para acceder a tus correos
            </p>
          </div>
        </div>
      </motion.div>
    );
  }

  return (
    <motion.div 
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      className="rounded-xl border border-red-200 dark:border-red-800 bg-gradient-to-br from-red-50 to-white dark:from-red-900/20 dark:to-gray-900 overflow-hidden"
    >
      <div className="p-4 border-b border-red-200 dark:border-red-800">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-lg bg-red-600 flex items-center justify-center">
              <Mail className="h-5 w-5 text-white" />
            </div>
            <div>
              <h4 className="font-medium flex items-center gap-2">
                Gmail
                <span className="px-1.5 py-0.5 text-[10px] font-medium bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-400 rounded">
                  CONECTADO
                </span>
              </h4>
              <p className="text-xs text-muted-foreground">{connectionEmail}</p>
            </div>
          </div>
          
          {viewMode === "thread" && (
            <Button 
              variant="ghost" 
              size="sm" 
              onClick={() => { setViewMode("list"); setSelectedThreadId(null); }}
              aria-label="Go back to email list"
              className="focus-visible:ring-2 focus-visible:ring-red-500/50"
            >
              <ChevronUp className="h-4 w-4 mr-1" aria-hidden="true" />
              Volver
            </Button>
          )}
        </div>

        {viewMode === "list" && (
          <form onSubmit={handleSearch} className="mt-3 flex gap-2">
            <div className="relative flex-1">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input
                placeholder="Buscar correos..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="pl-9"
              />
            </div>
            <Button 
              type="submit" 
              size="sm" 
              disabled={isFetchingEmails} 
              className="bg-red-600 hover:bg-red-700 text-white focus-visible:ring-2 focus-visible:ring-red-500/50"
              aria-label="Search emails"
            >
              {isFetchingEmails ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : <Search className="h-4 w-4" aria-hidden="true" />}
              <span className="sr-only">{isFetchingEmails ? 'Searching...' : 'Search'}</span>
            </Button>
            <Button 
              type="button" 
              variant="outline" 
              size="sm" 
              onClick={() => refetchEmails()} 
              disabled={isFetchingEmails}
              aria-label="Refresh emails"
              className="focus-visible:ring-2 focus-visible:ring-red-500/50"
            >
              <RefreshCw className={cn("h-4 w-4", isFetchingEmails && "animate-spin")} aria-hidden="true" />
              <span className="sr-only">{isFetchingEmails ? 'Refreshing...' : 'Refresh'}</span>
            </Button>
          </form>
        )}
      </div>

      {error && (
        <div className="px-4 py-3 bg-amber-50 dark:bg-amber-900/20 border-b border-amber-200 dark:border-amber-800" role="alert" aria-live="assertive">
          {String(error).includes("INSUFFICIENT_SCOPE") ? (
            <div className="space-y-2">
              <div className="flex items-start gap-2">
                <AlertCircle className="h-5 w-5 text-amber-600 dark:text-amber-400 flex-shrink-0 mt-0.5" aria-hidden="true" />
                <div>
                  <p className="text-sm font-medium text-amber-800 dark:text-amber-200">
                    Permisos insuficientes
                  </p>
                  <p className="text-xs text-amber-700 dark:text-amber-300 mt-1">
                    El conector de Gmail tiene permisos limitados. Para leer correos, necesitas permisos de lectura completos.
                  </p>
                </div>
              </div>
              <div className="flex gap-2 pl-7">
                <a
                  href="https://mail.google.com"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium bg-amber-100 dark:bg-amber-800/30 text-amber-700 dark:text-amber-300 rounded-md hover:bg-amber-200 dark:hover:bg-amber-800/50 transition-colors"
                >
                  <Mail className="h-3.5 w-3.5" aria-hidden="true" />
                  Abrir Gmail directamente
                </a>
              </div>
            </div>
          ) : (
            <p className="text-sm text-red-700 dark:text-red-300 flex items-center gap-2">
              <AlertCircle className="h-4 w-4" aria-hidden="true" />
              {String(error)}
            </p>
          )}
        </div>
      )}

      <ScrollArea className="max-h-[400px]">
        <AnimatePresence mode="wait">
          {viewMode === "list" && (
            <motion.div
              key="list"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
            >
              {isLoadingEmails && emails.length === 0 ? (
                <div role="status" aria-live="polite" aria-label="Loading emails">
                  <span className="sr-only">Loading emails...</span>
                  <EmailListSkeleton count={5} />
                </div>
              ) : emails.length === 0 && !isLoadingEmails ? (
                <div className="p-8 text-center text-muted-foreground" role="status">
                  <Inbox className="h-8 w-8 mx-auto mb-2 opacity-50" aria-hidden="true" />
                  <p>No se encontraron correos</p>
                </div>
              ) : (
                <div 
                  ref={emailListRef}
                  className="divide-y divide-red-100 dark:divide-red-900/30"
                  role="listbox"
                  aria-label="Email list"
                  onKeyDown={handleEmailListKeyDown}
                >
                  {emails.map((email, index) => {
                    const sender = parseSender(email.from);
                    const faviconUrl = sender.email ? getFavicon(sender.email) : '';
                    
                    return (
                      <button
                        key={email.id}
                        onClick={() => handleSelectEmail(email)}
                        onFocus={() => setFocusedEmailIndex(index)}
                        className={cn(
                          "w-full p-4 text-left hover:bg-red-50 dark:hover:bg-red-900/20 transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-red-500/50",
                          email.isUnread && "bg-red-50/50 dark:bg-red-900/10",
                          focusedEmailIndex === index && "bg-red-50 dark:bg-red-900/20"
                        )}
                        role="option"
                        aria-selected={focusedEmailIndex === index}
                        aria-label={`${email.isUnread ? 'Unread email' : 'Email'} from ${email.from}, subject: ${email.subject}, ${formatEmailDate(email.date, { timeZone: platformTimeZone, dateFormat: platformDateFormat })}`}
                        data-email-item
                        data-testid={`email-item-${email.id}`}
                      >
                        <div className="flex items-start gap-3">
                          <div className={cn(
                            "w-10 h-10 rounded-full flex items-center justify-center flex-shrink-0 text-sm font-medium overflow-hidden",
                            email.isUnread 
                              ? "bg-red-600 text-white" 
                              : "bg-gray-100 dark:bg-gray-800 text-gray-600 dark:text-gray-300"
                          )}>
                            {faviconUrl ? (
                              <img 
                                src={faviconUrl} 
                                alt="" 
                                className="w-5 h-5"
                                onError={(e) => {
                                  const target = e.target as HTMLImageElement;
                                  target.style.display = 'none';
                                  target.nextElementSibling?.classList.remove('hidden');
                                }}
                              />
                            ) : null}
                            <span className={faviconUrl ? 'hidden' : ''}>
                              {sender.name.charAt(0).toUpperCase()}
                            </span>
                          </div>
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center justify-between gap-2 mb-1">
                              <div className="flex items-center gap-2 min-w-0">
                                <span className={cn(
                                  "text-sm font-semibold truncate",
                                  !email.isUnread && "font-medium"
                                )}>
                                  {sender.name}
                                </span>
                                {email.isUnread && (
                                  <div className="w-2 h-2 rounded-full bg-red-500 flex-shrink-0" aria-hidden="true" />
                                )}
                              </div>
                              <span className="text-xs text-muted-foreground flex-shrink-0">
                                {formatEmailDate(email.date, { timeZone: platformTimeZone, dateFormat: platformDateFormat })}
                              </span>
                            </div>
                            <p className={cn(
                              "text-sm truncate mb-1",
                              email.isUnread ? "font-medium text-foreground" : "text-muted-foreground"
                            )}>
                              {email.subject}
                            </p>
                            <p className="text-xs text-muted-foreground line-clamp-2">
                              {email.snippet}
                            </p>
                            <div className="mt-2">
                              <EmailChip email={sender.email || email.from} snippet={email.subject} />
                            </div>
                          </div>
                        </div>
                      </button>
                    );
                  })}
                  
                  {nextPageToken && (
                    <div className="p-3 flex justify-center">
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={handleLoadMore}
                        disabled={isLoadingMore}
                        className="w-full"
                        data-testid="button-load-more-emails"
                      >
                        {isLoadingMore ? (
                          <>
                            <Loader2 className="h-4 w-4 animate-spin mr-2" />
                            Cargando...
                          </>
                        ) : (
                          <>
                            <ChevronDown className="h-4 w-4 mr-2" />
                            Cargar más correos
                          </>
                        )}
                      </Button>
                    </div>
                  )}
                </div>
              )}
            </motion.div>
          )}

          {viewMode === "thread" && isLoadingThread && !selectedThread && (
            <motion.div
              key="thread-loading"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="p-4"
            >
              <ThreadSkeleton messageCount={2} />
            </motion.div>
          )}

          {viewMode === "thread" && selectedThread && (
            <motion.div
              key="thread"
              initial={{ opacity: 0, x: 20 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: -20 }}
              className="p-4"
            >
              <h3 className="font-semibold text-lg mb-4" id="thread-subject">{selectedThread.subject}</h3>
              
              <div className="space-y-4" role="list" aria-label="Email thread messages">
                {selectedThread.messages.map((msg, index) => (
                  <div 
                    key={msg.id}
                    className="p-3 rounded-lg bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700"
                    role="listitem"
                    aria-label={`Message ${index + 1} from ${msg.from}`}
                  >
                    <div className="flex items-center justify-between mb-2">
                      <div className="flex items-center gap-2">
                        <div className="w-8 h-8 rounded-full bg-red-100 dark:bg-red-900/30 flex items-center justify-center text-xs font-medium text-red-600">
                          {msg.from.charAt(0).toUpperCase()}
                        </div>
                        <div>
                          <p className="text-sm font-medium">{msg.from}</p>
                          <p className="text-xs text-muted-foreground">{msg.fromEmail}</p>
                        </div>
                      </div>
                      <span className="text-xs text-muted-foreground">
                        {formatEmailDate(msg.date, { timeZone: platformTimeZone, dateFormat: platformDateFormat })}
                      </span>
                    </div>
                    <div className="text-sm whitespace-pre-wrap pl-10">
                      {msg.body.slice(0, 1000)}
                      {msg.body.length > 1000 && "..."}
                    </div>
                    {msg.source && (
                      <div className="mt-2 pl-10">
                        <SourceBadge source={msg.source} subject={msg.subject} />
                      </div>
                    )}
                  </div>
                ))}
              </div>

              <div className="mt-4 pt-4 border-t border-red-200 dark:border-red-800">
                <h4 className="text-sm font-medium mb-2">Responder</h4>
                <div className="space-y-2">
                  <Input
                    placeholder="Para:"
                    value={replyTo}
                    onChange={(e) => setReplyTo(e.target.value)}
                    className="text-sm focus-visible:ring-2 focus-visible:ring-red-500/50"
                    aria-label="Reply to email address"
                  />
                  <Textarea
                    placeholder="Escribe tu respuesta..."
                    value={replyBody}
                    onChange={(e) => setReplyBody(e.target.value)}
                    rows={4}
                    className="resize-none focus-visible:ring-2 focus-visible:ring-red-500/50"
                    aria-label="Reply message body"
                    onKeyDown={(e) => {
                      if ((e.metaKey || e.ctrlKey) && e.key === "Enter" && replyBody.trim() && !isSending) {
                        e.preventDefault();
                        handleSendReply();
                      }
                    }}
                  />
                  <div className="flex justify-between items-center">
                    <span className="text-xs text-muted-foreground">
                      <kbd className="px-1 py-0.5 bg-muted rounded text-[10px]">Cmd</kbd>+<kbd className="px-1 py-0.5 bg-muted rounded text-[10px]">Enter</kbd> to send
                    </span>
                    <Button 
                      onClick={handleSendReply}
                      disabled={!replyBody.trim() || isSending}
                      className="bg-red-600 hover:bg-red-700 text-white focus-visible:ring-2 focus-visible:ring-red-500/50"
                      aria-label={isSending ? "Sending reply..." : "Send reply"}
                    >
                      {isSending ? (
                        <Loader2 className="h-4 w-4 animate-spin mr-2" aria-hidden="true" />
                      ) : (
                        <Send className="h-4 w-4 mr-2" aria-hidden="true" />
                      )}
                      Enviar
                    </Button>
                  </div>
                </div>
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </ScrollArea>
    </motion.div>
  );
}
