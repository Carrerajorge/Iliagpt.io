/**
 * SearchModal - Placeholder Component
 * TODO: Implement full search modal functionality
 */
import { useState } from 'react';
import { Search, X } from 'lucide-react';

interface SearchModalProps {
    isOpen?: boolean;
    onClose?: () => void;
}

export default function SearchModal({ isOpen, onClose }: SearchModalProps) {
    const [query, setQuery] = useState('');

    if (!isOpen) return null;

    return (
        <div className="fixed inset-0 z-50 flex items-start justify-center pt-20 bg-background/80 backdrop-blur-sm">
            <div className="w-full max-w-2xl bg-card rounded-lg shadow-lg border">
                <div className="flex items-center gap-3 p-4 border-b">
                    <Search className="w-5 h-5 text-muted-foreground" />
                    <input
                        type="text"
                        value={query}
                        onChange={(e) => setQuery(e.target.value)}
                        placeholder="Buscar conversaciones, archivos, GPTs..."
                        className="flex-1 bg-transparent outline-none text-lg"
                        autoFocus
                    />
                    <button onClick={onClose} className="p-1 hover:bg-muted rounded">
                        <X className="w-5 h-5" />
                    </button>
                </div>
                <div className="p-4 text-center text-muted-foreground">
                    {query ? `Buscando "${query}"...` : 'Escribe para buscar'}
                </div>
            </div>
        </div>
    );
}
