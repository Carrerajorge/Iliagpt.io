/**
 * SettingsModal - Placeholder Component
 * TODO: Implement full settings modal functionality
 */
import { X, Settings } from 'lucide-react';

interface SettingsModalProps {
    isOpen?: boolean;
    onClose?: () => void;
}

export default function SettingsModal({ isOpen, onClose }: SettingsModalProps) {
    if (!isOpen) return null;

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-background/80 backdrop-blur-sm">
            <div className="w-full max-w-lg bg-card rounded-lg shadow-lg border">
                <div className="flex items-center justify-between p-4 border-b">
                    <div className="flex items-center gap-2">
                        <Settings className="w-5 h-5" />
                        <h2 className="text-lg font-semibold">Configuración</h2>
                    </div>
                    <button onClick={onClose} className="p-1 hover:bg-muted rounded">
                        <X className="w-5 h-5" />
                    </button>
                </div>
                <div className="p-6">
                    <p className="text-muted-foreground">Configuración en desarrollo...</p>
                </div>
            </div>
        </div>
    );
}
