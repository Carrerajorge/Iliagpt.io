import React, { useState, useRef, useEffect } from 'react';
import { Sparkles, Send, Loader2, Table, BarChart3, Calculator, Wand2, CheckCircle2 } from 'lucide-react';

interface AICommandBarProps {
  onExecute: (command: string) => Promise<void>;
  isProcessing: boolean;
  selectedRange?: { startRow: number; startCol: number; endRow: number; endCol: number } | null;
}

const suggestions = [
  { icon: Table, text: 'Llena con nombres de ciudades', type: 'fill' },
  { icon: Calculator, text: 'Calcula el total de esta columna', type: 'formula' },
  { icon: BarChart3, text: 'Genera datos de ventas mensuales', type: 'generate' },
  { icon: Wand2, text: 'Formatea como tabla', type: 'format' },
  { icon: CheckCircle2, text: 'Completa los datos faltantes', type: 'complete' }
];

function getColumnLetter(col: number): string {
  let letter = '';
  let num = col;
  while (num >= 0) {
    letter = String.fromCharCode(65 + (num % 26)) + letter;
    num = Math.floor(num / 26) - 1;
  }
  return letter;
}

function formatRange(range: { startRow: number; startCol: number; endRow: number; endCol: number } | null): string {
  if (!range) return '';
  const startCell = `${getColumnLetter(range.startCol)}${range.startRow + 1}`;
  const endCell = `${getColumnLetter(range.endCol)}${range.endRow + 1}`;
  return startCell === endCell ? startCell : `${startCell}:${endCell}`;
}

export function AICommandBar({ onExecute, isProcessing, selectedRange }: AICommandBarProps) {
  const [command, setCommand] = useState('');
  const [showSuggestions, setShowSuggestions] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setShowSuggestions(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!command.trim() || isProcessing) return;
    
    await onExecute(command);
    setCommand('');
    setShowSuggestions(false);
  };

  const handleSuggestionClick = async (suggestion: typeof suggestions[0]) => {
    setCommand(suggestion.text);
    setShowSuggestions(false);
    await onExecute(suggestion.text);
    setCommand('');
  };

  return (
    <div ref={containerRef} className="relative px-3 py-2 bg-gray-800/50 border-b border-gray-700">
      <form onSubmit={handleSubmit} className="flex items-center gap-2">
        <div className="flex items-center gap-2 px-3 py-2 bg-gray-700/50 rounded-lg flex-1 border border-gray-600 focus-within:border-indigo-500 transition-colors">
          <Sparkles className="w-4 h-4 text-indigo-400 flex-shrink-0" />
          <input
            ref={inputRef}
            type="text"
            value={command}
            onChange={(e) => setCommand(e.target.value)}
            onFocus={() => setShowSuggestions(true)}
            placeholder="Escribe un comando de IA para la hoja de cálculo..."
            className="flex-1 bg-transparent text-sm text-white placeholder-gray-400 focus:outline-none"
            disabled={isProcessing}
            data-testid="input-ai-command"
          />
          {selectedRange && (
            <span className="text-xs text-gray-400 bg-gray-600 px-2 py-0.5 rounded" data-testid="text-selected-range">
              {formatRange(selectedRange)}
            </span>
          )}
        </div>
        <button
          type="submit"
          disabled={isProcessing || !command.trim()}
          className="flex items-center gap-2 px-4 py-2 bg-indigo-600 hover:bg-indigo-500 disabled:bg-gray-600 disabled:cursor-not-allowed rounded-lg text-white text-sm font-medium transition-colors"
          data-testid="button-send-ai-command"
        >
          {isProcessing ? (
            <>
              <Loader2 className="w-4 h-4 animate-spin" />
              <span>Procesando...</span>
            </>
          ) : (
            <>
              <Send className="w-4 h-4" />
              <span>Enviar</span>
            </>
          )}
        </button>
      </form>
      
      {showSuggestions && !isProcessing && (
        <div className="absolute top-full left-3 right-3 mt-1 bg-gray-800 border border-gray-600 rounded-lg shadow-xl z-50 overflow-hidden" data-testid="dropdown-ai-suggestions">
          <div className="p-2 border-b border-gray-700">
            <span className="text-xs text-gray-400 font-medium">Sugerencias</span>
          </div>
          <div className="max-h-64 overflow-y-auto">
            {suggestions.map((suggestion, index) => (
              <button
                key={index}
                onClick={() => handleSuggestionClick(suggestion)}
                className="w-full flex items-center gap-3 px-3 py-2.5 hover:bg-gray-700/50 transition-colors text-left"
                data-testid={`button-suggestion-${index}`}
              >
                <suggestion.icon className="w-4 h-4 text-indigo-400 flex-shrink-0" />
                <span className="text-sm text-gray-200">{suggestion.text}</span>
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
