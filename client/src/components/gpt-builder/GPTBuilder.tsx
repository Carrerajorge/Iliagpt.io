/**
 * GPTBuilder - Placeholder Component
 * TODO: Full implementation exists in gpt-builder.tsx, this is for lazy loading
 */
import { Bot, X } from 'lucide-react';

interface GPTBuilderProps {
    isOpen?: boolean;
    onClose?: () => void;
}

export default function GPTBuilder({ isOpen, onClose }: GPTBuilderProps) {
    if (!isOpen) return null;

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-background/80 backdrop-blur-sm">
            <div className="w-full max-w-4xl max-h-[90vh] bg-card rounded-lg shadow-lg border overflow-hidden">
                <div className="flex items-center justify-between p-4 border-b">
                    <div className="flex items-center gap-2">
                        <Bot className="w-5 h-5" />
                        <h2 className="text-lg font-semibold">Constructor de GPT</h2>
                    </div>
                    <button onClick={onClose} className="p-1 hover:bg-muted rounded">
                        <X className="w-5 h-5" />
                    </button>
                </div>
                <div className="p-6 text-center text-muted-foreground">
                    <Bot className="w-16 h-16 mx-auto mb-4 opacity-50" />
                    <p>Constructor de GPT en desarrollo...</p>
                </div>
            </div>
        </div>
    );
}
