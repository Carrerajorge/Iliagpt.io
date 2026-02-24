import React, { useState, useEffect } from 'react';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Play, FileArchive, Clock } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';

interface CheckpointData {
    id: string;
    timestamp: string;
    sizeKb: number;
    isValid: boolean;
}

export default function Checkpoints() {
    const [checkpoints, setCheckpoints] = useState<CheckpointData[]>([]);
    const [isLoading, setIsLoading] = useState(true);
    const { toast } = useToast();

    const fetchCheckpoints = async () => {
        try {
            const res = await fetch('/api/admin/checkpoints');
            if (res.ok) {
                const data = await res.json();
                setCheckpoints(data.checkpoints || []);
            }
        } catch (e) {
            console.error("Failed to fetch checkpoints", e);
        } finally {
            setIsLoading(false);
        }
    };

    useEffect(() => {
        fetchCheckpoints();
    }, []);

    const handleResume = async (id: string) => {
        toast({
            title: "Resurrecting Agent",
            description: `Loading Context for Session ${id}...`,
        });

        try {
            const res = await fetch(`/api/admin/checkpoints/${id}/resume`, { method: 'POST' });
            if (res.ok) {
                toast({ title: "Success", description: "Agent successfully restored from checkpoint." });
            } else {
                toast({ title: "Error", description: "Failed to decompress and resume agent state.", variant: "destructive" });
            }
        } catch (e) {
            toast({ title: "Error", description: "Network error during resume.", variant: "destructive" });
        }
    };

    return (
        <div className="p-8 space-y-6 max-w-7xl mx-auto">
            <div className="flex justify-between items-center mb-6">
                <div>
                    <h1 className="text-3xl font-bold tracking-tight text-white mb-2">Agent Checkpoints</h1>
                    <p className="text-muted-foreground">Manage and Resurrect compressed ZSTD/Brotli autonomous session states.</p>
                </div>
                <Button onClick={fetchCheckpoints} variant="outline" className="gap-2">
                    <Clock className="w-4 h-4" />
                    Refresh Index
                </Button>
            </div>

            <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-3">
                {isLoading ? (
                    <div className="col-span-full py-12 text-center text-muted-foreground animate-pulse">Scanning Archive...</div>
                ) : checkpoints.length === 0 ? (
                    <div className="col-span-full py-12 text-center text-muted-foreground">No serialized checkpoints found.</div>
                ) : (
                    checkpoints.map((cp) => (
                        <Card key={cp.id} className="bg-card border-border shadow-md">
                            <CardHeader className="pb-2">
                                <CardTitle className="flex justify-between items-center text-lg">
                                    <span className="font-mono text-sm truncate w-2/3" title={cp.id}>{cp.id}</span>
                                    {cp.isValid ? (
                                        <Badge variant="default" className="bg-green-600/20 text-green-400 border-green-600">Valid</Badge>
                                    ) : (
                                        <Badge variant="destructive">Corrupted</Badge>
                                    )}
                                </CardTitle>
                            </CardHeader>
                            <CardContent className="space-y-4">
                                <div className="space-y-2">
                                    <div className="flex justify-between text-sm">
                                        <span className="text-muted-foreground flex items-center gap-1">
                                            <Clock className="w-3 h-3" /> Timestamp
                                        </span>
                                        <span className="text-foreground">{new Date(cp.timestamp).toLocaleString()}</span>
                                    </div>
                                    <div className="flex justify-between text-sm">
                                        <span className="text-muted-foreground flex items-center gap-1">
                                            <FileArchive className="w-3 h-3" /> Archive Size
                                        </span>
                                        <span className="text-foreground font-mono">{cp.sizeKb.toFixed(2)} KB</span>
                                    </div>
                                </div>
                                <Button
                                    className="w-full gap-2"
                                    onClick={() => handleResume(cp.id)}
                                    disabled={!cp.isValid}
                                >
                                    <Play className="w-4 h-4 fill-current" />
                                    Resume Session
                                </Button>
                            </CardContent>
                        </Card>
                    ))
                )}
            </div>
        </div>
    );
}
