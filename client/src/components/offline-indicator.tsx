import { useOnlineStatus } from '../hooks/use-online-status';
import { WifiOff, Wifi, CloudOff, RefreshCw, AlertCircle } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';

interface OfflineIndicatorProps {
  pendingCount?: number;
  failedCount?: number;
  isSyncing?: boolean;
  onRetry?: () => void;
  className?: string;
}

export function OfflineIndicator({ 
  pendingCount = 0, 
  failedCount = 0,
  isSyncing = false, 
  onRetry,
  className 
}: OfflineIndicatorProps) {
  const { isOnline } = useOnlineStatus();

  if (isOnline && pendingCount === 0 && !isSyncing && failedCount === 0) {
    return null;
  }

  return (
    <div
      className={cn(
        'flex items-center gap-2 px-3 py-1.5 rounded-full text-xs font-medium transition-all',
        !isOnline
          ? 'bg-yellow-500/20 text-yellow-600 dark:text-yellow-400 border border-yellow-500/30'
          : isSyncing
          ? 'bg-blue-500/20 text-blue-600 dark:text-blue-400 border border-blue-500/30'
          : failedCount > 0
          ? 'bg-red-500/20 text-red-600 dark:text-red-400 border border-red-500/30'
          : pendingCount > 0
          ? 'bg-orange-500/20 text-orange-600 dark:text-orange-400 border border-orange-500/30'
          : '',
        className
      )}
      data-testid="offline-indicator"
    >
      {!isOnline ? (
        <>
          <WifiOff className="w-3.5 h-3.5" />
          <span>Sin conexión</span>
          {pendingCount > 0 && (
            <span className="bg-yellow-500/30 px-1.5 py-0.5 rounded-full">
              {pendingCount}
            </span>
          )}
        </>
      ) : isSyncing ? (
        <>
          <RefreshCw className="w-3.5 h-3.5 animate-spin" />
          <span>Sincronizando...</span>
        </>
      ) : failedCount > 0 ? (
        <>
          <AlertCircle className="w-3.5 h-3.5" />
          <span>{failedCount} fallidos</span>
          {onRetry && (
            <Button
              variant="ghost"
              size="sm"
              className="h-5 px-1.5 text-xs"
              onClick={onRetry}
              data-testid="button-retry-failed"
            >
              Reintentar
            </Button>
          )}
        </>
      ) : pendingCount > 0 ? (
        <>
          <CloudOff className="w-3.5 h-3.5" />
          <span>{pendingCount} pendientes</span>
        </>
      ) : null}
    </div>
  );
}

export function OfflineBanner() {
  const { isOnline } = useOnlineStatus();

  if (isOnline) return null;

  return (
    <div
      className="fixed top-0 left-0 right-0 bg-yellow-500 text-yellow-950 text-center py-2 text-sm font-medium z-50 flex items-center justify-center gap-2"
      data-testid="offline-banner"
    >
      <WifiOff className="w-4 h-4" />
      Sin conexión - Los mensajes se guardarán y enviarán cuando vuelvas a conectarte
    </div>
  );
}

export function ConnectionStatus() {
  const { isOnline } = useOnlineStatus();

  return (
    <div
      className={cn(
        'flex items-center gap-1.5 text-xs',
        isOnline ? 'text-green-600 dark:text-green-400' : 'text-yellow-600 dark:text-yellow-400'
      )}
      data-testid="connection-status"
    >
      {isOnline ? (
        <>
          <Wifi className="w-3 h-3" />
          <span>Conectado</span>
        </>
      ) : (
        <>
          <WifiOff className="w-3 h-3" />
          <span>Sin conexión</span>
        </>
      )}
    </div>
  );
}

interface ConnectionDotProps {
  className?: string;
  showLabel?: boolean;
}

export function ConnectionDot({ className, showLabel = false }: ConnectionDotProps) {
  const { isOnline } = useOnlineStatus();

  return (
    <div
      className={cn('flex items-center gap-1.5', className)}
      data-testid="connection-dot"
      title={isOnline ? 'Online' : 'Offline'}
    >
      <span
        className={cn(
          'w-2 h-2 rounded-full transition-colors duration-300',
          isOnline 
            ? 'bg-green-500 shadow-[0_0_6px_rgba(34,197,94,0.5)]' 
            : 'bg-red-500 shadow-[0_0_6px_rgba(239,68,68,0.5)] animate-pulse'
        )}
      />
      {showLabel && (
        <span className={cn(
          'text-xs',
          isOnline ? 'text-green-600 dark:text-green-400' : 'text-red-600 dark:text-red-400'
        )}>
          {isOnline ? 'Online' : 'Offline'}
        </span>
      )}
    </div>
  );
}
