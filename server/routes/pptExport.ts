import { Router } from 'express';
import pptxgen from 'pptxgenjs';
import {
  sanitizeFilename,
  safeContentDisposition,
  validateBufferSize,
  logDocumentEvent,
  applyDocumentSecurityHeaders,
  sanitizeErrorMessage,
  docConcurrencyLimiter,
} from "../services/documentSecurity";
import { CORPORATE_PPT_DESIGN_SYSTEM, CORPORATE_PPT_MASTER_NAME, defineCorporateMaster } from "../services/documentGeneration";

export const pptExportRouter = Router();

// Security limits for PPT export
const PPT_EXPORT_MAX_SLIDES = 200;
const PPT_EXPORT_MAX_ELEMENTS_PER_SLIDE = 100;
const PPT_EXPORT_MAX_TEXT_LENGTH = 50_000;
const PPT_EXPORT_MAX_IMAGE_DATA_SIZE = 10 * 1024 * 1024; // 10MB per image
const PPT_EXPORT_MAX_SVG_SIZE = 5 * 1024 * 1024; // 5MB per SVG

const IS_PRODUCTION = process.env.NODE_ENV === "production";

interface TextStyle {
  fontFamily?: string;
  fontSize?: number;
  color?: string;
  bold?: boolean;
  italic?: boolean;
  underline?: boolean;
}

interface DeltaOp {
  insert: string;
  attributes?: Record<string, any>;
}

interface Delta {
  ops: DeltaOp[];
}

interface BaseElement {
  id: string;
  type: string;
  x: number;
  y: number;
  w: number;
  h: number;
  rotation?: number;
  opacity?: number;
  zIndex?: number;
}

interface TextElement extends BaseElement {
  type: 'text';
  delta: Delta;
  defaultTextStyle: TextStyle;
}

interface ShapeElement extends BaseElement {
  type: 'shape';
  shapeType: 'rect' | 'ellipse';
  fill: string;
  stroke: string;
  strokeWidth: number;
  radius?: number;
}

interface ImageElement extends BaseElement {
  type: 'image';
  src: string;
}

interface ChartElement extends BaseElement {
  type: 'chart';
  svg?: string;
  src?: string;
}

type ElementAny = TextElement | ShapeElement | ImageElement | ChartElement;

interface Slide {
  id: string;
  size: { w: number; h: number };
  background: { color: string };
  elements: ElementAny[];
}

interface Deck {
  title: string;
  slides: Slide[];
}

function pxToIn(px: number): number {
  return px / 96;
}

function normalizeHex(hex: string): string {
  const h = String(hex || '').trim();
  if (!h) return '000000';
  return h.replace('#', '').toUpperCase();
}

function deltaToPlainText(delta: Delta): string {
  return delta.ops.map(op => op.insert).join('');
}

function svgToDataUri(svg: string): string {
  const base64 = Buffer.from(svg).toString('base64');
  return `data:image/svg+xml;base64,${base64}`;
}

pptExportRouter.post('/export', async (req, res) => {
  const startTime = Date.now();

  try {
    const deck: Deck = req.body;

    // Input validation
    if (!deck || typeof deck !== "object") {
      return res.status(400).json({ error: "Invalid deck data" });
    }

    const slides = deck.slides ?? [];
    if (slides.length > PPT_EXPORT_MAX_SLIDES) {
      return res.status(400).json({
        error: `Too many slides: ${slides.length}. Maximum is ${PPT_EXPORT_MAX_SLIDES}`,
      });
    }

    // Acquire concurrency slot
    const acquired = await docConcurrencyLimiter.acquire();
    if (!acquired) {
      logDocumentEvent({ timestamp: new Date().toISOString(), event: "rate_limit_exceeded", docType: "pptx-export" });
      return res.status(429).json({ error: "Too many concurrent generations. Please try again." });
    }

    logDocumentEvent({ timestamp: new Date().toISOString(), event: "generate_start", docType: "pptx-export" });

    try {
      const pptx = new pptxgen();
      pptx.layout = 'LAYOUT_WIDE';
      defineCorporateMaster(pptx);
      // Security: sanitize title for metadata and strip control characters
      const safeTitle = (deck.title || 'Presentation')
        .replace(/[\x00-\x1F\x7F]/g, "")
        .substring(0, 500);
      pptx.title = safeTitle;
      pptx.author = "IliaGPT";
      pptx.company = "";
      pptx.subject = "";

      for (const s of slides) {
        const slide = pptx.addSlide({ masterName: CORPORATE_PPT_MASTER_NAME });

        if (s.background?.color) {
          slide.background = { color: normalizeHex(s.background.color) };
        } else {
          slide.background = { color: CORPORATE_PPT_DESIGN_SYSTEM.palette.bg };
        }

        const elements = [...(s.elements ?? [])]
          .slice(0, PPT_EXPORT_MAX_ELEMENTS_PER_SLIDE)
          .sort((a, b) => (a.zIndex ?? 0) - (b.zIndex ?? 0));

        for (const el of elements) {
          // Sanitize numeric values to prevent NaN/Infinity
          const x = pxToIn(Number.isFinite(el.x) ? el.x : 0);
          const y = pxToIn(Number.isFinite(el.y) ? el.y : 0);
          const w = pxToIn(Number.isFinite(el.w) && el.w > 0 ? el.w : 100);
          const h = pxToIn(Number.isFinite(el.h) && el.h > 0 ? el.h : 40);

          if (el.type === 'text') {
            const textEl = el as TextElement;
            // Security: truncate text to prevent memory exhaustion
            const plain = deltaToPlainText(textEl.delta).substring(0, PPT_EXPORT_MAX_TEXT_LENGTH);
            const style = textEl.defaultTextStyle;

            slide.addText(plain, {
              x,
              y,
              w,
              h,
              fontFace: style?.fontFamily || CORPORATE_PPT_DESIGN_SYSTEM.typography.body,
              fontSize: Math.min(Math.max(style?.fontSize ?? CORPORATE_PPT_DESIGN_SYSTEM.sizes.body, 1), 200),
              color: normalizeHex(style?.color ?? CORPORATE_PPT_DESIGN_SYSTEM.palette.text),
              bold: !!style?.bold,
              italic: !!style?.italic,
              underline: style?.underline ? { style: 'sng' } : undefined,
              rotate: el.rotation ?? 0
            });
            continue;
          }

          if (el.type === 'shape') {
            const shapeEl = el as ShapeElement;
            const shapeType = shapeEl.shapeType === 'ellipse' ? 'ellipse' : 'rect';

            slide.addShape(shapeType, {
              x,
              y,
              w,
              h,
              fill: { color: normalizeHex(shapeEl.fill ?? '#FFFFFF') },
              line: {
                color: normalizeHex(shapeEl.stroke ?? '#000000'),
                width: Math.min(Math.max(shapeEl.strokeWidth ?? 1, 0), 50)
              },
              rotate: el.rotation ?? 0
            });
            continue;
          }

          if (el.type === 'image') {
            const imgEl = el as ImageElement;
            // Security: validate image data size and only allow data: URIs
            if (imgEl.src && imgEl.src.startsWith('data:') && imgEl.src.length <= PPT_EXPORT_MAX_IMAGE_DATA_SIZE) {
              slide.addImage({
                data: imgEl.src,
                x,
                y,
                w,
                h,
                rotate: el.rotation ?? 0
              });
            }
            continue;
          }

          if (el.type === 'chart') {
            const chartEl = el as ChartElement;
            // Security: validate SVG size
            if (chartEl.svg && chartEl.svg.length <= PPT_EXPORT_MAX_SVG_SIZE) {
              const uri = svgToDataUri(chartEl.svg);
              slide.addImage({ data: uri, x, y, w, h, rotate: el.rotation ?? 0 });
            } else if (chartEl.src && chartEl.src.startsWith('data:') && chartEl.src.length <= PPT_EXPORT_MAX_IMAGE_DATA_SIZE) {
              slide.addImage({ data: chartEl.src, x, y, w, h, rotate: el.rotation ?? 0 });
            }
            continue;
          }
        }
      }

      const buffer = await pptx.write({ outputType: 'nodebuffer' }) as Buffer;

      // Validate generated buffer
      const bufferCheck = validateBufferSize(buffer, "pptx");
      if (!bufferCheck.valid) {
        return res.status(500).json({ error: bufferCheck.error });
      }

      logDocumentEvent({
        timestamp: new Date().toISOString(),
        event: "generate_success",
        docType: "pptx-export",
        durationMs: Date.now() - startTime,
        details: { bufferSize: buffer.length, slideCount: slides.length },
      });

      // Security: use safe Content-Disposition header
      applyDocumentSecurityHeaders(res);
      const filename = sanitizeFilename(safeTitle, ".pptx");
      res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.presentationml.presentation');
      res.setHeader('Content-Disposition', safeContentDisposition(filename));
      res.setHeader('Content-Length', buffer.length);
      res.send(buffer);
    } finally {
      docConcurrencyLimiter.release();
    }
  } catch (error: any) {
    console.error('PPTX export error:', error);
    logDocumentEvent({
      timestamp: new Date().toISOString(),
      event: "generate_failure",
      docType: "pptx-export",
      durationMs: Date.now() - startTime,
      details: { error: sanitizeErrorMessage(error) },
    });
    res.status(500).json({
      error: IS_PRODUCTION ? "Failed to export PPTX" : sanitizeErrorMessage(error),
    });
  }
});
