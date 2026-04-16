import ExcelJS from 'exceljs';

export interface ColorPalette {
  DARK_BLUE: string;
  MEDIUM_BLUE: string;
  LIGHT_BLUE: string;
  ACCENT_ORANGE: string;
  ACCENT_GREEN: string;
  ACCENT_RED: string;
  ACCENT_PURPLE: string;
  ACCENT_TEAL: string;
  ACCENT_YELLOW: string;
  ACCENT_PINK: string;
  GRAY_50: string;
  GRAY_100: string;
  GRAY_200: string;
  GRAY_300: string;
  GRAY_400: string;
  GRAY_500: string;
  GRAY_600: string;
  GRAY_700: string;
  GRAY_800: string;
  WHITE: string;
  BLACK: string;
  PRIORITY_CRITICAL_BG: string;
  PRIORITY_HIGH_BG: string;
  PRIORITY_MEDIUM_BG: string;
  PRIORITY_LOW_BG: string;
}

export const DEFAULT_COLORS: ColorPalette = {
  DARK_BLUE: 'FF1A365D',
  MEDIUM_BLUE: 'FF2C5282',
  LIGHT_BLUE: 'FFEBF8FF',
  ACCENT_ORANGE: 'FFED8936',
  ACCENT_GREEN: 'FF38A169',
  ACCENT_RED: 'FFE53E3E',
  ACCENT_PURPLE: 'FF805AD5',
  ACCENT_TEAL: 'FF319795',
  ACCENT_YELLOW: 'FFECC94B',
  ACCENT_PINK: 'FFD53F8C',
  GRAY_50: 'FFF7FAFC',
  GRAY_100: 'FFEDF2F7',
  GRAY_200: 'FFE2E8F0',
  GRAY_300: 'FFCBD5E0',
  GRAY_400: 'FFA0AEC0',
  GRAY_500: 'FF718096',
  GRAY_600: 'FF4A5568',
  GRAY_700: 'FF2D3748',
  GRAY_800: 'FF1A202C',
  WHITE: 'FFFFFFFF',
  BLACK: 'FF000000',
  PRIORITY_CRITICAL_BG: 'FFFED7D7',
  PRIORITY_HIGH_BG: 'FFFEEBC8',
  PRIORITY_MEDIUM_BG: 'FFC6F6D5',
  PRIORITY_LOW_BG: 'FFE2E8F0',
};

export type Priority = 'critical' | 'high' | 'medium' | 'low';

export class ExcelStyleConfig {
  private colors: ColorPalette;

  constructor(colors: Partial<ColorPalette> = {}) {
    this.colors = { ...DEFAULT_COLORS, ...colors };
  }

  getColors(): ColorPalette {
    return this.colors;
  }

  getPriorityFill(priority: Priority): ExcelJS.FillPattern {
    const colorMap: Record<Priority, string> = {
      critical: this.colors.PRIORITY_CRITICAL_BG,
      high: this.colors.PRIORITY_HIGH_BG,
      medium: this.colors.PRIORITY_MEDIUM_BG,
      low: this.colors.PRIORITY_LOW_BG,
    };
    return {
      type: 'pattern',
      pattern: 'solid',
      fgColor: { argb: colorMap[priority] },
    };
  }

  getPriorityFont(priority: Priority): Partial<ExcelJS.Font> {
    const fontMap: Record<Priority, { color: string; bold: boolean }> = {
      critical: { color: this.colors.ACCENT_RED, bold: true },
      high: { color: this.colors.ACCENT_ORANGE, bold: true },
      medium: { color: this.colors.ACCENT_GREEN, bold: false },
      low: { color: this.colors.GRAY_500, bold: false },
    };
    const config = fontMap[priority];
    return {
      name: 'Arial',
      size: 10,
      bold: config.bold,
      color: { argb: config.color },
    };
  }

  get thinBorder(): Partial<ExcelJS.Borders> {
    return {
      top: { style: 'thin', color: { argb: this.colors.GRAY_200 } },
      left: { style: 'thin', color: { argb: this.colors.GRAY_200 } },
      bottom: { style: 'thin', color: { argb: this.colors.GRAY_200 } },
      right: { style: 'thin', color: { argb: this.colors.GRAY_200 } },
    };
  }

  get thickBorder(): Partial<ExcelJS.Borders> {
    return {
      top: { style: 'medium', color: { argb: this.colors.DARK_BLUE } },
      left: { style: 'medium', color: { argb: this.colors.DARK_BLUE } },
      bottom: { style: 'medium', color: { argb: this.colors.DARK_BLUE } },
      right: { style: 'medium', color: { argb: this.colors.DARK_BLUE } },
    };
  }

  get headerFill(): ExcelJS.FillPattern {
    return {
      type: 'pattern',
      pattern: 'solid',
      fgColor: { argb: this.colors.DARK_BLUE },
    };
  }

  get altRowFill(): ExcelJS.FillPattern {
    return {
      type: 'pattern',
      pattern: 'solid',
      fgColor: { argb: this.colors.GRAY_50 },
    };
  }

  get titleFont(): Partial<ExcelJS.Font> {
    return {
      name: 'Arial',
      size: 24,
      bold: true,
      color: { argb: this.colors.WHITE },
    };
  }

  get subtitleFont(): Partial<ExcelJS.Font> {
    return {
      name: 'Arial',
      size: 14,
      bold: true,
      color: { argb: this.colors.DARK_BLUE },
    };
  }

  get headerFont(): Partial<ExcelJS.Font> {
    return {
      name: 'Arial',
      size: 11,
      bold: true,
      color: { argb: this.colors.WHITE },
    };
  }

  get bodyFont(): Partial<ExcelJS.Font> {
    return {
      name: 'Arial',
      size: 10,
      color: { argb: this.colors.GRAY_700 },
    };
  }

  get smallFont(): Partial<ExcelJS.Font> {
    return {
      name: 'Arial',
      size: 9,
      color: { argb: this.colors.GRAY_500 },
    };
  }

  get linkFont(): Partial<ExcelJS.Font> {
    return {
      name: 'Arial',
      size: 11,
      color: { argb: this.colors.MEDIUM_BLUE },
      underline: true,
    };
  }

  getAccentFill(accent: 'purple' | 'teal' | 'green' | 'orange' | 'red' | 'pink' | 'yellow'): ExcelJS.FillPattern {
    const colorMap: Record<string, string> = {
      purple: this.colors.ACCENT_PURPLE,
      teal: this.colors.ACCENT_TEAL,
      green: this.colors.ACCENT_GREEN,
      orange: this.colors.ACCENT_ORANGE,
      red: this.colors.ACCENT_RED,
      pink: this.colors.ACCENT_PINK,
      yellow: this.colors.ACCENT_YELLOW,
    };
    return {
      type: 'pattern',
      pattern: 'solid',
      fgColor: { argb: colorMap[accent] },
    };
  }
}

export interface KPICard {
  icon: string;
  title: string;
  value: string | number;
  color: string;
}

export interface DashboardConfig {
  title: string;
  subtitle?: string;
  kpis: KPICard[];
  categoryData?: Array<{ name: string; value: number }>;
  priorityData?: Array<{ name: string; value: number; priority: Priority }>;
}

export class ExcelDashboardBuilder {
  private workbook: ExcelJS.Workbook;
  private styles: ExcelStyleConfig;

  constructor(workbook: ExcelJS.Workbook, styles?: ExcelStyleConfig) {
    this.workbook = workbook;
    this.styles = styles || new ExcelStyleConfig();
  }

  createDashboard(config: DashboardConfig): ExcelJS.Worksheet {
    const ws = this.workbook.addWorksheet('Dashboard');
    const colors = this.styles.getColors();

    for (let row = 1; row <= 60; row++) {
      for (let col = 1; col <= 20; col++) {
        const cell = ws.getCell(row, col);
        cell.fill = {
          type: 'pattern',
          pattern: 'solid',
          fgColor: { argb: colors.WHITE },
        };
      }
    }

    ws.mergeCells('B2:R3');
    const titleCell = ws.getCell('B2');
    titleCell.value = config.title;
    titleCell.font = this.styles.titleFont;
    titleCell.fill = this.styles.headerFill;
    titleCell.alignment = { horizontal: 'center', vertical: 'middle' };

    if (config.subtitle) {
      ws.mergeCells('B4:R4');
      const subtitleCell = ws.getCell('B4');
      subtitleCell.value = config.subtitle;
      subtitleCell.font = { ...this.styles.smallFont, italic: true };
      subtitleCell.alignment = { horizontal: 'center' };
    }

    let colStart = 2;
    for (let i = 0; i < config.kpis.length && i < 6; i++) {
      const kpi = config.kpis[i];
      const col = colStart + i * 3;
      this.createKPICard(ws, 6, col, kpi);
    }

    if (config.categoryData && config.categoryData.length > 0) {
      ws.mergeCells('B14:H14');
      const catTitle = ws.getCell('B14');
      catTitle.value = '📊 DISTRIBUCIÓN POR CATEGORÍA';
      catTitle.font = this.styles.subtitleFont;

      for (let i = 0; i < Math.min(config.categoryData.length, 15); i++) {
        const row = 16 + i;
        const item = config.categoryData[i];
        
        const nameCell = ws.getCell(row, 2);
        nameCell.value = item.name;
        nameCell.font = this.styles.bodyFont;
        
        const valueCell = ws.getCell(row, 3);
        valueCell.value = item.value;
        valueCell.font = this.styles.bodyFont;
        valueCell.alignment = { horizontal: 'center' };
        
        if (i % 2 === 0) {
          nameCell.fill = this.styles.altRowFill;
          valueCell.fill = this.styles.altRowFill;
        }
      }
    }

    if (config.priorityData && config.priorityData.length > 0) {
      ws.mergeCells('B34:H34');
      const priTitle = ws.getCell('B34');
      priTitle.value = '⚡ DISTRIBUCIÓN POR PRIORIDAD';
      priTitle.font = this.styles.subtitleFont;

      for (let i = 0; i < config.priorityData.length; i++) {
        const row = 36 + i;
        const item = config.priorityData[i];
        
        const nameCell = ws.getCell(row, 2);
        nameCell.value = item.name;
        nameCell.fill = this.styles.getPriorityFill(item.priority);
        nameCell.font = this.styles.getPriorityFont(item.priority);
        
        const valueCell = ws.getCell(row, 3);
        valueCell.value = item.value;
        valueCell.font = this.styles.bodyFont;
      }
    }

    ws.getColumn(1).width = 3;
    for (let col = 2; col < 20; col++) {
      ws.getColumn(col).width = 10;
    }

    return ws;
  }

  private createKPICard(
    ws: ExcelJS.Worksheet,
    startRow: number,
    startCol: number,
    kpi: KPICard
  ): void {
    for (let r = startRow; r < startRow + 6; r++) {
      for (let c = startCol; c < startCol + 2; c++) {
        const cell = ws.getCell(r, c);
        cell.fill = {
          type: 'pattern',
          pattern: 'solid',
          fgColor: { argb: kpi.color },
        };
        cell.border = this.styles.thinBorder;
      }
    }

    ws.mergeCells(startRow, startCol, startRow, startCol + 1);
    const iconCell = ws.getCell(startRow, startCol);
    iconCell.value = kpi.icon;
    iconCell.font = { size: 28 };
    iconCell.alignment = { horizontal: 'center' };

    ws.mergeCells(startRow + 1, startCol, startRow + 3, startCol + 1);
    const valueCell = ws.getCell(startRow + 1, startCol);
    valueCell.value = kpi.value;
    valueCell.font = {
      name: 'Arial',
      size: 32,
      bold: true,
      color: { argb: 'FFFFFFFF' },
    };
    valueCell.alignment = { horizontal: 'center', vertical: 'middle' };

    ws.mergeCells(startRow + 4, startCol, startRow + 5, startCol + 1);
    const titleCell = ws.getCell(startRow + 4, startCol);
    titleCell.value = kpi.title;
    titleCell.font = {
      name: 'Arial',
      size: 9,
      bold: true,
      color: { argb: 'FFFFFFFF' },
    };
    titleCell.alignment = { horizontal: 'center', vertical: 'middle', wrapText: true };
  }

  applyProfessionalTableStyle(
    ws: ExcelJS.Worksheet,
    startRow: number,
    headers: string[],
    data: any[][],
    options: {
      freezeHeader?: boolean;
      autoFilter?: boolean;
      alternateRows?: boolean;
      priorityColumn?: number;
    } = {}
  ): void {
    const { freezeHeader = true, autoFilter = true, alternateRows = true, priorityColumn } = options;

    for (let col = 0; col < headers.length; col++) {
      const cell = ws.getCell(startRow, col + 1);
      cell.value = headers[col].toUpperCase();
      cell.font = this.styles.headerFont;
      cell.fill = this.styles.headerFill;
      cell.alignment = { horizontal: 'center', vertical: 'middle', wrapText: true };
      cell.border = this.styles.thinBorder;
    }

    for (let rowIdx = 0; rowIdx < data.length; rowIdx++) {
      const rowData = data[rowIdx];
      for (let colIdx = 0; colIdx < rowData.length; colIdx++) {
        const cell = ws.getCell(startRow + 1 + rowIdx, colIdx + 1);
        cell.value = rowData[colIdx];
        cell.font = this.styles.bodyFont;
        cell.border = this.styles.thinBorder;
        cell.alignment = { vertical: 'middle', wrapText: true };

        if (alternateRows && rowIdx % 2 === 1) {
          cell.fill = this.styles.altRowFill;
        }

        if (priorityColumn !== undefined && colIdx === priorityColumn) {
          const value = String(rowData[colIdx]).toLowerCase();
          let priority: Priority = 'low';
          if (value.includes('crític') || value.includes('critical')) priority = 'critical';
          else if (value.includes('alta') || value.includes('high')) priority = 'high';
          else if (value.includes('media') || value.includes('medium')) priority = 'medium';
          
          cell.fill = this.styles.getPriorityFill(priority);
          cell.font = this.styles.getPriorityFont(priority);
        }
      }
    }

    if (freezeHeader) {
      ws.views = [{ state: 'frozen', ySplit: startRow }];
    }

    if (autoFilter && data.length > 0) {
      const endCol = String.fromCharCode(64 + headers.length);
      ws.autoFilter = {
        from: { row: startRow, column: 1 },
        to: { row: startRow + data.length, column: headers.length },
      };
    }
  }
}

export const defaultExcelStyles = new ExcelStyleConfig();
