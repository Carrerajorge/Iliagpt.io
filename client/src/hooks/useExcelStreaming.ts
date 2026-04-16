import { useState, useRef, useCallback, useEffect } from 'react';
import { SparseGrid } from '@/lib/sparseGrid';
import { FormulaEngine } from '@/lib/formulaEngine';

export const STREAM_STATUS = {
  IDLE: 'idle',
  CONNECTING: 'connecting',
  STREAMING: 'streaming',
  PAUSED: 'paused',
  COMPLETED: 'completed',
  ERROR: 'error'
} as const;

export type StreamStatus = typeof STREAM_STATUS[keyof typeof STREAM_STATUS];

interface CellUpdate {
  row: number;
  col: number;
  value: string;
  delay: number;
}

interface RecentCell {
  row: number;
  col: number;
  timestamp: number;
}

interface StreamProgress {
  current: number;
  total: number;
}

const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

export function useExcelStreaming(grid: SparseGrid) {
  const onGridChangeRef = useRef<((grid: SparseGrid) => void) | null>(null);
  const gridRef = useRef<SparseGrid>(grid);
  
  // Update the grid ref when the grid prop changes
  useEffect(() => {
    gridRef.current = grid;
    formulaEngineRef.current = new FormulaEngine(grid);
  }, [grid]);
  
  const setOnGridChange = useCallback((fn: (grid: SparseGrid) => void) => {
    onGridChangeRef.current = fn;
  }, []);
  
  const setGrid = useCallback((newGrid: SparseGrid) => {
    gridRef.current = newGrid;
    formulaEngineRef.current = new FormulaEngine(newGrid);
  }, []);
  
  const [streamStatus, setStreamStatus] = useState<StreamStatus>(STREAM_STATUS.IDLE);
  const [activeCell, setActiveCell] = useState<{ row: number; col: number } | null>(null);
  const [streamProgress, setStreamProgress] = useState<StreamProgress>({ current: 0, total: 0 });
  const [recentCells, setRecentCells] = useState<RecentCell[]>([]);
  const [typingValue, setTypingValue] = useState<string>('');
  
  const streamQueue = useRef<CellUpdate[]>([]);
  const isStreaming = useRef(false);
  const isPaused = useRef(false);
  const formulaEngineRef = useRef(new FormulaEngine(grid));

  const queueCell = useCallback((row: number, col: number, value: string, delay = 50) => {
    streamQueue.current.push({ row, col, value, delay });
  }, []);

  const typeInCell = useCallback(async (row: number, col: number, finalValue: string) => {
    const currentGrid = gridRef.current;
    const isFormula = String(finalValue).startsWith('=');
    
    if (isFormula) {
      const formula = String(finalValue);
      for (let i = 1; i <= formula.length; i++) {
        if (isPaused.current) {
          await new Promise<void>(resolve => {
            const checkPause = setInterval(() => {
              if (!isPaused.current) {
                clearInterval(checkPause);
                resolve();
              }
            }, 100);
          });
        }
        setTypingValue(formula.substring(0, i));
        await sleep(25);
      }
      
      formulaEngineRef.current = new FormulaEngine(currentGrid);
      const evaluated = formulaEngineRef.current.evaluate(finalValue);
      currentGrid.setCell(row, col, {
        value: String(evaluated),
        formula: finalValue,
        format: {}
      });
    } else {
      for (let i = 1; i <= String(finalValue).length; i++) {
        if (isPaused.current) {
          await new Promise<void>(resolve => {
            const checkPause = setInterval(() => {
              if (!isPaused.current) {
                clearInterval(checkPause);
                resolve();
              }
            }, 100);
          });
        }
        setTypingValue(String(finalValue).substring(0, i));
        await sleep(20);
      }
      
      currentGrid.setCell(row, col, {
        value: String(finalValue),
        formula: undefined,
        format: {}
      });
    }
    
    setTypingValue('');
    onGridChangeRef.current?.(currentGrid);
  }, []);

  const processStreamQueue = useCallback(async () => {
    if (isStreaming.current || streamQueue.current.length === 0) return;
    
    isStreaming.current = true;
    setStreamStatus(STREAM_STATUS.STREAMING);
    
    const totalCells = streamQueue.current.length;
    let processed = 0;

    while (streamQueue.current.length > 0) {
      if (isPaused.current) {
        await new Promise<void>(resolve => {
          const checkPause = setInterval(() => {
            if (!isPaused.current) {
              clearInterval(checkPause);
              resolve();
            }
          }, 100);
        });
      }

      const update = streamQueue.current.shift();
      if (!update) break;
      
      const { row, col, value, delay } = update;
      
      setActiveCell({ row, col });
      
      await typeInCell(row, col, value);
      
      setRecentCells(prev => [...prev.slice(-20), { row, col, timestamp: Date.now() }]);
      
      processed++;
      setStreamProgress({ current: processed, total: totalCells });
      
      await sleep(delay);
    }

    setStreamStatus(STREAM_STATUS.COMPLETED);
    setActiveCell(null);
    isStreaming.current = false;
    
    setTimeout(() => setRecentCells([]), 2000);
  }, [typeInCell]);

  const simulateStreaming = useCallback(async (
    data: (string | number | null)[][],
    startRow = 0,
    startCol = 0
  ) => {
    console.log('[Streaming] Starting simulation with data:', data.length, 'rows');
    
    // Reset state
    streamQueue.current = [];
    isStreaming.current = false;
    isPaused.current = false;
    
    // Queue all cells
    for (let r = 0; r < data.length; r++) {
      for (let c = 0; c < data[r].length; c++) {
        const cellValue = data[r][c];
        if (cellValue !== null && cellValue !== undefined && cellValue !== '') {
          queueCell(startRow + r, startCol + c, String(cellValue), 40);
        }
      }
    }
    
    console.log('[Streaming] Queued', streamQueue.current.length, 'cells');
    
    // Process the queue
    await processStreamQueue();
    console.log('[Streaming] Completed');
  }, [queueCell, processStreamQueue]);

  const pauseStreaming = useCallback(() => {
    isPaused.current = true;
    setStreamStatus(STREAM_STATUS.PAUSED);
  }, []);

  const resumeStreaming = useCallback(() => {
    isPaused.current = false;
    setStreamStatus(STREAM_STATUS.STREAMING);
  }, []);

  const cancelStreaming = useCallback(() => {
    streamQueue.current = [];
    isStreaming.current = false;
    isPaused.current = false;
    setStreamStatus(STREAM_STATUS.IDLE);
    setActiveCell(null);
    setTypingValue('');
    setRecentCells([]);
  }, []);

  const isRecentCell = useCallback((row: number, col: number) => {
    return recentCells.some(
      rc => rc.row === row && rc.col === col && Date.now() - rc.timestamp < 2000
    );
  }, [recentCells]);

  const isActiveCell = useCallback((row: number, col: number) => {
    return activeCell?.row === row && activeCell?.col === col;
  }, [activeCell]);

  return {
    streamStatus,
    activeCell,
    streamProgress,
    recentCells,
    typingValue,
    simulateStreaming,
    pauseStreaming,
    resumeStreaming,
    cancelStreaming,
    queueCell,
    processStreamQueue,
    isRecentCell,
    isActiveCell,
    setOnGridChange,
    setGrid,
    STREAM_STATUS
  };
}
