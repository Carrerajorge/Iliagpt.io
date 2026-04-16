import { create } from "zustand";
import { nanoid } from "nanoid";
import type { Deck, ElementAny, Slide, TextElement, TextStyle, Selection, Delta, ShapeElement, ImageElement, ChartElement } from "./types";
import { createHistory, pushHistory, redoHistory, undoHistory, canUndo, canRedo, type HistoryState } from "./history";

function deepCloneElement<T extends ElementAny>(el: T): T {
  if (el.type === 'text') {
    return {
      ...el,
      delta: { ops: el.delta.ops.map(op => ({ ...op, attributes: op.attributes ? { ...op.attributes } : undefined })) },
      defaultTextStyle: { ...el.defaultTextStyle }
    } as T;
  }
  return { ...el } as T;
}

function deepCloneSlide(slide: Slide): Slide {
  return {
    ...slide,
    size: { ...slide.size },
    background: { ...slide.background },
    elements: slide.elements.map(el => deepCloneElement(el))
  };
}

function deepCloneDeck(deck: Deck): Deck {
  return {
    ...deck,
    slides: deck.slides.map(s => deepCloneSlide(s))
  };
}

function defaultDeck(): Deck {
  const slide: Slide = {
    id: nanoid(),
    size: { w: 1280, h: 720 },
    background: { color: "#FFFFFF" },
    elements: [
      {
        id: nanoid(),
        type: "text",
        x: 80,
        y: 80,
        w: 820,
        h: 140,
        zIndex: 1,
        delta: { ops: [{ insert: "Título de la diapositiva\n" }] },
        defaultTextStyle: {
          fontFamily: "Inter",
          fontSize: 44,
          color: "#111111",
          bold: true
        }
      } as TextElement
    ]
  };

  return {
    title: "Nueva Presentación",
    slides: [slide]
  };
}

export type EditorMode = "manual" | "ai";
export type RibbonTab = "Home" | "Insert" | "Layout" | "AI" | "Inicio" | "Insertar" | "Dibujar" | "Diseño" | "Transiciones" | "Animaciones" | "Presentación con diapositivas" | "Grabar" | "Revisar" | "Vista";

type DeckState = {
  history: HistoryState<Deck>;
  selection: Selection;
  activeSlideId: string;
  activeTab: RibbonTab;
  editorMode: EditorMode;
  streaming: { active: boolean; requestId?: string };
  zoom: number;

  setTitle(title: string): void;
  setActiveTab(tab: RibbonTab): void;
  setEditorMode(mode: EditorMode): void;
  setZoom(zoom: number): void;

  undo(): void;
  redo(): void;

  select(selection: Selection): void;
  clearSelection(): void;
  addSlide(): void;
  deleteSlide(slideId: string): void;
  duplicateSlide(slideId: string): void;
  setActiveSlide(slideId: string): void;
  reorderSlides(fromIndex: number, toIndex: number): void;
  setSlideBackground(slideId: string, color: string): void;

  addElement(el: ElementAny): void;
  updateElement(elementId: string, patch: Partial<ElementAny>): void;
  bringToFront(elementId: string): void;
  sendToBack(elementId: string): void;
  bringForward(elementId: string): void;
  sendBackward(elementId: string): void;
  deleteElement(elementId: string): void;

  updateTextDelta(elementId: string, delta: Delta): void;
  appendTextDelta(elementId: string, appendText: string): void;
  applyTextStyleToDefault(elementId: string, patch: Partial<TextStyle>): void;

  addTextElement(): void;
  createStreamingTextElement(slideId: string, x: number, y: number, initialText?: string): string;
  addShapeElement(shapeType: "rect" | "ellipse"): void;
  addImageElement(src: string, naturalW?: number, naturalH?: number): void;
  addChartElement(spec: any): void;

  setStreaming(active: boolean, requestId?: string): void;
  
  findTitleElement(slideId?: string): string | null;
  findOrCreateContentElement(slideId: string, yOffset: number): string;
  replaceElementText(elementId: string, newText: string): void;
  clearElementText(elementId: string): void;
  loadDeck(deck: Deck): void;
  resetToDefault(): void;
};

export const selectDeck = (state: DeckState): Deck => state.history.present;
export const selectActiveSlide = (state: DeckState): Slide => {
  const deck = state.history.present;
  return deck.slides.find((s) => s.id === state.activeSlideId) ?? deck.slides[0];
};
export const selectSelectedElement = (state: DeckState): ElementAny | null => {
  const sel = state.selection;
  if (!sel) return null;
  const deck = state.history.present;
  const slide = deck.slides.find((s) => s.id === sel.slideId);
  return slide?.elements.find((e) => e.id === sel.elementId) ?? null;
};
export const selectCanUndo = (state: DeckState): boolean => canUndo(state.history);
export const selectCanRedo = (state: DeckState): boolean => canRedo(state.history);

export const useDeckStore = create<DeckState>((set, get) => {
  const initial = defaultDeck();
  const activeSlideId = initial.slides[0].id;

  return {
    history: createHistory(initial),
    selection: null,
    activeSlideId,
    activeTab: "Inicio",
    editorMode: "manual",
    streaming: { active: false },
    zoom: 1,

    setTitle(title) {
      const deck = deepCloneDeck(get().history.present);
      deck.title = title;
      set({ history: pushHistory(get().history, deck) });
    },

    setActiveTab(tab) {
      set({ activeTab: tab });
    },

    setEditorMode(mode) {
      set({ editorMode: mode });
    },

    setZoom(zoom) {
      set({ zoom: Math.max(0.25, Math.min(2, zoom)) });
    },

    undo() {
      const newHistory = undoHistory(get().history);
      const deck = newHistory.present;
      const currentActiveSlideId = get().activeSlideId;
      const slideExists = deck.slides.some(s => s.id === currentActiveSlideId);
      set({ 
        history: newHistory,
        activeSlideId: slideExists ? currentActiveSlideId : deck.slides[0].id,
        selection: null
      });
    },

    redo() {
      const newHistory = redoHistory(get().history);
      const deck = newHistory.present;
      const currentActiveSlideId = get().activeSlideId;
      const slideExists = deck.slides.some(s => s.id === currentActiveSlideId);
      set({ 
        history: newHistory,
        activeSlideId: slideExists ? currentActiveSlideId : deck.slides[0].id,
        selection: null
      });
    },

    select(selection) {
      set({ selection });
    },

    clearSelection() {
      set({ selection: null });
    },

    addSlide() {
      const deck = deepCloneDeck(get().history.present);
      const slide: Slide = {
        id: nanoid(),
        size: { w: 1280, h: 720 },
        background: { color: "#FFFFFF" },
        elements: []
      };
      deck.slides.push(slide);

      set({
        history: pushHistory(get().history, deck),
        activeSlideId: slide.id,
        selection: null
      });
    },

    deleteSlide(slideId) {
      const deck = deepCloneDeck(get().history.present);
      if (deck.slides.length <= 1) return;
      
      const idx = deck.slides.findIndex(s => s.id === slideId);
      deck.slides = deck.slides.filter(s => s.id !== slideId);
      const newActiveId = get().activeSlideId === slideId 
        ? deck.slides[Math.max(0, idx - 1)].id 
        : get().activeSlideId;
      
      set({
        history: pushHistory(get().history, deck),
        activeSlideId: newActiveId,
        selection: null
      });
    },

    duplicateSlide(slideId) {
      const deck = deepCloneDeck(get().history.present);
      const slideIdx = deck.slides.findIndex(s => s.id === slideId);
      if (slideIdx === -1) return;
      
      const slide = deck.slides[slideIdx];
      const newSlide: Slide = {
        ...deepCloneSlide(slide),
        id: nanoid(),
        elements: slide.elements.map(el => ({
          ...deepCloneElement(el),
          id: nanoid()
        }))
      };

      deck.slides.splice(slideIdx + 1, 0, newSlide);

      set({
        history: pushHistory(get().history, deck),
        activeSlideId: newSlide.id,
        selection: null
      });
    },

    setActiveSlide(slideId) {
      set({ activeSlideId: slideId, selection: null });
    },

    reorderSlides(fromIndex, toIndex) {
      const deck = deepCloneDeck(get().history.present);
      const [removed] = deck.slides.splice(fromIndex, 1);
      deck.slides.splice(toIndex, 0, removed);
      set({ history: pushHistory(get().history, deck) });
    },

    setSlideBackground(slideId, color) {
      const deck = deepCloneDeck(get().history.present);
      const slide = deck.slides.find(s => s.id === slideId);
      if (slide) {
        slide.background = { color };
      }
      set({ history: pushHistory(get().history, deck) });
    },

    addElement(el) {
      const deck = deepCloneDeck(get().history.present);
      const slideId = get().activeSlideId;
      const slide = deck.slides.find(s => s.id === slideId);
      if (slide) {
        slide.elements.push(deepCloneElement(el));
      }
      set({ 
        history: pushHistory(get().history, deck),
        selection: { slideId, elementId: el.id }
      });
    },

    updateElement(elementId, patch) {
      const deck = deepCloneDeck(get().history.present);
      const slideId = get().activeSlideId;
      const slide = deck.slides.find(s => s.id === slideId);
      if (slide) {
        const elIdx = slide.elements.findIndex(e => e.id === elementId);
        if (elIdx !== -1) {
          slide.elements[elIdx] = { ...slide.elements[elIdx], ...patch } as ElementAny;
        }
      }
      set({ history: pushHistory(get().history, deck) });
    },

    bringToFront(elementId) {
      const deck = get().history.present;
      const slide = deck.slides.find((s) => s.id === get().activeSlideId);
      if (!slide) return;
      const maxZ = Math.max(0, ...slide.elements.map((e) => e.zIndex ?? 0));
      get().updateElement(elementId, { zIndex: maxZ + 1 });
    },

    sendToBack(elementId) {
      const deck = get().history.present;
      const slide = deck.slides.find((s) => s.id === get().activeSlideId);
      if (!slide) return;
      const minZ = Math.min(0, ...slide.elements.map((e) => e.zIndex ?? 0));
      get().updateElement(elementId, { zIndex: minZ - 1 });
    },

    bringForward(elementId) {
      const slide = selectActiveSlide(get());
      const sorted = [...slide.elements].sort((a, b) => (a.zIndex ?? 0) - (b.zIndex ?? 0));
      const idx = sorted.findIndex(e => e.id === elementId);
      if (idx < sorted.length - 1) {
        const nextZ = sorted[idx + 1].zIndex ?? 0;
        get().updateElement(elementId, { zIndex: nextZ + 1 });
      }
    },

    sendBackward(elementId) {
      const slide = selectActiveSlide(get());
      const sorted = [...slide.elements].sort((a, b) => (a.zIndex ?? 0) - (b.zIndex ?? 0));
      const idx = sorted.findIndex(e => e.id === elementId);
      if (idx > 0) {
        const prevZ = sorted[idx - 1].zIndex ?? 0;
        get().updateElement(elementId, { zIndex: prevZ - 1 });
      }
    },

    deleteElement(elementId) {
      const deck = deepCloneDeck(get().history.present);
      const slideId = get().activeSlideId;
      const slide = deck.slides.find(s => s.id === slideId);
      if (slide) {
        slide.elements = slide.elements.filter(e => e.id !== elementId);
      }
      set({ 
        history: pushHistory(get().history, deck), 
        selection: null 
      });
    },

    updateTextDelta(elementId, delta) {
      const deck = deepCloneDeck(get().history.present);
      const slideId = get().activeSlideId;
      const slide = deck.slides.find(s => s.id === slideId);
      if (slide) {
        const el = slide.elements.find(e => e.id === elementId);
        if (el && el.type === 'text') {
          (el as TextElement).delta = delta;
        }
      }
      set({ history: pushHistory(get().history, deck) });
    },

    appendTextDelta(elementId, appendText) {
      const deck = deepCloneDeck(get().history.present);
      const slideId = get().activeSlideId;
      const slide = deck.slides.find(s => s.id === slideId);
      if (slide) {
        const element = slide.elements.find(e => e.id === elementId) as TextElement | undefined;
        if (element && element.type === 'text') {
          const ops = element.delta.ops || [];
          if (ops.length > 0) {
            const lastOp = ops[ops.length - 1];
            if (typeof lastOp.insert === 'string' && lastOp.insert.endsWith('\n')) {
              ops[ops.length - 1] = { insert: lastOp.insert.slice(0, -1) + appendText + '\n' };
            } else if (typeof lastOp.insert === 'string') {
              ops[ops.length - 1] = { insert: lastOp.insert + appendText };
            }
          }
        }
      }
      set({ history: { ...get().history, present: deck } });
    },

    applyTextStyleToDefault(elementId, patch) {
      const deck = deepCloneDeck(get().history.present);
      const slideId = get().activeSlideId;
      const slide = deck.slides.find(s => s.id === slideId);
      if (slide) {
        const el = slide.elements.find(e => e.id === elementId);
        if (el && el.type === 'text') {
          (el as TextElement).defaultTextStyle = { ...(el as TextElement).defaultTextStyle, ...patch };
        }
      }
      set({ history: pushHistory(get().history, deck) });
    },

    addTextElement() {
      const el: TextElement = {
        id: nanoid(),
        type: "text",
        x: 100,
        y: 200,
        w: 400,
        h: 100,
        zIndex: Date.now(),
        delta: { ops: [{ insert: "Texto nuevo\n" }] },
        defaultTextStyle: {
          fontFamily: "Inter",
          fontSize: 24,
          color: "#111111"
        }
      };
      get().addElement(el);
    },

    createStreamingTextElement(slideId, x, y, initialText = '') {
      const previousActiveSlide = get().activeSlideId;
      if (slideId !== previousActiveSlide) {
        set({ activeSlideId: slideId });
      }
      const el: TextElement = {
        id: nanoid(),
        type: "text",
        x,
        y,
        w: 600,
        h: 80,
        zIndex: Date.now(),
        delta: { ops: [{ insert: initialText + '\n' }] },
        defaultTextStyle: {
          fontFamily: "Inter",
          fontSize: 24,
          color: "#111111"
        }
      };
      get().addElement(el);
      return el.id;
    },

    addShapeElement(shapeType) {
      const el: ShapeElement = {
        id: nanoid(),
        type: "shape",
        shapeType,
        x: 200,
        y: 200,
        w: 200,
        h: shapeType === "ellipse" ? 200 : 150,
        zIndex: Date.now(),
        fill: "#4F46E5",
        stroke: "#3730A3",
        strokeWidth: 2
      };
      get().addElement(el);
    },

    addImageElement(src, naturalW, naturalH) {
      const w = naturalW ? Math.min(400, naturalW) : 400;
      const h = naturalH ? (w / naturalW!) * naturalH : 300;
      const el: ImageElement = {
        id: nanoid(),
        type: "image",
        x: 200,
        y: 150,
        w,
        h,
        zIndex: Date.now(),
        src,
        naturalW,
        naturalH
      };
      get().addElement(el);
    },

    addChartElement(spec) {
      const el: ChartElement = {
        id: nanoid(),
        type: "chart",
        x: 200,
        y: 200,
        w: 400,
        h: 300,
        zIndex: Date.now(),
        spec
      };
      get().addElement(el);
    },

    setStreaming(active, requestId) {
      set({ streaming: { active, requestId } });
    },

    findTitleElement(slideId) {
      const deck = get().history.present;
      const targetSlideId = slideId || get().activeSlideId;
      const slide = deck.slides.find(s => s.id === targetSlideId);
      if (!slide) return null;
      
      const titleElement = slide.elements.find(el => {
        if (el.type !== 'text') return false;
        const textEl = el as TextElement;
        return textEl.y < 150 && textEl.defaultTextStyle.fontSize >= 32;
      });
      
      return titleElement?.id || null;
    },

    findOrCreateContentElement(slideId, yOffset) {
      const deck = get().history.present;
      const slide = deck.slides.find(s => s.id === slideId);
      if (!slide) {
        return get().createStreamingTextElement(slideId, 80, 200 + yOffset);
      }
      
      const existingContent = slide.elements.find(el => {
        if (el.type !== 'text') return false;
        const textEl = el as TextElement;
        return textEl.y >= 150 && Math.abs(textEl.y - (200 + yOffset)) < 80;
      });
      
      if (existingContent) {
        return existingContent.id;
      }
      
      return get().createStreamingTextElement(slideId, 80, 200 + yOffset);
    },

    replaceElementText(elementId, newText) {
      const deck = deepCloneDeck(get().history.present);
      for (const slide of deck.slides) {
        const element = slide.elements.find(e => e.id === elementId);
        if (element && element.type === 'text') {
          (element as TextElement).delta = { ops: [{ insert: newText + '\n' }] };
          break;
        }
      }
      set({ history: { ...get().history, present: deck } });
    },

    clearElementText(elementId) {
      const deck = deepCloneDeck(get().history.present);
      for (const slide of deck.slides) {
        const element = slide.elements.find(e => e.id === elementId);
        if (element && element.type === 'text') {
          (element as TextElement).delta = { ops: [{ insert: '\n' }] };
          break;
        }
      }
      set({ history: { ...get().history, present: deck } });
    },

    loadDeck(deck) {
      const clonedDeck = deepCloneDeck(deck);
      set({
        history: createHistory(clonedDeck),
        activeSlideId: clonedDeck.slides[0]?.id || '',
        selection: null
      });
    },

    resetToDefault() {
      const newDeck = defaultDeck();
      set({
        history: createHistory(newDeck),
        activeSlideId: newDeck.slides[0].id,
        selection: null
      });
    }
  };
});
