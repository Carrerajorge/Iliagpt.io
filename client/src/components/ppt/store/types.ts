export type SlideSize = { w: number; h: number };

export type TextStyle = {
  fontFamily: string;
  fontSize: number;
  color: string;
  bold?: boolean;
  italic?: boolean;
  underline?: boolean;
  strike?: boolean;
};

export type DeltaOp = {
  insert: string;
  attributes?: {
    bold?: boolean;
    italic?: boolean;
    underline?: boolean;
    strike?: boolean;
    color?: string;
    link?: string;
    header?: 1 | 2 | 3;
    list?: "bullet" | "ordered";
  };
};

export type Delta = { ops: DeltaOp[] };

export type BaseElement = {
  id: string;
  type: "text" | "image" | "shape" | "chart";
  x: number;
  y: number;
  w: number;
  h: number;
  rotation?: number;
  opacity?: number;
  zIndex?: number;
  locked?: boolean;
};

export type TextElement = BaseElement & {
  type: "text";
  delta: Delta;
  defaultTextStyle: TextStyle;
};

export type ImageElement = BaseElement & {
  type: "image";
  src: string;
  mime?: string;
  naturalW?: number;
  naturalH?: number;
};

export type ShapeElement = BaseElement & {
  type: "shape";
  shapeType: "rect" | "ellipse";
  fill: string;
  stroke: string;
  strokeWidth: number;
  radius?: number;
};

export type ChartElement = BaseElement & {
  type: "chart";
  spec: any;
  svg?: string;
  src?: string;
};

export type ElementAny = TextElement | ImageElement | ShapeElement | ChartElement;

export type Slide = {
  id: string;
  size: SlideSize;
  background: { color: string };
  elements: ElementAny[];
};

export type Deck = {
  title: string;
  slides: Slide[];
};

export type Selection = { slideId: string; elementId: string } | null;
