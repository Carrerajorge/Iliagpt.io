import { useState, useRef, useEffect, useMemo, useCallback } from "react";
import { Button } from "@/components/ui/button";
import { Maximize2, Minimize2, Plus, Minus, ExternalLink, Copy, Check, RotateCcw } from "lucide-react";
import { useToast } from "@/hooks/use-toast";

type DiagramType = "flowchart" | "orgchart" | "mindmap" | "sequence" | "network";

interface FigmaNode {
  id: string;
  type: "start" | "end" | "process" | "decision" | "role" | "department" | "person";
  label: string;
  x: number;
  y: number;
  level?: number;
  parentId?: string;
}

interface FigmaConnection {
  from: string;
  to: string;
  label?: string;
}

interface FigmaDiagram {
  diagramType: DiagramType;
  nodes: FigmaNode[];
  connections: FigmaConnection[];
  title?: string;
}

interface FigmaBlockProps {
  diagram: FigmaDiagram;
  fileUrl?: string;
}

const FONT_FAMILY = "Inter, system-ui, sans-serif";
const FONT_SIZE = 13;
const MIN_NODE_WIDTH = 100;
const MAX_NODE_WIDTH = 200;
const MAX_NODE_WIDTH_ORGCHART = 180;
const NODE_HEIGHT = 50;
const HORIZONTAL_PADDING = 24;
const MAX_LABEL_LENGTH = 20;
const MAX_LABEL_LENGTH_ORGCHART = 25;

function truncateLabel(label: string, maxLength: number = MAX_LABEL_LENGTH): { text: string; isTruncated: boolean } {
  if (label.length <= maxLength) return { text: label, isTruncated: false };
  return { text: label.slice(0, maxLength - 1) + "…", isTruncated: true };
}

function estimateTextWidth(text: string, fontSize: number = FONT_SIZE): number {
  const avgCharWidth = fontSize * 0.55;
  return text.length * avgCharWidth;
}

function getNodeDimensions(label: string, isOrgChart: boolean = false): { width: number; height: number } {
  const maxLen = isOrgChart ? MAX_LABEL_LENGTH_ORGCHART : MAX_LABEL_LENGTH;
  const maxWidth = isOrgChart ? MAX_NODE_WIDTH_ORGCHART : MAX_NODE_WIDTH;
  const { text } = truncateLabel(label, maxLen);
  const textWidth = estimateTextWidth(text);
  const width = Math.min(maxWidth, Math.max(MIN_NODE_WIDTH, textWidth + HORIZONTAL_PADDING));
  return { width, height: NODE_HEIGHT };
}

export function FigmaBlock({ diagram, fileUrl }: FigmaBlockProps) {
  const [zoom, setZoom] = useState(1);
  const [isMaximized, setIsMaximized] = useState(false);
  const [copied, setCopied] = useState(false);
  const [fontsLoaded, setFontsLoaded] = useState(false);
  const { toast } = useToast();
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    document.fonts.ready.then(() => setFontsLoaded(true));
  }, []);

  const nodeDimensions = useMemo(() => {
    const dims: Record<string, { width: number; height: number }> = {};
    const isOrgChart = diagram.diagramType === "orgchart";
    diagram.nodes.forEach(node => {
      dims[node.id] = getNodeDimensions(node.label, isOrgChart);
    });
    return dims;
  }, [diagram.nodes, diagram.diagramType]);

  const contentBounds = useMemo(() => {
    const padding = 60;

    if (diagram.nodes.length === 0) {
      return { minX: 0, minY: 0, maxX: 400, maxY: 200, width: 400, height: 200 };
    }

    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;

    diagram.nodes.forEach(node => {
      const dims = nodeDimensions[node.id] || { width: MIN_NODE_WIDTH, height: NODE_HEIGHT };
      minX = Math.min(minX, node.x);
      minY = Math.min(minY, node.y);
      maxX = Math.max(maxX, node.x + dims.width);
      maxY = Math.max(maxY, node.y + dims.height);
    });

    return {
      minX: minX - padding,
      minY: minY - padding,
      maxX: maxX + padding,
      maxY: maxY + padding,
      width: maxX - minX + padding * 2,
      height: maxY - minY + padding * 2
    };
  }, [diagram.nodes, nodeDimensions]);

  const handleZoomIn = () => setZoom(prev => Math.min(prev + 0.25, 2));
  const handleZoomOut = () => setZoom(prev => Math.max(prev - 0.25, 0.5));
  const handleResetZoom = useCallback(() => setZoom(1), []);

  // FRONTEND FIX #27: Add noopener,noreferrer to external links
  const handleEditInFigma = () => {
    if (fileUrl) {
      window.open(fileUrl, '_blank', 'noopener,noreferrer');
    } else {
      // Open Figma new file page
      window.open('https://www.figma.com/files/recents-and-sharing/recently-viewed', '_blank', 'noopener,noreferrer');
      toast({
        title: "Abre Figma",
        description: "Crea un nuevo archivo de diseño y recrea el diagrama mostrado aquí.",
      });
    }
  };

  const handleCopyDiagram = () => {
    const diagramText = diagram.nodes.map(n => `${n.type}: ${n.label}`).join('\n');
    navigator.clipboard.writeText(diagramText);
    setCopied(true);
    toast({
      title: "Diagrama copiado",
      description: "Los pasos del diagrama han sido copiados al portapapeles.",
    });
    setTimeout(() => setCopied(false), 2000);
  };

  const getNodePath = (node: FigmaNode) => {
    const dims = nodeDimensions[node.id] || { width: MIN_NODE_WIDTH, height: NODE_HEIGHT };
    const { width, height } = dims;

    switch (node.type) {
      case "start":
      case "end":
        const r = height / 2;
        return `M ${node.x + r} ${node.y} 
                L ${node.x + width - r} ${node.y}
                A ${r} ${r} 0 0 1 ${node.x + width - r} ${node.y + height}
                L ${node.x + r} ${node.y + height}
                A ${r} ${r} 0 0 1 ${node.x + r} ${node.y} Z`;
      case "decision":
        const cx = node.x + width / 2;
        const cy = node.y + height / 2;
        return `M ${cx} ${node.y - 5} L ${node.x + width + 10} ${cy} L ${cx} ${node.y + height + 5} L ${node.x - 10} ${cy} Z`;
      case "process":
      default:
        return `M ${node.x} ${node.y} L ${node.x + width} ${node.y} L ${node.x + width} ${node.y + height} L ${node.x} ${node.y + height} Z`;
    }
  };

  const getNodeCenter = (node: FigmaNode) => {
    const dims = nodeDimensions[node.id] || { width: MIN_NODE_WIDTH, height: NODE_HEIGHT };
    return {
      x: node.x + dims.width / 2,
      y: node.y + dims.height / 2
    };
  };

  const getNodeAnchor = (node: FigmaNode, position: "top" | "bottom" | "left" | "right") => {
    const dims = nodeDimensions[node.id] || { width: MIN_NODE_WIDTH, height: NODE_HEIGHT };
    const cx = node.x + dims.width / 2;
    const cy = node.y + dims.height / 2;
    switch (position) {
      case "top": return { x: cx, y: node.y };
      case "bottom": return { x: cx, y: node.y + dims.height };
      case "left": return { x: node.x, y: cy };
      case "right": return { x: node.x + dims.width, y: cy };
    }
  };

  const renderConnection = (conn: FigmaConnection, index: number) => {
    const fromNode = diagram.nodes.find(n => n.id === conn.from);
    const toNode = diagram.nodes.find(n => n.id === conn.to);

    if (!fromNode || !toNode) return null;

    const isOrgChart = diagram.diagramType === "orgchart";

    if (isOrgChart) {
      const fromAnchor = getNodeAnchor(fromNode, "bottom");
      const toAnchor = getNodeAnchor(toNode, "top");
      const midY = (fromAnchor.y + toAnchor.y) / 2;

      const pathD = `M ${fromAnchor.x} ${fromAnchor.y} 
                     L ${fromAnchor.x} ${midY} 
                     L ${toAnchor.x} ${midY} 
                     L ${toAnchor.x} ${toAnchor.y}`;

      return (
        <g key={`conn-${index}`}>
          <path
            d={pathD}
            stroke="#666"
            strokeWidth="2"
            fill="none"
            strokeLinejoin="round"
          />
        </g>
      );
    }

    const from = getNodeCenter(fromNode);
    const to = getNodeCenter(toNode);

    const midX = (from.x + to.x) / 2;
    const midY = (from.y + to.y) / 2;

    return (
      <g key={`conn-${index}`}>
        <defs>
          <marker
            id={`arrowhead-${index}`}
            markerWidth="10"
            markerHeight="7"
            refX="9"
            refY="3.5"
            orient="auto"
          >
            <polygon points="0 0, 10 3.5, 0 7" fill="#666" />
          </marker>
        </defs>
        <line
          x1={from.x}
          y1={from.y}
          x2={to.x}
          y2={to.y}
          stroke="#666"
          strokeWidth="2"
          markerEnd={`url(#arrowhead-${index})`}
        />
        {conn.label && (
          <text
            x={midX}
            y={midY - 5}
            textAnchor="middle"
            dominantBaseline="middle"
            fontSize="12"
            fontFamily={FONT_FAMILY}
            fill="#F24E1E"
            fontWeight="500"
          >
            {conn.label}
          </text>
        )}
      </g>
    );
  };

  const getNodeStyle = (node: FigmaNode) => {
    const isOrgChart = diagram.diagramType === "orgchart";
    if (isOrgChart) {
      switch (node.type) {
        case "role": return { fill: "#E3F2FD", stroke: "#1976D2", fontWeight: "600" };
        case "department": return { fill: "#F3E5F5", stroke: "#7B1FA2", fontWeight: "500" };
        case "person": return { fill: "#E8F5E9", stroke: "#388E3C", fontWeight: "400" };
        default: return { fill: "#FFF3E0", stroke: "#F57C00", fontWeight: "500" };
      }
    }
    switch (node.type) {
      case "start": case "end": return { fill: "#f5f5f5", stroke: "#333", fontWeight: "600" };
      case "decision": return { fill: "white", stroke: "#F24E1E", fontWeight: "500" };
      default: return { fill: "white", stroke: "#333", fontWeight: "400" };
    }
  };

  const renderNode = (node: FigmaNode) => {
    const center = getNodeCenter(node);
    const isOrgChart = diagram.diagramType === "orgchart";
    const maxLen = isOrgChart ? MAX_LABEL_LENGTH_ORGCHART : MAX_LABEL_LENGTH;
    const { text: displayText, isTruncated } = truncateLabel(node.label, maxLen);
    const style = getNodeStyle(node);

    return (
      <g key={node.id}>
        {isTruncated && <title>{node.label}</title>}
        <path
          d={getNodePath(node)}
          fill={style.fill}
          stroke={style.stroke}
          strokeWidth="2"
        />
        <text
          x={center.x}
          y={center.y}
          textAnchor="middle"
          dominantBaseline="middle"
          fontSize={FONT_SIZE}
          fontFamily={FONT_FAMILY}
          fill="#333"
          fontWeight={style.fontWeight}
        >
          {displayText}
        </text>
      </g>
    );
  };

  return (
    <div className={`relative rounded-xl border bg-card overflow-hidden ${isMaximized ? 'fixed inset-4 z-50' : ''}`}>
      <div className="flex items-center justify-between px-4 py-2 border-b bg-muted/30">
        <div className="flex items-center gap-2">
          <svg width="16" height="24" viewBox="0 0 38 57" fill="none">
            <path d="M19 28.5C19 23.2533 23.2533 19 28.5 19C33.7467 19 38 23.2533 38 28.5C38 33.7467 33.7467 38 28.5 38C23.2533 38 19 33.7467 19 28.5Z" fill="#1ABCFE" />
            <path d="M0 47.5C0 42.2533 4.25329 38 9.5 38H19V47.5C19 52.7467 14.7467 57 9.5 57C4.25329 57 0 52.7467 0 47.5Z" fill="#0ACF83" />
            <path d="M19 0V19H28.5C33.7467 19 38 14.7467 38 9.5C38 4.25329 33.7467 0 28.5 0H19Z" fill="#FF7262" />
            <path d="M0 9.5C0 14.7467 4.25329 19 9.5 19H19V0H9.5C4.25329 0 0 4.25329 0 9.5Z" fill="#F24E1E" />
            <path d="M0 28.5C0 33.7467 4.25329 38 9.5 38H19V19H9.5C4.25329 19 0 23.2533 0 28.5Z" fill="#A259FF" />
          </svg>
          <span className="text-sm font-medium">Figma</span>
        </div>
        <button
          onClick={() => setIsMaximized(!isMaximized)}
          className="p-1 rounded hover:bg-accent"
        >
          {isMaximized ? <Minimize2 className="h-4 w-4" /> : <Maximize2 className="h-4 w-4" />}
        </button>
      </div>

      <div
        ref={containerRef}
        className="relative bg-[#f5f5f5] overflow-auto"
        style={{
          backgroundImage: 'radial-gradient(circle, #ddd 1px, transparent 1px)',
          backgroundSize: '20px 20px',
          minHeight: isMaximized ? 'calc(100% - 100px)' : '350px'
        }}
      >
        <svg
          width="100%"
          height="100%"
          viewBox={`${contentBounds.minX} ${contentBounds.minY} ${contentBounds.width} ${contentBounds.height}`}
          preserveAspectRatio="xMidYMid meet"
          style={{
            minWidth: Math.max(contentBounds.width * zoom, 400),
            minHeight: Math.max(contentBounds.height * zoom, 300),
            display: 'block'
          }}
        >
          {diagram.connections.map((conn, i) => renderConnection(conn, i))}
          {diagram.nodes.map(node => renderNode(node))}
        </svg>
      </div>

      <div className="flex items-center justify-between px-4 py-2 border-t bg-muted/30">
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            className="gap-2"
            onClick={handleEditInFigma}
            data-testid="button-edit-figma"
          >
            <svg width="12" height="18" viewBox="0 0 38 57" fill="none">
              <path d="M19 28.5C19 23.2533 23.2533 19 28.5 19C33.7467 19 38 23.2533 38 28.5C38 33.7467 33.7467 38 28.5 38C23.2533 38 19 33.7467 19 28.5Z" fill="#1ABCFE" />
              <path d="M0 47.5C0 42.2533 4.25329 38 9.5 38H19V47.5C19 52.7467 14.7467 57 9.5 57C4.25329 57 0 52.7467 0 47.5Z" fill="#0ACF83" />
              <path d="M19 0V19H28.5C33.7467 19 38 14.7467 38 9.5C38 4.25329 33.7467 0 28.5 0H19Z" fill="#FF7262" />
              <path d="M0 9.5C0 14.7467 4.25329 19 9.5 19H19V0H9.5C4.25329 0 0 4.25329 0 9.5Z" fill="#F24E1E" />
              <path d="M0 28.5C0 33.7467 4.25329 38 9.5 38H19V19H9.5C4.25329 19 0 23.2533 0 28.5Z" fill="#A259FF" />
            </svg>
            Edit in Figma
            <ExternalLink className="h-3 w-3" />
          </Button>
          <Button
            variant="ghost"
            size="sm"
            className="gap-2"
            onClick={handleCopyDiagram}
            data-testid="button-copy-diagram"
          >
            {copied ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
            {copied ? "Copiado" : "Copiar"}
          </Button>
        </div>
        <div className="flex items-center gap-1">
          <Button variant="ghost" size="icon" className="h-8 w-8" onClick={handleZoomOut} data-testid="button-zoom-out">
            <Minus className="h-4 w-4" />
          </Button>
          <span className="text-xs text-muted-foreground min-w-[3rem] text-center">{Math.round(zoom * 100)}%</span>
          <Button variant="ghost" size="icon" className="h-8 w-8" onClick={handleZoomIn} data-testid="button-zoom-in">
            <Plus className="h-4 w-4" />
          </Button>
          <Button variant="ghost" size="icon" className="h-8 w-8" onClick={handleResetZoom} data-testid="button-reset-zoom" title="Reset zoom">
            <RotateCcw className="h-4 w-4" />
          </Button>
        </div>
      </div>
    </div>
  );
}

export function parseFigmaDiagram(text: string): FigmaDiagram | null {
  try {
    const match = text.match(/```figma\s*([\s\S]*?)```/);
    if (match) {
      const parsed = JSON.parse(match[1]);
      return {
        diagramType: parsed.diagramType || "flowchart",
        nodes: parsed.nodes || [],
        connections: parsed.connections || [],
        title: parsed.title
      };
    }
    return null;
  } catch {
    return null;
  }
}

export function generateFlowchartFromDescription(description: string): FigmaDiagram {
  const steps = description.split(/[,;]|\sy\s/).map(s => s.trim()).filter(s => s.length > 0);

  const nodes: FigmaNode[] = [
    { id: "start", type: "start", label: "Inicio", x: 50, y: 175 }
  ];

  const connections: FigmaConnection[] = [];
  let lastId = "start";
  let xPos = 200;

  steps.forEach((step, index) => {
    const id = `step-${index}`;
    const isDecision = step.toLowerCase().includes("decisión") || step.toLowerCase().includes("decision") || step.includes("?");

    nodes.push({
      id,
      type: isDecision ? "decision" : "process",
      label: step.length > 15 ? step.substring(0, 15) + "..." : step,
      x: xPos,
      y: 175
    });

    connections.push({ from: lastId, to: id });
    lastId = id;
    xPos += 150;
  });

  nodes.push({ id: "end", type: "end", label: "Fin", x: xPos, y: 175 });
  connections.push({ from: lastId, to: "end" });

  return { diagramType: "flowchart", nodes, connections };
}
