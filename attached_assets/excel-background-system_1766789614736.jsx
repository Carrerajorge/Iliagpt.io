// ============================================================
// SISTEMA COMPLETO DE EXCEL CON PROCESAMIENTO EN SEGUNDO PLANO
// ============================================================
// Autor: Sistema generado para procesamiento que continúa
// aunque el usuario cambie de pestaña o minimice el navegador
// ============================================================

import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import {
  BarChart, Bar, PieChart, Pie, LineChart, Line, AreaChart, Area,
  XAxis, YAxis, CartesianGrid, Tooltip, Legend, Cell, ResponsiveContainer
} from 'recharts';

// ============================================================
// PARTE 1: CÓDIGO DEL WEB WORKER (Embebido como string)
// ============================================================
// Este código se ejecuta en un hilo separado, INMUNE al throttling
// del navegador cuando la pestaña está inactiva

const WORKER_CODE = `
// ========================================
// ESTADO GLOBAL DEL WORKER
// ========================================
let state = {
  isProcessing: false,
  isPaused: false,
  taskQueue: [],
  completedTasks: [],
  currentTask: null,
  startTime: null,
  processedCount: 0,
  totalCount: 0,
  gridData: {}
};

// ========================================
// LISTENER DE MENSAJES DEL MAIN THREAD
// ========================================
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
    case 'UPDATE_GRID_DATA':
      state.gridData = { ...state.gridData, ...payload };
      break;
    case 'PING':
      self.postMessage({ type: 'PONG', id, timestamp: Date.now() });
      break;
  }
};

// ========================================
// HANDLERS DE COMANDOS
// ========================================
function handleInit(config) {
  if (config) {
    state = { ...state, ...config };
  }
  self.postMessage({ type: 'INITIALIZED', payload: { ready: true, timestamp: Date.now() } });
}

function handleStart(tasks) {
  if (state.isProcessing) {
    self.postMessage({ type: 'ERROR', payload: { message: 'Already processing', code: 'ALREADY_RUNNING' } });
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
  self.postMessage({ 
    type: 'PAUSED', 
    payload: { 
      pending: state.taskQueue.length,
      processed: state.processedCount 
    } 
  });
}

function handleResume() {
  if (!state.isProcessing) {
    self.postMessage({ type: 'ERROR', payload: { message: 'No active processing', code: 'NOT_RUNNING' } });
    return;
  }
  
  state.isPaused = false;
  self.postMessage({ type: 'RESUMED', payload: { pending: state.taskQueue.length } });
  processLoop();
}

function handleCancel() {
  const wasPending = state.taskQueue.length;
  
  state.isProcessing = false;
  state.isPaused = false;
  state.taskQueue = [];
  state.currentTask = null;
  
  self.postMessage({ 
    type: 'CANCELLED', 
    payload: { 
      processed: state.processedCount,
      cancelled: wasPending 
    } 
  });
}

function sendStatus() {
  const now = Date.now();
  const elapsed = state.startTime ? now - state.startTime : 0;
  const rate = elapsed > 0 ? (state.processedCount / elapsed) * 1000 : 0;
  const remaining = state.totalCount - state.processedCount;
  const eta = rate > 0 ? (remaining / rate) * 1000 : 0;
  
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
      eta: Math.round(eta),
      percent: state.totalCount > 0 ? Math.round((state.processedCount / state.totalCount) * 100) : 0
    }
  });
}

// ========================================
// LOOP DE PROCESAMIENTO (SIN setTimeout)
// ========================================
// Usa MessageChannel para evitar throttling en tabs inactivos

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
      
      // Actualizar gridData local si es una celda
      if (result && result.type === 'CELL_UPDATE') {
        const key = result.row + ':' + result.col;
        state.gridData[key] = result.value;
      }
      
      state.completedTasks.push(result);
      state.processedCount++;
      batchCount++;
      
      // Enviar resultado
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
  
  // Continuar con siguiente batch usando MessageChannel (NO setTimeout)
  if (state.isProcessing && !state.isPaused && state.taskQueue.length > 0) {
    const channel = new MessageChannel();
    channel.port1.onmessage = () => processLoop();
    channel.port2.postMessage('');
  } else if (state.taskQueue.length === 0 && state.isProcessing) {
    // Completado
    const elapsed = Date.now() - state.startTime;
    
    self.postMessage({
      type: 'COMPLETED',
      payload: {
        total: state.processedCount,
        elapsed,
        rate: Math.round((state.processedCount / elapsed) * 1000 * 100) / 100
      }
    });
    
    state.isProcessing = false;
  }
}

// ========================================
// EJECUTOR DE TAREAS
// ========================================
function executeTask(task) {
  if (!task || !task.action) {
    throw new Error('Invalid task: missing action');
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
      const evaluated = evaluateFormula(task.formula, state.gridData);
      return {
        type: 'CELL_UPDATE',
        row: task.row,
        col: task.col,
        value: evaluated,
        formula: task.formula,
        format: task.format || {}
      };
    
    case 'BULK_INSERT':
      return {
        type: 'BULK_UPDATE',
        cells: (task.cells || []).map(cell => ({
          row: cell.row,
          col: cell.col,
          value: cell.value,
          format: cell.format || {}
        }))
      };
    
    case 'CREATE_SHEET':
      return {
        type: 'SHEET_CREATED',
        sheetId: task.sheetId || 'sheet_' + Date.now(),
        name: task.name || 'Nueva Hoja'
      };
    
    case 'GENERATE_CHART':
      return {
        type: 'CHART_CREATED',
        chartId: 'chart_' + Date.now(),
        chartType: task.chartType || 'bar',
        title: task.title || 'Gráfico',
        dataRange: task.dataRange,
        position: task.position || { row: 0, col: 6 },
        size: task.size || { width: 400, height: 300 }
      };
    
    case 'APPLY_FORMAT':
      return {
        type: 'FORMAT_APPLIED',
        range: task.range,
        format: task.format
      };
    
    case 'APPLY_CONDITIONAL_FORMAT':
      return {
        type: 'CONDITIONAL_FORMAT_APPLIED',
        range: task.range,
        rules: task.rules
      };
    
    default:
      return { type: 'UNKNOWN', originalTask: task };
  }
}

// ========================================
// MOTOR DE FÓRMULAS
// ========================================
function evaluateFormula(formula, gridData) {
  if (!formula || typeof formula !== 'string') return formula;
  if (!formula.startsWith('=')) return formula;
  
  const expr = formula.substring(1).toUpperCase().trim();
  
  try {
    // SUM
    if (expr.startsWith('SUM(')) {
      const rangeMatch = expr.match(/SUM\\(([^)]+)\\)/);
      if (rangeMatch) {
        const values = getRangeValues(rangeMatch[1], gridData);
        return values.reduce((sum, val) => sum + (parseFloat(val) || 0), 0);
      }
    }
    
    // AVERAGE
    if (expr.startsWith('AVERAGE(')) {
      const rangeMatch = expr.match(/AVERAGE\\(([^)]+)\\)/);
      if (rangeMatch) {
        const values = getRangeValues(rangeMatch[1], gridData);
        const nums = values.filter(v => !isNaN(parseFloat(v))).map(v => parseFloat(v));
        return nums.length > 0 ? nums.reduce((a, b) => a + b, 0) / nums.length : 0;
      }
    }
    
    // COUNT
    if (expr.startsWith('COUNT(')) {
      const rangeMatch = expr.match(/COUNT\\(([^)]+)\\)/);
      if (rangeMatch) {
        const values = getRangeValues(rangeMatch[1], gridData);
        return values.filter(v => !isNaN(parseFloat(v))).length;
      }
    }
    
    // MAX
    if (expr.startsWith('MAX(')) {
      const rangeMatch = expr.match(/MAX\\(([^)]+)\\)/);
      if (rangeMatch) {
        const values = getRangeValues(rangeMatch[1], gridData);
        const nums = values.filter(v => !isNaN(parseFloat(v))).map(v => parseFloat(v));
        return nums.length > 0 ? Math.max(...nums) : 0;
      }
    }
    
    // MIN
    if (expr.startsWith('MIN(')) {
      const rangeMatch = expr.match(/MIN\\(([^)]+)\\)/);
      if (rangeMatch) {
        const values = getRangeValues(rangeMatch[1], gridData);
        const nums = values.filter(v => !isNaN(parseFloat(v))).map(v => parseFloat(v));
        return nums.length > 0 ? Math.min(...nums) : 0;
      }
    }
    
    // ROUND
    if (expr.startsWith('ROUND(')) {
      const match = expr.match(/ROUND\\(([^,]+),\\s*(\\d+)\\)/);
      if (match) {
        const value = evaluateSimpleExpr(match[1], gridData);
        const decimals = parseInt(match[2]);
        return Number(value.toFixed(decimals));
      }
    }
    
    // IF
    if (expr.startsWith('IF(')) {
      return evaluateIf(expr, gridData);
    }
    
    // Expresión matemática simple (=A1*B1, =C2+D2, etc.)
    return evaluateSimpleExpr(expr, gridData);
    
  } catch (error) {
    return '#ERROR: ' + error.message;
  }
}

function getRangeValues(rangeStr, gridData) {
  // Manejar referencia a otra hoja: Ventas!A1:B10
  let actualRange = rangeStr;
  if (rangeStr.includes('!')) {
    const parts = rangeStr.split('!');
    actualRange = parts[1]; // Solo tomar el rango, ignorar la hoja por ahora
  }
  
  const [start, end] = actualRange.split(':');
  if (!start) return [];
  
  const startRef = parseRef(start.trim());
  const endRef = end ? parseRef(end.trim()) : startRef;
  
  if (!startRef || !endRef) return [];
  
  const values = [];
  for (let r = startRef.row; r <= endRef.row; r++) {
    for (let c = startRef.col; c <= endRef.col; c++) {
      const key = r + ':' + c;
      if (gridData[key] !== undefined && gridData[key] !== null && gridData[key] !== '') {
        values.push(gridData[key]);
      }
    }
  }
  return values;
}

function parseRef(ref) {
  const match = ref.match(/^([A-Z]+)(\\d+)$/i);
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

function evaluateSimpleExpr(expr, gridData) {
  // Reemplazar referencias de celdas con sus valores
  const resolved = expr.replace(/([A-Z]+)(\\d+)/gi, (match, col, row) => {
    const colIndex = columnToIndex(col);
    const rowIndex = parseInt(row) - 1;
    const key = rowIndex + ':' + colIndex;
    const value = gridData[key];
    return parseFloat(value) || 0;
  });
  
  // Evaluar expresión matemática de forma segura
  return safeEval(resolved);
}

function evaluateIf(expr, gridData) {
  // IF(condition, trueValue, falseValue)
  const inner = expr.slice(3, -1); // Quitar IF( y )
  const parts = splitIfArguments(inner);
  
  if (parts.length !== 3) return '#ERROR: IF needs 3 arguments';
  
  const condition = evaluateCondition(parts[0].trim(), gridData);
  const trueVal = evaluateSimpleExpr(parts[1].trim(), gridData);
  const falseVal = evaluateSimpleExpr(parts[2].trim(), gridData);
  
  return condition ? trueVal : falseVal;
}

function splitIfArguments(str) {
  const args = [];
  let depth = 0;
  let current = '';
  
  for (const char of str) {
    if (char === '(') depth++;
    if (char === ')') depth--;
    if (char === ',' && depth === 0) {
      args.push(current);
      current = '';
    } else {
      current += char;
    }
  }
  args.push(current);
  return args;
}

function evaluateCondition(condition, gridData) {
  // Soportar >, <, >=, <=, =, <>
  const operators = ['>=', '<=', '<>', '>', '<', '='];
  
  for (const op of operators) {
    if (condition.includes(op)) {
      const [left, right] = condition.split(op);
      const leftVal = evaluateSimpleExpr(left.trim(), gridData);
      const rightVal = evaluateSimpleExpr(right.trim(), gridData);
      
      switch(op) {
        case '>': return leftVal > rightVal;
        case '<': return leftVal < rightVal;
        case '>=': return leftVal >= rightVal;
        case '<=': return leftVal <= rightVal;
        case '=': return leftVal === rightVal;
        case '<>': return leftVal !== rightVal;
      }
    }
  }
  
  return false;
}

function safeEval(expr) {
  // Solo permitir números y operadores matemáticos básicos
  const sanitized = expr.replace(/[^0-9+\\-*/().\\s]/g, '');
  if (sanitized.trim() === '') return 0;
  
  try {
    return Function('"use strict"; return (' + sanitized + ')')();
  } catch (e) {
    return 0;
  }
}

// ========================================
// NOTIFICAR QUE EL WORKER ESTÁ LISTO
// ========================================
self.postMessage({ type: 'READY', payload: { timestamp: Date.now() } });
`;

// ============================================================
// PARTE 2: SERVICIO DE PERSISTENCIA (IndexedDB)
// ============================================================

class TaskPersistenceService {
  constructor() {
    this.dbName = 'ExcelBackgroundProcessingDB';
    this.dbVersion = 1;
    this.db = null;
  }

  async initialize() {
    return new Promise((resolve, reject) => {
      const request = indexedDB.open(this.dbName, this.dbVersion);

      request.onerror = () => {
        console.error('Error opening IndexedDB:', request.error);
        reject(new Error('Failed to open IndexedDB'));
      };

      request.onsuccess = (event) => {
        this.db = event.target.result;
        console.log('✅ IndexedDB inicializado correctamente');
        resolve(this.db);
      };

      request.onupgradeneeded = (event) => {
        const db = event.target.result;

        // Store para tareas pendientes
        if (!db.objectStoreNames.contains('pendingTasks')) {
          const taskStore = db.createObjectStore('pendingTasks', { 
            keyPath: 'id', 
            autoIncrement: true 
          });
          taskStore.createIndex('status', 'status', { unique: false });
          taskStore.createIndex('priority', 'priority', { unique: false });
          taskStore.createIndex('createdAt', 'createdAt', { unique: false });
        }

        // Store para resultados completados
        if (!db.objectStoreNames.contains('completedResults')) {
          const resultStore = db.createObjectStore('completedResults', { 
            keyPath: 'id', 
            autoIncrement: true 
          });
          resultStore.createIndex('taskId', 'taskId', { unique: false });
          resultStore.createIndex('completedAt', 'completedAt', { unique: false });
        }

        // Store para estado del procesamiento
        if (!db.objectStoreNames.contains('processingState')) {
          db.createObjectStore('processingState', { keyPath: 'key' });
        }
      };
    });
  }

  async saveTasks(tasks) {
    if (!this.db) await this.initialize();
    
    const tx = this.db.transaction('pendingTasks', 'readwrite');
    const store = tx.objectStore('pendingTasks');
    
    const ids = [];
    for (const task of tasks) {
      const taskWithMeta = {
        ...task,
        status: 'pending',
        priority: task.priority || 0,
        createdAt: Date.now(),
        attempts: 0
      };
      const id = await this._promisifyRequest(store.add(taskWithMeta));
      ids.push(id);
    }
    
    return ids;
  }

  async getPendingTasks() {
    if (!this.db) await this.initialize();
    
    const tx = this.db.transaction('pendingTasks', 'readonly');
    const store = tx.objectStore('pendingTasks');
    const index = store.index('status');
    return this._promisifyRequest(index.getAll('pending'));
  }

  async updateTaskStatus(taskId, status) {
    if (!this.db) return;
    
    const tx = this.db.transaction('pendingTasks', 'readwrite');
    const store = tx.objectStore('pendingTasks');
    
    const task = await this._promisifyRequest(store.get(taskId));
    if (task) {
      task.status = status;
      task.updatedAt = Date.now();
      await this._promisifyRequest(store.put(task));
    }
  }

  async clearAllTasks() {
    if (!this.db) return;
    
    const tx = this.db.transaction('pendingTasks', 'readwrite');
    const store = tx.objectStore('pendingTasks');
    await this._promisifyRequest(store.clear());
  }

  async saveState(key, value) {
    if (!this.db) await this.initialize();
    
    const tx = this.db.transaction('processingState', 'readwrite');
    const store = tx.objectStore('processingState');
    await this._promisifyRequest(store.put({ key, value, updatedAt: Date.now() }));
  }

  async getState(key) {
    if (!this.db) await this.initialize();
    
    const tx = this.db.transaction('processingState', 'readonly');
    const store = tx.objectStore('processingState');
    const result = await this._promisifyRequest(store.get(key));
    return result?.value;
  }

  _promisifyRequest(request) {
    return new Promise((resolve, reject) => {
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  }
}

// ============================================================
// PARTE 3: COORDINADOR DE PESTAÑAS (BroadcastChannel)
// ============================================================

class TabCoordinator {
  constructor(channelName = 'excel-background-channel') {
    this.channelName = channelName;
    this.channel = null;
    this.tabId = this._generateTabId();
    this.isLeader = false;
    this.leaderId = null;
    this.listeners = new Map();
    this.heartbeatInterval = null;
    this.lastHeartbeats = new Map();

    this._init();
  }

  _init() {
    try {
      this.channel = new BroadcastChannel(this.channelName);
      this._setupListeners();
      this._startHeartbeat();
      
      // Pequeño delay para permitir que otras tabs respondan
      setTimeout(() => this._electLeader(), 500);
    } catch (error) {
      console.warn('BroadcastChannel not supported:', error);
    }
  }

  _generateTabId() {
    return `tab_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }

  _setupListeners() {
    if (!this.channel) return;

    this.channel.onmessage = (event) => {
      const { type, senderId, payload } = event.data;

      if (senderId === this.tabId) return;

      switch (type) {
        case 'HEARTBEAT':
          this.lastHeartbeats.set(senderId, Date.now());
          break;
        case 'LEADER_ANNOUNCEMENT':
          this.leaderId = payload.leaderId;
          this.isLeader = this.leaderId === this.tabId;
          break;
        case 'TASK_CLAIMED':
          this._emit('taskClaimed', payload);
          break;
        case 'TASK_COMPLETED':
          this._emit('taskCompleted', payload);
          break;
        case 'STATE_SYNC':
          this._emit('stateSync', payload);
          break;
      }

      this._emit('message', { type, senderId, payload });
    };
  }

  _startHeartbeat() {
    // Enviar heartbeat inicial
    this._broadcast('HEARTBEAT', { timestamp: Date.now() });

    this.heartbeatInterval = setInterval(() => {
      this._broadcast('HEARTBEAT', { timestamp: Date.now() });
      this._cleanupDeadTabs();
    }, 2000);
  }

  _cleanupDeadTabs() {
    const now = Date.now();
    const timeout = 6000;

    for (const [tabId, lastSeen] of this.lastHeartbeats) {
      if (now - lastSeen > timeout) {
        this.lastHeartbeats.delete(tabId);
        
        if (tabId === this.leaderId) {
          this._electLeader();
        }
      }
    }
  }

  _electLeader() {
    const allTabs = [this.tabId, ...this.lastHeartbeats.keys()].sort();
    const newLeader = allTabs[0];
    
    const wasLeader = this.isLeader;
    this.isLeader = newLeader === this.tabId;
    this.leaderId = newLeader;

    if (this.isLeader) {
      this._broadcast('LEADER_ANNOUNCEMENT', { leaderId: this.tabId });
      
      if (!wasLeader) {
        console.log('👑 Esta pestaña es ahora el líder');
        this._emit('becameLeader');
      }
    }
  }

  _broadcast(type, payload) {
    if (!this.channel) return;
    
    try {
      this.channel.postMessage({
        type,
        senderId: this.tabId,
        payload,
        timestamp: Date.now()
      });
    } catch (error) {
      console.warn('Error broadcasting:', error);
    }
  }

  _emit(event, data) {
    const listeners = this.listeners.get(event) || [];
    listeners.forEach(callback => {
      try {
        callback(data);
      } catch (error) {
        console.error('Error in listener:', error);
      }
    });
  }

  // API Pública
  on(event, callback) {
    if (!this.listeners.has(event)) {
      this.listeners.set(event, []);
    }
    this.listeners.get(event).push(callback);
    
    return () => this.off(event, callback);
  }

  off(event, callback) {
    const listeners = this.listeners.get(event) || [];
    const index = listeners.indexOf(callback);
    if (index > -1) {
      listeners.splice(index, 1);
    }
  }

  broadcast(type, payload) {
    this._broadcast(type, payload);
  }

  reportTaskCompletion(taskId, result) {
    this._broadcast('TASK_COMPLETED', { taskId, result, completedBy: this.tabId });
  }

  syncState(state) {
    this._broadcast('STATE_SYNC', { state, from: this.tabId });
  }

  destroy() {
    if (this.heartbeatInterval) {
      clearInterval(this.heartbeatInterval);
    }
    if (this.channel) {
      this.channel.close();
    }
    this.listeners.clear();
  }
}

// ============================================================
// PARTE 4: HOOK PRINCIPAL DE BACKGROUND PROCESSING
// ============================================================

const useBackgroundProcessing = (options = {}) => {
  const {
    onCellUpdate,
    onSheetCreated,
    onChartCreated,
    onFormatApplied,
    onComplete,
    onError,
    onProgress,
    autoRecover = true
  } = options;

  // Estado
  const [status, setStatus] = useState('idle');
  const [progress, setProgress] = useState({ current: 0, total: 0, percent: 0 });
  const [isPageVisible, setIsPageVisible] = useState(true);
  const [isLeader, setIsLeader] = useState(false);
  const [stats, setStats] = useState({ rate: 0, eta: 0, elapsed: 0 });

  // Referencias
  const workerRef = useRef(null);
  const persistenceRef = useRef(null);
  const coordinatorRef = useRef(null);
  const pendingUpdatesRef = useRef([]);
  const callbacksRef = useRef({});

  // Actualizar refs de callbacks
  useEffect(() => {
    callbacksRef.current = {
      onCellUpdate,
      onSheetCreated,
      onChartCreated,
      onFormatApplied,
      onComplete,
      onError,
      onProgress
    };
  }, [onCellUpdate, onSheetCreated, onChartCreated, onFormatApplied, onComplete, onError, onProgress]);

  // Aplicar resultado
  const applyResult = useCallback((result) => {
    if (!result) return;

    switch (result.type) {
      case 'CELL_UPDATE':
        callbacksRef.current.onCellUpdate?.({
          row: result.row,
          col: result.col,
          value: result.value,
          formula: result.formula,
          format: result.format
        });
        break;

      case 'BULK_UPDATE':
        result.cells?.forEach(cell => {
          callbacksRef.current.onCellUpdate?.(cell);
        });
        break;

      case 'SHEET_CREATED':
        callbacksRef.current.onSheetCreated?.(result);
        break;

      case 'CHART_CREATED':
        callbacksRef.current.onChartCreated?.(result);
        break;

      case 'FORMAT_APPLIED':
      case 'CONDITIONAL_FORMAT_APPLIED':
        callbacksRef.current.onFormatApplied?.(result);
        break;
    }
  }, []);

  // Flush pending updates
  const flushPendingUpdates = useCallback(() => {
    if (pendingUpdatesRef.current.length === 0) return;

    console.log(`📥 Aplicando ${pendingUpdatesRef.current.length} actualizaciones pendientes`);
    
    requestAnimationFrame(() => {
      pendingUpdatesRef.current.forEach(result => applyResult(result));
      pendingUpdatesRef.current = [];
    });
  }, [applyResult]);

  // Handler de mensajes del worker
  const handleWorkerMessage = useCallback((event) => {
    const { type, payload } = event.data;

    switch (type) {
      case 'READY':
        console.log('✅ Worker listo');
        break;

      case 'INITIALIZED':
        console.log('✅ Worker inicializado');
        break;

      case 'STARTED':
        setStatus('processing');
        setProgress({ current: 0, total: payload.total, percent: 0 });
        break;

      case 'TASK_COMPLETED':
        // Actualizar progreso
        setProgress({
          current: payload.progress.current,
          total: payload.progress.total,
          percent: payload.progress.percent
        });

        // Si página visible, aplicar inmediatamente
        if (document.visibilityState === 'visible') {
          applyResult(payload.result);
        } else {
          pendingUpdatesRef.current.push(payload.result);
        }

        callbacksRef.current.onProgress?.(payload.progress);
        
        // Sincronizar con otras pestañas
        coordinatorRef.current?.reportTaskCompletion(payload.task?.id, payload.result);
        break;

      case 'TASK_ERROR':
        console.error('Error en tarea:', payload);
        callbacksRef.current.onError?.(payload.error);
        break;

      case 'COMPLETED':
        setStatus('completed');
        console.log(`✅ Procesamiento completado: ${payload.total} tareas en ${payload.elapsed}ms`);
        
        flushPendingUpdates();
        persistenceRef.current?.clearAllTasks();
        callbacksRef.current.onComplete?.(payload);
        
        // Notificación si página oculta
        if (document.visibilityState !== 'visible') {
          showNotification('Excel Completado', {
            body: `Se procesaron ${payload.total} tareas correctamente.`,
            icon: '/favicon.ico'
          });
        }
        
        setTimeout(() => setStatus('idle'), 2000);
        break;

      case 'PAUSED':
        setStatus('paused');
        break;

      case 'RESUMED':
        setStatus('processing');
        break;

      case 'CANCELLED':
        setStatus('idle');
        setProgress({ current: 0, total: 0, percent: 0 });
        break;

      case 'STATUS':
        setProgress({
          current: payload.processed,
          total: payload.total,
          percent: payload.percent
        });
        setStats({
          rate: payload.rate,
          eta: payload.eta,
          elapsed: payload.elapsed
        });
        break;

      case 'ERROR':
        console.error('Worker error:', payload);
        callbacksRef.current.onError?.(payload.message);
        break;
    }
  }, [applyResult, flushPendingUpdates]);

  // Mostrar notificación
  const showNotification = useCallback(async (title, options) => {
    if (!('Notification' in window)) return;

    if (Notification.permission === 'granted') {
      new Notification(title, options);
    } else if (Notification.permission !== 'denied') {
      const permission = await Notification.requestPermission();
      if (permission === 'granted') {
        new Notification(title, options);
      }
    }
  }, []);

  // Inicialización
  useEffect(() => {
    const initialize = async () => {
      setStatus('initializing');

      try {
        // 1. Inicializar persistencia
        persistenceRef.current = new TaskPersistenceService();
        await persistenceRef.current.initialize();

        // 2. Inicializar coordinador de pestañas
        coordinatorRef.current = new TabCoordinator();
        coordinatorRef.current.on('becameLeader', () => {
          setIsLeader(true);
          console.log('👑 Esta pestaña es el líder');
        });
        coordinatorRef.current.on('taskCompleted', (data) => {
          if (data.result) {
            applyResult(data.result);
          }
        });

        // 3. Crear Web Worker
        const blob = new Blob([WORKER_CODE], { type: 'application/javascript' });
        const workerUrl = URL.createObjectURL(blob);
        workerRef.current = new Worker(workerUrl);
        workerRef.current.onmessage = handleWorkerMessage;
        workerRef.current.onerror = (error) => {
          console.error('Worker error:', error);
          setStatus('error');
          callbacksRef.current.onError?.(error.message);
        };

        // 4. Esperar a que el worker esté listo
        await new Promise((resolve, reject) => {
          const timeout = setTimeout(() => reject(new Error('Worker timeout')), 5000);
          
          const checkReady = (e) => {
            if (e.data.type === 'READY') {
              clearTimeout(timeout);
              workerRef.current.removeEventListener('message', checkReady);
              resolve();
            }
          };
          workerRef.current.addEventListener('message', checkReady);
        });

        // 5. Recuperar tareas pendientes
        if (autoRecover) {
          const pendingTasks = await persistenceRef.current.getPendingTasks();
          if (pendingTasks.length > 0) {
            console.log(`📋 Recuperando ${pendingTasks.length} tareas pendientes...`);
            workerRef.current.postMessage({ type: 'START', payload: pendingTasks });
          } else {
            setStatus('idle');
          }
        } else {
          setStatus('idle');
        }

        console.log('✅ Sistema de background processing inicializado');

      } catch (error) {
        console.error('Error inicializando:', error);
        setStatus('error');
      }
    };

    initialize();

    return () => {
      workerRef.current?.terminate();
      coordinatorRef.current?.destroy();
    };
  }, [autoRecover, handleWorkerMessage, applyResult]);

  // Page Visibility API
  useEffect(() => {
    const handleVisibilityChange = () => {
      const visible = document.visibilityState === 'visible';
      setIsPageVisible(visible);

      if (visible) {
        console.log('👁️ Página visible');
        flushPendingUpdates();
        workerRef.current?.postMessage({ type: 'GET_STATUS' });
      } else {
        console.log('👁️‍🗨️ Página en background');
      }
    };

    document.addEventListener('visibilitychange', handleVisibilityChange);
    return () => document.removeEventListener('visibilitychange', handleVisibilityChange);
  }, [flushPendingUpdates]);

  // API Pública
  const startProcessing = useCallback(async (tasks) => {
    if (!workerRef.current) {
      console.error('Worker no inicializado');
      return false;
    }

    if (status === 'processing') {
      console.warn('Ya hay un procesamiento en curso');
      return false;
    }

    // Guardar en IndexedDB
    await persistenceRef.current?.saveTasks(tasks);

    // Solicitar permisos de notificación
    if ('Notification' in window && Notification.permission === 'default') {
      Notification.requestPermission();
    }

    // Iniciar
    workerRef.current.postMessage({ type: 'START', payload: tasks });
    return true;
  }, [status]);

  const addTasks = useCallback(async (tasks) => {
    if (!workerRef.current) return false;

    await persistenceRef.current?.saveTasks(tasks);
    workerRef.current.postMessage({ type: 'ADD_TASKS', payload: tasks });
    return true;
  }, []);

  const pause = useCallback(() => {
    workerRef.current?.postMessage({ type: 'PAUSE' });
  }, []);

  const resume = useCallback(() => {
    workerRef.current?.postMessage({ type: 'RESUME' });
  }, []);

  const cancel = useCallback(async () => {
    workerRef.current?.postMessage({ type: 'CANCEL' });
    await persistenceRef.current?.clearAllTasks();
    pendingUpdatesRef.current = [];
  }, []);

  const getStatus = useCallback(() => {
    workerRef.current?.postMessage({ type: 'GET_STATUS' });
  }, []);

  return {
    status,
    progress,
    stats,
    isPageVisible,
    isLeader,
    isProcessing: status === 'processing',
    isPaused: status === 'paused',
    startProcessing,
    addTasks,
    pause,
    resume,
    cancel,
    getStatus,
    flushPendingUpdates
  };
};

// ============================================================
// PARTE 5: COMPONENTE DE INDICADOR DE PROGRESO
// ============================================================

const BackgroundProcessingIndicator = ({
  status,
  progress,
  stats,
  isPageVisible,
  onPause,
  onResume,
  onCancel
}) => {
  if (status === 'idle' || status === 'initializing') return null;

  const formatTime = (ms) => {
    if (!ms || ms <= 0) return '0s';
    if (ms < 1000) return `${Math.round(ms)}ms`;
    if (ms < 60000) return `${Math.round(ms / 1000)}s`;
    const mins = Math.floor(ms / 60000);
    const secs = Math.round((ms % 60000) / 1000);
    return `${mins}m ${secs}s`;
  };

  const isBackground = !isPageVisible && status === 'processing';

  return (
    <div className={`bg-processing-indicator ${isBackground ? 'background-mode' : ''} status-${status}`}>
      <div className="indicator-header">
        <div className="indicator-icon">
          {status === 'processing' && (
            isBackground ? (
              <div className="background-pulse">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <circle cx="12" cy="12" r="10" />
                  <polyline points="12 6 12 12 16 14" />
                </svg>
              </div>
            ) : (
              <div className="processing-spinner" />
            )
          )}
          {status === 'paused' && <span className="status-emoji">⏸️</span>}
          {status === 'completed' && <span className="status-emoji">✅</span>}
          {status === 'error' && <span className="status-emoji">❌</span>}
        </div>

        <div className="indicator-info">
          <div className="indicator-title">
            {status === 'processing' && (isBackground ? 'Procesando en segundo plano' : 'Procesando...')}
            {status === 'paused' && 'Procesamiento pausado'}
            {status === 'completed' && '¡Completado!'}
            {status === 'error' && 'Error en el procesamiento'}
          </div>
          <div className="indicator-subtitle">
            {progress.current.toLocaleString()} / {progress.total.toLocaleString()} tareas
          </div>
        </div>
      </div>

      <div className="indicator-progress">
        <div className="progress-bar-container">
          <div 
            className="progress-bar-fill" 
            style={{ width: `${progress.percent}%` }}
          />
        </div>
        <span className="progress-percent">{progress.percent}%</span>
      </div>

      {status === 'processing' && stats && (
        <div className="indicator-stats">
          <div className="stat-item">
            <span className="stat-label">Velocidad</span>
            <span className="stat-value">{stats.rate?.toFixed(1) || 0} /s</span>
          </div>
          <div className="stat-item">
            <span className="stat-label">Restante</span>
            <span className="stat-value">~{formatTime(stats.eta)}</span>
          </div>
          <div className="stat-item">
            <span className="stat-label">Transcurrido</span>
            <span className="stat-value">{formatTime(stats.elapsed)}</span>
          </div>
        </div>
      )}

      {isBackground && (
        <div className="background-notice">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="16" height="16">
            <circle cx="12" cy="12" r="10" />
            <line x1="12" y1="8" x2="12" y2="12" />
            <line x1="12" y1="16" x2="12.01" y2="16" />
          </svg>
          <span>Puedes cambiar de pestaña. El proceso continuará.</span>
        </div>
      )}

      <div className="indicator-controls">
        {status === 'processing' && (
          <button className="control-btn pause" onClick={onPause}>
            ⏸️ Pausar
          </button>
        )}
        {status === 'paused' && (
          <button className="control-btn resume" onClick={onResume}>
            ▶️ Reanudar
          </button>
        )}
        {(status === 'processing' || status === 'paused') && (
          <button className="control-btn cancel" onClick={onCancel}>
            ✕ Cancelar
          </button>
        )}
      </div>
    </div>
  );
};

// ============================================================
// PARTE 6: CLASE SPARSE GRID (10,000 x 10,000)
// ============================================================

class SparseGrid {
  constructor() {
    this.cells = new Map();
    this.rowCount = 10000;
    this.colCount = 10000;
  }

  getCell(row, col) {
    const key = `${row}:${col}`;
    return this.cells.get(key) || { value: '', formula: null, format: {} };
  }

  setCell(row, col, cellData) {
    const key = `${row}:${col}`;
    
    if (!cellData || (cellData.value === '' && !cellData.formula)) {
      this.cells.delete(key);
    } else {
      this.cells.set(key, {
        value: cellData.value,
        formula: cellData.formula || null,
        format: cellData.format || {}
      });
    }
  }

  getCellCount() {
    return this.cells.size;
  }

  clear() {
    this.cells.clear();
  }

  toJSON() {
    const data = {};
    this.cells.forEach((value, key) => {
      data[key] = value;
    });
    return data;
  }

  fromJSON(data) {
    this.cells.clear();
    Object.entries(data).forEach(([key, value]) => {
      this.cells.set(key, value);
    });
  }
}

// ============================================================
// PARTE 7: UTILIDADES
// ============================================================

const getColumnName = (index) => {
  let name = '';
  let i = index;
  while (i >= 0) {
    name = String.fromCharCode(65 + (i % 26)) + name;
    i = Math.floor(i / 26) - 1;
  }
  return name;
};

const columnToIndex = (col) => {
  let index = 0;
  const upper = col.toUpperCase();
  for (let i = 0; i < upper.length; i++) {
    index = index * 26 + (upper.charCodeAt(i) - 64);
  }
  return index - 1;
};

// Colores para gráficos
const CHART_COLORS = [
  '#3b82f6', '#10b981', '#f59e0b', '#ef4444', 
  '#8b5cf6', '#ec4899', '#06b6d4', '#84cc16',
  '#f97316', '#14b8a6', '#6366f1', '#a855f7'
];

// ============================================================
// PARTE 8: COMPONENTE DE GRÁFICO
// ============================================================

const ExcelChart = ({ chart, onDelete }) => {
  const { type, title, data, size = { width: 400, height: 300 } } = chart;

  const renderChart = () => {
    if (!data || data.length === 0) {
      return (
        <div className="chart-no-data">
          <span>📊</span>
          <p>Sin datos</p>
        </div>
      );
    }

    switch (type) {
      case 'bar':
        return (
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={data} margin={{ top: 20, right: 30, left: 20, bottom: 60 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
              <XAxis 
                dataKey="name" 
                tick={{ fontSize: 11 }}
                angle={-45}
                textAnchor="end"
                height={60}
              />
              <YAxis tick={{ fontSize: 11 }} />
              <Tooltip />
              <Bar dataKey="value" radius={[4, 4, 0, 0]}>
                {data.map((entry, index) => (
                  <Cell key={`cell-${index}`} fill={CHART_COLORS[index % CHART_COLORS.length]} />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        );

      case 'line':
        return (
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={data} margin={{ top: 20, right: 30, left: 20, bottom: 20 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
              <XAxis dataKey="name" tick={{ fontSize: 11 }} />
              <YAxis tick={{ fontSize: 11 }} />
              <Tooltip />
              <Line 
                type="monotone" 
                dataKey="value" 
                stroke={CHART_COLORS[0]}
                strokeWidth={2}
                dot={{ fill: CHART_COLORS[0], r: 4 }}
              />
            </LineChart>
          </ResponsiveContainer>
        );

      case 'pie':
        return (
          <ResponsiveContainer width="100%" height="100%">
            <PieChart>
              <Pie
                data={data}
                dataKey="value"
                nameKey="name"
                cx="50%"
                cy="50%"
                outerRadius={80}
                label={({ name, percent }) => `${name}: ${(percent * 100).toFixed(0)}%`}
              >
                {data.map((entry, index) => (
                  <Cell key={`cell-${index}`} fill={CHART_COLORS[index % CHART_COLORS.length]} />
                ))}
              </Pie>
              <Tooltip />
              <Legend />
            </PieChart>
          </ResponsiveContainer>
        );

      case 'area':
        return (
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={data} margin={{ top: 20, right: 30, left: 20, bottom: 20 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
              <XAxis dataKey="name" tick={{ fontSize: 11 }} />
              <YAxis tick={{ fontSize: 11 }} />
              <Tooltip />
              <Area 
                type="monotone" 
                dataKey="value" 
                stroke={CHART_COLORS[0]}
                fill={`${CHART_COLORS[0]}40`}
              />
            </AreaChart>
          </ResponsiveContainer>
        );

      default:
        return <div>Tipo no soportado: {type}</div>;
    }
  };

  return (
    <div className="excel-chart" style={{ width: size.width, height: size.height }}>
      <div className="chart-header">
        <span className="chart-title">{title}</span>
        {onDelete && (
          <button className="chart-delete" onClick={() => onDelete(chart.id)}>✕</button>
        )}
      </div>
      <div className="chart-body">
        {renderChart()}
      </div>
    </div>
  );
};

// ============================================================
// PARTE 9: GENERADOR DE TAREAS (ORQUESTADOR)
// ============================================================

const generateSalesWorkbookTasks = () => {
  const tasks = [];
  
  // ===== HOJA 1: VENTAS =====
  tasks.push({ action: 'CREATE_SHEET', name: 'Ventas', sheetId: 'ventas' });
  
  // Headers
  const headers = ['Mes', 'Producto', 'Cantidad', 'Precio', 'Total'];
  headers.forEach((header, col) => {
    tasks.push({ 
      action: 'INSERT_CELL', 
      row: 0, 
      col, 
      value: header,
      format: { fontWeight: 'bold', backgroundColor: '#3b82f6', color: '#ffffff' }
    });
  });
  
  // Datos
  const meses = ['Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio', 
                 'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre'];
  const productos = [
    { nombre: 'Laptop', precio: 1200 },
    { nombre: 'Mouse', precio: 25 },
    { nombre: 'Teclado', precio: 75 },
    { nombre: 'Monitor', precio: 350 }
  ];
  
  let row = 1;
  meses.forEach((mes) => {
    productos.forEach((producto) => {
      const cantidad = Math.floor(Math.random() * 50) + 10;
      
      tasks.push({ action: 'INSERT_CELL', row, col: 0, value: mes });
      tasks.push({ action: 'INSERT_CELL', row, col: 1, value: producto.nombre });
      tasks.push({ action: 'INSERT_CELL', row, col: 2, value: cantidad });
      tasks.push({ action: 'INSERT_CELL', row, col: 3, value: producto.precio });
      tasks.push({ 
        action: 'EVALUATE_FORMULA', 
        row, 
        col: 4, 
        formula: `=C${row + 1}*D${row + 1}` 
      });
      
      row++;
    });
  });
  
  // ===== HOJA 2: RESUMEN =====
  tasks.push({ action: 'CREATE_SHEET', name: 'Resumen', sheetId: 'resumen' });
  
  // Título
  tasks.push({ 
    action: 'INSERT_CELL', 
    row: 0, 
    col: 0, 
    value: 'RESUMEN DE VENTAS',
    format: { fontWeight: 'bold', fontSize: '16px' }
  });
  
  // Headers de resumen
  tasks.push({ action: 'INSERT_CELL', row: 2, col: 0, value: 'Métrica', format: { fontWeight: 'bold' } });
  tasks.push({ action: 'INSERT_CELL', row: 2, col: 1, value: 'Valor', format: { fontWeight: 'bold' } });
  
  // Métricas
  const metricas = [
    { nombre: 'Total Unidades Vendidas', formula: '=SUM(Ventas!C2:C49)' },
    { nombre: 'Venta Total ($)', formula: '=SUM(Ventas!E2:E49)' },
    { nombre: 'Promedio por Venta ($)', formula: '=AVERAGE(Ventas!E2:E49)' },
    { nombre: 'Venta Máxima ($)', formula: '=MAX(Ventas!E2:E49)' },
    { nombre: 'Venta Mínima ($)', formula: '=MIN(Ventas!E2:E49)' },
    { nombre: 'Número de Transacciones', formula: '=COUNT(Ventas!E2:E49)' }
  ];
  
  metricas.forEach((metrica, idx) => {
    tasks.push({ action: 'INSERT_CELL', row: 3 + idx, col: 0, value: metrica.nombre });
    tasks.push({ action: 'EVALUATE_FORMULA', row: 3 + idx, col: 1, formula: metrica.formula });
  });
  
  // ===== HOJA 3: GRÁFICOS =====
  tasks.push({ action: 'CREATE_SHEET', name: 'Gráficos', sheetId: 'graficos' });
  
  tasks.push({ 
    action: 'INSERT_CELL', 
    row: 0, 
    col: 0, 
    value: '📊 DASHBOARD DE VENTAS',
    format: { fontWeight: 'bold', fontSize: '18px' }
  });
  
  // Datos para gráfico de barras (ventas por mes)
  tasks.push({ action: 'INSERT_CELL', row: 2, col: 0, value: 'Ventas por Mes', format: { fontWeight: 'bold' } });
  tasks.push({ action: 'INSERT_CELL', row: 3, col: 0, value: 'Mes', format: { fontWeight: 'bold' } });
  tasks.push({ action: 'INSERT_CELL', row: 3, col: 1, value: 'Total ($)', format: { fontWeight: 'bold' } });
  
  const ventasPorMes = [18000, 15500, 22000, 19800, 24000, 21500, 
                        23000, 26000, 28500, 25000, 30000, 32000];
  meses.forEach((mes, idx) => {
    tasks.push({ action: 'INSERT_CELL', row: 4 + idx, col: 0, value: mes });
    tasks.push({ action: 'INSERT_CELL', row: 4 + idx, col: 1, value: ventasPorMes[idx] });
  });
  
  // Gráfico de barras
  tasks.push({
    action: 'GENERATE_CHART',
    chartType: 'bar',
    title: 'Ventas Mensuales ($)',
    dataRange: 'A4:B15',
    position: { row: 2, col: 4 },
    size: { width: 450, height: 300 }
  });
  
  // Datos para gráfico circular (por producto)
  tasks.push({ action: 'INSERT_CELL', row: 18, col: 0, value: 'Ventas por Producto', format: { fontWeight: 'bold' } });
  tasks.push({ action: 'INSERT_CELL', row: 19, col: 0, value: 'Producto', format: { fontWeight: 'bold' } });
  tasks.push({ action: 'INSERT_CELL', row: 19, col: 1, value: 'Total ($)', format: { fontWeight: 'bold' } });
  
  const ventasPorProducto = [
    { producto: 'Laptop', total: 172800 },
    { producto: 'Mouse', total: 10500 },
    { producto: 'Teclado', total: 31500 },
    { producto: 'Monitor', total: 50400 }
  ];
  
  ventasPorProducto.forEach((item, idx) => {
    tasks.push({ action: 'INSERT_CELL', row: 20 + idx, col: 0, value: item.producto });
    tasks.push({ action: 'INSERT_CELL', row: 20 + idx, col: 1, value: item.total });
  });
  
  // Gráfico circular
  tasks.push({
    action: 'GENERATE_CHART',
    chartType: 'pie',
    title: 'Distribución por Producto',
    dataRange: 'A20:B23',
    position: { row: 18, col: 4 },
    size: { width: 400, height: 300 }
  });
  
  // ===== HOJA 4: ANÁLISIS =====
  tasks.push({ action: 'CREATE_SHEET', name: 'Análisis', sheetId: 'analisis' });
  
  tasks.push({ 
    action: 'INSERT_CELL', 
    row: 0, 
    col: 0, 
    value: '📈 ANÁLISIS DE CRECIMIENTO',
    format: { fontWeight: 'bold', fontSize: '18px' }
  });
  
  // Headers
  const analysisHeaders = ['Mes', 'Ventas ($)', 'Mes Anterior', 'Crecimiento ($)', 'Crecimiento (%)'];
  analysisHeaders.forEach((header, col) => {
    tasks.push({ 
      action: 'INSERT_CELL', 
      row: 2, 
      col, 
      value: header,
      format: { fontWeight: 'bold', backgroundColor: '#1e293b', color: '#ffffff' }
    });
  });
  
  // Datos de análisis
  meses.forEach((mes, idx) => {
    const rowIdx = 3 + idx;
    const ventaActual = ventasPorMes[idx];
    const ventaAnterior = idx > 0 ? ventasPorMes[idx - 1] : 0;
    
    tasks.push({ action: 'INSERT_CELL', row: rowIdx, col: 0, value: mes });
    tasks.push({ action: 'INSERT_CELL', row: rowIdx, col: 1, value: ventaActual });
    tasks.push({ action: 'INSERT_CELL', row: rowIdx, col: 2, value: ventaAnterior });
    
    // Fórmula de crecimiento absoluto
    tasks.push({ 
      action: 'EVALUATE_FORMULA', 
      row: rowIdx, 
      col: 3, 
      formula: `=B${rowIdx + 1}-C${rowIdx + 1}` 
    });
    
    // Fórmula de crecimiento porcentual
    tasks.push({ 
      action: 'EVALUATE_FORMULA', 
      row: rowIdx, 
      col: 4, 
      formula: `=IF(C${rowIdx + 1}=0,0,ROUND((B${rowIdx + 1}-C${rowIdx + 1})/C${rowIdx + 1}*100,1))` 
    });
  });
  
  // Formato condicional para columna de crecimiento %
  tasks.push({
    action: 'APPLY_CONDITIONAL_FORMAT',
    range: { startRow: 3, endRow: 14, startCol: 4, endCol: 4 },
    rules: [
      { condition: 'greaterThan', value: 0, style: { backgroundColor: '#dcfce7', color: '#166534' } },
      { condition: 'lessThan', value: 0, style: { backgroundColor: '#fee2e2', color: '#991b1b' } }
    ]
  });
  
  // Estadísticas finales
  tasks.push({ action: 'INSERT_CELL', row: 17, col: 0, value: 'ESTADÍSTICAS', format: { fontWeight: 'bold' } });
  tasks.push({ action: 'INSERT_CELL', row: 18, col: 0, value: 'Crecimiento Promedio (%)' });
  tasks.push({ action: 'EVALUATE_FORMULA', row: 18, col: 1, formula: '=AVERAGE(E4:E15)' });
  tasks.push({ action: 'INSERT_CELL', row: 19, col: 0, value: 'Mayor Crecimiento (%)' });
  tasks.push({ action: 'EVALUATE_FORMULA', row: 19, col: 1, formula: '=MAX(E4:E15)' });
  tasks.push({ action: 'INSERT_CELL', row: 20, col: 0, value: 'Mayor Caída (%)' });
  tasks.push({ action: 'EVALUATE_FORMULA', row: 20, col: 1, formula: '=MIN(E4:E15)' });
  
  return tasks;
};

// ============================================================
// PARTE 10: COMPONENTE PRINCIPAL DEL EXCEL
// ============================================================

const ExcelWithBackgroundProcessing = () => {
  // Estado del workbook
  const [workbook, setWorkbook] = useState({
    sheets: [
      { id: 'sheet1', name: 'Hoja 1', grid: new SparseGrid(), charts: [] }
    ],
    activeSheetId: 'sheet1'
  });
  
  const [selectedCell, setSelectedCell] = useState({ row: 0, col: 0 });
  const [editingCell, setEditingCell] = useState(null);
  const [editValue, setEditValue] = useState('');
  const [scrollPos, setScrollPos] = useState({ top: 0, left: 0 });
  
  // Grid config
  const GRID_CONFIG = {
    ROW_HEIGHT: 28,
    COL_WIDTH: 100,
    VISIBLE_ROWS: 25,
    VISIBLE_COLS: 12,
    HEADER_WIDTH: 50,
    HEADER_HEIGHT: 28
  };
  
  // Background processing
  const {
    status,
    progress,
    stats,
    isPageVisible,
    isProcessing,
    isPaused,
    startProcessing,
    pause,
    resume,
    cancel
  } = useBackgroundProcessing({
    onCellUpdate: (update) => {
      setWorkbook(prev => {
        const activeSheet = prev.sheets.find(s => s.id === prev.activeSheetId);
        if (activeSheet) {
          activeSheet.grid.setCell(update.row, update.col, {
            value: update.value,
            formula: update.formula,
            format: update.format
          });
        }
        return { ...prev };
      });
    },
    onSheetCreated: (sheet) => {
      setWorkbook(prev => {
        // Verificar si ya existe
        if (!prev.sheets.find(s => s.id === sheet.sheetId)) {
          return {
            ...prev,
            sheets: [...prev.sheets, {
              id: sheet.sheetId,
              name: sheet.name,
              grid: new SparseGrid(),
              charts: []
            }]
          };
        }
        return prev;
      });
    },
    onChartCreated: (chart) => {
      setWorkbook(prev => {
        const activeSheet = prev.sheets.find(s => s.id === prev.activeSheetId);
        if (activeSheet) {
          // Extraer datos del grid para el gráfico
          const chartData = extractChartData(activeSheet.grid, chart.dataRange);
          activeSheet.charts.push({
            ...chart,
            data: chartData
          });
        }
        return { ...prev };
      });
    },
    onComplete: (result) => {
      console.log('✅ Workbook generado:', result);
    },
    autoRecover: true
  });
  
  // Extraer datos para gráfico desde el grid
  const extractChartData = (grid, rangeStr) => {
    if (!rangeStr) return [];
    
    const [start, end] = rangeStr.split(':');
    const startRef = { col: columnToIndex(start.replace(/[0-9]/g, '')), row: parseInt(start.replace(/[A-Z]/gi, '')) - 1 };
    const endRef = { col: columnToIndex(end.replace(/[0-9]/g, '')), row: parseInt(end.replace(/[A-Z]/gi, '')) - 1 };
    
    const data = [];
    for (let r = startRef.row; r <= endRef.row; r++) {
      const nameCell = grid.getCell(r, startRef.col);
      const valueCell = grid.getCell(r, startRef.col + 1);
      
      if (nameCell.value) {
        data.push({
          name: String(nameCell.value),
          value: parseFloat(valueCell.value) || 0
        });
      }
    }
    
    return data;
  };
  
  // Obtener hoja activa
  const activeSheet = workbook.sheets.find(s => s.id === workbook.activeSheetId);
  const grid = activeSheet?.grid;
  
  // Calcular filas/columnas visibles
  const startRow = Math.floor(scrollPos.top / GRID_CONFIG.ROW_HEIGHT);
  const startCol = Math.floor(scrollPos.left / GRID_CONFIG.COL_WIDTH);
  const endRow = Math.min(startRow + GRID_CONFIG.VISIBLE_ROWS + 2, 10000);
  const endCol = Math.min(startCol + GRID_CONFIG.VISIBLE_COLS + 2, 10000);
  
  // Generar celdas visibles
  const visibleCells = useMemo(() => {
    if (!grid) return [];
    
    const cells = [];
    for (let r = startRow; r < endRow; r++) {
      for (let c = startCol; c < endCol; c++) {
        const cell = grid.getCell(r, c);
        cells.push({
          row: r,
          col: c,
          ...cell
        });
      }
    }
    return cells;
  }, [grid, startRow, startCol, endRow, endCol, workbook]);
  
  // Handlers
  const handleCellClick = (row, col) => {
    setSelectedCell({ row, col });
    setEditingCell(null);
  };
  
  const handleCellDoubleClick = (row, col) => {
    const cell = grid?.getCell(row, col);
    setEditingCell({ row, col });
    setEditValue(cell?.formula || cell?.value || '');
  };
  
  const handleCellEdit = (e) => {
    setEditValue(e.target.value);
  };
  
  const handleCellEditComplete = () => {
    if (editingCell && grid) {
      const isFormula = editValue.startsWith('=');
      grid.setCell(editingCell.row, editingCell.col, {
        value: isFormula ? evaluateFormulaClient(editValue, grid) : editValue,
        formula: isFormula ? editValue : null,
        format: {}
      });
      setWorkbook(prev => ({ ...prev }));
    }
    setEditingCell(null);
    setEditValue('');
  };
  
  const handleKeyDown = (e) => {
    if (e.key === 'Enter') {
      handleCellEditComplete();
    } else if (e.key === 'Escape') {
      setEditingCell(null);
      setEditValue('');
    }
  };
  
  // Evaluador de fórmulas del lado del cliente
  const evaluateFormulaClient = (formula, grid) => {
    // Versión simplificada para el cliente
    if (!formula?.startsWith('=')) return formula;
    
    // Por ahora retornar la fórmula - el worker la evaluará
    return formula;
  };
  
  // Cambiar hoja activa
  const handleSheetChange = (sheetId) => {
    setWorkbook(prev => ({ ...prev, activeSheetId: sheetId }));
    setSelectedCell({ row: 0, col: 0 });
    setScrollPos({ top: 0, left: 0 });
  };
  
  // Generar workbook de ejemplo
  const handleGenerateWorkbook = async () => {
    const tasks = generateSalesWorkbookTasks();
    console.log(`📊 Generando workbook con ${tasks.length} tareas...`);
    await startProcessing(tasks);
  };
  
  // Limpiar workbook
  const handleClearWorkbook = () => {
    setWorkbook({
      sheets: [
        { id: 'sheet1', name: 'Hoja 1', grid: new SparseGrid(), charts: [] }
      ],
      activeSheetId: 'sheet1'
    });
  };

  return (
    <div className="excel-container">
      {/* Indicador de procesamiento */}
      <BackgroundProcessingIndicator
        status={status}
        progress={progress}
        stats={stats}
        isPageVisible={isPageVisible}
        onPause={pause}
        onResume={resume}
        onCancel={cancel}
      />
      
      {/* Toolbar */}
      <div className="excel-toolbar">
        <div className="toolbar-left">
          <button 
            className="toolbar-btn primary"
            onClick={handleGenerateWorkbook}
            disabled={isProcessing}
          >
            ✨ {isProcessing ? 'Generando...' : 'Generar Workbook de Ventas'}
          </button>
          <button 
            className="toolbar-btn"
            onClick={handleClearWorkbook}
            disabled={isProcessing}
          >
            🗑️ Limpiar
          </button>
        </div>
        <div className="toolbar-right">
          <span className="cell-info">
            Celda: {getColumnName(selectedCell.col)}{selectedCell.row + 1}
          </span>
          <span className="cell-count">
            Celdas: {grid?.getCellCount() || 0} | Capacidad: 100,000,000
          </span>
        </div>
      </div>
      
      {/* Barra de fórmulas */}
      <div className="formula-bar">
        <span className="formula-cell-ref">
          {getColumnName(selectedCell.col)}{selectedCell.row + 1}
        </span>
        <input
          type="text"
          className="formula-input"
          value={editingCell ? editValue : (grid?.getCell(selectedCell.row, selectedCell.col)?.formula || grid?.getCell(selectedCell.row, selectedCell.col)?.value || '')}
          onChange={handleCellEdit}
          onKeyDown={handleKeyDown}
          onFocus={() => {
            if (!editingCell) {
              const cell = grid?.getCell(selectedCell.row, selectedCell.col);
              setEditingCell(selectedCell);
              setEditValue(cell?.formula || cell?.value || '');
            }
          }}
          onBlur={handleCellEditComplete}
          placeholder="Ingresa un valor o fórmula"
        />
      </div>
      
      {/* Grid principal */}
      <div className="excel-grid-wrapper">
        {/* Esquina superior izquierda */}
        <div className="grid-corner" />
        
        {/* Headers de columnas */}
        <div 
          className="column-headers"
          style={{ transform: `translateX(-${scrollPos.left}px)` }}
        >
          {Array.from({ length: endCol - startCol }, (_, i) => startCol + i).map(col => (
            <div 
              key={col} 
              className="col-header"
              style={{ width: GRID_CONFIG.COL_WIDTH }}
            >
              {getColumnName(col)}
            </div>
          ))}
        </div>
        
        {/* Headers de filas */}
        <div 
          className="row-headers"
          style={{ transform: `translateY(-${scrollPos.top}px)` }}
        >
          {Array.from({ length: endRow - startRow }, (_, i) => startRow + i).map(row => (
            <div 
              key={row} 
              className="row-header"
              style={{ height: GRID_CONFIG.ROW_HEIGHT }}
            >
              {row + 1}
            </div>
          ))}
        </div>
        
        {/* Celdas */}
        <div 
          className="cells-viewport"
          onScroll={(e) => {
            setScrollPos({
              top: e.target.scrollTop,
              left: e.target.scrollLeft
            });
          }}
        >
          <div 
            className="cells-container"
            style={{
              width: 10000 * GRID_CONFIG.COL_WIDTH,
              height: 10000 * GRID_CONFIG.ROW_HEIGHT
            }}
          >
            {visibleCells.map(cell => {
              const isSelected = selectedCell.row === cell.row && selectedCell.col === cell.col;
              const isEditing = editingCell?.row === cell.row && editingCell?.col === cell.col;
              
              return (
                <div
                  key={`${cell.row}:${cell.col}`}
                  className={`cell ${isSelected ? 'selected' : ''} ${cell.value ? 'has-value' : ''}`}
                  style={{
                    position: 'absolute',
                    left: cell.col * GRID_CONFIG.COL_WIDTH,
                    top: cell.row * GRID_CONFIG.ROW_HEIGHT,
                    width: GRID_CONFIG.COL_WIDTH,
                    height: GRID_CONFIG.ROW_HEIGHT,
                    ...(cell.format || {})
                  }}
                  onClick={() => handleCellClick(cell.row, cell.col)}
                  onDoubleClick={() => handleCellDoubleClick(cell.row, cell.col)}
                >
                  {isEditing ? (
                    <input
                      type="text"
                      className="cell-editor"
                      value={editValue}
                      onChange={handleCellEdit}
                      onKeyDown={handleKeyDown}
                      onBlur={handleCellEditComplete}
                      autoFocus
                    />
                  ) : (
                    <span className="cell-value">{cell.value}</span>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      </div>
      
      {/* Gráficos */}
      {activeSheet?.charts?.length > 0 && (
        <div className="charts-container">
          <h3>📊 Gráficos</h3>
          <div className="charts-grid">
            {activeSheet.charts.map(chart => (
              <ExcelChart 
                key={chart.chartId || chart.id} 
                chart={{
                  ...chart,
                  type: chart.chartType,
                  id: chart.chartId
                }}
                onDelete={(id) => {
                  setWorkbook(prev => {
                    const sheet = prev.sheets.find(s => s.id === prev.activeSheetId);
                    if (sheet) {
                      sheet.charts = sheet.charts.filter(c => (c.chartId || c.id) !== id);
                    }
                    return { ...prev };
                  });
                }}
              />
            ))}
          </div>
        </div>
      )}
      
      {/* Tabs de hojas */}
      <div className="sheet-tabs">
        {workbook.sheets.map(sheet => (
          <button
            key={sheet.id}
            className={`sheet-tab ${workbook.activeSheetId === sheet.id ? 'active' : ''}`}
            onClick={() => handleSheetChange(sheet.id)}
          >
            {sheet.name}
            {sheet.charts?.length > 0 && <span className="chart-badge">📊</span>}
          </button>
        ))}
        <button 
          className="sheet-tab add-sheet"
          onClick={() => {
            const newId = `sheet_${Date.now()}`;
            setWorkbook(prev => ({
              ...prev,
              sheets: [...prev.sheets, {
                id: newId,
                name: `Hoja ${prev.sheets.length + 1}`,
                grid: new SparseGrid(),
                charts: []
              }]
            }));
          }}
        >
          +
        </button>
      </div>
    </div>
  );
};

// ============================================================
// PARTE 11: ESTILOS CSS
// ============================================================

const styles = `
/* ========================================
   CONTENEDOR PRINCIPAL
   ======================================== */
.excel-container {
  display: flex;
  flex-direction: column;
  height: 100vh;
  font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
  background: #f8fafc;
  overflow: hidden;
}

/* ========================================
   TOOLBAR
   ======================================== */
.excel-toolbar {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 12px 16px;
  background: linear-gradient(135deg, #1e293b 0%, #334155 100%);
  border-bottom: 1px solid #475569;
}

.toolbar-left {
  display: flex;
  gap: 10px;
}

.toolbar-right {
  display: flex;
  gap: 20px;
  align-items: center;
}

.toolbar-btn {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 10px 18px;
  border: none;
  border-radius: 8px;
  font-size: 14px;
  font-weight: 600;
  cursor: pointer;
  transition: all 0.2s;
  background: #475569;
  color: white;
}

.toolbar-btn:hover:not(:disabled) {
  background: #64748b;
  transform: translateY(-1px);
}

.toolbar-btn:disabled {
  opacity: 0.6;
  cursor: not-allowed;
}

.toolbar-btn.primary {
  background: linear-gradient(135deg, #10b981 0%, #059669 100%);
}

.toolbar-btn.primary:hover:not(:disabled) {
  background: linear-gradient(135deg, #059669 0%, #047857 100%);
  box-shadow: 0 4px 15px rgba(16, 185, 129, 0.4);
}

.cell-info, .cell-count {
  font-size: 13px;
  color: #94a3b8;
}

.cell-info {
  font-weight: 600;
  color: #e2e8f0;
}

/* ========================================
   BARRA DE FÓRMULAS
   ======================================== */
.formula-bar {
  display: flex;
  align-items: center;
  padding: 8px 12px;
  background: white;
  border-bottom: 1px solid #e2e8f0;
  gap: 12px;
}

.formula-cell-ref {
  min-width: 60px;
  padding: 6px 12px;
  background: #f1f5f9;
  border-radius: 4px;
  font-weight: 600;
  font-size: 13px;
  color: #475569;
  text-align: center;
}

.formula-input {
  flex: 1;
  padding: 8px 12px;
  border: 1px solid #e2e8f0;
  border-radius: 6px;
  font-size: 14px;
  transition: all 0.2s;
}

.formula-input:focus {
  outline: none;
  border-color: #3b82f6;
  box-shadow: 0 0 0 3px rgba(59, 130, 246, 0.1);
}

/* ========================================
   GRID PRINCIPAL
   ======================================== */
.excel-grid-wrapper {
  flex: 1;
  display: grid;
  grid-template-columns: 50px 1fr;
  grid-template-rows: 28px 1fr;
  overflow: hidden;
  background: white;
}

.grid-corner {
  background: linear-gradient(135deg, #f1f5f9 0%, #e2e8f0 100%);
  border-right: 1px solid #d1d5db;
  border-bottom: 1px solid #d1d5db;
}

.column-headers {
  display: flex;
  background: linear-gradient(180deg, #f8fafc 0%, #f1f5f9 100%);
  border-bottom: 1px solid #d1d5db;
  overflow: hidden;
}

.col-header {
  display: flex;
  align-items: center;
  justify-content: center;
  border-right: 1px solid #d1d5db;
  font-size: 12px;
  font-weight: 600;
  color: #475569;
  flex-shrink: 0;
}

.row-headers {
  background: linear-gradient(90deg, #f8fafc 0%, #f1f5f9 100%);
  border-right: 1px solid #d1d5db;
  overflow: hidden;
}

.row-header {
  display: flex;
  align-items: center;
  justify-content: center;
  border-bottom: 1px solid #d1d5db;
  font-size: 12px;
  font-weight: 600;
  color: #475569;
}

.cells-viewport {
  overflow: auto;
  position: relative;
}

.cells-container {
  position: relative;
}

/* ========================================
   CELDAS
   ======================================== */
.cell {
  display: flex;
  align-items: center;
  padding: 0 8px;
  border-right: 1px solid #e5e7eb;
  border-bottom: 1px solid #e5e7eb;
  background: white;
  cursor: cell;
  overflow: hidden;
  box-sizing: border-box;
  transition: background 0.1s;
}

.cell:hover {
  background: #f8fafc;
}

.cell.selected {
  outline: 2px solid #3b82f6;
  outline-offset: -1px;
  background: #eff6ff;
  z-index: 10;
}

.cell.has-value {
  background: white;
}

.cell-value {
  font-size: 13px;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.cell-editor {
  width: 100%;
  height: 100%;
  border: none;
  outline: none;
  font-size: 13px;
  padding: 0;
  background: white;
}

/* ========================================
   TABS DE HOJAS
   ======================================== */
.sheet-tabs {
  display: flex;
  align-items: center;
  padding: 8px 12px;
  background: #f1f5f9;
  border-top: 1px solid #e2e8f0;
  gap: 4px;
  overflow-x: auto;
}

.sheet-tab {
  padding: 8px 16px;
  border: 1px solid #d1d5db;
  background: white;
  border-radius: 6px 6px 0 0;
  font-size: 13px;
  cursor: pointer;
  transition: all 0.15s;
  display: flex;
  align-items: center;
  gap: 6px;
}

.sheet-tab:hover {
  background: #f8fafc;
}

.sheet-tab.active {
  background: white;
  border-bottom-color: white;
  font-weight: 600;
  color: #3b82f6;
}

.sheet-tab.add-sheet {
  padding: 8px 12px;
  font-weight: bold;
  color: #64748b;
}

.sheet-tab.add-sheet:hover {
  background: #e2e8f0;
  color: #3b82f6;
}

.chart-badge {
  font-size: 12px;
}

/* ========================================
   GRÁFICOS
   ======================================== */
.charts-container {
  padding: 20px;
  background: #f8fafc;
  border-top: 1px solid #e2e8f0;
  max-height: 400px;
  overflow-y: auto;
}

.charts-container h3 {
  margin: 0 0 16px 0;
  font-size: 16px;
  color: #1e293b;
}

.charts-grid {
  display: flex;
  flex-wrap: wrap;
  gap: 20px;
}

.excel-chart {
  background: white;
  border: 1px solid #e2e8f0;
  border-radius: 12px;
  overflow: hidden;
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.05);
}

.chart-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 12px 16px;
  background: linear-gradient(135deg, #f8fafc 0%, #f1f5f9 100%);
  border-bottom: 1px solid #e2e8f0;
}

.chart-title {
  font-weight: 600;
  font-size: 14px;
  color: #1e293b;
}

.chart-delete {
  width: 24px;
  height: 24px;
  border: none;
  background: transparent;
  border-radius: 4px;
  cursor: pointer;
  color: #94a3b8;
  transition: all 0.15s;
}

.chart-delete:hover {
  background: #fee2e2;
  color: #ef4444;
}

.chart-body {
  padding: 16px;
  height: calc(100% - 50px);
}

.chart-no-data {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  height: 100%;
  color: #94a3b8;
}

.chart-no-data span {
  font-size: 48px;
  margin-bottom: 8px;
}

/* ========================================
   INDICADOR DE PROCESAMIENTO
   ======================================== */
.bg-processing-indicator {
  position: fixed;
  bottom: 24px;
  right: 24px;
  background: white;
  border-radius: 16px;
  padding: 20px;
  box-shadow: 0 8px 32px rgba(0, 0, 0, 0.12);
  z-index: 10000;
  min-width: 320px;
  max-width: 400px;
  border: 1px solid #e2e8f0;
  animation: slideInUp 0.3s ease-out;
}

@keyframes slideInUp {
  from {
    opacity: 0;
    transform: translateY(20px);
  }
  to {
    opacity: 1;
    transform: translateY(0);
  }
}

.bg-processing-indicator.background-mode {
  background: linear-gradient(135deg, #1e293b 0%, #0f172a 100%);
  color: white;
  border-color: #334155;
}

.bg-processing-indicator.status-completed {
  border-color: #10b981;
  box-shadow: 0 8px 32px rgba(16, 185, 129, 0.2);
}

.indicator-header {
  display: flex;
  align-items: center;
  gap: 14px;
  margin-bottom: 16px;
}

.indicator-icon {
  width: 44px;
  height: 44px;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 24px;
}

.processing-spinner {
  width: 32px;
  height: 32px;
  border: 3px solid #e2e8f0;
  border-top-color: #3b82f6;
  border-radius: 50%;
  animation: spin 0.8s linear infinite;
}

@keyframes spin {
  to { transform: rotate(360deg); }
}

.background-pulse {
  animation: pulse-bg 2s ease-in-out infinite;
}

.background-pulse svg {
  width: 32px;
  height: 32px;
  color: #10b981;
}

@keyframes pulse-bg {
  0%, 100% { opacity: 1; transform: scale(1); }
  50% { opacity: 0.7; transform: scale(0.95); }
}

.status-emoji {
  font-size: 28px;
}

.indicator-info {
  flex: 1;
}

.indicator-title {
  font-weight: 600;
  font-size: 15px;
  margin-bottom: 2px;
}

.indicator-subtitle {
  font-size: 13px;
  color: #64748b;
}

.background-mode .indicator-subtitle {
  color: #94a3b8;
}

.indicator-progress {
  display: flex;
  align-items: center;
  gap: 12px;
  margin-bottom: 14px;
}

.progress-bar-container {
  flex: 1;
  height: 8px;
  background: #e2e8f0;
  border-radius: 8px;
  overflow: hidden;
}

.background-mode .progress-bar-container {
  background: #334155;
}

.progress-bar-fill {
  height: 100%;
  background: linear-gradient(90deg, #3b82f6 0%, #10b981 100%);
  border-radius: 8px;
  transition: width 0.3s ease;
  position: relative;
}

.progress-bar-fill::after {
  content: '';
  position: absolute;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  background: linear-gradient(
    90deg,
    transparent 0%,
    rgba(255, 255, 255, 0.3) 50%,
    transparent 100%
  );
  animation: shimmer 1.5s infinite;
}

@keyframes shimmer {
  0% { transform: translateX(-100%); }
  100% { transform: translateX(100%); }
}

.progress-percent {
  font-size: 14px;
  font-weight: 700;
  min-width: 48px;
  text-align: right;
  color: #3b82f6;
}

.background-mode .progress-percent {
  color: #10b981;
}

.indicator-stats {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 8px;
  margin-bottom: 14px;
  padding: 10px;
  background: #f8fafc;
  border-radius: 8px;
}

.background-mode .indicator-stats {
  background: rgba(255, 255, 255, 0.05);
}

.stat-item {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 2px;
}

.stat-label {
  font-size: 10px;
  color: #64748b;
  text-transform: uppercase;
  letter-spacing: 0.5px;
}

.background-mode .stat-label {
  color: #94a3b8;
}

.stat-value {
  font-size: 13px;
  font-weight: 600;
}

.background-notice {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 10px 14px;
  background: rgba(16, 185, 129, 0.1);
  border-radius: 8px;
  margin-bottom: 14px;
  font-size: 12px;
  color: #10b981;
  line-height: 1.4;
}

.indicator-controls {
  display: flex;
  gap: 8px;
}

.control-btn {
  flex: 1;
  padding: 10px 14px;
  border: none;
  border-radius: 8px;
  font-size: 13px;
  font-weight: 600;
  cursor: pointer;
  transition: all 0.15s;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
}

.control-btn.pause {
  background: #fef3c7;
  color: #92400e;
}

.control-btn.pause:hover {
  background: #fde68a;
}

.control-btn.resume {
  background: #dcfce7;
  color: #166534;
}

.control-btn.resume:hover {
  background: #bbf7d0;
}

.control-btn.cancel {
  background: #fee2e2;
  color: #991b1b;
}

.control-btn.cancel:hover {
  background: #fecaca;
}

.background-mode .control-btn.cancel {
  background: rgba(239, 68, 68, 0.2);
  color: #fca5a5;
}

/* ========================================
   RESPONSIVE
   ======================================== */
@media (max-width: 768px) {
  .excel-toolbar {
    flex-direction: column;
    gap: 12px;
  }
  
  .toolbar-left, .toolbar-right {
    width: 100%;
    justify-content: center;
  }
  
  .bg-processing-indicator {
    left: 16px;
    right: 16px;
    min-width: auto;
    max-width: none;
  }
  
  .charts-grid {
    flex-direction: column;
  }
  
  .excel-chart {
    width: 100% !important;
  }
}
`;

// Inyectar estilos
if (typeof document !== 'undefined') {
  const styleElement = document.createElement('style');
  styleElement.textContent = styles;
  document.head.appendChild(styleElement);
}

// ============================================================
// PARTE 12: EXPORTACIONES
// ============================================================

export {
  // Componente principal
  ExcelWithBackgroundProcessing,
  
  // Hook de background processing
  useBackgroundProcessing,
  
  // Componentes auxiliares
  BackgroundProcessingIndicator,
  ExcelChart,
  
  // Clases de utilidad
  SparseGrid,
  TaskPersistenceService,
  TabCoordinator,
  
  // Utilidades
  getColumnName,
  columnToIndex,
  CHART_COLORS,
  
  // Generador de tareas
  generateSalesWorkbookTasks,
  
  // Código del worker (por si se necesita externamente)
  WORKER_CODE
};

// Export default del componente principal
export default ExcelWithBackgroundProcessing;
