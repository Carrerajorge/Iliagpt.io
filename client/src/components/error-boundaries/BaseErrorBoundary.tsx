import React, { Component, ErrorInfo, ReactNode } from 'react';
import { AlertTriangle, RefreshCw, Bug, Copy, ChevronDown, ChevronUp } from 'lucide-react';

interface ErrorDetails {
  message: string;
  stack?: string;
  componentStack?: string;
  timestamp: Date;
  errorId: string;
  componentName?: string;
  props?: Record<string, any>;
}

interface Props {
  children: ReactNode;
  fallback?: ReactNode | ((error: ErrorDetails, retry: () => void) => ReactNode);
  onError?: (error: ErrorDetails) => void;
  componentName?: string;
  showDetails?: boolean;
  allowRetry?: boolean;
  maxRetries?: number;
  retryDelay?: number;
  logToServer?: boolean;
}

interface State {
  hasError: boolean;
  error: ErrorDetails | null;
  retryCount: number;
  showStack: boolean;
}

function generateErrorId(): string {
  return `err_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
}

export class BaseErrorBoundary extends Component<Props, State> {
  static defaultProps = {
    showDetails: process.env.NODE_ENV === 'development',
    allowRetry: true,
    maxRetries: 3,
    retryDelay: 1000,
    logToServer: true
  };

  constructor(props: Props) {
    super(props);
    this.state = {
      hasError: false,
      error: null,
      retryCount: 0,
      showStack: false
    };
  }

  static getDerivedStateFromError(error: Error): Partial<State> {
    return {
      hasError: true,
      error: {
        message: error.message,
        stack: error.stack,
        timestamp: new Date(),
        errorId: generateErrorId()
      }
    };
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    const errorDetails: ErrorDetails = {
      message: error.message,
      stack: error.stack,
      componentStack: errorInfo.componentStack || undefined,
      timestamp: new Date(),
      errorId: generateErrorId(),
      componentName: this.props.componentName
    };

    this.setState({ error: errorDetails });
    this.props.onError?.(errorDetails);

    console.group(`[ErrorBoundary] ${this.props.componentName || 'Unknown'}`);
    console.error('Error:', error);
    console.error('Component Stack:', errorInfo.componentStack);
    console.error('Error ID:', errorDetails.errorId);
    console.groupEnd();

    if (this.props.logToServer) {
      this.logErrorToServer(errorDetails);
    }
  }

  async logErrorToServer(errorDetails: ErrorDetails) {
    try {
      await fetch('/api/errors/log', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...errorDetails,
          url: window.location.href,
          userAgent: navigator.userAgent,
          timestamp: errorDetails.timestamp.toISOString()
        })
      });
    } catch (e) {
      console.warn('Failed to log error to server:', e);
    }
  }

  handleRetry = () => {
    const { maxRetries, retryDelay } = this.props;
    const { retryCount } = this.state;

    if (retryCount < (maxRetries || 3)) {
      setTimeout(() => {
        this.setState(prev => ({
          hasError: false,
          error: null,
          retryCount: prev.retryCount + 1
        }));
      }, retryDelay);
    }
  };

  handleCopyError = () => {
    const { error } = this.state;
    if (!error) return;

    const errorText = `
Error ID: ${error.errorId}
Component: ${error.componentName || 'Unknown'}
Message: ${error.message}
Time: ${error.timestamp.toISOString()}
Stack: ${error.stack || 'N/A'}
Component Stack: ${error.componentStack || 'N/A'}
    `.trim();

    navigator.clipboard.writeText(errorText);
  };

  toggleStack = () => {
    this.setState(prev => ({ showStack: !prev.showStack }));
  };

  render() {
    const { hasError, error, retryCount, showStack } = this.state;
    const { children, fallback, showDetails, allowRetry, maxRetries, componentName } = this.props;

    if (!hasError) {
      return children;
    }

    if (fallback) {
      if (typeof fallback === 'function') {
        return fallback(error!, this.handleRetry);
      }
      return fallback;
    }

    const canRetry = allowRetry && retryCount < (maxRetries || 3);

    return (
      <div className="flex flex-col items-center justify-center p-6 bg-red-900/20 border border-red-500/30 rounded-lg m-2">
        <div className="flex items-center gap-3 mb-4">
          <AlertTriangle className="w-8 h-8 text-red-400" />
          <div>
            <h3 className="text-lg font-semibold text-red-300">
              Error en {componentName || 'componente'}
            </h3>
            <p className="text-sm text-red-400/80">
              {error?.message || 'Ha ocurrido un error inesperado'}
            </p>
          </div>
        </div>

        <div className="flex items-center gap-3 mb-4">
          {canRetry && (
            <button
              onClick={this.handleRetry}
              className="flex items-center gap-2 px-4 py-2 bg-red-600 hover:bg-red-500 text-white rounded-lg transition-colors"
              data-testid="button-retry"
            >
              <RefreshCw className="w-4 h-4" />
              Reintentar ({retryCount}/{maxRetries})
            </button>
          )}
          
          <button
            onClick={this.handleCopyError}
            className="flex items-center gap-2 px-4 py-2 bg-gray-700 hover:bg-gray-600 text-white rounded-lg transition-colors"
            data-testid="button-copy-error"
          >
            <Copy className="w-4 h-4" />
            Copiar error
          </button>
        </div>

        {showDetails && error && (
          <div className="w-full max-w-2xl">
            <button
              onClick={this.toggleStack}
              className="flex items-center gap-2 text-sm text-gray-400 hover:text-gray-300 mb-2"
              data-testid="button-toggle-stack"
            >
              <Bug className="w-4 h-4" />
              Detalles técnicos
              {showStack ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
            </button>

            {showStack && (
              <div className="bg-gray-900 rounded-lg p-4 text-xs font-mono overflow-auto max-h-64">
                <div className="text-gray-500 mb-2">Error ID: {error.errorId}</div>
                <div className="text-red-400 mb-2">{error.message}</div>
                {error.stack && (
                  <pre className="text-gray-400 whitespace-pre-wrap">{error.stack}</pre>
                )}
                {error.componentStack && (
                  <>
                    <div className="text-gray-500 mt-4 mb-2">Component Stack:</div>
                    <pre className="text-gray-400 whitespace-pre-wrap">{error.componentStack}</pre>
                  </>
                )}
              </div>
            )}
          </div>
        )}

        <div className="text-xs text-gray-500 mt-4">
          ID de error: <code className="bg-gray-800 px-2 py-1 rounded">{error?.errorId}</code>
        </div>
      </div>
    );
  }
}

export type { ErrorDetails };
