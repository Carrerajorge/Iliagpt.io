/**
 * PptEditor - Placeholder Component
 * TODO: Implement full PowerPoint presentation editor
 */
import { Presentation } from 'lucide-react';

interface PptEditorProps {
    slides?: { title: string; content: string }[];
    onChange?: (slides: { title: string; content: string }[]) => void;
}

export default function PptEditor({ slides, onChange }: PptEditorProps) {
    const defaultSlides = slides || [
        { title: 'Diapositiva 1', content: '' },
    ];

    return (
        <div className="w-full h-96 border rounded-lg bg-card overflow-hidden">
            <div className="flex items-center gap-2 p-3 border-b bg-muted/50">
                <Presentation className="w-4 h-4" />
                <span className="text-sm font-medium">Editor de Presentación</span>
            </div>
            <div className="flex h-80">
                <div className="w-48 border-r bg-muted/30 p-2 space-y-2 overflow-auto">
                    {defaultSlides.map((slide, idx) => (
                        <div key={idx} className="p-2 bg-card border rounded text-xs cursor-pointer hover:bg-muted">
                            {slide.title}
                        </div>
                    ))}
                </div>
                <div className="flex-1 p-4 flex items-center justify-center">
                    <div className="w-full max-w-md aspect-video bg-white border shadow-lg rounded flex items-center justify-center text-muted-foreground">
                        Vista previa de diapositiva
                    </div>
                </div>
            </div>
        </div>
    );
}
