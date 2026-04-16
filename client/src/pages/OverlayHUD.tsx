import React, { useEffect, useState } from 'react';

// Declaramos que window.electronAPI puede existir en entorno Desktop
declare global {
    interface Window {
        electronAPI?: any;
    }
}

export const OverlayHUD: React.FC = () => {
    const [agentStatus, setAgentStatus] = useState<'idle' | 'working' | 'waiting'>('idle');

    useEffect(() => {
        // Al cargar el overlay, le decimos a Electron que por defecto deje "atravesar" los clics
        if (window.electronAPI?.setIgnoreMouseEvents) {
            window.electronAPI.setIgnoreMouseEvents(true);
        }
    }, []);

    const handleMouseEnter = () => {
        // Si el usuario pone el mouse EN el widget del hud, interceptamos el clic
        if (window.electronAPI?.setIgnoreMouseEvents) {
            window.electronAPI.setIgnoreMouseEvents(false);
        }
    };

    const handleMouseLeave = () => {
        // Si el usuario saca el mouse, vuelve a ser un cristal click-through
        if (window.electronAPI?.setIgnoreMouseEvents) {
            window.electronAPI.setIgnoreMouseEvents(true);
        }
    };

    return (
        <div className="w-screen h-screen bg-transparent overflow-hidden pointer-events-none p-4 flex flex-col justify-end">

            {/* Widget Interactivo del Agente en la esquina inferior derecha */}
            <div
                className="pointer-events-auto w-80 bg-gray-900/80 backdrop-blur-md border border-gray-700 rounded-2xl shadow-2xl p-4 self-end transition-all select-none"
                onMouseEnter={handleMouseEnter}
                onMouseLeave={handleMouseLeave}
            >
                <div className="flex items-center justify-between mb-2">
                    <div className="flex items-center space-x-2">
                        <div className={`w-3 h-3 rounded-full ${agentStatus === 'working' ? 'bg-green-500 animate-pulse' : 'bg-gray-500'}`}></div>
                        <span className="text-white font-semibold tracking-wide">
                            {agentStatus === 'working' ? 'Agent Active' : 'Agent Standby'}
                        </span>
                    </div>
                    <span className="text-xs text-gray-400">⌘⇧I to hide</span>
                </div>

                <div className="h-24 bg-black/50 rounded-lg flex items-center justify-center border border-gray-800 mb-2 overflow-hidden relative">
                    {/* Aquí iría la repetición del stream del Vision Desktop */}
                    <span className="text-gray-600 text-xs">[Machine Vision Stream Offline]</span>
                </div>

                <div className="flex justify-between mt-2">
                    <button
                        className="flex-1 mr-2 px-3 py-1.5 bg-blue-600 hover:bg-blue-500 text-white rounded-lg text-sm transition-colors"
                        onClick={() => {
                            setAgentStatus('working');
                            window.electronAPI?.agentStarted?.();
                        }}
                    >
                        Start
                    </button>
                    <button
                        className="flex-1 ml-2 px-3 py-1.5 bg-red-600/80 hover:bg-red-500 text-white rounded-lg text-sm transition-colors"
                        onClick={() => {
                            setAgentStatus('idle');
                            window.electronAPI?.agentStopped?.();
                        }}
                    >
                        Stop
                    </button>
                </div>
            </div>
        </div>
    );
};

export default OverlayHUD;
