/**
 * Citation Graph Component
 * 
 * Features:
 * - D3.js force-directed graph visualization
 * - Interactive node exploration
 * - Zoom and pan controls
 * - Export as image/SVG
 */

import React, { useEffect, useRef, useState, useCallback } from "react";
import * as d3 from "d3";

export interface CitationNode {
    id: string;
    title: string;
    authors?: string;
    year?: number;
    citations?: number;
    type: "source" | "citing" | "cited";
    url?: string;
}

export interface CitationLink {
    source: string;
    target: string;
    type: "cites" | "cited_by";
}

export interface CitationGraphProps {
    nodes: CitationNode[];
    links: CitationLink[];
    width?: number;
    height?: number;
    onNodeClick?: (node: CitationNode) => void;
    onNodeHover?: (node: CitationNode | null) => void;
    className?: string;
}

export const CitationGraph: React.FC<CitationGraphProps> = ({
    nodes,
    links,
    width = 800,
    height = 600,
    onNodeClick,
    onNodeHover,
    className = "",
}) => {
    const svgRef = useRef<SVGSVGElement>(null);
    const containerRef = useRef<HTMLDivElement>(null);
    const [selectedNode, setSelectedNode] = useState<CitationNode | null>(null);
    const [tooltip, setTooltip] = useState<{ x: number; y: number; node: CitationNode } | null>(null);

    // Color scale based on node type
    const getNodeColor = useCallback((type: CitationNode["type"]) => {
        switch (type) {
            case "source": return "#dc2626"; // red
            case "citing": return "#2563eb"; // blue
            case "cited": return "#16a34a"; // green
            default: return "#6b7280"; // gray
        }
    }, []);

    // Node size based on citations
    const getNodeRadius = useCallback((node: CitationNode) => {
        const base = node.type === "source" ? 12 : 8;
        const citationBonus = Math.min(8, Math.sqrt(node.citations || 0) / 2);
        return base + citationBonus;
    }, []);

    useEffect(() => {
        if (!svgRef.current || nodes.length === 0) return;

        const svg = d3.select(svgRef.current);
        svg.selectAll("*").remove();

        // Create container group for zoom
        const g = svg.append("g");

        // Zoom behavior
        const zoom = d3.zoom<SVGSVGElement, unknown>()
            .scaleExtent([0.1, 4])
            .on("zoom", (event) => {
                g.attr("transform", event.transform);
            });

        svg.call(zoom);

        // Create force simulation
        const simulation = d3.forceSimulation(nodes as d3.SimulationNodeDatum[])
            .force("link", d3.forceLink(links)
                .id((d: any) => d.id)
                .distance(100)
            )
            .force("charge", d3.forceManyBody().strength(-200))
            .force("center", d3.forceCenter(width / 2, height / 2))
            .force("collision", d3.forceCollide().radius((d: any) => getNodeRadius(d) + 5));

        // Draw links
        const link = g.append("g")
            .attr("class", "links")
            .selectAll("line")
            .data(links)
            .join("line")
            .attr("stroke", "#999")
            .attr("stroke-opacity", 0.6)
            .attr("stroke-width", 1.5)
            .attr("marker-end", "url(#arrowhead)");

        // Arrow marker for directed links
        svg.append("defs").append("marker")
            .attr("id", "arrowhead")
            .attr("viewBox", "0 -5 10 10")
            .attr("refX", 20)
            .attr("refY", 0)
            .attr("markerWidth", 6)
            .attr("markerHeight", 6)
            .attr("orient", "auto")
            .append("path")
            .attr("fill", "#999")
            .attr("d", "M0,-5L10,0L0,5");

        // Draw nodes
        const node = g.append("g")
            .attr("class", "nodes")
            .selectAll("g")
            .data(nodes)
            .join("g")
            .attr("cursor", "pointer")
            .call((d3.drag<SVGGElement, CitationNode>() as any)
                .on("start", (event: any, d: any) => {
                    if (!event.active) simulation.alphaTarget(0.3).restart();
                    d.fx = d.x;
                    d.fy = d.y;
                })
                .on("drag", (event: any, d: any) => {
                    d.fx = event.x;
                    d.fy = event.y;
                })
                .on("end", (event: any, d: any) => {
                    if (!event.active) simulation.alphaTarget(0);
                    d.fx = null;
                    d.fy = null;
                })
            );

        // Node circles
        node.append("circle")
            .attr("r", (d) => getNodeRadius(d))
            .attr("fill", (d) => getNodeColor(d.type))
            .attr("stroke", "#fff")
            .attr("stroke-width", 2)
            .on("click", (event, d) => {
                event.stopPropagation();
                setSelectedNode(d);
                onNodeClick?.(d);
            })
            .on("mouseenter", (event, d) => {
                const rect = containerRef.current?.getBoundingClientRect();
                if (rect) {
                    setTooltip({
                        x: event.clientX - rect.left,
                        y: event.clientY - rect.top,
                        node: d,
                    });
                }
                onNodeHover?.(d);
            })
            .on("mouseleave", () => {
                setTooltip(null);
                onNodeHover?.(null);
            });

        // Node labels
        node.append("text")
            .attr("dy", (d) => getNodeRadius(d) + 12)
            .attr("text-anchor", "middle")
            .attr("font-size", "10px")
            .attr("fill", "#374151")
            .text((d) => {
                const maxLen = 20;
                return d.title.length > maxLen
                    ? d.title.substring(0, maxLen) + "..."
                    : d.title;
            });

        // Update positions on simulation tick
        simulation.on("tick", () => {
            link
                .attr("x1", (d: any) => d.source.x)
                .attr("y1", (d: any) => d.source.y)
                .attr("x2", (d: any) => d.target.x)
                .attr("y2", (d: any) => d.target.y);

            node.attr("transform", (d: any) => `translate(${d.x},${d.y})`);
        });

        // Cleanup
        return () => {
            simulation.stop();
        };
    }, [nodes, links, width, height, getNodeColor, getNodeRadius, onNodeClick, onNodeHover]);

    // Export as SVG
    const exportSVG = useCallback(() => {
        if (!svgRef.current) return;

        const svgData = new XMLSerializer().serializeToString(svgRef.current);
        const blob = new Blob([svgData], { type: "image/svg+xml" });
        const url = URL.createObjectURL(blob);

        const link = document.createElement("a");
        link.href = url;
        link.download = "citation-graph.svg";
        link.click();

        URL.revokeObjectURL(url);
    }, []);

    // Export as PNG
    const exportPNG = useCallback(() => {
        if (!svgRef.current) return;

        const svgData = new XMLSerializer().serializeToString(svgRef.current);
        const canvas = document.createElement("canvas");
        canvas.width = width * 2;
        canvas.height = height * 2;
        const ctx = canvas.getContext("2d");

        if (!ctx) return;

        const img = new Image();
        img.onload = () => {
            ctx.fillStyle = "white";
            ctx.fillRect(0, 0, canvas.width, canvas.height);
            ctx.drawImage(img, 0, 0, canvas.width, canvas.height);

            const link = document.createElement("a");
            link.href = canvas.toDataURL("image/png");
            link.download = "citation-graph.png";
            link.click();
        };
        img.src = "data:image/svg+xml;base64," + btoa(unescape(encodeURIComponent(svgData)));
    }, [width, height]);

    return (
        <div ref={containerRef} className={`relative ${className}`}>
            {/* Controls */}
            <div className="absolute top-2 right-2 flex gap-2 z-10">
                <button
                    onClick={exportSVG}
                    className="px-3 py-1 text-xs bg-gray-100 hover:bg-gray-200 rounded"
                >
                    Export SVG
                </button>
                <button
                    onClick={exportPNG}
                    className="px-3 py-1 text-xs bg-gray-100 hover:bg-gray-200 rounded"
                >
                    Export PNG
                </button>
            </div>

            {/* Legend */}
            <div className="absolute bottom-2 left-2 flex gap-4 text-xs z-10 bg-white/80 p-2 rounded">
                <div className="flex items-center gap-1">
                    <div className="w-3 h-3 rounded-full bg-red-600" />
                    <span>Source</span>
                </div>
                <div className="flex items-center gap-1">
                    <div className="w-3 h-3 rounded-full bg-blue-600" />
                    <span>Citing</span>
                </div>
                <div className="flex items-center gap-1">
                    <div className="w-3 h-3 rounded-full bg-green-600" />
                    <span>Cited</span>
                </div>
            </div>

            {/* SVG Canvas */}
            <svg
                ref={svgRef}
                width={width}
                height={height}
                className="border border-gray-200 rounded-lg bg-white"
            />

            {/* Tooltip */}
            {tooltip && (
                <div
                    className="absolute z-20 bg-gray-900 text-white text-xs p-2 rounded shadow-lg max-w-xs pointer-events-none"
                    ref={(el) => {
                        if (el) {
                            el.style.left = `${tooltip.x + 10}px`;
                            el.style.top = `${tooltip.y + 10}px`;
                        }
                    }}
                >
                    <div className="font-semibold">{tooltip.node.title}</div>
                    {tooltip.node.authors && (
                        <div className="text-gray-300">{tooltip.node.authors}</div>
                    )}
                    <div className="flex gap-2 mt-1 text-gray-400">
                        {tooltip.node.year && <span>{tooltip.node.year}</span>}
                        {tooltip.node.citations !== undefined && (
                            <span>Citations: {tooltip.node.citations}</span>
                        )}
                    </div>
                </div>
            )}

            {/* Selected node details */}
            {selectedNode && (
                <div className="absolute bottom-16 left-2 right-2 bg-white border border-gray-200 rounded-lg p-3 shadow-lg z-10">
                    <div className="flex justify-between items-start">
                        <div>
                            <h4 className="font-semibold text-sm">{selectedNode.title}</h4>
                            {selectedNode.authors && (
                                <p className="text-xs text-gray-500">{selectedNode.authors}</p>
                            )}
                            <div className="flex gap-3 mt-1 text-xs text-gray-400">
                                {selectedNode.year && <span>Year: {selectedNode.year}</span>}
                                {selectedNode.citations !== undefined && (
                                    <span>Citations: {selectedNode.citations}</span>
                                )}
                            </div>
                        </div>
                        <button
                            onClick={() => setSelectedNode(null)}
                            className="text-gray-400 hover:text-gray-600"
                        >
                            ✕
                        </button>
                    </div>
                    {selectedNode.url && (
                        <a
                            href={selectedNode.url}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="text-xs text-blue-600 hover:underline mt-2 block"
                        >
                            View paper →
                        </a>
                    )}
                </div>
            )}
        </div>
    );
};

export default CitationGraph;
