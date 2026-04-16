import React from 'react';
import { BaseErrorBoundary } from './BaseErrorBoundary';
import { Box, RefreshCw, Monitor, Cpu } from 'lucide-react';

interface Props {
  children: React.ReactNode;
  onError?: (error: Error) => void;
}

function detectWebGLSupport(): { supported: boolean; version: number; renderer: string } {
  try {
    const canvas = document.createElement('canvas');
    const gl = canvas.getContext('webgl2') || canvas.getContext('webgl');
    
    if (!gl) {
      return { supported: false, version: 0, renderer: 'N/A' };
    }

    const debugInfo = gl.getExtension('WEBGL_debug_renderer_info');
    const renderer = debugInfo 
      ? gl.getParameter(debugInfo.UNMASKED_RENDERER_WEBGL) 
      : 'Unknown';
    const version = gl.getParameter(gl.VERSION).includes('2.0') ? 2 : 1;

    return { supported: true, version, renderer };
  } catch {
    return { supported: false, version: 0, renderer: 'N/A' };
  }
}

export function ThreeJSErrorBoundary({ children, onError }: Props) {
  return (
    <BaseErrorBoundary
      componentName="Visualización 3D"
      onError={(details) => onError?.(new Error(details.message))}
      fallback={(error, retry) => {
        const webgl = detectWebGLSupport();

        return (
          <div className="flex flex-col items-center justify-center h-full min-h-[300px] bg-gradient-to-b from-gray-900 to-gray-800 rounded-xl p-8">
            <div className="relative mb-6">
              <div className="w-20 h-20 rounded-2xl bg-purple-900/30 flex items-center justify-center">
                <Box className="w-10 h-10 text-purple-400" />
              </div>
              <div className="absolute -bottom-1 -right-1 w-6 h-6 rounded-full bg-red-500 flex items-center justify-center">
                <span className="text-white text-xs">!</span>
              </div>
            </div>

            <h3 className="text-xl font-semibold text-white mb-2">
              Error en visualización 3D
            </h3>
            
            <p className="text-gray-400 text-center max-w-md mb-6">
              {!webgl.supported 
                ? 'Tu navegador no soporta WebGL, necesario para visualizaciones 3D.'
                : error.message || 'No se pudo renderizar el contenido 3D.'}
            </p>

            <div className="flex gap-4 mb-6 text-sm">
              <div className="flex items-center gap-2 px-3 py-2 bg-gray-800 rounded-lg">
                <Monitor className="w-4 h-4 text-gray-400" />
                <span className="text-gray-300">
                  WebGL {webgl.supported ? `v${webgl.version}` : 'No soportado'}
                </span>
                {webgl.supported && (
                  <span className="w-2 h-2 rounded-full bg-green-400" />
                )}
                {!webgl.supported && (
                  <span className="w-2 h-2 rounded-full bg-red-400" />
                )}
              </div>
              
              {webgl.supported && (
                <div className="flex items-center gap-2 px-3 py-2 bg-gray-800 rounded-lg">
                  <Cpu className="w-4 h-4 text-gray-400" />
                  <span className="text-gray-300 truncate max-w-[200px]" title={webgl.renderer}>
                    {webgl.renderer}
                  </span>
                </div>
              )}
            </div>

            <div className="flex gap-3">
              {webgl.supported && (
                <button
                  onClick={retry}
                  className="flex items-center gap-2 px-4 py-2 bg-purple-600 hover:bg-purple-500 text-white rounded-lg transition-colors"
                  data-testid="button-retry-threejs"
                >
                  <RefreshCw className="w-4 h-4" />
                  Reintentar
                </button>
              )}
              
              {!webgl.supported && (
                <a
                  href="https://get.webgl.org/"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex items-center gap-2 px-4 py-2 bg-blue-600 hover:bg-blue-500 text-white rounded-lg transition-colors"
                  data-testid="link-webgl-info"
                >
                  Más información
                </a>
              )}
            </div>

            <p className="text-xs text-gray-500 mt-4">
              Error ID: {error.errorId}
            </p>
          </div>
        );
      }}
    >
      {children}
    </BaseErrorBoundary>
  );
}
