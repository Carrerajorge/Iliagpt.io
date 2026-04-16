import { useState, useEffect, useRef, useMemo } from 'react';
import { highlightCode } from '@/lib/shikiHighlighter';

interface UseShikiHighlightResult {
  html: string;
  isLoading: boolean;
}

const CACHE_MAX_SIZE = 200;
const highlightCache = new Map<string, string>();

function getCacheKey(code: string, lang: string, theme: string): string {
  return `${theme}:${lang}:${code.length}:${code.slice(0, 120)}:${code.slice(-60)}`;
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

export function useShikiHighlight(
  code: string,
  language: string,
  theme: 'dark' | 'light' = 'dark'
): UseShikiHighlightResult {
  const [html, setHtml] = useState<string>('');
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const mountedRef = useRef<boolean>(true);
  const requestIdRef = useRef<number>(0);

  const cacheKey = useMemo(() => getCacheKey(code, language, theme), [code, language, theme]);

  useEffect(() => {
    mountedRef.current = true;
    const currentRequestId = ++requestIdRef.current;

    if (!code) {
      setHtml('');
      setIsLoading(false);
      return;
    }

    const cached = highlightCache.get(cacheKey);
    if (cached !== undefined) {
      setHtml(cached);
      setIsLoading(false);
      return;
    }

    setIsLoading(true);

    highlightCode(code, language, theme)
      .then((result) => {
        if (!mountedRef.current || currentRequestId !== requestIdRef.current) return;

        // Evict oldest if cache is full
        if (highlightCache.size >= CACHE_MAX_SIZE) {
          const oldestKey = highlightCache.keys().next().value;
          if (oldestKey) highlightCache.delete(oldestKey);
        }
        highlightCache.set(cacheKey, result);

        setHtml(result);
        setIsLoading(false);
      })
      .catch((err) => {
        if (!mountedRef.current || currentRequestId !== requestIdRef.current) return;
        console.warn('[useShikiHighlight] Highlight failed, using plain text fallback:', err);
        const fallback = `<pre><code>${escapeHtml(code)}</code></pre>`;
        setHtml(fallback);
        setIsLoading(false);
      });

    return () => {
      mountedRef.current = false;
    };
  }, [code, language, theme, cacheKey]);

  return { html, isLoading };
}

export function clearShikiCache(): void {
  highlightCache.clear();
}

export default useShikiHighlight;
