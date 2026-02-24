/**
 * Error Boundaries
 * 
 * Granular error boundaries for:
 * - Full page errors
 * - Section errors (chat, sidebar)
 * - Component errors
 */

import React, { Component, ErrorInfo, ReactNode } from 'react';
import { AlertTriangle, RefreshCw, Home } from 'lucide-react';

interface ErrorBoundaryProps {
    children: ReactNode;
    fallback?: ReactNode;
    onError?: (error: Error, errorInfo: ErrorInfo) => void;
    level?: 'page' | 'section' | 'component';
    resetKey?: string;
}

interface ErrorBoundaryState {
    hasError: boolean;
    error: Error | null;
    errorInfo: ErrorInfo | null;
}

export class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
    static defaultProps = {
        level: 'component',
    };

    state: ErrorBoundaryState = {
        hasError: false,
        error: null,
        errorInfo: null,
    };

    static getDerivedStateFromError(error: Error): Partial<ErrorBoundaryState> {
        return { hasError: true, error };
    }

    componentDidCatch(error: Error, errorInfo: ErrorInfo): void {
        this.setState({ errorInfo });

        // Log to console in development
        if (import.meta.env.DEV) {
            console.error('[ErrorBoundary] Caught error:', error, errorInfo);
        }

        // Call custom error handler
        this.props.onError?.(error, errorInfo);

        // Log error for analytics (Sentry-ready hook)
        if (typeof window !== 'undefined' && (window as any).Sentry) {
            (window as any).Sentry.captureException(error, {
                extra: { componentStack: errorInfo?.componentStack }
            });
        }
    }

    componentDidUpdate(prevProps: ErrorBoundaryProps): void {
        // Reset error state when resetKey changes
        if (this.state.hasError && prevProps.resetKey !== this.props.resetKey) {
            this.setState({ hasError: false, error: null, errorInfo: null });
        }
    }

    handleRetry = (): void => {
        this.setState({ hasError: false, error: null, errorInfo: null });
    };

    handleGoHome = (): void => {
        window.location.href = '/';
    };

    render(): ReactNode {
        if (this.state.hasError) {
            if (this.props.fallback) {
                return this.props.fallback;
            }

            const { level } = this.props;
            const { error } = this.state;

            // Page-level error (full screen)
            if (level === 'page') {
                return (
                    <div className="min-h-screen flex items-center justify-center bg-background p-6">
                        <div className="max-w-md w-full text-center space-y-6">
                            <div className="mx-auto w-16 h-16 rounded-full bg-destructive/10 flex items-center justify-center">
                                <AlertTriangle className="w-8 h-8 text-destructive" />
                            </div>
                            <div className="space-y-2">
                                <h1 className="text-2xl font-bold">Algo salió mal</h1>
                                <p className="text-muted-foreground">
                                    Ha ocurrido un error inesperado. Por favor, intenta de nuevo.
                                </p>
                                {import.meta.env.DEV && error && (
                                    <pre className="mt-4 p-4 bg-muted rounded-lg text-left text-xs overflow-auto max-h-32">
                                        {error.message}
                                    </pre>
                                )}
                            </div>
                            <div className="flex gap-3 justify-center">
                                <button
                                    onClick={this.handleRetry}
                                    className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-primary text-primary-foreground hover:bg-primary/90"
                                >
                                    <RefreshCw className="w-4 h-4" />
                                    Reintentar
                                </button>
                                <button
                                    onClick={this.handleGoHome}
                                    className="inline-flex items-center gap-2 px-4 py-2 rounded-lg border hover:bg-muted"
                                >
                                    <Home className="w-4 h-4" />
                                    Inicio
                                </button>
                            </div>
                        </div>
                    </div>
                );
            }

            // Section-level error (card style)
            if (level === 'section') {
                return (
                    <div className="rounded-lg border bg-card p-6 text-center space-y-4">
                        <div className="mx-auto w-12 h-12 rounded-full bg-destructive/10 flex items-center justify-center">
                            <AlertTriangle className="w-6 h-6 text-destructive" />
                        </div>
                        <div className="space-y-1">
                            <p className="font-medium">Error en esta sección</p>
                            <p className="text-sm text-muted-foreground">
                                No se pudo cargar este contenido.
                            </p>
                        </div>
                        <button
                            onClick={this.handleRetry}
                            className="inline-flex items-center gap-2 px-3 py-1.5 text-sm rounded-lg bg-primary text-primary-foreground hover:bg-primary/90"
                        >
                            <RefreshCw className="w-3 h-3" />
                            Reintentar
                        </button>
                    </div>
                );
            }

            // Component-level error (minimal)
            return (
                <div className="p-4 rounded-lg bg-destructive/5 border border-destructive/20 text-sm">
                    <div className="flex items-center gap-2 text-destructive">
                        <AlertTriangle className="w-4 h-4" />
                        <span>Error al cargar</span>
                        <button
                            onClick={this.handleRetry}
                            className="ml-auto text-xs underline hover:no-underline"
                        >
                            Reintentar
                        </button>
                    </div>
                </div>
            );
        }

        return this.props.children;
    }
}

// HOC for wrapping components with error boundary
export function withErrorBoundary<P extends object>(
    Component: React.ComponentType<P>,
    level: 'page' | 'section' | 'component' = 'component'
) {
    return function WrappedWithErrorBoundary(props: P) {
        return (
            <ErrorBoundary level={level}>
                <Component {...props} />
            </ErrorBoundary>
        );
    };
}

// Specific error boundaries for common sections
export function ChatErrorBoundary({ children }: { children: ReactNode }) {
    return (
        <ErrorBoundary level="section" onError={(error) => {
            console.error('[Chat] Error:', error);
        }}>
            {children}
        </ErrorBoundary>
    );
}

export function SidebarErrorBoundary({ children }: { children: ReactNode }) {
    return (
        <ErrorBoundary level="section" onError={(error) => {
            console.error('[Sidebar] Error:', error);
        }}>
            {children}
        </ErrorBoundary>
    );
}

export function ModalErrorBoundary({ children }: { children: ReactNode }) {
    return (
        <ErrorBoundary level="component" onError={(error) => {
            console.error('[Modal] Error:', error);
        }}>
            {children}
        </ErrorBoundary>
    );
}

export function EditorErrorBoundary({ children }: { children: ReactNode }) {
    return (
        <ErrorBoundary level="component" onError={(error) => {
            console.error('[Editor] Error:', error);
        }}>
            {children}
        </ErrorBoundary>
    );
}

export function LazyLoadErrorBoundary({ children }: { children: ReactNode }) {
    return (
        <ErrorBoundary level="component" onError={(error) => {
            console.error('[LazyLoad] Error:', error);
        }}>
            {children}
        </ErrorBoundary>
    );
}

export function ThreeJSErrorBoundary({ children }: { children: ReactNode }) {
    return (
        <ErrorBoundary level="component" onError={(error) => {
            console.error('[ThreeJS] Error:', error);
        }}>
            {children}
        </ErrorBoundary>
    );
}
