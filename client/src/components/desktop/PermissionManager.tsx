import React, { useState, useEffect } from 'react';
import { ShieldAlert, MonitorUp, Accessibility, CheckCircle2, ChevronRight } from 'lucide-react';
import { Card, CardHeader, CardTitle, CardContent, CardFooter } from '@/components/ui/card';
import { Button } from '@/components/ui/button';

declare global {
    interface Window {
        electron?: {
            ipcRenderer: {
                send: (channel: string) => void;
            };
        };
    }
}

interface PermissionStatus {
    screenRecording: boolean;
    accessibility: boolean;
}

export default function PermissionManager() {
    const [status, setStatus] = useState<PermissionStatus>({
        screenRecording: false,
        accessibility: false,
    });
    const [isChecking, setIsChecking] = useState(true);

    const checkPermissions = async () => {
        setIsChecking(true);
        if (window.electron) {
            // Note: the backend actually exposes these checks natively in production.
            // For now we mock the IPC query that would verify macOS TCC DB status.
            setTimeout(() => {
                setStatus({
                    screenRecording: process.platform !== 'darwin', // Auto-true for Windows
                    accessibility: process.platform !== 'darwin',
                });
                setIsChecking(false);
            }, 800);
        } else {
            setIsChecking(false);
        }
    };

    useEffect(() => {
        checkPermissions();
    }, []);

    const requestScreenRecording = () => {
        if (window.electron) {
            window.electron.ipcRenderer.send('permissions:request-screen');
            // Trigger loop check
            setTimeout(checkPermissions, 3000);
        }
    };

    const requestAccessibility = () => {
        if (window.electron) {
            window.electron.ipcRenderer.send('permissions:request-accessibility');
            // Trigger loop check
            setTimeout(checkPermissions, 3000);
        }
    };

    const isAllGranted = status.screenRecording && status.accessibility;

    return (
        <div className="flex flex-col items-center justify-center min-h-[500px] p-6 max-w-2xl mx-auto">
            <div className="text-center mb-8">
                <ShieldAlert className="w-16 h-16 text-blue-500 mx-auto mb-4" />
                <h1 className="text-3xl font-bold tracking-tight text-white mb-2">System Permissions Required</h1>
                <p className="text-slate-400">
                    To operate autonomously, the Agent requires strict OS-level capabilities to view your screen and interact with other applications.
                </p>
            </div>

            <div className="w-full space-y-4">
                {/* Screen Recording */}
                <Card className={`border ${status.screenRecording ? 'border-green-500/30 bg-green-950/20' : 'border-slate-800 bg-slate-900/50'}`}>
                    <CardContent className="flex items-center justify-between p-6">
                        <div className="flex items-center gap-4">
                            <div className={`p-3 rounded-full ${status.screenRecording ? 'bg-green-500/20' : 'bg-blue-500/20'}`}>
                                <MonitorUp className={`w-6 h-6 ${status.screenRecording ? 'text-green-400' : 'text-blue-400'}`} />
                            </div>
                            <div>
                                <h3 className="font-semibold text-white">Screen Recording</h3>
                                <p className="text-sm text-slate-400">Allows the Vision Pipeline to capture optical frames.</p>
                            </div>
                        </div>
                        <div>
                            {status.screenRecording ? (
                                <Badge variant="outline" className="text-green-400 border-green-500/50 flex gap-2 py-1.5 px-3">
                                    <CheckCircle2 className="w-4 h-4" /> Granted
                                </Badge>
                            ) : (
                                <Button onClick={requestScreenRecording} variant="default" className="gap-2">
                                    Grant Access <ChevronRight className="w-4 h-4" />
                                </Button>
                            )}
                        </div>
                    </CardContent>
                </Card>

                {/* Accessibility */}
                <Card className={`border ${status.accessibility ? 'border-green-500/30 bg-green-950/20' : 'border-slate-800 bg-slate-900/50'}`}>
                    <CardContent className="flex items-center justify-between p-6">
                        <div className="flex items-center gap-4">
                            <div className={`p-3 rounded-full ${status.accessibility ? 'bg-green-500/20' : 'bg-purple-500/20'}`}>
                                <Accessibility className={`w-6 h-6 ${status.accessibility ? 'text-green-400' : 'text-purple-400'}`} />
                            </div>
                            <div>
                                <h3 className="font-semibold text-white">Accessibility Control</h3>
                                <p className="text-sm text-slate-400">Allows parsing UI elements and dispatching mouse/keyboard events.</p>
                            </div>
                        </div>
                        <div>
                            {status.accessibility ? (
                                <Badge variant="outline" className="text-green-400 border-green-500/50 flex gap-2 py-1.5 px-3">
                                    <CheckCircle2 className="w-4 h-4" /> Granted
                                </Badge>
                            ) : (
                                <Button onClick={requestAccessibility} variant="default" className="gap-2 bg-purple-600 hover:bg-purple-700">
                                    Grant Access <ChevronRight className="w-4 h-4" />
                                </Button>
                            )}
                        </div>
                    </CardContent>
                </Card>
            </div>

            <div className="mt-8 text-center">
                <Button
                    variant={isAllGranted ? "default" : "secondary"}
                    size="lg"
                    className={`w-64 ${isAllGranted ? 'bg-green-600 hover:bg-green-700' : ''}`}
                    disabled={!isAllGranted}
                >
                    {isAllGranted ? "Continue to Dashboard" : "Waiting for Permissions..."}
                </Button>
            </div>
        </div>
    );
}

// Needed for Badge inside the component since we didn't import it at the top
import { Badge } from '@/components/ui/badge';
