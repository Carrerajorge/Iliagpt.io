/**
 * ErrorRecoveryBanner.tsx - Banner de recuperación de errores del chat
 *
 * Aparece cuando ocurre un error en el chat con:
 *  - Mensaje en español claro
 *  - Botón "Reintentar"
 *  - Botón "Copiar mensaje" para debug
 *  - Auto-dismiss tras recuperación
 *  - Animaciones suaves
 */

import React, { useState, useCallback, useEffect } from 'react';
import type { ClassifiedError } from '../../lib/chatResilience';

interface ErrorRecoveryBannerProps {
  error: ClassifiedError | string | null | undefined;
  isRecovering?: boolean;
  onRetry?: () => void;
  onDismiss?: () => void;
}

export function ErrorRecoveryBanner({
  error,
  isRecovering = false,
  onRetry,
  onDismiss,
}: ErrorRecoveryBannerProps) {
  const [visible, setVisible] = useState(false);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (error) {
      // Pequeño delay para animación
      requestAnimationFrame(() => setVisible(true));
    } else {
      setVisible(false);
    }
  }, [error]);

  if (!error) return null;

  const message = typeof error === 'string' ? error : error.userMessage;
  const category = typeof error === 'string' ? 'unknown' : error.category;

  const handleCopy = useCallback(() => {
    const text = typeof error === 'string' ? error : JSON.stringify({
      message: error.userMessage,
      category: error.category,
      recoverable: error.recoverable,
      original: error.original.message,
      timestamp: new Date().toISOString(),
    }, null, 2);

    navigator.clipboard.writeText(text).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2_000);
    }).catch(() => {
      // Fallback si clipboard API no funciona
      console.log('[ErrorBanner] Texto copiado:', text);
    });
  }, [error]);

  const handleDismiss = useCallback(() => {
    setVisible(false);
    setTimeout(() => onDismiss?.(), 300); // Esperar a que termine la animación
  }, [onDismiss]);

  // Icono según categoría
  const iconByCategory: Record<string, string> = {
    network: '📡',
    server: '⚠️',
    timeout: '⏱️',
    rate_limit: '🚦',
    unknown: '❌',
  };

  const bgColorByCategory: Record<string, string> = {
    network: 'bg-amber-50 border-amber-300 dark:bg-amber/10 dark:border-amber/40',
    server: 'bg-red-50 border-red-300 dark:bg-red/10 dark:border-red/40',
    timeout: 'bg-orange-50 border-orange-300 dark:bg-orange/10 dark:border-orange/40',
    rate_limit: 'bg-yellow-50 border-yellow-300 dark:bg-yellow/10 dark:border-yellow/40',
    unknown: 'bg-red-50 border-red-300 dark:bg-red/10 dark:border-red/40',
  };

  const textColorByCategory: Record<string, string> = {
    network: 'text-amber-800 dark:text-amber-200',
    server: 'text-red-800 dark:text-red-200',
    timeout: 'text-orange-800 dark:text-orange-200',
    rate_limit: 'text-yellow-800 dark:text-yellow-200',
    unknown: 'text-red-800 dark:text-red-200',
  };

  return (
    <div
      role="alert"
      aria-live="polite"
      className={`
        overflow-hidden transition-all duration-300 ease-in-out origin-top
        ${visible ? 'max-h-40 opacity-100 translate-y-0' : 'max-h-0 opacity-0 -translate-y-2'}
        ${bgColorByCategory[category] || bgColorByCategory.unknown}
        border rounded-lg px-4 py-3 mb-3
      `}
    >
      <div className="flex items-start gap-3">
        {/* Icono */}
        <span className="text-lg flex-shrink-0 mt-0.5" aria-hidden="true">
          {iconByCategory[category] || iconByCategory.unknown}
        </span>

        {/* Mensaje + acciones */}
        <div className="flex-1 min-w-0">
          <p className={`text-sm font-medium ${textColorByCategory[category] || textColorByCategory.unknown}`}>
            {isRecovering && (
              <span className="inline-flex items-center gap-1.5 mr-2">
                <span className="animate-spin inline-block w-3.5 h-3.5 border-2 border-current border-t-transparent rounded-full" />
                Recuperando...
              </span>
            )}
            {message}
          </p>

          <div className="flex items-center gap-2 mt-2">
            {onRetry && (
              <button
                onClick={() => onRetry()}
                disabled={isRecovering}
                className={`
                  inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-md
                  transition-all duration-150
                  ${isRecovering
                    ? 'opacity-50 cursor-not-allowed bg-gray-100 text-gray-400'
                    : `hover:shadow-sm active:scale-[0.97]
                       ${category === 'network' || category === 'timeout'
                         ? 'bg-amber-600 hover:bg-amber-700 text-white'
                         : 'bg-gray-800 hover:bg-gray-900 text-white dark:bg-white dark:text-black'}`
                  }
                `}
              >
                {isRecovering ? (
                  <>
                    <span className="animate-spin inline-block w-3 h-3 border-2 border-current border-t-transparent rounded-full" />
                    Reintento...
                  </>
                ) : (
                  <>🔄 Reintentar</>
                )}
              </button>
            )}

            <button
              onClick={handleCopy}
              className="
                inline-flex items-center gap-1 px-2.5 py-1.5 text-xs font-medium rounded-md
                bg-transparent hover:bg-black/5 dark:hover:bg-white/10
                text-gray-500 dark:text-gray-400 transition-colors
              "
              title="Copiar detalles del error"
            >
              {copied ? '✅ Copiado' : '📋 Copiar'}
            </button>

            {onDismiss && (
              <button
                onClick={handleDismiss}
                className="
                  ml-auto p-1 rounded hover:bg-black/5 dark:hover:bg-white/10
                  text-gray-400 hover:text-gray-600 dark:hover:text-gray-200 transition-colors
                "
                title="Cerrar"
              >
                ✕
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

export default ErrorRecoveryBanner;
