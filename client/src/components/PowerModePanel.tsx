import React, { useState, useEffect } from 'react';
import { apiFetch } from "@/lib/apiClient";

interface PowerStatus {
  status: string;
  powerLevel: number;
  mode: string;
  capabilities: string[];
  config: {
    streaming: boolean;
    parallelTools: boolean;
    memory: string;
    maxTools: number;
    contextWindow: number;
  };
  presets: string[];
}

interface Preset {
  name: string;
  description: string;
}

const PRESET_ICONS: Record<string, string> = {
  turbo: '⚡',
  research: '🔬',
  creative: '🎨',
  code: '💻',
  analyst: '📊',
  stealth: '🥷'
};

const CAPABILITY_ICONS: Record<string, string> = {
  streaming: '📡',
  'parallel-tools': '⚙️',
  'long-term-memory': '🧠',
  'web-search': '🔍',
  'deep-research': '📚',
  'code-execution': '💻',
  'file-operations': '📁',
  shell: '🖥️',
  'data-analysis': '📈',
  excel: '📊',
  visualization: '📉',
  'image-generation': '🖼️',
  'creative-writing': '✍️',
  chat: '💬',
  completion: '✅'
};

export function PowerModePanel() {
  const [status, setStatus] = useState<PowerStatus | null>(null);
  const [presets, setPresets] = useState<Preset[]>([]);
  const [loading, setLoading] = useState(true);
  const [boosting, setBoosting] = useState(false);
  const [boostTimeLeft, setBoostTimeLeft] = useState(0);

  useEffect(() => {
    fetchPowerStatus();
    fetchPresets();
  }, []);

  useEffect(() => {
    if (boostTimeLeft > 0) {
      const timer = setTimeout(() => {
        setBoostTimeLeft(boostTimeLeft - 1);
        if (boostTimeLeft <= 1) {
          fetchPowerStatus();
        }
      }, 1000);
      return () => clearTimeout(timer);
    }
  }, [boostTimeLeft]);

  async function fetchPowerStatus() {
    try {
      const res = await apiFetch('/api/power/status');
      const data = await res.json();
      setStatus(data);
    } catch (error) {
      console.error('Failed to fetch power status:', error);
    } finally {
      setLoading(false);
    }
  }

  async function fetchPresets() {
    try {
      const res = await apiFetch('/api/power/presets');
      const data = await res.json();
      setPresets(data.presets || []);
    } catch (error) {
      console.error('Failed to fetch presets:', error);
    }
  }

  async function applyPreset(name: string) {
    try {
      const res = await apiFetch(`/api/power/preset/${name}`, { method: 'POST' });
      const data = await res.json();
      if (data.success) {
        fetchPowerStatus();
      }
    } catch (error) {
      console.error('Failed to apply preset:', error);
    }
  }

  async function activateBoost() {
    setBoosting(true);
    try {
      const res = await apiFetch('/api/power/boost', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ duration: 300000 })
      });
      const data = await res.json();
      if (data.success) {
        setBoostTimeLeft(Math.floor(data.expiresIn / 1000));
        fetchPowerStatus();
      }
    } catch (error) {
      console.error('Failed to activate boost:', error);
    } finally {
      setBoosting(false);
    }
  }

  if (loading) {
    return (
      <div className="power-panel loading">
        <div className="power-loader">⚡ Cargando Power Mode...</div>
      </div>
    );
  }

  if (!status) {
    return (
      <div className="power-panel error">
        <p>Error al cargar Power Mode</p>
      </div>
    );
  }

  const powerColor = status.powerLevel >= 80 ? '#00ff88' : 
                     status.powerLevel >= 60 ? '#ffcc00' : 
                     status.powerLevel >= 40 ? '#ff9900' : '#ff4444';

  return (
    <div className="power-panel">
      <style>{`
        .power-panel {
          background: linear-gradient(135deg, #1a1a2e 0%, #16213e 100%);
          border-radius: 16px;
          padding: 24px;
          color: white;
          font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
        }
        
        .power-header {
          display: flex;
          justify-content: space-between;
          align-items: center;
          margin-bottom: 24px;
        }
        
        .power-title {
          font-size: 24px;
          font-weight: 700;
          background: linear-gradient(90deg, #00ff88, #00ccff);
          -webkit-background-clip: text;
          -webkit-text-fill-color: transparent;
        }
        
        .power-level-container {
          position: relative;
          width: 100%;
          height: 24px;
          background: rgba(255,255,255,0.1);
          border-radius: 12px;
          overflow: hidden;
          margin-bottom: 20px;
        }
        
        .power-level-bar {
          height: 100%;
          border-radius: 12px;
          transition: width 0.5s ease, background 0.3s ease;
        }
        
        .power-level-text {
          position: absolute;
          top: 50%;
          left: 50%;
          transform: translate(-50%, -50%);
          font-weight: 700;
          font-size: 14px;
          text-shadow: 0 1px 2px rgba(0,0,0,0.5);
        }
        
        .power-mode {
          display: flex;
          align-items: center;
          gap: 8px;
          background: rgba(255,255,255,0.1);
          padding: 8px 16px;
          border-radius: 20px;
          font-size: 14px;
        }
        
        .power-mode-icon {
          font-size: 20px;
        }
        
        .presets-grid {
          display: grid;
          grid-template-columns: repeat(3, 1fr);
          gap: 12px;
          margin-bottom: 24px;
        }
        
        .preset-btn {
          background: rgba(255,255,255,0.05);
          border: 1px solid rgba(255,255,255,0.1);
          border-radius: 12px;
          padding: 16px;
          color: white;
          cursor: pointer;
          transition: all 0.2s ease;
          text-align: center;
        }
        
        .preset-btn:hover {
          background: rgba(255,255,255,0.15);
          border-color: rgba(255,255,255,0.3);
          transform: translateY(-2px);
        }
        
        .preset-btn.active {
          background: rgba(0,255,136,0.2);
          border-color: #00ff88;
        }
        
        .preset-icon {
          font-size: 28px;
          display: block;
          margin-bottom: 8px;
        }
        
        .preset-name {
          font-weight: 600;
          text-transform: capitalize;
        }
        
        .capabilities {
          display: flex;
          flex-wrap: wrap;
          gap: 8px;
          margin-bottom: 24px;
        }
        
        .capability {
          background: rgba(0,204,255,0.1);
          border: 1px solid rgba(0,204,255,0.3);
          padding: 6px 12px;
          border-radius: 16px;
          font-size: 12px;
          display: flex;
          align-items: center;
          gap: 4px;
        }
        
        .boost-btn {
          width: 100%;
          background: linear-gradient(135deg, #ff6b00, #ff9500);
          border: none;
          border-radius: 12px;
          padding: 16px;
          color: white;
          font-size: 16px;
          font-weight: 700;
          cursor: pointer;
          transition: all 0.2s ease;
          display: flex;
          align-items: center;
          justify-content: center;
          gap: 8px;
        }
        
        .boost-btn:hover:not(:disabled) {
          transform: scale(1.02);
          box-shadow: 0 8px 24px rgba(255,107,0,0.3);
        }
        
        .boost-btn:disabled {
          opacity: 0.7;
          cursor: not-allowed;
        }
        
        .boost-active {
          background: linear-gradient(135deg, #00ff88, #00ccff);
        }
        
        .stats-grid {
          display: grid;
          grid-template-columns: repeat(3, 1fr);
          gap: 16px;
          margin-top: 20px;
        }
        
        .stat-card {
          background: rgba(255,255,255,0.05);
          border-radius: 12px;
          padding: 16px;
          text-align: center;
        }
        
        .stat-value {
          font-size: 24px;
          font-weight: 700;
          color: #00ccff;
        }
        
        .stat-label {
          font-size: 12px;
          color: rgba(255,255,255,0.6);
          margin-top: 4px;
        }
        
        .power-loader {
          text-align: center;
          padding: 40px;
          font-size: 18px;
          animation: pulse 1.5s infinite;
        }
        
        @keyframes pulse {
          0%, 100% { opacity: 1; }
          50% { opacity: 0.5; }
        }
      `}</style>
      
      <div className="power-header">
        <h2 className="power-title">⚡ Power Mode</h2>
        <div className="power-mode">
          <span className="power-mode-icon">{PRESET_ICONS[status.mode] || '🔋'}</span>
          <span style={{ textTransform: 'capitalize' }}>{status.mode}</span>
        </div>
      </div>
      
      <div className="power-level-container">
        <div 
          className="power-level-bar" 
          style={{ 
            width: `${status.powerLevel}%`,
            background: `linear-gradient(90deg, ${powerColor}, ${powerColor}88)`
          }}
        />
        <span className="power-level-text">
          {status.powerLevel}% POWER
        </span>
      </div>
      
      <h3 style={{ marginBottom: '12px', fontSize: '14px', opacity: 0.7 }}>PRESETS</h3>
      <div className="presets-grid">
        {presets.map(preset => (
          <button
            key={preset.name}
            className={`preset-btn ${status.mode === preset.name ? 'active' : ''}`}
            onClick={() => applyPreset(preset.name)}
            title={preset.description}
          >
            <span className="preset-icon">{PRESET_ICONS[preset.name] || '⚙️'}</span>
            <span className="preset-name">{preset.name}</span>
          </button>
        ))}
      </div>
      
      <h3 style={{ marginBottom: '12px', fontSize: '14px', opacity: 0.7 }}>CAPACIDADES</h3>
      <div className="capabilities">
        {status.capabilities.map(cap => (
          <span key={cap} className="capability">
            {CAPABILITY_ICONS[cap] || '•'} {cap}
          </span>
        ))}
      </div>
      
      <button 
        className={`boost-btn ${boostTimeLeft > 0 ? 'boost-active' : ''}`}
        onClick={activateBoost}
        disabled={boosting || boostTimeLeft > 0}
      >
        {boostTimeLeft > 0 ? (
          <>🚀 BOOST ACTIVO - {Math.floor(boostTimeLeft / 60)}:{(boostTimeLeft % 60).toString().padStart(2, '0')}</>
        ) : boosting ? (
          <>⏳ Activando...</>
        ) : (
          <>🚀 ACTIVAR POWER BOOST (5 min)</>
        )}
      </button>
      
      <div className="stats-grid">
        <div className="stat-card">
          <div className="stat-value">{status.config.maxTools}</div>
          <div className="stat-label">Herramientas</div>
        </div>
        <div className="stat-card">
          <div className="stat-value">{Math.round(status.config.contextWindow / 1000)}K</div>
          <div className="stat-label">Contexto</div>
        </div>
        <div className="stat-card">
          <div className="stat-value">{status.config.memory === 'persistent' ? '∞' : 'Sesión'}</div>
          <div className="stat-label">Memoria</div>
        </div>
      </div>
    </div>
  );
}

export default PowerModePanel;
