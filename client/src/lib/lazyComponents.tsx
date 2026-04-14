import React, { Suspense, ComponentType, useEffect, useState } from 'react';
import { Loader2 } from 'lucide-react';
import { cn } from '@/lib/utils';
import { LazyLoadErrorBoundary as _LazyLoadErrorBoundary } from '@/components/error-boundaries';
const LazyLoadErrorBoundary: any = _LazyLoadErrorBoundary;

interface LoadingFallbackProps {
  height?: string | number;
  message?: string;
  className?: string;
  showProgress?: boolean;
}

export function LoadingFallback({
  height = '400px',
  message = 'Loading...',
  className,
  showProgress = false
}: LoadingFallbackProps) {
  const h = typeof height === 'number' ? `${height}px` : height;
  const [progress, setProgress] = useState(0);

  useEffect(() => {
    if (!showProgress) return;
    const interval = setInterval(() => {
      setProgress((prev) => Math.min(prev + Math.random() * 10, 90));
    }, 200);
    return () => clearInterval(interval);
  }, [showProgress]);

  return (
    <div
      className={cn(
        'flex flex-col items-center justify-center bg-muted/20 rounded-lg border border-border min-h-[100px] h-[var(--fallback-height)]',
        className
      )}
      ref={(el) => { if (el) el.style.setProperty('--fallback-height', h); }}
      data-testid="lazy-loading-fallback"
      role="status"
      aria-label={message}
    >
      <Loader2 className="h-8 w-8 animate-spin text-primary mb-3" aria-hidden="true" />
      <p className="text-sm text-muted-foreground">{message}</p>
      {showProgress && (
        <div className="w-32 h-1 bg-muted rounded-full mt-2 overflow-hidden">
          <div
            className="h-full bg-primary transition-all duration-200"
            style={{ width: `${progress}%` }}
          />
        </div>
      )}
    </div>
  );
}

export function EditorLoadingFallback() {
  return (
    <div
      className="h-full w-full flex items-center justify-center bg-white"
      data-testid="editor-loading-fallback"
    >
      <div className="flex items-center justify-center p-4">
        <Loader2 className="h-10 w-10 animate-spin text-blue-500" />
        <p className="text-sm text-gray-500">Loading editor...</p>
      </div>
    </div>
  );
}

export function withLazyLoading<P extends object>(
  importFn: () => Promise<{ default: ComponentType<P> }>,
  FallbackComponent: ComponentType<any> = LoadingFallback,
  fallbackProps: Record<string, any> = {}
): React.FC<P> {
  const LazyComponent = React.lazy(importFn);

  const Wrapper: React.FC<P> = (props) => (
    <LazyLoadErrorBoundary>
      <Suspense fallback={<FallbackComponent {...fallbackProps} />}>
        <LazyComponent {...props} />
      </Suspense>
    </LazyLoadErrorBoundary>
  );

  return Wrapper;
}

export const EnhancedDocumentEditorLazy = withLazyLoading(
  () => import('@/components/ribbon').then<{ default: ComponentType<any> }>(module => ({ default: module.EnhancedDocumentEditor as any })),
  EditorLoadingFallback
);

export const SpreadsheetEditorLazy = withLazyLoading(
  () => import('@/components/spreadsheet-editor').then<{ default: ComponentType<any> }>(module => ({ default: module.SpreadsheetEditor as any })),
  EditorLoadingFallback
);

// ============================================
// HEAVY COMPONENTS - MONACO EDITOR (~2MB)
// ============================================

function MonacoLoadingFallback() {
  return (
    <LoadingFallback
      height="100%"
      message="Cargando editor de código..."
      showProgress={true}
    />
  );
}

// Monaco Editor lazy loaded with chunk naming for better caching
export const LazyMonacoEditor = React.lazy(
  () => import(/* webpackChunkName: "monaco-editor" */ '@monaco-editor/react')
);

export function MonacoEditorLazy(props: any) {
  return (
    <LazyLoadErrorBoundary
      componentName="Editor de Código"
      loadingComponent={<MonacoLoadingFallback />}
    >
      <Suspense fallback={<MonacoLoadingFallback />}>
        <LazyMonacoEditor {...props} />
      </Suspense>
    </LazyLoadErrorBoundary>
  );
}

// ============================================
// HEAVY COMPONENTS - HANDSONTABLE (~1.5MB)
// ============================================

function HandsontableLoadingFallback() {
  return (
    <LoadingFallback
      height="100%"
      message="Cargando hoja de cálculo..."
      showProgress={true}
    />
  );
}

// Handsontable lazy loaded with chunk naming
export const LazyHandsontable = React.lazy(
  () => import(/* webpackChunkName: "handsontable" */ '@handsontable/react').then(module => ({ default: module.HotTable }))
);

export function HandsontableLazy(props: any) {
  return (
    <LazyLoadErrorBoundary
      componentName="Hoja de Cálculo"
      loadingComponent={<HandsontableLoadingFallback />}
    >
      <Suspense fallback={<HandsontableLoadingFallback />}>
        <LazyHandsontable {...props} />
      </Suspense>
    </LazyLoadErrorBoundary>
  );
}

// ============================================
// PREFETCHING UTILITIES
// ============================================

type PrefetchableComponent = 'monaco' | 'handsontable' | 'document' | 'spreadsheet';

const prefetchedComponents = new Set<PrefetchableComponent>();

/**
 * Prefetch heavy components before they're needed
 * Call this when user shows intent to use the component (hover, focus, etc.)
 */
export function prefetchComponent(component: PrefetchableComponent): void {
  if (prefetchedComponents.has(component)) return;
  prefetchedComponents.add(component);

  switch (component) {
    case 'monaco':
      import(/* webpackChunkName: "monaco-editor" */ '@monaco-editor/react').catch(() => {
        prefetchedComponents.delete(component);
      });
      break;
    case 'handsontable':
      import(/* webpackChunkName: "handsontable" */ '@handsontable/react').catch(() => {
        prefetchedComponents.delete(component);
      });
      break;
    case 'document':
      import('@/components/ribbon').catch(() => {
        prefetchedComponents.delete(component);
      });
      break;
    case 'spreadsheet':
      import('@/components/spreadsheet-editor').catch(() => {
        prefetchedComponents.delete(component);
      });
      break;
  }
}

/**
 * Prefetch multiple components at once
 */
export function prefetchComponents(components: PrefetchableComponent[]): void {
  components.forEach(prefetchComponent);
}

/**
 * Hook to prefetch component on hover/focus
 */
export function usePrefetch(component: PrefetchableComponent) {
  return {
    onMouseEnter: () => prefetchComponent(component),
    onFocus: () => prefetchComponent(component),
  };
}

/**
 * Prefetch commonly used heavy components during idle time
 */
export function prefetchOnIdle(): void {
  if ('requestIdleCallback' in window) {
    (window as any).requestIdleCallback(() => {
      // Prefetch based on user's likely needs
      // Don't prefetch everything - only what's likely needed
    }, { timeout: 5000 });
  }
}
