/**
 * Lazy Loading Components (#5)
 * Dynamic imports for heavy components to reduce bundle
 */

import React, { Suspense, lazy, ComponentType, ReactNode } from 'react';
import { Loader2 } from 'lucide-react';

// ============================================
// LOADING FALLBACKS
// ============================================

export function LoadingSpinner({ size = 'md' }: { size?: 'sm' | 'md' | 'lg' }) {
    const sizeClasses = {
        sm: 'w-4 h-4',
        md: 'w-6 h-6',
        lg: 'w-8 h-8',
    };

    return (
        <div className="flex items-center justify-center p-4">
            <Loader2 className={`${sizeClasses[size]} animate-spin text-primary`} />
        </div>
    );
}

export function ModalLoading() {
    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-background/80 backdrop-blur-sm">
            <div className="bg-card p-6 rounded-lg shadow-lg">
                <LoadingSpinner size="lg" />
                <p className="mt-2 text-sm text-muted-foreground">Cargando...</p>
            </div>
        </div>
    );
}

export function PageLoading() {
    return (
        <div className="min-h-screen flex items-center justify-center">
            <div className="text-center">
                <LoadingSpinner size="lg" />
                <p className="mt-4 text-muted-foreground">Cargando página...</p>
            </div>
        </div>
    );
}

export function SectionLoading() {
    return (
        <div className="w-full h-64 flex items-center justify-center">
            <LoadingSpinner />
        </div>
    );
}

// ============================================
// LAZY COMPONENT WRAPPER
// ============================================

interface LazyOptions {
    fallback?: ReactNode;
    onError?: (error: Error) => void;
}

export function lazyLoad<T extends ComponentType<any>>(
    importFn: () => Promise<{ default: T }>,
    options: LazyOptions = {}
) {
    const LazyComponent = lazy(importFn);

    return function LazyWrapper(props: React.ComponentProps<T>) {
        return (
            <Suspense fallback={options.fallback || <LoadingSpinner />}>
                <LazyComponent {...props} />
            </Suspense>
        );
    };
}

// ============================================
// LAZY LOADED COMPONENTS
// ============================================

// Heavy modals
export const LazySearchModal = lazyLoad(
    () => import('@/components/modals/SearchModal'),
    { fallback: <ModalLoading /> }
);

export const LazySettingsModal = lazyLoad(
    () => import('@/components/modals/SettingsModal'),
    { fallback: <ModalLoading /> }
);

export const LazyGPTBuilder = lazyLoad(
    () => import('@/components/gpt-builder/GPTBuilder'),
    { fallback: <ModalLoading /> }
);

export const LazyToolCatalog = lazyLoad(
    () => import('@/components/tools/ToolCatalog'),
    { fallback: <ModalLoading /> }
);

// Document tools
export const LazyWordEditor = lazyLoad(
    () => import('@/components/editors/WordEditor'),
    { fallback: <SectionLoading /> }
);

export const LazyExcelEditor = lazyLoad(
    () => import('@/components/editors/ExcelEditor'),
    { fallback: <SectionLoading /> }
);

export const LazyPptEditor = lazyLoad(
    () => import('@/components/editors/PptEditor'),
    { fallback: <SectionLoading /> }
);

// Heavy libraries
export const LazyPdfPreview = lazyLoad(
    () => import('@/components/PdfPreview'),
    { fallback: <SectionLoading /> }
);

export const LazyCodeEditor = lazyLoad(
    () => import('@/components/editors/CodeEditor'),
    { fallback: <SectionLoading /> }
);

export const LazyDiagramEditor = lazyLoad(
    () => import('@/components/editors/DiagramEditor'),
    { fallback: <SectionLoading /> }
);

// Charts and visualizations
export const LazyCharts = lazyLoad(
    () => import('@/components/visualizations/Charts'),
    { fallback: <SectionLoading /> }
);

// ============================================
// PRELOAD UTILITIES
// ============================================

const preloadedComponents = new Set<string>();

export function preloadComponent(componentName: string) {
    if (preloadedComponents.has(componentName)) return;

    const importMap: Record<string, () => Promise<any>> = {
        SearchModal: () => import('@/components/modals/SearchModal'),
        SettingsModal: () => import('@/components/modals/SettingsModal'),
        GPTBuilder: () => import('@/components/gpt-builder/GPTBuilder'),
        ToolCatalog: () => import('@/components/tools/ToolCatalog'),
        WordEditor: () => import('@/components/editors/WordEditor'),
        ExcelEditor: () => import('@/components/editors/ExcelEditor'),
        PptEditor: () => import('@/components/editors/PptEditor'),
        PdfPreview: () => import('@/components/PdfPreview'),
    };

    const importFn = importMap[componentName];
    if (importFn) {
        importFn();
        preloadedComponents.add(componentName);
    }
}

// Preload on hover (for links/buttons)
export function usePreloadOnHover(componentName: string) {
    return {
        onMouseEnter: () => preloadComponent(componentName),
        onFocus: () => preloadComponent(componentName),
    };
}

// ============================================
// CONDITIONAL LAZY LOADING
// ============================================

interface ConditionalLazyProps {
    condition: boolean;
    component: React.LazyExoticComponent<any>;
    fallback?: ReactNode;
    loadingFallback?: ReactNode;
    props?: Record<string, any>;
}

export function ConditionalLazy({
    condition,
    component: Component,
    fallback = null,
    loadingFallback = <LoadingSpinner />,
    props = {},
}: ConditionalLazyProps) {
    if (!condition) return <>{fallback}</>;

    return (
        <Suspense fallback={loadingFallback}>
            <Component {...props} />
        </Suspense>
    );
}

// ============================================
// INTERSECTION OBSERVER LAZY LOADING
// ============================================

import { useRef, useState, useEffect } from 'react';

export function LazyOnVisible({
    children,
    fallback = <SectionLoading />,
    threshold = 0.1,
    rootMargin = '100px',
}: {
    children: ReactNode;
    fallback?: ReactNode;
    threshold?: number;
    rootMargin?: string;
}) {
    const ref = useRef<HTMLDivElement>(null);
    const [isVisible, setIsVisible] = useState(false);

    useEffect(() => {
        const observer = new IntersectionObserver(
            ([entry]) => {
                if (entry.isIntersecting) {
                    setIsVisible(true);
                    observer.disconnect();
                }
            },
            { threshold, rootMargin }
        );

        if (ref.current) {
            observer.observe(ref.current);
        }

        return () => observer.disconnect();
    }, [threshold, rootMargin]);

    return (
        <div ref={ref}>
            {isVisible ? children : fallback}
        </div>
    );
}
