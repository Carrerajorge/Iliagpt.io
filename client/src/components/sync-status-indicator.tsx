/**
 * Sync Status Indicator Component
 * 
 * Displays the current synchronization state of chat messages:
 * - idle: No pending operations
 * - saving: Currently saving to server
 * - saved: Successfully saved (shows briefly)
 * - error: Save failed
 * - retrying: Retrying failed saves
 */

import { useState, useEffect } from "react";
import { Cloud, CloudOff, Check, Loader2, AlertCircle } from "lucide-react";
import { getSyncStatus, subscribeSyncStatus, getRetryQueueSize, type SyncStatus } from "@/hooks/use-chats";
import { cn } from "@/lib/utils";

interface SyncStatusIndicatorProps {
    className?: string;
    showLabel?: boolean;
}

export function SyncStatusIndicator({ className, showLabel = true }: SyncStatusIndicatorProps) {
    const [status, setStatus] = useState<SyncStatus>(getSyncStatus());
    const [retryCount, setRetryCount] = useState(0);

    useEffect(() => {
        const unsubscribe = subscribeSyncStatus((newStatus) => {
            setStatus(newStatus);
            setRetryCount(getRetryQueueSize());
        });

        // Initial sync
        setStatus(getSyncStatus());
        setRetryCount(getRetryQueueSize());

        return unsubscribe;
    }, []);

    const getStatusConfig = () => {
        switch (status) {
            case 'saving':
                return {
                    icon: <Loader2 className="h-3.5 w-3.5 animate-spin" />,
                    label: 'Guardando...',
                    color: 'text-blue-500',
                };
            case 'saved':
                return {
                    icon: <Check className="h-3.5 w-3.5" />,
                    label: 'Guardado',
                    color: 'text-green-500',
                };
            case 'error':
                return {
                    icon: <CloudOff className="h-3.5 w-3.5" />,
                    label: 'Error al guardar',
                    color: 'text-red-500',
                };
            case 'retrying':
                return {
                    icon: <AlertCircle className="h-3.5 w-3.5 animate-pulse" />,
                    label: `Reintentando (${retryCount})`,
                    color: 'text-yellow-500',
                };
            case 'idle':
            default:
                return {
                    icon: <Cloud className="h-3.5 w-3.5" />,
                    label: 'Sincronizado',
                    color: 'text-muted-foreground',
                };
        }
    };

    const config = getStatusConfig();

    // Don't show indicator when idle
    if (status === 'idle') {
        return null;
    }

    return (
        <div
            className={cn(
                "flex items-center gap-1.5 px-2 py-1 rounded-full text-xs font-medium transition-all duration-300",
                status === 'saving' && "bg-blue-100 dark:bg-blue-900/30 text-blue-600 dark:text-blue-400",
                status === 'saved' && "bg-green-100 dark:bg-green-900/30 text-green-600 dark:text-green-400",
                status === 'error' && "bg-red-100 dark:bg-red-900/30 text-red-600 dark:text-red-400",
                status === 'retrying' && "bg-yellow-100 dark:bg-yellow-900/30 text-yellow-600 dark:text-yellow-400",
                className
            )}
            title={config.label}
            data-testid="sync-status-indicator"
        >
            {config.icon}
            {showLabel && <span className="text-[11px]">{config.label}</span>}
        </div>
    );
}

export default SyncStatusIndicator;
