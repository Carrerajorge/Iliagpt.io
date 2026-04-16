const SENSITIVE_KEYS = ['password', 'token', 'secret', 'authorization', 'creditCard', 'cvv', 'apiKey', 'access_token', 'refresh_token'];

const FORBIDDEN_KEYS = new Set(['__proto__', 'prototype', 'constructor']);

export function redactSensitiveData(data: unknown): unknown {
    if (data === null || data === undefined) return data;
    if (typeof data !== 'object') return data;
    if (Array.isArray(data)) return data.slice(0, 200).map(redactSensitiveData);

    const redacted: Record<string, unknown> = Object.create(null);
    for (const [key, value] of Object.entries(data as Record<string, unknown>)) {
        if (FORBIDDEN_KEYS.has(key)) {
            continue;
        }

        if (SENSITIVE_KEYS.some(sensitive => key.toLowerCase().includes(sensitive.toLowerCase()))) {
            redacted[key] = '[REDACTED]';
            continue;
        }

        if (typeof value === 'object' && value !== null) {
            redacted[key] = redactSensitiveData(value);
        } else {
            redacted[key] = value;
        }
    }

    return redacted;
}
