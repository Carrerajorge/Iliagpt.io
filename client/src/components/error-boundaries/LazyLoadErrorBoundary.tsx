import React from 'react';
import { BaseErrorBoundary } from './BaseErrorBoundary';
import { Loader2, WifiOff, RefreshCw, AlertCircle } from 'lucide-react';

interface Props {
  children: React.ReactNode;
  componentName: string;
  fallbackComponent?: React.ReactNode;
  loadingComponent?: React.ReactNode;
  onLoadError?: (error: Error) => void;
}

function getLoadErrorType(error: Error): 'network' | 'chunk' | 'timeout' | 'unknown' {
  const message = error.message.toLowerCase();
  
  if (message.includes('loading chunk') || message.includes('loading css chunk')) {
    return 'chunk';
  }
  if (message.includes('network') || message.includes('fetch')) {
    return 'network';
  }
  if (message.includes('timeout')) {
    return 'timeout';
  }
  return 'unknown';
}

export function LazyLoadErrorBoundary({ 
  children, 
  componentName, 
  fallbackComponent,
  loadingComponent,
  onLoadError 
}: Props) {
  return (
    <BaseErrorBoundary
      componentName={componentName}
      onError={(errorDetails) => {
        if (onLoadError) {
          onLoadError(new Error(errorDetails.message));
        }
      }}
      fallback={(error, retry) => {
        const errorType = getLoadErrorType(new Error(error.message));
        
        if (fallbackComponent) {
          return fallbackComponent;
        }

        return (
          <div className="flex flex-col items-center justify-center p-8 bg-gray-800/50 border border-gray-700 rounded-xl">
            {errorType === 'network' ? (
              <>
                <WifiOff className="w-12 h-12 text-yellow-400 mb-4" />
                <h3 className="text-lg font-medium text-white mb-2">
                  Error de conexión
                </h3>
                <p className="text-gray-400 text-center mb-4 max-w-md">
                  No se pudo cargar el componente "{componentName}". 
                  Verifica tu conexión a internet.
                </p>
              </>
            ) : errorType === 'chunk' ? (
              <>
                <AlertCircle className="w-12 h-12 text-orange-400 mb-4" />
                <h3 className="text-lg font-medium text-white mb-2">
                  Nueva versión disponible
                </h3>
                <p className="text-gray-400 text-center mb-4 max-w-md">
                  La aplicación se ha actualizado. Recarga la página para obtener la última versión.
                </p>
              </>
            ) : (
              <>
                <AlertCircle className="w-12 h-12 text-red-400 mb-4" />
                <h3 className="text-lg font-medium text-white mb-2">
                  Error al cargar componente
                </h3>
                <p className="text-gray-400 text-center mb-4 max-w-md">
                  No se pudo cargar "{componentName}". 
                </p>
              </>
            )}

            <div className="flex gap-3">
              <button
                onClick={retry}
                className="flex items-center gap-2 px-4 py-2 bg-indigo-600 hover:bg-indigo-500 text-white rounded-lg transition-colors"
                data-testid="button-retry-lazy"
              >
                <RefreshCw className="w-4 h-4" />
                Reintentar
              </button>
              
              {errorType === 'chunk' && (
                <button
                  onClick={() => window.location.reload()}
                  className="flex items-center gap-2 px-4 py-2 bg-gray-700 hover:bg-gray-600 text-white rounded-lg transition-colors"
                  data-testid="button-reload-page"
                >
                  Recargar página
                </button>
              )}
            </div>
          </div>
        );
      }}
    >
      <React.Suspense fallback={loadingComponent || <DefaultLoadingFallback name={componentName} />}>
        {children}
      </React.Suspense>
    </BaseErrorBoundary>
  );
}

function DefaultLoadingFallback({ name }: { name: string }) {
  return (
    <div className="flex flex-col items-center justify-center p-8">
      <Loader2 className="w-8 h-8 text-indigo-400 animate-spin mb-3" />
      <p className="text-sm text-gray-400">Cargando {name}...</p>
    </div>
  );
}
