import React from 'react';
import { useDeckStore, selectDeck } from '../store/deckStore';
import { ScrollArea } from '@/components/ui/scroll-area';
import { cn } from '@/lib/utils';

// Increased thumbnail size for better visibility (Improvement #7)
const THUMB_WIDTH = 80;
const THUMB_HEIGHT = 45;

export function SlidesPanel() {
  const deck = useDeckStore(selectDeck);
  const activeSlideId = useDeckStore((s) => s.activeSlideId);
  const setActiveSlide = useDeckStore((s) => s.setActiveSlide);

  return (
    <div className="h-full flex flex-col bg-[#f6f7fb]">
      <ScrollArea className="flex-1">
        <div className="py-2">
          {deck.slides.map((slide, index) => (
            <div
              key={slide.id}
              className="flex items-start gap-1 px-1 py-1 cursor-pointer group"
              onClick={() => setActiveSlide(slide.id)}
              data-testid={`slide-thumbnail-${index}`}
            >
              <span className="text-[10px] text-gray-500 w-4 text-right mt-1 flex-shrink-0">
                {index + 1}
              </span>
              <div
                className={cn(
                  "rounded-sm overflow-hidden transition-all border-2",
                  activeSlideId === slide.id
                    ? "border-[#D83B01] ring-1 ring-[#D83B01]/30"
                    : "border-gray-300 hover:border-gray-400"
                )}
                style={{
                  width: THUMB_WIDTH,
                  height: THUMB_HEIGHT,
                }}
              >
                <div className="relative w-full h-full">
                  <svg
                    viewBox="0 0 1280 720"
                    width={THUMB_WIDTH}
                    height={THUMB_HEIGHT}
                    className="w-full h-full"
                    preserveAspectRatio="xMidYMid meet"
                  >
                    <rect
                      width="1280"
                      height="720"
                      fill={slide.background.color}
                    />
                    {slide.elements.map((el) => {
                      if (el.type === 'text') {
                        const text = el.delta.ops.map(op => op.insert).join('').slice(0, 50);
                        return (
                          <text
                            key={el.id}
                            x={el.x}
                            y={el.y + (el.defaultTextStyle?.fontSize || 24)}
                            fontSize={el.defaultTextStyle?.fontSize || 24}
                            fill={el.defaultTextStyle?.color || '#000'}
                            fontFamily={el.defaultTextStyle?.fontFamily || 'sans-serif'}
                          >
                            {text.slice(0, 30)}
                          </text>
                        );
                      }
                      if (el.type === 'shape') {
                        if (el.shapeType === 'ellipse') {
                          return (
                            <ellipse
                              key={el.id}
                              cx={el.x + el.w / 2}
                              cy={el.y + el.h / 2}
                              rx={el.w / 2}
                              ry={el.h / 2}
                              fill={el.fill}
                              stroke={el.stroke}
                              strokeWidth={el.strokeWidth}
                            />
                          );
                        }
                        return (
                          <rect
                            key={el.id}
                            x={el.x}
                            y={el.y}
                            width={el.w}
                            height={el.h}
                            fill={el.fill}
                            stroke={el.stroke}
                            strokeWidth={el.strokeWidth}
                            rx={el.radius || 0}
                          />
                        );
                      }
                      if (el.type === 'image' || el.type === 'chart') {
                        return (
                          <rect
                            key={el.id}
                            x={el.x}
                            y={el.y}
                            width={el.w}
                            height={el.h}
                            fill="#e5e7eb"
                            stroke="#d1d5db"
                          />
                        );
                      }
                      return null;
                    })}
                  </svg>
                </div>
              </div>
            </div>
          ))}
        </div>
      </ScrollArea>
    </div>
  );
}
