import type PptxGenJS from "pptxgenjs";

import { createPptxDocument } from "../pptxRuntime";

export interface PptxContent {
  title: string;
  subtitle?: string;
  author?: string;
  slides: Array<{
    type: "title" | "content" | "table" | "two-column";
    title: string;
    bullets?: string[];
    text?: string;
    tableData?: { headers: string[]; rows: string[][] };
    leftContent?: string[];
    rightContent?: string[];
  }>;
}

const PRIMARY = "2E5090";
const SECONDARY = "58595B";
const ACCENT = "E8532E";
const WHITE = "FFFFFF";
const LIGHT_GRAY = "F2F2F2";

function sanitizeFilename(name: string): string {
  return name.replace(/[^a-zA-Z0-9_\-\s]/g, "").replace(/\s+/g, "_").substring(0, 80);
}

function addFooter(slide: PptxGenJS.Slide, title: string) {
  slide.addText(title, { x: 0.5, y: 6.9, w: 5, h: 0.4, fontSize: 8, color: SECONDARY, fontFace: "Arial" });
  slide.addText([{ text: "Slide ", options: {} }, { text: `${slide.slideNumber}` as string, options: {} }], {
    x: 10, y: 6.9, w: 2.5, h: 0.4, fontSize: 8, color: SECONDARY, fontFace: "Arial", align: "right",
  });
}

export async function generatePptx(content: PptxContent): Promise<{ buffer: Buffer; filename: string; mimeType: string }> {
  const pptx = createPptxDocument();
  pptx.layout = "LAYOUT_WIDE";
  pptx.author = content.author || "IliaGPT";
  pptx.title = content.title;

  // Title slide
  const titleSlide = pptx.addSlide();
  titleSlide.background = { color: PRIMARY };
  titleSlide.addText(content.title, {
    x: 1, y: 1.5, w: 11.33, h: 2.5,
    fontSize: 36, fontFace: "Calibri", bold: true, color: WHITE, align: "center", valign: "middle",
  });
  if (content.subtitle) {
    titleSlide.addText(content.subtitle, {
      x: 1, y: 4.2, w: 11.33, h: 1,
      fontSize: 18, fontFace: "Arial", color: LIGHT_GRAY, align: "center",
    });
  }
  titleSlide.addText(new Date().toLocaleDateString("es-ES", { year: "numeric", month: "long", day: "numeric" }), {
    x: 1, y: 6.2, w: 11.33, h: 0.6,
    fontSize: 12, fontFace: "Arial", color: LIGHT_GRAY, align: "center",
  });

  // Content slides
  for (const slideData of content.slides) {
    const slide = pptx.addSlide();

    // Title bar
    slide.addShape(pptx.ShapeType.rect, { x: 0, y: 0, w: 13.33, h: 1.0, fill: { color: PRIMARY } });
    slide.addText(slideData.title, {
      x: 0.5, y: 0.1, w: 12.33, h: 0.8,
      fontSize: 24, fontFace: "Calibri", bold: true, color: WHITE, valign: "middle",
    });

    switch (slideData.type) {
      case "content": {
        const items = slideData.bullets || (slideData.text ? [slideData.text] : []);
        if (items.length > 0) {
          slide.addText(
            items.map((item) => ({
              text: item,
              options: { bullet: true, fontSize: 16, fontFace: "Arial", color: SECONDARY, lineSpacingMultiple: 1.2 },
            })),
            { x: 0.8, y: 1.3, w: 11.5, h: 5.2, valign: "top" },
          );
        }
        break;
      }

      case "table": {
        const td = slideData.tableData;
        if (td && td.headers.length > 0) {
          const headerRow: PptxGenJS.TableCell[] = td.headers.map((h) => ({
            text: h,
            options: { bold: true, color: WHITE, fill: { color: PRIMARY }, fontSize: 12, fontFace: "Arial", align: "center" as const },
          }));
          const bodyRows: PptxGenJS.TableCell[][] = td.rows.map((row, idx) =>
            row.map((cell) => ({
              text: cell,
              options: { fontSize: 11, fontFace: "Arial", color: SECONDARY, fill: { color: idx % 2 === 0 ? LIGHT_GRAY : WHITE } },
            })),
          );
          slide.addTable([headerRow, ...bodyRows], {
            x: 0.5, y: 1.4, w: 12.33,
            border: { type: "solid", pt: 0.5, color: "CCCCCC" },
            colW: Array(td.headers.length).fill(12.33 / td.headers.length),
            autoPage: true,
          });
        }
        break;
      }

      case "two-column": {
        const left = slideData.leftContent || [];
        const right = slideData.rightContent || [];
        if (left.length > 0) {
          slide.addText(
            left.map((item) => ({
              text: item,
              options: { bullet: true, fontSize: 14, fontFace: "Arial", color: SECONDARY, lineSpacingMultiple: 1.2 },
            })),
            { x: 0.5, y: 1.3, w: 5.8, h: 5.2, valign: "top" },
          );
        }
        // Divider
        slide.addShape(pptx.ShapeType.line, { x: 6.66, y: 1.3, w: 0, h: 5.0, line: { color: "CCCCCC", width: 1 } });
        if (right.length > 0) {
          slide.addText(
            right.map((item) => ({
              text: item,
              options: { bullet: true, fontSize: 14, fontFace: "Arial", color: SECONDARY, lineSpacingMultiple: 1.2 },
            })),
            { x: 7.0, y: 1.3, w: 5.8, h: 5.2, valign: "top" },
          );
        }
        break;
      }

      default: {
        // Fallback: treat as content slide with text
        if (slideData.text) {
          slide.addText(slideData.text, {
            x: 0.8, y: 1.3, w: 11.5, h: 5.2,
            fontSize: 16, fontFace: "Arial", color: SECONDARY, valign: "top",
          });
        }
        break;
      }
    }

    addFooter(slide, content.title);
  }

  const output = await pptx.write({ outputType: "nodebuffer" });
  const buffer = Buffer.from(output as ArrayBuffer);
  const filename = `${sanitizeFilename(content.title)}.pptx`;

  return {
    buffer,
    filename,
    mimeType: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  };
}
