/**
 * Database Transactions (#31)
 * Wrapper for consistent transactional operations
 */

import { db } from '../db';
import { PostgresJsDatabase } from 'drizzle-orm/postgres-js';

type TransactionClient = PostgresJsDatabase<any>;

interface TransactionOptions {
    isolationLevel?: 'read uncommitted' | 'read committed' | 'repeatable read' | 'serializable';
    accessMode?: 'read write' | 'read only';
    deferrable?: boolean;
}

/**
 * Execute operations within a transaction
 * Automatically commits on success, rolls back on error
 */
export async function withTransaction<T>(
    fn: (tx: TransactionClient) => Promise<T>,
    options: TransactionOptions = {}
): Promise<T> {
    return db.transaction(async (tx) => {
        try {
            const result = await fn(tx);
            return result;
        } catch (error) {
            console.error('Transaction error, rolling back:', error);
            throw error;
        }
    });
}

/**
 * Execute with automatic retry on serialization failures
 */
export async function withRetryableTransaction<T>(
    fn: (tx: TransactionClient) => Promise<T>,
    options: {
        maxRetries?: number;
        retryDelay?: number;
        onRetry?: (attempt: number, error: Error) => void;
    } = {}
): Promise<T> {
    const { maxRetries = 3, retryDelay = 100, onRetry } = options;
    let lastError: Error | null = null;

    for (let attempt = 1; attempt <= maxRetries; attempt++) {
        try {
            return await withTransaction(fn);
        } catch (error: any) {
            lastError = error;

            // Check for serialization failure (PostgreSQL error code 40001)
            const isSerializationFailure =
                error.code === '40001' ||
                error.message?.includes('could not serialize access');

            if (isSerializationFailure && attempt < maxRetries) {
                onRetry?.(attempt, error);
                await new Promise(resolve => setTimeout(resolve, retryDelay * attempt));
                continue;
            }

            throw error;
        }
    }

    throw lastError;
}

/**
 * Decorator for transactional class methods
 */
export function Transactional(options: TransactionOptions = {}) {
    return function (
        target: any,
        propertyKey: string,
        descriptor: PropertyDescriptor
    ) {
        const originalMethod = descriptor.value;

        descriptor.value = async function (...args: any[]) {
            return withTransaction(async () => {
                return originalMethod.apply(this, args);
            }, options);
        };

        return descriptor;
    };
}

// ============================================
// UNIT OF WORK PATTERN
// ============================================

interface UnitOfWork {
    tx: TransactionClient;
    commit: () => Promise<void>;
    rollback: () => Promise<void>;
}

let pendingUoW: UnitOfWork | null = null;

/**
 * Start a unit of work (manual transaction control)
 */
export async function beginUnitOfWork(): Promise<UnitOfWork> {
    if (pendingUoW) {
        throw new Error('A unit of work is already in progress');
    }

    let resolveCommit: () => void;
    let rejectRollback: (error: Error) => void;

    const transactionPromise = new Promise<void>((resolve, reject) => {
        resolveCommit = resolve;
        rejectRollback = reject;
    });

    // Start transaction in background
    db.transaction(async (tx) => {
        pendingUoW = {
            tx,
            commit: async () => {
                pendingUoW = null;
                resolveCommit!();
            },
            rollback: async () => {
                pendingUoW = null;
                rejectRollback!(new Error('Transaction rolled back'));
            },
        };

        await transactionPromise;
    }).catch(() => {
        // Transaction was rolled back
    });

    // Wait for transaction to be ready
    await new Promise(resolve => setTimeout(resolve, 10));

    if (!pendingUoW) {
        throw new Error('Failed to start unit of work');
    }

    return pendingUoW;
}

// ============================================
// REPOSITORY BASE
// ============================================

export abstract class BaseRepository<T extends { id: string | number }> {
    constructor(protected table: any) { }

    async findById(id: T['id'], tx?: TransactionClient): Promise<T | null> {
        const client = tx || db;
        const results = await (client as any)
            .select()
            .from(this.table)
            .where((t: any) => t.id.equals(id))
            .limit(1);
        return results[0] || null;
    }

    async create(data: Omit<T, 'id'>, tx?: TransactionClient): Promise<T> {
        const client = tx || db;
        const [result] = await (client as any)
            .insert(this.table)
            .values(data)
            .returning();
        return result;
    }

    async update(id: T['id'], data: Partial<T>, tx?: TransactionClient): Promise<T | null> {
        const client = tx || db;
        const [result] = await (client as any)
            .update(this.table)
            .set({ ...data, updatedAt: new Date() })
            .where((t: any) => t.id.equals(id))
            .returning();
        return result || null;
    }

    async delete(id: T['id'], tx?: TransactionClient): Promise<boolean> {
        const client = tx || db;
        const result = await (client as any)
            .delete(this.table)
            .where((t: any) => t.id.equals(id));
        return result.rowCount > 0;
    }

    async findAll(options?: {
        limit?: number;
        offset?: number;
        orderBy?: string;
        order?: 'asc' | 'desc';
    }, tx?: TransactionClient): Promise<T[]> {
        const client = tx || db;
        let query = (client as any).select().from(this.table);

        if (options?.orderBy) {
            query = query.orderBy((t: any) =>
                options.order === 'asc' ? t[options.orderBy!].asc() : t[options.orderBy!].desc()
            );
        }

        if (options?.limit) {
            query = query.limit(options.limit);
        }

        if (options?.offset) {
            query = query.offset(options.offset);
        }

        return query;
    }

    async count(tx?: TransactionClient): Promise<number> {
        const client = tx || db;
        const result = await (client as any)
            .select({ count: (t: any) => t.id.count() })
            .from(this.table);
        return result[0]?.count || 0;
    }

    async exists(id: T['id'], tx?: TransactionClient): Promise<boolean> {
        const result = await this.findById(id, tx);
        return result !== null;
    }

    /**
     * Execute operation within transaction
     */
    async inTransaction<R>(fn: (tx: TransactionClient) => Promise<R>): Promise<R> {
        return withTransaction(fn);
    }
}
