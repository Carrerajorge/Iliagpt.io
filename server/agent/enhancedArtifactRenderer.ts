/**
 * Enhanced Artifact Renderer Integration for ILIAGPT PRO 3.0
 * 
 * Extends the existing artifactRenderer with:
 * - Professional PPT themes from pptTemplateEngine
 * - AI image generation for slides
 * - APA 7 citations for documents
 * - Advanced Excel with formulas and charts
 */

import PptxGenJS from "pptxgenjs";
import {
    PROFESSIONAL_THEMES,
    SMART_LAYOUTS,
    getTheme,
    applyThemeToSlide,
    generateImagePrompt,
    formatBulletsWithIcons,
    type ProfessionalTheme
} from "../services/pptTemplateEngine";
import { generatePptDocument } from "../services/documentGeneration";
import {
    formatAPA7Reference,
    formatInTextCitation,
    generateBibliography,
    crossRefToAPACitation,
    type APACitation
} from "../services/apaCitationFormatter";
import type { PresentationSpec, SlideSpec, DocSpec, SheetSpec } from "./builderSpec";

// ============================================
// Enhanced PPT Renderer
// ============================================

export interface EnhancedPresentationOptions {
    themeName?: keyof typeof PROFESSIONAL_THEMES;
    generateImages?: boolean;
    imageGenerator?: (prompt: string) => Promise<string>; // Returns image URL or base64
    includeNotes?: boolean;
    aspectRatio?: "16:9" | "4:3";
}

function sanitizePptText(value: unknown): string {
  return String(value ?? "")
    .replace(/\0/g, "")
    .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, "")
    .trim();
}

export async function renderEnhancedPresentation(
  spec: PresentationSpec,
  options: EnhancedPresentationOptions = {}
): Promise<{ buffer: Buffer; filename: string }> {
  try {
    return await renderEnhancedPresentationCore(spec, options);
  } catch (error: any) {
    const safeTitle = sanitizePptText(spec?.title).substring(0, 500) || "Presentación";
    const fallback = await generatePptDocument(safeTitle, [{
      title: "Fallback",
      content: [
        "No fue posible renderizar la presentación con el motor mejorado.",
        `Error: ${sanitizePptText(error?.message || error).substring(0, 240)}`,
      ],
    }], {
      trace: {
        source: "enhancedArtifactRenderer",
      },
    });

    return {
      buffer: fallback,
      filename: `${sanitizeFilename(safeTitle)}.pptx`,
    };
  }
}

async function renderEnhancedPresentationCore(
  spec: PresentationSpec,
  options: EnhancedPresentationOptions = {}
): Promise<{ buffer: Buffer; filename: string }> {
  const pptx = new PptxGenJS();

    // Get theme
    const themeName = options.themeName || "corporate";
    const theme = getTheme(themeName);

    // Set presentation metadata
    pptx.title = spec.title;
    if (spec.author) pptx.author = spec.author;
    if (spec.metadata?.language) pptx.lang = spec.metadata.language;

    // Set aspect ratio
    if (options.aspectRatio === "4:3") {
        pptx.defineLayout({ name: "LAYOUT_4x3", width: 10, height: 7.5 });
        pptx.layout = "LAYOUT_4x3";
    } else {
        pptx.defineLayout({ name: "LAYOUT_16x9", width: 10, height: 5.625 });
        pptx.layout = "LAYOUT_16x9";
    }

    // Process each slide
    for (let i = 0; i < spec.slides.length; i++) {
        const slideSpec = spec.slides[i];
        const slide = pptx.addSlide();

        // Determine layout type
        const layoutType = mapLayoutType(slideSpec.layout || "content");
        const layout = SMART_LAYOUTS[layoutType];

        // Apply theme background
        applyThemeBackground(slide, theme, layoutType);

        // Add title with theme styling
        if (slideSpec.title) {
            const titleStyle = layout?.title || { x: 0.5, y: 0.3, w: 9, h: 1 };
            slide.addText(slideSpec.title, {
                x: titleStyle.x,
                y: titleStyle.y,
                w: titleStyle.w,
                h: titleStyle.h,
                fontSize: layoutType === "title" ? 44 : 32,
                fontFace: theme.fonts.title,
                bold: true,
                color: theme.colors.title.replace("#", ""),
                align: layoutType === "title" ? "center" : "left"
            });
        }

        // Add subtitle for title slides
        if (slideSpec.subtitle && layoutType === "title") {
            slide.addText(slideSpec.subtitle, {
                x: 0.5,
                y: 3.2,
                w: 9,
                h: 0.75,
                fontSize: 20,
                fontFace: theme.fonts.body,
                color: theme.colors.subtitle.replace("#", ""),
                align: "center"
            });
        }

        // Process content
        const contentY = layoutType === "title" ? 2 : 1.5;
        let currentY = contentY;

        for (const element of slideSpec.elements || []) {
            if (element.type === "text") {
                const textContent = element.content as string;
                const isBulletList = textContent.includes("\n") || textContent.includes("•");

                if (isBulletList) {
                    // Format bullets with icons
                    const bullets = formatBulletsWithIcons(
                        textContent.split("\n").filter(l => l.trim()),
                        slideSpec.title || "General"
                    );

                    for (const bullet of bullets) {
                        slide.addText([
                            { text: bullet.icon + " ", options: { fontSize: 16 } },
                            { text: bullet.text, options: { fontSize: 16, fontFace: theme.fonts.body } }
                        ], {
                            x: layout?.content?.x || 0.5,
                            y: currentY,
                            w: layout?.content?.w || 9,
                            h: 0.4,
                            color: theme.colors.text.replace("#", "")
                        });
                        currentY += 0.5;
                    }
                } else {
                    slide.addText(textContent, {
                        x: layout?.content?.x || 0.5,
                        y: currentY,
                        w: layout?.content?.w || 9,
                        h: 1,
                        fontSize: 18,
                        fontFace: theme.fonts.body,
                        color: theme.colors.text.replace("#", "")
                    });
                    currentY += 1.2;
                }
            }

            if (element.type === "image") {
                const imageUrl = element.content as string;
                const position = element.position || { x: 1, y: currentY, w: 4, h: 3 };

                try {
                    // Check if it's a URL or base64
                    if (imageUrl.startsWith("http") || imageUrl.startsWith("data:")) {
                        slide.addImage({
                            path: imageUrl,
                            x: position.x,
                            y: position.y,
                            w: position.w,
                            h: position.h
                        });
                    }
                    currentY += position.h + 0.3;
                } catch (error) {
                    console.warn("Failed to add image:", error);
                }
            }

            if (element.type === "chart" && element.content) {
                const chartData = element.content as any;
                try {
                    slide.addChart(chartData.type || "bar", chartData.data, {
                        x: layout?.content?.x || 1,
                        y: currentY,
                        w: 8,
                        h: 3,
                        showTitle: !!chartData.title,
                        title: chartData.title,
                        showLegend: true,
                        legendPos: "b"
                    });
                    currentY += 3.5;
                } catch (error) {
                    console.warn("Failed to add chart:", error);
                }
            }

            if (element.type === "table" && element.content) {
                const tableData = element.content as string[][];
                const tableRows: PptxGenJS.TableRow[] = tableData.map((row, rowIdx) =>
                    row.map(cell => ({
                        text: cell,
                        options: {
                            fill: rowIdx === 0 ? theme.colors.primary : "FFFFFF",
                            color: rowIdx === 0 ? "FFFFFF" : "333333",
                            bold: rowIdx === 0,
                            fontSize: 12
                        }
                    }))
                );

                slide.addTable(tableRows, {
                    x: layout?.content?.x || 0.5,
                    y: currentY,
                    w: layout?.content?.w || 9,
                    border: { pt: 0.5, color: "CCCCCC" }
                });
                currentY += tableData.length * 0.4 + 0.5;
            }
        }

        // Generate AI image if enabled and slide has image placeholder
        if (options.generateImages && options.imageGenerator) {
            const hasImage = slideSpec.elements?.some(e => e.type === "image");
            if (!hasImage && layoutType !== "title" && i > 0) {
                const prompt = generateImagePrompt(slideSpec.title || "slide", "illustration");
                try {
                    const imageUrl = await options.imageGenerator(prompt);
                    if (imageUrl) {
                        slide.addImage({
                            path: imageUrl,
                            x: 6,
                            y: 1.5,
                            w: 3.5,
                            h: 3
                        });
                    }
                } catch (error) {
                    console.warn("Failed to generate AI image:", error);
                }
            }
        }

        // Add speaker notes
        if (slideSpec.notes) {
            slide.addNotes(slideSpec.notes);
        }

        // Add slide number (except title slide)
        if (i > 0) {
            slide.addText(`${i + 1}`, {
                x: 9.3,
                y: 5.2,
                w: 0.5,
                h: 0.3,
                fontSize: 10,
                color: theme.colors.subtitle.replace("#", ""),
                align: "right"
            });
        }

        // Add footer line
        if (i > 0 && theme.slideStyles.footer) {
            slide.addShape("rect", {
                x: 0,
                y: 5.4,
                w: 10,
                h: 0.05,
                fill: { color: theme.colors.accent.replace("#", "") }
            });
        }
    }

    // Generate buffer
    const data = await pptx.write({ outputType: "nodebuffer" });
    const buffer = Buffer.from(data as ArrayBuffer);
    const filename = sanitizeFilename(spec.title) + ".pptx";

    return { buffer, filename };
}

function mapLayoutType(layout: string): keyof typeof SMART_LAYOUTS {
    const mapping: Record<string, keyof typeof SMART_LAYOUTS> = {
        "title": "title",
        "title-content": "content",
        "content": "content",
        "two-column": "two_column",
        "image-left": "image_left",
        "image-right": "image_right",
        "comparison": "comparison",
        "quote": "quote",
        "data": "data"
    };
    return mapping[layout] || "content";
}

function applyThemeBackground(
    slide: PptxGenJS.Slide,
    theme: ProfessionalTheme,
    layoutType: string
): void {
    const bg = theme.slideStyles.background;

    if (layoutType === "title") {
        // Gradient for title slides
        slide.background = { color: theme.colors.primary.replace("#", "") };
    } else if (bg.gradient) {
        slide.background = { color: bg.gradient.colors[0].replace("#", "") };
    } else if (bg.color) {
        slide.background = { color: bg.color.replace("#", "") };
    }
}

// ============================================
// Enhanced Document Renderer with APA
// ============================================

export interface EnhancedDocumentOptions {
    includeTableOfContents?: boolean;
    includeBibliography?: boolean;
    citationStyle?: "apa7";
    citations?: APACitation[];
}

export function generateAPABibliography(citations: APACitation[]): string {
    return generateBibliography(citations);
}

export function formatAPACitation(citation: APACitation, format: "parenthetical" | "narrative" = "parenthetical"): string {
    return formatInTextCitation(citation, format);
}

export function convertCrossRefToAPA(crossRefData: any): APACitation {
    return crossRefToAPACitation(crossRefData);
}

// ============================================
// Enhanced Spreadsheet Renderer
// ============================================

export interface EnhancedSpreadsheetOptions {
    autoFormulas?: boolean;
    includeCharts?: boolean;
    conditionalFormatting?: boolean;
    autoColumnWidth?: boolean;
}

export interface FormulaDefinition {
    cell: string;
    formula: string;
    format?: string;
}

export interface ChartDefinition {
    type: "bar" | "line" | "pie" | "scatter" | "area";
    title: string;
    dataRange: string;
    position: { row: number; col: number };
    size: { width: number; height: number };
}

export function generateAutoFormulas(
    data: any[][],
    options: { sumRows?: boolean; sumCols?: boolean; average?: boolean } = {}
): FormulaDefinition[] {
    const formulas: FormulaDefinition[] = [];
    const numRows = data.length;
    const numCols = data[0]?.length || 0;

    // Check if first row is header
    const hasHeader = typeof data[0]?.[0] === "string" && isNaN(parseFloat(data[0][0]));
    const dataStartRow = hasHeader ? 2 : 1;

    // Sum rows
    if (options.sumRows && numCols > 1) {
        for (let row = dataStartRow; row <= numRows; row++) {
            const startCol = String.fromCharCode(66); // B
            const endCol = String.fromCharCode(65 + numCols - 1);
            formulas.push({
                cell: `${String.fromCharCode(65 + numCols)}${row}`,
                formula: `=SUM(${startCol}${row}:${endCol}${row})`,
                format: "#,##0"
            });
        }
    }

    // Sum columns
    if (options.sumCols && numRows > 1) {
        const totalRow = numRows + 1;
        for (let col = 1; col < numCols; col++) {
            const colLetter = String.fromCharCode(65 + col);
            formulas.push({
                cell: `${colLetter}${totalRow}`,
                formula: `=SUM(${colLetter}${dataStartRow}:${colLetter}${numRows})`,
                format: "#,##0"
            });
        }
        // Add "Total" label
        formulas.push({
            cell: `A${totalRow}`,
            formula: `="Total"`,
            format: "@"
        });
    }

    // Average
    if (options.average && numRows > 2) {
        const avgRow = numRows + (options.sumCols ? 2 : 1);
        for (let col = 1; col < numCols; col++) {
            const colLetter = String.fromCharCode(65 + col);
            formulas.push({
                cell: `${colLetter}${avgRow}`,
                formula: `=AVERAGE(${colLetter}${dataStartRow}:${colLetter}${numRows})`,
                format: "#,##0.00"
            });
        }
        formulas.push({
            cell: `A${avgRow}`,
            formula: `="Promedio"`,
            format: "@"
        });
    }

    return formulas;
}

export function suggestCharts(data: any[][]): ChartDefinition[] {
    const suggestions: ChartDefinition[] = [];
    const numRows = data.length;
    const numCols = data[0]?.length || 0;

    if (numRows < 2 || numCols < 2) return suggestions;

    // Check if numeric data
    const hasNumericData = data.slice(1).some(row =>
        row.slice(1).some(cell => typeof cell === "number" || !isNaN(parseFloat(cell)))
    );

    if (!hasNumericData) return suggestions;

    // Suggest bar chart for comparison
    if (numRows <= 10) {
        suggestions.push({
            type: "bar",
            title: "Comparación de Datos",
            dataRange: `A1:${String.fromCharCode(65 + numCols - 1)}${numRows}`,
            position: { row: 1, col: numCols + 2 },
            size: { width: 500, height: 300 }
        });
    }

    // Suggest line chart for trends (more rows)
    if (numRows > 5) {
        suggestions.push({
            type: "line",
            title: "Tendencia",
            dataRange: `A1:${String.fromCharCode(65 + numCols - 1)}${numRows}`,
            position: { row: 16, col: numCols + 2 },
            size: { width: 500, height: 300 }
        });
    }

    // Suggest pie chart for single series with few items
    if (numRows <= 8 && numCols === 2) {
        suggestions.push({
            type: "pie",
            title: "Distribución",
            dataRange: `A1:B${numRows}`,
            position: { row: 32, col: numCols + 2 },
            size: { width: 400, height: 400 }
        });
    }

    return suggestions;
}

// ============================================
// Utilities
// ============================================

function sanitizeFilename(name: string): string {
    return name
        .replace(/[<>:"/\\|?*]/g, "")
        .replace(/\s+/g, "_")
        .substring(0, 100);
}

export {
    PROFESSIONAL_THEMES,
    getTheme,
    formatAPA7Reference,
    generateBibliography
};
