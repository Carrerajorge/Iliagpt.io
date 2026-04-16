import type { ProcessingStatus, ProcessingProgress, ProcessingStats } from '../hooks/use-background-processing';

interface BackgroundProcessingStatusProps {
  status: ProcessingStatus;
  progress: ProcessingProgress;
  stats: ProcessingStats;
  isPageVisible: boolean;
  onPause?: () => void;
  onResume?: () => void;
  onCancel?: () => void;
}

const formatTime = (ms: number): string => {
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60000) return `${Math.round(ms / 1000)}s`;
  return `${Math.round(ms / 60000)}m ${Math.round((ms % 60000) / 1000)}s`;
};

export function BackgroundProcessingStatus({
  status,
  progress,
  stats,
  isPageVisible,
  onPause,
  onResume,
  onCancel
}: BackgroundProcessingStatusProps) {
  if (status === 'idle' || status === 'initializing') return null;

  const isBackground = !isPageVisible && status === 'processing';

  return (
    <>
      <style>{`
        .bg-processing-status {
          position: fixed;
          bottom: 24px;
          right: 24px;
          background: white;
          border-radius: 16px;
          padding: 20px;
          box-shadow: 0 8px 32px rgba(0, 0, 0, 0.12);
          z-index: 10000;
          min-width: 320px;
          max-width: 400px;
          font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
          transition: all 0.3s ease;
          border: 1px solid #e2e8f0;
          animation: slideInUp 0.3s ease-out;
        }
        
        .dark .bg-processing-status {
          background: #1e293b;
          border-color: #334155;
          color: white;
        }

        .bg-processing-status.background-mode {
          background: linear-gradient(135deg, #1e293b 0%, #0f172a 100%);
          color: white;
          border-color: #334155;
        }

        .bg-processing-status.completed {
          border-color: #10b981;
          box-shadow: 0 8px 32px rgba(16, 185, 129, 0.2);
        }

        .bg-processing-status.error {
          border-color: #ef4444;
          box-shadow: 0 8px 32px rgba(239, 68, 68, 0.2);
        }

        .status-header {
          display: flex;
          align-items: center;
          gap: 14px;
          margin-bottom: 16px;
        }

        .status-icon {
          width: 44px;
          height: 44px;
          display: flex;
          align-items: center;
          justify-content: center;
          font-size: 24px;
        }

        .processing-spinner {
          width: 32px;
          height: 32px;
          border: 3px solid #e2e8f0;
          border-top-color: #3b82f6;
          border-radius: 50%;
          animation: spin 0.8s linear infinite;
        }
        
        .dark .processing-spinner {
          border-color: #334155;
          border-top-color: #3b82f6;
        }

        @keyframes spin {
          to { transform: rotate(360deg); }
        }

        .background-pulse {
          animation: pulse-bg 2s ease-in-out infinite;
        }

        .background-pulse svg {
          width: 32px;
          height: 32px;
          color: #10b981;
        }

        @keyframes pulse-bg {
          0%, 100% { opacity: 1; transform: scale(1); }
          50% { opacity: 0.7; transform: scale(0.95); }
        }

        .status-info {
          flex: 1;
        }

        .status-title {
          font-weight: 600;
          font-size: 15px;
          margin-bottom: 2px;
        }

        .status-subtitle {
          font-size: 13px;
          color: #64748b;
        }

        .background-mode .status-subtitle,
        .dark .status-subtitle {
          color: #94a3b8;
        }

        .status-progress {
          display: flex;
          align-items: center;
          gap: 12px;
          margin-bottom: 14px;
        }

        .progress-bar {
          flex: 1;
          height: 8px;
          background: #e2e8f0;
          border-radius: 8px;
          overflow: hidden;
        }
        
        .dark .progress-bar {
          background: #334155;
        }

        .background-mode .progress-bar {
          background: #334155;
        }

        .progress-fill {
          height: 100%;
          background: linear-gradient(90deg, #3b82f6 0%, #10b981 100%);
          border-radius: 8px;
          transition: width 0.3s ease;
          position: relative;
        }

        .progress-fill::after {
          content: '';
          position: absolute;
          top: 0;
          left: 0;
          right: 0;
          bottom: 0;
          background: linear-gradient(
            90deg,
            transparent 0%,
            rgba(255, 255, 255, 0.3) 50%,
            transparent 100%
          );
          animation: shimmer 1.5s infinite;
        }

        @keyframes shimmer {
          0% { transform: translateX(-100%); }
          100% { transform: translateX(100%); }
        }

        .progress-percent {
          font-size: 14px;
          font-weight: 700;
          min-width: 48px;
          text-align: right;
          color: #3b82f6;
        }

        .background-mode .progress-percent {
          color: #10b981;
        }

        .status-stats {
          display: grid;
          grid-template-columns: repeat(3, 1fr);
          gap: 8px;
          margin-bottom: 14px;
          padding: 10px;
          background: #f8fafc;
          border-radius: 8px;
        }
        
        .dark .status-stats {
          background: rgba(255, 255, 255, 0.05);
        }

        .background-mode .status-stats {
          background: rgba(255, 255, 255, 0.05);
        }

        .stat {
          display: flex;
          flex-direction: column;
          align-items: center;
          gap: 2px;
        }

        .stat-label {
          font-size: 10px;
          color: #64748b;
          text-transform: uppercase;
          letter-spacing: 0.5px;
        }
        
        .dark .stat-label {
          color: #94a3b8;
        }

        .background-mode .stat-label {
          color: #94a3b8;
        }

        .stat-value {
          font-size: 13px;
          font-weight: 600;
        }

        .background-notice {
          display: flex;
          align-items: center;
          gap: 10px;
          padding: 10px 14px;
          background: rgba(16, 185, 129, 0.1);
          border-radius: 8px;
          margin-bottom: 14px;
          font-size: 12px;
          color: #10b981;
          line-height: 1.4;
        }

        .status-controls {
          display: flex;
          gap: 8px;
        }

        .control-btn {
          flex: 1;
          padding: 10px 14px;
          border: none;
          border-radius: 8px;
          font-size: 13px;
          font-weight: 600;
          cursor: pointer;
          transition: all 0.15s;
          display: flex;
          align-items: center;
          justify-content: center;
          gap: 6px;
        }

        .pause-btn {
          background: #fef3c7;
          color: #92400e;
        }

        .pause-btn:hover {
          background: #fde68a;
        }

        .resume-btn {
          background: #dcfce7;
          color: #166534;
        }

        .resume-btn:hover {
          background: #bbf7d0;
        }

        .cancel-btn {
          background: #fee2e2;
          color: #991b1b;
        }

        .cancel-btn:hover {
          background: #fecaca;
        }

        .background-mode .cancel-btn {
          background: rgba(239, 68, 68, 0.2);
          color: #fca5a5;
        }

        @keyframes slideInUp {
          from {
            opacity: 0;
            transform: translateY(20px);
          }
          to {
            opacity: 1;
            transform: translateY(0);
          }
        }
      `}</style>
      
      <div 
        className={`bg-processing-status ${isBackground ? 'background-mode' : ''} ${status}`}
        data-testid="background-processing-status"
      >
        <div className="status-header">
          <div className="status-icon">
            {status === 'processing' && (
              isBackground ? (
                <div className="background-pulse">
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <circle cx="12" cy="12" r="10" />
                    <polyline points="12 6 12 12 16 14" />
                  </svg>
                </div>
              ) : (
                <div className="processing-spinner" />
              )
            )}
            {status === 'paused' && <span className="pause-icon">⏸️</span>}
            {status === 'completed' && <span className="complete-icon">✅</span>}
            {status === 'error' && <span className="error-icon">❌</span>}
          </div>

          <div className="status-info">
            <div className="status-title">
              {status === 'processing' && (isBackground ? 'Procesando en segundo plano' : 'Procesando...')}
              {status === 'paused' && 'Procesamiento pausado'}
              {status === 'completed' && 'Completado'}
              {status === 'error' && 'Error en el procesamiento'}
            </div>
            <div className="status-subtitle">
              {progress.current.toLocaleString()} / {progress.total.toLocaleString()} tareas
            </div>
          </div>
        </div>

        <div className="status-progress">
          <div className="progress-bar">
            <div 
              className="progress-fill" 
              style={{ width: `${progress.percent}%` }}
            />
          </div>
          <span className="progress-percent">{progress.percent}%</span>
        </div>

        {status === 'processing' && (
          <div className="status-stats">
            <div className="stat">
              <span className="stat-label">Velocidad</span>
              <span className="stat-value">{stats.rate} tareas/s</span>
            </div>
            <div className="stat">
              <span className="stat-label">Restante</span>
              <span className="stat-value">~{formatTime(stats.eta)}</span>
            </div>
            <div className="stat">
              <span className="stat-label">Transcurrido</span>
              <span className="stat-value">{formatTime(stats.elapsed)}</span>
            </div>
          </div>
        )}

        {isBackground && (
          <div className="background-notice">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="16" height="16">
              <circle cx="12" cy="12" r="10" />
              <line x1="12" y1="8" x2="12" y2="12" />
              <line x1="12" y1="16" x2="12.01" y2="16" />
            </svg>
            <span>Puedes cambiar de pestaña o minimizar. El proceso continuará.</span>
          </div>
        )}

        <div className="status-controls">
          {status === 'processing' && onPause && (
            <button 
              className="control-btn pause-btn" 
              onClick={onPause}
              data-testid="btn-pause-processing"
            >
              ⏸️ Pausar
            </button>
          )}
          {status === 'paused' && onResume && (
            <button 
              className="control-btn resume-btn" 
              onClick={onResume}
              data-testid="btn-resume-processing"
            >
              ▶️ Reanudar
            </button>
          )}
          {(status === 'processing' || status === 'paused') && onCancel && (
            <button 
              className="control-btn cancel-btn" 
              onClick={onCancel}
              data-testid="btn-cancel-processing"
            >
              ✕ Cancelar
            </button>
          )}
        </div>
      </div>
    </>
  );
}
