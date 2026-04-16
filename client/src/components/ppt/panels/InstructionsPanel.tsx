import React, { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Loader2, Wand2 } from 'lucide-react';

export interface InstructionsPanelProps {
  onGenerate: (instructions: {
    topic: string;
    requirements: string;
    slideCount: number;
    style: 'professional' | 'creative' | 'minimal';
  }) => Promise<void>;
  isGenerating: boolean;
}

export function InstructionsPanel({ onGenerate, isGenerating }: InstructionsPanelProps) {
  const [topic, setTopic] = useState('');
  const [requirements, setRequirements] = useState('');
  const [slideCount, setSlideCount] = useState(5);
  const [style, setStyle] = useState<'professional' | 'creative' | 'minimal'>('professional');

  const handleGenerate = async () => {
    if (!topic.trim()) return;
    
    await onGenerate({
      topic: topic.trim(),
      requirements: requirements.trim(),
      slideCount,
      style,
    });
  };

  const isValid = topic.trim().length > 0;

  return (
    <div className="h-full flex flex-col bg-white" data-testid="instructions-panel">
      <div className="px-4 py-3 border-b border-gray-200">
        <h3 className="text-sm font-semibold text-gray-800">Instrucciones</h3>
        <p className="text-xs text-gray-500 mt-0.5">
          Genera una presentación con IA
        </p>
      </div>

      <ScrollArea className="flex-1">
        <div className="p-4 space-y-4">
          <div className="space-y-2">
            <Label htmlFor="topic" className="text-xs font-medium text-gray-700">
              Tema de la presentación *
            </Label>
            <Input
              id="topic"
              placeholder="Ej: Introducción al marketing digital"
              value={topic}
              onChange={(e) => setTopic(e.target.value)}
              disabled={isGenerating}
              className="text-sm"
              data-testid="input-topic"
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="requirements" className="text-xs font-medium text-gray-700">
              Requisitos e instrucciones
            </Label>
            <Textarea
              id="requirements"
              placeholder="Describe el contenido que deseas incluir, el público objetivo, puntos clave a cubrir, etc."
              value={requirements}
              onChange={(e) => setRequirements(e.target.value)}
              disabled={isGenerating}
              className="text-sm min-h-[120px] resize-none"
              data-testid="textarea-requirements"
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-2">
              <Label htmlFor="slideCount" className="text-xs font-medium text-gray-700">
                Número de diapositivas
              </Label>
              <Select
                value={slideCount.toString()}
                onValueChange={(val) => setSlideCount(parseInt(val, 10))}
                disabled={isGenerating}
              >
                <SelectTrigger id="slideCount" className="text-sm" data-testid="select-slide-count">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {[3, 5, 7, 10, 15, 20].map((num) => (
                    <SelectItem key={num} value={num.toString()}>
                      {num} diapositivas
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label htmlFor="style" className="text-xs font-medium text-gray-700">
                Estilo
              </Label>
              <Select
                value={style}
                onValueChange={(val) => setStyle(val as 'professional' | 'creative' | 'minimal')}
                disabled={isGenerating}
              >
                <SelectTrigger id="style" className="text-sm" data-testid="select-style">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="professional">Profesional</SelectItem>
                  <SelectItem value="creative">Creativo</SelectItem>
                  <SelectItem value="minimal">Minimalista</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
        </div>
      </ScrollArea>

      <div className="p-4 border-t border-gray-200">
        <Button
          onClick={handleGenerate}
          disabled={!isValid || isGenerating}
          className="w-full"
          data-testid="button-generate"
        >
          {isGenerating ? (
            <>
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              Generando...
            </>
          ) : (
            <>
              <Wand2 className="mr-2 h-4 w-4" />
              Generar Presentación
            </>
          )}
        </Button>
      </div>
    </div>
  );
}
