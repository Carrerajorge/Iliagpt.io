import { STREAM_STATUS, StreamStatus } from '@/hooks/useExcelStreaming';
import { Pause, Play, X, Sparkles, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Progress } from '@/components/ui/progress';
import { getColumnName } from '@/lib/sparseGrid';

interface StreamingIndicatorProps {
  status: StreamStatus;
  progress: { current: number; total: number };
  activeCell: { row: number; col: number } | null;
  onPause: () => void;
  onResume: () => void;
  onCancel: () => void;
}

export function StreamingIndicator({
  status,
  progress,
  activeCell,
  onPause,
  onResume,
  onCancel
}: StreamingIndicatorProps) {
  if (status === STREAM_STATUS.IDLE || status === STREAM_STATUS.COMPLETED) {
    return null;
  }

  const progressPercent = progress.total > 0 
    ? Math.round((progress.current / progress.total) * 100) 
    : 0;

  return (
    <div className="streaming-indicator absolute bottom-4 left-1/2 transform -translate-x-1/2 z-50 
                    bg-white dark:bg-gray-900 rounded-xl shadow-2xl border border-gray-200 
                    dark:border-gray-700 p-4 min-w-[320px] animate-slide-up">
      <div className="flex items-center gap-3 mb-3">
        <div className="relative">
          <div className="w-10 h-10 rounded-full bg-gradient-to-r from-blue-500 to-purple-500 
                          flex items-center justify-center">
            {status === STREAM_STATUS.CONNECTING ? (
              <Loader2 className="w-5 h-5 text-white animate-spin" />
            ) : status === STREAM_STATUS.PAUSED ? (
              <Pause className="w-5 h-5 text-white" />
            ) : (
              <Sparkles className="w-5 h-5 text-white animate-pulse" />
            )}
          </div>
          {status === STREAM_STATUS.STREAMING && (
            <div className="absolute inset-0 rounded-full bg-blue-400 animate-ping opacity-30" />
          )}
        </div>
        
        <div className="flex-1">
          <p className="font-medium text-sm text-gray-900 dark:text-white">
            {status === STREAM_STATUS.CONNECTING && 'Conectando con IA...'}
            {status === STREAM_STATUS.STREAMING && 'IA escribiendo en el documento'}
            {status === STREAM_STATUS.PAUSED && 'Streaming pausado'}
            {status === STREAM_STATUS.ERROR && 'Error en streaming'}
          </p>
          {activeCell && (
            <p className="text-xs text-gray-500 dark:text-gray-400">
              Celda actual: <span className="font-mono font-semibold text-blue-600 dark:text-blue-400">
                {getColumnName(activeCell.col)}{activeCell.row + 1}
              </span>
            </p>
          )}
        </div>
      </div>

      <div className="mb-3">
        <Progress value={progressPercent} className="h-2" />
        <p className="text-xs text-gray-500 dark:text-gray-400 mt-1 text-right">
          {progress.current} / {progress.total} celdas ({progressPercent}%)
        </p>
      </div>

      <div className="flex gap-2 justify-end">
        {status === STREAM_STATUS.STREAMING && (
          <Button 
            size="sm" 
            variant="outline" 
            onClick={onPause}
            className="gap-1"
            data-testid="button-pause-streaming"
          >
            <Pause className="w-3 h-3" />
            Pausar
          </Button>
        )}
        {status === STREAM_STATUS.PAUSED && (
          <Button 
            size="sm" 
            variant="outline" 
            onClick={onResume}
            className="gap-1"
            data-testid="button-resume-streaming"
          >
            <Play className="w-3 h-3" />
            Continuar
          </Button>
        )}
        <Button 
          size="sm" 
          variant="destructive" 
          onClick={onCancel}
          className="gap-1"
          data-testid="button-cancel-streaming"
        >
          <X className="w-3 h-3" />
          Cancelar
        </Button>
      </div>
    </div>
  );
}
