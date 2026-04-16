/**
 * Enhanced Chat Experience Components
 * Typing indicator, file preview, search, export
 */

import React, { useState, useRef, useEffect } from 'react';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { ScrollArea } from '@/components/ui/scroll-area';
import {
  Search, 
  Download, 
  FileText, 
  Image as ImageIcon, 
  File, 
  X,
  Share2,
  Copy,
  Check,
  Loader2,
  MessageSquare,
  Calendar,
  ChevronDown,
  ChevronUp
} from 'lucide-react';
import { toast } from 'sonner';
import { usePlatformSettings } from "@/contexts/PlatformSettingsContext";
import { formatZonedDateTime, normalizeTimeZone } from "@/lib/platformDateTime";

/**
 * Enhanced Typing Indicator
 */
interface TypingIndicatorProps {
  isTyping: boolean;
  model?: string;
  className?: string;
}

export function TypingIndicator({ isTyping, model, className }: TypingIndicatorProps) {
  if (!isTyping) return null;

  return (
    <div className={cn(
      "flex items-center gap-3 p-4 bg-muted/30 rounded-lg animate-in fade-in duration-300",
      className
    )}>
      <div className="flex items-center gap-1">
        <div className="w-2 h-2 rounded-full bg-primary animate-bounce" style={{ animationDelay: '0ms' }} />
        <div className="w-2 h-2 rounded-full bg-primary animate-bounce" style={{ animationDelay: '150ms' }} />
        <div className="w-2 h-2 rounded-full bg-primary animate-bounce" style={{ animationDelay: '300ms' }} />
      </div>
      <span className="text-sm text-muted-foreground">
        {model ? `${model} está pensando...` : 'IA está pensando...'}
      </span>
    </div>
  );
}

/**
 * File Preview Component
 */
interface FilePreviewProps {
  file: {
    name: string;
    type: string;
    url?: string;
    size?: number;
  };
  onRemove?: () => void;
  className?: string;
}

export function FilePreview({ file, onRemove, className }: FilePreviewProps) {
  const isImage = file.type.startsWith('image/');
  const isPDF = file.type === 'application/pdf';
  
  const formatSize = (bytes?: number) => {
    if (!bytes) return '';
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  };

  return (
    <div className={cn(
      "relative group flex items-center gap-3 p-3 bg-muted/50 rounded-lg border",
      className
    )}>
      {isImage && file.url ? (
        <img 
          src={file.url} 
          alt={file.name}
          className="w-12 h-12 object-cover rounded"
        />
      ) : (
        <div className="w-12 h-12 flex items-center justify-center bg-muted rounded">
          {isPDF ? (
            <FileText className="w-6 h-6 text-red-500" />
          ) : isImage ? (
            <ImageIcon className="w-6 h-6 text-blue-500" />
          ) : (
            <File className="w-6 h-6 text-muted-foreground" />
          )}
        </div>
      )}
      
      <div className="flex-1 min-w-0">
        <p className="text-sm font-medium truncate">{file.name}</p>
        {file.size && (
          <p className="text-xs text-muted-foreground">{formatSize(file.size)}</p>
        )}
      </div>

      {onRemove && (
        <Button
          variant="ghost"
          size="sm"
          className="opacity-0 group-hover:opacity-100 transition-opacity h-8 w-8 p-0"
          onClick={onRemove}
        >
          <X className="w-4 h-4" />
        </Button>
      )}
    </div>
  );
}

/**
 * Chat Search Component
 */
interface ChatSearchProps {
  messages: Array<{
    id: string;
    content: string;
    role: string;
    createdAt?: string;
  }>;
  onResultClick?: (messageId: string) => void;
  className?: string;
}

export function ChatSearch({ messages, onResultClick, className }: ChatSearchProps) {
  const [query, setQuery] = useState('');
  const [isOpen, setIsOpen] = useState(false);
  const { settings: platformSettings } = usePlatformSettings();
  const platformTimeZone = normalizeTimeZone(platformSettings.timezone_default);
  const platformDateFormat = platformSettings.date_format;

  const results = query.length >= 2
    ? messages.filter(m => 
        m.content.toLowerCase().includes(query.toLowerCase())
      ).slice(0, 10)
    : [];

  const highlightMatch = (text: string, query: string) => {
    if (!query) return text;
    const parts = text.split(new RegExp(`(${query})`, 'gi'));
    return parts.map((part, i) => 
      part.toLowerCase() === query.toLowerCase() 
        ? <mark key={i} className="bg-yellow-200 dark:bg-yellow-800">{part}</mark>
        : part
    );
  };

  return (
    <div className={cn("relative", className)}>
      <Button
        variant="ghost"
        size="sm"
        onClick={() => setIsOpen(true)}
        className="gap-2"
      >
        <Search className="w-4 h-4" />
        Buscar
      </Button>

      <Dialog open={isOpen} onOpenChange={setIsOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>Buscar en la conversación</DialogTitle>
          </DialogHeader>
          
          <div className="space-y-4">
            <Input
              placeholder="Buscar mensajes..."
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              autoFocus
            />

            <ScrollArea className="h-[300px]">
              {results.length === 0 && query.length >= 2 ? (
                <p className="text-center text-muted-foreground py-8">
                  No se encontraron resultados
                </p>
              ) : (
                <div className="space-y-2">
                  {results.map((msg) => (
                    <button
                      key={msg.id}
                      className="w-full text-left p-3 rounded-lg hover:bg-muted transition-colors"
                      onClick={() => {
                        onResultClick?.(msg.id);
                        setIsOpen(false);
                      }}
                    >
                      <div className="flex items-center gap-2 mb-1">
                        <Badge variant="outline" className="text-xs">
                          {msg.role === 'user' ? 'Tú' : 'IA'}
                        </Badge>
                        {msg.createdAt && (
                          <span className="text-xs text-muted-foreground">
                            {formatZonedDateTime(msg.createdAt, { timeZone: platformTimeZone, dateFormat: platformDateFormat, includeYear: false })}
                          </span>
                        )}
                      </div>
                      <p className="text-sm line-clamp-2">
                        {highlightMatch(msg.content, query)}
                      </p>
                    </button>
                  ))}
                </div>
              )}
            </ScrollArea>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}

/**
 * Export Conversation Component
 */
interface ExportConversationProps {
  chatId: string;
  title: string;
  messages: Array<{
    role: string;
    content: string;
    createdAt?: string;
  }>;
  className?: string;
}

export function ExportConversation({ chatId, title, messages, className }: ExportConversationProps) {
  const [isExporting, setIsExporting] = useState(false);
  const { settings: platformSettings } = usePlatformSettings();
  const platformTimeZone = normalizeTimeZone(platformSettings.timezone_default);
  const platformDateFormat = platformSettings.date_format;

  const exportAsText = () => {
    const text = messages.map(m => 
      `[${m.role === 'user' ? 'Usuario' : 'IA'}]: ${m.content}`
    ).join('\n\n');

    const blob = new Blob([text], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${title || 'conversacion'}.txt`;
    a.click();
    URL.revokeObjectURL(url);
    toast.success('Conversación exportada');
  };

  const exportAsMarkdown = () => {
    const md = [`# ${title}\n`];
    md.push(`*Exportado el ${formatZonedDateTime(new Date(), { timeZone: platformTimeZone, dateFormat: platformDateFormat })}*\n`);
    md.push('---\n');
    
    messages.forEach(m => {
      md.push(`### ${m.role === 'user' ? '👤 Usuario' : '🤖 IA'}\n`);
      md.push(`${m.content}\n`);
    });

    const blob = new Blob([md.join('\n')], { type: 'text/markdown' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${title || 'conversacion'}.md`;
    a.click();
    URL.revokeObjectURL(url);
    toast.success('Conversación exportada como Markdown');
  };

  const exportAsJSON = () => {
    const data = {
      title,
      exportedAt: new Date().toISOString(),
      messages: messages.map(m => ({
        role: m.role,
        content: m.content,
        timestamp: m.createdAt
      }))
    };

    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${title || 'conversacion'}.json`;
    a.click();
    URL.revokeObjectURL(url);
    toast.success('Conversación exportada como JSON');
  };

  return (
    <div className={cn("flex gap-2", className)}>
      <Button variant="outline" size="sm" onClick={exportAsText}>
        <Download className="w-4 h-4 mr-2" />
        TXT
      </Button>
      <Button variant="outline" size="sm" onClick={exportAsMarkdown}>
        <FileText className="w-4 h-4 mr-2" />
        MD
      </Button>
      <Button variant="outline" size="sm" onClick={exportAsJSON}>
        <File className="w-4 h-4 mr-2" />
        JSON
      </Button>
    </div>
  );
}

/**
 * Share Conversation Component
 */
interface ShareConversationProps {
  chatId: string;
  className?: string;
}

export function ShareConversation({ chatId, className }: ShareConversationProps) {
  const [copied, setCopied] = useState(false);
  const [shareUrl, setShareUrl] = useState('');
  const [isGenerating, setIsGenerating] = useState(false);

  const generateShareLink = async () => {
    setIsGenerating(true);
    try {
      const res = await fetch(`/api/chats/${chatId}/share`, {
        method: 'POST',
        credentials: 'include'
      });
      const data = await res.json();
      if (data.shareUrl) {
        setShareUrl(data.shareUrl);
      }
    } catch (error) {
      toast.error('Error al generar link');
    } finally {
      setIsGenerating(false);
    }
  };

  const copyLink = () => {
    navigator.clipboard.writeText(shareUrl);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
    toast.success('Link copiado');
  };

  return (
    <div className={cn("space-y-2", className)}>
      {!shareUrl ? (
        <Button 
          variant="outline" 
          size="sm" 
          onClick={generateShareLink}
          disabled={isGenerating}
        >
          {isGenerating ? (
            <Loader2 className="w-4 h-4 mr-2 animate-spin" />
          ) : (
            <Share2 className="w-4 h-4 mr-2" />
          )}
          Compartir
        </Button>
      ) : (
        <div className="flex gap-2">
          <Input value={shareUrl} readOnly className="text-xs" />
          <Button size="sm" onClick={copyLink}>
            {copied ? <Check className="w-4 h-4" /> : <Copy className="w-4 h-4" />}
          </Button>
        </div>
      )}
    </div>
  );
}

/**
 * Collapsible Message Group
 */
interface MessageGroupProps {
  date: string;
  count: number;
  children: React.ReactNode;
  defaultOpen?: boolean;
}

export function MessageGroup({ date, count, children, defaultOpen = true }: MessageGroupProps) {
  const [isOpen, setIsOpen] = useState(defaultOpen);

  return (
    <div className="space-y-2">
      <button
        className="flex items-center gap-2 w-full text-left py-2 text-sm text-muted-foreground hover:text-foreground transition-colors"
        onClick={() => setIsOpen(!isOpen)}
      >
        <Calendar className="w-4 h-4" />
        <span>{date}</span>
        <Badge variant="secondary" className="ml-2">{count} mensajes</Badge>
        <span className="ml-auto">
          {isOpen ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
        </span>
      </button>
      {isOpen && children}
    </div>
  );
}
