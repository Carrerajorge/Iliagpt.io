// ============================================================
// SISTEMA DE AGENT SKILLS - IMPLEMENTACIÓN PROPIA
// ============================================================
// Arquitectura modular que permite extender tu aplicación
// con Skills personalizados, similar a Anthropic Agent Skills
// ============================================================

// ============================================================
// PARTE 1: CORE DEL SISTEMA DE SKILLS
// ============================================================

/**
 * Clase base para todos los Skills
 * Cada Skill debe extender esta clase
 */
class BaseSkill {
  constructor() {
    this.metadata = {
      name: 'base-skill',
      version: '1.0.0',
      description: 'Skill base',
      triggers: [], // Palabras clave que activan este skill
      priority: 0   // Mayor número = mayor prioridad
    };
    this.isLoaded = false;
    this.context = {};
  }

  /**
   * Inicializar el skill (cargar recursos, etc.)
   */
  async initialize(context = {}) {
    this.context = context;
    this.isLoaded = true;
    console.log(`✅ Skill "${this.metadata.name}" inicializado`);
  }

  /**
   * Verificar si este skill puede manejar una solicitud
   * @param {string} request - La solicitud del usuario
   * @returns {boolean}
   */
  canHandle(request) {
    const lowerRequest = request.toLowerCase();
    return this.metadata.triggers.some(trigger => 
      lowerRequest.includes(trigger.toLowerCase())
    );
  }

  /**
   * Ejecutar el skill
   * @param {Object} params - Parámetros de ejecución
   * @returns {Promise<Object>} - Resultado de la ejecución
   */
  async execute(params) {
    throw new Error('El método execute() debe ser implementado por el skill');
  }

  /**
   * Obtener instrucciones del skill (equivalente a SKILL.md)
   */
  getInstructions() {
    return '';
  }

  /**
   * Limpiar recursos
   */
  async cleanup() {
    this.isLoaded = false;
  }
}

/**
 * Gestor central de Skills
 * Maneja el registro, descubrimiento y ejecución de Skills
 */
class SkillManager {
  constructor() {
    this.skills = new Map();
    this.loadedSkills = new Set();
    this.eventListeners = new Map();
    this.context = {};
  }

  /**
   * Registrar un nuevo skill
   * @param {BaseSkill} skill - Instancia del skill
   */
  register(skill) {
    if (!(skill instanceof BaseSkill)) {
      throw new Error('El skill debe extender BaseSkill');
    }
    
    const name = skill.metadata.name;
    
    if (this.skills.has(name)) {
      console.warn(`⚠️ Skill "${name}" ya existe, será reemplazado`);
    }
    
    this.skills.set(name, skill);
    console.log(`📦 Skill "${name}" registrado`);
    
    this._emit('skillRegistered', { name, skill });
    
    return this;
  }

  /**
   * Registrar múltiples skills
   * @param {BaseSkill[]} skills - Array de skills
   */
  registerAll(skills) {
    skills.forEach(skill => this.register(skill));
    return this;
  }

  /**
   * Obtener un skill por nombre
   * @param {string} name - Nombre del skill
   */
  get(name) {
    return this.skills.get(name);
  }

  /**
   * Listar todos los skills registrados
   */
  list() {
    return Array.from(this.skills.values()).map(skill => ({
      name: skill.metadata.name,
      version: skill.metadata.version,
      description: skill.metadata.description,
      triggers: skill.metadata.triggers,
      isLoaded: skill.isLoaded
    }));
  }

  /**
   * Inicializar un skill específico
   * @param {string} name - Nombre del skill
   * @param {Object} context - Contexto de inicialización
   */
  async load(name, context = {}) {
    const skill = this.skills.get(name);
    
    if (!skill) {
      throw new Error(`Skill "${name}" no encontrado`);
    }
    
    if (!skill.isLoaded) {
      await skill.initialize({ ...this.context, ...context });
      this.loadedSkills.add(name);
      this._emit('skillLoaded', { name, skill });
    }
    
    return skill;
  }

  /**
   * Inicializar todos los skills
   * @param {Object} context - Contexto global
   */
  async loadAll(context = {}) {
    this.context = context;
    
    const loadPromises = Array.from(this.skills.keys()).map(name => 
      this.load(name, context)
    );
    
    await Promise.all(loadPromises);
    console.log(`✅ ${this.skills.size} skills cargados`);
    
    return this;
  }

  /**
   * Encontrar skills que pueden manejar una solicitud
   * @param {string} request - Solicitud del usuario
   * @returns {BaseSkill[]} - Skills que pueden manejar la solicitud
   */
  findMatchingSkills(request) {
    const matching = [];
    
    for (const skill of this.skills.values()) {
      if (skill.canHandle(request)) {
        matching.push(skill);
      }
    }
    
    // Ordenar por prioridad (mayor primero)
    matching.sort((a, b) => b.metadata.priority - a.metadata.priority);
    
    return matching;
  }

  /**
   * Ejecutar el skill más apropiado para una solicitud
   * @param {string} request - Solicitud del usuario
   * @param {Object} params - Parámetros adicionales
   */
  async execute(request, params = {}) {
    const matchingSkills = this.findMatchingSkills(request);
    
    if (matchingSkills.length === 0) {
      return {
        success: false,
        error: 'No se encontró un skill que pueda manejar esta solicitud',
        request
      };
    }
    
    const skill = matchingSkills[0];
    
    // Cargar el skill si no está cargado
    if (!skill.isLoaded) {
      await this.load(skill.metadata.name);
    }
    
    this._emit('beforeExecute', { skill, request, params });
    
    try {
      const result = await skill.execute({ request, ...params });
      
      this._emit('afterExecute', { skill, request, params, result });
      
      return {
        success: true,
        skillUsed: skill.metadata.name,
        result
      };
    } catch (error) {
      this._emit('executeError', { skill, request, params, error });
      
      return {
        success: false,
        skillUsed: skill.metadata.name,
        error: error.message
      };
    }
  }

  /**
   * Ejecutar múltiples skills en secuencia
   * @param {Array<{request: string, params: Object}>} tasks
   */
  async executeSequence(tasks) {
    const results = [];
    
    for (const task of tasks) {
      const result = await this.execute(task.request, task.params);
      results.push(result);
      
      if (!result.success && task.stopOnError) {
        break;
      }
    }
    
    return results;
  }

  /**
   * Obtener las instrucciones de un skill
   * @param {string} name - Nombre del skill
   */
  getInstructions(name) {
    const skill = this.skills.get(name);
    return skill ? skill.getInstructions() : null;
  }

  /**
   * Obtener instrucciones de todos los skills
   */
  getAllInstructions() {
    const instructions = {};
    
    for (const [name, skill] of this.skills) {
      instructions[name] = {
        metadata: skill.metadata,
        instructions: skill.getInstructions()
      };
    }
    
    return instructions;
  }

  /**
   * Agregar listener de eventos
   */
  on(event, callback) {
    if (!this.eventListeners.has(event)) {
      this.eventListeners.set(event, []);
    }
    this.eventListeners.get(event).push(callback);
    
    return () => this.off(event, callback);
  }

  /**
   * Remover listener
   */
  off(event, callback) {
    const listeners = this.eventListeners.get(event);
    if (listeners) {
      const index = listeners.indexOf(callback);
      if (index > -1) {
        listeners.splice(index, 1);
      }
    }
  }

  /**
   * Emitir evento
   */
  _emit(event, data) {
    const listeners = this.eventListeners.get(event) || [];
    listeners.forEach(callback => {
      try {
        callback(data);
      } catch (error) {
        console.error(`Error en listener de "${event}":`, error);
      }
    });
  }

  /**
   * Descargar un skill
   */
  async unload(name) {
    const skill = this.skills.get(name);
    if (skill && skill.isLoaded) {
      await skill.cleanup();
      this.loadedSkills.delete(name);
      this._emit('skillUnloaded', { name });
    }
  }

  /**
   * Descargar todos los skills
   */
  async unloadAll() {
    for (const name of this.loadedSkills) {
      await this.unload(name);
    }
  }
}

// ============================================================
// PARTE 2: SKILLS PREDEFINIDOS
// ============================================================

/**
 * SKILL: Procesamiento en Segundo Plano
 * Maneja tareas que deben continuar aunque el usuario cambie de pestaña
 */
class BackgroundProcessingSkill extends BaseSkill {
  constructor() {
    super();
    this.metadata = {
      name: 'background-processing',
      version: '1.0.0',
      description: 'Procesamiento en segundo plano inmune al throttling del navegador. Usa Web Workers y MessageChannel para garantizar ejecución continua.',
      triggers: [
        'background', 'segundo plano', 'worker', 'procesar',
        'continuar', 'no detener', 'throttling'
      ],
      priority: 10
    };
    
    this.worker = null;
    this.taskQueue = [];
    this.callbacks = new Map();
  }

  async initialize(context) {
    await super.initialize(context);
    this._createWorker();
  }

  _createWorker() {
    const workerCode = `
      let state = {
        isProcessing: false,
        isPaused: false,
        taskQueue: [],
        processedCount: 0
      };

      self.onmessage = function(e) {
        const { type, payload } = e.data;
        
        switch(type) {
          case 'START':
            state.taskQueue = [...payload];
            state.isProcessing = true;
            state.isPaused = false;
            state.processedCount = 0;
            processLoop();
            break;
          case 'PAUSE':
            state.isPaused = true;
            break;
          case 'RESUME':
            state.isPaused = false;
            processLoop();
            break;
          case 'CANCEL':
            state.isProcessing = false;
            state.taskQueue = [];
            break;
        }
      };

      function processLoop() {
        const BATCH_SIZE = 50;
        let count = 0;
        
        while (state.isProcessing && !state.isPaused && state.taskQueue.length > 0 && count < BATCH_SIZE) {
          const task = state.taskQueue.shift();
          const result = executeTask(task);
          state.processedCount++;
          count++;
          
          self.postMessage({
            type: 'TASK_COMPLETED',
            payload: { task, result, remaining: state.taskQueue.length }
          });
        }
        
        if (state.isProcessing && !state.isPaused && state.taskQueue.length > 0) {
          const channel = new MessageChannel();
          channel.port1.onmessage = () => processLoop();
          channel.port2.postMessage('');
        } else if (state.taskQueue.length === 0) {
          self.postMessage({ type: 'COMPLETED', payload: { total: state.processedCount } });
          state.isProcessing = false;
        }
      }

      function executeTask(task) {
        // Simular procesamiento
        if (task.type === 'compute') {
          return { value: task.data * 2 };
        }
        return { processed: true };
      }

      self.postMessage({ type: 'READY' });
    `;

    const blob = new Blob([workerCode], { type: 'application/javascript' });
    this.worker = new Worker(URL.createObjectURL(blob));
    
    this.worker.onmessage = (e) => {
      const { type, payload } = e.data;
      const callback = this.callbacks.get(type);
      if (callback) callback(payload);
    };
  }

  canHandle(request) {
    return super.canHandle(request) || 
           request.includes('web worker') ||
           request.includes('no se detenga');
  }

  async execute({ tasks, onProgress, onComplete }) {
    return new Promise((resolve) => {
      this.callbacks.set('TASK_COMPLETED', onProgress);
      this.callbacks.set('COMPLETED', (result) => {
        onComplete?.(result);
        resolve(result);
      });
      
      this.worker.postMessage({ type: 'START', payload: tasks });
    });
  }

  pause() {
    this.worker?.postMessage({ type: 'PAUSE' });
  }

  resume() {
    this.worker?.postMessage({ type: 'RESUME' });
  }

  cancel() {
    this.worker?.postMessage({ type: 'CANCEL' });
  }

  getInstructions() {
    return `
# Background Processing Skill

## Descripción
Procesa tareas en segundo plano usando Web Workers, inmune al throttling del navegador.

## Uso
\`\`\`javascript
const result = await skillManager.execute('procesar en background', {
  tasks: [{ type: 'compute', data: 100 }],
  onProgress: (p) => console.log('Progreso:', p),
  onComplete: (r) => console.log('Completado:', r)
});
\`\`\`

## Características
- No se detiene al cambiar de pestaña
- Usa MessageChannel en lugar de setTimeout
- Procesa en batches de 50 tareas
    `;
  }

  async cleanup() {
    this.worker?.terminate();
    this.worker = null;
    await super.cleanup();
  }
}

/**
 * SKILL: Persistencia de Datos
 * Maneja almacenamiento en IndexedDB con recuperación automática
 */
class PersistenceSkill extends BaseSkill {
  constructor() {
    super();
    this.metadata = {
      name: 'persistence',
      version: '1.0.0',
      description: 'Persistencia de datos con IndexedDB. Recuperación automática, sincronización y almacenamiento estructurado.',
      triggers: [
        'guardar', 'persistir', 'almacenar', 'indexeddb',
        'recuperar', 'base de datos', 'storage'
      ],
      priority: 8
    };
    
    this.db = null;
    this.dbName = 'AppSkillsDB';
    this.dbVersion = 1;
  }

  async initialize(context) {
    await super.initialize(context);
    await this._openDatabase();
  }

  async _openDatabase() {
    return new Promise((resolve, reject) => {
      const request = indexedDB.open(this.dbName, this.dbVersion);
      
      request.onerror = () => reject(request.error);
      
      request.onsuccess = () => {
        this.db = request.result;
        resolve(this.db);
      };
      
      request.onupgradeneeded = (e) => {
        const db = e.target.result;
        
        // Store genérico para datos
        if (!db.objectStoreNames.contains('data')) {
          const store = db.createObjectStore('data', { keyPath: 'id' });
          store.createIndex('type', 'type', { unique: false });
          store.createIndex('createdAt', 'createdAt', { unique: false });
        }
        
        // Store para tareas pendientes
        if (!db.objectStoreNames.contains('tasks')) {
          const store = db.createObjectStore('tasks', { keyPath: 'id', autoIncrement: true });
          store.createIndex('status', 'status', { unique: false });
        }
        
        // Store para configuración
        if (!db.objectStoreNames.contains('config')) {
          db.createObjectStore('config', { keyPath: 'key' });
        }
      };
    });
  }

  async execute({ action, store = 'data', key, value, query }) {
    switch (action) {
      case 'save':
        return this.save(store, key, value);
      case 'get':
        return this.get(store, key);
      case 'getAll':
        return this.getAll(store, query);
      case 'delete':
        return this.delete(store, key);
      case 'clear':
        return this.clear(store);
      default:
        throw new Error(`Acción desconocida: ${action}`);
    }
  }

  async save(store, key, value) {
    const tx = this.db.transaction(store, 'readwrite');
    const objectStore = tx.objectStore(store);
    
    const data = {
      id: key,
      value,
      createdAt: Date.now(),
      updatedAt: Date.now()
    };
    
    return new Promise((resolve, reject) => {
      const request = objectStore.put(data);
      request.onsuccess = () => resolve({ success: true, key });
      request.onerror = () => reject(request.error);
    });
  }

  async get(store, key) {
    const tx = this.db.transaction(store, 'readonly');
    const objectStore = tx.objectStore(store);
    
    return new Promise((resolve, reject) => {
      const request = objectStore.get(key);
      request.onsuccess = () => resolve(request.result?.value);
      request.onerror = () => reject(request.error);
    });
  }

  async getAll(store, query = {}) {
    const tx = this.db.transaction(store, 'readonly');
    const objectStore = tx.objectStore(store);
    
    return new Promise((resolve, reject) => {
      const request = objectStore.getAll();
      request.onsuccess = () => {
        let results = request.result;
        
        // Aplicar filtros si hay query
        if (query.type) {
          results = results.filter(r => r.type === query.type);
        }
        if (query.limit) {
          results = results.slice(0, query.limit);
        }
        
        resolve(results);
      };
      request.onerror = () => reject(request.error);
    });
  }

  async delete(store, key) {
    const tx = this.db.transaction(store, 'readwrite');
    const objectStore = tx.objectStore(store);
    
    return new Promise((resolve, reject) => {
      const request = objectStore.delete(key);
      request.onsuccess = () => resolve({ success: true });
      request.onerror = () => reject(request.error);
    });
  }

  async clear(store) {
    const tx = this.db.transaction(store, 'readwrite');
    const objectStore = tx.objectStore(store);
    
    return new Promise((resolve, reject) => {
      const request = objectStore.clear();
      request.onsuccess = () => resolve({ success: true });
      request.onerror = () => reject(request.error);
    });
  }

  getInstructions() {
    return `
# Persistence Skill

## Descripción
Maneja persistencia de datos con IndexedDB.

## Acciones
- \`save\`: Guardar datos
- \`get\`: Obtener un registro
- \`getAll\`: Obtener todos los registros
- \`delete\`: Eliminar registro
- \`clear\`: Limpiar store

## Uso
\`\`\`javascript
// Guardar
await skillManager.execute('guardar datos', {
  action: 'save',
  key: 'user-1',
  value: { name: 'Juan', age: 30 }
});

// Recuperar
const user = await skillManager.execute('recuperar datos', {
  action: 'get',
  key: 'user-1'
});
\`\`\`
    `;
  }

  async cleanup() {
    this.db?.close();
    this.db = null;
    await super.cleanup();
  }
}

/**
 * SKILL: Fórmulas y Cálculos
 * Motor de evaluación de fórmulas estilo Excel
 */
class FormulaSkill extends BaseSkill {
  constructor() {
    super();
    this.metadata = {
      name: 'formulas',
      version: '1.0.0',
      description: 'Motor de fórmulas estilo Excel. Soporta SUM, AVERAGE, COUNT, MAX, MIN, IF, ROUND y operaciones matemáticas.',
      triggers: [
        'fórmula', 'formula', 'calcular', 'sum', 'average',
        'max', 'min', 'count', 'if', 'matemática'
      ],
      priority: 7
    };
    
    this.gridData = {};
  }

  async execute({ formula, gridData }) {
    if (gridData) {
      this.gridData = { ...this.gridData, ...gridData };
    }
    
    return this.evaluate(formula);
  }

  evaluate(formula) {
    if (!formula || typeof formula !== 'string') return formula;
    if (!formula.startsWith('=')) return formula;
    
    const expr = formula.substring(1).toUpperCase().trim();
    
    try {
      // SUM
      if (expr.startsWith('SUM(')) {
        const range = expr.match(/SUM\(([^)]+)\)/)?.[1];
        const values = this._getRangeValues(range);
        return values.reduce((sum, val) => sum + (parseFloat(val) || 0), 0);
      }
      
      // AVERAGE
      if (expr.startsWith('AVERAGE(')) {
        const range = expr.match(/AVERAGE\(([^)]+)\)/)?.[1];
        const values = this._getRangeValues(range);
        const nums = values.filter(v => !isNaN(parseFloat(v))).map(v => parseFloat(v));
        return nums.length > 0 ? nums.reduce((a, b) => a + b, 0) / nums.length : 0;
      }
      
      // COUNT
      if (expr.startsWith('COUNT(')) {
        const range = expr.match(/COUNT\(([^)]+)\)/)?.[1];
        const values = this._getRangeValues(range);
        return values.filter(v => !isNaN(parseFloat(v))).length;
      }
      
      // MAX
      if (expr.startsWith('MAX(')) {
        const range = expr.match(/MAX\(([^)]+)\)/)?.[1];
        const values = this._getRangeValues(range);
        const nums = values.filter(v => !isNaN(parseFloat(v))).map(v => parseFloat(v));
        return nums.length > 0 ? Math.max(...nums) : 0;
      }
      
      // MIN
      if (expr.startsWith('MIN(')) {
        const range = expr.match(/MIN\(([^)]+)\)/)?.[1];
        const values = this._getRangeValues(range);
        const nums = values.filter(v => !isNaN(parseFloat(v))).map(v => parseFloat(v));
        return nums.length > 0 ? Math.min(...nums) : 0;
      }
      
      // ROUND
      if (expr.startsWith('ROUND(')) {
        const match = expr.match(/ROUND\(([^,]+),\s*(\d+)\)/);
        if (match) {
          const value = this._evaluateExpr(match[1]);
          const decimals = parseInt(match[2]);
          return Number(value.toFixed(decimals));
        }
      }
      
      // IF
      if (expr.startsWith('IF(')) {
        return this._evaluateIf(expr);
      }
      
      // Expresión matemática simple
      return this._evaluateExpr(expr);
      
    } catch (error) {
      return `#ERROR: ${error.message}`;
    }
  }

  _getRangeValues(rangeStr) {
    if (!rangeStr) return [];
    
    const [start, end] = rangeStr.split(':');
    const startRef = this._parseRef(start.trim());
    const endRef = end ? this._parseRef(end.trim()) : startRef;
    
    if (!startRef || !endRef) return [];
    
    const values = [];
    for (let r = startRef.row; r <= endRef.row; r++) {
      for (let c = startRef.col; c <= endRef.col; c++) {
        const key = `${r}:${c}`;
        if (this.gridData[key] !== undefined) {
          values.push(this.gridData[key]);
        }
      }
    }
    return values;
  }

  _parseRef(ref) {
    const match = ref.match(/^([A-Z]+)(\d+)$/i);
    if (!match) return null;
    
    let col = 0;
    const colStr = match[1].toUpperCase();
    for (let i = 0; i < colStr.length; i++) {
      col = col * 26 + (colStr.charCodeAt(i) - 64);
    }
    
    return { col: col - 1, row: parseInt(match[2]) - 1 };
  }

  _evaluateExpr(expr) {
    // Reemplazar referencias de celdas
    const resolved = expr.replace(/([A-Z]+)(\d+)/gi, (match, col, row) => {
      const colIndex = this._parseRef(match).col;
      const rowIndex = parseInt(row) - 1;
      const key = `${rowIndex}:${colIndex}`;
      return parseFloat(this.gridData[key]) || 0;
    });
    
    // Evaluar de forma segura
    const sanitized = resolved.replace(/[^0-9+\-*/().]/g, '');
    try {
      return Function('"use strict"; return (' + sanitized + ')')();
    } catch {
      return 0;
    }
  }

  _evaluateIf(expr) {
    const inner = expr.slice(3, -1);
    const parts = this._splitIfArgs(inner);
    
    if (parts.length !== 3) return '#ERROR: IF necesita 3 argumentos';
    
    const condition = this._evaluateCondition(parts[0].trim());
    return condition ? this._evaluateExpr(parts[1].trim()) : this._evaluateExpr(parts[2].trim());
  }

  _splitIfArgs(str) {
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

  _evaluateCondition(condition) {
    const operators = ['>=', '<=', '<>', '>', '<', '='];
    
    for (const op of operators) {
      if (condition.includes(op)) {
        const [left, right] = condition.split(op);
        const leftVal = this._evaluateExpr(left.trim());
        const rightVal = this._evaluateExpr(right.trim());
        
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

  setGridData(data) {
    this.gridData = data;
  }

  getInstructions() {
    return `
# Formula Skill

## Fórmulas Soportadas
- \`=SUM(A1:A10)\` - Suma
- \`=AVERAGE(B1:B10)\` - Promedio
- \`=COUNT(C1:C10)\` - Contar
- \`=MAX(D1:D10)\` - Máximo
- \`=MIN(E1:E10)\` - Mínimo
- \`=ROUND(A1, 2)\` - Redondear
- \`=IF(A1>10,"Alto","Bajo")\` - Condicional
- \`=A1*B1+C1\` - Operaciones

## Uso
\`\`\`javascript
const result = await skillManager.execute('calcular fórmula', {
  formula: '=SUM(A1:A10)',
  gridData: { '0:0': 10, '1:0': 20, '2:0': 30 }
});
\`\`\`
    `;
  }
}

/**
 * SKILL: Gráficos
 * Generación de datos y configuración para gráficos
 */
class ChartSkill extends BaseSkill {
  constructor() {
    super();
    this.metadata = {
      name: 'charts',
      version: '1.0.0',
      description: 'Generación de gráficos. Soporta barras, líneas, circular y área.',
      triggers: [
        'gráfico', 'grafico', 'chart', 'barras', 'líneas',
        'circular', 'pie', 'visualizar', 'dashboard'
      ],
      priority: 6
    };
    
    this.colors = [
      '#3b82f6', '#10b981', '#f59e0b', '#ef4444',
      '#8b5cf6', '#ec4899', '#06b6d4', '#84cc16'
    ];
  }

  async execute({ type, data, options = {} }) {
    return this.generateChart(type, data, options);
  }

  generateChart(type, data, options) {
    const chartConfig = {
      type,
      data: this._normalizeData(data),
      options: {
        title: options.title || 'Gráfico',
        width: options.width || 400,
        height: options.height || 300,
        colors: options.colors || this.colors,
        showLegend: options.showLegend !== false,
        showTooltip: options.showTooltip !== false,
        animate: options.animate !== false
      }
    };
    
    // Configuración específica por tipo
    switch (type) {
      case 'bar':
        chartConfig.barConfig = {
          radius: [4, 4, 0, 0],
          barSize: options.barSize || 30
        };
        break;
      case 'line':
        chartConfig.lineConfig = {
          strokeWidth: options.strokeWidth || 2,
          dot: options.showDots !== false
        };
        break;
      case 'pie':
        chartConfig.pieConfig = {
          innerRadius: options.donut ? 60 : 0,
          outerRadius: options.radius || 80,
          showLabels: options.showLabels !== false
        };
        break;
      case 'area':
        chartConfig.areaConfig = {
          fillOpacity: options.fillOpacity || 0.3,
          strokeWidth: options.strokeWidth || 2
        };
        break;
    }
    
    return chartConfig;
  }

  _normalizeData(data) {
    if (Array.isArray(data)) {
      return data.map((item, index) => {
        if (typeof item === 'object') {
          return {
            name: item.name || item.label || `Item ${index + 1}`,
            value: item.value || item.amount || 0,
            ...item
          };
        }
        return { name: `Item ${index + 1}`, value: item };
      });
    }
    
    if (typeof data === 'object') {
      return Object.entries(data).map(([name, value]) => ({ name, value }));
    }
    
    return [];
  }

  getChartComponent(chartConfig) {
    // Retorna la configuración que se puede usar con Recharts
    return chartConfig;
  }

  getInstructions() {
    return `
# Chart Skill

## Tipos de Gráficos
- \`bar\` - Gráfico de barras
- \`line\` - Gráfico de líneas
- \`pie\` - Gráfico circular
- \`area\` - Gráfico de área

## Uso
\`\`\`javascript
const chart = await skillManager.execute('crear gráfico', {
  type: 'bar',
  data: [
    { name: 'Enero', value: 100 },
    { name: 'Febrero', value: 150 }
  ],
  options: {
    title: 'Ventas Mensuales',
    width: 500,
    height: 300
  }
});
\`\`\`
    `;
  }
}

/**
 * SKILL: Notificaciones
 * Sistema de notificaciones del navegador
 */
class NotificationSkill extends BaseSkill {
  constructor() {
    super();
    this.metadata = {
      name: 'notifications',
      version: '1.0.0',
      description: 'Sistema de notificaciones del navegador. Alertas, permisos y notificaciones push.',
      triggers: [
        'notificar', 'notificación', 'alerta', 'notification',
        'avisar', 'alert'
      ],
      priority: 5
    };
    
    this.hasPermission = false;
  }

  async initialize(context) {
    await super.initialize(context);
    await this.requestPermission();
  }

  async requestPermission() {
    if (!('Notification' in window)) {
      console.warn('Este navegador no soporta notificaciones');
      return false;
    }
    
    if (Notification.permission === 'granted') {
      this.hasPermission = true;
      return true;
    }
    
    if (Notification.permission !== 'denied') {
      const permission = await Notification.requestPermission();
      this.hasPermission = permission === 'granted';
      return this.hasPermission;
    }
    
    return false;
  }

  async execute({ title, body, icon, tag, onClick }) {
    if (!this.hasPermission) {
      const granted = await this.requestPermission();
      if (!granted) {
        return { success: false, error: 'Permisos no concedidos' };
      }
    }
    
    return this.show(title, body, { icon, tag, onClick });
  }

  show(title, body, options = {}) {
    const notification = new Notification(title, {
      body,
      icon: options.icon || '/favicon.ico',
      tag: options.tag,
      requireInteraction: options.requireInteraction || false
    });
    
    if (options.onClick) {
      notification.onclick = options.onClick;
    }
    
    return { success: true, notification };
  }

  getInstructions() {
    return `
# Notification Skill

## Uso
\`\`\`javascript
await skillManager.execute('notificar', {
  title: 'Proceso Completado',
  body: 'Tu archivo está listo',
  icon: '/icon.png'
});
\`\`\`
    `;
  }
}

/**
 * SKILL: Coordinación Multi-Tab
 * Sincronización entre pestañas del navegador
 */
class TabCoordinationSkill extends BaseSkill {
  constructor() {
    super();
    this.metadata = {
      name: 'tab-coordination',
      version: '1.0.0',
      description: 'Coordinación entre pestañas. Leader election, sincronización de estado y broadcast.',
      triggers: [
        'pestañas', 'tabs', 'sincronizar', 'broadcast',
        'líder', 'leader', 'multi-tab'
      ],
      priority: 9
    };
    
    this.channel = null;
    this.tabId = null;
    this.isLeader = false;
    this.listeners = new Map();
  }

  async initialize(context) {
    await super.initialize(context);
    
    this.tabId = `tab_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    this.channel = new BroadcastChannel('app-skill-coordination');
    
    this._setupListeners();
    this._startHeartbeat();
    
    setTimeout(() => this._electLeader(), 500);
  }

  _setupListeners() {
    this.channel.onmessage = (e) => {
      const { type, senderId, payload } = e.data;
      if (senderId === this.tabId) return;
      
      // Emitir a listeners registrados
      const callbacks = this.listeners.get(type) || [];
      callbacks.forEach(cb => cb(payload, senderId));
      
      // Manejar eventos internos
      if (type === 'HEARTBEAT') {
        this._recordHeartbeat(senderId);
      }
    };
  }

  _startHeartbeat() {
    this._heartbeats = new Map();
    
    setInterval(() => {
      this.broadcast('HEARTBEAT', { timestamp: Date.now() });
      this._cleanupDeadTabs();
    }, 2000);
  }

  _recordHeartbeat(tabId) {
    this._heartbeats.set(tabId, Date.now());
  }

  _cleanupDeadTabs() {
    const now = Date.now();
    for (const [tabId, lastSeen] of this._heartbeats) {
      if (now - lastSeen > 6000) {
        this._heartbeats.delete(tabId);
      }
    }
  }

  _electLeader() {
    const allTabs = [this.tabId, ...this._heartbeats.keys()].sort();
    this.isLeader = allTabs[0] === this.tabId;
    
    if (this.isLeader) {
      console.log('👑 Esta pestaña es el líder');
      this._emit('becameLeader', {});
    }
  }

  _emit(type, payload) {
    const callbacks = this.listeners.get(type) || [];
    callbacks.forEach(cb => cb(payload, this.tabId));
  }

  async execute({ action, type, payload }) {
    switch (action) {
      case 'broadcast':
        return this.broadcast(type, payload);
      case 'isLeader':
        return { isLeader: this.isLeader };
      case 'getTabId':
        return { tabId: this.tabId };
      case 'getActiveTabs':
        return { tabs: [this.tabId, ...this._heartbeats.keys()] };
      default:
        throw new Error(`Acción desconocida: ${action}`);
    }
  }

  broadcast(type, payload) {
    this.channel?.postMessage({
      type,
      senderId: this.tabId,
      payload,
      timestamp: Date.now()
    });
    return { success: true };
  }

  on(type, callback) {
    if (!this.listeners.has(type)) {
      this.listeners.set(type, []);
    }
    this.listeners.get(type).push(callback);
    
    return () => this.off(type, callback);
  }

  off(type, callback) {
    const callbacks = this.listeners.get(type) || [];
    const index = callbacks.indexOf(callback);
    if (index > -1) callbacks.splice(index, 1);
  }

  getInstructions() {
    return `
# Tab Coordination Skill

## Acciones
- \`broadcast\` - Enviar mensaje a todas las pestañas
- \`isLeader\` - Verificar si esta pestaña es el líder
- \`getTabId\` - Obtener ID de esta pestaña
- \`getActiveTabs\` - Listar pestañas activas

## Uso
\`\`\`javascript
// Broadcast
await skillManager.execute('broadcast a tabs', {
  action: 'broadcast',
  type: 'DATA_UPDATED',
  payload: { key: 'value' }
});

// Escuchar
const skill = skillManager.get('tab-coordination');
skill.on('DATA_UPDATED', (payload) => {
  console.log('Datos actualizados:', payload);
});
\`\`\`
    `;
  }

  async cleanup() {
    this.channel?.close();
    await super.cleanup();
  }
}

/**
 * SKILL: Exportación de Datos
 * Exportar a diferentes formatos
 */
class ExportSkill extends BaseSkill {
  constructor() {
    super();
    this.metadata = {
      name: 'export',
      version: '1.0.0',
      description: 'Exportación de datos a diferentes formatos: JSON, CSV, XLSX.',
      triggers: [
        'exportar', 'export', 'descargar', 'download',
        'json', 'csv', 'excel', 'xlsx'
      ],
      priority: 4
    };
  }

  async execute({ format, data, filename }) {
    switch (format.toLowerCase()) {
      case 'json':
        return this.exportJSON(data, filename);
      case 'csv':
        return this.exportCSV(data, filename);
      case 'xlsx':
        return this.exportXLSX(data, filename);
      default:
        throw new Error(`Formato no soportado: ${format}`);
    }
  }

  exportJSON(data, filename = 'export.json') {
    const json = JSON.stringify(data, null, 2);
    this._download(json, filename, 'application/json');
    return { success: true, format: 'json', filename };
  }

  exportCSV(data, filename = 'export.csv') {
    if (!Array.isArray(data) || data.length === 0) {
      throw new Error('Los datos deben ser un array no vacío');
    }
    
    const headers = Object.keys(data[0]);
    const csvRows = [
      headers.join(','),
      ...data.map(row => 
        headers.map(h => {
          const val = row[h];
          // Escapar comillas y envolver en comillas si contiene coma
          if (typeof val === 'string' && (val.includes(',') || val.includes('"'))) {
            return `"${val.replace(/"/g, '""')}"`;
          }
          return val;
        }).join(',')
      )
    ];
    
    this._download(csvRows.join('\n'), filename, 'text/csv');
    return { success: true, format: 'csv', filename };
  }

  async exportXLSX(data, filename = 'export.xlsx') {
    // Verificar si XLSX está disponible
    if (typeof XLSX === 'undefined') {
      console.warn('Librería XLSX no encontrada. Instalar con: npm install xlsx');
      // Fallback a CSV
      return this.exportCSV(data, filename.replace('.xlsx', '.csv'));
    }
    
    const worksheet = XLSX.utils.json_to_sheet(data);
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, worksheet, 'Sheet1');
    XLSX.writeFile(workbook, filename);
    
    return { success: true, format: 'xlsx', filename };
  }

  _download(content, filename, mimeType) {
    const blob = new Blob([content], { type: mimeType });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }

  getInstructions() {
    return `
# Export Skill

## Formatos Soportados
- \`json\` - JavaScript Object Notation
- \`csv\` - Comma Separated Values
- \`xlsx\` - Microsoft Excel (requiere librería xlsx)

## Uso
\`\`\`javascript
await skillManager.execute('exportar a excel', {
  format: 'xlsx',
  data: [
    { nombre: 'Juan', edad: 30 },
    { nombre: 'María', edad: 25 }
  ],
  filename: 'usuarios.xlsx'
});
\`\`\`
    `;
  }
}

// ============================================================
// PARTE 3: FACTORY Y REGISTRO AUTOMÁTICO
// ============================================================

/**
 * Crea una instancia del SkillManager con todos los skills predefinidos
 */
function createSkillManager() {
  const manager = new SkillManager();
  
  // Registrar todos los skills predefinidos
  manager.registerAll([
    new BackgroundProcessingSkill(),
    new PersistenceSkill(),
    new FormulaSkill(),
    new ChartSkill(),
    new NotificationSkill(),
    new TabCoordinationSkill(),
    new ExportSkill()
  ]);
  
  return manager;
}

// ============================================================
// PARTE 4: HOOK DE REACT PARA USAR SKILLS
// ============================================================

/**
 * Hook de React para usar el sistema de Skills
 */
function useSkills() {
  const [manager] = React.useState(() => createSkillManager());
  const [isReady, setIsReady] = React.useState(false);
  const [skills, setSkills] = React.useState([]);

  React.useEffect(() => {
    const init = async () => {
      await manager.loadAll();
      setSkills(manager.list());
      setIsReady(true);
    };
    
    init();
    
    return () => {
      manager.unloadAll();
    };
  }, [manager]);

  const execute = React.useCallback(async (request, params) => {
    return manager.execute(request, params);
  }, [manager]);

  const getSkill = React.useCallback((name) => {
    return manager.get(name);
  }, [manager]);

  return {
    isReady,
    skills,
    execute,
    getSkill,
    manager
  };
}

// ============================================================
// PARTE 5: COMPONENTE DE UI PARA SKILLS
// ============================================================

/**
 * Componente que muestra los skills disponibles
 */
function SkillsPanel({ manager }) {
  const [skills, setSkills] = React.useState([]);
  const [selectedSkill, setSelectedSkill] = React.useState(null);
  const [testInput, setTestInput] = React.useState('');
  const [result, setResult] = React.useState(null);

  React.useEffect(() => {
    setSkills(manager?.list() || []);
  }, [manager]);

  const handleTest = async () => {
    if (!testInput.trim()) return;
    
    const res = await manager.execute(testInput);
    setResult(res);
  };

  return (
    <div className="skills-panel">
      <h2>🧩 Skills Disponibles</h2>
      
      <div className="skills-list">
        {skills.map(skill => (
          <div 
            key={skill.name}
            className={`skill-card ${selectedSkill === skill.name ? 'selected' : ''}`}
            onClick={() => setSelectedSkill(skill.name)}
          >
            <div className="skill-header">
              <span className="skill-name">{skill.name}</span>
              <span className={`skill-status ${skill.isLoaded ? 'loaded' : ''}`}>
                {skill.isLoaded ? '✓' : '○'}
              </span>
            </div>
            <p className="skill-description">{skill.description}</p>
            <div className="skill-triggers">
              {skill.triggers.slice(0, 3).map(t => (
                <span key={t} className="trigger-tag">{t}</span>
              ))}
              {skill.triggers.length > 3 && (
                <span className="trigger-more">+{skill.triggers.length - 3}</span>
              )}
            </div>
          </div>
        ))}
      </div>

      <div className="skills-test">
        <h3>Probar Skills</h3>
        <input
          type="text"
          value={testInput}
          onChange={(e) => setTestInput(e.target.value)}
          placeholder="Escribe una solicitud..."
          onKeyDown={(e) => e.key === 'Enter' && handleTest()}
        />
        <button onClick={handleTest}>Ejecutar</button>
        
        {result && (
          <pre className="test-result">
            {JSON.stringify(result, null, 2)}
          </pre>
        )}
      </div>
    </div>
  );
}

// ============================================================
// PARTE 6: EJEMPLO DE USO COMPLETO
// ============================================================

/**
 * Componente de ejemplo que usa todos los Skills
 */
function SkillsDemo() {
  const { isReady, skills, execute, getSkill, manager } = useSkills();
  const [log, setLog] = React.useState([]);

  const addLog = (message) => {
    setLog(prev => [...prev, { time: new Date().toLocaleTimeString(), message }]);
  };

  // Ejemplo: Procesar en background
  const handleBackgroundProcess = async () => {
    addLog('Iniciando procesamiento en background...');
    
    const tasks = Array.from({ length: 100 }, (_, i) => ({ type: 'compute', data: i }));
    
    await execute('procesar en background', {
      tasks,
      onProgress: (p) => {
        if (p.remaining % 10 === 0) {
          addLog(`Progreso: ${100 - p.remaining}/100`);
        }
      },
      onComplete: (r) => addLog(`✅ Completado: ${r.total} tareas`)
    });
  };

  // Ejemplo: Guardar y recuperar datos
  const handlePersistence = async () => {
    addLog('Guardando datos...');
    
    await execute('guardar datos', {
      action: 'save',
      key: 'test-data',
      value: { nombre: 'Test', timestamp: Date.now() }
    });
    
    addLog('Datos guardados. Recuperando...');
    
    const result = await execute('recuperar datos', {
      action: 'get',
      key: 'test-data'
    });
    
    addLog(`Datos recuperados: ${JSON.stringify(result.result)}`);
  };

  // Ejemplo: Calcular fórmula
  const handleFormula = async () => {
    const result = await execute('calcular fórmula', {
      formula: '=SUM(A1:A5)',
      gridData: { '0:0': 10, '1:0': 20, '2:0': 30, '3:0': 40, '4:0': 50 }
    });
    
    addLog(`Fórmula =SUM(A1:A5) = ${result.result}`);
  };

  // Ejemplo: Generar gráfico
  const handleChart = async () => {
    const result = await execute('crear gráfico de barras', {
      type: 'bar',
      data: [
        { name: 'Enero', value: 100 },
        { name: 'Febrero', value: 150 },
        { name: 'Marzo', value: 120 }
      ],
      options: { title: 'Ventas 2024' }
    });
    
    addLog(`Gráfico generado: ${JSON.stringify(result.result.options)}`);
  };

  // Ejemplo: Notificación
  const handleNotification = async () => {
    await execute('notificar usuario', {
      title: 'Prueba de Skill',
      body: 'Esta es una notificación de prueba'
    });
    
    addLog('Notificación enviada');
  };

  // Ejemplo: Exportar
  const handleExport = async () => {
    await execute('exportar a csv', {
      format: 'csv',
      data: [
        { producto: 'Laptop', precio: 1200, cantidad: 5 },
        { producto: 'Mouse', precio: 25, cantidad: 50 },
        { producto: 'Teclado', precio: 75, cantidad: 30 }
      ],
      filename: 'productos.csv'
    });
    
    addLog('Archivo CSV exportado');
  };

  if (!isReady) {
    return <div className="loading">Cargando Skills...</div>;
  }

  return (
    <div className="skills-demo">
      <header>
        <h1>🧩 Sistema de Agent Skills</h1>
        <p>Skills cargados: {skills.length}</p>
      </header>

      <div className="demo-grid">
        <div className="demo-actions">
          <h2>Acciones de Prueba</h2>
          
          <button onClick={handleBackgroundProcess}>
            ⚡ Background Processing (100 tareas)
          </button>
          
          <button onClick={handlePersistence}>
            💾 Guardar/Recuperar Datos
          </button>
          
          <button onClick={handleFormula}>
            🔢 Calcular Fórmula
          </button>
          
          <button onClick={handleChart}>
            📊 Generar Gráfico
          </button>
          
          <button onClick={handleNotification}>
            🔔 Enviar Notificación
          </button>
          
          <button onClick={handleExport}>
            📥 Exportar CSV
          </button>
        </div>

        <div className="demo-log">
          <h2>Log de Actividad</h2>
          <div className="log-container">
            {log.map((entry, i) => (
              <div key={i} className="log-entry">
                <span className="log-time">{entry.time}</span>
                <span className="log-message">{entry.message}</span>
              </div>
            ))}
            {log.length === 0 && (
              <p className="log-empty">Haz clic en una acción para ver el log...</p>
            )}
          </div>
          {log.length > 0 && (
            <button className="clear-log" onClick={() => setLog([])}>
              Limpiar Log
            </button>
          )}
        </div>
      </div>

      <SkillsPanel manager={manager} />
    </div>
  );
}

// ============================================================
// PARTE 7: ESTILOS CSS
// ============================================================

const skillsStyles = `
.skills-demo {
  font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
  max-width: 1200px;
  margin: 0 auto;
  padding: 20px;
}

.skills-demo header {
  text-align: center;
  margin-bottom: 30px;
}

.skills-demo header h1 {
  font-size: 2rem;
  margin-bottom: 8px;
}

.skills-demo header p {
  color: #64748b;
}

.demo-grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 24px;
  margin-bottom: 30px;
}

.demo-actions, .demo-log {
  background: white;
  border-radius: 12px;
  padding: 20px;
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.08);
}

.demo-actions h2, .demo-log h2 {
  font-size: 1.1rem;
  margin-bottom: 16px;
  color: #1e293b;
}

.demo-actions button {
  display: block;
  width: 100%;
  padding: 12px 16px;
  margin-bottom: 10px;
  border: none;
  border-radius: 8px;
  font-size: 14px;
  font-weight: 500;
  cursor: pointer;
  transition: all 0.2s;
  background: linear-gradient(135deg, #3b82f6 0%, #2563eb 100%);
  color: white;
  text-align: left;
}

.demo-actions button:hover {
  transform: translateY(-1px);
  box-shadow: 0 4px 12px rgba(59, 130, 246, 0.3);
}

.demo-actions button:active {
  transform: translateY(0);
}

.log-container {
  background: #f8fafc;
  border-radius: 8px;
  padding: 12px;
  min-height: 200px;
  max-height: 300px;
  overflow-y: auto;
}

.log-entry {
  padding: 8px;
  border-bottom: 1px solid #e2e8f0;
  font-size: 13px;
}

.log-entry:last-child {
  border-bottom: none;
}

.log-time {
  color: #94a3b8;
  margin-right: 10px;
  font-family: monospace;
}

.log-message {
  color: #334155;
}

.log-empty {
  text-align: center;
  color: #94a3b8;
  padding: 40px;
}

.clear-log {
  margin-top: 10px;
  padding: 8px 16px;
  border: none;
  background: #fee2e2;
  color: #991b1b;
  border-radius: 6px;
  font-size: 13px;
  cursor: pointer;
}

.skills-panel {
  background: white;
  border-radius: 12px;
  padding: 24px;
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.08);
}

.skills-panel h2 {
  margin-bottom: 20px;
}

.skills-list {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(280px, 1fr));
  gap: 16px;
  margin-bottom: 24px;
}

.skill-card {
  background: #f8fafc;
  border: 1px solid #e2e8f0;
  border-radius: 10px;
  padding: 16px;
  cursor: pointer;
  transition: all 0.2s;
}

.skill-card:hover {
  border-color: #3b82f6;
  box-shadow: 0 2px 8px rgba(59, 130, 246, 0.1);
}

.skill-card.selected {
  border-color: #3b82f6;
  background: #eff6ff;
}

.skill-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 8px;
}

.skill-name {
  font-weight: 600;
  color: #1e293b;
}

.skill-status {
  width: 20px;
  height: 20px;
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: 50%;
  background: #e2e8f0;
  color: #94a3b8;
  font-size: 12px;
}

.skill-status.loaded {
  background: #dcfce7;
  color: #16a34a;
}

.skill-description {
  font-size: 13px;
  color: #64748b;
  margin-bottom: 12px;
  line-height: 1.4;
}

.skill-triggers {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}

.trigger-tag {
  padding: 3px 8px;
  background: #e0e7ff;
  color: #4338ca;
  border-radius: 4px;
  font-size: 11px;
}

.trigger-more {
  padding: 3px 8px;
  background: #f1f5f9;
  color: #64748b;
  border-radius: 4px;
  font-size: 11px;
}

.skills-test {
  border-top: 1px solid #e2e8f0;
  padding-top: 20px;
}

.skills-test h3 {
  margin-bottom: 12px;
  font-size: 1rem;
}

.skills-test input {
  flex: 1;
  padding: 10px 14px;
  border: 1px solid #e2e8f0;
  border-radius: 8px;
  font-size: 14px;
  width: calc(100% - 100px);
  margin-right: 10px;
}

.skills-test button {
  padding: 10px 20px;
  background: #10b981;
  color: white;
  border: none;
  border-radius: 8px;
  font-weight: 500;
  cursor: pointer;
}

.test-result {
  margin-top: 16px;
  padding: 16px;
  background: #1e293b;
  color: #e2e8f0;
  border-radius: 8px;
  font-size: 12px;
  overflow-x: auto;
}

.loading {
  display: flex;
  align-items: center;
  justify-content: center;
  height: 100vh;
  font-size: 1.2rem;
  color: #64748b;
}

@media (max-width: 768px) {
  .demo-grid {
    grid-template-columns: 1fr;
  }
  
  .skills-list {
    grid-template-columns: 1fr;
  }
}
`;

// Inyectar estilos
if (typeof document !== 'undefined') {
  const styleEl = document.createElement('style');
  styleEl.textContent = skillsStyles;
  document.head.appendChild(styleEl);
}

// ============================================================
// PARTE 8: EXPORTACIONES
// ============================================================

export {
  // Core
  BaseSkill,
  SkillManager,
  createSkillManager,
  
  // Skills predefinidos
  BackgroundProcessingSkill,
  PersistenceSkill,
  FormulaSkill,
  ChartSkill,
  NotificationSkill,
  TabCoordinationSkill,
  ExportSkill,
  
  // React
  useSkills,
  SkillsPanel,
  SkillsDemo
};

export default SkillsDemo;
