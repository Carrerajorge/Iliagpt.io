import { useState, useCallback, useRef } from 'react';
import type { CellData, CellStyle, ClipboardData, MergedCell, ConditionalRule, BorderStyle } from '@/types/spreadsheet';

function forEachSelectedCell(
  hot: any, 
  selected: number[][], 
  callback: (row: number, col: number) => void
) {
  for (const selection of selected) {
    const [startRow, startCol, endRow, endCol] = selection;
    const minRow = Math.min(startRow, endRow);
    const maxRow = Math.max(startRow, endRow);
    const minCol = Math.min(startCol, endCol);
    const maxCol = Math.max(startCol, endCol);
    
    for (let r = minRow; r <= maxRow; r++) {
      for (let c = minCol; c <= maxCol; c++) {
        callback(r, c);
      }
    }
  }
}

function applyStyleToCell(hot: any, row: number, col: number, style: Partial<CellStyle>) {
  const cell = hot.getCell(row, col);
  if (!cell) return;
  
  if (style.fontFamily) cell.style.fontFamily = style.fontFamily;
  if (style.fontSize) cell.style.fontSize = `${style.fontSize}px`;
  if (style.fontWeight) cell.style.fontWeight = style.fontWeight;
  if (style.fontStyle) cell.style.fontStyle = style.fontStyle;
  if (style.textDecoration) cell.style.textDecoration = style.textDecoration;
  if (style.fontColor) cell.style.color = style.fontColor;
  if (style.fillColor && style.fillColor !== 'transparent') cell.style.backgroundColor = style.fillColor;
  if (style.horizontalAlign) cell.style.textAlign = style.horizontalAlign;
  if (style.verticalAlign) cell.style.verticalAlign = style.verticalAlign;
  if (style.wrapText !== undefined) cell.style.whiteSpace = style.wrapText ? 'pre-wrap' : 'nowrap';
  if (style.indentLevel) cell.style.paddingLeft = `${style.indentLevel * 10}px`;
}

function applyBordersToCell(hot: any, row: number, col: number, borders: Partial<CellStyle>) {
  const cell = hot.getCell(row, col);
  if (!cell) return;
  
  const formatBorder = (border: BorderStyle | null) => {
    if (!border) return 'none';
    const widthMap: Record<string, string> = { thin: '1px', medium: '2px', thick: '3px' };
    return `${widthMap[border.style] || '1px'} ${border.style === 'dashed' ? 'dashed' : border.style === 'dotted' ? 'dotted' : 'solid'} ${border.color}`;
  };
  
  if (borders.borderTop !== undefined) cell.style.borderTop = formatBorder(borders.borderTop);
  if (borders.borderRight !== undefined) cell.style.borderRight = formatBorder(borders.borderRight);
  if (borders.borderBottom !== undefined) cell.style.borderBottom = formatBorder(borders.borderBottom);
  if (borders.borderLeft !== undefined) cell.style.borderLeft = formatBorder(borders.borderLeft);
}

export function useSpreadsheetOperations(hotRef: React.RefObject<any>) {
  const [clipboard, setClipboard] = useState<ClipboardData | null>(null);
  const [mergedCells, setMergedCells] = useState<MergedCell[]>([]);
  const [conditionalRules, setConditionalRules] = useState<ConditionalRule[]>([]);
  const undoStackRef = useRef<any[]>([]);
  const redoStackRef = useRef<any[]>([]);

  const saveUndoState = useCallback((hot: any) => {
    const data = hot.getData();
    undoStackRef.current.push(JSON.parse(JSON.stringify(data)));
    redoStackRef.current = [];
  }, []);

  const applyStyleToSelection = useCallback((style: Partial<CellStyle>) => {
    const hot = hotRef.current?.hotInstance;
    if (!hot) return;
    
    const selected = hot.getSelected();
    if (!selected) return;
    
    forEachSelectedCell(hot, selected, (row, col) => {
      const meta = hot.getCellMeta(row, col);
      hot.setCellMeta(row, col, 'style', { ...meta.style, ...style });
      applyStyleToCell(hot, row, col, style);
    });
    
    hot.render();
  }, [hotRef]);

  const toggleStyleProperty = useCallback((property: keyof CellStyle, activeValue: any, inactiveValue: any) => {
    const hot = hotRef.current?.hotInstance;
    if (!hot) return;
    
    const selected = hot.getSelected();
    if (!selected) return;
    
    const firstCell = hot.getCellMeta(selected[0][0], selected[0][1]);
    const currentValue = firstCell.style?.[property];
    const newValue = currentValue === activeValue ? inactiveValue : activeValue;
    
    forEachSelectedCell(hot, selected, (row, col) => {
      const meta = hot.getCellMeta(row, col);
      hot.setCellMeta(row, col, 'style', { ...meta.style, [property]: newValue });
      applyStyleToCell(hot, row, col, { [property]: newValue } as Partial<CellStyle>);
    });
    
    hot.render();
  }, [hotRef]);

  const copy = useCallback((formatOnly: boolean = false) => {
    const hot = hotRef.current?.hotInstance;
    if (!hot) return;
    
    const selected = hot.getSelected();
    if (!selected || selected.length === 0) return;
    
    const [startRow, startCol, endRow, endCol] = selected[0];
    const minRow = Math.min(startRow, endRow);
    const maxRow = Math.max(startRow, endRow);
    const minCol = Math.min(startCol, endCol);
    const maxCol = Math.max(startCol, endCol);
    
    const data: CellData[][] = [];
    const styles: Partial<CellStyle>[][] = [];
    
    for (let r = minRow; r <= maxRow; r++) {
      const rowData: CellData[] = [];
      const rowStyles: Partial<CellStyle>[] = [];
      
      for (let c = minCol; c <= maxCol; c++) {
        const value = hot.getDataAtCell(r, c);
        const meta = hot.getCellMeta(r, c);
        
        rowData.push({
          value: formatOnly ? null : value,
          formula: formatOnly ? null : (meta.formula || null),
          style: meta.style || {},
          comment: meta.comment || null,
          hyperlink: meta.hyperlink || null
        });
        
        rowStyles.push(meta.style || {});
      }
      
      data.push(rowData);
      styles.push(rowStyles);
    }
    
    setClipboard({
      mode: 'copy',
      data,
      styles,
      sourceRange: { startRow: minRow, startCol: minCol, endRow: maxRow, endCol: maxCol },
      formatOnly
    });
    
    return { rows: maxRow - minRow + 1, cols: maxCol - minCol + 1 };
  }, [hotRef]);

  const cut = useCallback(() => {
    const result = copy(false);
    if (result) {
      setClipboard(prev => prev ? { ...prev, mode: 'cut' } : null);
    }
    return result;
  }, [copy]);

  const paste = useCallback(() => {
    const hot = hotRef.current?.hotInstance;
    if (!hot || !clipboard) return;
    
    const selected = hot.getSelected();
    if (!selected || selected.length === 0) return;
    
    const [targetRow, targetCol] = [selected[0][0], selected[0][1]];
    saveUndoState(hot);
    
    const { data, sourceRange, mode, formatOnly } = clipboard;
    
    for (let r = 0; r < data.length; r++) {
      for (let c = 0; c < data[r].length; c++) {
        const destRow = targetRow + r;
        const destCol = targetCol + c;
        const cellData = data[r][c];
        
        if (!formatOnly && cellData.value !== null) {
          hot.setDataAtCell(destRow, destCol, cellData.value);
        }
        
        const existingMeta = hot.getCellMeta(destRow, destCol);
        hot.setCellMeta(destRow, destCol, 'style', { ...existingMeta.style, ...cellData.style });
        applyStyleToCell(hot, destRow, destCol, cellData.style);
      }
    }
    
    if (mode === 'cut') {
      for (let r = sourceRange.startRow; r <= sourceRange.endRow; r++) {
        for (let c = sourceRange.startCol; c <= sourceRange.endCol; c++) {
          hot.setDataAtCell(r, c, '');
          hot.setCellMeta(r, c, 'style', {});
        }
      }
      setClipboard(null);
    }
    
    hot.render();
  }, [hotRef, clipboard, saveUndoState]);

  const copyFormat = useCallback(() => copy(true), [copy]);

  const setFont = useCallback((fontFamily: string) => applyStyleToSelection({ fontFamily }), [applyStyleToSelection]);
  const setFontSize = useCallback((fontSize: number) => applyStyleToSelection({ fontSize }), [applyStyleToSelection]);
  const toggleBold = useCallback(() => toggleStyleProperty('fontWeight', 'bold', 'normal'), [toggleStyleProperty]);
  const toggleItalic = useCallback(() => toggleStyleProperty('fontStyle', 'italic', 'normal'), [toggleStyleProperty]);
  const toggleUnderline = useCallback(() => toggleStyleProperty('textDecoration', 'underline', 'none'), [toggleStyleProperty]);
  const setFontColor = useCallback((color: string) => applyStyleToSelection({ fontColor: color }), [applyStyleToSelection]);
  const setFillColor = useCallback((color: string) => applyStyleToSelection({ fillColor: color }), [applyStyleToSelection]);

  const alignLeft = useCallback(() => applyStyleToSelection({ horizontalAlign: 'left' }), [applyStyleToSelection]);
  const alignCenter = useCallback(() => applyStyleToSelection({ horizontalAlign: 'center' }), [applyStyleToSelection]);
  const alignRight = useCallback(() => applyStyleToSelection({ horizontalAlign: 'right' }), [applyStyleToSelection]);
  const wrapText = useCallback(() => toggleStyleProperty('wrapText', true, false), [toggleStyleProperty]);

  const setNumberFormat = useCallback((format: string) => applyStyleToSelection({ numberFormat: format }), [applyStyleToSelection]);

  const setBorders = useCallback((borderType: 'all' | 'outer' | 'inner' | 'top' | 'bottom' | 'left' | 'right' | 'none', style: BorderStyle = { style: 'thin', color: '#000000' }) => {
    const hot = hotRef.current?.hotInstance;
    if (!hot) return;
    
    const selected = hot.getSelected();
    if (!selected) return;
    
    const [startRow, startCol, endRow, endCol] = selected[0];
    const minRow = Math.min(startRow, endRow);
    const maxRow = Math.max(startRow, endRow);
    const minCol = Math.min(startCol, endCol);
    const maxCol = Math.max(startCol, endCol);
    
    saveUndoState(hot);
    
    for (let r = minRow; r <= maxRow; r++) {
      for (let c = minCol; c <= maxCol; c++) {
        const meta = hot.getCellMeta(r, c);
        const currentStyle = meta.style || {};
        const newBorders: Partial<CellStyle> = {};
        
        const isTop = r === minRow;
        const isBottom = r === maxRow;
        const isLeft = c === minCol;
        const isRight = c === maxCol;
        
        if (borderType === 'none') {
          newBorders.borderTop = null;
          newBorders.borderBottom = null;
          newBorders.borderLeft = null;
          newBorders.borderRight = null;
        } else if (borderType === 'all') {
          newBorders.borderTop = style;
          newBorders.borderBottom = style;
          newBorders.borderLeft = style;
          newBorders.borderRight = style;
        } else if (borderType === 'outer') {
          if (isTop) newBorders.borderTop = style;
          if (isBottom) newBorders.borderBottom = style;
          if (isLeft) newBorders.borderLeft = style;
          if (isRight) newBorders.borderRight = style;
        } else {
          if (borderType === 'top' && isTop) newBorders.borderTop = style;
          if (borderType === 'bottom' && isBottom) newBorders.borderBottom = style;
          if (borderType === 'left' && isLeft) newBorders.borderLeft = style;
          if (borderType === 'right' && isRight) newBorders.borderRight = style;
        }
        
        hot.setCellMeta(r, c, 'style', { ...currentStyle, ...newBorders });
        applyBordersToCell(hot, r, c, newBorders);
      }
    }
    
    hot.render();
  }, [hotRef, saveUndoState]);

  const mergeCells = useCallback(() => {
    const hot = hotRef.current?.hotInstance;
    if (!hot) return;
    
    const selected = hot.getSelected();
    if (!selected) return;
    
    const [startRow, startCol, endRow, endCol] = selected[0];
    const minRow = Math.min(startRow, endRow);
    const maxRow = Math.max(startRow, endRow);
    const minCol = Math.min(startCol, endCol);
    const maxCol = Math.max(startCol, endCol);
    
    saveUndoState(hot);
    
    const plugin = hot.getPlugin('mergeCells');
    if (plugin) {
      const existingMerge = mergedCells.find(m => 
        m.startRow === minRow && m.startCol === minCol && m.endRow === maxRow && m.endCol === maxCol
      );
      
      if (existingMerge) {
        plugin.unmerge(minRow, minCol, maxRow, maxCol);
        setMergedCells(prev => prev.filter(m => m !== existingMerge));
      } else {
        plugin.merge(minRow, minCol, maxRow, maxCol);
        setMergedCells(prev => [...prev, { startRow: minRow, startCol: minCol, endRow: maxRow, endCol: maxCol }]);
      }
    }
    
    hot.render();
  }, [hotRef, mergedCells, saveUndoState]);

  const insertRow = useCallback(() => {
    const hot = hotRef.current?.hotInstance;
    if (!hot) return;
    
    const selected = hot.getSelected();
    if (!selected) return;
    
    saveUndoState(hot);
    hot.alter('insert_row_below', selected[0][0]);
  }, [hotRef, saveUndoState]);

  const deleteRow = useCallback(() => {
    const hot = hotRef.current?.hotInstance;
    if (!hot) return;
    
    const selected = hot.getSelected();
    if (!selected) return;
    
    saveUndoState(hot);
    hot.alter('remove_row', selected[0][0]);
  }, [hotRef, saveUndoState]);

  const insertColumn = useCallback(() => {
    const hot = hotRef.current?.hotInstance;
    if (!hot) return;
    
    const selected = hot.getSelected();
    if (!selected) return;
    
    saveUndoState(hot);
    hot.alter('insert_col_end', selected[0][1]);
  }, [hotRef, saveUndoState]);

  const deleteColumn = useCallback(() => {
    const hot = hotRef.current?.hotInstance;
    if (!hot) return;
    
    const selected = hot.getSelected();
    if (!selected) return;
    
    saveUndoState(hot);
    hot.alter('remove_col', selected[0][1]);
  }, [hotRef, saveUndoState]);

  const sort = useCallback((direction: 'asc' | 'desc') => {
    const hot = hotRef.current?.hotInstance;
    if (!hot) return;
    
    const selected = hot.getSelected();
    if (!selected) return;
    
    const col = selected[0][1];
    const plugin = hot.getPlugin('columnSorting');
    
    if (plugin) {
      plugin.sort({ column: col, sortOrder: direction });
    }
  }, [hotRef]);

  const filter = useCallback(() => {
    const hot = hotRef.current?.hotInstance;
    if (!hot) return;
    
    const plugin = hot.getPlugin('filters');
    if (plugin) {
      const isEnabled = plugin.enabled;
      if (isEnabled) {
        plugin.disablePlugin();
      } else {
        plugin.enablePlugin();
      }
    }
    
    hot.render();
  }, [hotRef]);

  const undo = useCallback(() => {
    const hot = hotRef.current?.hotInstance;
    if (!hot || undoStackRef.current.length === 0) return;
    
    const currentData = hot.getData();
    redoStackRef.current.push(JSON.parse(JSON.stringify(currentData)));
    
    const previousData = undoStackRef.current.pop();
    hot.loadData(previousData);
  }, [hotRef]);

  const redo = useCallback(() => {
    const hot = hotRef.current?.hotInstance;
    if (!hot || redoStackRef.current.length === 0) return;
    
    const currentData = hot.getData();
    undoStackRef.current.push(JSON.parse(JSON.stringify(currentData)));
    
    const nextData = redoStackRef.current.pop();
    hot.loadData(nextData);
  }, [hotRef]);

  const insertChart = useCallback((type: 'bar' | 'line' | 'pie') => {
    console.log('Insert chart:', type);
  }, []);

  const applyConditionalFormat = useCallback(() => {
    console.log('Apply conditional format');
  }, []);

  const toggleGridlines = useCallback(() => {
    const hot = hotRef.current?.hotInstance;
    if (!hot) return;
    
    const currentSetting = hot.getSettings().colHeaders;
    hot.updateSettings({ colHeaders: !currentSetting, rowHeaders: !currentSetting });
  }, [hotRef]);

  const freezePanes = useCallback(() => {
    const hot = hotRef.current?.hotInstance;
    if (!hot) return;
    
    const selected = hot.getSelected();
    if (!selected) return;
    
    const [row, col] = [selected[0][0], selected[0][1]];
    hot.updateSettings({ fixedRowsTop: row, fixedColumnsStart: col });
  }, [hotRef]);

  return {
    copy,
    cut,
    paste,
    copyFormat,
    setFont,
    setFontSize,
    toggleBold,
    toggleItalic,
    toggleUnderline,
    setFontColor,
    setFillColor,
    alignLeft,
    alignCenter,
    alignRight,
    wrapText,
    setNumberFormat,
    setBorders,
    mergeCells,
    insertRow,
    deleteRow,
    insertColumn,
    deleteColumn,
    sort,
    filter,
    undo,
    redo,
    insertChart,
    applyConditionalFormat,
    toggleGridlines,
    freezePanes,
    clipboard,
    mergedCells,
    conditionalRules
  };
}
