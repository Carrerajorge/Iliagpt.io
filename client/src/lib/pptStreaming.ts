import { useDeckStore } from "@/components/ppt/store/deckStore";

export type StreamElementType = 'title' | 'bullet' | 'text' | 'chart';

interface StreamState {
  currentSlideId: string | null;
  currentElementId: string | null;
  currentType: StreamElementType | null;
  buffer: string;
  yOffset: number;
  isFirstSlide: boolean;
  editMode: boolean;
}

const ELEMENT_POSITIONS: Record<StreamElementType, { x: number; y: number; fontSize: number; bold?: boolean }> = {
  title: { x: 60, y: 60, fontSize: 36, bold: true }, // Pro Rule: 32-40pt
  bullet: { x: 80, y: 160, fontSize: 18 },           // Pro Rule: 16-18pt
  text: { x: 80, y: 160, fontSize: 16 },             // Pro Rule: 16-18pt
  chart: { x: 150, y: 180, fontSize: 14 }
};

const MARKERS = {
  slide: '::slide::',
  title: '::title::',
  bullet: '::bullet::',
  text: '::text::',
  chart: '::chart::',
  end: '::end'
} as const;

export interface PptStreamParserOptions {
  editInPlace?: boolean;
}

export function createPptStreamParser(options: PptStreamParserOptions = {}) {
  const editInPlace = options.editInPlace ?? true;

  let state: StreamState = {
    currentSlideId: null,
    currentElementId: null,
    currentType: null,
    buffer: '',
    yOffset: 0,
    isFirstSlide: true,
    editMode: editInPlace
  };

  const store = useDeckStore.getState;

  function getOrCreateSlide(): string {
    if (state.editMode && state.isFirstSlide) {
      const currentSlideId = store().activeSlideId;
      state.currentSlideId = currentSlideId;
      state.isFirstSlide = false;
      state.yOffset = 0;
      return currentSlideId;
    }

    store().addSlide();
    const newSlideId = store().activeSlideId;
    state.currentSlideId = newSlideId;
    state.yOffset = 0;
    state.isFirstSlide = false;
    return newSlideId;
  }

  function findOrCreateTitleElement(): string {
    if (!state.currentSlideId) {
      getOrCreateSlide();
    }

    if (state.editMode) {
      const existingTitleId = store().findTitleElement(state.currentSlideId!);
      if (existingTitleId) {
        store().clearElementText(existingTitleId);
        return existingTitleId;
      }
    }

    return createTextElement('title');
  }

  function findOrCreateContentElement(type: StreamElementType, initialText: string = ''): string {
    if (!state.currentSlideId) {
      getOrCreateSlide();
    }

    if (state.editMode) {
      const existingId = store().findOrCreateContentElement(state.currentSlideId!, state.yOffset);
      if (existingId) {
        store().clearElementText(existingId);
        if (initialText) {
          store().appendTextDelta(existingId, initialText);
        }
        state.yOffset += 40;
        return existingId;
      }
    }

    return createTextElement(type, initialText);
  }

  function createTextElement(type: StreamElementType, initialText: string = ''): string {
    if (!state.currentSlideId) {
      getOrCreateSlide();
    }

    const pos = ELEMENT_POSITIONS[type];
    const y = type === 'title' ? pos.y : pos.y + state.yOffset;

    const elementId = store().createStreamingTextElement(
      state.currentSlideId!,
      pos.x,
      y,
      initialText
    );

    if (pos.bold || pos.fontSize !== 24) {
      store().applyTextStyleToDefault(elementId, {
        fontSize: pos.fontSize,
        bold: pos.bold
      });
    }

    state.yOffset += 40; // Tighter spacing for 18pt font
    return elementId;
  }

  function appendToElement(text: string): void {
    if (state.currentElementId) {
      store().appendTextDelta(state.currentElementId, text);
    }
  }

  function finalizeElement(): void {
    state.currentElementId = null;
    state.currentType = null;
  }

  function createChartElement(jsonSpec: string): void {
    if (!state.currentSlideId) {
      getOrCreateSlide();
    }

    try {
      const spec = JSON.parse(jsonSpec);
      store().addChartElement(spec);
      state.yOffset += 320;
    } catch (e) {
      console.error('Failed to parse chart spec:', e);
    }
  }

  function processBuffer(): void {
    let buffer = state.buffer;

    while (buffer.length > 0) {
      if (state.currentType === null) {
        if (buffer.startsWith(MARKERS.slide)) {
          buffer = buffer.slice(MARKERS.slide.length);
          getOrCreateSlide();
          continue;
        }

        if (buffer.startsWith(MARKERS.title)) {
          buffer = buffer.slice(MARKERS.title.length);
          state.currentType = 'title';
          state.currentElementId = findOrCreateTitleElement();
          continue;
        }

        if (buffer.startsWith(MARKERS.bullet)) {
          buffer = buffer.slice(MARKERS.bullet.length);
          state.currentType = 'bullet';
          state.currentElementId = findOrCreateContentElement('bullet', '• ');
          continue;
        }

        if (buffer.startsWith(MARKERS.text)) {
          buffer = buffer.slice(MARKERS.text.length);
          state.currentType = 'text';
          state.currentElementId = findOrCreateContentElement('text');
          continue;
        }

        if (buffer.startsWith(MARKERS.chart)) {
          buffer = buffer.slice(MARKERS.chart.length);
          state.currentType = 'chart';
          continue;
        }

        let foundMarker = false;
        for (const marker of Object.values(MARKERS)) {
          const idx = buffer.indexOf(marker);
          if (idx > 0) {
            buffer = buffer.slice(idx);
            foundMarker = true;
            break;
          } else if (idx === 0) {
            foundMarker = true;
            break;
          }
        }

        if (!foundMarker) {
          const potentialMarkerStart = buffer.lastIndexOf('::');
          if (potentialMarkerStart > 0 && potentialMarkerStart > buffer.length - 20) {
            state.buffer = buffer.slice(potentialMarkerStart);
            return;
          }
          buffer = '';
        }
      } else {
        const endIdx = buffer.indexOf(MARKERS.end);

        if (endIdx === -1) {
          const potentialEndStart = buffer.lastIndexOf('::');
          if (potentialEndStart !== -1 && potentialEndStart > buffer.length - 6) {
            const textToAppend = buffer.slice(0, potentialEndStart);
            if (textToAppend && state.currentType !== 'chart') {
              appendToElement(textToAppend);
            }
            state.buffer = buffer.slice(potentialEndStart);
            return;
          }

          if (state.currentType !== 'chart') {
            appendToElement(buffer);
          } else {
            state.buffer = buffer;
            return;
          }
          buffer = '';
        } else {
          const content = buffer.slice(0, endIdx);

          if (state.currentType === 'chart') {
            createChartElement(content);
          } else if (content) {
            appendToElement(content);
          }

          finalizeElement();
          buffer = buffer.slice(endIdx + MARKERS.end.length);
        }
      }
    }

    state.buffer = buffer;
  }

  return {
    processChunk(chunk: string): void {
      state.buffer += chunk;
      processBuffer();
    },

    reset(): void {
      state = {
        currentSlideId: null,
        currentElementId: null,
        currentType: null,
        buffer: '',
        yOffset: 0,
        isFirstSlide: true,
        editMode: editInPlace
      };
    },

    flush(): void {
      if (state.buffer && state.currentType && state.currentType !== 'chart') {
        appendToElement(state.buffer);
      }
      state.buffer = '';
      finalizeElement();
    },

    getState(): Readonly<StreamState> {
      return { ...state };
    },

    setEditMode(enabled: boolean): void {
      state.editMode = enabled;
    }
  };
}

export type PptStreamParser = ReturnType<typeof createPptStreamParser>;
