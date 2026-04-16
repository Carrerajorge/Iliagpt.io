import type PptxGenJS from "pptxgenjs";
import {
  CORPORATE_PPT_DESIGN_SYSTEM,
  CORPORATE_PPT_MASTER_NAME,
  createPptxDocument,
  defineCorporateMaster,
  generatePptDocument,
} from "../services/documentGeneration";
import {
  Document,
  Paragraph as DocxParagraph,
  TextRun,
  Table,
  TableRow,
  TableCell,
  WidthType,
  AlignmentType,
  HeadingLevel,
  BorderStyle,
  ImageRun,
  Packer,
  PageOrientation,
  convertInchesToTwip,
} from "docx";
import ExcelJS from "exceljs";
import {
  ArtifactSpec,
  PresentationSpec,
  DocSpec,
  SheetSpec,
  SlideSpec,
  SlideElement,
  SlideElementStyle,
  DocSection,
  Paragraph,
  DocTable,
  DocImage,
  Worksheet,
  CellSpec,
  SheetChart,
  DEFAULT_QUALITY_GATES,
  validateArtifact,
  ArtifactType,
} from "./builderSpec";
import { agentEventBus } from "./eventBus";
import { randomUUID } from "crypto";

// ============================================
// Types
// ============================================

export interface RenderResult {
  buffer: Buffer;
  filename: string;
  mimeType: string;
  error?: string;
}

export interface ValidationResult {
  valid: boolean;
  errors: string[];
  warnings: string[];
}

// ============================================
// QA Gate - Quality Validation
// ============================================

export function validateForRendering(artifact: ArtifactSpec): ValidationResult {
  const result: ValidationResult = {
    valid: true,
    errors: [],
    warnings: [],
  };

  try {
    const gate = DEFAULT_QUALITY_GATES[artifact.type as ArtifactType];
    if (!gate) {
      result.warnings.push(`No quality gate defined for artifact type: ${artifact.type}`);
      return result;
    }

    const validationResult = validateArtifact(artifact, gate);

    if (!validationResult.valid) {
      result.valid = false;
      result.errors = validationResult.errors.map(
        (e) => `[${e.severity}] ${e.field}: ${e.message}`
      );
    }

    result.warnings = validationResult.warnings.map(
      (w) => `${w.field}: ${w.message}`
    );

    // Additional type-specific validations
    switch (artifact.type) {
      case "presentation":
        validatePresentationSpec(artifact.spec as PresentationSpec, result);
        break;
      case "document":
        validateDocSpec(artifact.spec as DocSpec, result);
        break;
      case "spreadsheet":
        validateSpreadsheetSpec(artifact.spec as SheetSpec, result);
        break;
    }
  } catch (error) {
    result.valid = false;
    result.errors.push(`Validation error: ${error instanceof Error ? error.message : String(error)}`);
  }

  return result;
}

function validatePresentationSpec(spec: PresentationSpec, result: ValidationResult): void {
  if (!spec.slides || spec.slides.length === 0) {
    result.valid = false;
    result.errors.push("Presentation must have at least one slide");
  }

  spec.slides?.forEach((slide, index) => {
    if (!slide.title || slide.title.trim() === "") {
      result.warnings.push(`Slide ${index + 1} has no title`);
    }
  });
}

function validateDocSpec(spec: DocSpec, result: ValidationResult): void {
  if (!spec.sections || spec.sections.length === 0) {
    result.valid = false;
    result.errors.push("Document must have at least one section");
  }
}

function validateSpreadsheetSpec(spec: SheetSpec, result: ValidationResult): void {
  if (!spec.sheets || spec.sheets.length === 0) {
    result.valid = false;
    result.errors.push("Spreadsheet must have at least one sheet");
  }

  spec.sheets?.forEach((sheet, index) => {
    if (!sheet.name || sheet.name.trim() === "") {
      result.warnings.push(`Sheet ${index + 1} has no name`);
    }
  });
}

// ============================================
// Presentation Renderer (PPTX)
// ============================================

export async function renderPresentation(
  spec: PresentationSpec
): Promise<{ buffer: Buffer; filename: string }> {
  try {
    const pptx = createPptxDocument();
    const safeTitle = sanitizePptText(spec.title).substring(0, 500) || "Presentación";
    const safeAuthor = sanitizePptText(spec.author).substring(0, 200);
    const safeLanguage = sanitizePptText(spec.metadata?.language).substring(0, 16);

    pptx.layout = "LAYOUT_16x9";
    pptx.title = safeTitle;
    if (safeAuthor) pptx.author = safeAuthor;
    if (safeLanguage) pptx.lang = safeLanguage;
    defineCorporateMaster(pptx);

    const safeSlides = spec.slides.length > 0
      ? spec.slides
      : [{
          title: safeTitle,
          layout: "title",
          subtitle: "Sin contenido",
          elements: [],
        }];

    for (const slideSpec of safeSlides) {
      const slide = pptx.addSlide({ masterName: CORPORATE_PPT_MASTER_NAME });
      const safeSlideTitle = sanitizePptText(slideSpec.title).substring(0, 160) || "Diapositiva";
      const safeSubtitle = sanitizePptText(slideSpec.subtitle).substring(0, 200);
      const slideBg = slideSpec.background?.color || CORPORATE_PPT_DESIGN_SYSTEM.palette.bg;

      slide.background = { color: normalizeHex(slideBg) };

      try {
        if (slideSpec.layout === "title" || slideSpec.layout === "title-content") {
          slide.addText(safeSlideTitle, {
            x: 0.5,
            y: slideSpec.layout === "title" ? 2 : 0.5,
            w: 9,
            h: 1.5,
            fontSize: slideSpec.layout === "title" ? 44 : 32,
            bold: true,
            align: "center",
            valign: "middle",
            fontFace: CORPORATE_PPT_DESIGN_SYSTEM.typography.heading,
            color: CORPORATE_PPT_DESIGN_SYSTEM.palette.text,
          });

          if (safeSubtitle) {
            slide.addText(safeSubtitle, {
              x: 0.5,
              y: slideSpec.layout === "title" ? 3.5 : 1.5,
              w: 9,
              h: 0.75,
              fontSize: 20,
              align: "center",
              valign: "middle",
              color: CORPORATE_PPT_DESIGN_SYSTEM.palette.muted,
              fontFace: CORPORATE_PPT_DESIGN_SYSTEM.typography.body,
            });
          }
        }

        const sortedElements = [...(slideSpec.elements || [])].sort(
          (a, b) => (a.zIndex ?? 0) - (b.zIndex ?? 0)
        );
        for (const element of sortedElements) {
          await addSlideElement(slide, element);
        }
      } catch (slideError) {
        console.warn(`[artifactRenderer] Falling back for slide "${safeSlideTitle}": ${slideError}`);
        slide.addText(safeSlideTitle, {
          x: 0.5,
          y: 0.45,
          w: 9,
          h: 1,
          fontSize: CORPORATE_PPT_DESIGN_SYSTEM.sizes.sectionTitle,
          color: CORPORATE_PPT_DESIGN_SYSTEM.palette.primary,
          bold: true,
          fontFace: CORPORATE_PPT_DESIGN_SYSTEM.typography.heading,
        });
        slide.addText("No se pudo renderizar esta diapositiva con el layout solicitado.", {
          x: 0.5,
          y: 1.75,
          w: 9,
          h: 3.5,
          fontSize: CORPORATE_PPT_DESIGN_SYSTEM.sizes.body,
          color: CORPORATE_PPT_DESIGN_SYSTEM.palette.text,
          fontFace: CORPORATE_PPT_DESIGN_SYSTEM.typography.body,
          valign: "top",
        });
      }
      
      // Apply background overrides
      if (slideSpec.background) {
        if (slideSpec.background.image) {
          slide.background = { path: slideSpec.background.image };
        } else if (slideSpec.background.gradient?.colors?.[0]) {
          slide.background = { color: normalizeHex(slideSpec.background.gradient.colors[0]) };
        }
      }

      if (slideSpec.transition && slideSpec.transition.type !== "none") {
        const transitionMap: Record<string, string> = {
          fade: "fade",
          slide: "push",
          push: "push",
          wipe: "wipe",
          zoom: "zoom",
          dissolve: "fade",
          cover: "cover",
          uncover: "cover",
        };
        slide.transition = {
          type: transitionMap[slideSpec.transition.type] || "fade",
          speed: slideSpec.transition.duration < 500 ? "fast" : slideSpec.transition.duration > 1000 ? "slow" : "med",
        };
      }
      if (slideSpec.notes) {
        slide.addNotes(slideSpec.notes);
      }
    }

    // Generate buffer
    const data = await pptx.write({ outputType: "nodebuffer" });
    const buffer = Buffer.from(data as ArrayBuffer);
    
    const filename = sanitizeFilename(safeTitle) + ".pptx";
    
    return { buffer, filename };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const safeTitle = sanitizePptText(spec.title).substring(0, 500) || "Presentación";
    const fallback = await generatePptDocument(safeTitle, [{
      title: "Fallback",
      content: [
        "No fue posible renderizar la presentación solicitada.",
        `Error: ${sanitizePptText(message).substring(0, 220)}`,
      ],
    }], {
      trace: {
        source: "artifactRenderer",
      },
    });
    return {
      buffer: fallback,
      filename: `${sanitizeFilename(safeTitle)}.pptx`,
    };
  }
}

interface PositionWithUnit {
  x: number;
  y: number;
  w: number;
  h: number;
  unit?: "percent" | "px" | "inches";
}

const SLIDE_WIDTH_INCHES = 10;
const SLIDE_HEIGHT_INCHES = 5.625;
const SLIDE_WIDTH_PX = 960;
const SLIDE_HEIGHT_PX = 540;

function convertCoordinate(
  value: number,
  maxInches: number,
  unit: "percent" | "px" | "inches" | undefined,
  isWidth: boolean = true
): number {
  const effectiveUnit = unit || (value > 100 ? "px" : "percent");
  
  switch (effectiveUnit) {
    case "inches":
      return value;
    case "px":
      if (isWidth) {
        return (value / SLIDE_WIDTH_PX) * SLIDE_WIDTH_INCHES;
      } else {
        return (value / SLIDE_HEIGHT_PX) * SLIDE_HEIGHT_INCHES;
      }
    case "percent":
    default:
      return (value / 100) * maxInches;
  }
}

async function addSlideElement(
  slide: PptxGenJS.Slide,
  element: SlideElement
): Promise<void> {
  const { position, style } = element;
  const unit = (position as PositionWithUnit).unit;
  const x = convertCoordinate(position.x, SLIDE_WIDTH_INCHES, unit, true);
  const y = convertCoordinate(position.y, SLIDE_HEIGHT_INCHES, unit, false);
  const w = convertCoordinate(position.w, SLIDE_WIDTH_INCHES, unit, true);
  const h = convertCoordinate(position.h, SLIDE_HEIGHT_INCHES, unit, false);

  const textOptions: PptxGenJS.TextPropsOptions = {
    x,
    y,
    w,
    h,
    fontSize: style?.fontSize || CORPORATE_PPT_DESIGN_SYSTEM.sizes.body,
    bold: style?.bold || false,
    italic: style?.italic || false,
    underline: style?.underline ? { style: "sng" } : undefined,
    strike: style?.strikethrough || false,
    color: normalizeHex(style?.color || CORPORATE_PPT_DESIGN_SYSTEM.palette.text),
    fontFace: style?.fontFamily || CORPORATE_PPT_DESIGN_SYSTEM.typography.body,
    align: (style?.alignment as PptxGenJS.HAlign) || "left",
    valign: "middle",
  };

  if (style?.fill) {
    textOptions.fill = { color: normalizeHex(style.fill) };
  }

  if (style?.rotation) {
    textOptions.rotate = style.rotation;
  }

  switch (element.type) {
    case "text":
      slide.addText(String(element.content), textOptions);
      break;

    case "image":
      try {
        const imageData = String(element.content);
        if (imageData.startsWith("data:") || imageData.startsWith("http")) {
          slide.addImage({
            data: imageData.startsWith("data:") ? imageData : undefined,
            path: imageData.startsWith("http") ? imageData : undefined,
            x,
            y,
            w,
            h,
            rounding: style?.border ? true : false,
          });
        }
      } catch (e) {
        console.warn(`Failed to add image element: ${e}`);
      }
      break;

    case "chart":
      try {
        const chartData = typeof element.content === "object" ? element.content : JSON.parse(String(element.content));
        const chartType = chartData.type || "bar";
        const chartTypeMap: Record<string, PptxGenJS.CHART_NAME> = {
          bar: "bar" as PptxGenJS.CHART_NAME,
          line: "line" as PptxGenJS.CHART_NAME,
          pie: "pie" as PptxGenJS.CHART_NAME,
          doughnut: "doughnut" as PptxGenJS.CHART_NAME,
          area: "area" as PptxGenJS.CHART_NAME,
          scatter: "scatter" as PptxGenJS.CHART_NAME,
        };

        if (chartData.data && Array.isArray(chartData.data)) {
          slide.addChart(chartTypeMap[chartType] || ("bar" as PptxGenJS.CHART_NAME), chartData.data, {
            x,
            y,
            w,
            h,
            showTitle: !!chartData.title,
            title: chartData.title,
            showLegend: chartData.showLegend !== false,
          });
        }
      } catch (e) {
        console.warn(`Failed to add chart element: ${e}`);
      }
      break;

    case "table":
      try {
        const tableData = typeof element.content === "object" ? element.content : JSON.parse(String(element.content));
        if (tableData.rows && Array.isArray(tableData.rows)) {
          slide.addTable(tableData.rows, {
            x,
            y,
            w,
            h,
            border: { pt: 1, color: "CFCFCF" },
            fontFace: style?.fontFamily || "Arial",
            fontSize: style?.fontSize || 12,
          });
        }
      } catch (e) {
        console.warn(`Failed to add table element: ${e}`);
      }
      break;

    case "shape":
      const shapeType = typeof element.content === "string" ? element.content : "rect";
      const shapeTypeMap: Record<string, PptxGenJS.SHAPE_NAME> = {
        rect: "rect" as PptxGenJS.SHAPE_NAME,
        roundRect: "roundRect" as PptxGenJS.SHAPE_NAME,
        ellipse: "ellipse" as PptxGenJS.SHAPE_NAME,
        triangle: "triangle" as PptxGenJS.SHAPE_NAME,
        line: "line" as PptxGenJS.SHAPE_NAME,
        arrow: "rightArrow" as PptxGenJS.SHAPE_NAME,
      };

      slide.addShape(shapeTypeMap[shapeType] || ("rect" as PptxGenJS.SHAPE_NAME), {
        x,
        y,
        w,
        h,
        fill: { color: style?.fill?.replace("#", "") || "0088CC" },
        line: style?.stroke ? { color: style.stroke.replace("#", ""), width: style.strokeWidth || 1 } : undefined,
      });
      break;

    default:
      if (element.content) {
        slide.addText(String(element.content), textOptions);
      }
  }
}


// ============================================
// Document Renderer (DOCX)
// ============================================

export async function renderDocument(
  spec: DocSpec
): Promise<{ buffer: Buffer; filename: string }> {
  try {
    const children: (DocxParagraph | Table)[] = [];

    // Add document title
    children.push(
      new DocxParagraph({
        text: spec.title,
        heading: HeadingLevel.TITLE,
        spacing: { after: 400 },
      })
    );

    // Add table of contents placeholder if enabled
    if (spec.tableOfContents) {
      children.push(
        new DocxParagraph({
          text: "Table of Contents",
          heading: HeadingLevel.HEADING_1,
          spacing: { after: 200 },
        })
      );
      children.push(
        new DocxParagraph({
          text: "(Table of contents will be generated by Word)",
          spacing: { after: 400 },
          style: "Normal",
        })
      );
    }

    // Process sections
    for (const section of spec.sections) {
      await processDocSection(section, children);
    }

    // Create document
    const doc = new Document({
      title: spec.title,
      creator: spec.metadata?.author,
      description: spec.metadata?.subject,
      keywords: spec.metadata?.keywords?.join(", "),
      sections: [
        {
          properties: {
            page: {
              size: {
                orientation: spec.pageSettings?.orientation === "landscape" 
                  ? PageOrientation.LANDSCAPE 
                  : PageOrientation.PORTRAIT,
              },
              margin: {
                top: convertInchesToTwip(spec.pageSettings?.margins?.top || 1),
                bottom: convertInchesToTwip(spec.pageSettings?.margins?.bottom || 1),
                left: convertInchesToTwip(spec.pageSettings?.margins?.left || 1),
                right: convertInchesToTwip(spec.pageSettings?.margins?.right || 1),
              },
            },
          },
          children,
        },
      ],
    });

    const buffer = await Packer.toBuffer(doc);
    const filename = sanitizeFilename(spec.title) + ".docx";

    return { buffer, filename };
  } catch (error) {
    throw new Error(`Failed to render document: ${error instanceof Error ? error.message : String(error)}`);
  }
}

async function processDocSection(
  section: DocSection,
  children: (DocxParagraph | Table)[]
): Promise<void> {
  // Add section heading
  const headingLevelMap: Record<string, typeof HeadingLevel[keyof typeof HeadingLevel]> = {
    h1: HeadingLevel.HEADING_1,
    h2: HeadingLevel.HEADING_2,
    h3: HeadingLevel.HEADING_3,
    h4: HeadingLevel.HEADING_4,
    h5: HeadingLevel.HEADING_5,
    h6: HeadingLevel.HEADING_6,
  };

  children.push(
    new DocxParagraph({
      text: section.heading,
      heading: headingLevelMap[section.level] || HeadingLevel.HEADING_2,
      spacing: { before: 300, after: 200 },
    })
  );

  // Process paragraphs
  for (const para of section.paragraphs || []) {
    children.push(createDocxParagraph(para));
  }

  // Process tables
  for (const table of section.tables || []) {
    children.push(createDocxTable(table));
  }

  // Process images
  for (const image of section.images || []) {
    const imagePara = await createDocxImage(image);
    if (imagePara) {
      children.push(imagePara);
    }
  }

  // Process subsections recursively
  if (section.subsections) {
    for (const subsection of section.subsections) {
      await processDocSection(subsection, children);
    }
  }
}

function createDocxParagraph(para: Paragraph): DocxParagraph {
  const textRuns: TextRun[] = [];
  
  const textRun = new TextRun({
    text: para.text,
    bold: para.formatting?.bold,
    italics: para.formatting?.italic,
    underline: para.formatting?.underline ? {} : undefined,
    strike: para.formatting?.strikethrough,
    size: para.formatting?.fontSize ? para.formatting.fontSize * 2 : undefined,
    font: para.formatting?.fontFamily,
    color: para.formatting?.color?.replace("#", ""),
  });
  textRuns.push(textRun);

  const alignmentMap: Record<string, typeof AlignmentType[keyof typeof AlignmentType]> = {
    left: AlignmentType.LEFT,
    center: AlignmentType.CENTER,
    right: AlignmentType.RIGHT,
    justify: AlignmentType.JUSTIFIED,
  };

  let bullet: { level: number } | undefined;
  let numbering: { reference: string; level: number } | undefined;

  if (para.listType === "bullet") {
    bullet = { level: para.listLevel || 0 };
  }

  return new DocxParagraph({
    children: textRuns,
    alignment: para.formatting?.alignment ? alignmentMap[para.formatting.alignment] : undefined,
    indent: para.indent ? { left: convertInchesToTwip(para.indent * 0.5) } : undefined,
    spacing: { line: para.lineSpacing ? para.lineSpacing * 240 : undefined },
    bullet,
    style: para.style === "quote" ? "Quote" : para.style === "code" ? "Code" : undefined,
  });
}

function createDocxTable(table: DocTable): Table {
  const rows: TableRow[] = [];

  // Header row
  rows.push(
    new TableRow({
      children: table.headers.map(
        (header, idx) =>
          new TableCell({
            children: [new DocxParagraph({ text: header, bold: true })],
            width: table.columnWidths?.[idx]
              ? { size: table.columnWidths[idx] * 100, type: WidthType.DXA }
              : { size: 100 / table.headers.length, type: WidthType.PERCENTAGE },
            shading: { fill: "F0F0F0" },
          })
      ),
      tableHeader: true,
    })
  );

  // Data rows
  for (const row of table.rows) {
    rows.push(
      new TableRow({
        children: row.map((cell, idx) => {
          const cellContent = typeof cell === "string" ? cell : cell.content;
          const cellStyle = typeof cell === "object" ? cell.style : undefined;
          const bgColor = typeof cell === "object" ? cell.backgroundColor : undefined;

          return new TableCell({
            children: [
              new DocxParagraph({
                children: [
                  new TextRun({
                    text: cellContent,
                    bold: cellStyle?.bold,
                    italics: cellStyle?.italic,
                  }),
                ],
              }),
            ],
            width: table.columnWidths?.[idx]
              ? { size: table.columnWidths[idx] * 100, type: WidthType.DXA }
              : { size: 100 / table.headers.length, type: WidthType.PERCENTAGE },
            shading: bgColor ? { fill: bgColor.replace("#", "") } : undefined,
            rowSpan: typeof cell === "object" ? cell.rowSpan : undefined,
            columnSpan: typeof cell === "object" ? cell.colSpan : undefined,
          });
        }),
      })
    );
  }

  return new Table({
    rows,
    width: { size: 100, type: WidthType.PERCENTAGE },
  });
}

async function createDocxImage(image: DocImage): Promise<DocxParagraph | null> {
  try {
    // For now, we'll create a placeholder for images
    // In a real implementation, you'd fetch the image data and use ImageRun
    const alignmentMap: Record<string, typeof AlignmentType[keyof typeof AlignmentType]> = {
      left: AlignmentType.LEFT,
      center: AlignmentType.CENTER,
      right: AlignmentType.RIGHT,
      inline: AlignmentType.LEFT,
    };

    // If it's base64 data, we can use it directly
    if (image.src.startsWith("data:image")) {
      const base64Data = image.src.split(",")[1];
      const imageBuffer = Buffer.from(base64Data, "base64");
      
      return new DocxParagraph({
        children: [
          new ImageRun({
            data: imageBuffer,
            transformation: {
              width: image.width || 400,
              height: image.height || 300,
            },
            type: "png",
          }),
        ],
        alignment: alignmentMap[image.alignment] || AlignmentType.CENTER,
      });
    }

    // For URLs, create a placeholder text
    return new DocxParagraph({
      text: `[Image: ${image.alt || image.src}]`,
      alignment: alignmentMap[image.alignment] || AlignmentType.CENTER,
      spacing: { before: 200, after: 200 },
    });
  } catch (error) {
    console.warn(`Failed to process image: ${error}`);
    return null;
  }
}

// ============================================
// Spreadsheet Renderer (XLSX)
// ============================================

export async function renderSpreadsheet(
  spec: SheetSpec
): Promise<{ buffer: Buffer; filename: string }> {
  try {
    const workbook = new ExcelJS.Workbook();
    
    // Set workbook properties
    workbook.creator = spec.metadata?.author || "ArtifactRenderer";
    workbook.created = spec.metadata?.createdAt || new Date();
    workbook.modified = spec.metadata?.updatedAt || new Date();

    // Process each worksheet
    for (const sheetSpec of spec.sheets) {
      await processWorksheet(workbook, sheetSpec);
    }

    // Process charts (add to first sheet by default)
    if (spec.charts && spec.charts.length > 0 && workbook.worksheets.length > 0) {
      // Note: ExcelJS has limited chart support, so we'll add chart data as a note
      for (const chart of spec.charts) {
        console.log(`Chart "${chart.title || 'Untitled'}" defined for range ${chart.dataRange}`);
      }
    }

    // Apply conditional formatting
    for (const format of spec.conditionalFormats || []) {
      applyConditionalFormat(workbook, format);
    }

    // Add named ranges
    if (spec.namedRanges) {
      for (const [name, range] of Object.entries(spec.namedRanges)) {
        // ExcelJS doesn't directly support named ranges, log for now
        console.log(`Named range: ${name} = ${range}`);
      }
    }

    const buffer = await workbook.xlsx.writeBuffer();
    const filename = sanitizeFilename(spec.name) + ".xlsx";

    return { buffer: Buffer.from(buffer), filename };
  } catch (error) {
    throw new Error(`Failed to render spreadsheet: ${error instanceof Error ? error.message : String(error)}`);
  }
}

async function processWorksheet(
  workbook: ExcelJS.Workbook,
  sheetSpec: Worksheet
): Promise<void> {
  const worksheet = workbook.addWorksheet(sheetSpec.name, {
    properties: {
      tabColor: sheetSpec.tabColor ? { argb: sheetSpec.tabColor.replace("#", "FF") } : undefined,
    },
    state: sheetSpec.hidden ? "hidden" : "visible",
  });

  // Set frozen panes
  if (sheetSpec.frozenRows || sheetSpec.frozenColumns) {
    worksheet.views = [
      {
        state: "frozen",
        xSplit: sheetSpec.frozenColumns || 0,
        ySplit: sheetSpec.frozenRows || 0,
      },
    ];
  }

  // Set column widths
  if (sheetSpec.columnWidths) {
    for (const [col, width] of Object.entries(sheetSpec.columnWidths)) {
      const colNum = columnLetterToNumber(col);
      worksheet.getColumn(colNum).width = width;
    }
  }

  // Set row heights
  if (sheetSpec.rowHeights) {
    for (const [row, height] of Object.entries(sheetSpec.rowHeights)) {
      worksheet.getRow(parseInt(row)).height = height;
    }
  }

  // Process cells
  for (const [address, cellSpec] of Object.entries(sheetSpec.cells || {})) {
    const cell = worksheet.getCell(address);
    applyCellSpec(cell, cellSpec);
  }

  // Process merged cells
  for (const merge of sheetSpec.mergedCells || []) {
    try {
      worksheet.mergeCells(`${merge.startCell}:${merge.endCell}`);
    } catch (e) {
      console.warn(`Failed to merge cells ${merge.startCell}:${merge.endCell}: ${e}`);
    }
  }

  // Apply protection if needed
  if (sheetSpec.protected) {
    await worksheet.protect("", {
      selectLockedCells: true,
      selectUnlockedCells: true,
    });
  }
}

function applyCellSpec(cell: ExcelJS.Cell, spec: CellSpec): void {
  // Set value or formula
  if (spec.formula) {
    cell.value = { formula: spec.formula.replace(/^=/, ""), result: undefined };
  } else if (spec.value !== undefined && spec.value !== null) {
    cell.value = spec.value;
  }

  // Apply number format
  if (spec.format || spec.formatPattern) {
    const formatMap: Record<string, string> = {
      general: "General",
      number: "0.00",
      currency: '"$"#,##0.00',
      accounting: '_("$"* #,##0.00_)',
      date: "yyyy-mm-dd",
      time: "h:mm:ss AM/PM",
      percentage: "0.00%",
      fraction: "# ?/?",
      scientific: "0.00E+00",
      text: "@",
    };
    cell.numFmt = spec.formatPattern || formatMap[spec.format || "general"] || "General";
  }

  // Apply style
  if (spec.style) {
    const style = spec.style;

    // Font
    cell.font = {
      bold: style.bold,
      italic: style.italic,
      underline: style.underline,
      strike: style.strikethrough,
      size: style.fontSize,
      name: style.fontFamily,
      color: style.color ? { argb: "FF" + style.color.replace("#", "") } : undefined,
    };

    // Fill
    if (style.backgroundColor) {
      cell.fill = {
        type: "pattern",
        pattern: "solid",
        fgColor: { argb: "FF" + style.backgroundColor.replace("#", "") },
      };
    }

    // Alignment
    cell.alignment = {
      horizontal: style.horizontalAlignment as ExcelJS.Alignment["horizontal"],
      vertical: style.verticalAlignment as ExcelJS.Alignment["vertical"],
      wrapText: style.wrapText,
      textRotation: style.rotation,
    };

    // Border
    if (style.border) {
      cell.border = {
        top: style.border.top ? convertBorderStyle(style.border.top) : undefined,
        bottom: style.border.bottom ? convertBorderStyle(style.border.bottom) : undefined,
        left: style.border.left ? convertBorderStyle(style.border.left) : undefined,
        right: style.border.right ? convertBorderStyle(style.border.right) : undefined,
      };
    }
  }

  // Add comment
  if (spec.comment) {
    cell.note = spec.comment;
  }

  // Add hyperlink
  if (spec.hyperlink) {
    cell.value = {
      text: cell.value?.toString() || spec.hyperlink,
      hyperlink: spec.hyperlink,
    };
  }

  // Apply validation
  if (spec.validation) {
    const validationType = spec.validation.type;
    const criteria = spec.validation.criteria;

    switch (validationType) {
      case "list":
        cell.dataValidation = {
          type: "list",
          formulae: criteria.values ? [criteria.values.join(",")] : [],
          showErrorMessage: true,
          errorTitle: "Invalid Value",
          error: spec.validation.errorMessage || "Please select from the list",
        };
        break;
      case "number":
        cell.dataValidation = {
          type: "decimal",
          operator: criteria.operator || "between",
          formulae: [criteria.min?.toString() || "0", criteria.max?.toString() || "999999"],
          showErrorMessage: true,
          error: spec.validation.errorMessage || "Please enter a valid number",
        };
        break;
    }
  }
}

function convertBorderStyle(border: { width?: number; color?: string; style?: string }): ExcelJS.Border {
  const styleMap: Record<string, ExcelJS.BorderStyle> = {
    solid: "thin",
    dashed: "dashed",
    dotted: "dotted",
    double: "double",
    none: "none",
  };

  return {
    style: styleMap[border.style || "solid"] || "thin",
    color: border.color ? { argb: "FF" + border.color.replace("#", "") } : undefined,
  };
}

function applyConditionalFormat(
  workbook: ExcelJS.Workbook,
  format: { range: string; type: string; rule: Record<string, unknown>; style?: unknown }
): void {
  // ExcelJS has limited conditional formatting support
  // Log for documentation purposes
  console.log(`Conditional format: ${format.type} on range ${format.range}`);
}

function columnLetterToNumber(column: string): number {
  let result = 0;
  for (let i = 0; i < column.length; i++) {
    result *= 26;
    result += column.charCodeAt(i) - "A".charCodeAt(0) + 1;
  }
  return result;
}

// ============================================
// Unified Renderer
// ============================================

export class ArtifactValidationError extends Error {
  constructor(
    message: string,
    public readonly errors: string[],
    public readonly warnings: string[]
  ) {
    super(message);
    this.name = "ArtifactValidationError";
  }
}

export async function renderArtifact(
  artifact: ArtifactSpec,
  runId?: string
): Promise<RenderResult> {
  const effectiveRunId = runId || randomUUID();

  const validation = validateForRendering(artifact);
  
  if (!validation.valid) {
    await agentEventBus.emit(effectiveRunId, "artifact_validation_failed", {
      errors: validation.errors,
      warnings: validation.warnings,
      metadata: { artifactType: artifact.type },
    });
    throw new ArtifactValidationError(
      `Artifact validation failed: ${validation.errors.join("; ")}`,
      validation.errors,
      validation.warnings
    );
  }

  try {
    await agentEventBus.emit(effectiveRunId, "tool_start", {
      tool_name: "artifact_renderer",
      command: `Rendering ${artifact.type} artifact`,
      metadata: { artifactType: artifact.type },
    });

    if (validation.warnings.length > 0) {
      console.warn(`[ArtifactRenderer] Warnings: ${validation.warnings.join("; ")}`);
    }

    let result: { buffer: Buffer; filename: string };
    let mimeType: string;

    // Route to appropriate renderer
    switch (artifact.type) {
      case "presentation":
        result = await renderPresentation(artifact.spec as PresentationSpec);
        mimeType = "application/vnd.openxmlformats-officedocument.presentationml.presentation";
        break;

      case "document":
        result = await renderDocument(artifact.spec as DocSpec);
        mimeType = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
        break;

      case "spreadsheet":
        result = await renderSpreadsheet(artifact.spec as SheetSpec);
        mimeType = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
        break;

      case "image":
      case "code":
      case "data":
      case "app":
        throw new Error(`Renderer for artifact type '${artifact.type}' is not yet implemented`);

      default:
        throw new Error(`Unknown artifact type: ${(artifact as { type: string }).type}`);
    }

    // Emit artifact_ready event
    await agentEventBus.emit(effectiveRunId, "artifact_ready", {
      artifact: {
        type: artifact.type,
        path: result.filename,
        data: result.filename,
      },
      metadata: {
        size: result.buffer.length,
        mimeType,
        filename: result.filename,
      },
    });

    // Emit completion event
    await agentEventBus.emit(effectiveRunId, "tool_end", {
      tool_name: "artifact_renderer",
      output_snippet: `Successfully rendered ${artifact.type}: ${result.filename} (${formatBytes(result.buffer.length)})`,
      metadata: {
        filename: result.filename,
        size: result.buffer.length,
        mimeType,
      },
    });

    return {
      buffer: result.buffer,
      filename: result.filename,
      mimeType,
    };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    
    await agentEventBus.emit(effectiveRunId, "error", {
      error: errorMessage,
      metadata: { artifactType: artifact.type },
    });

    throw error;
  }
}

// ============================================
// Utility Functions
// ============================================

function sanitizePptText(value: string | undefined): string {
  return String(value || "")
    .replace(/\0/g, "")
    .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, "")
    .trim();
}

function normalizeHex(value: string): string {
  return String(value || "").trim().replace("#", "").toUpperCase();
}

function sanitizeFilename(name: string): string {
  return name
    .replace(/[<>:"/\\|?*]/g, "_")
    .replace(/\s+/g, "_")
    .replace(/_+/g, "_")
    .substring(0, 200);
}

function formatBytes(bytes: number): string {
  if (bytes === 0) return "0 Bytes";
  const k = 1024;
  const sizes = ["Bytes", "KB", "MB", "GB"];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + " " + sizes[i];
}

// ============================================
// Exports
// ============================================

export type {
  SlideSpec,
  DocSpec,
  SheetSpec,
} from "./builderSpec";

export {
  SlideSpecSchema,
  DocSpecSchema,
  SheetSpecSchema,
  ArtifactSpecSchema,
} from "./builderSpec";
