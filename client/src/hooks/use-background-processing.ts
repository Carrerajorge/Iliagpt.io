import { useState, useEffect, useRef, useCallback } from 'react';
import { TaskPersistenceService, type BackgroundTask } from '../lib/taskPersistenceService';
import { TabCoordinator } from '../lib/tabCoordinator';
import { WORKER_CODE } from '../lib/backgroundWorkerCode';
import { useSettingsContext } from '@/contexts/SettingsContext';
import { channelIncludesPush, isWithinQuietHours } from '@/lib/notification-preferences';

export type ProcessingStatus = 'idle' | 'initializing' | 'processing' | 'paused' | 'completed' | 'error';

export interface ProcessingProgress {
  current: number;
  total: number;
  percent: number;
}

export interface ProcessingStats {
  rate: number;
  eta: number;
  elapsed: number;
}

export interface CellUpdateData {
  row: number;
  col: number;
  value: any;
  formula?: string;
  format?: Record<string, any>;
}

export interface SheetCreatedData {
  sheetId: string;
  name: string;
}

export interface ChartCreatedData {
  chartId: string;
  chartType: string;
  dataRange: string;
  options: Record<string, any>;
}

export interface UseBackgroundProcessingOptions {
  onCellUpdate?: (data: CellUpdateData) => void;
  onSheetCreated?: (data: SheetCreatedData) => void;
  onChartCreated?: (data: ChartCreatedData) => void;
  onComplete?: (payload: { total: number; elapsed: number; rate: number; results: any[] }) => void;
  onError?: (error: string) => void;
  onProgress?: (progress: ProcessingProgress) => void;
  autoRecover?: boolean;
}

export interface UseBackgroundProcessingReturn {
  status: ProcessingStatus;
  progress: ProcessingProgress;
  stats: ProcessingStats;
  isPageVisible: boolean;
  isLeader: boolean;
  isProcessing: boolean;
  isPaused: boolean;
  startProcessing: (tasks: BackgroundTask[]) => Promise<boolean>;
  addTasks: (tasks: BackgroundTask[]) => Promise<boolean>;
  pause: () => void;
  resume: () => void;
  cancel: () => Promise<void>;
  getStatus: () => void;
  flushPendingUpdates: () => void;
}

export function useBackgroundProcessing(options: UseBackgroundProcessingOptions = {}): UseBackgroundProcessingReturn {
  const {
    onCellUpdate,
    onSheetCreated,
    onChartCreated,
    onComplete,
    onError,
    onProgress,
    autoRecover = true
  } = options;

  const { settings } = useSettingsContext();

  const [status, setStatus] = useState<ProcessingStatus>('idle');
  const [progress, setProgress] = useState<ProcessingProgress>({ current: 0, total: 0, percent: 0 });
  const [isPageVisible, setIsPageVisible] = useState(true);
  const [isLeader, setIsLeader] = useState(false);
  const [stats, setStats] = useState<ProcessingStats>({ rate: 0, eta: 0, elapsed: 0 });

  const workerRef = useRef<Worker | null>(null);
  const persistenceRef = useRef<TaskPersistenceService | null>(null);
  const coordinatorRef = useRef<TabCoordinator | null>(null);
  const pendingUpdatesRef = useRef<any[]>([]);
  const callbacksRef = useRef({ onCellUpdate, onComplete, onError, onProgress, onSheetCreated, onChartCreated });

  useEffect(() => {
    callbacksRef.current = { onCellUpdate, onComplete, onError, onProgress, onSheetCreated, onChartCreated };
  }, [onCellUpdate, onComplete, onError, onProgress, onSheetCreated, onChartCreated]);

  const applyResult = useCallback((result: any) => {
    if (!result) return;

    switch (result.type) {
      case 'CELL_UPDATE':
        callbacksRef.current.onCellUpdate?.({
          row: result.row,
          col: result.col,
          value: result.value,
          formula: result.formula,
          format: result.format
        });
        break;

      case 'BULK_UPDATE':
        result.cells?.forEach((cell: CellUpdateData) => {
          callbacksRef.current.onCellUpdate?.(cell);
        });
        break;

      case 'SHEET_CREATED':
        callbacksRef.current.onSheetCreated?.(result);
        break;

      case 'CHART_CREATED':
        callbacksRef.current.onChartCreated?.(result);
        break;
    }
  }, []);

  const flushPendingUpdates = useCallback(() => {
    if (pendingUpdatesRef.current.length === 0) return;

    console.log(`Aplicando ${pendingUpdatesRef.current.length} actualizaciones pendientes`);
    
    requestAnimationFrame(() => {
      pendingUpdatesRef.current.forEach(result => applyResult(result));
      pendingUpdatesRef.current = [];
    });
  }, [applyResult]);

  const showNotification = useCallback((title: string, options: NotificationOptions) => {
    if (!settings.notifDesktop) return;
    if (!channelIncludesPush(settings.notifTasks)) return;
    if (
      isWithinQuietHours({
        enabled: settings.notifQuietHours,
        start: settings.notifQuietStart,
        end: settings.notifQuietEnd,
      })
    ) {
      return;
    }
    if (!('Notification' in window)) return;
    if (Notification.permission !== 'granted') return;

    try {
      new Notification(title, options);
    } catch {
      // ignore
    }
  }, [settings.notifDesktop, settings.notifQuietEnd, settings.notifQuietHours, settings.notifQuietStart, settings.notifTasks]);

  const handleExternalTaskCompletion = useCallback((data: { result?: any }) => {
    if (data.result) {
      applyResult(data.result);
    }
  }, [applyResult]);

  const handleProcessingComplete = useCallback(async (payload: { total: number; elapsed: number; rate: number; results: any[] }) => {
    setStatus('completed');
    console.log(`✅ Procesamiento completado: ${payload.total} tareas en ${payload.elapsed}ms`);

    flushPendingUpdates();

    await persistenceRef.current?.clearAllTasks();

    callbacksRef.current.onComplete?.(payload);

    if (document.visibilityState !== 'visible') {
      showNotification('Procesamiento Completado', {
        body: `Se procesaron ${payload.total} tareas correctamente.`,
        icon: '/excel-icon.png'
      });
    }

    setTimeout(() => setStatus('idle'), 2000);
  }, [flushPendingUpdates, showNotification]);

  const handleTaskCompletion = useCallback((payload: { task?: { id?: number }; result: any; progress: ProcessingProgress }) => {
    const { result, progress: taskProgress } = payload;

    setProgress({
      current: taskProgress.current,
      total: taskProgress.total,
      percent: taskProgress.percent
    });

    if (document.visibilityState === 'visible') {
      applyResult(result);
    } else {
      pendingUpdatesRef.current.push(result);
    }

    callbacksRef.current.onProgress?.(taskProgress);

    coordinatorRef.current?.reportCompletion(payload.task?.id || 0, result);
  }, [applyResult]);

  const handleWorkerMessage = useCallback((event: MessageEvent) => {
    const { type, payload } = event.data;

    switch (type) {
      case 'STARTED':
        setStatus('processing');
        setProgress({ current: 0, total: payload.total, percent: 0 });
        break;

      case 'TASK_COMPLETED':
        handleTaskCompletion(payload);
        break;

      case 'TASK_ERROR':
        console.error('Error en tarea:', payload);
        callbacksRef.current.onError?.(payload.error);
        break;

      case 'COMPLETED':
        handleProcessingComplete(payload);
        break;

      case 'PAUSED':
        setStatus('paused');
        break;

      case 'RESUMED':
        setStatus('processing');
        break;

      case 'CANCELLED':
        setStatus('idle');
        setProgress({ current: 0, total: 0, percent: 0 });
        break;

      case 'STATUS':
        setProgress({
          current: payload.processed,
          total: payload.total,
          percent: Math.round((payload.processed / payload.total) * 100) || 0
        });
        setStats({
          rate: payload.rate,
          eta: payload.eta,
          elapsed: payload.elapsed
        });
        break;
    }
  }, [handleTaskCompletion, handleProcessingComplete]);

  const handleWorkerError = useCallback((error: ErrorEvent) => {
    console.error('Worker error:', error);
    setStatus('error');
    callbacksRef.current.onError?.(error.message);
  }, []);

  useEffect(() => {
    const initialize = async () => {
      setStatus('initializing');

      try {
        persistenceRef.current = new TaskPersistenceService();
        await persistenceRef.current.initialize();

        coordinatorRef.current = new TabCoordinator();
        coordinatorRef.current.on('becameLeader', () => setIsLeader(true));
        coordinatorRef.current.on('lostLeadership', () => setIsLeader(false));
        coordinatorRef.current.on('taskCompleted', handleExternalTaskCompletion);

        const blob = new Blob([WORKER_CODE], { type: 'application/javascript' });
        const workerUrl = URL.createObjectURL(blob);
        workerRef.current = new Worker(workerUrl);
        workerRef.current.onmessage = handleWorkerMessage;
        workerRef.current.onerror = handleWorkerError;

        await new Promise<void>((resolve) => {
          const checkReady = (e: MessageEvent) => {
            if (e.data.type === 'READY') {
              workerRef.current?.removeEventListener('message', checkReady);
              resolve();
            }
          };
          workerRef.current?.addEventListener('message', checkReady);
        });

        if (autoRecover) {
          const pendingTasks = await persistenceRef.current.getPendingTasks();
          if (pendingTasks.length > 0) {
            console.log(`📋 Recuperando ${pendingTasks.length} tareas pendientes`);
            workerRef.current?.postMessage({ 
              type: 'START', 
              payload: pendingTasks 
            });
          }
        }

        setStatus('idle');
        console.log('✅ Sistema de background processing inicializado');

      } catch (error) {
        console.error('Error inicializando background processing:', error);
        setStatus('error');
      }
    };

    initialize();

    return () => {
      workerRef.current?.terminate();
      coordinatorRef.current?.destroy();
    };
  }, [autoRecover, handleWorkerMessage, handleWorkerError, handleExternalTaskCompletion]);

  useEffect(() => {
    const handleVisibilityChange = () => {
      const visible = document.visibilityState === 'visible';
      setIsPageVisible(visible);

      if (visible) {
        console.log('👁️ Página visible - Aplicando actualizaciones pendientes');
        flushPendingUpdates();
        
        workerRef.current?.postMessage({ type: 'GET_STATUS' });
      } else {
        console.log('👁️‍🗨️ Página en background - Continuando procesamiento');
      }
    };

    document.addEventListener('visibilitychange', handleVisibilityChange);
    return () => document.removeEventListener('visibilitychange', handleVisibilityChange);
  }, [flushPendingUpdates]);

  const startProcessing = useCallback(async (tasks: BackgroundTask[]): Promise<boolean> => {
    if (!workerRef.current) {
      console.error('Worker no inicializado');
      return false;
    }

    if (status === 'processing') {
      console.warn('Ya hay un procesamiento en curso');
      return false;
    }

    await persistenceRef.current?.saveTasks(tasks);

    if ('Notification' in window && Notification.permission === 'default') {
      Notification.requestPermission();
    }

    workerRef.current.postMessage({ type: 'START', payload: tasks });

    return true;
  }, [status]);

  const addTasks = useCallback(async (tasks: BackgroundTask[]): Promise<boolean> => {
    if (!workerRef.current) return false;

    await persistenceRef.current?.saveTasks(tasks);
    workerRef.current.postMessage({ type: 'ADD_TASKS', payload: tasks });

    return true;
  }, []);

  const pause = useCallback(() => {
    workerRef.current?.postMessage({ type: 'PAUSE' });
  }, []);

  const resume = useCallback(() => {
    workerRef.current?.postMessage({ type: 'RESUME' });
  }, []);

  const cancel = useCallback(async () => {
    workerRef.current?.postMessage({ type: 'CANCEL' });
    await persistenceRef.current?.clearAllTasks();
    pendingUpdatesRef.current = [];
  }, []);

  const getStatus = useCallback(() => {
    workerRef.current?.postMessage({ type: 'GET_STATUS' });
  }, []);

  return {
    status,
    progress,
    stats,
    isPageVisible,
    isLeader,
    isProcessing: status === 'processing',
    isPaused: status === 'paused',
    startProcessing,
    addTasks,
    pause,
    resume,
    cancel,
    getStatus,
    flushPendingUpdates
  };
}
