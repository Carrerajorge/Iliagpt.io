import React from 'react';
import { useDeckStore, selectSelectedElement, RibbonTab } from '../store/deckStore';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Input } from '@/components/ui/input';
import { 
  Type, 
  Square, 
  Circle, 
  Image,
  Bold,
  Italic,
  Underline,
  Strikethrough,
  Sparkles,
  ClipboardPaste,
  Scissors,
  Copy,
  FilePlus,
  LayoutGrid,
  RotateCcw,
  FolderPlus,
  ChevronDown,
  AlignLeft,
  AlignCenter,
  AlignRight,
  AlignJustify,
  List,
  ListOrdered,
  ArrowUpDown,
  IndentIncrease,
  IndentDecrease,
  Shapes,
  Minus,
  ArrowRight,
  Layers,
  Palette,
  Lightbulb,
  Highlighter,
  Subscript,
  Superscript,
  PaintBucket,
  Grid3X3,
  ImageIcon
} from 'lucide-react';
import { cn } from '@/lib/utils';

const FONT_FAMILIES = [
  { label: 'Aptos Display', value: 'Aptos Display' },
  { label: 'Inter', value: 'Inter' },
  { label: 'Arial', value: 'Arial' },
  { label: 'Calibri', value: 'Calibri' },
  { label: 'Georgia', value: 'Georgia' },
  { label: 'Times New Roman', value: 'Times New Roman' },
];

const FONT_SIZES = [8, 9, 10, 11, 12, 14, 16, 18, 20, 24, 28, 32, 36, 44, 54, 60, 72, 96];

const TABS = [
  'Inicio',
  'Insertar', 
  'Dibujar',
  'Diseño',
  'Transiciones',
  'Animaciones',
  'Presentación con diapositivas',
  'Grabar',
  'Revisar',
  'Vista'
];

function RibbonGroup({ label, children, className }: { label: string; children: React.ReactNode; className?: string }) {
  return (
    <div className={cn("flex flex-col h-full", className)}>
      <div className="flex-1 flex items-start gap-1 pt-1 px-1.5">
        {children}
      </div>
      <div className="text-[10px] text-gray-500 text-center pb-0.5 border-t border-gray-200 mt-1 pt-0.5">
        {label}
      </div>
    </div>
  );
}

function RibbonSeparator() {
  return <div className="w-px h-[70px] bg-gray-200 mx-1" />;
}

function SmallIconButton({ icon: Icon, title, onClick, active, disabled }: { 
  icon: any; 
  title: string; 
  onClick?: () => void;
  active?: boolean;
  disabled?: boolean;
}) {
  return (
    <Button
      variant="ghost"
      size="icon"
      className={cn(
        "h-6 w-6 rounded-sm",
        active && "bg-blue-100"
      )}
      onClick={onClick}
      disabled={disabled}
      title={title}
    >
      <Icon className="h-3.5 w-3.5" />
    </Button>
  );
}

export function PPTRibbon() {
  const activeTab = useDeckStore((s) => s.activeTab);
  const setActiveTab = useDeckStore((s) => s.setActiveTab);
  const addTextElement = useDeckStore((s) => s.addTextElement);
  const addShapeElement = useDeckStore((s) => s.addShapeElement);
  const addImageElement = useDeckStore((s) => s.addImageElement);
  const applyTextStyleToDefault = useDeckStore((s) => s.applyTextStyleToDefault);
  const addSlide = useDeckStore((s) => s.addSlide);
  
  const selectedElement = useDeckStore(selectSelectedElement);
  const textStyle = selectedElement?.type === 'text' ? selectedElement.defaultTextStyle : null;

  const handleImageUpload = () => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'image/*';
    input.onchange = (e) => {
      const file = (e.target as HTMLInputElement).files?.[0];
      if (file) {
        const reader = new FileReader();
        reader.onload = (ev) => {
          const src = ev.target?.result as string;
          const img = new window.Image();
          img.onload = () => {
            addImageElement(src, img.naturalWidth, img.naturalHeight);
          };
          img.src = src;
        };
        reader.readAsDataURL(file);
      }
    };
    input.click();
  };

  return (
    <div className="bg-[#f3f3f3] border-b border-gray-300">
      <div className="flex items-center bg-white border-b border-gray-200">
        {TABS.map((tab) => (
          <button
            key={tab}
            onClick={() => setActiveTab(tab as RibbonTab)}
            className={cn(
              "px-3 py-1.5 text-[12px] hover:bg-gray-100 transition-colors relative",
              activeTab === tab && "font-medium"
            )}
          >
            {tab}
            {activeTab === tab && (
              <div className="absolute bottom-0 left-0 right-0 h-[2px] bg-[#D83B01]" />
            )}
          </button>
        ))}
        <div className="flex-1" />
        <button className="px-3 py-1.5 text-[12px] text-gray-600 hover:bg-gray-100 flex items-center gap-1">
          <span className="w-2 h-2 rounded-full bg-red-500" />
          Grabar
        </button>
        <button className="px-3 py-1.5 text-[12px] hover:bg-gray-100 flex items-center gap-1.5 mr-2">
          Comentarios
        </button>
        <button className="px-3 py-1.5 text-[12px] bg-[#D83B01] text-white rounded-sm mr-2 flex items-center gap-1.5">
          <span className="text-sm">↗</span>
          Compartir
        </button>
      </div>

      <div className="h-[82px] flex items-stretch bg-[#f9f9f9]">
        {(activeTab === 'Inicio' || activeTab === 'Home') && (
          <>
            <RibbonGroup label="Pegar">
              <div className="flex flex-col items-center">
                <Button variant="ghost" className="h-12 w-12 flex flex-col items-center justify-center rounded-sm hover:bg-blue-50 p-1">
                  <ClipboardPaste className="h-6 w-6 text-gray-700" />
                  <div className="flex items-center text-[10px] mt-0.5">
                    <span>Pegar</span>
                    <ChevronDown className="h-2.5 w-2.5 ml-0.5" />
                  </div>
                </Button>
                <div className="flex gap-0.5 mt-0.5">
                  <SmallIconButton icon={Scissors} title="Cortar" />
                  <SmallIconButton icon={Copy} title="Copiar" />
                </div>
              </div>
            </RibbonGroup>

            <RibbonSeparator />

            <RibbonGroup label="Diapositivas">
              <div className="flex gap-1">
                <Button 
                  variant="ghost" 
                  className="h-14 flex flex-col items-center justify-center rounded-sm hover:bg-blue-50 px-2"
                  onClick={addSlide}
                  data-testid="btn-add-slide-ribbon"
                >
                  <div className="flex items-center">
                    <FilePlus className="h-5 w-5 text-gray-700" />
                    <ChevronDown className="h-2.5 w-2.5 ml-0.5" />
                  </div>
                  <span className="text-[10px] mt-0.5">Nueva</span>
                  <span className="text-[10px]">diapositiva</span>
                </Button>
                <Button variant="ghost" className="h-14 flex flex-col items-center justify-center rounded-sm hover:bg-blue-50 px-2">
                  <Sparkles className="h-5 w-5 text-purple-600" />
                  <span className="text-[10px] mt-0.5">Nueva con</span>
                  <span className="text-[10px]">Copilot</span>
                </Button>
              </div>
            </RibbonGroup>

            <RibbonSeparator />

            <RibbonGroup label="Sección">
              <div className="flex flex-col gap-0.5">
                <Button variant="ghost" className="h-6 text-[11px] justify-start px-2 rounded-sm hover:bg-blue-50">
                  <LayoutGrid className="h-3.5 w-3.5 mr-1" />
                  Diseño
                  <ChevronDown className="h-2.5 w-2.5 ml-1" />
                </Button>
                <Button variant="ghost" className="h-6 text-[11px] justify-start px-2 rounded-sm hover:bg-blue-50">
                  <RotateCcw className="h-3.5 w-3.5 mr-1" />
                  Restablecer
                </Button>
                <Button variant="ghost" className="h-6 text-[11px] justify-start px-2 rounded-sm hover:bg-blue-50">
                  <FolderPlus className="h-3.5 w-3.5 mr-1" />
                  Sección
                  <ChevronDown className="h-2.5 w-2.5 ml-1" />
                </Button>
              </div>
            </RibbonGroup>

            <RibbonSeparator />

            <RibbonGroup label="Fuente">
              <div className="flex flex-col gap-0.5">
                <div className="flex items-center gap-0.5">
                  <Select
                    value={textStyle?.fontFamily ?? 'Aptos Display'}
                    onValueChange={(v) => selectedElement && applyTextStyleToDefault(selectedElement.id, { fontFamily: v })}
                    disabled={!textStyle}
                  >
                    <SelectTrigger className="h-6 w-[110px] text-[11px] bg-white border-gray-300" data-testid="ribbon-font-family">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {FONT_FAMILIES.map((font) => (
                        <SelectItem key={font.value} value={font.value} className="text-[11px]">{font.label}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <Select
                    value={String(textStyle?.fontSize ?? 60)}
                    onValueChange={(v) => selectedElement && applyTextStyleToDefault(selectedElement.id, { fontSize: Number(v) })}
                    disabled={!textStyle}
                  >
                    <SelectTrigger className="h-6 w-12 text-[11px] bg-white border-gray-300" data-testid="ribbon-font-size">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {FONT_SIZES.map((size) => (
                        <SelectItem key={size} value={String(size)} className="text-[11px]">{size}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <Button variant="ghost" size="icon" className="h-6 w-6 rounded-sm">
                    <ChevronDown className="h-3 w-3 rotate-180" />
                  </Button>
                  <Button variant="ghost" size="icon" className="h-6 w-6 rounded-sm">
                    <ChevronDown className="h-3 w-3" />
                  </Button>
                </div>
                <div className="flex items-center gap-0.5">
                  <SmallIconButton 
                    icon={Bold} 
                    title="Negrita" 
                    active={textStyle?.bold}
                    onClick={() => selectedElement && applyTextStyleToDefault(selectedElement.id, { bold: !textStyle?.bold })}
                    disabled={!textStyle}
                  />
                  <SmallIconButton 
                    icon={Italic} 
                    title="Cursiva"
                    active={textStyle?.italic}
                    onClick={() => selectedElement && applyTextStyleToDefault(selectedElement.id, { italic: !textStyle?.italic })}
                    disabled={!textStyle}
                  />
                  <SmallIconButton 
                    icon={Underline} 
                    title="Subrayado"
                    active={textStyle?.underline}
                    onClick={() => selectedElement && applyTextStyleToDefault(selectedElement.id, { underline: !textStyle?.underline })}
                    disabled={!textStyle}
                  />
                  <SmallIconButton icon={Strikethrough} title="Tachado" disabled={!textStyle} />
                  <SmallIconButton icon={Subscript} title="Subíndice" disabled={!textStyle} />
                  <SmallIconButton icon={Superscript} title="Superíndice" disabled={!textStyle} />
                  <div className="w-px h-4 bg-gray-300 mx-0.5" />
                  <div className="relative">
                    <Input
                      type="color"
                      value={textStyle?.color ?? '#111111'}
                      onChange={(e) => selectedElement && applyTextStyleToDefault(selectedElement.id, { color: e.target.value })}
                      className="w-6 h-6 p-0.5 cursor-pointer"
                      disabled={!textStyle}
                      data-testid="ribbon-text-color"
                    />
                  </div>
                  <SmallIconButton icon={Highlighter} title="Resaltado" disabled={!textStyle} />
                </div>
              </div>
            </RibbonGroup>

            <RibbonSeparator />

            <RibbonGroup label="Párrafo">
              <div className="flex flex-col gap-0.5">
                <div className="flex items-center gap-0.5">
                  <SmallIconButton icon={List} title="Viñetas" />
                  <SmallIconButton icon={ListOrdered} title="Numeración" />
                  <div className="w-px h-4 bg-gray-300 mx-0.5" />
                  <SmallIconButton icon={IndentDecrease} title="Disminuir sangría" />
                  <SmallIconButton icon={IndentIncrease} title="Aumentar sangría" />
                  <SmallIconButton icon={ArrowUpDown} title="Interlineado" />
                </div>
                <div className="flex items-center gap-0.5">
                  <SmallIconButton icon={AlignLeft} title="Alinear a la izquierda" />
                  <SmallIconButton icon={AlignCenter} title="Centrar" />
                  <SmallIconButton icon={AlignRight} title="Alinear a la derecha" />
                  <SmallIconButton icon={AlignJustify} title="Justificar" />
                  <SmallIconButton icon={Grid3X3} title="Columnas" />
                </div>
              </div>
            </RibbonGroup>

            <RibbonSeparator />

            <RibbonGroup label="Dibujo">
              <div className="flex gap-1">
                <Button variant="ghost" className="h-14 flex flex-col items-center justify-center rounded-sm hover:bg-blue-50 px-2">
                  <Shapes className="h-5 w-5 text-gray-700" />
                  <span className="text-[10px] mt-0.5">Convertir</span>
                  <span className="text-[10px]">a SmartArt</span>
                </Button>
              </div>
            </RibbonGroup>

            <RibbonSeparator />

            <RibbonGroup label="">
              <Button 
                variant="ghost" 
                className="h-14 flex flex-col items-center justify-center rounded-sm hover:bg-blue-50 px-2"
                onClick={handleImageUpload}
                data-testid="btn-insert-image-ribbon"
              >
                <ImageIcon className="h-5 w-5 text-gray-700" />
                <span className="text-[10px] mt-0.5">Imagen</span>
              </Button>
            </RibbonGroup>

            <RibbonSeparator />

            <RibbonGroup label="Edición">
              <div className="flex gap-1">
                <Button variant="ghost" className="h-14 flex flex-col items-center justify-center rounded-sm hover:bg-blue-50 px-2">
                  <Layers className="h-5 w-5 text-gray-700" />
                  <span className="text-[10px] mt-0.5">Organizar</span>
                  <ChevronDown className="h-2.5 w-2.5" />
                </Button>
                <Button variant="ghost" className="h-14 flex flex-col items-center justify-center rounded-sm hover:bg-blue-50 px-2">
                  <Palette className="h-5 w-5 text-gray-700" />
                  <span className="text-[10px] mt-0.5">Estilos</span>
                  <span className="text-[10px]">rápidos</span>
                </Button>
              </div>
            </RibbonGroup>

            <RibbonSeparator />

            <RibbonGroup label="">
              <Button variant="ghost" className="h-14 flex flex-col items-center justify-center rounded-sm hover:bg-blue-50 px-2">
                <div className="w-7 h-7 bg-gradient-to-br from-blue-400 to-purple-500 rounded flex items-center justify-center">
                  <Lightbulb className="h-4 w-4 text-white" />
                </div>
                <span className="text-[10px] mt-0.5">Complementos</span>
              </Button>
            </RibbonGroup>

            <RibbonSeparator />

            <RibbonGroup label="Sugerencias de diseños">
              <Button variant="ghost" className="h-14 flex flex-col items-center justify-center rounded-sm hover:bg-blue-50 px-2">
                <div className="w-7 h-7 bg-gradient-to-br from-orange-400 to-pink-500 rounded flex items-center justify-center">
                  <Sparkles className="h-4 w-4 text-white" />
                </div>
                <span className="text-[10px] mt-0.5">Sugerencias</span>
                <span className="text-[10px]">de diseños</span>
              </Button>
            </RibbonGroup>
          </>
        )}

        {activeTab === 'Insertar' && (
          <>
            <RibbonGroup label="Diapositivas">
              <Button 
                variant="ghost" 
                className="h-14 flex flex-col items-center justify-center rounded-sm hover:bg-blue-50 px-2"
                onClick={addSlide}
              >
                <FilePlus className="h-5 w-5 text-gray-700" />
                <span className="text-[10px] mt-0.5">Nueva</span>
                <span className="text-[10px]">diapositiva</span>
              </Button>
            </RibbonGroup>

            <RibbonSeparator />

            <RibbonGroup label="Elementos">
              <div className="flex gap-1">
                <Button
                  variant="ghost"
                  className="h-14 flex flex-col items-center justify-center rounded-sm hover:bg-blue-50 px-2"
                  onClick={addTextElement}
                  data-testid="btn-insert-text"
                >
                  <Type className="h-5 w-5 text-gray-700" />
                  <span className="text-[10px] mt-0.5">Cuadro de</span>
                  <span className="text-[10px]">texto</span>
                </Button>
                <Button
                  variant="ghost"
                  className="h-14 flex flex-col items-center justify-center rounded-sm hover:bg-blue-50 px-2"
                  onClick={() => addShapeElement('rect')}
                  data-testid="btn-insert-rect"
                >
                  <Square className="h-5 w-5 text-gray-700" />
                  <span className="text-[10px] mt-0.5">Rectángulo</span>
                </Button>
                <Button
                  variant="ghost"
                  className="h-14 flex flex-col items-center justify-center rounded-sm hover:bg-blue-50 px-2"
                  onClick={() => addShapeElement('ellipse')}
                  data-testid="btn-insert-ellipse"
                >
                  <Circle className="h-5 w-5 text-gray-700" />
                  <span className="text-[10px] mt-0.5">Elipse</span>
                </Button>
                <Button
                  variant="ghost"
                  className="h-14 flex flex-col items-center justify-center rounded-sm hover:bg-blue-50 px-2"
                  onClick={handleImageUpload}
                  data-testid="btn-insert-image"
                >
                  <Image className="h-5 w-5 text-gray-700" />
                  <span className="text-[10px] mt-0.5">Imagen</span>
                </Button>
              </div>
            </RibbonGroup>
          </>
        )}

        {(activeTab !== 'Inicio' && activeTab !== 'Home' && activeTab !== 'Insertar' && activeTab !== 'Insert') && (
          <div className="flex items-center justify-center w-full text-sm text-gray-500">
            Opciones de "{activeTab}" disponibles próximamente
          </div>
        )}
      </div>
    </div>
  );
}
