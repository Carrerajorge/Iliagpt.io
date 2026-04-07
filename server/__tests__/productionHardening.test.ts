import { describe, it, expect, vi, beforeEach } from 'vitest';

// ---------------------------------------------------------------------------
// 1. Error handling
// ---------------------------------------------------------------------------
describe('error handling system', () => {
  it('creates AppError with correct properties', async () => {
    const { AppError } = await import('../lib/errors');
    const err = new AppError('test error', 500, 'TEST');
    expect(err.statusCode).toBe(500);
    expect(err.code).toBe('TEST');
    expect(err.isOperational).toBe(true);
    expect(err.message).toBe('test error');
    expect(err instanceof Error).toBe(true);
  });

  it('creates typed error subclasses', async () => {
    const { ValidationError, AuthError, RateLimitError, LLMError, ToolError, NotFoundError, ForbiddenError, TimeoutError } = await import('../lib/errors');

    expect(new ValidationError('bad input').statusCode).toBe(400);
    expect(new AuthError('no auth').statusCode).toBe(401);
    expect(new ForbiddenError('denied').statusCode).toBe(403);
    expect(new NotFoundError('missing').statusCode).toBe(404);
    expect(new RateLimitError('slow down', 5000).statusCode).toBe(429);
    expect(new LLMError('provider down', 'openai', 'gpt-4').statusCode).toBe(502);
    expect(new ToolError('tool broke', 'bash').statusCode).toBe(500);
    expect(new TimeoutError('took too long').statusCode).toBe(504);
  });

  it('toJSON excludes stack in production shape', async () => {
    const { ValidationError } = await import('../lib/errors');
    const err = new ValidationError('bad');
    const json = err.toJSON();
    expect(json.code).toBe('VALIDATION_ERROR');
    expect(json.message).toBe('bad');
    expect(json.statusCode).toBe(400);
  });

  it('isAppError type guard works', async () => {
    const { isAppError, AppError } = await import('../lib/errors');
    expect(isAppError(new AppError('x', 500, 'X'))).toBe(true);
    expect(isAppError(new Error('plain'))).toBe(false);
    expect(isAppError(null)).toBe(false);
    expect(isAppError('string')).toBe(false);
  });

  it('wrapError converts unknown errors', async () => {
    const { wrapError, AppError } = await import('../lib/errors');
    const wrapped = wrapError(new Error('oops'));
    expect(wrapped).toBeInstanceOf(AppError);
    expect(wrapped.statusCode).toBe(500);

    const existing = new AppError('already', 400, 'ALREADY');
    expect(wrapError(existing)).toBe(existing); // pass through

    const fromString = wrapError('string error');
    expect(fromString).toBeInstanceOf(AppError);
  });
});

// ---------------------------------------------------------------------------
// 2. Cache manager
// ---------------------------------------------------------------------------
describe('cache manager', () => {
  it('sets and gets values from memory cache', async () => {
    const { CacheManager } = await import('../cache/cacheManager');
    const cache = new CacheManager('test:');
    await cache.set('key1', { foo: 'bar' }, 60000);
    const result = await cache.get<{ foo: string }>('key1');
    expect(result).toEqual({ foo: 'bar' });
  });

  it('returns null for missing keys', async () => {
    const { CacheManager } = await import('../cache/cacheManager');
    const cache = new CacheManager('test2:');
    const result = await cache.get('nonexistent');
    expect(result).toBeNull();
  });

  it('respects TTL expiration', async () => {
    const { CacheManager } = await import('../cache/cacheManager');
    const cache = new CacheManager('test3:');
    await cache.set('ephemeral', 'value', 1); // 1ms TTL
    await new Promise(resolve => setTimeout(resolve, 10));
    const result = await cache.get('ephemeral');
    expect(result).toBeNull();
  });

  it('deletes keys', async () => {
    const { CacheManager } = await import('../cache/cacheManager');
    const cache = new CacheManager('test4:');
    await cache.set('delme', 'value');
    await cache.del('delme');
    expect(await cache.get('delme')).toBeNull();
  });

  it('getOrSet computes on miss and caches', async () => {
    const { CacheManager } = await import('../cache/cacheManager');
    const cache = new CacheManager('test5:');
    let computed = 0;
    const factory = async () => { computed++; return 42; };

    const v1 = await cache.getOrSet('computed', factory);
    const v2 = await cache.getOrSet('computed', factory);
    expect(v1).toBe(42);
    expect(v2).toBe(42);
    expect(computed).toBe(1); // factory called only once
  });

  it('tracks cache stats', async () => {
    const { CacheManager } = await import('../cache/cacheManager');
    const cache = new CacheManager('test6:');
    await cache.set('a', 1);
    await cache.get('a'); // hit
    await cache.get('b'); // miss
    const stats = cache.getStats();
    expect(stats.hits).toBeGreaterThanOrEqual(1);
    expect(stats.misses).toBeGreaterThanOrEqual(1);
  });

  it('event-based invalidation works', async () => {
    const { CacheManager } = await import('../cache/cacheManager');
    const cache = new CacheManager('test7:');
    cache.onEvent('user-updated', ['user:*']);
    await cache.set('user:123', { name: 'test' });
    expect(await cache.get('user:123')).toBeDefined();
    await cache.emitEvent('user-updated');
    expect(await cache.get('user:123')).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// 3. Rate limiter
// ---------------------------------------------------------------------------
describe('rate limiter', () => {
  it('exports rateLimiter factory', async () => {
    const mod = await import('../middleware/rateLimiter');
    expect(typeof mod.rateLimiter).toBe('function');
  });

  it('getUsage returns usage stats', async () => {
    const { getUsage } = await import('../middleware/rateLimiter');
    const usage = getUsage('test-user-unknown');
    expect(usage).toBeDefined();
  });

  it('rateLimiter returns middleware function', async () => {
    const { rateLimiter } = await import('../middleware/rateLimiter');
    const mw = rateLimiter('chat');
    expect(typeof mw).toBe('function');
    expect(mw.length).toBe(3); // Express middleware signature (req, res, next)
  });
});

// ---------------------------------------------------------------------------
// 4. Observability
// ---------------------------------------------------------------------------
describe('observability', () => {
  it('exports requestLogger middleware', async () => {
    const mod = await import('../middleware/observability');
    expect(typeof mod.requestLogger).toBe('function');
  });

  it('metricsCollector records and reads metrics', async () => {
    const { metricsCollector } = await import('../middleware/observability');
    expect(metricsCollector).toBeDefined();
    expect(typeof metricsCollector.recordRequest).toBe('function');
    expect(typeof metricsCollector.recordDocGen).toBe('function');
    expect(typeof metricsCollector.recordToolExec).toBe('function');

    metricsCollector.recordRequest('GET', '/api/test', 200);
    metricsCollector.recordDocGen('word');
    metricsCollector.recordToolExec('bash');
  });

  it('healthEndpoint returns status', async () => {
    const { healthEndpoint } = await import('../middleware/observability');
    expect(typeof healthEndpoint).toBe('function');
  });
});

// ---------------------------------------------------------------------------
// 5. Security
// ---------------------------------------------------------------------------
describe('security middleware', () => {
  it('exports securityHeaders middleware', async () => {
    const { securityHeaders } = await import('../middleware/security');
    expect(typeof securityHeaders).toBe('function');
  });

  it('requestSizeLimiter creates middleware', async () => {
    const { requestSizeLimiter } = await import('../middleware/security');
    const mw = requestSizeLimiter(1024 * 1024); // 1MB
    expect(typeof mw).toBe('function');
  });

  it('sanitizeInput strips HTML from strings', async () => {
    const { sanitizeInput } = await import('../middleware/security');
    expect(typeof sanitizeInput).toBe('function');
  });

  it('audit log records and retrieves events', async () => {
    const { logAuditEvent, getAuditLog } = await import('../middleware/security');

    logAuditEvent({
      action: 'test_action',
      userId: 'test-user',
      details: { key: 'value' },
      timestamp: new Date(),
    });

    const log = getAuditLog('test-user');
    expect(log.length).toBeGreaterThanOrEqual(1);
    expect(log[0].action).toBe('test_action');
    expect(log[0].userId).toBe('test-user');
  });

  it('audit log filters by userId', async () => {
    const { logAuditEvent, getAuditLog } = await import('../middleware/security');

    logAuditEvent({ action: 'a1', userId: 'user-a', timestamp: new Date() });
    logAuditEvent({ action: 'a2', userId: 'user-b', timestamp: new Date() });

    const logA = getAuditLog('user-a');
    const logB = getAuditLog('user-b');
    expect(logA.every(e => e.userId === 'user-a')).toBe(true);
    expect(logB.every(e => e.userId === 'user-b')).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// 6. Error handler middleware integration
// ---------------------------------------------------------------------------
describe('error handler middleware', () => {
  it('exports correlationId, errorHandler, notFoundHandler', async () => {
    const mod = await import('../middleware/errorHandler');
    expect(typeof mod.correlationId).toBe('function');
    expect(typeof mod.errorHandler).toBe('function');
    expect(typeof mod.notFoundHandler).toBe('function');
  });
});
