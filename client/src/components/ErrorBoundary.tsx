/**
 * Error Boundaries (#6)
 * Granular error handling for different app sections
 */

import React, { Component, ErrorInfo, ReactNode } from 'react';
import { AlertTriangle, RefreshCw, Home, Bug } from 'lucide-react';
import { Button } from '@/components/ui/button';

interface ErrorBoundaryProps {
    children: ReactNode;
    fallback?: ReactNode;
    onError?: (error: Error, errorInfo: ErrorInfo) => void;
    onReset?: () => void;
    resetKeys?: any[];
    level?: 'page' | 'section' | 'component';
    name?: string;
}

interface ErrorBoundaryState {
    hasError: boolean;
    error: Error | null;
    errorInfo: ErrorInfo | null;
}

export class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
    constructor(props: ErrorBoundaryProps) {
        super(props);
        this.state = { hasError: false, error: null, errorInfo: null };
    }

    static getDerivedStateFromError(error: Error): Partial<ErrorBoundaryState> {
        return { hasError: true, error };
    }

    componentDidCatch(error: Error, errorInfo: ErrorInfo) {
        this.setState({ errorInfo });

        // Log error
        console.error(`[ErrorBoundary:${this.props.name || 'unknown'}]`, error, errorInfo);

        // Call custom error handler
        this.props.onError?.(error, errorInfo);

        // Report to error tracking service in production
        if (process.env.NODE_ENV === 'production') {
            // reportError(error, errorInfo);
        }
    }

    componentDidUpdate(prevProps: ErrorBoundaryProps) {
        // Reset error state when resetKeys change
        if (this.state.hasError && this.props.resetKeys) {
            const hasChanged = this.props.resetKeys.some(
                (key, index) => key !== prevProps.resetKeys?.[index]
            );
            if (hasChanged) {
                this.reset();
            }
        }
    }

    reset = () => {
        this.setState({ hasError: false, error: null, errorInfo: null });
        this.props.onReset?.();
    };

    render() {
        if (this.state.hasError) {
            if (this.props.fallback) {
                return this.props.fallback;
            }

            const level = this.props.level || 'component';
            return (
                <ErrorFallback
                    error={this.state.error}
                    errorInfo={this.state.errorInfo}
                    level={level}
                    onReset={this.reset}
                    name={this.props.name}
                />
            );
        }

        return this.props.children;
    }
}

// ============================================
// ERROR FALLBACK COMPONENTS
// ============================================

interface ErrorFallbackProps {
    error: Error | null;
    errorInfo: ErrorInfo | null;
    level: 'page' | 'section' | 'component';
    onReset: () => void;
    name?: string;
}

function ErrorFallback({ error, errorInfo, level, onReset, name }: ErrorFallbackProps) {
    const isProduction = process.env.NODE_ENV === 'production';

    if (level === 'page') {
        return (
            <div className="min-h-screen flex items-center justify-center bg-background p-4">
                <div className="max-w-md w-full text-center space-y-6">
                    <div className="w-16 h-16 mx-auto rounded-full bg-destructive/10 flex items-center justify-center">
                        <AlertTriangle className="w-8 h-8 text-destructive" />
                    </div>
                    <div>
                        <h1 className="text-2xl font-bold mb-2">Algo salió mal</h1>
                        <p className="text-muted-foreground">
                            Ha ocurrido un error inesperado. Por favor intenta de nuevo.
                        </p>
                    </div>
                    {!isProduction && error && (
                        <pre className="text-left text-xs bg-muted p-4 rounded-lg overflow-auto max-h-48">
                            {error.message}
                        </pre>
                    )}
                    <div className="flex gap-3 justify-center">
                        <Button onClick={onReset} variant="outline">
                            <RefreshCw className="w-4 h-4 mr-2" />
                            Reintentar
                        </Button>
                        <Button onClick={() => window.location.href = '/'}>
                            <Home className="w-4 h-4 mr-2" />
                            Ir al inicio
                        </Button>
                    </div>
                </div>
            </div>
        );
    }

    if (level === 'section') {
        return (
            <div className="p-6 border border-destructive/20 rounded-lg bg-destructive/5">
                <div className="flex items-start gap-4">
                    <div className="w-10 h-10 rounded-full bg-destructive/10 flex items-center justify-center flex-shrink-0">
                        <AlertTriangle className="w-5 h-5 text-destructive" />
                    </div>
                    <div className="flex-1 min-w-0">
                        <h3 className="font-medium mb-1">Error en {name || 'esta sección'}</h3>
                        <p className="text-sm text-muted-foreground mb-3">
                            Esta parte de la aplicación encontró un problema.
                        </p>
                        {!isProduction && error && (
                            <p className="text-xs text-destructive mb-3 font-mono">
                                {error.message}
                            </p>
                        )}
                        <Button size="sm" variant="outline" onClick={onReset}>
                            <RefreshCw className="w-3 h-3 mr-2" />
                            Reintentar
                        </Button>
                    </div>
                </div>
            </div>
        );
    }

    // Component level - minimal UI
    return (
        <div className="p-3 border border-destructive/20 rounded bg-destructive/5 text-sm">
            <div className="flex items-center gap-2 text-destructive">
                <Bug className="w-4 h-4" />
                <span>Error al cargar {name || 'componente'}</span>
                <Button
                    size="sm"
                    variant="ghost"
                    className="ml-auto h-6 px-2"
                    onClick={onReset}
                >
                    Reintentar
                </Button>
            </div>
        </div>
    );
}

// ============================================
// SPECIALIZED BOUNDARIES
// ============================================

export function ChatErrorBoundary({ children }: { children: ReactNode }) {
    return (
        <ErrorBoundary
            level="section"
            name="Chat"
            onError={(error) => {
                console.error('Chat error:', error);
            }}
        >
            {children}
        </ErrorBoundary>
    );
}

export function SidebarErrorBoundary({ children }: { children: ReactNode }) {
    return (
        <ErrorBoundary
            level="section"
            name="Sidebar"
            fallback={
                <div className="w-full h-full flex items-center justify-center p-4">
                    <p className="text-sm text-muted-foreground">
                        Error al cargar sidebar
                    </p>
                </div>
            }
        >
            {children}
        </ErrorBoundary>
    );
}

export function ModalErrorBoundary({ children }: { children: ReactNode }) {
    return (
        <ErrorBoundary
            level="component"
            name="Modal"
        >
            {children}
        </ErrorBoundary>
    );
}

export function MessageErrorBoundary({ children }: { children: ReactNode }) {
    return (
        <ErrorBoundary
            level="component"
            name="Mensaje"
            fallback={
                <div className="p-3 text-sm text-muted-foreground italic">
                    Error al mostrar mensaje
                </div>
            }
        >
            {children}
        </ErrorBoundary>
    );
}

export function ToolErrorBoundary({ children, toolName }: { children: ReactNode; toolName: string }) {
    return (
        <ErrorBoundary
            level="component"
            name={toolName}
        >
            {children}
        </ErrorBoundary>
    );
}

// ============================================
// HOOK FOR FUNCTIONAL COMPONENTS
// ============================================

import { useState, useCallback } from 'react';

export function useErrorHandler() {
    const [error, setError] = useState<Error | null>(null);

    const handleError = useCallback((error: Error) => {
        setError(error);
        console.error('Caught error:', error);
    }, []);

    const clearError = useCallback(() => {
        setError(null);
    }, []);

    const withErrorHandler = useCallback(<T extends (...args: any[]) => Promise<any>>(
        fn: T
    ) => {
        return async (...args: Parameters<T>): Promise<ReturnType<T> | undefined> => {
            try {
                return await fn(...args);
            } catch (err) {
                handleError(err instanceof Error ? err : new Error(String(err)));
                return undefined;
            }
        };
    }, [handleError]);

    return { error, handleError, clearError, withErrorHandler };
}
