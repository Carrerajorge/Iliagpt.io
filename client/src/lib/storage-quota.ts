/**
 * Storage Quota Monitoring
 * 
 * Monitors localStorage usage and alerts when approaching limits.
 * Shows warning modal at 80% capacity.
 */

// ============================================================================
// CONFIGURATION
// ============================================================================

const WARNING_THRESHOLD = 0.8; // 80%
const CRITICAL_THRESHOLD = 0.95; // 95%
const CHECK_INTERVAL_MS = 60000; // 1 minute

// ============================================================================
// STORAGE ESTIMATION
// ============================================================================

export interface StorageQuotaInfo {
    used: number;
    available: number;
    total: number;
    usedPercentage: number;
    status: 'ok' | 'warning' | 'critical' | 'unknown';
}

/**
 * Estimate localStorage usage
 */
export function getLocalStorageUsage(): StorageQuotaInfo {
    try {
        let totalSize = 0;

        // Calculate size of all localStorage items
        for (let i = 0; i < localStorage.length; i++) {
            const key = localStorage.key(i);
            if (key) {
                const value = localStorage.getItem(key) || '';
                // Each character is ~2 bytes in JavaScript
                totalSize += (key.length + value.length) * 2;
            }
        }

        // Standard localStorage limit is 5MB (5 * 1024 * 1024 bytes)
        const totalAvailable = 5 * 1024 * 1024;
        const usedPercentage = totalSize / totalAvailable;

        let status: 'ok' | 'warning' | 'critical' | 'unknown' = 'ok';
        if (usedPercentage >= CRITICAL_THRESHOLD) {
            status = 'critical';
        } else if (usedPercentage >= WARNING_THRESHOLD) {
            status = 'warning';
        }

        return {
            used: totalSize,
            available: totalAvailable - totalSize,
            total: totalAvailable,
            usedPercentage: Math.round(usedPercentage * 100),
            status
        };
    } catch (e) {
        return {
            used: 0,
            available: 0,
            total: 0,
            usedPercentage: 0,
            status: 'unknown'
        };
    }
}

/**
 * Get usage breakdown by key prefix
 */
export function getStorageBreakdown(): Record<string, number> {
    const breakdown: Record<string, number> = {};

    try {
        for (let i = 0; i < localStorage.length; i++) {
            const key = localStorage.key(i);
            if (key) {
                const value = localStorage.getItem(key) || '';
                const size = (key.length + value.length) * 2;

                // Group by prefix (first part of key)
                const prefix = key.split('-')[0] || key.split(':')[0] || 'other';
                breakdown[prefix] = (breakdown[prefix] || 0) + size;
            }
        }
    } catch (e) {
        console.warn('[Quota] Failed to get breakdown:', e);
    }

    return breakdown;
}

/**
 * Format bytes to human readable
 */
export function formatBytes(bytes: number): string {
    if (bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
}

// ============================================================================
// MONITORING
// ============================================================================

type QuotaAlertCallback = (info: StorageQuotaInfo) => void;

let alertCallbacks: QuotaAlertCallback[] = [];
let monitorInterval: NodeJS.Timeout | null = null;

/**
 * Subscribe to quota alerts
 */
export function onQuotaAlert(callback: QuotaAlertCallback): () => void {
    alertCallbacks.push(callback);
    return () => {
        alertCallbacks = alertCallbacks.filter(cb => cb !== callback);
    };
}

/**
 * Check quota and trigger alerts if needed
 */
export function checkQuota(): StorageQuotaInfo {
    const info = getLocalStorageUsage();

    if (info.status === 'warning' || info.status === 'critical') {
        alertCallbacks.forEach(cb => cb(info));
    }

    return info;
}

/**
 * Start automatic quota monitoring
 */
export function startQuotaMonitoring(): void {
    if (monitorInterval) return;

    // Initial check
    checkQuota();

    // Periodic checks
    monitorInterval = setInterval(checkQuota, CHECK_INTERVAL_MS);
    console.log('[Quota] Monitoring started');
}

/**
 * Stop quota monitoring
 */
export function stopQuotaMonitoring(): void {
    if (monitorInterval) {
        clearInterval(monitorInterval);
        monitorInterval = null;
        console.log('[Quota] Monitoring stopped');
    }
}

// ============================================================================
// CLEANUP HELPERS
// ============================================================================

/**
 * Get suggestion for freeing up space
 */
export function getCleanupSuggestions(): string[] {
    const suggestions: string[] = [];
    const breakdown = getStorageBreakdown();

    // Sort by size
    const sorted = Object.entries(breakdown).sort((a, b) => b[1] - a[1]);

    if (sorted.length > 0) {
        const largest = sorted[0];
        suggestions.push(`"${largest[0]}" is using ${formatBytes(largest[1])} - consider cleaning old data`);
    }

    suggestions.push('Clear browser cache for old sessions');
    suggestions.push('Export important chats before clearing');

    return suggestions;
}

export default {
    getLocalStorageUsage,
    getStorageBreakdown,
    formatBytes,
    onQuotaAlert,
    checkQuota,
    startQuotaMonitoring,
    stopQuotaMonitoring,
    getCleanupSuggestions
};
