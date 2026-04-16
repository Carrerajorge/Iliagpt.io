import { SparseGrid, parseCellRef, parseRange, CellData } from './sparseGrid';
import { FormulaEngine, ExcelErrors, isExcelError } from './formulaEngine';

export interface FormulaTask {
  id: string;
  type: 'evaluate' | 'evaluateBatch' | 'recalcDependents';
  formula?: string;
  row?: number;
  col?: number;
  formulas?: Array<{ row: number; col: number; formula: string }>;
  gridData?: object;
}

export interface FormulaResult {
  id: string;
  type: 'result' | 'batchResult' | 'error';
  value?: string;
  results?: Array<{ row: number; col: number; value: string }>;
  error?: string;
}

let grid: SparseGrid | null = null;
let formulaEngine: FormulaEngine | null = null;

function initializeGrid(gridData: object): void {
  grid = SparseGrid.fromJSON(gridData);
  formulaEngine = new FormulaEngine(grid);
}

function evaluateFormula(formula: string): string {
  if (!formulaEngine) {
    return ExcelErrors.ERROR;
  }
  try {
    return formulaEngine.evaluate(formula);
  } catch (e) {
    console.error('[FormulaWorker] Error evaluating formula:', e);
    return ExcelErrors.ERROR;
  }
}

function evaluateBatch(formulas: Array<{ row: number; col: number; formula: string }>): Array<{ row: number; col: number; value: string }> {
  if (!formulaEngine) {
    return formulas.map(f => ({ row: f.row, col: f.col, value: ExcelErrors.ERROR }));
  }
  
  const results: Array<{ row: number; col: number; value: string }> = [];
  const dependencyGraph = new Map<string, Set<string>>();
  
  for (const { row, col, formula } of formulas) {
    try {
      formulaEngine.setCurrentCell(row, col);
      const value = formulaEngine.evaluate(formula);
      results.push({ row, col, value });
      formulaEngine.clearCurrentCell();
    } catch (e) {
      results.push({ row, col, value: ExcelErrors.ERROR });
    }
  }
  
  return results;
}

self.onmessage = (e: MessageEvent<FormulaTask>) => {
  const task = e.data;
  
  try {
    if (task.gridData) {
      initializeGrid(task.gridData);
    }
    
    switch (task.type) {
      case 'evaluate': {
        if (!task.formula) {
          self.postMessage({ id: task.id, type: 'error', error: 'No formula provided' } as FormulaResult);
          return;
        }
        const value = evaluateFormula(task.formula);
        self.postMessage({ id: task.id, type: 'result', value } as FormulaResult);
        break;
      }
      
      case 'evaluateBatch': {
        if (!task.formulas || task.formulas.length === 0) {
          self.postMessage({ id: task.id, type: 'error', error: 'No formulas provided' } as FormulaResult);
          return;
        }
        const results = evaluateBatch(task.formulas);
        self.postMessage({ id: task.id, type: 'batchResult', results } as FormulaResult);
        break;
      }
      
      default:
        self.postMessage({ id: task.id, type: 'error', error: `Unknown task type: ${task.type}` } as FormulaResult);
    }
  } catch (e) {
    self.postMessage({ id: task.id, type: 'error', error: String(e) } as FormulaResult);
  }
};
