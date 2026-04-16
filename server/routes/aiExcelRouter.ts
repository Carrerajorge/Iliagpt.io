import { Router, Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import { randomUUID } from 'crypto';

const router = Router();

const RangeSchema = z.object({
  startRow: z.number().int().min(0),
  endRow: z.number().int().min(0),
  startCol: z.number().int().min(0),
  endCol: z.number().int().min(0),
});

const ExcelCommandSchema = z.object({
  command: z.string().min(1).max(1000),
  type: z.string().optional(),
  range: RangeSchema,
  currentData: z.array(z.array(z.any())).optional(),
});

const ExcelStreamSchema = z.object({
  prompt: z.string().min(1).max(2000),
  context: z.record(z.any()).optional(),
});

const FormulaRequestSchema = z.object({
  formulaType: z.enum(['SUM', 'AVERAGE', 'COUNT', 'MAX', 'MIN', 'IF', 'VLOOKUP', 'CONCATENATE', 'CUSTOM']),
  range: z.string().optional(),
  params: z.record(z.any()).optional(),
});

class AppError extends Error {
  statusCode: number;
  isOperational: boolean;
  
  constructor(message: string, statusCode: number) {
    super(message);
    this.statusCode = statusCode;
    this.isOperational = true;
    Error.captureStackTrace(this, this.constructor);
  }
}

class ValidationError extends AppError {
  constructor(message: string) {
    super(message, 400);
  }
}

class RateLimitError extends AppError {
  constructor(message: string = 'Too many requests, please try again later') {
    super(message, 429);
  }
}

interface RateLimitEntry {
  count: number;
  firstRequest: number;
}

const rateLimitStore = new Map<string, RateLimitEntry>();
const RATE_LIMIT_WINDOW_MS = 60 * 1000;
const RATE_LIMIT_MAX_REQUESTS = 100;

function getClientId(req: Request): string {
  return req.ip || req.headers['x-forwarded-for']?.toString() || 'unknown';
}

function checkRateLimit(clientId: string): boolean {
  const now = Date.now();
  const entry = rateLimitStore.get(clientId);
  
  if (!entry) {
    rateLimitStore.set(clientId, { count: 1, firstRequest: now });
    return true;
  }
  
  if (now - entry.firstRequest > RATE_LIMIT_WINDOW_MS) {
    rateLimitStore.set(clientId, { count: 1, firstRequest: now });
    return true;
  }
  
  if (entry.count >= RATE_LIMIT_MAX_REQUESTS) {
    return false;
  }
  
  entry.count++;
  return true;
}

setInterval(() => {
  const now = Date.now();
  for (const [key, entry] of rateLimitStore.entries()) {
    if (now - entry.firstRequest > RATE_LIMIT_WINDOW_MS * 2) {
      rateLimitStore.delete(key);
    }
  }
}, RATE_LIMIT_WINDOW_MS);

interface LogEntry {
  timestamp: string;
  clientId: string;
  endpoint: string;
  command?: string;
  duration: number;
  status: 'success' | 'error';
  errorMessage?: string;
}

const analyticsLog: LogEntry[] = [];
const MAX_LOG_ENTRIES = 1000;

function logRequest(entry: LogEntry): void {
  analyticsLog.push(entry);
  if (analyticsLog.length > MAX_LOG_ENTRIES) {
    analyticsLog.shift();
  }
  console.log(`[AI-Excel] ${entry.status.toUpperCase()} | ${entry.endpoint} | ${entry.duration}ms | ${entry.clientId}`);
}

function rateLimitMiddleware(req: Request, res: Response, next: NextFunction): void {
  const clientId = getClientId(req);
  
  if (!checkRateLimit(clientId)) {
    const remaining = RATE_LIMIT_WINDOW_MS - (Date.now() - (rateLimitStore.get(clientId)?.firstRequest || 0));
    res.setHeader('X-RateLimit-Limit', RATE_LIMIT_MAX_REQUESTS);
    res.setHeader('X-RateLimit-Remaining', 0);
    res.setHeader('X-RateLimit-Reset', Math.ceil(remaining / 1000));
    throw new RateLimitError();
  }
  
  const entry = rateLimitStore.get(clientId);
  res.setHeader('X-RateLimit-Limit', RATE_LIMIT_MAX_REQUESTS);
  res.setHeader('X-RateLimit-Remaining', RATE_LIMIT_MAX_REQUESTS - (entry?.count || 0));
  
  next();
}

function generateUUIDs(count: number): string[] {
  return Array.from({ length: count }, () => randomUUID());
}

function generatePhoneNumbers(count: number): string[] {
  const prefixes = ['600', '612', '622', '632', '644', '655', '666', '677', '688', '699'];
  return Array.from({ length: count }, () => {
    const prefix = prefixes[Math.floor(Math.random() * prefixes.length)];
    const number = String(Math.floor(Math.random() * 1000000)).padStart(6, '0');
    return `+34 ${prefix} ${number.slice(0, 3)} ${number.slice(3)}`;
  });
}

function generateAddresses(count: number): string[] {
  const streets = ['Calle Mayor', 'Avenida de la Constitución', 'Plaza España', 'Calle Real', 'Paseo de Gracia', 
    'Gran Vía', 'Calle Alcalá', 'Rambla Catalunya', 'Calle Serrano', 'Paseo de la Castellana'];
  const cities = ['Madrid', 'Barcelona', 'Valencia', 'Sevilla', 'Bilbao', 'Málaga', 'Zaragoza', 'Murcia'];
  
  return Array.from({ length: count }, (_, i) => {
    const street = streets[i % streets.length];
    const number = Math.floor(Math.random() * 200) + 1;
    const city = cities[i % cities.length];
    const postalCode = String(Math.floor(Math.random() * 50000) + 1000).padStart(5, '0');
    return `${street}, ${number}, ${postalCode} ${city}`;
  });
}

function generateCompanyNames(count: number): string[] {
  const prefixes = ['Tech', 'Global', 'Smart', 'Digital', 'Next', 'Pro', 'Meta', 'Cyber', 'Cloud', 'Data'];
  const cores = ['Solutions', 'Systems', 'Labs', 'Works', 'Hub', 'Group', 'Corp', 'Industries', 'Ventures', 'Partners'];
  const suffixes = ['S.L.', 'S.A.', 'Inc.', 'Ltd.', 'GmbH', ''];
  
  return Array.from({ length: count }, () => {
    const prefix = prefixes[Math.floor(Math.random() * prefixes.length)];
    const core = cores[Math.floor(Math.random() * cores.length)];
    const suffix = suffixes[Math.floor(Math.random() * suffixes.length)];
    return `${prefix} ${core}${suffix ? ' ' + suffix : ''}`;
  });
}

function generateCurrency(count: number, min = 10, max = 10000, currency = 'EUR'): string[] {
  const symbols: Record<string, string> = { EUR: '€', USD: '$', GBP: '£', JPY: '¥' };
  const symbol = symbols[currency] || currency;
  
  return Array.from({ length: count }, () => {
    const value = (Math.random() * (max - min) + min);
    return `${symbol}${value.toLocaleString('es-ES', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  });
}

function generatePercentages(count: number, min = 0, max = 100, decimals = 1): string[] {
  return Array.from({ length: count }, () => {
    const value = (Math.random() * (max - min) + min);
    return `${value.toFixed(decimals)}%`;
  });
}

function generateAlphaSequence(count: number, start = 'A'): string[] {
  const startCode = start.toUpperCase().charCodeAt(0);
  return Array.from({ length: count }, (_, i) => {
    const code = startCode + i;
    if (code > 90) {
      const overflow = Math.floor((code - 65) / 26);
      const remainder = (code - 65) % 26;
      return String.fromCharCode(65 + overflow - 1) + String.fromCharCode(65 + remainder);
    }
    return String.fromCharCode(code);
  });
}

function generateNumericSequence(count: number, start = 1, step = 1): string[] {
  return Array.from({ length: count }, (_, i) => String(start + i * step));
}

function generateFormula(type: string, range?: string, params?: Record<string, any>): string {
  const r = range || 'A1:A10';
  
  switch (type.toUpperCase()) {
    case 'SUM':
      return `=SUM(${r})`;
    case 'AVERAGE':
      return `=AVERAGE(${r})`;
    case 'COUNT':
      return `=COUNT(${r})`;
    case 'COUNTA':
      return `=COUNTA(${r})`;
    case 'MAX':
      return `=MAX(${r})`;
    case 'MIN':
      return `=MIN(${r})`;
    case 'IF':
      const condition = params?.condition || 'A1>0';
      const trueVal = params?.trueValue || '"Sí"';
      const falseVal = params?.falseValue || '"No"';
      return `=IF(${condition},${trueVal},${falseVal})`;
    case 'VLOOKUP':
      const lookup = params?.lookupValue || 'A1';
      const table = params?.tableRange || 'B1:D10';
      const col = params?.colIndex || 2;
      const exact = params?.exactMatch !== false ? 'FALSE' : 'TRUE';
      return `=VLOOKUP(${lookup},${table},${col},${exact})`;
    case 'CONCATENATE':
      const cells = params?.cells || ['A1', 'B1'];
      const separator = params?.separator || '" "';
      return `=CONCATENATE(${cells.join(',' + separator + ',')})`;
    case 'SUMIF':
      const criteria = params?.criteria || '">0"';
      return `=SUMIF(${r},${criteria})`;
    case 'COUNTIF':
      return `=COUNTIF(${r},${params?.criteria || '">0"'})`;
    case 'ROUND':
      const cell = params?.cell || 'A1';
      const decimals = params?.decimals ?? 2;
      return `=ROUND(${cell},${decimals})`;
    case 'TODAY':
      return '=TODAY()';
    case 'NOW':
      return '=NOW()';
    case 'PERCENTAGE':
      const part = params?.part || 'A1';
      const total = params?.total || 'B1';
      return `=${part}/${total}*100`;
    case 'GROWTH':
      const current = params?.current || 'B1';
      const previous = params?.previous || 'A1';
      return `=(${current}-${previous})/${previous}*100`;
    default:
      return params?.formula || `=SUM(${r})`;
  }
}

function columnToLetter(col: number): string {
  let result = '';
  let temp = col;
  while (temp >= 0) {
    result = String.fromCharCode((temp % 26) + 65) + result;
    temp = Math.floor(temp / 26) - 1;
  }
  return result;
}

router.post('/excel-command', async (req: Request, res: Response, next: NextFunction) => {
  const startTime = Date.now();
  const clientId = getClientId(req);
  
  try {
    rateLimitMiddleware(req, res, () => {});
    
    const validationResult = ExcelCommandSchema.safeParse(req.body);
    if (!validationResult.success) {
      throw new ValidationError(`Invalid request: ${validationResult.error.errors.map(e => e.message).join(', ')}`);
    }
    
    const { command, range, currentData } = validationResult.data;
    const commandLower = command.toLowerCase();
    const rowCount = Math.abs(range.endRow - range.startRow) + 1;
    const colCount = Math.abs(range.endCol - range.startCol) + 1;
    
    let response: any;
    
    if (commandLower.includes('uuid') || commandLower.includes('guid') || commandLower.includes('identificador único')) {
      response = { columnData: generateUUIDs(rowCount) };
    }
    else if (commandLower.includes('teléfono') || commandLower.includes('telefono') || commandLower.includes('phone') || commandLower.includes('móvil') || commandLower.includes('movil')) {
      response = { columnData: generatePhoneNumbers(rowCount) };
    }
    else if (commandLower.includes('dirección') || commandLower.includes('direccion') || commandLower.includes('address')) {
      response = { columnData: generateAddresses(rowCount) };
    }
    else if (commandLower.includes('empresa') || commandLower.includes('company') || commandLower.includes('compañía') || commandLower.includes('negocio')) {
      response = { columnData: generateCompanyNames(rowCount) };
    }
    else if (commandLower.includes('moneda') || commandLower.includes('currency') || commandLower.includes('dinero') || commandLower.includes('importe')) {
      const currency = commandLower.includes('dolar') || commandLower.includes('dollar') ? 'USD' : 
                       commandLower.includes('libra') || commandLower.includes('pound') ? 'GBP' : 'EUR';
      response = { columnData: generateCurrency(rowCount, 10, 10000, currency) };
    }
    else if (commandLower.includes('secuencia') || commandLower.includes('sequence') || commandLower.includes('serie')) {
      if (commandLower.includes('letra') || commandLower.includes('alpha') || commandLower.includes('abc')) {
        const startMatch = command.match(/desde\s+([A-Za-z])|start\s+([A-Za-z])|([A-Za-z])\s*,/i);
        const start = startMatch ? (startMatch[1] || startMatch[2] || startMatch[3]) : 'A';
        response = { columnData: generateAlphaSequence(rowCount, start) };
      } else {
        const startMatch = command.match(/desde\s+(\d+)|start\s+(\d+)|(\d+)\s*,/);
        const stepMatch = command.match(/paso\s+(\d+)|step\s+(\d+)|incremento\s+(\d+)/);
        const start = startMatch ? parseInt(startMatch[1] || startMatch[2] || startMatch[3]) : 1;
        const step = stepMatch ? parseInt(stepMatch[1] || stepMatch[2] || stepMatch[3]) : 1;
        response = { columnData: generateNumericSequence(rowCount, start, step) };
      }
    }
    else if (commandLower.includes('fórmula') || commandLower.includes('formula')) {
      const rangeStr = `${columnToLetter(range.startCol)}${range.startRow + 1}:${columnToLetter(range.endCol)}${range.endRow + 1}`;
      let formulaType = 'SUM';
      if (commandLower.includes('promedio') || commandLower.includes('average') || commandLower.includes('media')) formulaType = 'AVERAGE';
      else if (commandLower.includes('contar') || commandLower.includes('count')) formulaType = 'COUNT';
      else if (commandLower.includes('máximo') || commandLower.includes('maximo') || commandLower.includes('max')) formulaType = 'MAX';
      else if (commandLower.includes('mínimo') || commandLower.includes('minimo') || commandLower.includes('min')) formulaType = 'MIN';
      else if (commandLower.includes('si') || commandLower.includes('if')) formulaType = 'IF';
      else if (commandLower.includes('buscar') || commandLower.includes('vlookup')) formulaType = 'VLOOKUP';
      else if (commandLower.includes('hoy') || commandLower.includes('today')) formulaType = 'TODAY';
      else if (commandLower.includes('ahora') || commandLower.includes('now')) formulaType = 'NOW';
      else if (commandLower.includes('crecimiento') || commandLower.includes('growth')) formulaType = 'GROWTH';
      
      response = { cell: generateFormula(formulaType, rangeStr) };
    }
    else if (commandLower.includes('ciudad') || commandLower.includes('cities') || commandLower.includes('city')) {
      const cities = [
        'Madrid', 'Barcelona', 'Valencia', 'Sevilla', 'Bilbao', 
        'Málaga', 'Zaragoza', 'Murcia', 'Palma', 'Las Palmas',
        'Alicante', 'Córdoba', 'Valladolid', 'Vigo', 'Gijón',
        'Granada', 'A Coruña', 'Vitoria', 'Elche', 'Oviedo'
      ];
      const count = Math.min(rowCount, cities.length);
      response = { columnData: cities.slice(0, count) };
    }
    else if (commandLower.includes('país') || commandLower.includes('pais') || commandLower.includes('countr')) {
      const countries = [
        'España', 'Francia', 'Alemania', 'Italia', 'Portugal',
        'Reino Unido', 'Países Bajos', 'Bélgica', 'Suiza', 'Austria',
        'Polonia', 'Suecia', 'Noruega', 'Dinamarca', 'Finlandia'
      ];
      const count = Math.min(rowCount, countries.length);
      response = { columnData: countries.slice(0, count) };
    }
    else if (commandLower.includes('nombre') || commandLower.includes('name')) {
      const names = [
        'Ana García', 'Carlos López', 'María Rodríguez', 'Juan Martínez', 'Laura Sánchez',
        'Pedro Fernández', 'Carmen Ruiz', 'Antonio Díaz', 'Lucía Moreno', 'Francisco Álvarez',
        'Elena Torres', 'Miguel Romero', 'Isabel Navarro', 'Rafael Domínguez', 'Patricia Jiménez',
        'Daniel Muñoz', 'Sofía Molina', 'Alejandro Suárez', 'Paula Ortega', 'Andrés Castillo'
      ];
      const count = Math.min(rowCount, names.length);
      response = { columnData: names.slice(0, count) };
    }
    else if (commandLower.includes('producto') || commandLower.includes('product')) {
      const products = [
        'Laptop Pro 15"', 'Smartphone X12', 'Tablet Air', 'Monitor 4K 27"', 'Teclado Mecánico',
        'Mouse Inalámbrico', 'Webcam HD', 'Auriculares Bluetooth', 'Altavoz Portátil', 'Cargador USB-C',
        'Disco SSD 1TB', 'Memoria RAM 16GB', 'Tarjeta Gráfica RTX', 'Router WiFi 6', 'Hub USB 3.0'
      ];
      const count = Math.min(rowCount, products.length);
      response = { columnData: products.slice(0, count) };
    }
    else if (commandLower.includes('email') || commandLower.includes('correo')) {
      const emails = Array.from({ length: rowCount }, (_, i) => {
        const names = ['ana', 'carlos', 'maria', 'juan', 'laura', 'pedro', 'carmen', 'antonio'];
        const domains = ['gmail.com', 'outlook.com', 'empresa.es', 'mail.com'];
        return `${names[i % names.length]}${i + 1}@${domains[i % domains.length]}`;
      });
      response = { columnData: emails };
    }
    else if ((commandLower.includes('número') || commandLower.includes('number') || commandLower.includes('venta') || commandLower.includes('sales')) && !commandLower.includes('tabla') && !commandLower.includes('inventario') && !commandLower.includes('registro')) {
      const numbers = Array.from({ length: rowCount }, () => 
        Math.floor(Math.random() * 9000 + 1000)
      );
      response = { columnData: numbers.map(String) };
    }
    else if (commandLower.includes('precio') || commandLower.includes('price')) {
      response = { columnData: generateCurrency(rowCount, 10, 1000, 'EUR') };
    }
    else if (commandLower.includes('porcentaje') || commandLower.includes('percent')) {
      response = { columnData: generatePercentages(rowCount) };
    }
    else if (commandLower.includes('fecha') || commandLower.includes('date')) {
      const dates = Array.from({ length: rowCount }, (_, i) => {
        const date = new Date();
        date.setDate(date.getDate() + i);
        return date.toLocaleDateString('es-ES');
      });
      response = { columnData: dates };
    }
    else if (commandLower.includes('mes') || commandLower.includes('month')) {
      const months = [
        'Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio',
        'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre'
      ];
      const count = Math.min(rowCount, months.length);
      response = { columnData: months.slice(0, count) };
    }
    else if (commandLower.includes('día') || commandLower.includes('dia') || commandLower.includes('day')) {
      const days = ['Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado', 'Domingo'];
      const count = Math.min(rowCount, days.length);
      response = { columnData: days.slice(0, count) };
    }
    else if (commandLower.includes('estado') || commandLower.includes('status')) {
      const statuses = ['Pendiente', 'En Proceso', 'Completado', 'Cancelado', 'En Espera'];
      const statusData = Array.from({ length: rowCount }, (_, i) => 
        statuses[i % statuses.length]
      );
      response = { columnData: statusData };
    }
    else if (commandLower.includes('total') || commandLower.includes('suma') || commandLower.includes('sum')) {
      if (currentData && Array.isArray(currentData)) {
        let sum = 0;
        for (let r = range.startRow; r <= range.endRow; r++) {
          for (let c = range.startCol; c <= range.endCol; c++) {
            const val = currentData[r]?.[c];
            if (val && !isNaN(Number(val))) {
              sum += Number(val);
            }
          }
        }
        response = { cell: `Total: ${sum.toLocaleString('es-ES')}` };
      } else {
        response = { cell: 'Total: 0' };
      }
    }
    else if (commandLower.includes('promedio') || commandLower.includes('average') || commandLower.includes('media')) {
      if (currentData && Array.isArray(currentData)) {
        let sum = 0;
        let count = 0;
        for (let r = range.startRow; r <= range.endRow; r++) {
          for (let c = range.startCol; c <= range.endCol; c++) {
            const val = currentData[r]?.[c];
            if (val && !isNaN(Number(val))) {
              sum += Number(val);
              count++;
            }
          }
        }
        const avg = count > 0 ? (sum / count).toFixed(2) : '0';
        response = { cell: `Promedio: ${avg}` };
      } else {
        response = { cell: 'Promedio: 0' };
      }
    }
    else if (commandLower.includes('tabla') || commandLower.includes('table') || commandLower.includes('reporte') || commandLower.includes('report')) {
      const headers = ['ID', 'Nombre', 'Cantidad', 'Precio', 'Total'];
      const data: string[][] = [];
      
      data.push(headers.slice(0, colCount));
      
      for (let i = 1; i < rowCount; i++) {
        const row: string[] = [];
        const qty = Math.floor(Math.random() * 100 + 1);
        const price = Math.random() * 100 + 10;
        for (let j = 0; j < colCount; j++) {
          if (j === 0) row.push(String(i));
          else if (j === 1) row.push(['Producto A', 'Producto B', 'Producto C'][i % 3]);
          else if (j === 2) row.push(String(qty));
          else if (j === 3) row.push(`€${price.toFixed(2)}`);
          else if (j === 4) row.push(`€${(qty * price).toFixed(2)}`);
          else row.push('');
        }
        data.push(row);
      }
      
      response = { rangeData: data };
    }
    else if (commandLower.includes('inventario') || commandLower.includes('inventory')) {
      const headers = ['Código', 'Producto', 'Stock', 'Min', 'Precio'];
      const data: string[][] = [headers.slice(0, colCount)];
      
      for (let i = 1; i < rowCount; i++) {
        const row = [
          `SKU-${String(1000 + i).padStart(4, '0')}`,
          ['Widget A', 'Gadget B', 'Item C', 'Part D'][i % 4],
          String(Math.floor(Math.random() * 500)),
          String(Math.floor(Math.random() * 50 + 10)),
          `€${(Math.random() * 200 + 5).toFixed(2)}`
        ];
        data.push(row.slice(0, colCount));
      }
      
      response = { rangeData: data };
    }
    else if (commandLower.includes('financiero') || commandLower.includes('financial') || commandLower.includes('balance')) {
      const headers = ['Concepto', 'Q1', 'Q2', 'Q3', 'Q4', 'Total'];
      const concepts = ['Ingresos', 'Gastos Operativos', 'Salarios', 'Marketing', 'I+D', 'EBITDA', 'Impuestos', 'Beneficio Neto'];
      const data: string[][] = [headers.slice(0, colCount)];
      
      for (let i = 1; i < Math.min(rowCount, concepts.length + 1); i++) {
        const row: string[] = [concepts[i - 1]];
        let total = 0;
        for (let j = 1; j < colCount - 1 && j <= 4; j++) {
          const val = Math.random() * 100000 + 10000;
          total += val;
          row.push(`€${val.toLocaleString('es-ES', { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`);
        }
        if (colCount > 5) {
          row.push(`€${total.toLocaleString('es-ES', { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`);
        }
        data.push(row.slice(0, colCount));
      }
      
      response = { rangeData: data };
    }
    else {
      response = { cell: `✨ ${command}` };
    }
    
    logRequest({
      timestamp: new Date().toISOString(),
      clientId,
      endpoint: '/excel-command',
      command: command.substring(0, 100),
      duration: Date.now() - startTime,
      status: 'success',
    });
    
    res.json(response);
  } catch (error) {
    const duration = Date.now() - startTime;
    
    if (error instanceof AppError) {
      logRequest({
        timestamp: new Date().toISOString(),
        clientId,
        endpoint: '/excel-command',
        command: req.body?.command?.substring(0, 100),
        duration,
        status: 'error',
        errorMessage: error.message,
      });
      
      return res.status(error.statusCode).json({ 
        error: error.message,
        code: error.statusCode === 400 ? 'VALIDATION_ERROR' : 
              error.statusCode === 429 ? 'RATE_LIMIT_EXCEEDED' : 'ERROR'
      });
    }
    
    console.error('AI Excel command error:', error);
    logRequest({
      timestamp: new Date().toISOString(),
      clientId,
      endpoint: '/excel-command',
      command: req.body?.command?.substring(0, 100),
      duration,
      status: 'error',
      errorMessage: error instanceof Error ? error.message : 'Unknown error',
    });
    
    res.status(500).json({ error: 'Failed to process AI command', code: 'INTERNAL_ERROR' });
  }
});

router.post('/excel-stream', async (req: Request, res: Response) => {
  const startTime = Date.now();
  const clientId = getClientId(req);
  
  try {
    rateLimitMiddleware(req, res, () => {});
    
    const validationResult = ExcelStreamSchema.safeParse(req.body);
    if (!validationResult.success) {
      throw new ValidationError(`Invalid request: ${validationResult.error.errors.map(e => e.message).join(', ')}`);
    }
    
    const { prompt } = validationResult.data;
    
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no');
    
    const response = `Generado con IA: ${prompt}`;
    
    for (const char of response) {
      res.write(char);
      await new Promise(resolve => setTimeout(resolve, 30));
    }
    
    logRequest({
      timestamp: new Date().toISOString(),
      clientId,
      endpoint: '/excel-stream',
      command: prompt.substring(0, 100),
      duration: Date.now() - startTime,
      status: 'success',
    });
    
    res.end();
  } catch (error) {
    if (error instanceof AppError) {
      res.status(error.statusCode).json({ error: error.message });
      return;
    }
    
    console.error('AI Excel stream error:', error);
    res.status(500).json({ error: 'Failed to stream AI response', code: 'INTERNAL_ERROR' });
  }
});

router.post('/formula', async (req: Request, res: Response) => {
  const startTime = Date.now();
  const clientId = getClientId(req);
  
  try {
    rateLimitMiddleware(req, res, () => {});
    
    const validationResult = FormulaRequestSchema.safeParse(req.body);
    if (!validationResult.success) {
      throw new ValidationError(`Invalid request: ${validationResult.error.errors.map(e => e.message).join(', ')}`);
    }
    
    const { formulaType, range, params } = validationResult.data;
    const formula = generateFormula(formulaType, range, params);
    
    logRequest({
      timestamp: new Date().toISOString(),
      clientId,
      endpoint: '/formula',
      command: formulaType,
      duration: Date.now() - startTime,
      status: 'success',
    });
    
    res.json({ formula, type: formulaType });
  } catch (error) {
    if (error instanceof AppError) {
      return res.status(error.statusCode).json({ error: error.message });
    }
    
    console.error('Formula generation error:', error);
    res.status(500).json({ error: 'Failed to generate formula', code: 'INTERNAL_ERROR' });
  }
});

router.get('/analytics', async (req: Request, res: Response) => {
  try {
    const last24h = analyticsLog.filter(entry => {
      const entryTime = new Date(entry.timestamp).getTime();
      return Date.now() - entryTime < 24 * 60 * 60 * 1000;
    });
    
    const stats = {
      totalRequests: last24h.length,
      successRate: last24h.length > 0 
        ? (last24h.filter(e => e.status === 'success').length / last24h.length * 100).toFixed(1) + '%'
        : '0%',
      avgDuration: last24h.length > 0
        ? Math.round(last24h.reduce((sum, e) => sum + e.duration, 0) / last24h.length) + 'ms'
        : '0ms',
      endpointBreakdown: {
        '/excel-command': last24h.filter(e => e.endpoint === '/excel-command').length,
        '/excel-stream': last24h.filter(e => e.endpoint === '/excel-stream').length,
        '/formula': last24h.filter(e => e.endpoint === '/formula').length,
      },
      recentErrors: last24h.filter(e => e.status === 'error').slice(-10),
    };
    
    res.json(stats);
  } catch (error) {
    console.error('Analytics error:', error);
    res.status(500).json({ error: 'Failed to retrieve analytics' });
  }
});

router.get('/health', (_req: Request, res: Response) => {
  res.json({ 
    status: 'healthy',
    timestamp: new Date().toISOString(),
    rateLimitEntries: rateLimitStore.size,
    logEntries: analyticsLog.length,
  });
});

export default router;
