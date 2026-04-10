/**
 * Deterministic DOCX fixture generator for the Office Engine test suite.
 *
 * Run with: `npm run build:docx-fixtures`
 *
 * Produces every fixture under `test_fixtures/docx/`. Most fixtures are built
 * with the `docx` library; the trickiest ones (namespaces-mc-ignorable,
 * xml-space-preserve, fallback-trigger) are hand-crafted XML and packed with
 * `jszip` so we have full control over namespace declarations and special
 * whitespace.
 */

import * as fs from "node:fs/promises";
import * as path from "node:path";
import {
  Document,
  Packer,
  Paragraph,
  TextRun,
  HeadingLevel,
  Table,
  TableRow,
  TableCell,
  WidthType,
  ImageRun,
  ExternalHyperlink,
  AlignmentType,
} from "docx";
import JSZip from "jszip";

const FIXTURES_DIR = path.resolve(process.cwd(), "test_fixtures", "docx");

async function ensureDir(): Promise<void> {
  await fs.mkdir(FIXTURES_DIR, { recursive: true });
}

async function writeDocx(name: string, doc: Document): Promise<void> {
  const buf = await Packer.toBuffer(doc);
  await fs.writeFile(path.join(FIXTURES_DIR, name), buf);
  // eslint-disable-next-line no-console
  console.log(`✓ ${name} (${buf.length} bytes)`);
}

async function writeRawDocx(name: string, contentTypes: string, documentXml: string, extras: Record<string, Buffer | string> = {}): Promise<void> {
  const zip = new JSZip();
  zip.file("[Content_Types].xml", contentTypes);
  zip.file(
    "_rels/.rels",
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>
</Relationships>`,
  );
  zip.file(
    "word/_rels/document.xml.rels",
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"></Relationships>`,
  );
  zip.file("word/document.xml", documentXml);
  for (const [p, v] of Object.entries(extras)) zip.file(p, v);
  const buf = await zip.generateAsync({ type: "nodebuffer", compression: "DEFLATE", compressionOptions: { level: 6 } });
  await fs.writeFile(path.join(FIXTURES_DIR, name), buf);
  // eslint-disable-next-line no-console
  console.log(`✓ ${name} (${buf.length} bytes, raw)`);
}

const STD_CONTENT_TYPES = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>
  <Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>
</Types>`;

// ---------------------------------------------------------------------------
// Builders
// ---------------------------------------------------------------------------

async function buildSimple() {
  const doc = new Document({
    sections: [
      {
        properties: {},
        children: [
          new Paragraph({ text: "Documento simple de prueba", heading: HeadingLevel.HEADING_1 }),
          new Paragraph({ children: [new TextRun({ text: "hola mundo" })] }),
          new Paragraph({ children: [new TextRun({ text: "segunda línea con más texto" })] }),
        ],
      },
    ],
  });
  await writeDocx("simple.docx", doc);
}

async function buildSplitRuns() {
  // "hola mundo" split across three runs with different formatting.
  const doc = new Document({
    sections: [
      {
        properties: {},
        children: [
          new Paragraph({
            children: [
              new TextRun({ text: "hola ", bold: true }),
              new TextRun({ text: "mun", italics: true }),
              new TextRun({ text: "do", underline: {} }),
            ],
          }),
        ],
      },
    ],
  });
  await writeDocx("split-runs.docx", doc);
}

async function buildMergedCellsTable() {
  const doc = new Document({
    sections: [
      {
        properties: {},
        children: [
          new Paragraph({ text: "Tabla con celdas fusionadas" }),
          new Table({
            width: { size: 100, type: WidthType.PERCENTAGE },
            rows: [
              new TableRow({
                children: [
                  new TableCell({ children: [new Paragraph("A1+B1")], columnSpan: 2 }),
                  new TableCell({ children: [new Paragraph("C1")] }),
                ],
              }),
              new TableRow({
                children: [
                  new TableCell({ children: [new Paragraph("A2")] }),
                  new TableCell({ children: [new Paragraph("B2")] }),
                  new TableCell({ children: [new Paragraph("C2")] }),
                ],
              }),
            ],
          }),
        ],
      },
    ],
  });
  await writeDocx("merged-cells-table.docx", doc);
}

async function buildNumberedList() {
  const doc = new Document({
    numbering: {
      config: [
        {
          reference: "my-list",
          levels: [
            {
              level: 0,
              format: "decimal",
              text: "%1.",
              alignment: AlignmentType.START,
            },
          ],
        },
      ],
    },
    sections: [
      {
        properties: {},
        children: [
          new Paragraph({ text: "Lista numerada" }),
          new Paragraph({ text: "Primero", numbering: { reference: "my-list", level: 0 } }),
          new Paragraph({ text: "Segundo", numbering: { reference: "my-list", level: 0 } }),
          new Paragraph({ text: "Tercero", numbering: { reference: "my-list", level: 0 } }),
        ],
      },
    ],
  });
  await writeDocx("numbered-list.docx", doc);
}

async function buildStylesHeadingBody() {
  const doc = new Document({
    sections: [
      {
        properties: {},
        children: [
          new Paragraph({ text: "Título principal", heading: HeadingLevel.HEADING_1 }),
          new Paragraph({ text: "Subtítulo", heading: HeadingLevel.HEADING_2 }),
          new Paragraph({ children: [new TextRun({ text: "Cuerpo del documento", size: 24 })] }),
        ],
      },
    ],
  });
  await writeDocx("styles-heading-body.docx", doc);
}

async function buildWithImage() {
  // 1x1 transparent PNG
  const png = Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/wcAAwAB/epv2gAAAABJRU5ErkJggg==",
    "base64",
  );
  const doc = new Document({
    sections: [
      {
        properties: {},
        children: [
          new Paragraph({ text: "Documento con imagen" }),
          new Paragraph({
            children: [
              new ImageRun({
                data: png,
                type: "png",
                transformation: { width: 50, height: 50 },
              }),
            ],
          }),
        ],
      },
    ],
  });
  await writeDocx("with-image.docx", doc);
}

async function buildWithHeaderFooter() {
  const doc = new Document({
    sections: [
      {
        properties: {},
        headers: {
          default: { options: { children: [new Paragraph("ENCABEZADO")] } } as any,
        } as any,
        footers: {
          default: { options: { children: [new Paragraph("PIE DE PÁGINA")] } } as any,
        } as any,
        children: [new Paragraph("Cuerpo del documento")],
      },
    ],
  });
  await writeDocx("with-header-footer.docx", doc);
}

async function buildHyperlinks() {
  const doc = new Document({
    sections: [
      {
        properties: {},
        children: [
          new Paragraph({
            children: [
              new TextRun("Visita "),
              new ExternalHyperlink({
                link: "https://example.com",
                children: [new TextRun({ text: "Example", style: "Hyperlink" })],
              }),
              new TextRun("."),
            ],
          }),
        ],
      },
    ],
  });
  await writeDocx("hyperlinks.docx", doc);
}

async function buildUnicodeAccents() {
  const doc = new Document({
    sections: [
      {
        properties: {},
        children: [
          new Paragraph({ text: "áéíóúñü ÁÉÍÓÚÑÜ" }),
          new Paragraph({ text: "🚀🎉 漢字テスト" }),
          new Paragraph({ text: "Ω≈ç√∫˜µ≤≥÷" }),
        ],
      },
    ],
  });
  await writeDocx("unicode-accents.docx", doc);
}

async function buildXmlSpacePreserve() {
  // Hand-crafted: text runs with leading/trailing whitespace + xml:space="preserve".
  const documentXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
  <w:body>
    <w:p><w:r><w:t xml:space="preserve">  leading and trailing  </w:t></w:r></w:p>
    <w:p><w:r><w:t xml:space="preserve">tab\there</w:t></w:r></w:p>
    <w:sectPr/>
  </w:body>
</w:document>`;
  await writeRawDocx("xml-space-preserve.docx", STD_CONTENT_TYPES, documentXml);
}

async function buildNamespacesMcIgnorable() {
  const documentXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document
  xmlns:wpc="http://schemas.microsoft.com/office/word/2010/wordprocessingCanvas"
  xmlns:cx="http://schemas.microsoft.com/office/drawing/2014/chartex"
  xmlns:mc="http://schemas.openxmlformats.org/markup-compatibility/2006"
  xmlns:o="urn:schemas-microsoft-com:office:office"
  xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"
  xmlns:m="http://schemas.openxmlformats.org/officeDocument/2006/math"
  xmlns:v="urn:schemas-microsoft-com:vml"
  xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing"
  xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"
  xmlns:w14="http://schemas.microsoft.com/office/word/2010/wordml"
  xmlns:w15="http://schemas.microsoft.com/office/word/2012/wordml"
  mc:Ignorable="w14 w15 wpc cx">
  <w:body>
    <w:p><w:r><w:t>Namespace stress test</w:t></w:r></w:p>
    <w:sectPr/>
  </w:body>
</w:document>`;
  await writeRawDocx("namespaces-mc-ignorable.docx", STD_CONTENT_TYPES, documentXml);
}

async function buildCommentsTracked() {
  const documentXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
  <w:body>
    <w:p>
      <w:ins w:id="1" w:author="Tester" w:date="2026-04-10T00:00:00Z">
        <w:r><w:t>nuevo texto insertado</w:t></w:r>
      </w:ins>
      <w:del w:id="2" w:author="Tester" w:date="2026-04-10T00:00:00Z">
        <w:r><w:delText>texto borrado</w:delText></w:r>
      </w:del>
    </w:p>
    <w:sectPr/>
  </w:body>
</w:document>`;
  const commentsXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:comments xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
  <w:comment w:id="1" w:author="Tester" w:date="2026-04-10T00:00:00Z" w:initials="T">
    <w:p><w:r><w:t>comentario uno</w:t></w:r></w:p>
  </w:comment>
</w:comments>`;
  await writeRawDocx("comments-tracked.docx", STD_CONTENT_TYPES, documentXml, {
    "word/comments.xml": commentsXml,
  });
}

async function buildPlaceholderTemplate() {
  const doc = new Document({
    sections: [
      {
        properties: {},
        children: [
          new Paragraph({ children: [new TextRun("Hola {name}, tu fecha es {date}.")] }),
        ],
      },
    ],
  });
  await writeDocx("placeholder-template.docx", doc);
}

async function buildTableData() {
  const rows = [
    ["A1", "B1", "C1"],
    ["A2", "B2", "C2"],
    ["A3", "B3", "C3"],
  ];
  const doc = new Document({
    sections: [
      {
        properties: {},
        children: [
          new Paragraph("Tabla 3x3"),
          new Table({
            rows: rows.map(
              (r) =>
                new TableRow({
                  children: r.map((c) => new TableCell({ children: [new Paragraph(c)] })),
                }),
            ),
          }),
        ],
      },
    ],
  });
  await writeDocx("table-data.docx", doc);
}

async function buildVisualRegression() {
  const doc = new Document({
    sections: [
      {
        properties: {},
        children: [
          new Paragraph({ text: "Visual regression baseline", heading: HeadingLevel.HEADING_1 }),
          new Paragraph({ children: [new TextRun({ text: "Stable text content for snapshot.", size: 24 })] }),
        ],
      },
    ],
  });
  await writeDocx("visual-regression.docx", doc);
}

async function buildFallbackTrigger() {
  // Contains a malformed docxtemplater placeholder ({{unclosed) so level 1 throws.
  const doc = new Document({
    sections: [
      {
        properties: {},
        children: [
          new Paragraph({ children: [new TextRun("Texto con placeholder roto: {{unclosed name")] }),
        ],
      },
    ],
  });
  await writeDocx("fallback-trigger.docx", doc);
}

async function buildLarge500p() {
  const children: Paragraph[] = [];
  for (let i = 0; i < 500; i++) {
    children.push(
      new Paragraph({
        children: [
          new TextRun({ text: `Página simulada ${i + 1}: lorem ipsum dolor sit amet, consectetur adipiscing elit. ` }),
          new TextRun({ text: "Sed do eiusmod tempor incididunt ut labore et dolore magna aliqua. ".repeat(8) }),
        ],
      }),
    );
  }
  const doc = new Document({ sections: [{ properties: {}, children }] });
  await writeDocx("large-500p.docx", doc);
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  await ensureDir();
  await Promise.all([
    buildSimple(),
    buildSplitRuns(),
    buildMergedCellsTable(),
    buildNumberedList(),
    buildStylesHeadingBody(),
    buildWithImage(),
    buildWithHeaderFooter(),
    buildHyperlinks(),
    buildUnicodeAccents(),
    buildXmlSpacePreserve(),
    buildNamespacesMcIgnorable(),
    buildCommentsTracked(),
    buildPlaceholderTemplate(),
    buildTableData(),
    buildVisualRegression(),
    buildFallbackTrigger(),
    buildLarge500p(),
  ]);
  // eslint-disable-next-line no-console
  console.log(`\nAll fixtures written to ${FIXTURES_DIR}`);
}

main().catch((err) => {
  // eslint-disable-next-line no-console
  console.error("Fixture build failed:", err);
  process.exit(1);
});
