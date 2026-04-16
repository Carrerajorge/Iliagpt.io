import { SparseGrid, CellData } from '@/lib/sparseGrid';
import { FormulaEngine } from '@/lib/formulaEngine';

export const ACTIONS = {
  CREATE_SHEET: 'CREATE_SHEET',
  INSERT_DATA: 'INSERT_DATA',
  INSERT_FORMULA: 'INSERT_FORMULA',
  INSERT_BULK_FORMULAS: 'INSERT_BULK_FORMULAS',
  CREATE_CHART: 'CREATE_CHART',
  APPLY_CONDITIONAL_FORMAT: 'APPLY_CONDITIONAL_FORMAT',
  APPLY_STYLE: 'APPLY_STYLE',
  SET_COLUMN_WIDTH: 'SET_COLUMN_WIDTH',
  MERGE_CELLS: 'MERGE_CELLS'
} as const;

export type ActionType = typeof ACTIONS[keyof typeof ACTIONS];

export interface ExecutionTask {
  action: ActionType;
  params: Record<string, unknown>;
}

export interface PromptAnalysis {
  sheets: string[];
  requiresCharts: boolean;
  chartTypes: ('bar' | 'line' | 'pie' | 'area')[];
  requiresFormulas: boolean;
  formulaTypes: string[];
  requiresConditionalFormat: boolean;
  dataTheme: 'sales' | 'employees' | 'inventory' | null;
  yearRange?: { start: number; end: number };
  isSimpleChartRequest: boolean;
}

export interface ChartDataRange {
  labels: { startRow: number; endRow: number; col: number };
  values: { startRow: number; endRow: number; col: number };
}

export interface ChartConfig {
  id: string;
  type: 'bar' | 'line' | 'pie' | 'area';
  title: string;
  dataRange: ChartDataRange;
  position: { row: number; col: number };
  size: { width: number; height: number };
}

export interface ConditionalFormatRule {
  condition: 'greaterThan' | 'lessThan' | 'equals' | 'between';
  value?: number;
  min?: number;
  max?: number;
  style: {
    backgroundColor?: string;
    color?: string;
  };
}

export interface SheetData {
  id: string;
  name: string;
  grid: SparseGrid;
  charts: ChartConfig[];
  conditionalFormats: Array<{
    range: { startRow: number; endRow: number; startCol: number; endCol: number };
    rules: ConditionalFormatRule[];
  }>;
}

export interface WorkbookData {
  sheets: SheetData[];
  activeSheetId: string;
}

interface ExecutionLogEntry {
  task: ExecutionTask;
  status: 'success' | 'error';
  error?: Error;
  timestamp: number;
}

interface ProgressData {
  current: number;
  total: number;
  task: ActionType;
  params: Record<string, unknown>;
}

interface StreamingHook {
  queueCell: (row: number, col: number, value: string, delay?: number) => void;
  processStreamQueue: () => Promise<void>;
}

export class ExcelOrchestrator {
  private workbook: WorkbookData;
  private setWorkbook: (updater: (prev: WorkbookData) => WorkbookData) => void;
  private streamingHook: StreamingHook | null;
  private executionPlan: ExecutionTask[];
  private executionLog: ExecutionLogEntry[];
  private agents: {
    sheet: SheetAgent;
    data: DataAgent;
    formula: FormulaAgent;
    chart: ChartAgent;
    format: FormatAgent;
  };

  constructor(
    workbook: WorkbookData,
    setWorkbook: (updater: (prev: WorkbookData) => WorkbookData) => void,
    streamingHook: StreamingHook | null = null
  ) {
    this.workbook = workbook;
    this.setWorkbook = setWorkbook;
    this.streamingHook = streamingHook;
    this.executionPlan = [];
    this.executionLog = [];
    this.agents = {
      sheet: new SheetAgent(this),
      data: new DataAgent(this),
      formula: new FormulaAgent(this),
      chart: new ChartAgent(this),
      format: new FormatAgent(this)
    };
  }

  async analyzeAndPlan(userPrompt: string): Promise<ExecutionTask[]> {
    console.log('🤖 Analizando prompt:', userPrompt);
    
    const analysis = this.analyzePrompt(userPrompt);
    this.executionPlan = this.generateExecutionPlan(analysis);
    
    console.log('📋 Plan de ejecución:', this.executionPlan);
    return this.executionPlan;
  }

  analyzePrompt(prompt: string): PromptAnalysis {
    const lowerPrompt = prompt.toLowerCase();
    const analysis: PromptAnalysis = {
      sheets: [],
      requiresCharts: false,
      chartTypes: [],
      requiresFormulas: false,
      formulaTypes: [],
      requiresConditionalFormat: false,
      dataTheme: null,
      isSimpleChartRequest: false
    };

    const yearMatch = prompt.match(/(\d{4})\s*(?:al?|to|-|hasta)\s*(\d{4})/i);
    if (yearMatch) {
      analysis.yearRange = {
        start: parseInt(yearMatch[1]),
        end: parseInt(yearMatch[2])
      };
    }

    const sheetPatterns = [
      { regex: /(ventas|sales)/gi, name: 'Ventas' },
      { regex: /(resumen|summary)/gi, name: 'Resumen' },
      { regex: /(gráficos?|charts?)/gi, name: 'Gráficos' },
      { regex: /(análisis|analysis)/gi, name: 'Análisis' }
    ];

    sheetPatterns.forEach(pattern => {
      if (pattern.regex.test(lowerPrompt)) {
        if (!analysis.sheets.includes(pattern.name)) {
          analysis.sheets.push(pattern.name);
        }
      }
    });

    if (/gr[aá]fic[oa]?s?|chart|graph/i.test(lowerPrompt)) {
      analysis.requiresCharts = true;
      if (/barras?|columnas?|bar|column/i.test(lowerPrompt)) {
        analysis.chartTypes.push('bar');
      }
      if (/circular|pie|pastel|torta/i.test(lowerPrompt)) {
        analysis.chartTypes.push('pie');
      }
      if (/l[ií]neas?|line/i.test(lowerPrompt)) {
        analysis.chartTypes.push('line');
      }
      if (/[aá]rea/i.test(lowerPrompt)) {
        analysis.chartTypes.push('line');
      }
      if (analysis.chartTypes.length === 0) {
        analysis.chartTypes.push('bar');
      }
    }

    if (/fórmula|formula|sum|average|promedio|total|calcul/i.test(lowerPrompt)) {
      analysis.requiresFormulas = true;
      if (/sum|suma|total/i.test(lowerPrompt)) analysis.formulaTypes.push('SUM');
      if (/average|promedio/i.test(lowerPrompt)) analysis.formulaTypes.push('AVERAGE');
      if (/crecimiento|growth|porcentaje/i.test(lowerPrompt)) analysis.formulaTypes.push('GROWTH');
      if (/max|máximo/i.test(lowerPrompt)) analysis.formulaTypes.push('MAX');
      if (/min|mínimo/i.test(lowerPrompt)) analysis.formulaTypes.push('MIN');
    }

    if (/formato condicional|conditional format|color.*según|highlight/i.test(lowerPrompt)) {
      analysis.requiresConditionalFormat = true;
    }

    if (/ventas|sales|productos?|products?/i.test(lowerPrompt)) {
      analysis.dataTheme = 'sales';
    } else if (/empleados?|employees?|nómina|payroll/i.test(lowerPrompt)) {
      analysis.dataTheme = 'employees';
    } else if (/inventario|inventory|stock/i.test(lowerPrompt)) {
      analysis.dataTheme = 'inventory';
    }

    if (analysis.sheets.length === 0 && /4 hojas|completo|complete/i.test(lowerPrompt)) {
      analysis.sheets = ['Ventas', 'Resumen', 'Gráficos', 'Análisis'];
    }

    if (analysis.requiresCharts && !analysis.dataTheme && analysis.sheets.length === 0) {
      analysis.isSimpleChartRequest = true;
    }

    return analysis;
  }

  generateExecutionPlan(analysis: PromptAnalysis): ExecutionTask[] {
    const plan: ExecutionTask[] = [];

    if (analysis.isSimpleChartRequest) {
      plan.push(...this.generateSimpleChartPlan(analysis));
    } else if (analysis.sheets.includes('Ventas') || analysis.dataTheme === 'sales') {
      plan.push(...this.generateSalesWorkbookPlan());
    } else {
      analysis.sheets.forEach((sheetName, idx) => {
        plan.push({
          action: ACTIONS.CREATE_SHEET,
          params: { name: sheetName, index: idx }
        });
      });
    }

    return plan;
  }

  generateSimpleChartPlan(analysis: PromptAnalysis): ExecutionTask[] {
    const startYear = analysis.yearRange?.start || 2020;
    const endYear = analysis.yearRange?.end || 2025;
    const chartType = analysis.chartTypes[0] || 'bar';
    
    const yearData: (string | number)[][] = [['Año', 'Valor']];
    for (let year = startYear; year <= endYear; year++) {
      const value = Math.round(100 + Math.random() * 900);
      yearData.push([String(year), value]);
    }

    const dataRowCount = yearData.length - 1;
    const chartTitle = chartType === 'bar' ? 'Gráfico de Barras' : 
                       chartType === 'line' ? 'Gráfico de Líneas' :
                       chartType === 'pie' ? 'Gráfico Circular' : 'Gráfico';

    return [
      {
        action: ACTIONS.CREATE_SHEET,
        params: { name: 'Datos', index: 0 }
      },
      {
        action: ACTIONS.INSERT_DATA,
        params: {
          sheetName: 'Datos',
          startRow: 0,
          startCol: 0,
          data: yearData,
          headers: true
        }
      },
      {
        action: ACTIONS.APPLY_STYLE,
        params: {
          sheetName: 'Datos',
          range: { startRow: 0, endRow: 0, startCol: 0, endCol: 1 },
          style: { fontWeight: 'bold', backgroundColor: '#3b82f6', color: '#ffffff' }
        }
      },
      {
        action: ACTIONS.CREATE_CHART,
        params: {
          sheetName: 'Datos',
          chartType: chartType,
          title: `${chartTitle} (${startYear}-${endYear})`,
          dataRange: { startRow: 1, endRow: dataRowCount, startCol: 0, endCol: 1 },
          position: { row: 0, col: 3 },
          size: { width: 400, height: 300 }
        }
      }
    ];
  }

  generateSalesWorkbookPlan(): ExecutionTask[] {
    return [
      {
        action: ACTIONS.CREATE_SHEET,
        params: { name: 'Ventas', index: 0 }
      },
      {
        action: ACTIONS.INSERT_DATA,
        params: {
          sheetName: 'Ventas',
          startRow: 0,
          startCol: 0,
          data: [
            ['Mes', 'Producto', 'Cantidad', 'Precio', 'Total'],
            ['Enero', 'Laptop', 15, 1200, null],
            ['Febrero', 'Mouse', 45, 25, null],
            ['Marzo', 'Teclado', 30, 75, null],
            ['Abril', 'Monitor', 12, 350, null],
            ['Mayo', 'Laptop', 20, 1200, null],
            ['Junio', 'Mouse', 60, 25, null],
            ['Julio', 'Teclado', 40, 75, null],
            ['Agosto', 'Monitor', 18, 350, null],
            ['Septiembre', 'Laptop', 25, 1200, null],
            ['Octubre', 'Mouse', 70, 25, null],
            ['Noviembre', 'Teclado', 35, 75, null],
            ['Diciembre', 'Monitor', 22, 350, null]
          ],
          headers: true
        }
      },
      {
        action: ACTIONS.INSERT_BULK_FORMULAS,
        params: {
          sheetName: 'Ventas',
          formulas: [
            { row: 1, col: 4, formula: '=C2*D2' },
            { row: 2, col: 4, formula: '=C3*D3' },
            { row: 3, col: 4, formula: '=C4*D4' },
            { row: 4, col: 4, formula: '=C5*D5' },
            { row: 5, col: 4, formula: '=C6*D6' },
            { row: 6, col: 4, formula: '=C7*D7' },
            { row: 7, col: 4, formula: '=C8*D8' },
            { row: 8, col: 4, formula: '=C9*D9' },
            { row: 9, col: 4, formula: '=C10*D10' },
            { row: 10, col: 4, formula: '=C11*D11' },
            { row: 11, col: 4, formula: '=C12*D12' },
            { row: 12, col: 4, formula: '=C13*D13' }
          ]
        }
      },
      {
        action: ACTIONS.APPLY_STYLE,
        params: {
          sheetName: 'Ventas',
          range: { startRow: 0, endRow: 0, startCol: 0, endCol: 4 },
          style: { fontWeight: 'bold', backgroundColor: '#3b82f6', color: '#ffffff' }
        }
      },
      {
        action: ACTIONS.CREATE_SHEET,
        params: { name: 'Resumen', index: 1 }
      },
      {
        action: ACTIONS.INSERT_DATA,
        params: {
          sheetName: 'Resumen',
          startRow: 0,
          startCol: 0,
          data: [
            ['RESUMEN DE VENTAS', '', ''],
            ['', '', ''],
            ['Métrica', 'Valor', 'Descripción'],
            ['Total Unidades Vendidas', null, 'Suma de todas las cantidades'],
            ['Venta Total ($)', null, 'Suma de todos los totales'],
            ['Promedio por Venta ($)', null, 'Promedio de totales'],
            ['Venta Máxima ($)', null, 'Mayor venta individual'],
            ['Venta Mínima ($)', null, 'Menor venta individual'],
            ['Cantidad de Transacciones', null, 'Número de registros'],
            ['', '', ''],
            ['RESUMEN POR PRODUCTO', '', ''],
            ['Producto', 'Unidades', 'Ingresos'],
            ['Laptop', null, null],
            ['Mouse', null, null],
            ['Teclado', null, null],
            ['Monitor', null, null]
          ]
        }
      },
      {
        action: ACTIONS.INSERT_BULK_FORMULAS,
        params: {
          sheetName: 'Resumen',
          formulas: [
            { row: 3, col: 1, formula: '=SUM(Ventas!C2:C13)' },
            { row: 4, col: 1, formula: '=SUM(Ventas!E2:E13)' },
            { row: 5, col: 1, formula: '=AVERAGE(Ventas!E2:E13)' },
            { row: 6, col: 1, formula: '=MAX(Ventas!E2:E13)' },
            { row: 7, col: 1, formula: '=MIN(Ventas!E2:E13)' },
            { row: 8, col: 1, formula: '=COUNT(Ventas!E2:E13)' },
            { row: 12, col: 1, formula: '=60' },
            { row: 12, col: 2, formula: '=72000' },
            { row: 13, col: 1, formula: '=175' },
            { row: 13, col: 2, formula: '=4375' },
            { row: 14, col: 1, formula: '=105' },
            { row: 14, col: 2, formula: '=7875' },
            { row: 15, col: 1, formula: '=52' },
            { row: 15, col: 2, formula: '=18200' }
          ]
        }
      },
      {
        action: ACTIONS.CREATE_SHEET,
        params: { name: 'Gráficos', index: 2 }
      },
      {
        action: ACTIONS.INSERT_DATA,
        params: {
          sheetName: 'Gráficos',
          startRow: 0,
          startCol: 0,
          data: [
            ['📊 DASHBOARD DE VENTAS', '', '', ''],
            ['', '', '', ''],
            ['Datos para Gráfico de Barras (Ventas por Mes)', '', '', ''],
            ['Mes', 'Ventas ($)', '', ''],
            ['Ene', 18000, '', ''],
            ['Feb', 1125, '', ''],
            ['Mar', 2250, '', ''],
            ['Abr', 4200, '', ''],
            ['May', 24000, '', ''],
            ['Jun', 1500, '', ''],
            ['Jul', 3000, '', ''],
            ['Ago', 6300, '', ''],
            ['Sep', 30000, '', ''],
            ['Oct', 1750, '', ''],
            ['Nov', 2625, '', ''],
            ['Dic', 7700, '', ''],
            ['', '', '', ''],
            ['Datos para Gráfico Circular (Ventas por Producto)', '', '', ''],
            ['Producto', 'Total Ventas ($)', 'Porcentaje', ''],
            ['Laptop', 72000, null, ''],
            ['Mouse', 4375, null, ''],
            ['Teclado', 7875, null, ''],
            ['Monitor', 18200, null, '']
          ]
        }
      },
      {
        action: ACTIONS.INSERT_BULK_FORMULAS,
        params: {
          sheetName: 'Gráficos',
          formulas: [
            { row: 19, col: 2, formula: '=ROUND(B20/102450*100,1)' },
            { row: 20, col: 2, formula: '=ROUND(B21/102450*100,1)' },
            { row: 21, col: 2, formula: '=ROUND(B22/102450*100,1)' },
            { row: 22, col: 2, formula: '=ROUND(B23/102450*100,1)' }
          ]
        }
      },
      {
        action: ACTIONS.CREATE_CHART,
        params: {
          sheetName: 'Gráficos',
          chartType: 'bar',
          title: 'Ventas Mensuales ($)',
          dataRange: { startRow: 4, endRow: 15, startCol: 0, endCol: 1 },
          position: { row: 2, col: 5 },
          size: { width: 450, height: 300 }
        }
      },
      {
        action: ACTIONS.CREATE_CHART,
        params: {
          sheetName: 'Gráficos',
          chartType: 'pie',
          title: 'Distribución por Producto',
          dataRange: { startRow: 19, endRow: 22, startCol: 0, endCol: 1 },
          position: { row: 18, col: 5 },
          size: { width: 350, height: 300 }
        }
      },
      {
        action: ACTIONS.CREATE_SHEET,
        params: { name: 'Análisis', index: 3 }
      },
      {
        action: ACTIONS.INSERT_DATA,
        params: {
          sheetName: 'Análisis',
          startRow: 0,
          startCol: 0,
          data: [
            ['📈 ANÁLISIS DE CRECIMIENTO', '', '', '', ''],
            ['', '', '', '', ''],
            ['Mes', 'Ventas ($)', 'Mes Anterior', 'Crecimiento ($)', 'Crecimiento (%)'],
            ['Enero', 18000, 0, null, null],
            ['Febrero', 1125, 18000, null, null],
            ['Marzo', 2250, 1125, null, null],
            ['Abril', 4200, 2250, null, null],
            ['Mayo', 24000, 4200, null, null],
            ['Junio', 1500, 24000, null, null],
            ['Julio', 3000, 1500, null, null],
            ['Agosto', 6300, 3000, null, null],
            ['Septiembre', 30000, 6300, null, null],
            ['Octubre', 1750, 30000, null, null],
            ['Noviembre', 2625, 1750, null, null],
            ['Diciembre', 7700, 2625, null, null],
            ['', '', '', '', ''],
            ['ESTADÍSTICAS', '', '', '', ''],
            ['Crecimiento Promedio (%)', null, '', '', ''],
            ['Mayor Crecimiento (%)', null, '', '', ''],
            ['Mayor Caída (%)', null, '', '', '']
          ]
        }
      },
      {
        action: ACTIONS.INSERT_BULK_FORMULAS,
        params: {
          sheetName: 'Análisis',
          formulas: [
            { row: 3, col: 3, formula: '=B4-C4' },
            { row: 3, col: 4, formula: '=IF(C4=0,0,ROUND((B4-C4)/C4*100,1))' },
            { row: 4, col: 3, formula: '=B5-C5' },
            { row: 4, col: 4, formula: '=IF(C5=0,0,ROUND((B5-C5)/C5*100,1))' },
            { row: 5, col: 3, formula: '=B6-C6' },
            { row: 5, col: 4, formula: '=IF(C6=0,0,ROUND((B6-C6)/C6*100,1))' },
            { row: 6, col: 3, formula: '=B7-C7' },
            { row: 6, col: 4, formula: '=IF(C7=0,0,ROUND((B7-C7)/C7*100,1))' },
            { row: 7, col: 3, formula: '=B8-C8' },
            { row: 7, col: 4, formula: '=IF(C8=0,0,ROUND((B8-C8)/C8*100,1))' },
            { row: 8, col: 3, formula: '=B9-C9' },
            { row: 8, col: 4, formula: '=IF(C9=0,0,ROUND((B9-C9)/C9*100,1))' },
            { row: 9, col: 3, formula: '=B10-C10' },
            { row: 9, col: 4, formula: '=IF(C10=0,0,ROUND((B10-C10)/C10*100,1))' },
            { row: 10, col: 3, formula: '=B11-C11' },
            { row: 10, col: 4, formula: '=IF(C11=0,0,ROUND((B11-C11)/C11*100,1))' },
            { row: 11, col: 3, formula: '=B12-C12' },
            { row: 11, col: 4, formula: '=IF(C12=0,0,ROUND((B12-C12)/C12*100,1))' },
            { row: 12, col: 3, formula: '=B13-C13' },
            { row: 12, col: 4, formula: '=IF(C13=0,0,ROUND((B13-C13)/C13*100,1))' },
            { row: 13, col: 3, formula: '=B14-C14' },
            { row: 13, col: 4, formula: '=IF(C14=0,0,ROUND((B14-C14)/C14*100,1))' },
            { row: 14, col: 3, formula: '=B15-C15' },
            { row: 14, col: 4, formula: '=IF(C15=0,0,ROUND((B15-C15)/C15*100,1))' },
            { row: 17, col: 1, formula: '=AVERAGE(E4:E15)' },
            { row: 18, col: 1, formula: '=MAX(E4:E15)' },
            { row: 19, col: 1, formula: '=MIN(E4:E15)' }
          ]
        }
      },
      {
        action: ACTIONS.APPLY_CONDITIONAL_FORMAT,
        params: {
          sheetName: 'Análisis',
          range: { startRow: 3, endRow: 14, startCol: 4, endCol: 4 },
          rules: [
            { condition: 'greaterThan', value: 0, style: { backgroundColor: '#dcfce7', color: '#166534' } },
            { condition: 'lessThan', value: 0, style: { backgroundColor: '#fee2e2', color: '#991b1b' } },
            { condition: 'equals', value: 0, style: { backgroundColor: '#fef3c7', color: '#92400e' } }
          ]
        }
      }
    ];
  }

  async executePlan(onProgress: ((data: ProgressData) => void) | null = null): Promise<ExecutionLogEntry[]> {
    console.log('🚀 Iniciando ejecución del plan...');
    const totalTasks = this.executionPlan.length;

    for (let i = 0; i < this.executionPlan.length; i++) {
      const task = this.executionPlan[i];
      
      if (onProgress) {
        onProgress({
          current: i + 1,
          total: totalTasks,
          task: task.action,
          params: task.params
        });
      }

      try {
        await this.executeTask(task);
        this.executionLog.push({ task, status: 'success', timestamp: Date.now() });
        await this.sleep(50);
      } catch (error) {
        console.error(`Error en tarea ${task.action}:`, error);
        this.executionLog.push({ 
          task, 
          status: 'error', 
          error: error instanceof Error ? error : new Error(String(error)), 
          timestamp: Date.now() 
        });
      }
    }

    this.setWorkbook(() => ({ ...this.workbook }));
    console.log('✅ Plan ejecutado completamente');
    
    return this.executionLog;
  }

  async executeTask(task: ExecutionTask): Promise<void> {
    const { action, params } = task;

    switch (action) {
      case ACTIONS.CREATE_SHEET:
        await this.agents.sheet.createSheet(params as { name: string; index: number });
        break;
      case ACTIONS.INSERT_DATA:
        await this.agents.data.insertData(params as {
          sheetName: string;
          startRow: number;
          startCol: number;
          data: (string | number | null)[][];
          headers?: boolean;
        });
        break;
      case ACTIONS.INSERT_FORMULA:
        await this.agents.formula.insertFormula(params as {
          sheetName: string;
          row: number;
          col: number;
          formula: string;
        });
        break;
      case ACTIONS.INSERT_BULK_FORMULAS:
        await this.agents.formula.insertBulkFormulas(params as {
          sheetName: string;
          formulas: Array<{ row: number; col: number; formula: string }>;
        });
        break;
      case ACTIONS.CREATE_CHART:
        await this.agents.chart.createChart(params as {
          sheetName: string;
          chartType: 'bar' | 'line' | 'pie';
          title: string;
          dataRange: { startRow: number; endRow: number; startCol: number; endCol: number };
          position: { row: number; col: number };
          size: { width: number; height: number };
        });
        break;
      case ACTIONS.APPLY_CONDITIONAL_FORMAT:
        await this.agents.format.applyConditionalFormat(params as {
          sheetName: string;
          range: { startRow: number; endRow: number; startCol: number; endCol: number };
          rules: ConditionalFormatRule[];
        });
        break;
      case ACTIONS.APPLY_STYLE:
        await this.agents.format.applyStyle(params as {
          sheetName: string;
          range: { startRow: number; endRow: number; startCol: number; endCol: number };
          style: Record<string, string>;
        });
        break;
      default:
        console.warn(`Acción desconocida: ${action}`);
    }
  }

  private sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  getSheet(name: string): SheetData | undefined {
    return this.workbook.sheets.find(s => s.name === name);
  }

  getWorkbook(): WorkbookData {
    return this.workbook;
  }

  getStreamingHook(): StreamingHook | null {
    return this.streamingHook;
  }

  updateWorkbook(updater: (prev: WorkbookData) => WorkbookData): void {
    this.setWorkbook(updater);
  }
}

class SheetAgent {
  private orchestrator: ExcelOrchestrator;

  constructor(orchestrator: ExcelOrchestrator) {
    this.orchestrator = orchestrator;
  }

  async createSheet({ name, index }: { name: string; index: number }): Promise<void> {
    const workbook = this.orchestrator.getWorkbook();
    
    if (workbook.sheets.find(s => s.name === name)) {
      console.log(`Hoja "${name}" ya existe, omitiendo...`);
      return;
    }

    const newSheet: SheetData = {
      id: `sheet_${Date.now()}_${index}`,
      name: name,
      grid: new SparseGrid(),
      charts: [],
      conditionalFormats: []
    };

    workbook.sheets.push(newSheet);
    this.orchestrator.updateWorkbook(() => ({ ...workbook }));
    console.log(`📄 Hoja creada: ${name}`);
  }
}

class DataAgent {
  private orchestrator: ExcelOrchestrator;

  constructor(orchestrator: ExcelOrchestrator) {
    this.orchestrator = orchestrator;
  }

  async insertData({ 
    sheetName, 
    startRow, 
    startCol, 
    data, 
    headers = false 
  }: {
    sheetName: string;
    startRow: number;
    startCol: number;
    data: (string | number | null)[][];
    headers?: boolean;
  }): Promise<void> {
    const sheet = this.orchestrator.getSheet(sheetName);
    if (!sheet) {
      console.error(`Hoja no encontrada: ${sheetName}`);
      return;
    }

    const streamingHook = this.orchestrator.getStreamingHook();

    for (let r = 0; r < data.length; r++) {
      for (let c = 0; c < data[r].length; c++) {
        const value = data[r][c];
        if (value !== null && value !== undefined && value !== '') {
          const cellData: Partial<CellData> = {
            value: String(value),
            bold: headers && r === 0 ? true : undefined
          };

          if (streamingHook) {
            streamingHook.queueCell(startRow + r, startCol + c, String(value), 30);
          } else {
            sheet.grid.setCell(startRow + r, startCol + c, cellData);
          }
        }
      }
    }

    if (streamingHook) {
      await streamingHook.processStreamQueue();
    }

    console.log(`📝 Datos insertados en ${sheetName}: ${data.length} filas`);
  }
}

class FormulaAgent {
  private orchestrator: ExcelOrchestrator;

  constructor(orchestrator: ExcelOrchestrator) {
    this.orchestrator = orchestrator;
  }

  async insertFormula({ 
    sheetName, 
    row, 
    col, 
    formula 
  }: {
    sheetName: string;
    row: number;
    col: number;
    formula: string;
  }): Promise<void> {
    const sheet = this.orchestrator.getSheet(sheetName);
    if (!sheet) return;

    const formulaEngine = new FormulaEngine(sheet.grid);
    const evaluated = formulaEngine.evaluate(formula);
    
    sheet.grid.setCell(row, col, {
      value: String(evaluated),
      formula: formula
    });

    console.log(`🔢 Fórmula insertada: ${formula} = ${evaluated}`);
  }

  async insertBulkFormulas({ 
    sheetName, 
    formulas 
  }: {
    sheetName: string;
    formulas: Array<{ row: number; col: number; formula: string }>;
  }): Promise<void> {
    const sheet = this.orchestrator.getSheet(sheetName);
    if (!sheet) return;

    const formulaEngine = new FormulaEngine(sheet.grid);

    for (const { row, col, formula } of formulas) {
      const evaluated = formulaEngine.evaluate(formula);
      
      sheet.grid.setCell(row, col, {
        value: String(evaluated),
        formula: formula
      });
    }

    console.log(`🔢 ${formulas.length} fórmulas insertadas en ${sheetName}`);
  }
}

class ChartAgent {
  private orchestrator: ExcelOrchestrator;

  constructor(orchestrator: ExcelOrchestrator) {
    this.orchestrator = orchestrator;
  }

  async createChart({ 
    sheetName, 
    chartType, 
    title, 
    dataRange, 
    position, 
    size 
  }: {
    sheetName: string;
    chartType: 'bar' | 'line' | 'pie' | 'area';
    title: string;
    dataRange: { startRow: number; endRow: number; startCol: number; endCol: number };
    position: { row: number; col: number };
    size: { width: number; height: number };
  }): Promise<void> {
    const sheet = this.orchestrator.getSheet(sheetName);
    if (!sheet) return;

    const chartDataRange: ChartDataRange = {
      labels: { startRow: dataRange.startRow, endRow: dataRange.endRow, col: dataRange.startCol },
      values: { startRow: dataRange.startRow, endRow: dataRange.endRow, col: dataRange.endCol }
    };

    const chart: ChartConfig = {
      id: `chart_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
      type: chartType,
      title: title,
      dataRange: chartDataRange,
      position: position,
      size: size
    };

    sheet.charts.push(chart);
    console.log(`📊 Gráfico creado: ${title} (${chartType})`);
  }
}

class FormatAgent {
  private orchestrator: ExcelOrchestrator;

  constructor(orchestrator: ExcelOrchestrator) {
    this.orchestrator = orchestrator;
  }

  async applyConditionalFormat({ 
    sheetName, 
    range, 
    rules 
  }: {
    sheetName: string;
    range: { startRow: number; endRow: number; startCol: number; endCol: number };
    rules: ConditionalFormatRule[];
  }): Promise<void> {
    const sheet = this.orchestrator.getSheet(sheetName);
    if (!sheet) return;

    sheet.conditionalFormats.push({ range, rules });

    for (let r = range.startRow; r <= range.endRow; r++) {
      for (let c = range.startCol; c <= range.endCol; c++) {
        const cell = sheet.grid.getCell(r, c);
        const value = parseFloat(cell.value);
        
        if (!isNaN(value)) {
          for (const rule of rules) {
            if (this.matchesCondition(value, rule)) {
              sheet.grid.setCell(r, c, {
                ...cell,
                format: { ...cell.format, ...rule.style }
              });
              break;
            }
          }
        }
      }
    }

    console.log(`🎨 Formato condicional aplicado en ${sheetName}`);
  }

  private matchesCondition(value: number, rule: ConditionalFormatRule): boolean {
    switch (rule.condition) {
      case 'greaterThan': return value > (rule.value ?? 0);
      case 'lessThan': return value < (rule.value ?? 0);
      case 'equals': return value === rule.value;
      case 'between': return value >= (rule.min ?? 0) && value <= (rule.max ?? 0);
      default: return false;
    }
  }

  async applyStyle({ 
    sheetName, 
    range, 
    style 
  }: {
    sheetName: string;
    range: { startRow: number; endRow: number; startCol: number; endCol: number };
    style: Record<string, string>;
  }): Promise<void> {
    const sheet = this.orchestrator.getSheet(sheetName);
    if (!sheet) return;

    for (let r = range.startRow; r <= range.endRow; r++) {
      for (let c = range.startCol; c <= range.endCol; c++) {
        const cell = sheet.grid.getCell(r, c);
        sheet.grid.setCell(r, c, {
          ...cell,
          format: { ...cell.format, ...style }
        });
      }
    }

    console.log(`🎨 Estilo aplicado en ${sheetName}`);
  }
}
