import React, { useState, useEffect } from 'react';
import PowerModePanel from '../components/PowerModePanel';

interface SystemStats {
  system: {
    uptime: string;
    uptimeSeconds: number;
    memory: {
      used: string;
      total: string;
      rss: string;
    };
    nodeVersion: string;
    platform: string;
  };
  usage: {
    users: number;
    models: number;
    conversations: number;
  };
  version: string;
  codename: string;
}

interface Capabilities {
  powerLevel: number;
  capabilities: string[];
  tools: number;
  models: number;
  features: Record<string, boolean>;
}

export default function PowerPage() {
  const [stats, setStats] = useState<SystemStats | null>(null);
  const [capabilities, setCapabilities] = useState<Capabilities | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    Promise.all([
      fetch('/api/power/stats').then(r => r.json()),
      fetch('/api/power/capabilities').then(r => r.json())
    ]).then(([statsData, capsData]) => {
      setStats(statsData);
      setCapabilities(capsData);
      setLoading(false);
    }).catch(err => {
      console.error('Failed to load power data:', err);
      setLoading(false);
    });
  }, []);

  return (
    <div style={{
      minHeight: '100vh',
      background: 'linear-gradient(135deg, #0a0a0f 0%, #1a1a2e 50%, #16213e 100%)',
      padding: '40px 20px'
    }}>
      <style>{`
        @keyframes float {
          0%, 100% { transform: translateY(0); }
          50% { transform: translateY(-10px); }
        }
        
        @keyframes glow {
          0%, 100% { filter: drop-shadow(0 0 10px rgba(0,255,136,0.5)); }
          50% { filter: drop-shadow(0 0 20px rgba(0,255,136,0.8)); }
        }
        
        .power-page-container {
          max-width: 1200px;
          margin: 0 auto;
        }
        
        .power-hero {
          text-align: center;
          margin-bottom: 40px;
        }
        
        .power-logo {
          font-size: 80px;
          animation: float 3s ease-in-out infinite, glow 2s ease-in-out infinite;
        }
        
        .power-hero-title {
          font-size: 48px;
          font-weight: 800;
          background: linear-gradient(135deg, #00ff88, #00ccff, #ff6b00);
          -webkit-background-clip: text;
          -webkit-text-fill-color: transparent;
          margin: 20px 0 10px;
        }
        
        .power-hero-subtitle {
          font-size: 18px;
          color: rgba(255,255,255,0.6);
        }
        
        .power-grid {
          display: grid;
          grid-template-columns: 1fr 1fr;
          gap: 24px;
          margin-bottom: 24px;
        }
        
        @media (max-width: 768px) {
          .power-grid {
            grid-template-columns: 1fr;
          }
        }
        
        .power-card {
          background: linear-gradient(135deg, #1a1a2e 0%, #16213e 100%);
          border-radius: 16px;
          padding: 24px;
          color: white;
          border: 1px solid rgba(255,255,255,0.1);
        }
        
        .power-card-title {
          font-size: 20px;
          font-weight: 700;
          margin-bottom: 20px;
          display: flex;
          align-items: center;
          gap: 10px;
        }
        
        .feature-grid {
          display: grid;
          grid-template-columns: repeat(2, 1fr);
          gap: 12px;
        }
        
        .feature-item {
          display: flex;
          align-items: center;
          gap: 8px;
          padding: 12px;
          background: rgba(255,255,255,0.05);
          border-radius: 8px;
        }
        
        .feature-icon {
          font-size: 20px;
        }
        
        .feature-name {
          font-size: 14px;
        }
        
        .feature-check {
          margin-left: auto;
          color: #00ff88;
        }
        
        .stat-row {
          display: flex;
          justify-content: space-between;
          padding: 12px 0;
          border-bottom: 1px solid rgba(255,255,255,0.1);
        }
        
        .stat-row:last-child {
          border-bottom: none;
        }
        
        .stat-label {
          color: rgba(255,255,255,0.6);
        }
        
        .stat-value {
          font-weight: 600;
          color: #00ccff;
        }
        
        .version-badge {
          display: inline-block;
          background: linear-gradient(135deg, #ff6b00, #ff9500);
          padding: 4px 12px;
          border-radius: 12px;
          font-size: 12px;
          font-weight: 600;
        }
      `}</style>

      <div className="power-page-container">
        <div className="power-hero">
          <div className="power-logo">⚡</div>
          <h1 className="power-hero-title">ILIAGPT Power Mode</h1>
          <p className="power-hero-subtitle">
            {stats?.codename || 'El poder de la IA en tus manos'}
          </p>
          {stats && (
            <span className="version-badge">{stats.version}</span>
          )}
        </div>

        <div className="power-grid">
          <PowerModePanel />
          
          <div className="power-card">
            <h3 className="power-card-title">
              🎯 Características Activas
            </h3>
            {capabilities && (
              <div className="feature-grid">
                {Object.entries(capabilities.features).map(([name, enabled]) => (
                  <div key={name} className="feature-item">
                    <span className="feature-icon">
                      {name === 'streaming' && '📡'}
                      {name === 'imageGeneration' && '🖼️'}
                      {name === 'codeExecution' && '💻'}
                      {name === 'webSearch' && '🔍'}
                      {name === 'documentGeneration' && '📄'}
                      {name === 'dataAnalysis' && '📊'}
                      {name === 'multiAgent' && '🤖'}
                      {name === 'memory' && '🧠'}
                    </span>
                    <span className="feature-name">{formatFeatureName(name)}</span>
                    <span className="feature-check">
                      {enabled ? '✓' : '✗'}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

        <div className="power-grid">
          <div className="power-card">
            <h3 className="power-card-title">
              📊 Estadísticas del Sistema
            </h3>
            {stats && (
              <>
                <div className="stat-row">
                  <span className="stat-label">Uptime</span>
                  <span className="stat-value">{stats.system.uptime}</span>
                </div>
                <div className="stat-row">
                  <span className="stat-label">Memoria Usada</span>
                  <span className="stat-value">{stats.system.memory.used}</span>
                </div>
                <div className="stat-row">
                  <span className="stat-label">Node.js</span>
                  <span className="stat-value">{stats.system.nodeVersion}</span>
                </div>
                <div className="stat-row">
                  <span className="stat-label">Plataforma</span>
                  <span className="stat-value">{stats.system.platform}</span>
                </div>
              </>
            )}
          </div>

          <div className="power-card">
            <h3 className="power-card-title">
              🔢 Recursos Disponibles
            </h3>
            {capabilities && stats && (
              <>
                <div className="stat-row">
                  <span className="stat-label">Modelos AI</span>
                  <span className="stat-value">{capabilities.models || stats.usage.models}</span>
                </div>
                <div className="stat-row">
                  <span className="stat-label">Herramientas</span>
                  <span className="stat-value">{capabilities.tools}</span>
                </div>
                <div className="stat-row">
                  <span className="stat-label">Usuarios</span>
                  <span className="stat-value">{stats.usage.users}</span>
                </div>
                <div className="stat-row">
                  <span className="stat-label">Conversaciones</span>
                  <span className="stat-value">{stats.usage.conversations}</span>
                </div>
              </>
            )}
          </div>
        </div>

        <div className="power-card" style={{ marginTop: 24 }}>
          <h3 className="power-card-title">
            🚀 Cómo Usar Power Mode
          </h3>
          <div style={{ color: 'rgba(255,255,255,0.8)', lineHeight: 1.8 }}>
            <p><strong>1. Selecciona un Preset:</strong> Elige el modo que mejor se adapte a tu tarea.</p>
            <p><strong>2. Power Boost:</strong> Actívalo para máximo rendimiento por 5 minutos.</p>
            <p><strong>3. Personaliza:</strong> Ajusta la configuración según tus necesidades.</p>
            <p style={{ marginTop: 16, padding: 16, background: 'rgba(0,255,136,0.1)', borderRadius: 8 }}>
              💡 <strong>Tip:</strong> El modo <strong>Turbo</strong> es ideal para tareas rápidas. 
              Usa <strong>Research</strong> para investigaciones profundas y <strong>Code</strong> para programación.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}

function formatFeatureName(name: string): string {
  const names: Record<string, string> = {
    streaming: 'Streaming',
    imageGeneration: 'Imágenes',
    codeExecution: 'Código',
    webSearch: 'Búsqueda',
    documentGeneration: 'Documentos',
    dataAnalysis: 'Análisis',
    multiAgent: 'Multi-Agente',
    memory: 'Memoria'
  };
  return names[name] || name;
}
