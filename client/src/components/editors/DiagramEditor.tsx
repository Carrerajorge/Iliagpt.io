/**
 * DiagramEditor - Placeholder Component
 * Redirects to the full DiagramGenerator
 */
import { GitBranch } from 'lucide-react';

interface DiagramEditorProps {
    diagram?: string;
    onChange?: (diagram: string) => void;
}

export default function DiagramEditor({ diagram, onChange }: DiagramEditorProps) {
    return (
        <div className="w-full h-96 border rounded-lg bg-card overflow-hidden">
            <div className="flex items-center gap-2 p-3 border-b bg-muted/50">
                <GitBranch className="w-4 h-4" />
                <span className="text-sm font-medium">Editor de Diagramas</span>
            </div>
            <div className="p-4 h-80">
                <textarea
                    className="w-full h-full bg-muted/30 rounded font-mono text-sm p-3 resize-none outline-none"
                    value={diagram || ''}
                    onChange={(e) => onChange?.(e.target.value)}
                    placeholder="graph TD
    A[Start] --> B{Decision}
    B -->|Yes| C[Process]
    B -->|No| D[End]"
                    spellCheck={false}
                />
            </div>
        </div>
    );
}
