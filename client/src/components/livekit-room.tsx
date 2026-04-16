import React, { useState, useEffect } from 'react';
import {
    LiveKitRoom,
    VideoConference,
    RoomAudioRenderer,
} from '@livekit/components-react';
import '@livekit/components-styles';

interface LiveKitRoomProps {
    roomName: string;
    participantName: string;
    onDisconnected: () => void;
}

export function AgentLiveKitRoom({ roomName, participantName, onDisconnected }: LiveKitRoomProps) {
    const [token, setToken] = useState('');
    const [serverUrl, setServerUrl] = useState('');
    const [error, setError] = useState('');

    useEffect(() => {
        async function fetchToken() {
            try {
                const response = await fetch('/api/livekit/token', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        roomName,
                        participantName,
                        participantIdentity: `user - ${Date.now()} `
                    })
                });

                if (!response.ok) {
                    throw new Error(`Failed to fetch token: ${response.statusText} `);
                }

                const data = await response.json();
                setToken(data.token);
                setServerUrl(data.serverUrl);
            } catch (err: unknown) {
                console.error('Error fetching LiveKit token:', err);
                setError(err instanceof Error ? err.message : 'Could not connect to voice server');
            }
        }

        fetchToken();
    }, [roomName, participantName]);

    if (error) {
        return (
            <div className="flex flex-col items-center justify-center p-8 bg-red-500/10 text-red-500 rounded-lg">
                <p className="font-semibold mb-4">Error conectando con LiveKit</p>
                <p className="text-sm opacity-80">{error}</p>
                <button onClick={onDisconnected} className="mt-4 px-4 py-2 bg-red-500/20 rounded hover:bg-red-500/30">
                    Cerrar
                </button>
            </div>
        );
    }

    if (!token || !serverUrl) {
        return (
            <div className="flex flex-col items-center justify-center p-12 text-muted-foreground animate-pulse">
                <div className="w-8 h-8 rounded-full border-t-2 border-primary animate-spin mb-4" />
                <p>Conectando con el Agente...</p>
            </div>
        );
    }

    return (
        <LiveKitRoom
            video={false}
            audio={true}
            token={token}
            serverUrl={serverUrl}
            onDisconnected={onDisconnected}
            className="w-full h-full min-h-[400px] flex flex-col bg-background/50 rounded-lg border border-border/50 overflow-hidden shadow-2xl relative"
        >
            <VideoConference />
            <RoomAudioRenderer />

            <div className="absolute top-4 right-4 z-50">
                <button
                    onClick={onDisconnected}
                    className="w-8 h-8 rounded-full bg-red-500/80 hover:bg-red-500 text-white flex items-center justify-center transition-colors shadow-lg"
                    title="Colgar llamada"
                >
                    <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M10.68 13.31a16 16 0 0 0 3.41 2.6l1.27-1.27a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7 2 2 0 0 1 1.72 2v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.42 19.42 0 0 1-3.33-2.67m-2.67-3.34a19.79 19.79 0 0 1-3.07-8.63A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72 12.84 12.84 0 0 0 .7 2.81 2 2 0 0 1-.45 2.11L8.09 9.91" /><line x1="23" y1="1" x2="1" y2="23" /></svg>
                </button>
            </div>
        </LiveKitRoom>
    );
}
