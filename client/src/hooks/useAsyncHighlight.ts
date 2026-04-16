import { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { highlightCode, loadLanguage, getLanguageAlias } from '@/lib/syntaxHighlighter';

interface PrismWorkerRequest {
  id: string;
  code: string;
  language: string;
}

interface PrismWorkerResponse {
  id: string;
  html: string;
  language: string;
  success: boolean;
  error?: string;
}

interface UseAsyncHighlightResult {
  html: string;
  isLoading: boolean;
  error: string | null;
  isFromCache: boolean;
}

interface CacheEntry {
  html: string;
  timestamp: number;
}

const SMALL_SNIPPET_THRESHOLD = 50;
const CACHE_MAX_SIZE = 100;
const CACHE_TTL_MS = 5 * 60 * 1000;

const highlightCache = new Map<string, CacheEntry>();

function getCacheKey(code: string, language: string): string {
  return `${language}:${code.length}:${code.slice(0, 100)}:${code.slice(-50)}`;
}

function getFromCache(key: string): string | null {
  const entry = highlightCache.get(key);
  if (!entry) return null;
  
  if (Date.now() - entry.timestamp > CACHE_TTL_MS) {
    highlightCache.delete(key);
    return null;
  }
  
  return entry.html;
}

function setCache(key: string, html: string): void {
  if (highlightCache.size >= CACHE_MAX_SIZE) {
    const oldestKey = highlightCache.keys().next().value;
    if (oldestKey) {
      highlightCache.delete(oldestKey);
    }
  }
  
  highlightCache.set(key, { html, timestamp: Date.now() });
}

let workerInstance: Worker | null = null;
let workerSupported = true;

function getWorker(): Worker | null {
  if (!workerSupported) return null;
  
  if (!workerInstance) {
    try {
      workerInstance = new Worker(
        new URL('../workers/prismWorker.ts', import.meta.url),
        { type: 'module' }
      );
      
      workerInstance.onerror = () => {
        console.warn('[useAsyncHighlight] Worker failed to initialize, falling back to sync');
        workerSupported = false;
        workerInstance = null;
      };
    } catch (error) {
      console.warn('[useAsyncHighlight] Worker not supported, using sync highlighting');
      workerSupported = false;
      return null;
    }
  }
  
  return workerInstance;
}

const pendingRequests = new Map<string, {
  resolve: (value: PrismWorkerResponse) => void;
  reject: (error: Error) => void;
}>();

function setupWorkerMessageHandler(worker: Worker): void {
  worker.onmessage = (event: MessageEvent<PrismWorkerResponse>) => {
    const { id } = event.data;
    const pending = pendingRequests.get(id);
    
    if (pending) {
      pending.resolve(event.data);
      pendingRequests.delete(id);
    }
  };
}

async function highlightWithWorker(
  code: string,
  language: string,
  requestId: string
): Promise<PrismWorkerResponse> {
  const worker = getWorker();
  
  if (!worker) {
    throw new Error('Worker not available');
  }
  
  if (!pendingRequests.size) {
    setupWorkerMessageHandler(worker);
  }
  
  return new Promise((resolve, reject) => {
    const timeoutId = setTimeout(() => {
      pendingRequests.delete(requestId);
      reject(new Error('Worker timeout'));
    }, 10000);
    
    pendingRequests.set(requestId, {
      resolve: (response) => {
        clearTimeout(timeoutId);
        resolve(response);
      },
      reject: (error) => {
        clearTimeout(timeoutId);
        reject(error);
      },
    });
    
    const request: PrismWorkerRequest = {
      id: requestId,
      code,
      language,
    };
    
    worker.postMessage(request);
  });
}

function escapeHtml(text: string): string {
  const htmlEscapes: Record<string, string> = {
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;',
  };
  return text.replace(/[&<>"']/g, (char) => htmlEscapes[char] || char);
}

async function highlightSync(code: string, language: string): Promise<string> {
  const resolved = getLanguageAlias(language);
  await loadLanguage(resolved);
  return highlightCode(code, resolved);
}

export function useAsyncHighlight(
  code: string,
  language: string
): UseAsyncHighlightResult {
  const [html, setHtml] = useState<string>('');
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);
  const [isFromCache, setIsFromCache] = useState<boolean>(false);
  
  const requestIdRef = useRef<number>(0);
  const mountedRef = useRef<boolean>(true);
  
  const lineCount = useMemo(() => {
    return code ? code.split('\n').length : 0;
  }, [code]);
  
  const shouldUseSync = useMemo(() => {
    return lineCount < SMALL_SNIPPET_THRESHOLD;
  }, [lineCount]);
  
  const cacheKey = useMemo(() => {
    return getCacheKey(code, language);
  }, [code, language]);
  
  const performHighlight = useCallback(async () => {
    if (!code) {
      setHtml('');
      setIsLoading(false);
      setError(null);
      return;
    }
    
    const cached = getFromCache(cacheKey);
    if (cached !== null) {
      setHtml(cached);
      setIsLoading(false);
      setIsFromCache(true);
      setError(null);
      return;
    }
    
    setIsLoading(true);
    setIsFromCache(false);
    setError(null);
    
    const currentRequestId = ++requestIdRef.current;
    
    try {
      let highlightedHtml: string;
      
      if (shouldUseSync || !workerSupported) {
        highlightedHtml = await highlightSync(code, language);
      } else {
        try {
          const response = await highlightWithWorker(
            code,
            language,
            `req-${currentRequestId}-${Date.now()}`
          );
          
          if (!response.success && response.error) {
            console.warn('[useAsyncHighlight] Worker error:', response.error);
          }
          
          highlightedHtml = response.html;
        } catch (workerError) {
          console.warn('[useAsyncHighlight] Falling back to sync:', workerError);
          highlightedHtml = await highlightSync(code, language);
        }
      }
      
      if (!mountedRef.current || currentRequestId !== requestIdRef.current) {
        return;
      }
      
      setCache(cacheKey, highlightedHtml);
      setHtml(highlightedHtml);
      setIsLoading(false);
    } catch (err) {
      if (!mountedRef.current || currentRequestId !== requestIdRef.current) {
        return;
      }
      
      console.error('[useAsyncHighlight] Highlight failed:', err);
      setHtml(escapeHtml(code));
      setError(err instanceof Error ? err.message : 'Highlighting failed');
      setIsLoading(false);
    }
  }, [code, language, cacheKey, shouldUseSync]);
  
  useEffect(() => {
    mountedRef.current = true;
    performHighlight();
    
    return () => {
      mountedRef.current = false;
    };
  }, [performHighlight]);
  
  return {
    html,
    isLoading,
    error,
    isFromCache,
  };
}

export function clearHighlightCache(): void {
  highlightCache.clear();
}

export function getHighlightCacheSize(): number {
  return highlightCache.size;
}

export default useAsyncHighlight;
