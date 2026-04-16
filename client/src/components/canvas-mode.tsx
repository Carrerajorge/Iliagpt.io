/**
 * Canvas Mode Component - ILIAGPT PRO 3.0
 * 
 * Infinite canvas for visual collaboration.
 * Supports nodes, connections, images, and real-time editing.
 */

import React, { useState, useRef, useCallback, useEffect } from "react";

// ============== Types ==============

interface CanvasNode {
    id: string;
    type: NodeType;
    x: number;
    y: number;
    width: number;
    height: number;
    content: string;
    style?: NodeStyle;
    locked?: boolean;
    zIndex?: number;
}

type NodeType =
    | "text"
    | "image"
    | "code"
    | "ai_response"
    | "sticky"
    | "shape"
    | "embed";

interface NodeStyle {
    backgroundColor?: string;
    borderColor?: string;
    textColor?: string;
    fontSize?: number;
    fontWeight?: string;
}

interface Connection {
    id: string;
    fromNode: string;
    toNode: string;
    fromAnchor: Anchor;
    toAnchor: Anchor;
    style?: ConnectionStyle;
    label?: string;
}

type Anchor = "top" | "right" | "bottom" | "left";

interface ConnectionStyle {
    color?: string;
    width?: number;
    dashed?: boolean;
    arrowEnd?: boolean;
}

interface CanvasState {
    nodes: CanvasNode[];
    connections: Connection[];
    viewport: { x: number; y: number; zoom: number };
    selectedNodes: string[];
    isConnecting: boolean;
    connectingFrom: string | null;
}

interface CanvasProps {
    initialNodes?: CanvasNode[];
    initialConnections?: Connection[];
    onNodesChange?: (nodes: CanvasNode[]) => void;
    onConnectionsChange?: (connections: Connection[]) => void;
    readOnly?: boolean;
    className?: string;
}

// ============== Helpers ==============

const generateId = () => `node_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;

const NODE_COLORS: Record<NodeType, string> = {
    text: "#ffffff",
    image: "#f3f4f6",
    code: "#1e1e1e",
    ai_response: "#e8f5e9",
    sticky: "#fff59d",
    shape: "#e3f2fd",
    embed: "#fce4ec",
};

// ============== Canvas Component ==============

export function CanvasMode({
    initialNodes = [],
    initialConnections = [],
    onNodesChange,
    onConnectionsChange,
    readOnly = false,
    className = "",
}: CanvasProps) {
    const [state, setState] = useState<CanvasState>({
        nodes: initialNodes,
        connections: initialConnections,
        viewport: { x: 0, y: 0, zoom: 1 },
        selectedNodes: [],
        isConnecting: false,
        connectingFrom: null,
    });

    const canvasRef = useRef<HTMLDivElement>(null);
    const isDragging = useRef(false);
    const dragStart = useRef({ x: 0, y: 0 });
    const dragNode = useRef<string | null>(null);

    // ======== Viewport Controls ========

    const handleWheel = useCallback((e: React.WheelEvent) => {
        e.preventDefault();

        if (e.ctrlKey || e.metaKey) {
            // Zoom
            const delta = e.deltaY > 0 ? 0.9 : 1.1;
            setState(s => ({
                ...s,
                viewport: {
                    ...s.viewport,
                    zoom: Math.max(0.1, Math.min(3, s.viewport.zoom * delta)),
                },
            }));
        } else {
            // Pan
            setState(s => ({
                ...s,
                viewport: {
                    ...s.viewport,
                    x: s.viewport.x - e.deltaX,
                    y: s.viewport.y - e.deltaY,
                },
            }));
        }
    }, []);

    // ======== Node Operations ========

    const addNode = useCallback((
        type: NodeType,
        x: number,
        y: number,
        content: string = ""
    ): string => {
        const id = generateId();
        const node: CanvasNode = {
            id,
            type,
            x,
            y,
            width: type === "sticky" ? 200 : 300,
            height: type === "sticky" ? 150 : 200,
            content,
            style: { backgroundColor: NODE_COLORS[type] },
            zIndex: state.nodes.length,
        };

        setState(s => {
            const nodes = [...s.nodes, node];
            onNodesChange?.(nodes);
            return { ...s, nodes };
        });

        return id;
    }, [state.nodes.length, onNodesChange]);

    const updateNode = useCallback((id: string, updates: Partial<CanvasNode>) => {
        setState(s => {
            const nodes = s.nodes.map(n => n.id === id ? { ...n, ...updates } : n);
            onNodesChange?.(nodes);
            return { ...s, nodes };
        });
    }, [onNodesChange]);

    const deleteNode = useCallback((id: string) => {
        setState(s => {
            const nodes = s.nodes.filter(n => n.id !== id);
            const connections = s.connections.filter(c =>
                c.fromNode !== id && c.toNode !== id
            );
            onNodesChange?.(nodes);
            onConnectionsChange?.(connections);
            return { ...s, nodes, connections, selectedNodes: s.selectedNodes.filter(n => n !== id) };
        });
    }, [onNodesChange, onConnectionsChange]);

    // ======== Connection Operations ========

    const startConnection = useCallback((nodeId: string) => {
        setState(s => ({ ...s, isConnecting: true, connectingFrom: nodeId }));
    }, []);

    const endConnection = useCallback((nodeId: string) => {
        if (!state.connectingFrom || state.connectingFrom === nodeId) {
            setState(s => ({ ...s, isConnecting: false, connectingFrom: null }));
            return;
        }

        const connection: Connection = {
            id: `conn_${Date.now()}`,
            fromNode: state.connectingFrom,
            toNode: nodeId,
            fromAnchor: "right",
            toAnchor: "left",
            style: { arrowEnd: true },
        };

        setState(s => {
            const connections = [...s.connections, connection];
            onConnectionsChange?.(connections);
            return { ...s, connections, isConnecting: false, connectingFrom: null };
        });
    }, [state.connectingFrom, onConnectionsChange]);

    // ======== Drag Handling ========

    const handleMouseDown = useCallback((e: React.MouseEvent, nodeId?: string) => {
        if (readOnly) return;

        isDragging.current = true;
        dragStart.current = { x: e.clientX, y: e.clientY };
        dragNode.current = nodeId || null;

        if (nodeId) {
            setState(s => ({
                ...s,
                selectedNodes: e.shiftKey
                    ? s.selectedNodes.includes(nodeId)
                        ? s.selectedNodes.filter(n => n !== nodeId)
                        : [...s.selectedNodes, nodeId]
                    : [nodeId],
            }));
        } else {
            setState(s => ({ ...s, selectedNodes: [] }));
        }
    }, [readOnly]);

    const handleMouseMove = useCallback((e: React.MouseEvent) => {
        if (!isDragging.current) return;

        const dx = (e.clientX - dragStart.current.x) / state.viewport.zoom;
        const dy = (e.clientY - dragStart.current.y) / state.viewport.zoom;
        dragStart.current = { x: e.clientX, y: e.clientY };

        if (dragNode.current) {
            // Move node(s)
            setState(s => ({
                ...s,
                nodes: s.nodes.map(n =>
                    s.selectedNodes.includes(n.id) && !n.locked
                        ? { ...n, x: n.x + dx, y: n.y + dy }
                        : n
                ),
            }));
        } else {
            // Pan viewport
            setState(s => ({
                ...s,
                viewport: { ...s.viewport, x: s.viewport.x + dx, y: s.viewport.y + dy },
            }));
        }
    }, [state.viewport.zoom]);

    const handleMouseUp = useCallback(() => {
        if (isDragging.current && dragNode.current) {
            onNodesChange?.(state.nodes);
        }
        isDragging.current = false;
        dragNode.current = null;
    }, [state.nodes, onNodesChange]);

    // ======== Keyboard Shortcuts ========

    useEffect(() => {
        const handleKeyDown = (e: KeyboardEvent) => {
            if (readOnly) return;

            if (e.key === "Delete" || e.key === "Backspace") {
                state.selectedNodes.forEach(deleteNode);
            }

            if (e.key === "Escape") {
                setState(s => ({ ...s, selectedNodes: [], isConnecting: false, connectingFrom: null }));
            }

            if ((e.ctrlKey || e.metaKey) && e.key === "a") {
                e.preventDefault();
                setState(s => ({ ...s, selectedNodes: s.nodes.map(n => n.id) }));
            }
        };

        window.addEventListener("keydown", handleKeyDown);
        return () => window.removeEventListener("keydown", handleKeyDown);
    }, [readOnly, state.selectedNodes, deleteNode]);

    // ======== Render ========

    return (
        <div
            ref={canvasRef}
            className={`relative w-full h-full overflow-hidden bg-gray-100 ${className}`}
            style={{
                backgroundImage: `radial-gradient(circle, #ddd 1px, transparent 1px)`,
                backgroundSize: `${20 * state.viewport.zoom}px ${20 * state.viewport.zoom}px`,
                backgroundPosition: `${state.viewport.x}px ${state.viewport.y}px`,
            }}
            onWheel={handleWheel}
            onMouseDown={(e) => handleMouseDown(e)}
            onMouseMove={handleMouseMove}
            onMouseUp={handleMouseUp}
            onMouseLeave={handleMouseUp}
        >
            {/* Toolbar */}
            <div className="absolute top-4 left-4 z-50 flex gap-2 bg-white rounded-lg shadow-lg p-2">
                <ToolButton icon="📝" label="Text" onClick={() => addNode("text", 100, 100, "New text")} />
                <ToolButton icon="📌" label="Sticky" onClick={() => addNode("sticky", 100, 100, "Note")} />
                <ToolButton icon="💻" label="Code" onClick={() => addNode("code", 100, 100, "// code")} />
                <ToolButton icon="🤖" label="AI" onClick={() => addNode("ai_response", 100, 100, "AI response")} />
                <div className="w-px bg-gray-300" />
                <ToolButton icon="🔗" label="Connect" active={state.isConnecting} onClick={() => { }} />
            </div>

            {/* Zoom indicator */}
            <div className="absolute bottom-4 right-4 z-50 bg-white rounded-lg shadow px-3 py-1">
                {Math.round(state.viewport.zoom * 100)}%
            </div>

            {/* Canvas content */}
            <div
                style={{
                    transform: `translate(${state.viewport.x}px, ${state.viewport.y}px) scale(${state.viewport.zoom})`,
                    transformOrigin: "0 0",
                }}
            >
                {/* Connections */}
                <svg className="absolute inset-0 w-full h-full pointer-events-none" style={{ overflow: "visible" }}>
                    {state.connections.map(conn => {
                        const from = state.nodes.find(n => n.id === conn.fromNode);
                        const to = state.nodes.find(n => n.id === conn.toNode);
                        if (!from || !to) return null;

                        const x1 = from.x + from.width;
                        const y1 = from.y + from.height / 2;
                        const x2 = to.x;
                        const y2 = to.y + to.height / 2;

                        return (
                            <g key={conn.id}>
                                <path
                                    d={`M ${x1} ${y1} C ${x1 + 50} ${y1}, ${x2 - 50} ${y2}, ${x2} ${y2}`}
                                    fill="none"
                                    stroke={conn.style?.color || "#6366f1"}
                                    strokeWidth={conn.style?.width || 2}
                                    strokeDasharray={conn.style?.dashed ? "5,5" : undefined}
                                    markerEnd={conn.style?.arrowEnd ? "url(#arrowhead)" : undefined}
                                />
                            </g>
                        );
                    })}
                    <defs>
                        <marker id="arrowhead" markerWidth="10" markerHeight="7" refX="10" refY="3.5" orient="auto">
                            <polygon points="0 0, 10 3.5, 0 7" fill="#6366f1" />
                        </marker>
                    </defs>
                </svg>

                {/* Nodes */}
                {state.nodes.map(node => (
                    <CanvasNodeComponent
                        key={node.id}
                        node={node}
                        selected={state.selectedNodes.includes(node.id)}
                        isConnecting={state.isConnecting}
                        onMouseDown={(e) => {
                            e.stopPropagation();
                            if (state.isConnecting) {
                                endConnection(node.id);
                            } else {
                                handleMouseDown(e, node.id);
                            }
                        }}
                        onStartConnect={() => startConnection(node.id)}
                        onContentChange={(content) => updateNode(node.id, { content })}
                        readOnly={readOnly}
                    />
                ))}
            </div>
        </div>
    );
}

// ============== Sub-components ==============

interface ToolButtonProps {
    icon: string;
    label: string;
    onClick: () => void;
    active?: boolean;
}

function ToolButton({ icon, label, onClick, active }: ToolButtonProps) {
    return (
        <button
            className={`flex flex-col items-center px-3 py-1 rounded transition-colors ${active ? "bg-indigo-100 text-indigo-700" : "hover:bg-gray-100"
                }`}
            onClick={onClick}
            title={label}
        >
            <span className="text-lg">{icon}</span>
            <span className="text-xs text-gray-600">{label}</span>
        </button>
    );
}

interface CanvasNodeProps {
    node: CanvasNode;
    selected: boolean;
    isConnecting: boolean;
    onMouseDown: (e: React.MouseEvent) => void;
    onStartConnect: () => void;
    onContentChange: (content: string) => void;
    readOnly: boolean;
}

function CanvasNodeComponent({
    node,
    selected,
    isConnecting,
    onMouseDown,
    onStartConnect,
    onContentChange,
    readOnly,
}: CanvasNodeProps) {
    const isCode = node.type === "code";

    return (
        <div
            className={`absolute rounded-lg shadow-lg overflow-hidden ${selected ? "ring-2 ring-indigo-500" : ""
                } ${isConnecting ? "cursor-crosshair" : "cursor-move"}`}
            style={{
                left: node.x,
                top: node.y,
                width: node.width,
                height: node.height,
                backgroundColor: node.style?.backgroundColor || "#fff",
                color: isCode ? "#fff" : node.style?.textColor || "#000",
                zIndex: node.zIndex,
            }}
            onMouseDown={onMouseDown}
        >
            {/* Header */}
            <div className="flex items-center justify-between px-2 py-1 bg-gray-100 border-b">
                <span className="text-xs font-medium capitalize">{node.type.replace("_", " ")}</span>
                {!readOnly && (
                    <button
                        className="w-5 h-5 rounded-full bg-gray-200 hover:bg-indigo-500 hover:text-white text-xs"
                        onClick={(e) => {
                            e.stopPropagation();
                            onStartConnect();
                        }}
                    >
                        →
                    </button>
                )}
            </div>

            {/* Content */}
            <div className="p-2 h-full overflow-auto">
                {readOnly ? (
                    <div className={isCode ? "font-mono text-sm" : "text-sm"}>
                        {node.content}
                    </div>
                ) : (
                    <textarea
                        className={`w-full h-full resize-none bg-transparent outline-none ${isCode ? "font-mono text-sm" : "text-sm"
                            }`}
                        value={node.content}
                        onChange={(e) => onContentChange(e.target.value)}
                        onClick={(e) => e.stopPropagation()}
                    />
                )}
            </div>
        </div>
    );
}

export default CanvasMode;
