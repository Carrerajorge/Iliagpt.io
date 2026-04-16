import PDFDocument from "pdfkit";

export interface PdfContent {
  title: string;
  author?: string;
  sections: Array<{
    heading: string;
    paragraphs?: string[];
    table?: { headers: string[]; rows: string[][] };
    list?: { items: string[]; ordered?: boolean };
  }>;
}

const PRIMARY = "#2E5090";
const HEADING_COLOR = "#1F4E79";
const BODY_COLOR = "#333333";
const GRAY = "#888888";
const PAGE_W = 595.28;
const PAGE_H = 841.89;
const MARGIN = 72;
const CONTENT_W = PAGE_W - MARGIN * 2;

function sanitizeFilename(name: string): string {
  return name.replace(/[^a-zA-Z0-9_\-\s]/g, "").replace(/\s+/g, "_").substring(0, 80);
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function addPageHeader(doc: any) {
  doc.save();
  doc.moveTo(MARGIN, MARGIN - 10).lineTo(PAGE_W - MARGIN, MARGIN - 10).strokeColor(PRIMARY).lineWidth(1).stroke();
  doc.restore();
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function addPageNumber(doc: any, pageNum: number) {
  doc.save();
  doc.fontSize(9).fillColor(GRAY).text(`Pagina ${pageNum}`, 0, PAGE_H - 40, { width: PAGE_W, align: "center" });
  doc.restore();
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function ensureSpace(doc: any, needed: number): void {
  if (doc.y + needed > PAGE_H - MARGIN - 30) {
    doc.addPage();
  }
}

export async function generatePdf(content: PdfContent): Promise<{ buffer: Buffer; filename: string; mimeType: string }> {
  return new Promise((resolve, reject) => {
    try {
      const doc = new PDFDocument({
        size: "A4",
        margins: { top: MARGIN, bottom: MARGIN, left: MARGIN, right: MARGIN },
        info: { Title: content.title, Author: content.author || "IliaGPT" },
        bufferPages: true,
      });

      const chunks: Uint8Array[] = [];
      doc.on("data", (chunk: Uint8Array) => chunks.push(chunk));
      doc.on("end", () => {
        const buffer = Buffer.concat(chunks);
        resolve({
          buffer,
          filename: `${sanitizeFilename(content.title)}.pdf`,
          mimeType: "application/pdf",
        });
      });
      doc.on("error", reject);

      // --- Cover page ---
      doc.moveDown(8);
      doc.fontSize(28).font("Helvetica-Bold").fillColor(HEADING_COLOR)
        .text(content.title, MARGIN, doc.y, { width: CONTENT_W, align: "center" });
      doc.moveDown(1);

      // Horizontal rule
      const ruleY = doc.y;
      doc.moveTo(MARGIN + 60, ruleY).lineTo(PAGE_W - MARGIN - 60, ruleY)
        .strokeColor(PRIMARY).lineWidth(2).stroke();
      doc.moveDown(1.5);

      if (content.author) {
        doc.fontSize(14).font("Helvetica").fillColor(BODY_COLOR)
          .text(content.author, MARGIN, doc.y, { width: CONTENT_W, align: "center" });
        doc.moveDown(0.5);
      }

      const dateStr = new Date().toLocaleDateString("es-ES", { year: "numeric", month: "long", day: "numeric" });
      doc.fontSize(11).font("Helvetica").fillColor(GRAY)
        .text(dateStr, MARGIN, doc.y, { width: CONTENT_W, align: "center" });

      // --- Content pages ---
      doc.addPage();

      for (const section of content.sections) {
        ensureSpace(doc, 60);

        // Section heading
        doc.fontSize(18).font("Helvetica-Bold").fillColor(PRIMARY)
          .text(section.heading, MARGIN, doc.y, { width: CONTENT_W });
        const underlineY = doc.y + 2;
        doc.moveTo(MARGIN, underlineY).lineTo(MARGIN + CONTENT_W, underlineY)
          .strokeColor(PRIMARY).lineWidth(0.75).stroke();
        doc.y = underlineY + 8;

        // Paragraphs
        if (section.paragraphs) {
          for (const para of section.paragraphs) {
            ensureSpace(doc, 40);
            doc.fontSize(11).font("Helvetica").fillColor(BODY_COLOR)
              .text(para, MARGIN, doc.y, { width: CONTENT_W, lineGap: 6 });
            doc.moveDown(0.8);
          }
        }

        // List
        if (section.list && section.list.items.length > 0) {
          for (let i = 0; i < section.list.items.length; i++) {
            ensureSpace(doc, 30);
            const prefix = section.list.ordered ? `${i + 1}. ` : "\u2022 ";
            doc.fontSize(11).font("Helvetica").fillColor(BODY_COLOR)
              .text(`${prefix}${section.list.items[i]}`, MARGIN + 20, doc.y, { width: CONTENT_W - 20, lineGap: 4 });
            doc.moveDown(0.3);
          }
          doc.moveDown(0.5);
        }

        // Table
        if (section.table && section.table.headers.length > 0) {
          const tbl = section.table;
          const colCount = tbl.headers.length;
          const colW = CONTENT_W / colCount;
          const rowH = 22;
          const headerH = 24;

          ensureSpace(doc, headerH + rowH * Math.min(tbl.rows.length, 3) + 10);

          let startY = doc.y + 4;

          // Header row
          for (let c = 0; c < colCount; c++) {
            const x = MARGIN + c * colW;
            doc.rect(x, startY, colW, headerH).fill(HEADING_COLOR);
            doc.fontSize(10).font("Helvetica-Bold").fillColor("#FFFFFF")
              .text(tbl.headers[c], x + 4, startY + 6, { width: colW - 8, align: "center" });
          }
          startY += headerH;

          // Body rows
          for (const row of tbl.rows) {
            if (startY + rowH > PAGE_H - MARGIN - 30) {
              doc.addPage();
              startY = MARGIN;
            }
            for (let c = 0; c < colCount; c++) {
              const x = MARGIN + c * colW;
              doc.rect(x, startY, colW, rowH).strokeColor("#CCCCCC").lineWidth(0.5).stroke();
              doc.fontSize(10).font("Helvetica").fillColor(BODY_COLOR)
                .text(row[c] || "", x + 4, startY + 5, { width: colW - 8, align: "left" });
            }
            startY += rowH;
          }

          doc.y = startY + 8;
          doc.moveDown(0.5);
        }
      }

      // Add headers and page numbers to all pages (skip cover page header)
      const pageCount = doc.bufferedPageRange().count;
      for (let i = 0; i < pageCount; i++) {
        doc.switchToPage(i);
        if (i > 0) addPageHeader(doc);
        addPageNumber(doc, i + 1);
      }

      doc.end();
    } catch (err) {
      reject(err);
    }
  });
}
