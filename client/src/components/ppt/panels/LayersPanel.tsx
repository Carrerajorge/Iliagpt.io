import React from 'react';
import { useDeckStore, selectActiveSlide } from '../store/deckStore';
import { Button } from '@/components/ui/button';
import { ScrollArea } from '@/components/ui/scroll-area';
import { 
  Type, 
  Square, 
  Circle, 
  Image, 
  BarChart3,
  ChevronUp,
  ChevronDown,
  ArrowUpToLine,
  ArrowDownToLine,
  Trash2,
  Lock
} from 'lucide-react';
import { cn } from '@/lib/utils';
import type { ElementAny } from '../store/types';

function getElementIcon(element: ElementAny) {
  switch (element.type) {
    case 'text':
      return <Type className="h-4 w-4" />;
    case 'shape':
      return element.shapeType === 'ellipse' 
        ? <Circle className="h-4 w-4" />
        : <Square className="h-4 w-4" />;
    case 'image':
      return <Image className="h-4 w-4" />;
    case 'chart':
      return <BarChart3 className="h-4 w-4" />;
    default:
      return <Square className="h-4 w-4" />;
  }
}

function getElementName(element: ElementAny): string {
  switch (element.type) {
    case 'text':
      const text = element.delta.ops.map(op => op.insert).join('').trim();
      return text.slice(0, 20) || 'Texto';
    case 'shape':
      return element.shapeType === 'ellipse' ? 'Elipse' : 'Rectángulo';
    case 'image':
      return 'Imagen';
    case 'chart':
      return 'Gráfico';
    default:
      return 'Elemento';
  }
}

export function LayersPanel() {
  const slide = useDeckStore(selectActiveSlide);
  const selection = useDeckStore((s) => s.selection);
  const activeSlideId = useDeckStore((s) => s.activeSlideId);
  const select = useDeckStore((s) => s.select);
  const bringToFront = useDeckStore((s) => s.bringToFront);
  const sendToBack = useDeckStore((s) => s.sendToBack);
  const bringForward = useDeckStore((s) => s.bringForward);
  const sendBackward = useDeckStore((s) => s.sendBackward);
  const deleteElement = useDeckStore((s) => s.deleteElement);

  const sortedElements = [...slide.elements].sort((a, b) => (b.zIndex ?? 0) - (a.zIndex ?? 0));

  const handleSelect = (elementId: string) => {
    select({ slideId: activeSlideId, elementId });
  };

  return (
    <div className="h-full flex flex-col">
      <div className="p-3 border-b">
        <h3 className="font-semibold text-sm">Capas</h3>
      </div>
      
      <ScrollArea className="flex-1">
        <div className="p-2 space-y-1">
          {sortedElements.length === 0 ? (
            <p className="text-sm text-muted-foreground text-center py-4">
              No hay elementos
            </p>
          ) : (
            sortedElements.map((element) => {
              const isSelected = selection?.elementId === element.id;
              
              return (
                <div
                  key={element.id}
                  className={cn(
                    "flex items-center gap-2 p-2 rounded-lg cursor-pointer transition-colors",
                    "hover:bg-muted/50",
                    isSelected && "bg-primary/10 border border-primary/30"
                  )}
                  onClick={() => handleSelect(element.id)}
                  data-testid={`layer-item-${element.id}`}
                >
                  <span className="text-muted-foreground">
                    {getElementIcon(element)}
                  </span>
                  <span className="flex-1 text-sm truncate">
                    {getElementName(element)}
                  </span>
                  
                  {element.locked && (
                    <Lock className="h-3 w-3 text-muted-foreground" />
                  )}
                </div>
              );
            })
          )}
        </div>
      </ScrollArea>

      {selection && (
        <div className="p-2 border-t space-y-2">
          <div className="grid grid-cols-4 gap-1">
            <Button
              variant="outline"
              size="icon"
              className="h-8 w-8"
              onClick={() => bringToFront(selection.elementId)}
              title="Traer al frente"
              data-testid="btn-bring-to-front"
            >
              <ArrowUpToLine className="h-4 w-4" />
            </Button>
            <Button
              variant="outline"
              size="icon"
              className="h-8 w-8"
              onClick={() => bringForward(selection.elementId)}
              title="Adelantar"
              data-testid="btn-bring-forward"
            >
              <ChevronUp className="h-4 w-4" />
            </Button>
            <Button
              variant="outline"
              size="icon"
              className="h-8 w-8"
              onClick={() => sendBackward(selection.elementId)}
              title="Atrasar"
              data-testid="btn-send-backward"
            >
              <ChevronDown className="h-4 w-4" />
            </Button>
            <Button
              variant="outline"
              size="icon"
              className="h-8 w-8"
              onClick={() => sendToBack(selection.elementId)}
              title="Enviar al fondo"
              data-testid="btn-send-to-back"
            >
              <ArrowDownToLine className="h-4 w-4" />
            </Button>
          </div>
          
          <Button
            variant="destructive"
            size="sm"
            className="w-full"
            onClick={() => deleteElement(selection.elementId)}
            data-testid="btn-delete-element"
          >
            <Trash2 className="h-4 w-4 mr-2" />
            Eliminar
          </Button>
        </div>
      )}
    </div>
  );
}
