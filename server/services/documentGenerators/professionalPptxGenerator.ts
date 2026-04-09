import PptxGenJS from "pptxgenjs";

// ── Public interfaces ────────────────────────────────────────────────

export interface PptxSlide {
  type: "title" | "content" | "section" | "table" | "two-column" | "closing";
  title: string;
  subtitle?: string;
  bullets?: string[];
  text?: string;
  tableData?: { headers: string[]; rows: string[][] };
  leftBullets?: string[];
  rightBullets?: string[];
  notes?: string;
}

export interface PptxRequest {
  title: string;
  subtitle?: string;
  author?: string;
  theme?: string;
  slides: PptxSlide[];
}

export interface PptxResult {
  buffer: Buffer;
  filename: string;
  mimeType: string;
  previewHtml: string;
  slideCount: number;
}

// ── Theme system ─────────────────────────────────────────────────────

interface Theme {
  primary: string;
  accent: string;
  textLight: string;
  textDark: string;
  bgLight: string;
  bgMuted: string;
}

const THEMES: Record<string, Theme> = {
  "corporate-blue": { primary: "#1e3a5f", accent: "#3b82f6", textLight: "#ffffff", textDark: "#1e293b", bgLight: "#ffffff", bgMuted: "#f0f4f8" },
  "executive-dark":  { primary: "#1a1a2e", accent: "#e94560", textLight: "#ffffff", textDark: "#1a1a2e", bgLight: "#ffffff", bgMuted: "#f1f0f5" },
  "nature-green":    { primary: "#14532d", accent: "#22c55e", textLight: "#ffffff", textDark: "#14532d", bgLight: "#ffffff", bgMuted: "#ecfdf5" },
  "warm-amber":      { primary: "#78350f", accent: "#d97706", textLight: "#ffffff", textDark: "#78350f", bgLight: "#ffffff", bgMuted: "#fef3c7" },
  "minimal-gray":    { primary: "#1f2937", accent: "#6b7280", textLight: "#ffffff", textDark: "#1f2937", bgLight: "#ffffff", bgMuted: "#f3f4f6" },
};

function resolveTheme(name?: string): Theme {
  return THEMES[name ?? ""] ?? THEMES["corporate-blue"];
}

/** Strip leading '#' for PptxGenJS (it expects bare hex). */
function hex(color: string): string {
  return color.replace(/^#/, "");
}

function sanitizeFilename(name: string): string {
  return name.replace(/[^a-zA-Z0-9\u00C0-\u024F _-]/g, "").replace(/\s+/g, "_").slice(0, 80);
}

function dateString(): string {
  return new Date().toLocaleDateString("es-ES", { year: "numeric", month: "long", day: "numeric" });
}

// ── PPTX generation ──────────────────────────────────────────────────

function addFooter(slide: PptxGenJS.Slide, title: string, t: Theme, slideNum: number) {
  slide.addText(title, {
    x: 0.5, y: 6.85, w: 8, h: 0.4,
    fontSize: 8, color: hex(t.accent), fontFace: "Arial",
  });
  slide.addText(String(slideNum), {
    x: 11, y: 6.85, w: 1.83, h: 0.4,
    fontSize: 8, color: hex(t.accent), fontFace: "Arial", align: "right",
  });
}

function buildSlide(pptx: PptxGenJS, s: PptxSlide, t: Theme, presTitle: string, slideNum: number) {
  const slide = pptx.addSlide();
  if (s.notes) slide.addNotes(s.notes);

  switch (s.type) {
    case "title": {
      slide.background = { color: hex(t.primary) };
      slide.addText(s.title, {
        x: 1, y: 1.2, w: 11.33, h: 2.5,
        fontSize: 36, fontFace: "Calibri", bold: true, color: hex(t.textLight), align: "center", valign: "middle",
      });
      if (s.subtitle) {
        slide.addText(s.subtitle, {
          x: 1, y: 3.9, w: 11.33, h: 1,
          fontSize: 18, fontFace: "Arial", color: hex(t.bgMuted), align: "center",
        });
      }
      slide.addText(dateString(), {
        x: 8, y: 6.2, w: 4.83, h: 0.6,
        fontSize: 12, fontFace: "Arial", color: hex(t.bgMuted), align: "right",
      });
      break;
    }

    case "section": {
      slide.background = { color: hex(t.accent) };
      slide.addText(s.title, {
        x: 1, y: 2, w: 11.33, h: 3,
        fontSize: 32, fontFace: "Calibri", bold: true, color: hex(t.textLight), align: "center", valign: "middle",
      });
      if (s.subtitle) {
        slide.addText(s.subtitle, {
          x: 1, y: 5, w: 11.33, h: 1,
          fontSize: 16, fontFace: "Arial", color: hex(t.textLight), align: "center",
        });
      }
      break;
    }

    case "content": {
      slide.addShape(pptx.ShapeType.rect, { x: 0, y: 0, w: 13.33, h: 0.8, fill: { color: hex(t.primary) } });
      slide.addText(s.title, {
        x: 0.5, y: 0.05, w: 12.33, h: 0.7,
        fontSize: 22, fontFace: "Calibri", bold: true, color: hex(t.textLight), valign: "middle",
      });
      const items = s.bullets ?? (s.text ? [s.text] : []);
      if (items.length) {
        slide.addText(
          items.map((item) => ({
            text: item,
            options: { bullet: true, fontSize: 16, fontFace: "Arial", color: hex(t.textDark), lineSpacingMultiple: 1.3 },
          })),
          { x: 0.8, y: 1.1, w: 11.5, h: 5.4, valign: "top" },
        );
      }
      addFooter(slide, presTitle, t, slideNum);
      break;
    }

    case "table": {
      slide.addShape(pptx.ShapeType.rect, { x: 0, y: 0, w: 13.33, h: 0.8, fill: { color: hex(t.primary) } });
      slide.addText(s.title, {
        x: 0.5, y: 0.05, w: 12.33, h: 0.7,
        fontSize: 22, fontFace: "Calibri", bold: true, color: hex(t.textLight), valign: "middle",
      });
      const td = s.tableData;
      if (td && td.headers.length) {
        const headerRow: PptxGenJS.TableCell[] = td.headers.map((h) => ({
          text: h,
          options: { bold: true, color: hex(t.textLight), fill: { color: hex(t.primary) }, fontSize: 12, fontFace: "Arial", align: "center" as const },
        }));
        const bodyRows: PptxGenJS.TableCell[][] = td.rows.map((row, idx) =>
          row.map((cell) => ({
            text: cell,
            options: { fontSize: 11, fontFace: "Arial", color: hex(t.textDark), fill: { color: idx % 2 === 0 ? hex(t.bgMuted) : hex(t.bgLight) } },
          })),
        );
        const colW = Array(td.headers.length).fill(12.33 / td.headers.length);
        slide.addTable([headerRow, ...bodyRows], {
          x: 0.5, y: 1.1, w: 12.33, colW,
          border: { type: "solid", pt: 0.5, color: "CCCCCC" },
          autoPage: true,
        });
      }
      addFooter(slide, presTitle, t, slideNum);
      break;
    }

    case "two-column": {
      slide.addShape(pptx.ShapeType.rect, { x: 0, y: 0, w: 13.33, h: 0.8, fill: { color: hex(t.primary) } });
      slide.addText(s.title, {
        x: 0.5, y: 0.05, w: 12.33, h: 0.7,
        fontSize: 22, fontFace: "Calibri", bold: true, color: hex(t.textLight), valign: "middle",
      });
      const makeBullets = (arr: string[]) =>
        arr.map((item) => ({
          text: item,
          options: { bullet: true, fontSize: 14, fontFace: "Arial", color: hex(t.textDark), lineSpacingMultiple: 1.3 },
        }));
      if (s.leftBullets?.length) {
        slide.addText(makeBullets(s.leftBullets), { x: 0.5, y: 1.1, w: 5.8, h: 5.4, valign: "top" });
      }
      slide.addShape(pptx.ShapeType.line, { x: 6.66, y: 1.1, w: 0, h: 5.0, line: { color: "CCCCCC", width: 1 } });
      if (s.rightBullets?.length) {
        slide.addText(makeBullets(s.rightBullets), { x: 7.0, y: 1.1, w: 5.8, h: 5.4, valign: "top" });
      }
      addFooter(slide, presTitle, t, slideNum);
      break;
    }

    case "closing": {
      slide.background = { color: hex(t.primary) };
      slide.addText(s.title || "Gracias", {
        x: 1, y: 1.5, w: 11.33, h: 2.5,
        fontSize: 40, fontFace: "Calibri", bold: true, color: hex(t.textLight), align: "center", valign: "middle",
      });
      if (s.subtitle) {
        slide.addText(s.subtitle, {
          x: 1, y: 4.2, w: 11.33, h: 1.2,
          fontSize: 16, fontFace: "Arial", color: hex(t.bgMuted), align: "center",
        });
      }
      break;
    }
  }
}

// ── HTML preview ─────────────────────────────────────────────────────

function escapeHtml(str: string): string {
  return str.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

function slidePreview(s: PptxSlide, t: Theme, idx: number, total: number, presTitle: string): string {
  const base = `position:relative;width:100%;aspect-ratio:16/9;border-radius:8px;border:1px solid #d1d5db;box-shadow:0 1px 3px rgba(0,0,0,.12);overflow:hidden;font-family:Arial,sans-serif;box-sizing:border-box;`;
  const footer = (n: number) =>
    `<div style="position:absolute;bottom:0;left:0;right:0;height:28px;display:flex;justify-content:space-between;align-items:center;padding:0 16px;font-size:10px;color:${t.accent};">` +
    `<span>${escapeHtml(presTitle)}</span><span>${n}</span></div>`;

  const titleBar = (title: string) =>
    `<div style="background:${t.primary};padding:8px 20px;"><span style="color:${t.textLight};font-size:18px;font-weight:700;font-family:Calibri,sans-serif;">${escapeHtml(title)}</span></div>`;

  const bulletList = (items: string[], size = "14px") =>
    `<ul style="margin:0;padding:0 0 0 24px;list-style:disc;">${items.map((b) => `<li style="font-size:${size};color:${t.textDark};line-height:1.6;">${escapeHtml(b)}</li>`).join("")}</ul>`;

  let inner: string;
  switch (s.type) {
    case "title":
      inner = `<div style="${base}background:${t.primary};display:flex;flex-direction:column;align-items:center;justify-content:center;padding:24px;">` +
        `<div style="color:${t.textLight};font-size:26px;font-weight:700;text-align:center;font-family:Calibri,sans-serif;">${escapeHtml(s.title)}</div>` +
        (s.subtitle ? `<div style="color:${t.bgMuted};font-size:15px;margin-top:10px;text-align:center;">${escapeHtml(s.subtitle)}</div>` : "") +
        `<div style="position:absolute;bottom:12px;right:20px;color:${t.bgMuted};font-size:11px;">${dateString()}</div></div>`;
      break;

    case "section":
      inner = `<div style="${base}background:${t.accent};display:flex;flex-direction:column;align-items:center;justify-content:center;padding:24px;">` +
        `<div style="color:${t.textLight};font-size:24px;font-weight:700;text-align:center;font-family:Calibri,sans-serif;">${escapeHtml(s.title)}</div>` +
        (s.subtitle ? `<div style="color:${t.textLight};font-size:14px;margin-top:8px;text-align:center;opacity:.85;">${escapeHtml(s.subtitle)}</div>` : "") +
        `</div>`;
      break;

    case "content": {
      const items = s.bullets ?? (s.text ? [s.text] : []);
      inner = `<div style="${base}background:${t.bgLight};">${titleBar(s.title)}` +
        `<div style="padding:14px 20px;">${bulletList(items)}</div>${footer(idx + 1)}</div>`;
      break;
    }

    case "table": {
      const td = s.tableData;
      let tableHtml = "";
      if (td && td.headers.length) {
        const ths = td.headers.map((h) => `<th style="background:${t.primary};color:${t.textLight};padding:6px 8px;font-size:11px;text-align:center;border:1px solid #ccc;">${escapeHtml(h)}</th>`).join("");
        const trs = td.rows.map((row, ri) => {
          const bg = ri % 2 === 0 ? t.bgMuted : t.bgLight;
          return `<tr>${row.map((c) => `<td style="background:${bg};padding:5px 8px;font-size:11px;color:${t.textDark};border:1px solid #ccc;">${escapeHtml(c)}</td>`).join("")}</tr>`;
        }).join("");
        tableHtml = `<table style="width:100%;border-collapse:collapse;margin-top:10px;">${ths}${trs}</table>`;
      }
      inner = `<div style="${base}background:${t.bgLight};">${titleBar(s.title)}<div style="padding:10px 20px;overflow:auto;">${tableHtml}</div>${footer(idx + 1)}</div>`;
      break;
    }

    case "two-column": {
      const left = s.leftBullets ?? [];
      const right = s.rightBullets ?? [];
      inner = `<div style="${base}background:${t.bgLight};">${titleBar(s.title)}` +
        `<div style="display:flex;padding:14px 20px;gap:0;">` +
        `<div style="flex:1;padding-right:12px;">${bulletList(left, "13px")}</div>` +
        `<div style="width:1px;background:#ccc;"></div>` +
        `<div style="flex:1;padding-left:12px;">${bulletList(right, "13px")}</div>` +
        `</div>${footer(idx + 1)}</div>`;
      break;
    }

    case "closing":
      inner = `<div style="${base}background:${t.primary};display:flex;flex-direction:column;align-items:center;justify-content:center;padding:24px;">` +
        `<div style="color:${t.textLight};font-size:28px;font-weight:700;font-family:Calibri,sans-serif;">${escapeHtml(s.title || "Gracias")}</div>` +
        (s.subtitle ? `<div style="color:${t.bgMuted};font-size:14px;margin-top:10px;text-align:center;">${escapeHtml(s.subtitle)}</div>` : "") +
        `</div>`;
      break;

    default:
      inner = `<div style="${base}background:${t.bgLight};padding:24px;"><p>${escapeHtml(s.title)}</p></div>`;
  }

  return `<div style="margin-bottom:16px;"><div style="font-size:11px;color:#6b7280;margin-bottom:4px;">Diapositiva ${idx + 1} / ${total}</div>${inner}</div>`;
}

function buildPreviewHtml(req: PptxRequest, t: Theme): string {
  const slides = req.slides.map((s, i) => slidePreview(s, t, i, req.slides.length, req.title)).join("");
  return `<div style="display:flex;flex-direction:column;gap:8px;max-width:720px;">${slides}</div>`;
}

// ── Main entry point ─────────────────────────────────────────────────

export async function generateProfessionalPptx(request: PptxRequest): Promise<PptxResult> {
  const t = resolveTheme(request.theme);
  const pptx = new PptxGenJS();
  pptx.layout = "LAYOUT_WIDE";
  pptx.author = request.author ?? "IliaGPT";
  pptx.title = request.title;

  let slideNum = 0;
  for (const s of request.slides) {
    slideNum++;
    buildSlide(pptx, s, t, request.title, slideNum);
  }

  const output = await pptx.write({ outputType: "nodebuffer" });
  const buffer = Buffer.from(output as ArrayBuffer);
  const filename = `${sanitizeFilename(request.title)}.pptx`;
  const previewHtml = buildPreviewHtml(request, t);

  return {
    buffer,
    filename,
    mimeType: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
    previewHtml,
    slideCount: request.slides.length,
  };
}
