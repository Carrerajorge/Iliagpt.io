/** Modal catalog shell; extend with live tool metadata when the agent registry is exposed to the client. */
import { Wrench, X } from 'lucide-react';
import { useCallback, useEffect } from 'react';

interface ToolCatalogProps {
    isOpen?: boolean;
    onClose?: () => void;
}

export default function ToolCatalog({ isOpen, onClose }: ToolCatalogProps) {
    const closeCatalog = useCallback(() => {
        if (onClose) onClose();
    }, [onClose]);

    useEffect(() => {
        if (!isOpen) return;

        const handleKeyDown = (event: KeyboardEvent) => {
            if (event.key === 'Escape') {
                closeCatalog();
            }
        };

        window.addEventListener('keydown', handleKeyDown);
        return () => window.removeEventListener('keydown', handleKeyDown);
    }, [isOpen, closeCatalog]);

    if (!isOpen) return null;

    return (
        <div
            onMouseDown={closeCatalog}
            className="fixed inset-0 z-50 flex items-center justify-center bg-background/80 backdrop-blur-sm"
            role="dialog"
            aria-modal="true"
            aria-labelledby="tool-catalog-title"
        >
            <div
                onMouseDown={(event) => event.stopPropagation()}
                className="w-full max-w-4xl max-h-[90vh] bg-card rounded-lg shadow-lg border overflow-hidden"
            >
                <div className="flex items-center justify-between p-4 border-b">
                    <div className="flex items-center gap-2">
                        <Wrench className="w-5 h-5" />
                        <h2 id="tool-catalog-title" className="text-lg font-semibold">
                            Catálogo de Herramientas
                        </h2>
                    </div>
                    <button
                        type="button"
                        onClick={closeCatalog}
                        className="p-1 hover:bg-muted rounded"
                        aria-label="Cerrar catálogo"
                    >
                        <X className="w-5 h-5" />
                    </button>
                </div>
                <div className="p-6 text-center text-muted-foreground">
                    <Wrench className="w-16 h-16 mx-auto mb-4 opacity-50" />
                    <p>Catálogo de herramientas en desarrollo...</p>
                </div>
            </div>
        </div>
    );
}
