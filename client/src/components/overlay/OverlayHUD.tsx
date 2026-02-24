import React, { useState, useEffect } from 'react';

export function OverlayHUD() {
    const [state, setState] = useState({ status: 'idle' });

    useEffect(() => {
        // EventSource stream for live HUD updates
        const es = new EventSource('/api/agent/stream');
        es.onmessage = (e) => setState(JSON.parse(e.data));
        return () => es.close();
    }, []);

    // IPC Click-Through control for semi-transparent Electron Window
    useEffect(() => {
        if ((window as any).electronAPI) {
            (window as any).electronAPI.setClickThrough(true);
        }
    }, []);

    return (
        <div style={{ background: 'rgba(0,0,0,0.8)', padding: 10, borderRadius: 8, color: 'white' }}>
            <div>Agent Status: {state.status}</div>
        </div>
    );
}
