import React from 'react';
import { Loader2, X } from 'lucide-react';

interface StreamingIndicatorProps {
  isStreaming: boolean;
  cell: { row: number; col: number } | null;
  onCancel: () => void;
}

function getColumnLetter(col: number): string {
  let letter = '';
  let num = col;
  while (num >= 0) {
    letter = String.fromCharCode(65 + (num % 26)) + letter;
    num = Math.floor(num / 26) - 1;
  }
  return letter;
}

export function StreamingIndicator({ isStreaming, cell, onCancel }: StreamingIndicatorProps) {
  if (!isStreaming) return null;
  
  const cellRef = cell ? `${getColumnLetter(cell.col)}${cell.row + 1}` : '...';
  
  return (
    <div 
      className="fixed bottom-6 right-6 flex items-center gap-3 px-4 py-3 bg-indigo-600 text-white rounded-xl shadow-2xl animate-pulse z-50"
      data-testid="streaming-indicator"
    >
      <div className="flex items-center gap-2">
        <Loader2 className="w-4 h-4 animate-spin" />
        <span className="text-sm font-medium">
          Escribiendo en {cellRef}...
        </span>
      </div>
      <button 
        onClick={onCancel}
        className="flex items-center gap-1 px-2 py-1 bg-red-500 hover:bg-red-400 rounded-lg text-xs font-medium transition-colors"
        data-testid="button-cancel-streaming"
      >
        <X className="w-3 h-3" />
        Cancelar
      </button>
    </div>
  );
}
