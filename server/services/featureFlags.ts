/**
 * Feature Flags (#97)
 * Dynamic feature toggle system without redeploys
 */

import { EventEmitter } from 'events';

// ============================================
// TYPES
// ============================================

interface FeatureFlag {
    key: string;
    name: string;
    description: string;
    enabled: boolean;
    rolloutPercentage: number; // 0-100
    enabledForUsers: number[];
    disabledForUsers: number[];
    enabledForRoles: string[];
    conditions: FeatureCondition[];
    createdAt: Date;
    updatedAt: Date;
    metadata?: Record<string, any>;
}

interface FeatureCondition {
    field: string;
    operator: 'eq' | 'neq' | 'gt' | 'lt' | 'contains' | 'in';
    value: any;
}

interface EvaluationContext {
    userId?: number;
    userRole?: string;
    userEmail?: string;
    userCreatedAt?: Date;
    environment?: string;
    platform?: string;
    version?: string;
    [key: string]: any;
}

// ============================================
// FEATURE FLAG STORE
// ============================================

class FeatureFlagStore extends EventEmitter {
    private flags = new Map<string, FeatureFlag>();
    private userCache = new Map<string, Map<string, boolean>>(); // userId -> flag -> result
    private cacheTimeout = 60000; // 1 minute

    constructor() {
        super();
        this.initializeDefaultFlags();
    }

    private initializeDefaultFlags(): void {
        const defaults: Partial<FeatureFlag>[] = [
            {
                key: 'mfa_enabled',
                name: 'Multi-Factor Authentication',
                description: 'Enable 2FA/MFA for user accounts',
                enabled: false,
                rolloutPercentage: 0,
            },
            {
                key: 'production_mode',
                name: 'Production Mode (Agentic)',
                description: 'Enable agentic document production mode',
                enabled: true,
                rolloutPercentage: 100,
            },
            {
                key: 'push_notifications',
                name: 'Push Notifications',
                description: 'Browser push notifications for messages',
                enabled: false,
                rolloutPercentage: 0,
            },
            {
                key: 'google_drive_integration',
                name: 'Google Drive Integration',
                description: 'Allow syncing with Google Drive',
                enabled: false,
                rolloutPercentage: 0,
            },
            {
                key: 'new_chat_ui',
                name: 'New Chat Interface',
                description: 'Experimental new chat UI',
                enabled: false,
                rolloutPercentage: 10,
            },
            {
                key: 'advanced_research',
                name: 'Advanced Research Mode',
                description: 'Enhanced academic research with multiple sources',
                enabled: true,
                rolloutPercentage: 100,
            },
            {
                key: 'collaborative_editing',
                name: 'Collaborative Editing',
                description: 'Real-time collaborative document editing',
                enabled: false,
                rolloutPercentage: 0,
            },
        ];

        for (const def of defaults) {
            this.createFlag({
                key: def.key!,
                name: def.name!,
                description: def.description!,
                enabled: def.enabled ?? false,
                rolloutPercentage: def.rolloutPercentage ?? 0,
                enabledForUsers: [],
                disabledForUsers: [],
                enabledForRoles: [],
                conditions: [],
                createdAt: new Date(),
                updatedAt: new Date(),
            });
        }
    }

    createFlag(flag: FeatureFlag): void {
        this.flags.set(flag.key, flag);
        this.emit('flag:created', flag);
    }

    updateFlag(key: string, updates: Partial<FeatureFlag>): FeatureFlag | null {
        const flag = this.flags.get(key);
        if (!flag) return null;

        const updated = {
            ...flag,
            ...updates,
            updatedAt: new Date(),
        };

        this.flags.set(key, updated);
        this.clearCache();
        this.emit('flag:updated', updated);

        return updated;
    }

    getFlag(key: string): FeatureFlag | null {
        return this.flags.get(key) || null;
    }

    getAllFlags(): FeatureFlag[] {
        return Array.from(this.flags.values());
    }

    deleteFlag(key: string): boolean {
        const deleted = this.flags.delete(key);
        if (deleted) {
            this.clearCache();
            this.emit('flag:deleted', key);
        }
        return deleted;
    }

    private clearCache(): void {
        this.userCache.clear();
    }

    /**
     * Evaluate a flag for a context
     */
    evaluate(key: string, context: EvaluationContext = {}): boolean {
        const flag = this.flags.get(key);
        if (!flag) return false;

        // Check global enabled
        if (!flag.enabled) return false;

        // Check user-specific overrides
        if (context.userId) {
            if (flag.disabledForUsers.includes(context.userId)) return false;
            if (flag.enabledForUsers.includes(context.userId)) return true;
        }

        // Check role-based
        if (context.userRole && flag.enabledForRoles.length > 0) {
            if (!flag.enabledForRoles.includes(context.userRole)) return false;
        }

        // Check conditions
        for (const condition of flag.conditions) {
            if (!this.evaluateCondition(condition, context)) {
                return false;
            }
        }

        // Percentage rollout (deterministic based on userId)
        if (flag.rolloutPercentage < 100 && context.userId) {
            const hash = this.hashUserId(context.userId, key);
            const bucket = hash % 100;
            if (bucket >= flag.rolloutPercentage) {
                return false;
            }
        }

        return true;
    }

    private evaluateCondition(condition: FeatureCondition, context: EvaluationContext): boolean {
        const value = context[condition.field];
        if (value === undefined) return false;

        switch (condition.operator) {
            case 'eq': return value === condition.value;
            case 'neq': return value !== condition.value;
            case 'gt': return value > condition.value;
            case 'lt': return value < condition.value;
            case 'contains': return String(value).includes(condition.value);
            case 'in': return Array.isArray(condition.value) && condition.value.includes(value);
            default: return false;
        }
    }

    private hashUserId(userId: number, flagKey: string): number {
        const str = `${userId}:${flagKey}`;
        let hash = 0;
        for (let i = 0; i < str.length; i++) {
            const char = str.charCodeAt(i);
            hash = ((hash << 5) - hash) + char;
            hash = hash & hash; // Convert to 32-bit integer
        }
        return Math.abs(hash);
    }

    /**
     * Check flag with caching
     */
    isEnabled(key: string, context: EvaluationContext = {}): boolean {
        // Check cache
        if (context.userId) {
            const userFlags = this.userCache.get(String(context.userId));
            if (userFlags?.has(key)) {
                return userFlags.get(key)!;
            }
        }

        const result = this.evaluate(key, context);

        // Cache result
        if (context.userId) {
            if (!this.userCache.has(String(context.userId))) {
                this.userCache.set(String(context.userId), new Map());

                // Clear cache after timeout
                setTimeout(() => {
                    this.userCache.delete(String(context.userId));
                }, this.cacheTimeout);
            }
            this.userCache.get(String(context.userId))!.set(key, result);
        }

        return result;
    }
}

// Singleton
export const featureFlags = new FeatureFlagStore();

// ============================================
// EXPRESS ROUTER
// ============================================

import { Router, Request, Response } from 'express';

export function createFeatureFlagRouter(): Router {
    const router = Router();

    // Get all flags (admin)
    router.get('/', (req: Request, res: Response) => {
        res.json(featureFlags.getAllFlags());
    });

    // Get flags for current user
    router.get('/me', (req: Request, res: Response) => {
        const userId = (req as any).user?.id;
        const userRole = (req as any).user?.role;

        const context: EvaluationContext = {
            userId,
            userRole,
            environment: process.env.NODE_ENV,
        };

        const flags = featureFlags.getAllFlags();
        const result: Record<string, boolean> = {};

        for (const flag of flags) {
            result[flag.key] = featureFlags.isEnabled(flag.key, context);
        }

        res.json(result);
    });

    // Check specific flag
    router.get('/check/:key', (req: Request, res: Response) => {
        const { key } = req.params;
        const userId = (req as any).user?.id;
        const userRole = (req as any).user?.role;

        const enabled = featureFlags.isEnabled(key, { userId, userRole });
        res.json({ key, enabled });
    });

    // Update flag (admin)
    router.patch('/:key', (req: Request, res: Response) => {
        const { key } = req.params;
        const updates = req.body;

        const updated = featureFlags.updateFlag(key, updates);
        if (!updated) {
            return res.status(404).json({ error: 'Flag not found' });
        }

        res.json(updated);
    });

    // Create flag (admin)
    router.post('/', (req: Request, res: Response) => {
        const flag: FeatureFlag = {
            ...req.body,
            createdAt: new Date(),
            updatedAt: new Date(),
        };

        featureFlags.createFlag(flag);
        res.status(201).json(flag);
    });

    return router;
}

// ============================================
// MIDDLEWARE
// ============================================

export function requireFeature(flagKey: string) {
    return (req: any, res: any, next: any) => {
        const context: EvaluationContext = {
            userId: req.user?.id,
            userRole: req.user?.role,
            environment: process.env.NODE_ENV,
        };

        if (!featureFlags.isEnabled(flagKey, context)) {
            return res.status(403).json({
                error: 'Feature not available',
                code: 'FEATURE_DISABLED',
                feature: flagKey,
            });
        }

        next();
    };
}

// ============================================
// CLIENT HOOK
// ============================================

export function useFeatureFlag(key: string, userId?: number): boolean {
    return featureFlags.isEnabled(key, { userId });
}
