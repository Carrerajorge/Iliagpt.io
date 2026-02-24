import React, { useState, useEffect } from 'react';
import { 
  Activity, AlertTriangle, CheckCircle, Clock, 
  RefreshCw, TrendingDown, TrendingUp, Server,
  Monitor, Cpu, Database, Network
} from 'lucide-react';
import { usePlatformSettings } from '@/contexts/PlatformSettingsContext';
import { formatZonedDateTime, normalizeTimeZone } from '@/lib/platformDateTime';

interface ErrorStats {
  total: number;
  last24Hours: number;
  lastWeek: number;
  byComponent: Record<string, number>;
  topErrors: { message: string; count: number }[];
  healthScore: number;
}

interface ServiceHealth {
  name: string;
  status: 'healthy' | 'degraded' | 'unhealthy';
  latency: number;
  lastCheck: string;
  details?: any;
}

interface SystemHealthData {
  overall: 'healthy' | 'degraded' | 'unhealthy';
  services: ServiceHealth[];
}

interface ErrorLog {
  errorId: string;
  message: string;
  componentName?: string;
  url: string;
  timestamp: string;
}

export default function SystemHealth() {
  const [stats, setStats] = useState<ErrorStats | null>(null);
  const [infraHealth, setInfraHealth] = useState<SystemHealthData | null>(null);
  const [recentErrors, setRecentErrors] = useState<ErrorLog[]>([]);
  const [loading, setLoading] = useState(true);
  const [autoRefresh, setAutoRefresh] = useState(true);
  const { settings: platformSettings } = usePlatformSettings();
  const platformTimeZone = normalizeTimeZone(platformSettings.timezone_default);
  const platformDateFormat = platformSettings.date_format;

  const fetchData = async () => {
    try {
      const [statsRes, errorsRes, healthRes] = await Promise.all([
        fetch('/api/errors/stats'),
        fetch('/api/errors/recent?limit=20'),
        fetch('/api/observability/health')
      ]);

      if (statsRes.ok) {
        setStats(await statsRes.json());
      }
      if (errorsRes.ok) {
        const data = await errorsRes.json();
        setRecentErrors(data.errors);
      }
      if (healthRes.ok) {
        const data = await healthRes.json();
        if (data.success) {
          setInfraHealth(data.data);
        }
      }
    } catch (error) {
      console.error('Error fetching health data:', error);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchData();
    
    if (autoRefresh) {
      const interval = setInterval(fetchData, 30000);
      return () => clearInterval(interval);
    }
  }, [autoRefresh]);

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'healthy': return 'text-green-400';
      case 'degraded': return 'text-yellow-400';
      case 'unhealthy': return 'text-red-400';
      default: return 'text-gray-400';
    }
  };

  const getHealthColor = (score: number) => {
    if (score >= 90) return 'text-green-400';
    if (score >= 70) return 'text-yellow-400';
    if (score >= 50) return 'text-orange-400';
    return 'text-red-400';
  };

  const getHealthBg = (score: number) => {
    if (score >= 90) return 'bg-green-900/30 border-green-500/30';
    if (score >= 70) return 'bg-yellow-900/30 border-yellow-500/30';
    if (score >= 50) return 'bg-orange-900/30 border-orange-500/30';
    return 'bg-red-900/30 border-red-500/30';
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-96" data-testid="loading-spinner">
        <RefreshCw className="w-8 h-8 text-indigo-400 animate-spin" />
      </div>
    );
  }

  return (
    <div className="p-6 space-y-6" data-testid="system-health-page">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-white flex items-center gap-3">
            <Activity className="w-7 h-7 text-indigo-400" />
            Estado del Sistema
          </h1>
          <p className="text-gray-400 mt-1">
            Monitoreo de infraestructura y errores
          </p>
        </div>
        
        <div className="flex items-center gap-3">
          <label className="flex items-center gap-2 text-sm text-gray-400">
            <input
              type="checkbox"
              checked={autoRefresh}
              onChange={(e) => setAutoRefresh(e.target.checked)}
              className="rounded border-gray-600 bg-gray-700 text-indigo-500"
              data-testid="checkbox-auto-refresh"
            />
            Auto-refresh
          </label>
          <button
            onClick={fetchData}
            className="flex items-center gap-2 px-4 py-2 bg-gray-700 hover:bg-gray-600 text-white rounded-lg transition-colors"
            data-testid="button-refresh"
          >
            <RefreshCw className="w-4 h-4" />
            Actualizar
          </button>
        </div>
      </div>

      {/* Infrastructure Status Cards */}
      {infraHealth && (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
          <div className="bg-gray-800 border border-gray-700 rounded-xl p-4">
            <div className="flex items-center justify-between">
              <span className="text-gray-400 text-sm">Estado General</span>
              <Activity className={`w-5 h-5 ${getStatusColor(infraHealth.overall)}`} />
            </div>
            <div className={`text-xl font-bold mt-2 capitalize ${getStatusColor(infraHealth.overall)}`}>
              {infraHealth.overall === 'healthy' ? 'Operativo' : infraHealth.overall}
            </div>
          </div>

          {infraHealth.services.map((service) => (
            <div key={service.name} className="bg-gray-800 border border-gray-700 rounded-xl p-4">
              <div className="flex items-center justify-between">
                <span className="text-gray-400 text-sm capitalize">{service.name}</span>
                {service.name.toLowerCase().includes('db') || service.name.includes('postgres') ? (
                  <Database className={`w-5 h-5 ${getStatusColor(service.status)}`} />
                ) : service.name.toLowerCase().includes('redis') ? (
                  <Server className={`w-5 h-5 ${getStatusColor(service.status)}`} />
                ) : (
                  <Network className={`w-5 h-5 ${getStatusColor(service.status)}`} />
                )}
              </div>
              <div className="flex items-end gap-2 mt-2">
                <div className={`text-xl font-bold capitalize ${getStatusColor(service.status)}`}>
                  {service.status}
                </div>
                <div className="text-xs text-gray-500 mb-1">{service.latency}ms</div>
              </div>
            </div>
          ))}
        </div>
      )}

      {stats && (
        <div className={`p-6 rounded-xl border ${getHealthBg(stats.healthScore)}`} data-testid="health-score-card">
          <div className="flex items-center justify-between">
            <div>
              <h2 className="text-lg font-medium text-gray-300">Puntuación de Salud</h2>
              <p className="text-sm text-gray-500 mt-1">
                Basado en errores de las últimas 24 horas
              </p>
            </div>
            <div className="flex items-center gap-4">
              <div className={`text-5xl font-bold ${getHealthColor(stats.healthScore)}`} data-testid="text-health-score">
                {stats.healthScore}
              </div>
              <div className="text-right">
                <div className={`text-2xl ${getHealthColor(stats.healthScore)}`}>
                  {stats.healthScore >= 90 ? (
                    <CheckCircle className="w-10 h-10" />
                  ) : (
                    <AlertTriangle className="w-10 h-10" />
                  )}
                </div>
                <p className="text-sm text-gray-500 mt-1">
                  {stats.healthScore >= 90 ? 'Excelente' : 
                   stats.healthScore >= 70 ? 'Bueno' :
                   stats.healthScore >= 50 ? 'Regular' : 'Crítico'}
                </p>
              </div>
            </div>
          </div>
        </div>
      )}

      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <div className="bg-gray-800 border border-gray-700 rounded-xl p-4">
          <div className="flex items-center justify-between">
            <span className="text-gray-400 text-sm">Total Errores</span>
            <Server className="w-5 h-5 text-gray-500" />
          </div>
          <div className="text-3xl font-bold text-white mt-2" data-testid="text-total-errors">{stats?.total || 0}</div>
          <div className="text-sm text-gray-500 mt-1">Histórico</div>
        </div>

        <div className="bg-gray-800 border border-gray-700 rounded-xl p-4">
          <div className="flex items-center justify-between">
            <span className="text-gray-400 text-sm">Últimas 24h</span>
            <Clock className="w-5 h-5 text-yellow-400" />
          </div>
          <div className="text-3xl font-bold text-white mt-2" data-testid="text-24h-errors">{stats?.last24Hours || 0}</div>
          <div className="flex items-center gap-1 text-sm mt-1">
            {(stats?.last24Hours || 0) > 10 ? (
              <>
                <TrendingUp className="w-4 h-4 text-red-400" />
                <span className="text-red-400">Alto</span>
              </>
            ) : (
              <>
                <TrendingDown className="w-4 h-4 text-green-400" />
                <span className="text-green-400">Normal</span>
              </>
            )}
          </div>
        </div>

        <div className="bg-gray-800 border border-gray-700 rounded-xl p-4">
          <div className="flex items-center justify-between">
            <span className="text-gray-400 text-sm">Última Semana</span>
            <Monitor className="w-5 h-5 text-blue-400" />
          </div>
          <div className="text-3xl font-bold text-white mt-2" data-testid="text-week-errors">{stats?.lastWeek || 0}</div>
          <div className="text-sm text-gray-500 mt-1">7 días</div>
        </div>

        <div className="bg-gray-800 border border-gray-700 rounded-xl p-4">
          <div className="flex items-center justify-between">
            <span className="text-gray-400 text-sm">Componentes</span>
            <Cpu className="w-5 h-5 text-purple-400" />
          </div>
          <div className="text-3xl font-bold text-white mt-2" data-testid="text-components-count">
            {Object.keys(stats?.byComponent || {}).length}
          </div>
          <div className="text-sm text-gray-500 mt-1">Con errores</div>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div className="bg-gray-800 border border-gray-700 rounded-xl p-6">
          <h3 className="text-lg font-medium text-white mb-4">Errores por Componente</h3>
          {stats && Object.entries(stats.byComponent).length > 0 ? (
            <div className="space-y-3">
              {Object.entries(stats.byComponent)
                .sort((a, b) => b[1] - a[1])
                .slice(0, 8)
                .map(([component, count]) => (
                  <div key={component} className="flex items-center justify-between" data-testid={`component-error-${component}`}>
                    <span className="text-gray-300 truncate">{component}</span>
                    <div className="flex items-center gap-3">
                      <div className="w-32 h-2 bg-gray-700 rounded-full overflow-hidden">
                        <div
                          className="h-full bg-indigo-500 rounded-full"
                          style={{
                            width: `${Math.min(100, (count / stats.total) * 100 * 5)}%`
                          }}
                        />
                      </div>
                      <span className="text-gray-400 text-sm w-12 text-right">{count}</span>
                    </div>
                  </div>
                ))}
            </div>
          ) : (
            <p className="text-gray-500 text-center py-8">No hay datos disponibles</p>
          )}
        </div>

        <div className="bg-gray-800 border border-gray-700 rounded-xl p-6">
          <h3 className="text-lg font-medium text-white mb-4">Errores Más Frecuentes</h3>
          {stats && stats.topErrors.length > 0 ? (
            <div className="space-y-3">
              {stats.topErrors.slice(0, 8).map((error, idx) => (
                <div 
                  key={idx} 
                  className="flex items-start justify-between gap-4 p-3 bg-gray-700/50 rounded-lg"
                  data-testid={`top-error-${idx}`}
                >
                  <span className="text-gray-300 text-sm flex-1 break-words">
                    {error.message}
                  </span>
                  <span className="px-2 py-1 bg-red-900/50 text-red-300 text-xs rounded flex-shrink-0">
                    {error.count}x
                  </span>
                </div>
              ))}
            </div>
          ) : (
            <p className="text-gray-500 text-center py-8">No hay errores registrados</p>
          )}
        </div>
      </div>

      <div className="bg-gray-800 border border-gray-700 rounded-xl p-6">
        <h3 className="text-lg font-medium text-white mb-4">Errores Recientes</h3>
        {recentErrors.length > 0 ? (
          <div className="overflow-x-auto">
            <table className="w-full" data-testid="table-recent-errors">
              <thead>
                <tr className="border-b border-gray-700">
                  <th className="px-4 py-3 text-left text-sm font-medium text-gray-400">ID</th>
                  <th className="px-4 py-3 text-left text-sm font-medium text-gray-400">Componente</th>
                  <th className="px-4 py-3 text-left text-sm font-medium text-gray-400">Mensaje</th>
                  <th className="px-4 py-3 text-left text-sm font-medium text-gray-400">Hora</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-700">
                {recentErrors.map((error) => (
                  <tr key={error.errorId} className="hover:bg-gray-700/50" data-testid={`error-row-${error.errorId}`}>
                    <td className="px-4 py-3">
                      <code className="text-xs text-indigo-400 bg-indigo-900/30 px-2 py-1 rounded">
                        {error.errorId.slice(0, 12)}...
                      </code>
                    </td>
                    <td className="px-4 py-3 text-sm text-gray-300">
                      {error.componentName || 'Unknown'}
                    </td>
                    <td className="px-4 py-3 text-sm text-gray-400 max-w-md truncate">
                      {error.message}
                    </td>
	                    <td className="px-4 py-3 text-sm text-gray-500">
	                      {formatZonedDateTime(error.timestamp, { timeZone: platformTimeZone, dateFormat: platformDateFormat })}
	                    </td>
	                  </tr>
	                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="flex flex-col items-center justify-center py-12">
            <CheckCircle className="w-12 h-12 text-green-400 mb-3" />
            <p className="text-gray-400">No hay errores recientes</p>
          </div>
        )}
      </div>
    </div>
  );
}
