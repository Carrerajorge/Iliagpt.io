import React, { useCallback, useRef, useState, useEffect } from 'react';
import { useDeckStore, selectDeck, selectCanUndo, selectCanRedo } from './store/deckStore';
import { CanvasStage } from './canvas/CanvasStage';
import { SlidesPanel, InstructionsPanel } from './panels';
import { OfficeToolShell, OfficeViewMode } from '../office/OfficeToolShell';
import { PPTRibbon } from './ribbon/PPTRibbon';
import { Slider } from '@/components/ui/slider';
import {
  MessageSquare,
  StickyNote,
  Monitor,
  Columns,
  Square,
  ZoomIn,
  ZoomOut,
  Check,
  ChevronDown,
  Wand2,
  X // Used for instructions panel close
} from 'lucide-react';
import { exportDeckToPptx, downloadBlob } from '@/lib/pptExport';
import { cn } from '@/lib/utils';
import { createPptStreamParser } from '@/lib/pptStreaming';
import { PPT_STREAMING_SYSTEM_PROMPT } from '@/lib/pptPrompts';
import { usePlatformSettings } from '@/contexts/PlatformSettingsContext';
import { formatZonedDate, normalizeTimeZone } from '@/lib/platformDateTime';
import type { Deck } from './store/types';

interface PPTEditorShellProps {
  onClose: () => void;
  onInsertContent?: (insertFn: (content: string) => void) => void;
  initialShowInstructions?: boolean;
  initialContent?: string;
}

export function PPTEditorShell({ onClose, onInsertContent, initialShowInstructions = false, initialContent }: PPTEditorShellProps) {
  const deck = useDeckStore(selectDeck);
  const activeSlideId = useDeckStore((s) => s.activeSlideId);
  const zoom = useDeckStore((s) => s.zoom);
  const setZoom = useDeckStore((s) => s.setZoom);
  const setTitle = useDeckStore((s) => s.setTitle);
  const loadDeck = useDeckStore((s) => s.loadDeck);
  const resetToDefault = useDeckStore((s) => s.resetToDefault);

  const initialContentRef = React.useRef<string | undefined>(undefined);

  useEffect(() => {
    // Only load if initialContent actually changed (avoid effect thrashing)
    if (initialContent === initialContentRef.current) return;
    initialContentRef.current = initialContent;

    if (initialContent && initialContent.length > 0) {
      try {
        const parsedDeck = JSON.parse(initialContent) as Deck;
        if (parsedDeck && parsedDeck.slides && Array.isArray(parsedDeck.slides) && parsedDeck.slides.length > 0) {
          console.log('[PPTEditorShell] Loading deck from initialContent:', parsedDeck.title, 'with', parsedDeck.slides.length, 'slides');
          loadDeck(parsedDeck);
        } else {
          console.warn('[PPTEditorShell] Invalid deck structure, resetting to default');
          resetToDefault();
        }
      } catch (error) {
        console.error('[PPTEditorShell] Failed to parse initialContent:', error);
        resetToDefault();
      }
    }
    // Note: We don't call resetToDefault when initialContent is empty because
    // the user might be creating a new presentation manually
  }, [initialContent, loadDeck, resetToDefault]);

  const [showNotes, setShowNotes] = useState(true);
  const [showInstructions, setShowInstructions] = useState(initialShowInstructions);
  const [isGenerating, setIsGenerating] = useState(false);
  const { settings: platformSettings } = usePlatformSettings();
  const platformTimeZone = normalizeTimeZone(platformSettings.timezone_default);
  const platformDateFormat = platformSettings.date_format;

  const titleRef = useRef<HTMLInputElement>(null);

  const activeSlideIndex = deck.slides.findIndex(s => s.id === activeSlideId) + 1;
  const totalSlides = deck.slides.length;

  const handleExport = useCallback(async () => {
    try {
      const currentDeck = selectDeck(useDeckStore.getState());
      const blob = await exportDeckToPptx(currentDeck);
      downloadBlob(blob, `${currentDeck.title || 'presentacion'}.pptx`);
    } catch (error) {
      console.error('Export failed:', error);
    }
  }, [platformTimeZone, platformDateFormat]);

  const handleTitleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setTitle(e.target.value);
  };

  const handleGenerateFromInstructions = useCallback(async (instructions: {
    topic: string;
    requirements: string;
    slideCount: number;
    style: 'professional' | 'creative' | 'minimal';
  }) => {
    setIsGenerating(true);

    try {
      const styleDescriptions = {
        professional: 'profesional y corporativo',
        creative: 'creativo y visualmente atractivo',
        minimal: 'minimalista y limpio'
      };

      const userPrompt = `Crea una presentación con ${instructions.slideCount} diapositivas sobre: ${instructions.topic}

Estilo: ${styleDescriptions[instructions.style]}
${instructions.requirements ? `\nRequisitos adicionales: ${instructions.requirements}` : ''}

Usa el formato de marcado especificado para generar el contenido.`;

      const parser = createPptStreamParser();

      const response = await fetch('/api/chat', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          messages: [
            { role: 'user', content: userPrompt }
          ],
          systemPrompt: PPT_STREAMING_SYSTEM_PROMPT,
          stream: true,
          mode: 'ppt'
        }),
      });

      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }

      const reader = response.body?.getReader();
      if (!reader) {
        throw new Error('No response body reader available');
      }

      const decoder = new TextDecoder();

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        const chunk = decoder.decode(value, { stream: true });
        const lines = chunk.split('\n');

        for (const line of lines) {
          if (line.startsWith('data: ')) {
            const data = line.slice(6);
            if (data === '[DONE]') continue;

            try {
              const parsed = JSON.parse(data);
              const content = parsed.choices?.[0]?.delta?.content ||
                parsed.content ||
                parsed.text ||
                '';
              if (content) {
                parser.processChunk(content);
              }
            } catch {
              if (data && data !== '[DONE]') {
                parser.processChunk(data);
              }
            }
          } else if (line.trim() && !line.startsWith(':')) {
            parser.processChunk(line);
          }
        }
      }

      parser.flush();

      // === MASTERY POST-PROCESSOR ===
      // Rule 11-12: Validate and Normalize the generated deck
      try {
        const { runPostProcessor } = await import('@/lib/pptPostProcessor');
	        const result = runPostProcessor({
	          normalize: true,
	          validate: true,
	          injectFooter: true,
	          footerConfig: {
	            showSlideNumber: true,
	            date: formatZonedDate(new Date(), { timeZone: platformTimeZone, dateFormat: platformDateFormat }),
	          },
	        });

        // Log validation issues (could display in UI)
        if (result.validation.some(v => !v.isValid)) {
          console.warn('⚠️ Mastery Validation Issues:', result.validation.filter(v => !v.isValid));
        } else {
          console.log('✅ Deck passed Mastery validation');
        }
      } catch (postProcessError) {
        console.error('Post-processor error:', postProcessError);
      }

      setShowInstructions(false);
    } catch (error) {
      console.error('Error generating presentation:', error);
    } finally {
      setIsGenerating(false);
    }
  }, []);

  // Shell state
  const [viewMode, setViewMode] = useState<OfficeViewMode>('visual');
  const [jsonContent, setJsonContent] = useState('');

  // Sync JSON for code view
  useEffect(() => {
    if (viewMode === 'code') {
      setJsonContent(JSON.stringify(deck, null, 2));
    }
  }, [viewMode, deck]);

  const handleJsonChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    setJsonContent(e.target.value);
    // Optional: Live update the deck store if valid JSON
    try {
      const parsed = JSON.parse(e.target.value);
      if (parsed && parsed.slides && Array.isArray(parsed.slides)) {
        loadDeck(parsed);
      }
    } catch (parseError) {
      // JSON is incomplete or invalid during typing - this is expected
      // Only log in development for debugging
      if (process.env.NODE_ENV === 'development' && e.target.value.trim().endsWith('}')) {
        console.debug('[PPTEditorShell] JSON parse error:', parseError);
      }
    }
  };

  return (
    <OfficeToolShell
      title={deck.title || "Presentación"}
      type="ppt"
      viewMode={viewMode}
      onViewModeChange={setViewMode}
      onClose={onClose}
      onDownload={handleExport}
      toolbar={<PPTRibbon />}
      statusBar={
        <PPTStatusBar
          activeSlideIndex={activeSlideIndex}
          totalSlides={totalSlides}
          showNotes={showNotes}
          setShowNotes={setShowNotes}
          showInstructions={showInstructions}
          setShowInstructions={setShowInstructions}
          zoom={zoom}
          setZoom={setZoom}
        />
      }
    >
      {viewMode === 'visual' ? (
        <div className="h-full flex flex-col bg-white" data-testid="ppt-editor-shell">
          <div className="flex-1 flex min-h-0">
            <div className="w-[72px] border-r border-gray-200 bg-[#f6f7fb]">
              <SlidesPanel />
            </div>

            <div className="flex-1 min-w-0 flex flex-col bg-[#f6f7fb]">
              <div className="flex-1 relative">
                <CanvasStage />
              </div>

              {showNotes && (
                <div className="h-[40px] border-t border-gray-300 bg-white flex items-center px-4">
                  <input
                    type="text"
                    placeholder="Haz clic para agregar notas"
                    className="flex-1 text-sm text-gray-400 bg-transparent border-none outline-none"
                  />
                </div>
              )}
            </div>

            {showInstructions && (
              <div className="w-[320px] border-l border-gray-200 bg-white flex flex-col">
                <div className="flex items-center justify-between px-3 py-2 border-b border-gray-200 bg-gray-50">
                  <span className="text-xs font-medium text-gray-600">Generador IA</span>
                  <button
                    onClick={() => setShowInstructions(false)}
                    className="p-1 hover:bg-gray-200 rounded"
                    data-testid="button-close-instructions"
                  >
                    <X className="h-3.5 w-3.5 text-gray-500" />
                  </button>
                </div>
                <div className="flex-1 overflow-hidden">
                  <InstructionsPanel
                    onGenerate={handleGenerateFromInstructions}
                    isGenerating={isGenerating}
                  />
                </div>
              </div>
            )}
          </div>
        </div>
      ) : (
        <div className="h-full w-full bg-[#1e1e1e] p-4 font-mono text-sm">
          <textarea
            className="w-full h-full bg-transparent text-[#d4d4d4] resize-none focus:outline-none"
            value={jsonContent}
            onChange={handleJsonChange}
            spellCheck={false}
          />
        </div>
      )}
    </OfficeToolShell>
  );
}

function PPTStatusBar({
  activeSlideIndex,
  totalSlides,
  showNotes,
  setShowNotes,
  showInstructions,
  setShowInstructions,
  zoom,
  setZoom
}: any) {
  return (
    <div className="flex items-center justify-between w-full">
      <div className="flex items-center gap-3">
        <span>Diapositiva {activeSlideIndex} de {totalSlides}</span>
        <div className="w-px h-3 bg-gray-300" />
        <button className="hover:bg-gray-100 px-1 rounded flex items-center gap-1">
          Español (Estados Unidos)
          <ChevronDown className="h-2.5 w-2.5" />
        </button>
      </div>

      <div className="flex items-center gap-2">
        <button
          className={cn(
            "flex items-center gap-1 px-1.5 py-0.5 rounded hover:bg-gray-200",
            showInstructions && "bg-blue-100 text-blue-700"
          )}
          onClick={() => setShowInstructions(!showInstructions)}
          data-testid="button-toggle-instructions"
        >
          <Wand2 className="h-3 w-3" />
          <span>Instrucciones</span>
        </button>

        <div className="w-px h-3 bg-gray-300" />

        <button
          className={cn(
            "flex items-center gap-1 px-1.5 py-0.5 rounded hover:bg-gray-200",
            showNotes && "bg-gray-200"
          )}
          onClick={() => setShowNotes(!showNotes)}
        >
          <StickyNote className="h-3 w-3" />
          <span>Notas</span>
        </button>

        <div className="w-px h-3 bg-gray-300 mx-1" />

        <div className="flex items-center gap-1">
          <button
            className="p-0.5 rounded hover:bg-gray-200"
            onClick={() => setZoom(Math.max(0.25, zoom - 0.1))}
          >
            <ZoomOut className="h-3.5 w-3.5" />
          </button>
          <div className="w-[80px]">
            <Slider
              value={[zoom * 100]}
              min={25}
              max={200}
              step={5}
              onValueChange={([val]) => setZoom(val / 100)}
              className="h-1"
            />
          </div>
          <button
            className="p-0.5 rounded hover:bg-gray-200"
            onClick={() => setZoom(Math.min(2, zoom + 0.1))}
          >
            <ZoomIn className="h-3.5 w-3.5" />
          </button>
          <span className="text-[10px] w-10 text-center">{Math.round(zoom * 100)}%</span>
        </div>
      </div>
    </div>
  );
}

export default PPTEditorShell;
