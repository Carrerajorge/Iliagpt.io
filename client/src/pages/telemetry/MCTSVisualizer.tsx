import React, { useRef, useState, useEffect, useCallback } from 'react';
import ForceGraph3D from 'react-force-graph-3d';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';

interface Node {
    id: string;
    name: string;
    val: number;
    color: string;
    depth: number;
    qValue: number;
    visits: number;
    surprise?: number;
}

interface Link {
    source: string;
    target: string;
    value: number;
}

interface GraphData {
    nodes: Node[];
    links: Link[];
}

export default function MCTSVisualizer() {
    const fgRef = useRef<any>(null);
    const [graphData, setGraphData] = useState<GraphData>({ nodes: [], links: [] });
    const [selectedNode, setSelectedNode] = useState<Node | null>(null);

    // Mock Data generation to simulate Brain's expanding Tree
    useEffect(() => {
        const nodes: Node[] = [];
        const links: Link[] = [];

        // Root Node
        nodes.push({
            id: 'root',
            name: 'Initial State',
            val: 10,
            color: '#ffffff',
            depth: 0,
            qValue: 0.5,
            visits: 100,
            surprise: 0.0
        });

        let nodeId = 1;
        // Layer 1
        for (let i = 0; i < 3; i++) {
            const id1 = `action_${nodeId++}`;
            nodes.push({ id: id1, name: `Click [${i}]`, val: 5, color: '#3b82f6', depth: 1, qValue: Math.random(), visits: 30, surprise: 0.2 });
            links.push({ source: 'root', target: id1, value: 2 });

            // Layer 2
            for (let j = 0; j < 4; j++) {
                const id2 = `action_${nodeId++}`;
                nodes.push({ id: id2, name: `Type [${j}]`, val: 3, color: '#10b981', depth: 2, qValue: Math.random(), visits: 10, surprise: 0.5 });
                links.push({ source: id1, target: id2, value: 1 });

                // Layer 3 (sparse)
                if (Math.random() > 0.5) {
                    const id3 = `action_${nodeId++}`;
                    nodes.push({ id: id3, name: `Scroll [${j}]`, val: 2, color: '#8b5cf6', depth: 3, qValue: Math.random(), visits: 3, surprise: 0.8 });
                    links.push({ source: id2, target: id3, value: 0.5 });
                }
            }
        }

        setGraphData({ nodes, links });
    }, []);

    const handleNodeClick = useCallback((node: Node) => {
        setSelectedNode(node);
        // Aim at node from outside it
        const distance = 40;
        const distRatio = 1 + distance / Math.hypot(node.x as number, node.y as number, node.z as number);

        fgRef.current?.cameraPosition(
            {
                x: (node.x as number) * distRatio,
                y: (node.y as number) * distRatio,
                z: (node.z as number) * distRatio
            }, // new position
            node, // lookAt
            3000  // ms transition duration
        );
    }, [fgRef]);

    return (
        <div className="flex h-[calc(100vh-8rem)] w-full gap-4">
            <Card className="flex-1 bg-black border-slate-800 overflow-hidden relative">
                <ForceGraph3D
                    ref={fgRef}
                    graphData={graphData}
                    nodeLabel="name"
                    nodeColor="color"
                    nodeVal="val"
                    linkWidth={1}
                    linkColor={() => 'rgba(255,255,255,0.2)'}
                    backgroundColor="#000000"
                    onNodeClick={handleNodeClick}
                    enableNodeDrag={false}
                />
                <div className="absolute top-4 left-4 z-10 pointers-none">
                    <h2 className="text-xl font-bold font-mono tracking-tighter text-white">MCTS Active Inference Tree</h2>
                    <p className="text-sm text-slate-400 font-mono mt-1">Real-time Autonomous Decision Graph</p>
                </div>
            </Card>

            {selectedNode && (
                <Card className="w-80 bg-black border-slate-800 shrink-0">
                    <CardHeader>
                        <CardTitle className="text-lg font-mono text-white">{selectedNode.name}</CardTitle>
                    </CardHeader>
                    <CardContent className="space-y-4">
                        <div>
                            <span className="text-xs text-slate-500 font-mono uppercase">Node ID</span>
                            <p className="font-mono text-sm text-slate-300">{selectedNode.id}</p>
                        </div>
                        <div>
                            <span className="text-xs text-slate-500 font-mono uppercase">Depth Layer</span>
                            <p className="font-mono text-sm text-slate-300 flex items-center gap-2">
                                {selectedNode.depth}
                                {selectedNode.depth === 0 && <Badge variant="outline" className="text-xs text-blue-400 border-blue-400/30">ROOT</Badge>}
                            </p>
                        </div>
                        <div className="grid grid-cols-2 gap-4">
                            <div>
                                <span className="text-xs text-slate-500 font-mono uppercase">Q-Value (Reward)</span>
                                <p className={`font-mono text-sm ${selectedNode.qValue > 0.6 ? 'text-green-400' : 'text-orange-400'}`}>
                                    {selectedNode.qValue.toFixed(4)}
                                </p>
                            </div>
                            <div>
                                <span className="text-xs text-slate-500 font-mono uppercase">Visits (N)</span>
                                <p className="font-mono text-sm text-slate-300">{selectedNode.visits}</p>
                            </div>
                        </div>
                        <div>
                            <span className="text-xs text-slate-500 font-mono uppercase">Unexpected Surprise (FE)</span>
                            <div className="w-full bg-slate-900 h-2 mt-1 rounded-full overflow-hidden">
                                <div
                                    className="bg-red-500 h-full transition-all"
                                    style={{ width: `${(selectedNode.surprise || 0) * 100}%` }}
                                />
                            </div>
                            <p className="font-mono text-xs text-slate-400 mt-1 text-right">
                                {((selectedNode.surprise || 0) * 100).toFixed(1)}%
                            </p>
                        </div>
                    </CardContent>
                </Card>
            )}
        </div>
    );
}
