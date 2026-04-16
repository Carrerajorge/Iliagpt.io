import React from 'react';
import { useDeckStore, selectActiveSlide, selectSelectedElement } from '../store/deckStore';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Slider } from '@/components/ui/slider';
import { Separator } from '@/components/ui/separator';
import { 
  Bold, 
  Italic, 
  Underline
} from 'lucide-react';
import type { TextElement, ShapeElement } from '../store/types';

const FONT_FAMILIES = [
  { label: 'Inter', value: 'Inter' },
  { label: 'Arial', value: 'Arial' },
  { label: 'Georgia', value: 'Georgia' },
  { label: 'Times New Roman', value: 'Times New Roman' },
  { label: 'Verdana', value: 'Verdana' },
  { label: 'Courier New', value: 'Courier New' },
];

const FONT_SIZES = [12, 14, 16, 18, 20, 24, 28, 32, 36, 44, 56, 72];

export function PropertiesPanel() {
  const element = useDeckStore(selectSelectedElement);
  const slide = useDeckStore(selectActiveSlide);
  const updateElement = useDeckStore((s) => s.updateElement);
  const applyTextStyleToDefault = useDeckStore((s) => s.applyTextStyleToDefault);
  const setSlideBackground = useDeckStore((s) => s.setSlideBackground);

  if (!element) {
    return (
      <div className="h-full flex flex-col">
        <div className="p-3 border-b">
          <h3 className="font-semibold text-sm">Propiedades</h3>
        </div>
        <div className="flex-1 p-4">
          <div className="text-sm text-muted-foreground text-center py-8">
            Selecciona un elemento para ver sus propiedades
          </div>
          
          <Separator className="my-4" />
          
          <div className="space-y-3">
            <Label className="text-xs font-medium">Fondo de diapositiva</Label>
            <div className="flex items-center gap-2">
              <Input
                type="color"
                value={slide.background.color}
                onChange={(e) => setSlideBackground(slide.id, e.target.value)}
                className="w-12 h-8 p-1"
                data-testid="input-slide-bg"
              />
              <Input
                value={slide.background.color}
                onChange={(e) => setSlideBackground(slide.id, e.target.value)}
                className="flex-1 h-8 text-sm"
              />
            </div>
          </div>
        </div>
      </div>
    );
  }

  const handleUpdatePosition = (key: 'x' | 'y' | 'w' | 'h', value: number) => {
    updateElement(element.id, { [key]: value });
  };

  const handleUpdateOpacity = (value: number) => {
    updateElement(element.id, { opacity: value / 100 });
  };

  const handleUpdateRotation = (value: number) => {
    updateElement(element.id, { rotation: value });
  };

  return (
    <div className="h-full flex flex-col">
      <div className="p-3 border-b">
        <h3 className="font-semibold text-sm">Propiedades</h3>
      </div>
      
      <ScrollArea className="flex-1">
        <div className="p-3 space-y-4">
          <div className="space-y-3">
            <Label className="text-xs font-medium uppercase text-muted-foreground">Posición</Label>
            <div className="grid grid-cols-2 gap-2">
              <div>
                <Label className="text-xs">X</Label>
                <Input
                  type="number"
                  value={Math.round(element.x)}
                  onChange={(e) => handleUpdatePosition('x', Number(e.target.value))}
                  className="h-8 text-sm"
                  data-testid="input-pos-x"
                />
              </div>
              <div>
                <Label className="text-xs">Y</Label>
                <Input
                  type="number"
                  value={Math.round(element.y)}
                  onChange={(e) => handleUpdatePosition('y', Number(e.target.value))}
                  className="h-8 text-sm"
                  data-testid="input-pos-y"
                />
              </div>
            </div>
          </div>

          <div className="space-y-3">
            <Label className="text-xs font-medium uppercase text-muted-foreground">Tamaño</Label>
            <div className="grid grid-cols-2 gap-2">
              <div>
                <Label className="text-xs">Ancho</Label>
                <Input
                  type="number"
                  value={Math.round(element.w)}
                  onChange={(e) => handleUpdatePosition('w', Number(e.target.value))}
                  className="h-8 text-sm"
                  data-testid="input-size-w"
                />
              </div>
              <div>
                <Label className="text-xs">Alto</Label>
                <Input
                  type="number"
                  value={Math.round(element.h)}
                  onChange={(e) => handleUpdatePosition('h', Number(e.target.value))}
                  className="h-8 text-sm"
                  data-testid="input-size-h"
                />
              </div>
            </div>
          </div>

          <div className="space-y-3">
            <Label className="text-xs font-medium uppercase text-muted-foreground">Apariencia</Label>
            <div>
              <Label className="text-xs">Rotación</Label>
              <div className="flex items-center gap-2">
                <Slider
                  value={[element.rotation ?? 0]}
                  onValueChange={([v]) => handleUpdateRotation(v)}
                  min={0}
                  max={360}
                  step={1}
                  className="flex-1"
                />
                <span className="text-xs w-10 text-right">{element.rotation ?? 0}°</span>
              </div>
            </div>
            <div>
              <Label className="text-xs">Opacidad</Label>
              <div className="flex items-center gap-2">
                <Slider
                  value={[(element.opacity ?? 1) * 100]}
                  onValueChange={([v]) => handleUpdateOpacity(v)}
                  min={0}
                  max={100}
                  step={1}
                  className="flex-1"
                />
                <span className="text-xs w-10 text-right">{Math.round((element.opacity ?? 1) * 100)}%</span>
              </div>
            </div>
          </div>

          <Separator />

          {element.type === 'text' && (
            <TextProperties
              element={element}
              onUpdateStyle={(patch) => applyTextStyleToDefault(element.id, patch)}
            />
          )}

          {element.type === 'shape' && (
            <ShapeProperties
              element={element}
              onUpdate={(patch) => updateElement(element.id, patch)}
            />
          )}
        </div>
      </ScrollArea>
    </div>
  );
}

function TextProperties({ 
  element, 
  onUpdateStyle 
}: { 
  element: TextElement; 
  onUpdateStyle: (patch: Partial<TextElement['defaultTextStyle']>) => void;
}) {
  const style = element.defaultTextStyle;

  return (
    <div className="space-y-4">
      <Label className="text-xs font-medium uppercase text-muted-foreground">Texto</Label>
      
      <div className="space-y-2">
        <Label className="text-xs">Fuente</Label>
        <Select
          value={style.fontFamily}
          onValueChange={(v) => onUpdateStyle({ fontFamily: v })}
        >
          <SelectTrigger className="h-8 text-sm" data-testid="select-font-family">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {FONT_FAMILIES.map((font) => (
              <SelectItem key={font.value} value={font.value}>
                {font.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <div className="grid grid-cols-2 gap-2">
        <div>
          <Label className="text-xs">Tamaño</Label>
          <Select
            value={String(style.fontSize)}
            onValueChange={(v) => onUpdateStyle({ fontSize: Number(v) })}
          >
            <SelectTrigger className="h-8 text-sm" data-testid="select-font-size">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {FONT_SIZES.map((size) => (
                <SelectItem key={size} value={String(size)}>
                  {size}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div>
          <Label className="text-xs">Color</Label>
          <div className="flex gap-1">
            <Input
              type="color"
              value={style.color}
              onChange={(e) => onUpdateStyle({ color: e.target.value })}
              className="w-12 h-8 p-1"
              data-testid="input-text-color"
            />
          </div>
        </div>
      </div>

      <div className="flex gap-1">
        <Button
          variant={style.bold ? "default" : "outline"}
          size="icon"
          className="h-8 w-8"
          onClick={() => onUpdateStyle({ bold: !style.bold })}
          data-testid="btn-text-bold"
        >
          <Bold className="h-4 w-4" />
        </Button>
        <Button
          variant={style.italic ? "default" : "outline"}
          size="icon"
          className="h-8 w-8"
          onClick={() => onUpdateStyle({ italic: !style.italic })}
          data-testid="btn-text-italic"
        >
          <Italic className="h-4 w-4" />
        </Button>
        <Button
          variant={style.underline ? "default" : "outline"}
          size="icon"
          className="h-8 w-8"
          onClick={() => onUpdateStyle({ underline: !style.underline })}
          data-testid="btn-text-underline"
        >
          <Underline className="h-4 w-4" />
        </Button>
      </div>
    </div>
  );
}

function ShapeProperties({ 
  element, 
  onUpdate 
}: { 
  element: ShapeElement; 
  onUpdate: (patch: Partial<ShapeElement>) => void;
}) {
  return (
    <div className="space-y-4">
      <Label className="text-xs font-medium uppercase text-muted-foreground">Forma</Label>
      
      <div className="grid grid-cols-2 gap-2">
        <div>
          <Label className="text-xs">Relleno</Label>
          <div className="flex gap-1">
            <Input
              type="color"
              value={element.fill}
              onChange={(e) => onUpdate({ fill: e.target.value })}
              className="w-full h-8 p-1"
              data-testid="input-shape-fill"
            />
          </div>
        </div>
        <div>
          <Label className="text-xs">Borde</Label>
          <div className="flex gap-1">
            <Input
              type="color"
              value={element.stroke}
              onChange={(e) => onUpdate({ stroke: e.target.value })}
              className="w-full h-8 p-1"
              data-testid="input-shape-stroke"
            />
          </div>
        </div>
      </div>

      <div>
        <Label className="text-xs">Grosor de borde</Label>
        <div className="flex items-center gap-2">
          <Slider
            value={[element.strokeWidth]}
            onValueChange={([v]) => onUpdate({ strokeWidth: v })}
            min={0}
            max={20}
            step={1}
            className="flex-1"
          />
          <span className="text-xs w-8 text-right">{element.strokeWidth}px</span>
        </div>
      </div>

      {element.shapeType === 'rect' && (
        <div>
          <Label className="text-xs">Radio de esquinas</Label>
          <div className="flex items-center gap-2">
            <Slider
              value={[element.radius ?? 0]}
              onValueChange={([v]) => onUpdate({ radius: v })}
              min={0}
              max={50}
              step={1}
              className="flex-1"
            />
            <span className="text-xs w-8 text-right">{element.radius ?? 0}px</span>
          </div>
        </div>
      )}
    </div>
  );
}
