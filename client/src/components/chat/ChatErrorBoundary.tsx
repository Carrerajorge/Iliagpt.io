/**
 * ChatErrorBoundary.tsx - React Error Boundary para la interfaz de chat
 *
 * Captura errores de renderizado dentro del chat:
 *  - Preserva la conversación existente cuando es posible
 *  - Ofrece opciones de reset
 *  - Loggea errores para debugging
 */

import React, { Component, type ErrorInfo, type ReactNode } from 'react';

interface ErrorBoundaryProps {
  children: ReactNode;
  fallback?: ReactNode;
  onError?: (error: Error, errorInfo: ErrorInfo) => void;
  onReset?: () => void;
}

interface ErrorBoundaryState {
  hasError: boolean;
  error: Error | null;
  errorId: string; // Para forzar re-render si el mismo error ocurre de nuevo
}

export class ChatErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  private retryCount = 0;
  static maxAutoRetries = 2;

  constructor(props: ErrorBoundaryProps) {
    super(props);
    this.state = { hasError: false, error: null, errorId: '' };
  }

  static getDerivedStateFromError(error: Error): Partial<ErrorBoundaryState> {
    return { hasError: true, error, errorId: `${Date.now()}_${Math.random().toString(36).slice(2, 6)}` };
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo): void {
    // Loggear para debug
    console.error('[ChatErrorBoundary] Error capturado:', {
      message: error.message,
      stack: error.stack?.slice(0, 500),
      componentStack: errorInfo.componentStack?.slice(0, 500),
      timestamp: new Date().toISOString(),
    });

    // Notificar al prop si existe
    this.props.onError?.(error, errorInfo);

    // Intentar auto-recuperación (a veces los errores son transitorios)
    if (this.retryCount < ChatErrorBoundary.maxAutoRetries) {
      this.retryCount++;
      console.log(`[ChatErrorBoundary] Auto-reintento ${this.retryCount}/${ChatErrorBoundary.maxAutoRetries}`);
      setTimeout(() => {
        this.setState({ hasError: false, error: null });
      }, 1_000);
    }
  }

  handleRetry = (): void => {
    this.retryCount = 0;
    this.setState({ hasError: false, error: null });
    this.props.onReset?.();
  };

  handleHardReset = (): void => {
    this.retryCount = 0;

    // Intentar limpiar estado local
    try {
      localStorage.removeItem('ChatStore');
    } catch { /* ignorar */ }

    this.setState({ hasError: false, error: null });

    // Forzar recarga del chat
    window.dispatchEvent(new CustomEvent('chat:error-boundary-reset'));

    this.props.onReset?.();
  };

  render(): ReactNode {
    if (this.state.hasError) {
      // Si se pasó un fallback personalizado, usarlo
      if (this.props.fallback) {
        return this.props.fallback;
      }

      // Default UI
      return (
        <div
          role="alert"
          className="flex flex-col items-center justify-center min-h-[200px] p-6
            bg-gray-50 dark:bg-gray-900/50 rounded-xl border border-red-200 dark:border-red-800/40"
          style={{ animation: 'fadeIn 0.3s ease-out' }}
        >
          <div className="text-4xl mb-3" aria-hidden="true">😵‍💫</div>
          <h3 className="text-lg font-semibold text-gray-800 dark:text-gray-200 mb-1">
            Algo salió mal en el chat
          </h3>
          <p className="text-sm text-gray-500 dark:text-gray-400 mb-4 text-center max-w-md">
            {this.state.error?.message.slice(0, 200) || 'Ocurrió un error inesperado'}
          </p>

          <div className="flex items-center gap-3">
            <button
              onClick={this.handleRetry}
              className="
                px-4 py-2 text-sm font-medium rounded-lg
                bg-blue-600 hover:bg-blue-700 active:scale-[0.97]
                text-white transition-all duration-150 shadow-sm
              "
            >
              🔄 Reintentar
            </button>

            <button
              onClick={this.handleHardReset}
              className="
                px-4 py-2 text-sm font-medium rounded-lg
                bg-white hover:bg-gray-100 active:scale-[0.97]
                text-gray-700 border border-gray-300 dark:bg-gray-800 dark:text-gray-300
                dark:border-gray-600 dark:hover:bg-gray-700
                transition-all duration-150
              "
            >
              🔒 Reiniciar chat
            </button>
          </div>

          <p className="text-xs text-gray-400 dark:text-gray-500 mt-3">
            Tu conversación está a salvo — solo se reiniciará la interfaz
          </p>
        </div>
      );
    }

    return this.props.children;
  }
}

// HOC para envolver componentes fácilmente
export function withChatErrorBoundary<P extends object>(
  WrappedComponent: React.ComponentType<P>,
  options?: Omit<ErrorBoundaryProps, 'children'>
): React.FC<P> {
  const displayName = WrappedComponent.displayName || WrappedComponent.name || 'Component';

  const ComponentWithErrorBoundary: React.FC<P> = (props) => (
    <ChatErrorBoundary {...options}>
      <WrappedComponent {...props} />
    </ChatErrorBoundary>
  );

  ComponentWithErrorBoundary.displayName = `withChatErrorBoundary(${displayName})`;
  return ComponentWithErrorBoundary;
}

export default ChatErrorBoundary;
