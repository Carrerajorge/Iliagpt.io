/**
 * CodeEditor - Placeholder Component
 * TODO: Integrate Monaco editor or CodeMirror
 */
import { Code } from 'lucide-react';

interface CodeEditorProps {
    code?: string;
    language?: string;
    onChange?: (code: string) => void;
}

export default function CodeEditor({ code, language = 'javascript', onChange }: CodeEditorProps) {
    return (
        <div className="w-full h-96 border rounded-lg bg-gray-900 text-white overflow-hidden">
            <div className="flex items-center gap-2 p-3 border-b border-gray-700 bg-gray-800">
                <Code className="w-4 h-4" />
                <span className="text-sm font-medium">Editor de Código</span>
                <span className="text-xs text-gray-400">({language})</span>
            </div>
            <div className="p-4 h-80 overflow-auto">
                <textarea
                    className="w-full h-full bg-transparent font-mono text-sm text-green-400 resize-none outline-none"
                    value={code || ''}
                    onChange={(e) => onChange?.(e.target.value)}
                    placeholder="// Escribe tu código aquí..."
                    spellCheck={false}
                />
            </div>
        </div>
    );
}
