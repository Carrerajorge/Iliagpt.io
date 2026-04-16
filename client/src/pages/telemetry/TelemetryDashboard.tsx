import React, { useState, useEffect } from 'react';
import { SurpriseGraph } from './SurpriseGraph';
import { AgentActivityTimeline } from './AgentActivityTimeline';
import MCTSVisualizer from './MCTSVisualizer';

export const TelemetryDashboard: React.FC = () => {
    const [surpriseData, setSurpriseData] = useState<any[]>([]);
    const [actionData, setActionData] = useState<any[]>([]);
    const [isConnected, setIsConnected] = useState(false);

    useEffect(() => {
        let isMounted = true;

        const fetchMetrics = async () => {
            try {
                const res = await fetch('/api/telemetry/metrics');
                if (res.ok) {
                    const data = await res.json();
                    if (isMounted && data.ok) {
                        setSurpriseData(data.surprise || []);
                        setActionData(data.actions || []);
                        setIsConnected(true);
                    }
                } else {
                    setIsConnected(false);
                }
            } catch (err) {
                console.error("No se pudo conectar a la Telemetría", err);
                setIsConnected(false);
            }
        };

        // Fetch inicial e intervalo de sondeo cada 2 segundos
        fetchMetrics();
        const interval = setInterval(fetchMetrics, 2000);

        return () => {
            isMounted = false;
            clearInterval(interval);
        };
    }, []);

    return (
        <div className="min-h-screen bg-gray-900 text-gray-100 p-8 font-sans">
            <div className="max-w-7xl mx-auto space-y-6">

                <div className="flex items-center justify-between mb-8">
                    <div>
                        <h1 className="text-3xl font-bold text-white tracking-tight">Agent Telemetry & Observability</h1>
                        <p className="text-gray-400 mt-1">Real-time analytical metrics from ClickHouse & MCTS</p>
                    </div>
                    <div className={`flex items-center space-x-3 bg-gray-800 px-4 py-2 rounded-full border ${isConnected ? 'border-gray-700' : 'border-red-900'}`}>
                        <div className={`w-3 h-3 rounded-full ${isConnected ? 'bg-green-500 animate-pulse' : 'bg-red-500'}`}></div>
                        <span className={`text-sm font-medium ${isConnected ? 'text-green-400' : 'text-red-400'}`}>
                            {isConnected ? 'Daemon Connected' : 'Disconnected'}
                        </span>
                    </div>
                </div>

                {/* Top Charts */}
                <div className="flex flex-col gap-6">
                    <SurpriseGraph data={surpriseData} />

                    <div className="bg-gray-800 p-4 rounded-xl shadow-lg border border-gray-700 flex flex-col justify-center items-center w-full min-h-[500px]">
                        <MCTSVisualizer />
                    </div>
                </div>

                {/* Bottom Timeline */}
                <div className="w-full">
                    <AgentActivityTimeline actions={actionData} />
                </div>

            </div>
        </div>
    );
};

export default TelemetryDashboard;
