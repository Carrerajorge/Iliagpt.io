import { Progress } from "@/components/ui/progress";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import {
  CheckCircle2,
  Loader2,
  AlertCircle,
  FileCheck,
  Upload,
  Cog,
  X,
  RefreshCw,
} from "lucide-react";

export interface FileUploadProgressProps {
  fileName: string;
  phase: 'validating' | 'uploading' | 'processing' | 'completed' | 'error';
  uploadProgress: number;
  processingProgress: number;
  error?: string;
  onCancel?: () => void;
  onRetry?: () => void;
}

const phaseConfig = {
  validating: {
    icon: FileCheck,
    label: 'Validando archivo...',
    color: 'text-blue-500',
    bgColor: 'bg-blue-500',
  },
  uploading: {
    icon: Upload,
    label: 'Subiendo archivo...',
    color: 'text-primary',
    bgColor: 'bg-primary',
  },
  processing: {
    icon: Cog,
    label: 'Procesando archivo...',
    color: 'text-amber-500',
    bgColor: 'bg-amber-500',
  },
  completed: {
    icon: CheckCircle2,
    label: '¡Completado!',
    color: 'text-green-500',
    bgColor: 'bg-green-500',
  },
  error: {
    icon: AlertCircle,
    label: 'Error',
    color: 'text-destructive',
    bgColor: 'bg-destructive',
  },
};

export function FileUploadProgress({
  fileName,
  phase,
  uploadProgress,
  processingProgress,
  error,
  onCancel,
  onRetry,
}: FileUploadProgressProps) {
  const config = phaseConfig[phase];
  const Icon = config.icon;
  
  const getProgress = () => {
    switch (phase) {
      case 'validating':
        return 0;
      case 'uploading':
        return uploadProgress;
      case 'processing':
        return processingProgress;
      case 'completed':
        return 100;
      case 'error':
        return 0;
      default:
        return 0;
    }
  };

  const isLoading = phase === 'validating' || phase === 'uploading' || phase === 'processing';

  return (
    <div
      className={cn(
        "flex flex-col gap-3 p-4 rounded-lg border transition-all duration-300",
        phase === 'error' ? "border-destructive/50 bg-destructive/5" : "border-border bg-muted/30"
      )}
      data-testid={`upload-progress-${fileName}`}
    >
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3 min-w-0 flex-1">
          <div
            className={cn(
              "flex items-center justify-center w-10 h-10 rounded-full shrink-0",
              phase === 'error' ? "bg-destructive/10" : "bg-primary/10"
            )}
          >
            {isLoading ? (
              <Loader2 className={cn("h-5 w-5 animate-spin", config.color)} />
            ) : (
              <Icon className={cn("h-5 w-5", config.color)} />
            )}
          </div>
          
          <div className="min-w-0 flex-1">
            <p
              className="text-sm font-medium truncate"
              title={fileName}
              data-testid="text-upload-filename"
            >
              {fileName}
            </p>
            <p
              className={cn("text-xs", config.color)}
              data-testid="text-upload-phase"
            >
              {phase === 'error' && error ? error : config.label}
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2 shrink-0">
          {phase === 'error' && onRetry && (
            <Button
              variant="ghost"
              size="sm"
              onClick={onRetry}
              className="h-8 px-2"
              data-testid="button-retry-upload"
            >
              <RefreshCw className="h-4 w-4 mr-1" />
              Reintentar
            </Button>
          )}
          
          {isLoading && onCancel && (
            <Button
              variant="ghost"
              size="icon"
              onClick={onCancel}
              className="h-8 w-8"
              data-testid="button-cancel-upload"
            >
              <X className="h-4 w-4" />
            </Button>
          )}
        </div>
      </div>

      {phase !== 'error' && phase !== 'completed' && (
        <div className="space-y-1">
          <Progress
            value={getProgress()}
            className="h-2"
            data-testid="progress-upload"
          />
          {(phase === 'uploading' || phase === 'processing') && (
            <p className="text-xs text-muted-foreground text-right">
              {getProgress()}%
            </p>
          )}
        </div>
      )}

      {phase === 'completed' && (
        <div className="flex items-center gap-2 text-xs text-green-600">
          <CheckCircle2 className="h-3.5 w-3.5" />
          Archivo subido correctamente
        </div>
      )}
    </div>
  );
}
