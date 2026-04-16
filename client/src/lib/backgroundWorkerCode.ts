export const WORKER_CODE = `
let state = {
  isProcessing: false,
  isPaused: false,
  taskQueue: [],
  completedTasks: [],
  currentTask: null,
  startTime: null,
  processedCount: 0,
  totalCount: 0
};

self.onmessage = function(event) {
  const { type, payload, id } = event.data;
  
  switch(type) {
    case 'INIT':
      handleInit(payload);
      break;
    case 'START':
      handleStart(payload);
      break;
    case 'ADD_TASKS':
      handleAddTasks(payload);
      break;
    case 'PAUSE':
      handlePause();
      break;
    case 'RESUME':
      handleResume();
      break;
    case 'CANCEL':
      handleCancel();
      break;
    case 'GET_STATUS':
      sendStatus();
      break;
    case 'PING':
      self.postMessage({ type: 'PONG', id });
      break;
  }
};

function handleInit(config) {
  state = { ...state, ...config };
  self.postMessage({ type: 'INITIALIZED', payload: { ready: true } });
}

function handleStart(tasks) {
  if (state.isProcessing) {
    self.postMessage({ type: 'ERROR', payload: { message: 'Already processing' } });
    return;
  }
  
  state.taskQueue = Array.isArray(tasks) ? [...tasks] : [];
  state.totalCount = state.taskQueue.length;
  state.processedCount = 0;
  state.completedTasks = [];
  state.isProcessing = true;
  state.isPaused = false;
  state.startTime = Date.now();
  
  self.postMessage({ 
    type: 'STARTED', 
    payload: { 
      total: state.totalCount,
      startTime: state.startTime 
    } 
  });
  
  processLoop();
}

function handleAddTasks(newTasks) {
  if (!Array.isArray(newTasks)) return;
  
  state.taskQueue.push(...newTasks);
  state.totalCount += newTasks.length;
  
  self.postMessage({ 
    type: 'TASKS_ADDED', 
    payload: { 
      added: newTasks.length,
      total: state.totalCount,
      pending: state.taskQueue.length
    } 
  });
  
  if (state.isProcessing && !state.isPaused && !state.currentTask) {
    processLoop();
  }
}

function handlePause() {
  state.isPaused = true;
  self.postMessage({ type: 'PAUSED', payload: { pending: state.taskQueue.length } });
}

function handleResume() {
  if (!state.isProcessing) return;
  
  state.isPaused = false;
  self.postMessage({ type: 'RESUMED' });
  processLoop();
}

function handleCancel() {
  state.isProcessing = false;
  state.isPaused = false;
  state.taskQueue = [];
  state.currentTask = null;
  
  self.postMessage({ 
    type: 'CANCELLED', 
    payload: { 
      processed: state.processedCount,
      cancelled: state.totalCount - state.processedCount 
    } 
  });
}

function sendStatus() {
  const elapsed = state.startTime ? Date.now() - state.startTime : 0;
  const rate = elapsed > 0 ? (state.processedCount / elapsed) * 1000 : 0;
  const eta = rate > 0 ? (state.taskQueue.length / rate) * 1000 : 0;
  
  self.postMessage({
    type: 'STATUS',
    payload: {
      isProcessing: state.isProcessing,
      isPaused: state.isPaused,
      processed: state.processedCount,
      total: state.totalCount,
      pending: state.taskQueue.length,
      elapsed,
      rate: Math.round(rate * 100) / 100,
      eta: Math.round(eta)
    }
  });
}

function processLoop() {
  const BATCH_SIZE = 50;
  let batchCount = 0;
  
  while (
    state.isProcessing && 
    !state.isPaused && 
    state.taskQueue.length > 0 &&
    batchCount < BATCH_SIZE
  ) {
    state.currentTask = state.taskQueue.shift();
    
    try {
      const result = executeTask(state.currentTask);
      state.completedTasks.push(result);
      state.processedCount++;
      batchCount++;
      
      self.postMessage({
        type: 'TASK_COMPLETED',
        payload: {
          task: state.currentTask,
          result,
          progress: {
            current: state.processedCount,
            total: state.totalCount,
            percent: Math.round((state.processedCount / state.totalCount) * 100)
          }
        }
      });
      
    } catch (error) {
      self.postMessage({
        type: 'TASK_ERROR',
        payload: {
          task: state.currentTask,
          error: error.message
        }
      });
    }
    
    state.currentTask = null;
  }
  
  if (state.isProcessing && !state.isPaused && state.taskQueue.length > 0) {
    const channel = new MessageChannel();
    channel.port1.onmessage = () => processLoop();
    channel.port2.postMessage('');
  } else if (state.taskQueue.length === 0 && state.isProcessing) {
    const elapsed = Date.now() - state.startTime;
    
    self.postMessage({
      type: 'COMPLETED',
      payload: {
        total: state.processedCount,
        elapsed,
        rate: Math.round((state.processedCount / elapsed) * 1000 * 100) / 100,
        results: state.completedTasks
      }
    });
    
    state.isProcessing = false;
  }
}

function executeTask(task) {
  if (!task || !task.action) {
    throw new Error('Invalid task');
  }
  
  switch(task.action) {
    case 'INSERT_CELL':
      return {
        type: 'CELL_UPDATE',
        row: task.row,
        col: task.col,
        value: task.value,
        format: task.format || {}
      };
    
    case 'EVALUATE_FORMULA':
      const evaluated = evaluateFormula(task.formula, task.context || {});
      return {
        type: 'CELL_UPDATE',
        row: task.row,
        col: task.col,
        value: evaluated,
        formula: task.formula
      };
    
    case 'BULK_INSERT':
      return {
        type: 'BULK_UPDATE',
        cells: task.cells.map(cell => ({
          row: cell.row,
          col: cell.col,
          value: cell.value
        }))
      };
    
    case 'CREATE_SHEET':
      return {
        type: 'SHEET_CREATED',
        sheetId: task.sheetId || 'sheet_' + Date.now(),
        name: task.name
      };
    
    case 'GENERATE_CHART':
      return {
        type: 'CHART_CREATED',
        chartId: 'chart_' + Date.now(),
        chartType: task.chartType,
        dataRange: task.dataRange,
        options: task.options
      };
    
    case 'APPLY_FORMAT':
      return {
        type: 'FORMAT_APPLIED',
        range: task.range,
        format: task.format
      };
    
    default:
      return { type: 'UNKNOWN', task };
  }
}

function evaluateFormula(formula, context) {
  if (!formula || typeof formula !== 'string') return formula;
  if (!formula.startsWith('=')) return formula;
  
  const expr = formula.substring(1).toUpperCase().trim();
  const gridData = context.gridData || {};
  
  try {
    if (expr.startsWith('SUM(')) {
      const rangeMatch = expr.match(/SUM\\(([^)]+)\\)/);
      if (rangeMatch) {
        const values = getRangeValues(rangeMatch[1], gridData);
        return values.reduce((sum, val) => sum + (parseFloat(val) || 0), 0);
      }
    }
    
    if (expr.startsWith('AVERAGE(')) {
      const rangeMatch = expr.match(/AVERAGE\\(([^)]+)\\)/);
      if (rangeMatch) {
        const values = getRangeValues(rangeMatch[1], gridData);
        const nums = values.filter(v => !isNaN(parseFloat(v))).map(v => parseFloat(v));
        return nums.length > 0 ? nums.reduce((a, b) => a + b, 0) / nums.length : 0;
      }
    }
    
    if (expr.startsWith('COUNT(')) {
      const rangeMatch = expr.match(/COUNT\\(([^)]+)\\)/);
      if (rangeMatch) {
        const values = getRangeValues(rangeMatch[1], gridData);
        return values.filter(v => !isNaN(parseFloat(v))).length;
      }
    }
    
    if (expr.startsWith('MAX(')) {
      const rangeMatch = expr.match(/MAX\\(([^)]+)\\)/);
      if (rangeMatch) {
        const values = getRangeValues(rangeMatch[1], gridData);
        const nums = values.filter(v => !isNaN(parseFloat(v))).map(v => parseFloat(v));
        return nums.length > 0 ? Math.max(...nums) : 0;
      }
    }
    
    if (expr.startsWith('MIN(')) {
      const rangeMatch = expr.match(/MIN\\(([^)]+)\\)/);
      if (rangeMatch) {
        const values = getRangeValues(rangeMatch[1], gridData);
        const nums = values.filter(v => !isNaN(parseFloat(v))).map(v => parseFloat(v));
        return nums.length > 0 ? Math.min(...nums) : 0;
      }
    }
    
    const mathExpr = expr.replace(/([A-Z]+)(\\d+)/gi, (match, col, row) => {
      const colIndex = columnToIndex(col);
      const rowIndex = parseInt(row) - 1;
      const key = rowIndex + ':' + colIndex;
      const value = gridData[key];
      return parseFloat(value) || 0;
    });
    
    return safeEval(mathExpr);
    
  } catch (error) {
    return '#ERROR: ' + error.message;
  }
}

function getRangeValues(rangeStr, gridData) {
  const [start, end] = rangeStr.split(':');
  if (!start) return [];
  
  const startRef = parseRef(start);
  const endRef = end ? parseRef(end) : startRef;
  
  if (!startRef || !endRef) return [];
  
  const values = [];
  for (let r = startRef.row; r <= endRef.row; r++) {
    for (let c = startRef.col; c <= endRef.col; c++) {
      const key = r + ':' + c;
      if (gridData[key] !== undefined) {
        values.push(gridData[key]);
      }
    }
  }
  return values;
}

function parseRef(ref) {
  const match = ref.trim().match(/^([A-Z]+)(\\d+)$/i);
  if (!match) return null;
  return {
    col: columnToIndex(match[1]),
    row: parseInt(match[2]) - 1
  };
}

function columnToIndex(col) {
  let index = 0;
  const upper = col.toUpperCase();
  for (let i = 0; i < upper.length; i++) {
    index = index * 26 + (upper.charCodeAt(i) - 64);
  }
  return index - 1;
}

function safeEval(expr) {
  const sanitized = expr.replace(/[^0-9+\\-*/().\\s]/g, '');
  if (sanitized !== expr.replace(/\\s/g, '')) {
    throw new Error('Invalid expression');
  }
  return Function('"use strict"; return (' + sanitized + ')')();
}

self.postMessage({ type: 'READY', payload: { timestamp: Date.now() } });
`;
