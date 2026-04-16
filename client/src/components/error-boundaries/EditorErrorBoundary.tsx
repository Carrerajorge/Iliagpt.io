import React from 'react';
import { BaseErrorBoundary } from './BaseErrorBoundary';
import { Code2, RefreshCw, FileCode, Terminal, Presentation, Table } from 'lucide-react';

interface Props {
  children: React.ReactNode;
  editorType: 'monaco' | 'codemirror' | 'ppt' | 'spreadsheet' | 'document';
  onError?: (error: Error) => void;
  fallbackContent?: string;
}

const editorIcons = {
  monaco: Code2,
  codemirror: Terminal,
  ppt: Presentation,
  spreadsheet: Table,
  document: FileCode
};

const editorNames = {
  monaco: 'Editor de código',
  codemirror: 'Editor de código',
  ppt: 'Editor de presentaciones',
  spreadsheet: 'Hoja de cálculo',
  document: 'Editor de documentos'
};

export function EditorErrorBoundary({ 
  children, 
  editorType, 
  onError,
  fallbackContent 
}: Props) {
  const Icon = editorIcons[editorType] || Code2;
  const name = editorNames[editorType] || 'Editor';

  return (
    <BaseErrorBoundary
      componentName={name}
      onError={(details) => onError?.(new Error(details.message))}
      fallback={(error, retry) => (
        <div className="flex flex-col h-full bg-gray-900 border border-gray-700 rounded-lg overflow-hidden">
          <div className="flex items-center justify-between px-4 py-3 bg-gray-800 border-b border-gray-700">
            <div className="flex items-center gap-2">
              <Icon className="w-5 h-5 text-red-400" />
              <span className="font-medium text-gray-300">{name}</span>
              <span className="px-2 py-0.5 bg-red-900/50 text-red-300 text-xs rounded">Error</span>
            </div>
            <button
              onClick={retry}
              className="flex items-center gap-2 px-3 py-1.5 bg-gray-700 hover:bg-gray-600 text-sm text-white rounded transition-colors"
              data-testid="button-retry-editor"
            >
              <RefreshCw className="w-4 h-4" />
              Reintentar
            </button>
          </div>

          <div className="flex-1 flex flex-col items-center justify-center p-8">
            <div className="w-16 h-16 rounded-full bg-red-900/30 flex items-center justify-center mb-4">
              <Icon className="w-8 h-8 text-red-400" />
            </div>
            <h3 className="text-lg font-medium text-white mb-2">
              Error al cargar el editor
            </h3>
            <p className="text-gray-400 text-center max-w-md mb-6">
              {error.message || 'Ha ocurrido un error al inicializar el editor. Intenta recargar.'}
            </p>
            
            {fallbackContent && (
              <div className="w-full max-w-2xl">
                <p className="text-sm text-gray-500 mb-2">
                  Vista de respaldo (solo lectura):
                </p>
                <textarea
                  readOnly
                  value={fallbackContent}
                  className="w-full h-48 bg-gray-800 border border-gray-700 rounded-lg p-4 font-mono text-sm text-gray-300 resize-none"
                  data-testid="textarea-fallback-content"
                />
              </div>
            )}
          </div>

          <div className="px-4 py-2 bg-gray-800 border-t border-gray-700 text-xs text-gray-500">
            Error ID: {error.errorId}
          </div>
        </div>
      )}
    >
      {children}
    </BaseErrorBoundary>
  );
}
