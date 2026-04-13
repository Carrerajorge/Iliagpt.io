/**
 * Advanced Excel Builder for ILIAGPT PRO 3.0
 * 
 * Features:
 * - Smart formula generation
 * - Professional chart creation
 * - Conditional formatting
 * - Data validation
 * - Pivot table preparation
 * - Named ranges
 */

import ExcelJS from "exceljs";
import { randomUUID } from "crypto";

// ============================================
// Types
// ============================================

export interface ExcelBuilderOptions {
    title: string;
    author?: string;
    sheets: SheetDefinition[];
    theme?: ExcelTheme;
}

export interface SheetDefinition {
    name: string;
    data: any[][];
    options?: SheetOptions;
}

export interface SheetOptions {
    autoFormulas?: boolean;
    includeCharts?: boolean;
    conditionalFormatting?: boolean;
    autoColumnWidth?: boolean;
    freezeHeader?: boolean;
    namedRanges?: NamedRange[];
    validation?: DataValidation[];
}

export interface NamedRange {
    name: string;
    range: string;
    sheet?: string;
}

export interface DataValidation {
    range: string;
    type: "list" | "number" | "date" | "custom";
    values?: string[];
    min?: number;
    max?: number;
    formula?: string;
    errorMessage?: string;
}

export interface ExcelTheme {
    headerFill: string;
    headerFont: string;
    alternateFill: string;
    accentColor: string;
    fontFamily: string;
}

export interface ChartConfig {
    type: "bar" | "line" | "pie" | "scatter" | "area" | "column";
    title: string;
    dataRange: {
        labels: string;
        values: string | string[];
    };
    position: {
        cell: string;
        width: number;
        height: number;
    };
    options?: {
        showLegend?: boolean;
        showDataLabels?: boolean;
        colors?: string[];
    };
}

export interface ConditionalFormatRule {
    range: string;
    type: "colorScale" | "dataBar" | "iconSet" | "cellIs";
    priority: number;
    rule: any;
}

// ============================================
// Default Themes
// ============================================

const EXCEL_THEMES: Record<string, ExcelTheme> = {
    professional: {
        headerFill: "1F4E79",
        headerFont: "FFFFFF",
        alternateFill: "F7FAFC",
        accentColor: "4472C4",
        fontFamily: "Calibri"
    },
    modern: {
        headerFill: "5B5EA6",
        headerFont: "FFFFFF",
        alternateFill: "E8E8F0",
        accentColor: "9B59B6",
        fontFamily: "Segoe UI"
    },
    minimal: {
        headerFill: "F3F3F3",
        headerFont: "333333",
        alternateFill: "FAFAFA",
        accentColor: "666666",
        fontFamily: "Arial"
    },
    vibrant: {
        headerFill: "FF6B6B",
        headerFont: "FFFFFF",
        alternateFill: "FEE2E2",
        accentColor: "EF4444",
        fontFamily: "Calibri"
    }
};

// ============================================
// Formula Generators
// ============================================

export function generateFormulas(
    data: any[][],
    options: {
        sumColumns?: boolean;
        sumRows?: boolean;
        average?: boolean;
        variance?: boolean;
        percentages?: boolean;
    } = {}
): { cell: string; formula: string }[] {
    const formulas: { cell: string; formula: string }[] = [];
    const numRows = data.length;
    const numCols = data[0]?.length || 0;

    // Detect if first row is header
    const hasHeader = typeof data[0]?.[0] === "string";
    const dataStartRow = hasHeader ? 2 : 1;
    const dataEndRow = numRows;

    // Column letters helper
    const colLetter = (n: number) => String.fromCharCode(65 + n);

    if (options.sumColumns) {
        const sumRow = dataEndRow + 1;
        for (let col = 1; col < numCols; col++) {
            const letter = colLetter(col);
            formulas.push({
                cell: `${letter}${sumRow}`,
                formula: `=SUM(${letter}${dataStartRow}:${letter}${dataEndRow})`
            });
        }
        formulas.push({ cell: `A${sumRow}`, formula: `="TOTAL"` });
    }

    if (options.sumRows) {
        const sumCol = colLetter(numCols);
        for (let row = dataStartRow; row <= dataEndRow; row++) {
            formulas.push({
                cell: `${sumCol}${row}`,
                formula: `=SUM(B${row}:${colLetter(numCols - 1)}${row})`
            });
        }
        if (hasHeader) {
            formulas.push({ cell: `${sumCol}1`, formula: `="Subtotal"` });
        }
    }

    if (options.average) {
        const avgRow = (options.sumColumns ? dataEndRow + 2 : dataEndRow + 1);
        for (let col = 1; col < numCols; col++) {
            const letter = colLetter(col);
            formulas.push({
                cell: `${letter}${avgRow}`,
                formula: `=AVERAGE(${letter}${dataStartRow}:${letter}${dataEndRow})`
            });
        }
        formulas.push({ cell: `A${avgRow}`, formula: `="PROMEDIO"` });
    }

    if (options.variance) {
        const varRow = (options.average ?
            (options.sumColumns ? dataEndRow + 3 : dataEndRow + 2) :
            (options.sumColumns ? dataEndRow + 2 : dataEndRow + 1));
        for (let col = 1; col < numCols; col++) {
            const letter = colLetter(col);
            formulas.push({
                cell: `${letter}${varRow}`,
                formula: `=VAR(${letter}${dataStartRow}:${letter}${dataEndRow})`
            });
        }
        formulas.push({ cell: `A${varRow}`, formula: `="VARIANZA"` });
    }

    if (options.percentages && numCols >= 2) {
        const pctCol = colLetter(numCols + (options.sumRows ? 1 : 0));
        const totalCol = colLetter(1);
        const totalCell = options.sumColumns ? `${totalCol}${dataEndRow + 1}` :
            `SUM(${totalCol}${dataStartRow}:${totalCol}${dataEndRow})`;

        for (let row = dataStartRow; row <= dataEndRow; row++) {
            formulas.push({
                cell: `${pctCol}${row}`,
                formula: `=${totalCol}${row}/${totalCell}`
            });
        }
        if (hasHeader) {
            formulas.push({ cell: `${pctCol}1`, formula: `="% del Total"` });
        }
    }

    return formulas;
}

// ============================================
// Advanced Excel Builder
// ============================================

export class AdvancedExcelBuilder {
    private workbook: ExcelJS.Workbook;
    private theme: ExcelTheme;

    constructor(options: { theme?: string | ExcelTheme } = {}) {
        this.workbook = new ExcelJS.Workbook();
        this.theme = typeof options.theme === "string"
            ? EXCEL_THEMES[options.theme] || EXCEL_THEMES.professional
            : options.theme || EXCEL_THEMES.professional;

        // Set workbook properties
        this.workbook.creator = "ILIAGPT PRO";
        this.workbook.created = new Date();
    }

    private resolveUniqueSheetName(name: string): string {
        const preferred = String(name || "Hoja")
            .trim()
            .slice(0, 31) || "Hoja";

        const existing = new Set(
            this.workbook.worksheets.map((worksheet) => worksheet.name.toLowerCase()),
        );

        if (!existing.has(preferred.toLowerCase())) {
            return preferred;
        }

        for (let index = 2; index < 100; index += 1) {
            const suffix = `_${index}`;
            const base = preferred.slice(0, Math.max(1, 31 - suffix.length)).trim() || "Hoja";
            const candidate = `${base}${suffix}`;
            if (!existing.has(candidate.toLowerCase())) {
                return candidate;
            }
        }

        return `Hoja_${Date.now()}`.slice(0, 31);
    }

    /**
     * Add a sheet with data and formatting
     */
    addSheet(name: string, data: any[][], options: SheetOptions = {}): ExcelJS.Worksheet {
        const sheet = this.workbook.addWorksheet(this.resolveUniqueSheetName(name));
        const numCols = data[0]?.length || 0;

        // Detect if last row is a total/summary row
        const lastRow = data.length > 1 ? data[data.length - 1] : null;
        const isTotalRow = (row: any[]) => {
            if (!row || row.length === 0) return false;
            const firstCell = String(row[0] || "").toUpperCase().trim();
            return /^(TOTAL|TOTALES?|RESUMEN|SUMMARY|GRAND TOTAL|SUBTOTAL|PROMEDIO|AVERAGE)/.test(firstCell);
        };
        const lastRowIsTotal = lastRow ? isTotalRow(lastRow) : false;

        // Add data
        data.forEach((row, rowIndex) => {
            const excelRow = sheet.addRow(row);
            const isLastRow = rowIndex === data.length - 1;
            const isThisTotalRow = isLastRow && lastRowIsTotal;

            // Style header row
            if (rowIndex === 0 && options.freezeHeader !== false) {
                excelRow.height = 22;
                excelRow.eachCell((cell) => {
                    cell.fill = {
                        type: "pattern",
                        pattern: "solid",
                        fgColor: { argb: this.theme.headerFill }
                    };
                    cell.font = {
                        bold: true,
                        color: { argb: this.theme.headerFont },
                        name: this.theme.fontFamily,
                        size: 11,
                    };
                    cell.alignment = { horizontal: "center", vertical: "middle", wrapText: true };
                    cell.border = {
                        top: { style: "thin", color: { argb: this.theme.headerFill } },
                        bottom: { style: "medium", color: { argb: this.theme.accentColor } },
                        left: { style: "thin", color: { argb: this.theme.headerFill } },
                        right: { style: "thin", color: { argb: this.theme.headerFill } },
                    };
                });
            }
            // Bold total/summary row
            else if (isThisTotalRow) {
                excelRow.eachCell((cell) => {
                    cell.font = {
                        bold: true,
                        name: this.theme.fontFamily,
                        size: 11,
                    };
                    cell.fill = {
                        type: "pattern",
                        pattern: "solid",
                        fgColor: { argb: "E2E8F0" }
                    };
                    cell.border = {
                        top: { style: "medium", color: { argb: this.theme.accentColor } },
                        bottom: { style: "double", color: { argb: this.theme.headerFill } },
                    };
                });
            }
            // Alternate row coloring (white / light blue-gray)
            else if (rowIndex > 0) {
                excelRow.eachCell((cell) => {
                    if (rowIndex % 2 === 0) {
                        cell.fill = {
                            type: "pattern",
                            pattern: "solid",
                            fgColor: { argb: this.theme.alternateFill }
                        };
                    }
                    cell.font = { name: this.theme.fontFamily, size: 11 };
                    cell.border = {
                        bottom: { style: "thin", color: { argb: "E2E8F0" } },
                    };
                });
            }

            // Apply number formatting to numeric cells in data rows (not header)
            if (rowIndex > 0) {
                excelRow.eachCell((cell) => {
                    const val = cell.value;
                    if (typeof val === "number") {
                        // Detect likely currency/price columns (values with 2 decimals or > 100)
                        if (Number.isFinite(val) && !Number.isInteger(val)) {
                            cell.numFmt = '#,##0.00';
                        } else if (Number.isFinite(val) && Number.isInteger(val)) {
                            cell.numFmt = '#,##0';
                        }
                        cell.alignment = { horizontal: "right" };
                    }
                });
            }
        });

        // Freeze header row
        if (options.freezeHeader !== false && data.length > 0) {
            sheet.views = [{ state: "frozen", ySplit: 1 }];
        }

        // Auto column width
        if (options.autoColumnWidth !== false) {
            sheet.columns.forEach((column, i) => {
                let maxLength = 10;
                data.forEach(row => {
                    const cellValue = row[i]?.toString() || "";
                    maxLength = Math.max(maxLength, cellValue.length);
                });
                column.width = Math.min(maxLength + 2, 50);
            });
        }

        // Auto formulas
        if (options.autoFormulas) {
            const formulas = generateFormulas(data, {
                sumColumns: true,
                average: true
            });

            for (const f of formulas) {
                const cell = sheet.getCell(f.cell);
                cell.value = { formula: f.formula.replace("=", "") };

                // Style formula cells
                cell.font = { bold: true, name: this.theme.fontFamily };
                cell.fill = {
                    type: "pattern",
                    pattern: "solid",
                    fgColor: { argb: "FFF2CC" }
                };
            }
        }

        // Add conditional formatting
        if (options.conditionalFormatting) {
            this.applyAutoConditionalFormatting(sheet, data);
        }

        // Add named ranges
        if (options.namedRanges) {
            for (const nr of options.namedRanges) {
                this.workbook.definedNames.add(nr.range, nr.name);
            }
        }

        // Add data validation
        if (options.validation) {
            for (const v of options.validation) {
                const [start, end] = v.range.split(":");

                if (v.type === "list" && v.values) {
                    sheet.dataValidations.add(v.range, {
                        type: "list",
                        allowBlank: true,
                        formulae: [`"${v.values.join(",")}"`],
                        showErrorMessage: true,
                        errorTitle: "Valor inválido",
                        error: v.errorMessage || "Por favor seleccione un valor de la lista"
                    });
                } else if (v.type === "number") {
                    sheet.dataValidations.add(v.range, {
                        type: "whole",
                        allowBlank: true,
                        operator: "between",
                        formulae: [v.min || 0, v.max || 1000000],
                        showErrorMessage: true,
                        errorTitle: "Número inválido",
                        error: v.errorMessage || `El valor debe estar entre ${v.min} y ${v.max}`
                    });
                }
            }
        }

        return sheet;
    }

    /**
     * Apply automatic conditional formatting
     */
    private applyAutoConditionalFormatting(sheet: ExcelJS.Worksheet, data: any[][]): void {
        const numRows = data.length;
        const numCols = data[0]?.length || 0;

        // Find numeric columns
        for (let col = 1; col < numCols; col++) {
            const colLetter = String.fromCharCode(65 + col);
            const values = data.slice(1).map(row => parseFloat(row[col])).filter(v => !isNaN(v));

            if (values.length > 0) {
                const range = `${colLetter}2:${colLetter}${numRows}`;
                const hasNegative = values.some(v => v < 0);

<<<<<<< HEAD
                if (hasNegative) {
                    // Red for negative, green for positive
                    sheet.addConditionalFormatting({
                        ref: range,
                        rules: [
                            {
                                type: "cellIs",
                                priority: 1,
                                operator: "lessThan",
                                formulae: [0],
                                style: { font: { color: { argb: "FF9C0006" } }, fill: { type: "pattern", pattern: "solid", bgColor: { argb: "FFFFC7CE" } } },
                            },
                            {
                                type: "cellIs",
                                priority: 2,
                                operator: "greaterThan",
                                formulae: [0],
                                style: { font: { color: { argb: "FF006100" } }, fill: { type: "pattern", pattern: "solid", bgColor: { argb: "FFC6EFCE" } } },
                            },
                        ],
                    });
                } else {
                    // Color scale: green to yellow to red
                    sheet.addConditionalFormatting({
                        ref: range,
                        rules: [{
                            type: "colorScale",
                            priority: 1,
                            cfvo: [
                                { type: "min" },
                                { type: "percentile", value: 50 },
                                { type: "max" },
                            ],
                            color: [
                                { argb: "FFF8696B" },
                                { argb: "FFFFEB84" },
                                { argb: "FF63BE7B" },
                            ],
                        }],
                    });
                }
=======
                // Add data bar
                sheet.addConditionalFormatting({
                    ref: range,
                    rules: [{
                        type: "cellIs",
                        priority: 1,
                        operator: "greaterThan",
                        formulae: [String(Math.min(...values))],
                        style: {
                            fill: {
                                type: "pattern",
                                pattern: "solid",
                                fgColor: { argb: this.theme.alternateFill },
                                bgColor: { argb: this.theme.alternateFill },
                            },
                            font: {
                                color: { argb: this.theme.accentColor },
                                bold: true,
                            },
                        },
                    }]
                });
>>>>>>> 60c9fbaa (feat: improve professional document generation and add sprint e2e coverage)
            }
        }
    }

    /**
     * Add a chart to a sheet
     */
    addChart(sheet: ExcelJS.Worksheet, config: ChartConfig): void {
        // ExcelJS chart support is limited, but we can add chart objects
        // In production, this would use a more complete charting solution

        // Add a placeholder note where chart would go
        const cell = sheet.getCell(config.position.cell);
        cell.value = `[Chart: ${config.title}]`;
        cell.note = {
            texts: [{
                text: `Chart Type: ${config.type}\n` +
                    `Data: ${JSON.stringify(config.dataRange)}\n` +
                    `Size: ${config.position.width}x${config.position.height}`
            }]
        };
    }

    /**
     * Add summary statistics sheet
     */
    addSummarySheet(dataSheetName: string, data: any[][]): ExcelJS.Worksheet {
        const sheet = this.workbook.addWorksheet(this.resolveUniqueSheetName("Resumen"));
        const numCols = data[0]?.length || 0;
        const numRows = data.length - 1; // Exclude header

        // Header
        sheet.addRow(["Estadística", ...data[0].slice(1)]);

        // Statistics
        const stats = ["Suma", "Promedio", "Mínimo", "Máximo", "Conteo", "Varianza"];
        const formulas = ["SUM", "AVERAGE", "MIN", "MAX", "COUNT", "VAR"];

        stats.forEach((stat, i) => {
            const row = [stat];
            for (let col = 1; col < numCols; col++) {
                const colLetter = String.fromCharCode(65 + col);
                row.push({ formula: `${formulas[i]}('${dataSheetName}'!${colLetter}2:${colLetter}${numRows + 1})` });
            }
            sheet.addRow(row);
        });

        // Style header
        const headerRow = sheet.getRow(1);
        headerRow.eachCell((cell) => {
            cell.fill = {
                type: "pattern",
                pattern: "solid",
                fgColor: { argb: this.theme.headerFill }
            };
            cell.font = { bold: true, color: { argb: this.theme.headerFont } };
        });

        // Auto width
        sheet.columns.forEach(column => {
            column.width = 15;
        });

        return sheet;
    }

    /**
     * Generate the Excel file
     */
    async build(): Promise<Buffer> {
        const buffer = await this.workbook.xlsx.writeBuffer();
        return Buffer.from(buffer);
    }

    /**
     * Get workbook for advanced customization
     */
    getWorkbook(): ExcelJS.Workbook {
        return this.workbook;
    }
}

// ============================================
// Factory Functions
// ============================================

/**
 * Create Excel from simple data
 */
export async function createExcelFromData(
    data: any[][],
    options: {
        title?: string;
        sheetName?: string;
        theme?: string;
        autoFormulas?: boolean;
        conditionalFormatting?: boolean;
    } = {}
): Promise<{ buffer: Buffer; filename: string }> {
    const builder = new AdvancedExcelBuilder({ theme: options.theme || "professional" });

    builder.addSheet(options.sheetName || "Datos", data, {
        autoFormulas: options.autoFormulas,
        conditionalFormatting: options.conditionalFormatting,
        freezeHeader: true,
        autoColumnWidth: true
    });

    const buffer = await builder.build();
    const filename = `${options.title || "datos"}_${Date.now()}.xlsx`;

    return { buffer, filename };
}

/**
 * Create Excel with multiple sheets
 */
export async function createMultiSheetExcel(
    sheets: Array<{ name: string; data: any[][]; options?: SheetOptions }>,
    options: { title?: string; theme?: string; includeSummary?: boolean } = {}
): Promise<{ buffer: Buffer; filename: string }> {
    const builder = new AdvancedExcelBuilder({ theme: options.theme || "professional" });

    for (const sheet of sheets) {
        builder.addSheet(sheet.name, sheet.data, sheet.options);
    }

    // Add summary sheet if requested
    if (options.includeSummary && sheets.length > 0) {
        builder.addSummarySheet(sheets[0].name, sheets[0].data);
    }

    const buffer = await builder.build();
    const filename = `${options.title || "reporte"}_${Date.now()}.xlsx`;

    return { buffer, filename };
}

export { EXCEL_THEMES };
export default AdvancedExcelBuilder;
