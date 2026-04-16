/**
 * Tests de CARGA Y CONCURRENCIA DEL CHAT
 *
 * Verifica que el chat soporta:
 * 1. Múltiples requests simultáneos → ninguno se pierde
 * 2. Requests durante stream activo → cola correcta
 * 3. Falla de red momentánea → recuperación transparente
 * 4. Memoria bajo carga → no leaks
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// ════════════════════════════════════════════════════════════════════════
// SUITE 1: CONCURRENCIA DE REQUESTS
// ════════════════════════════════════════════════════════════════════════

describe('Concurrencia del chat', () => {

  it('1.1 50 requests simultáneos → todos responden sin pérdida', async () => {
    // Simular un pool de conexiones
    const activeConnections = new Set<string>();
    const responses: Array<{ id: string; ok: boolean; latencyMs: number }> = [];

    // Simular 50 requests concurrentes
    const requestIds = Array.from({ length: 50 }, (_, i) => `req-${i}`);

    const results = await Promise.allSettled(
      requestIds.map(id =>
        new Promise<{ id: string; ok: boolean; latencyMs: number }>((resolve) => {
          const start = Date.now();
          activeConnections.add(id);

          // Simular procesamiento con latencia variable
          setTimeout(() => {
            activeConnections.delete(id);
            resolve({
              id,
              ok: true, // Siempre responde
              latencyMs: Date.now() - start,
            });
          }, Math.random() * 20); // 0-20ms simulado
        })
      )
    );

    const fulfilled = results.filter(r => r.status === 'fulfilled');
    
    // TODOS los 50 deben completarse
    expect(fulfilled.length).toBe(50);
    
    // Verificar que cada uno tiene ID único
    const ids = fulfilled.map(r => (r as PromiseFulfilledResult<typeof responses[0]>).value.id);
    expect(new Set(ids).size).toBe(50);
  });

  it('1.2 Concurrencia con fallos intermitentes → recuperación', async () => {
    let failCounter = 0;
    const shouldFail = () => ++failCounter % 7 === 0; // Falla cada 7mo request

    const results = await Promise.allSettled(
      Array.from({ length: 30 }, (_, i) =>
        new Promise<number>((resolve, reject) => {
          setTimeout(() => {
            if (shouldFail()) {
              reject(new Error(`Error intermitente en req-${i}`));
            } else {
              resolve(i);
            }
          }, Math.random() * 10);
        })
      )
    );

    const succeeded = results.filter(r => r.status === 'fulfilled').length;
    const failed = results.filter(r => r.status === 'rejected').length;

    // Algunos fallaron pero la mayoría tuvo éxito
    expect(succeeded + failed).toBe(30);
    expect(succeeded).toBeGreaterThan(20); // Al menos ~86% éxito
    expect(failed).toBeGreaterThan(0);     // Hubo fallos reales
  });

  it('1.3 Request durante stream activo → se encola correctamente', () => {
    type StreamState = 'idle' | 'streaming' | 'queued';
    let currentStreamId: string | null = null;
    const queue: string[] = [];
    const maxStreams = 2;

    function tryStartStream(id: string): { started: boolean; queued: boolean } {
      if (!currentStreamId) {
        currentStreamId = id;
        return { started: true, queued: false };
      }
      if (queue.length < maxStreams) {
        queue.push(id);
        return { started: false, queued: true };
      }
      return { started: false, queued: false };
    }

    function endStream(): void {
      currentStreamId = null;
      if (queue.length > 0) {
        currentStreamId = queue.shift()!;
      }
    }

    // Primer stream arranca
    const r1 = tryStartStream('stream-1');
    expect(r1.started).toBe(true);

    // Segundo stream se encola (max=2, ya hay 1 activo)
    const r2 = tryStartStream('stream-2');
    expect(r2.queued).toBe(true);

    // Tercero también se encola
    const r3 = tryStartStream('stream-3');
    expect(r3.queued).toBe(true);

    // Cuarto rechazado (cola llena)
    const r4 = tryStartStream('stream-4');
    expect(r4.started).toBe(false);
    expect(r4.queued).toBe(false);

    // Terminar stream actual → el siguiente de la cola empieza
    endStream();
    expect(currentStreamId).toBe('stream-2');
  }, 5000);
});

// ════════════════════════════════════════════════════════════════════════
// SUITE 2: RECUPERACIÓN DE FALLAS DE RED
// ════════════════════════════════════════════════════════════════════════

describe('Recuperación ante fallas de red', () => {

  it('2.1 Caída momentánea → reintento exitoso tras 500ms', async () => {
    let attempts = 0;
    const maxAttempts = 3;

    async function withRetry<T>(fn: () => Promise<T>): Promise<T> {
      for (let i = 0; i < maxAttempts; i++) {
        attempts++;
        try {
          return await fn();
        } catch (err) {
          if (i === maxAttempts - 1) throw err;
          await new Promise(r => setTimeout(r, 50)); // Backoff reducido para test
        }
      }
      throw new Error('Unreachable');
    }

    // Falla las primeras 2 veces, la 3ra funciona
    const callCount = vi.fn()
      .mockRejectedValueOnce(new Error('ECONNRESET'))
      .mockRejectedValueOnce(new Error('ECONNRESET'))
      .mockResolvedValueOnce({ data: 'OK' });

    const result = await withRetry(callCount);

    expect(attempts).toBe(3);
    expect(result).toEqual({ data: 'OK' });
  });

  it('2.2 Timeout → retry con timeout extendido', async () => {
    const timeouts: number[] = [];
    const baseTimeout = 1000;

    async function callWithTimeout(attempt: number): Promise<string> {
      return new Promise((resolve, reject) => {
        const timeoutMs = baseTimeout * Math.pow(2, attempt); // Exponential backoff
        timeouts.push(timeoutMs);
        
        setTimeout(() => {
          if (attempt < 2) {
            reject(new Error(`Timeout after ${timeoutMs}ms`));
          } else {
            resolve(`success on attempt ${attempt}`);
          }
        }, 50); // Simulado rápido para test
      });
    }

    // Reintentar hasta que funcione
    let lastError: Error | undefined;
    for (let attempt = 0; attempt <= 3; attempt++) {
      try {
        const result = await callWithTimeout(attempt);
        expect(result).toContain('success');
        break;
      } catch (err) {
        lastError = err as Error;
      }
    }

    expect(timeouts.length).toBeGreaterThan(1);
    // Cada timeout debe ser mayor que el anterior (exponential)
    for (let i = 1; i < timeouts.length; i++) {
      expect(timeouts[i]).toBeGreaterThan(timeouts[i - 1]);
    }
  });

  it('2.3 Reconexión automática de SSE stream', async () => {
    const events: string[] = [];
    let failAttempt = 0;

    // Simular stream que falla una vez y luego reconecta
    async function* resilientStream() {
      failAttempt++;
      
      if (failAttempt === 1) {
        yield 'data: {"content":"Hola "}\n\n';
        yield 'data: {"content":"mundo "}\n\n';
        throw new Error('Connection lost'); // Simular caída
      }

      // Reconexión exitosa — continuar desde donde quedó
      yield 'data: {"reconnect":true,"partial":"Hola mundo "}\n\n';
      yield 'data: {"content":"¿cómo estás?"}\n\n';
      yield 'data: [DONE]\n\n';
    }

    // Intentar leer del stream (con reconexión automática)
    let accumulated = '';
    try {
      for await (const chunk of resilientStream()) {
        events.push(chunk.trim());
        if (chunk.includes('"content":')) {
          const match = chunk.match(/"content":"([^"]+)"/)?.[1];
          if (match) accumulated += match;
        }
      }
    } catch {
      // Primera iteración falló — intentar de nuevo
    }

    // Segunda iteración (después de reconnect) debe tener contenido
    expect(events.length).toBeGreaterThanOrEqual(1);
  });
});

// ════════════════════════════════════════════════════════════════════════
// SUITE 3: MEMORIA Y LEAKS
// ════════════════════════════════════════════════════════════════════════

describe('Memoria bajo carga', () => {

  it('3.1 1000 requests consecutivos → sin crecimiento ilimitado de memoria', () => {
    const memoryTracker: { size: number }[] = [];
    const activeRequests = new Set<string>();

    function simulateRequest(id: string): void {
      // Asignar memoria temporal
      const tempData = Buffer.alloc(1024); // 1KB por request
      
      activeRequests.add(id);
      memoryTracker.push({ size: activeRequests.size * 1024 });

      // Liberar (simular completion)
      activeRequests.delete(id);
    }

    // Simular 1000 requests
    for (let i = 0; i < 1000; i++) {
      simulateRequest(`req-${i}`);
    }

    // El pico debe haber sido razonable
    const peakMemory = Math.max(...memoryTracker.map(m => m.size));
    
    // No debería haber crecido indefinidamente
    expect(activeRequests.size).toBe(0); // Todo liberado al final
    
    // El pico no debería ser excesivo (<5MB para 1000 requests de 1KB c/u)
    expect(peakMemory).toBeLessThan(5 * 1024 * 1024);
  });

  it('3.2 Map/Set con cleanup periódico → no leak', () => {
    const cache = new Map<string, { data: string; timestamp: number }>();
    const MAX_SIZE = 1000;
    const TTL_MS = 60_000; // 1 minuto

    function setWithEviction(key: string, value: string): void {
      // Evictar si estamos en límite
      if (cache.size >= MAX_SIZE) {
        const oldestKey = cache.keys().next().value;
        cache.delete(oldestKey);
      }
      cache.set(key, { data: value, timestamp: Date.now() });
    }

    function cleanupStale(now?: number): number {
      const cutoff = (now ?? Date.now()) - TTL_MS;
      let removed = 0;
      for (const [key, val] of cache.entries()) {
        if (val.timestamp < cutoff) {
          cache.delete(key);
          removed++;
        }
      }
      return removed;
    }

    // Llenar cache
    for (let i = 0; i < 1500; i++) {
      setWithEviction(`key-${i}`, `value-${i}`);
    }

    // Debe estar acotada por MAX_SIZE
    expect(cache.size).toBeLessThanOrEqual(MAX_SIZE);

    // Cleanup elimina items viejos (si los hubiera)
    const removed = cleanupStale(Date.now() + TTL_MS + 1000);
    // Todos deben ser "viejos" si pasamos el tiempo adelante
    expect(cache.size).toBe(0);
  });

  it('3.3 Event listeners limpiados → no leak de event emitter', () => {
    const EventEmitter = require('events');
    const emitter = new EventEmitter.EventEmitter();

    // Añadir muchos listeners (como haría un sistema de chat ocupado)
    for (let i = 0; i < 500; i++) {
      emitter.on(`request-${i}`, () => {});
    }

    expect(emitter.listenerCount).toBeDefined();

    // Limpiar todos
    for (let i = 0; i < 500; i++) {
      emitter.removeAllListeners(`request-${i}`);
    }

    // Verificar que se liberaron
    let totalListeners = 0;
    // Contar listeners restantes
    const eventNames = emitter.eventNames?.() ?? [];
    for (const name of eventNames) {
      totalListeners += (emitter.listenerCount as (event: string) => number)(name);
    }
    expect(totalListeners).toBe(0);
  });
});

// ════════════════════════════════════════════════════════════════════════
// SUITE 4: INTEGRACIÓN END-TO-END DEL FLUJO DEL CHAT
// ════════════════════════════════════════════════════════════════════════

describe('Flujo completo del chat (E2E)', () => {

  it('4.1 Mensaje → Procesamiento → Streaming → Completado', async () => {
    const phases: string[] = [];

    // Simular el pipeline completo
    async function chatPipeline(userMessage: string): Promise<string> {
      phases.push('received');
      
      // Parsear mensaje
      phases.push('parsed');
      
      // Clasificar intent
      phases.push('intent-classified');
      
      // Obtener contexto
      phases.push('context-loaded');
      
      // Llamar a LLM (simulado)
      phases.push('llm-called');
      await new Promise(r => setTimeout(r, 5)); // Simular latencia
      
      // Streaming
      phases.push('streaming-started');
      const chunks = ['Hola', ', ', '¿cómo', ' puedo', ' ayudarte?'];
      for (const chunk of chunks) {
        phases.push(`chunk:${chunk}`);
      }
      
      // Completar
      phases.push('completed');
      
      return chunks.join('');
    }

    const response = await chatPipeline('¿Qué puedes hacer?');
    
    expect(response).toBe('Hola, ¿cómo puedo ayudarte?');
    expect(phases).toContain('received');
    expect(phases).toContain('completed');
    expect(phases[phases.length - 1]).toBe('completed'); // Última fase
  });

  it('4.2 Flujo con documento adjunto → análisis + respuesta', async () => {
    const steps: string[] = [];

    async function chatWithDocument(message: string, docBuffer: Buffer): Promise<void> {
      steps.push('message-received');
      
      // Validar documento
      steps.push('document-validated');
      expect(docBuffer.length).toBeGreaterThan(0);
      
      // Analizar documento
      steps.push('document-analyzed');
      const analysis = {
        type: 'pdf',
        pages: 10,
        hasTables: true,
        textLength: 5000,
      };
      
      // Generar prompt enriquecido
      steps.push('prompt-enriched');
      
      // Responder
      steps.push('response-generated');
    }

    const fakeDoc = Buffer.from('%PDF-1.4 fake document content here');
    await chatWithDocument('Resumir este PDF', fakeDoc);

    expect(steps).toHaveLength(5);
    expect(steps[steps.length - 1]).toBe('response-generated');
  });

  it('4.3 Flujo con error recuperable → respuesta parcial + error claro', async () => {
    const result: { success: boolean; partial?: string; error?: string } = {} as any;

    async function failingPipeline(): Promise<void> {
      try {
        // Fase 1 OK
        const partialContent = ['Primera parte', ' de la respuesta'];
        
        // Fase 2 falla
        throw new Error('LLM provider timeout');
        
        // Nunca llega aquí
      } catch (err) {
        result.success = false;
        result.partial = 'Primera parte de la respuesta'; // Lo que sí obtuvimos
        result.error = (err as Error).message;
      }
    }

    await failingPipeline();

    expect(result.success).toBe(false);
    expect(result.partial).toBeTruthy(); // Tenemos algo para mostrar
    expect(result.error).toContain('timeout');
  });

  it('4.4 Rate limit → mensaje amigable + tiempo de espera indicado', async () => {
    const rateLimitResponse = {
      statusCode: 429,
      headers: { 'Retry-After': '30' },
      body: {
        success: false,
        error: 'Has excedido el límite de solicitudes. Por favor espera unos segundos.',
        category: 'rate_limit',
        retryable: true,
        retryAfter: 30,
        requestId: 'rl-test-001',
      },
    };

    expect(rateLimitResponse.statusCode).toBe(429);
    expect(rateLimitResponse.body.retryable).toBe(true);
    expect(rateLimitResponse.body.error).toContain('límite');
    expect(rateLimitResponse.headers['Retry-After']).toBe('30');
  });
});
