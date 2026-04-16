/**
 * Environment Validation (#26)
 * Fail-fast validation of required environment variables at startup
 */

import { z } from 'zod';

// ============================================
// SCHEMA DEFINITIONS
// ============================================

const DatabaseEnvSchema = z.object({
    DATABASE_URL: z.string().url('DATABASE_URL must be a valid URL'),
});

const AuthEnvSchema = z.object({
    JWT_ACCESS_SECRET: z.string().min(32, 'JWT_ACCESS_SECRET must be at least 32 characters'),
    JWT_REFRESH_SECRET: z.string().min(32, 'JWT_REFRESH_SECRET must be at least 32 characters'),
    SESSION_SECRET: z.string().min(32, 'SESSION_SECRET must be at least 32 characters').optional(),
});

const LLMEnvSchema = z.object({
    XAI_API_KEY: z.string().min(1, 'XAI_API_KEY is required').optional(),
    GOOGLE_API_KEY: z.string().min(1, 'GOOGLE_API_KEY is required').optional(),
    ANTHROPIC_API_KEY: z.string().min(1, 'ANTHROPIC_API_KEY is required').optional(),
    OPENAI_API_KEY: z.string().min(1, 'OPENAI_API_KEY is required').optional(),
}).refine(
    (data) => data.XAI_API_KEY || data.GOOGLE_API_KEY || data.ANTHROPIC_API_KEY || data.OPENAI_API_KEY,
    'At least one LLM API key must be configured'
);

const EncryptionEnvSchema = z.object({
    ENCRYPTION_KEY: z.string()
        .length(64, 'ENCRYPTION_KEY must be exactly 64 hex characters (32 bytes)')
        .regex(/^[a-fA-F0-9]+$/, 'ENCRYPTION_KEY must be hexadecimal')
        .optional(),
    // Back-compat: allow using TOKEN_ENCRYPTION_KEY as the primary secret.
    TOKEN_ENCRYPTION_KEY: z.string().min(32, 'TOKEN_ENCRYPTION_KEY must be at least 32 characters').optional(),
}).refine(
    (data) => {
        if (process.env.NODE_ENV !== 'production') return true;
        return !!(data.ENCRYPTION_KEY || data.TOKEN_ENCRYPTION_KEY);
    },
    'In production, ENCRYPTION_KEY or TOKEN_ENCRYPTION_KEY must be set'
);

const PushNotificationsEnvSchema = z.object({
    VAPID_PUBLIC_KEY: z.string().optional(),
    VAPID_PRIVATE_KEY: z.string().optional(),
    VAPID_SUBJECT: z.string().email().optional(),
}).refine(
    (data) => {
        const hasAll = data.VAPID_PUBLIC_KEY && data.VAPID_PRIVATE_KEY && data.VAPID_SUBJECT;
        const hasNone = !data.VAPID_PUBLIC_KEY && !data.VAPID_PRIVATE_KEY && !data.VAPID_SUBJECT;
        return hasAll || hasNone;
    },
    'VAPID keys must all be set or all be unset'
);

const RedisEnvSchema = z.object({
    REDIS_URL: z.string().url().optional(),
    UPSTASH_REDIS_REST_URL: z.string().url().optional(),
    UPSTASH_REDIS_REST_TOKEN: z.string().optional(),
});

const ServerEnvSchema = z.object({
    NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
    PORT: z.string().transform(Number).pipe(z.number().int().positive()).default('5000'),
    HOST: z.string().default('0.0.0.0'),
    LOG_LEVEL: z.enum(['debug', 'info', 'warn', 'error']).default('info'),
});

const FeatureFlagsEnvSchema = z.object({
    ENABLE_MFA: z.string().transform(v => v === 'true').default('false'),
    ENABLE_PUSH_NOTIFICATIONS: z.string().transform(v => v === 'true').default('false'),
    ENABLE_GOOGLE_DRIVE: z.string().transform(v => v === 'true').default('false'),
    ENABLE_PRODUCTION_MODE: z.string().transform(v => v === 'true').default('true'),
});

// Combined schema
const EnvSchema = z.object({})
    .merge(ServerEnvSchema)
    .merge(DatabaseEnvSchema)
    .merge(AuthEnvSchema)
    .merge(EncryptionEnvSchema)
    .merge(FeatureFlagsEnvSchema)
    .and(LLMEnvSchema)
    .and(PushNotificationsEnvSchema)
    .and(RedisEnvSchema);

export type Env = z.infer<typeof EnvSchema>;

// ============================================
// VALIDATION
// ============================================

let validatedEnv: Env | null = null;

export function validateEnv(): Env {
    if (validatedEnv) return validatedEnv;

    console.log('🔍 Validating environment variables...');

    const result = EnvSchema.safeParse(process.env);

    if (!result.success) {
        console.error('\n❌ Environment validation failed!\n');

        const errors = result.error.flatten();

        // Field errors
        for (const [field, messages] of Object.entries(errors.fieldErrors)) {
            console.error(`  ${field}:`);
            messages?.forEach(msg => console.error(`    - ${msg}`));
        }

        // Form errors (from refinements)
        if (errors.formErrors.length > 0) {
            console.error('\n  Configuration errors:');
            errors.formErrors.forEach(msg => console.error(`    - ${msg}`));
        }

        console.error('\n  Please check your .env file and fix the issues above.\n');

        // In production, crash immediately
        if (process.env.NODE_ENV === 'production') {
            process.exit(1);
        }

        throw new Error('Environment validation failed');
    }

    validatedEnv = result.data;
    console.log('✅ Environment validated successfully\n');

    // Log configuration summary (non-sensitive)
    console.log('Configuration:');
    console.log(`  - Environment: ${validatedEnv.NODE_ENV}`);
    console.log(`  - Port: ${validatedEnv.PORT}`);
    console.log(`  - LLM APIs: ${[
        validatedEnv.XAI_API_KEY && 'Grok',
        validatedEnv.GOOGLE_API_KEY && 'Gemini',
        validatedEnv.ANTHROPIC_API_KEY && 'Anthropic',
    ].filter(Boolean).join(', ') || 'None configured!'}`);
    console.log(`  - Redis: ${validatedEnv.REDIS_URL || validatedEnv.UPSTASH_REDIS_REST_URL ? 'Configured' : 'Not configured'}`);
    console.log(`  - MFA: ${validatedEnv.ENABLE_MFA ? 'Enabled' : 'Disabled'}`);
    console.log(`  - Push Notifications: ${validatedEnv.ENABLE_PUSH_NOTIFICATIONS ? 'Enabled' : 'Disabled'}`);
    console.log('');

    return validatedEnv;
}

/**
 * Get validated env (throws if not validated)
 */
export function getEnv(): Env {
    if (!validatedEnv) {
        throw new Error('Environment not validated. Call validateEnv() first.');
    }
    return validatedEnv;
}

/**
 * Check if a specific feature is enabled
 */
export function isFeatureEnabled(feature: keyof typeof FeatureFlagsEnvSchema.shape): boolean {
    const env = getEnv();
    const key = feature as keyof Env;
    return env[key] === true;
}

/**
 * Get required env variable (throws if missing)
 */
export function requireEnv(key: string): string {
    const value = process.env[key];
    if (!value) {
        throw new Error(`Required environment variable ${key} is not set`);
    }
    return value;
}

/**
 * Get optional env variable with default
 */
export function getEnvOrDefault(key: string, defaultValue: string): string {
    return process.env[key] || defaultValue;
}

/**
 * Generate .env.example from schema
 */
export function generateEnvExample(): string {
    const lines = [
        '# ILIAGPT Environment Configuration',
        '# Copy this file to .env and fill in your values',
        '',
        '# Server',
        'NODE_ENV=development',
        'PORT=5000',
        'HOST=0.0.0.0',
        'LOG_LEVEL=info',
        '',
        '# Database (Required)',
        'DATABASE_URL=postgresql://user:password@localhost:5432/iliagpt',
        '',
        '# Authentication (Required)',
        'JWT_ACCESS_SECRET=your-32-char-minimum-access-secret',
        'JWT_REFRESH_SECRET=your-32-char-minimum-refresh-secret',
        '',
        '# Encryption (Optional but recommended)',
        '# Generate with: node -e "console.log(require(\'crypto\').randomBytes(32).toString(\'hex\'))"',
        'ENCRYPTION_KEY=',
        '',
        '# LLM APIs (At least one required)',
        'XAI_API_KEY=',
        'GOOGLE_API_KEY=',
        'ANTHROPIC_API_KEY=',
        '',
        '# Redis (Optional)',
        'REDIS_URL=',
        '',
        '# Push Notifications (Optional, all or none)',
        'VAPID_PUBLIC_KEY=',
        'VAPID_PRIVATE_KEY=',
        'VAPID_SUBJECT=mailto:admin@example.com',
        '',
        '# Feature Flags',
        'ENABLE_MFA=false',
        'ENABLE_PUSH_NOTIFICATIONS=false',
        'ENABLE_GOOGLE_DRIVE=false',
        'ENABLE_PRODUCTION_MODE=true',
    ];

    return lines.join('\n');
}
