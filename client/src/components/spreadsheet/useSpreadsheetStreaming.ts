import { useState, useRef, useCallback } from 'react';

export function useSpreadsheetStreaming(
  hotRef: React.RefObject<any>, 
  setIsModified: (modified: boolean) => void
) {
  const [isStreaming, setIsStreaming] = useState(false);
  const [streamingCell, setStreamingCell] = useState<{ row: number; col: number } | null>(null);
  const abortControllerRef = useRef<AbortController | null>(null);

  const streamToCell = useCallback(async (row: number, col: number, text: string, speed: number = 30) => {
    if (!hotRef.current?.hotInstance) return;
    const hot = hotRef.current.hotInstance;
    
    setIsStreaming(true);
    setStreamingCell({ row, col });
    abortControllerRef.current = new AbortController();
    
    let currentText = '';
    
    for (let i = 0; i < text.length; i++) {
      if (abortControllerRef.current?.signal.aborted) break;
      
      currentText += text[i];
      hot.setDataAtCell(row, col, currentText);
      await new Promise(resolve => setTimeout(resolve, speed));
    }
    
    setIsStreaming(false);
    setStreamingCell(null);
    setIsModified(true);
  }, [hotRef, setIsModified]);

  const streamToCells = useCallback(async (
    cells: { row: number; col: number; value: string }[], 
    speed: number = 20
  ) => {
    if (!hotRef.current?.hotInstance) return;
    const hot = hotRef.current.hotInstance;
    
    setIsStreaming(true);
    abortControllerRef.current = new AbortController();
    
    for (const cell of cells) {
      if (abortControllerRef.current?.signal.aborted) break;
      
      setStreamingCell({ row: cell.row, col: cell.col });
      
      let currentText = '';
      for (let i = 0; i < cell.value.length; i++) {
        if (abortControllerRef.current?.signal.aborted) break;
        currentText += cell.value[i];
        hot.setDataAtCell(cell.row, cell.col, currentText);
        await new Promise(resolve => setTimeout(resolve, speed));
      }
      
      await new Promise(resolve => setTimeout(resolve, 100));
    }
    
    setIsStreaming(false);
    setStreamingCell(null);
    setIsModified(true);
  }, [hotRef, setIsModified]);

  const streamFillColumn = useCallback(async (
    col: number, 
    values: string[], 
    startRow: number = 0, 
    speed: number = 50
  ) => {
    if (!hotRef.current?.hotInstance) return;
    const hot = hotRef.current.hotInstance;
    
    setIsStreaming(true);
    abortControllerRef.current = new AbortController();
    
    for (let i = 0; i < values.length; i++) {
      if (abortControllerRef.current?.signal.aborted) break;
      
      const row = startRow + i;
      setStreamingCell({ row, col });
      
      hot.setDataAtCell(row, col, values[i]);
      
      const cell = hot.getCell(row, col);
      if (cell) {
        cell.style.backgroundColor = '#4f46e5';
        cell.style.transition = 'background-color 0.3s';
        setTimeout(() => {
          cell.style.backgroundColor = '';
        }, 200);
      }
      
      await new Promise(resolve => setTimeout(resolve, speed));
    }
    
    setIsStreaming(false);
    setStreamingCell(null);
    setIsModified(true);
  }, [hotRef, setIsModified]);

  const streamFillRange = useCallback(async (
    startRow: number, 
    startCol: number, 
    data: any[][], 
    speed: number = 30
  ) => {
    if (!hotRef.current?.hotInstance) return;
    const hot = hotRef.current.hotInstance;
    
    setIsStreaming(true);
    abortControllerRef.current = new AbortController();
    
    for (let r = 0; r < data.length; r++) {
      for (let c = 0; c < data[r].length; c++) {
        if (abortControllerRef.current?.signal.aborted) break;
        
        const row = startRow + r;
        const col = startCol + c;
        const value = data[r][c];
        
        if (value !== undefined && value !== null && value !== '') {
          setStreamingCell({ row, col });
          hot.setDataAtCell(row, col, value);
          
          const cell = hot.getCell(row, col);
          if (cell) {
            cell.style.backgroundColor = '#22c55e';
            cell.style.transition = 'background-color 0.2s';
            setTimeout(() => {
              cell.style.backgroundColor = '';
            }, 150);
          }
          
          await new Promise(resolve => setTimeout(resolve, speed));
        }
      }
    }
    
    setIsStreaming(false);
    setStreamingCell(null);
    setIsModified(true);
  }, [hotRef, setIsModified]);

  const cancelStreaming = useCallback(() => {
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
    }
    setIsStreaming(false);
    setStreamingCell(null);
  }, []);

  return {
    isStreaming,
    streamingCell,
    streamToCell,
    streamToCells,
    streamFillColumn,
    streamFillRange,
    cancelStreaming
  };
}
