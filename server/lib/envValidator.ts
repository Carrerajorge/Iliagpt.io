/**
 * Environment Validator
 * 
 * Validates all required environment variables at startup.
 * Crashes immediately if critical vars are missing.
 */

import { z } from 'zod';

// Define schema for all environment variables
const envSchema = z.object({
    // Required - App will crash without these
    NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
    DATABASE_URL: z.string().min(1, 'DATABASE_URL is required'),

    // Required for core functionality
    SESSION_SECRET: z.string().min(32, 'SESSION_SECRET must be at least 32 characters').optional(),

    // LLM API Keys - At least one required
    XAI_API_KEY: z.string().optional(),
    GEMINI_API_KEY: z.string().optional(),
    OPENAI_API_KEY: z.string().optional(),
    ANTHROPIC_API_KEY: z.string().optional(),
    DEEPSEEK_API_KEY: z.string().optional(),

    // Optional services
    REDIS_URL: z.string().optional(),
    STRIPE_SECRET_KEY: z.string().optional(),
    STRIPE_WEBHOOK_SECRET: z.string().optional(),
    BRAVE_API_KEY: z.string().optional(),
    SEMANTIC_SCHOLAR_API_KEY: z.string().optional(),
    PUBMED_API_KEY: z.string().optional(),

    // Google services
    GOOGLE_CLIENT_ID: z.string().optional(),
    GOOGLE_CLIENT_SECRET: z.string().optional(),

    // Server config
    PORT: z.string().transform(Number).default('5000'),
    LOG_LEVEL: z.enum(['debug', 'info', 'warn', 'error']).default('info'),
});

export type EnvConfig = z.infer<typeof envSchema>;

let validatedEnv: EnvConfig | null = null;

/**
 * Validates environment variables and returns typed config.
 * Throws on critical missing vars.
 */
export function validateEnv(): EnvConfig {
    if (validatedEnv) {
        return validatedEnv;
    }

    const result = envSchema.safeParse(process.env);

    if (!result.success) {
        const errors = result.error.issues.map(issue =>
            `  - ${issue.path.join('.')}: ${issue.message}`
        ).join('\n');

        console.error('❌ Environment validation failed:\n' + errors);

        // In production, crash immediately
        if (process.env.NODE_ENV === 'production') {
            process.exit(1);
        }

        // In development, warn but continue with partial config
        console.warn('⚠️ Continuing with missing env vars in development mode');

        // Create partial config with defaults
        validatedEnv = {
            NODE_ENV: process.env.NODE_ENV as 'development' | 'production' | 'test' || 'development',
            DATABASE_URL: process.env.DATABASE_URL || '',
            PORT: parseInt(process.env.PORT || '5000'),
            LOG_LEVEL: (process.env.LOG_LEVEL as 'debug' | 'info' | 'warn' | 'error') || 'debug',
        } as EnvConfig;

        return validatedEnv;
    }

    validatedEnv = result.data;

    // Validate at least one LLM key is present
    const hasLlmKey = !!(
        result.data.XAI_API_KEY ||
        result.data.GEMINI_API_KEY ||
        result.data.OPENAI_API_KEY ||
        result.data.ANTHROPIC_API_KEY ||
        result.data.DEEPSEEK_API_KEY
    );

    if (!hasLlmKey) {
        console.warn('⚠️ No LLM API key configured. AI features will not work.');
    }

    console.log('✅ Environment validated successfully');

    return validatedEnv;
}

/**
 * Get validated env (throws if not validated yet)
 */
export function getEnv(): EnvConfig {
    if (!validatedEnv) {
        return validateEnv();
    }
    return validatedEnv;
}

/**
 * Check if a specific feature is available based on env
 */
export function hasFeature(feature: 'redis' | 'stripe' | 'google' | 'brave' | 'llm'): boolean {
    const env = getEnv();

    switch (feature) {
        case 'redis':
            return !!env.REDIS_URL;
        case 'stripe':
            return !!(env.STRIPE_SECRET_KEY && env.STRIPE_WEBHOOK_SECRET);
        case 'google':
            return !!(env.GOOGLE_CLIENT_ID && env.GOOGLE_CLIENT_SECRET);
        case 'brave':
            return !!env.BRAVE_API_KEY;
        case 'llm':
            return !!(env.XAI_API_KEY || env.GEMINI_API_KEY || env.OPENAI_API_KEY || env.ANTHROPIC_API_KEY || env.DEEPSEEK_API_KEY);
        default:
            return false;
    }
}
