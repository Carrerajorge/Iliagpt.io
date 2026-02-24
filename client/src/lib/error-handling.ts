/**
 * Unified Error Handling System
 * Consistent error handling, display, and reporting across the frontend
 */

import { t } from './i18n';

// Error types
export enum ErrorType {
  NETWORK = 'network',
  AUTHENTICATION = 'auth',
  AUTHORIZATION = 'authorization',
  VALIDATION = 'validation',
  NOT_FOUND = 'not_found',
  RATE_LIMIT = 'rate_limit',
  SERVER = 'server',
  CLIENT = 'client',
  TIMEOUT = 'timeout',
  UNKNOWN = 'unknown',
}

// Error severity levels
export enum ErrorSeverity {
  INFO = 'info',
  WARNING = 'warning',
  ERROR = 'error',
  CRITICAL = 'critical',
}

// Application error interface
export interface AppError {
  type: ErrorType;
  severity: ErrorSeverity;
  message: string;
  userMessage: string;
  code?: string;
  details?: Record<string, unknown>;
  recoverable: boolean;
  retryable: boolean;
  originalError?: Error;
  timestamp: Date;
}

// Error messages in Spanish
const ERROR_MESSAGES: Record<ErrorType, { title: string; message: string }> = {
  [ErrorType.NETWORK]: {
    title: 'Error de conexión',
    message: 'No se pudo conectar con el servidor. Verifica tu conexión a internet.',
  },
  [ErrorType.AUTHENTICATION]: {
    title: 'Sesión expirada',
    message: 'Tu sesión ha expirado. Por favor, inicia sesión nuevamente.',
  },
  [ErrorType.AUTHORIZATION]: {
    title: 'Acceso denegado',
    message: 'No tienes permisos para realizar esta acción.',
  },
  [ErrorType.VALIDATION]: {
    title: 'Datos inválidos',
    message: 'Por favor, revisa los datos ingresados.',
  },
  [ErrorType.NOT_FOUND]: {
    title: 'No encontrado',
    message: 'El recurso solicitado no existe o fue eliminado.',
  },
  [ErrorType.RATE_LIMIT]: {
    title: 'Límite alcanzado',
    message: 'Has realizado demasiadas solicitudes. Espera un momento antes de continuar.',
  },
  [ErrorType.SERVER]: {
    title: 'Error del servidor',
    message: 'Ocurrió un error en el servidor. Intenta nuevamente en unos minutos.',
  },
  [ErrorType.CLIENT]: {
    title: 'Error de aplicación',
    message: 'Ocurrió un error inesperado. Intenta recargar la página.',
  },
  [ErrorType.TIMEOUT]: {
    title: 'Tiempo agotado',
    message: 'La operación tardó demasiado. Intenta nuevamente.',
  },
  [ErrorType.UNKNOWN]: {
    title: 'Error desconocido',
    message: 'Ocurrió un error inesperado. Por favor, intenta nuevamente.',
  },
};

/**
 * Create a standardized AppError from various error sources
 */
export function createAppError(
  error: unknown,
  context?: { action?: string; component?: string }
): AppError {
  const timestamp = new Date();

  // Handle Response/fetch errors
  if (error instanceof Response) {
    return createErrorFromResponse(error, timestamp);
  }

  // Handle Error objects
  if (error instanceof Error) {
    return createErrorFromException(error, timestamp, context);
  }

  // Handle API error responses
  if (typeof error === 'object' && error !== null && 'message' in error) {
    const apiError = error as { message: string; code?: string; status?: number };
    return createErrorFromAPIResponse(apiError, timestamp);
  }

  // Unknown error
  return {
    type: ErrorType.UNKNOWN,
    severity: ErrorSeverity.ERROR,
    message: String(error),
    userMessage: ERROR_MESSAGES[ErrorType.UNKNOWN].message,
    recoverable: true,
    retryable: true,
    timestamp,
  };
}

function createErrorFromResponse(response: Response, timestamp: Date): AppError {
  const type = getErrorTypeFromStatus(response.status);
  const errorInfo = ERROR_MESSAGES[type];

  return {
    type,
    severity: response.status >= 500 ? ErrorSeverity.CRITICAL : ErrorSeverity.ERROR,
    message: `HTTP ${response.status}: ${response.statusText}`,
    userMessage: errorInfo.message,
    code: `HTTP_${response.status}`,
    recoverable: response.status < 500,
    retryable: [408, 429, 500, 502, 503, 504].includes(response.status),
    timestamp,
  };
}

function createErrorFromException(
  error: Error,
  timestamp: Date,
  context?: { action?: string; component?: string }
): AppError {
  // Network errors
  if (error.name === 'TypeError' && error.message.includes('fetch')) {
    return {
      type: ErrorType.NETWORK,
      severity: ErrorSeverity.ERROR,
      message: error.message,
      userMessage: ERROR_MESSAGES[ErrorType.NETWORK].message,
      recoverable: true,
      retryable: true,
      originalError: error,
      timestamp,
    };
  }

  // Timeout errors
  if (error.name === 'AbortError' || error.message.includes('timeout')) {
    return {
      type: ErrorType.TIMEOUT,
      severity: ErrorSeverity.WARNING,
      message: error.message,
      userMessage: ERROR_MESSAGES[ErrorType.TIMEOUT].message,
      recoverable: true,
      retryable: true,
      originalError: error,
      timestamp,
    };
  }

  // Default client error
  return {
    type: ErrorType.CLIENT,
    severity: ErrorSeverity.ERROR,
    message: error.message,
    userMessage: ERROR_MESSAGES[ErrorType.CLIENT].message,
    details: context,
    recoverable: true,
    retryable: false,
    originalError: error,
    timestamp,
  };
}

function createErrorFromAPIResponse(
  apiError: { message: string; code?: string; status?: number },
  timestamp: Date
): AppError {
  const type = apiError.status ? getErrorTypeFromStatus(apiError.status) : ErrorType.SERVER;
  const errorInfo = ERROR_MESSAGES[type];

  return {
    type,
    severity: ErrorSeverity.ERROR,
    message: apiError.message,
    userMessage: apiError.message || errorInfo.message,
    code: apiError.code,
    recoverable: true,
    retryable: type === ErrorType.SERVER || type === ErrorType.RATE_LIMIT,
    timestamp,
  };
}

function getErrorTypeFromStatus(status: number): ErrorType {
  switch (status) {
    case 400:
      return ErrorType.VALIDATION;
    case 401:
      return ErrorType.AUTHENTICATION;
    case 403:
      return ErrorType.AUTHORIZATION;
    case 404:
      return ErrorType.NOT_FOUND;
    case 408:
      return ErrorType.TIMEOUT;
    case 429:
      return ErrorType.RATE_LIMIT;
    default:
      return status >= 500 ? ErrorType.SERVER : ErrorType.CLIENT;
  }
}

/**
 * Error display options
 */
export interface ErrorDisplayOptions {
  showDetails?: boolean;
  duration?: number;
  action?: {
    label: string;
    onClick: () => void;
  };
}

/**
 * Format error for toast display
 */
export function formatErrorForToast(error: AppError, options?: ErrorDisplayOptions): {
  title: string;
  description: string;
  variant: 'default' | 'destructive';
  duration?: number;
  action?: { label: string; onClick: () => void };
} {
  const errorInfo = ERROR_MESSAGES[error.type];

  return {
    title: errorInfo.title,
    description: error.userMessage,
    variant: error.severity === ErrorSeverity.CRITICAL ? 'destructive' : 'default',
    duration: options?.duration ?? (error.severity === ErrorSeverity.CRITICAL ? 10000 : 5000),
    action: options?.action,
  };
}

/**
 * Log error for debugging/monitoring
 */
export function logError(error: AppError, context?: Record<string, unknown>): void {
  const logData = {
    ...error,
    context,
    originalError: error.originalError?.stack,
  };

  if (error.severity === ErrorSeverity.CRITICAL) {
    console.error('[CRITICAL ERROR]', logData);
  } else if (error.severity === ErrorSeverity.ERROR) {
    console.error('[ERROR]', logData);
  } else if (error.severity === ErrorSeverity.WARNING) {
    console.warn('[WARNING]', logData);
  } else {
    console.info('[INFO]', logData);
  }

  sendToErrorTracking(error, context);
}

function sendToErrorTracking(error: AppError, context?: Record<string, unknown>): void {
  const env = typeof import.meta !== "undefined" ? (import.meta as { env?: Record<string, any> }).env : undefined;
  const endpoint = (env?.VITE_ERROR_TRACKING_ENDPOINT as string | undefined) || (env?.PROD ? "/api/errors/log" : "");

  if (!endpoint || typeof window === "undefined" || typeof navigator === "undefined") {
    return;
  }

  const componentName = typeof (context as any)?.component === "string" ? String((context as any).component) : undefined;
  const componentStack = typeof (context as any)?.componentStack === "string" ? String((context as any).componentStack) : undefined;

  // Match server/routes/errorRouter.ts expected payload (unknown keys are ignored server-side)
  const payload = {
    errorId: String(error.code || error.type || "client_error"),
    message: String(error.message || ""),
    stack: error.originalError?.stack,
    componentStack,
    componentName,
    url: window.location.href,
    userAgent: navigator.userAgent,
    timestamp: new Date().toISOString(),
  } as const;

  void fetch(endpoint, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
    keepalive: true,
  }).catch(() => {});
}

/**
 * Handle error with standard flow
 */
export function handleError(
  error: unknown,
  onDisplay: (toast: ReturnType<typeof formatErrorForToast>) => void,
  options?: ErrorDisplayOptions & { context?: Record<string, unknown> }
): AppError {
  const appError = createAppError(error);
  logError(appError, options?.context);
  const toastData = formatErrorForToast(appError, options);
  onDisplay(toastData);
  return appError;
}

/**
 * Retry function with exponential backoff
 */
export async function withRetry<T>(
  fn: () => Promise<T>,
  options?: {
    maxRetries?: number;
    initialDelay?: number;
    maxDelay?: number;
    onRetry?: (attempt: number, error: AppError) => void;
  }
): Promise<T> {
  const maxRetries = options?.maxRetries ?? 3;
  const initialDelay = options?.initialDelay ?? 1000;
  const maxDelay = options?.maxDelay ?? 10000;

  let lastError: AppError | null = null;

  for (let attempt = 0; attempt < maxRetries; attempt++) {
    try {
      return await fn();
    } catch (error) {
      lastError = createAppError(error);

      if (!lastError.retryable || attempt === maxRetries - 1) {
        throw error;
      }

      options?.onRetry?.(attempt + 1, lastError);

      const delay = Math.min(initialDelay * Math.pow(2, attempt), maxDelay);
      await new Promise((resolve) => setTimeout(resolve, delay));
    }
  }

  throw lastError?.originalError || new Error('Max retries exceeded');
}

/**
 * Error boundary fallback props
 */
export interface ErrorFallbackProps {
  error: AppError;
  resetError: () => void;
}

/**
 * Create error fallback component props
 */
export function createErrorFallbackProps(
  error: Error,
  resetErrorBoundary: () => void
): ErrorFallbackProps {
  return {
    error: createAppError(error),
    resetError: resetErrorBoundary,
  };
}
