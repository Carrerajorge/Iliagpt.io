import React, { useRef, useEffect, useCallback } from 'react';
import { Stage, Layer, Rect, Transformer } from 'react-konva';
import type Konva from 'konva';
import { useDeckStore, selectActiveSlide } from '../store/deckStore';
import { TextNode, ShapeNode, ImageNode, ChartNode } from './elements';
import type { ElementAny, TextElement, ShapeElement, ImageElement, ChartElement } from '../store/types';
import { Button } from '@/components/ui/button';
import { ZoomIn, ZoomOut, Maximize } from 'lucide-react';

const CANVAS_WIDTH = 1280;
const CANVAS_HEIGHT = 720;

export function CanvasStage() {
  const stageRef = useRef<Konva.Stage>(null);
  const transformerRef = useRef<Konva.Transformer>(null);

  const slide = useDeckStore(selectActiveSlide);
  const selection = useDeckStore((s) => s.selection);
  const activeSlideId = useDeckStore((s) => s.activeSlideId);
  const zoom = useDeckStore((s) => s.zoom);
  const select = useDeckStore((s) => s.select);
  const clearSelection = useDeckStore((s) => s.clearSelection);
  const updateElement = useDeckStore((s) => s.updateElement);
  const setZoom = useDeckStore((s) => s.setZoom);
  const deleteElement = useDeckStore((s) => s.deleteElement);

  useEffect(() => {
    const transformer = transformerRef.current;
    const stage = stageRef.current;
    if (!transformer || !stage) return;

    if (selection && selection.slideId === activeSlideId) {
      const selectedNode = stage.findOne(`#${selection.elementId}`);
      if (selectedNode) {
        transformer.nodes([selectedNode]);
        transformer.getLayer()?.batchDraw();
        return;
      }
    }
    transformer.nodes([]);
    transformer.getLayer()?.batchDraw();
  }, [selection, activeSlideId, slide.elements]);

  const handleStageClick = (e: Konva.KonvaEventObject<MouseEvent | TouchEvent>) => {
    if (e.target === e.target.getStage() || e.target.getClassName() === 'Rect' && e.target.getParent() === e.target.getStage()) {
      clearSelection();
    }
  };

  const handleKeyDown = useCallback((e: KeyboardEvent) => {
    if (e.key === 'Delete' || e.key === 'Backspace') {
      const currentSelection = useDeckStore.getState().selection;
      if (currentSelection) {
        deleteElement(currentSelection.elementId);
      }
    }
    if (e.key === 'Escape') {
      clearSelection();
    }
  }, [deleteElement, clearSelection]);

  useEffect(() => {
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [handleKeyDown]);

  const handleElementSelect = (elementId: string) => {
    select({ slideId: activeSlideId, elementId });
  };

  const handleElementTransform = (elementId: string, patch: Partial<ElementAny>) => {
    updateElement(elementId, patch);
  };

  const sortedElements = [...slide.elements].sort((a, b) => (a.zIndex ?? 0) - (b.zIndex ?? 0));

  const containerWidth = Math.min(window.innerWidth - 520, CANVAS_WIDTH);
  const containerHeight = Math.min(window.innerHeight - 250, CANVAS_HEIGHT);
  const scaleToFit = Math.min(containerWidth / CANVAS_WIDTH, containerHeight / CANVAS_HEIGHT, 1);
  const displayZoom = zoom * scaleToFit;

  return (
    <div className="relative h-full flex flex-col items-center justify-center bg-gray-100 dark:bg-gray-800">
      <div className="absolute top-3 right-3 z-10 flex gap-2">
        <Button
          variant="outline"
          size="icon"
          className="h-8 w-8"
          onClick={() => setZoom(zoom - 0.1)}
          data-testid="btn-zoom-out"
        >
          <ZoomOut className="h-4 w-4" />
        </Button>
        <span className="flex items-center text-sm text-muted-foreground min-w-[60px] justify-center">
          {Math.round(zoom * 100)}%
        </span>
        <Button
          variant="outline"
          size="icon"
          className="h-8 w-8"
          onClick={() => setZoom(zoom + 0.1)}
          data-testid="btn-zoom-in"
        >
          <ZoomIn className="h-4 w-4" />
        </Button>
        <Button
          variant="outline"
          size="icon"
          className="h-8 w-8"
          onClick={() => setZoom(1)}
          data-testid="btn-zoom-reset"
        >
          <Maximize className="h-4 w-4" />
        </Button>
      </div>

      <div
        className="shadow-xl rounded-lg overflow-hidden"
        style={{
          width: CANVAS_WIDTH * displayZoom,
          height: CANVAS_HEIGHT * displayZoom,
          backgroundColor: slide.background.color
        }}
      >
        <Stage
          ref={stageRef}
          width={CANVAS_WIDTH * displayZoom}
          height={CANVAS_HEIGHT * displayZoom}
          scaleX={displayZoom}
          scaleY={displayZoom}
          onClick={handleStageClick}
          onTap={handleStageClick}
          style={{ cursor: 'default' }}
        >
          <Layer>
            <Rect
              width={CANVAS_WIDTH}
              height={CANVAS_HEIGHT}
              fill={slide.background.color}
            />
            
            {sortedElements.map((element) => {
              const isSelected = selection?.elementId === element.id;
              const commonProps = {
                isSelected,
                onSelect: () => handleElementSelect(element.id),
                onTransformEnd: (patch: Partial<ElementAny>) => handleElementTransform(element.id, patch)
              };

              switch (element.type) {
                case 'text':
                  return (
                    <TextNode
                      key={element.id}
                      {...commonProps}
                      element={element as TextElement}
                    />
                  );
                case 'shape':
                  return (
                    <ShapeNode
                      key={element.id}
                      {...commonProps}
                      element={element as ShapeElement}
                    />
                  );
                case 'image':
                  return (
                    <ImageNode
                      key={element.id}
                      {...commonProps}
                      element={element as ImageElement}
                    />
                  );
                case 'chart':
                  return (
                    <ChartNode
                      key={element.id}
                      {...commonProps}
                      element={element as ChartElement}
                    />
                  );
                default:
                  return null;
              }
            })}

            <Transformer
              ref={transformerRef}
              boundBoxFunc={(oldBox, newBox) => {
                if (newBox.width < 20 || newBox.height < 20) {
                  return oldBox;
                }
                return newBox;
              }}
              anchorSize={8}
              anchorCornerRadius={2}
              borderStroke="#2563eb"
              anchorStroke="#2563eb"
              anchorFill="#ffffff"
            />
          </Layer>
        </Stage>
      </div>
    </div>
  );
}
