import { expose } from 'comlink';
import { FormulaEngine } from '@/lib/formulaEngine';
import { SparseGrid, CellData } from '@/lib/sparseGrid';

export class FormulaEngineWorker {
    private engine: FormulaEngine;
    private grid: SparseGrid;

    constructor() {
        this.grid = new SparseGrid(10000, 10000); // Default max size
        this.engine = new FormulaEngine(this.grid);
    }

    /**
     * Updates the worker's internal grid state.
     * We receive a simplified map or array of cells to avoid sending the entire class.
     * serialization: { [key: string]: CellData } where key is "row,col"
     */
    updateGrid(cells: Map<string, CellData> | Record<string, CellData>) {
        // Reconstruct the grid
        // For performance, we might want to just update the internal map of SparseGrid if accessible,
        // or use public methods.

        // Assuming we receive a plain object or Map since structured clone handles Map.
        if (cells instanceof Map) {
            // Direct injection if we can access the private map? 
            // SparseGrid doesn't expose a bulk setter usually.
            // We'll iterate.
            for (const [key, data] of cells.entries()) {
                const [row, col] = key.split(',').map(Number);
                this.grid.setCell(row, col, data);
            }
        } else {
            // Object
            for (const key in cells) {
                const [row, col] = key.split(',').map(Number);
                this.grid.setCell(row, col, cells[key]);
            }
        }

        this.engine.setGrid(this.grid);
    }

    /**
     * Optimization: sync only changed cells
     */
    syncCells(changes: Array<{ row: number, col: number, data: CellData }>) {
        for (const { row, col, data } of changes) {
            this.grid.setCell(row, col, data);
        }
    }

    evaluate(formula: string, cellRef?: string): string {
        // If cellRef provided, set current cell
        if (cellRef) {
            // Parse cellRef to row/col? FormulaEngine usually takes string refs in some methods, 
            // but 'evaluate' takes formula string.
            // If we need to set context:
            // TODO: Add support for context if needed.
        }
        return this.engine.evaluate(formula);
    }

    /**
     * Evaluate a specific cell by coordinates
     */
    evaluateCell(row: number, col: number): string {
        this.engine.setCurrentCell(row, col);
        const cell = this.grid.getCell(row, col);
        if (!cell.value?.startsWith('=')) return cell.value;
        return this.engine.evaluate(cell.value);
    }
}

expose(new FormulaEngineWorker());
