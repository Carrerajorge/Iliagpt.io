import React, { useState, useCallback, useMemo, memo } from "react";
import DOMPurify from "dompurify";
import {
  Download,
  Eye,
  FileText,
  FileSpreadsheet,
  Image as ImageIcon,
  Code,
  Presentation,
  File,
  ExternalLink,
  AlertCircle,
  RefreshCw,
  Copy,
  Check,
  Maximize2,
  Minimize2,
  ChevronDown,
  ChevronRight,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { getFileTheme, getFileCategory, type FileCategory } from "@/lib/fileTypeTheme";
import { useAsyncHighlight } from "@/hooks/useAsyncHighlight";
import { downloadArtifact } from "@/lib/localArtifactAccess";

export type ArtifactType =
  | "image"
  | "document"
  | "spreadsheet"
  | "presentation"
  | "pdf"
  | "code"
  | "diagram"
  | "svg"
  | "text"
  | "unknown";

export interface Artifact {
  id: string;
  type: ArtifactType;
  name: string;
  url?: string;
  previewUrl?: string;
  path?: string;
  data?: any;
  mimeType?: string;
  content?: string;
  language?: string;
}

interface ArtifactViewerProps {
  artifact: Artifact;
  onExpand?: (url: string) => void;
  onDownload?: () => void;
  onClick?: () => void;
  compact?: boolean;
  className?: string;
}

function detectArtifactType(artifact: Artifact): ArtifactType {
  const category = getFileCategory(artifact.name, artifact.mimeType);

  if (artifact.type && artifact.type !== "unknown") {
    if (artifact.type === "document") {
      if (category === "excel") return "spreadsheet";
      if (category === "ppt") return "presentation";
      if (category === "pdf") return "pdf";
    }
    return artifact.type;
  }

  const categoryMap: Record<FileCategory, ArtifactType> = {
    image: "image",
    word: "document",
    excel: "spreadsheet",
    ppt: "presentation",
    pdf: "pdf",
    code: "code",
    text: "text",
    archive: "unknown",
    unknown: "unknown",
  };

  if (artifact.mimeType === "image/svg+xml" || artifact.name?.endsWith(".svg")) {
    return "svg";
  }

  if (artifact.name?.endsWith(".mmd") || artifact.name?.endsWith(".mermaid")) {
    return "diagram";
  }

  return categoryMap[category] || "unknown";
}

function getArtifactIcon(type: ArtifactType): React.ElementType {
  const icons: Record<ArtifactType, React.ElementType> = {
    image: ImageIcon,
    document: FileText,
    spreadsheet: FileSpreadsheet,
    presentation: Presentation,
    pdf: FileText,
    code: Code,
    diagram: Code,
    svg: ImageIcon,
    text: FileText,
    unknown: File,
  };
  return icons[type] || File;
}

const ImageArtifact = memo(function ImageArtifact({
  artifact,
  onExpand,
  onDownload,
  compact,
}: {
  artifact: Artifact;
  onExpand?: (url: string) => void;
  onDownload?: () => void;
  compact?: boolean;
}) {
  const [isLoaded, setIsLoaded] = useState(false);
  const [hasError, setHasError] = useState(false);
  const [retryCount, setRetryCount] = useState(0);

  const imageUrl = useMemo(() => {
    if (artifact.url) return artifact.url;
    if (artifact.previewUrl) return artifact.previewUrl;
    if (artifact.data?.previewUrl) return artifact.data.previewUrl;
    if (artifact.data?.url) return artifact.data.url;
    if (artifact.data?.base64 && artifact.mimeType) {
      return `data:${artifact.mimeType};base64,${artifact.data.base64}`;
    }
    const artifactPath = artifact.path || artifact.data?.filePath;
    if (artifactPath) {
      const filename = artifactPath.split('/').pop();
      return `/api/artifacts/${filename}/preview`;
    }
    return null;
  }, [artifact, retryCount]);

  const handleExpand = useCallback(() => {
    if (imageUrl && onExpand) onExpand(imageUrl);
  }, [imageUrl, onExpand]);

  const handleDownload = useCallback(async (e: React.MouseEvent) => {
    e.stopPropagation();
    if (onDownload) {
      onDownload();
      return;
    }
    if (!imageUrl) return;

    try {
      const response = await fetch(imageUrl);
      const blob = await response.blob();
      const blobUrl = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = blobUrl;
      link.download = artifact.name || "image.png";
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(blobUrl);
    } catch {
      const link = document.createElement("a");
      link.href = imageUrl;
      link.download = artifact.name || "image.png";
      link.click();
    }
  }, [onDownload, imageUrl, artifact.name]);

  const handleRetry = useCallback((e: React.MouseEvent) => {
    e.stopPropagation();
    setHasError(false);
    setIsLoaded(false);
    setRetryCount(prev => prev + 1);
  }, []);

  if (!imageUrl) {
    return (
      <div className="flex items-center gap-3 p-4 rounded-lg border bg-muted/30" data-testid={`artifact-image-error-${artifact.id}`}>
        <ImageIcon className="h-8 w-8 text-muted-foreground" />
        <span className="text-sm text-muted-foreground">Imagen no disponible</span>
      </div>
    );
  }

  if (hasError) {
    return (
      <div className="flex flex-col sm:flex-row items-center gap-3 p-4 rounded-lg border bg-muted/30" data-testid={`artifact-image-failed-${artifact.id}`}>
        <div className="flex items-center gap-2 text-muted-foreground">
          <AlertCircle className="h-5 w-5" />
          <span className="text-sm">No se pudo cargar la imagen</span>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" onClick={handleRetry} data-testid={`retry-image-${artifact.id}`}>
            <RefreshCw className="h-4 w-4 mr-1" />
            Reintentar
          </Button>
          <Button variant="ghost" size="sm" onClick={handleDownload} data-testid={`download-fallback-${artifact.id}`}>
            <Download className="h-4 w-4 mr-1" />
            Descargar
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div
      className={cn(
        "relative group rounded-xl overflow-hidden",
        compact && "max-w-xs"
      )}
      data-testid={`artifact-image-${artifact.id}`}
    >
      {!isLoaded && (
        <div className="absolute inset-0 flex items-center justify-center bg-muted/50 animate-pulse rounded-xl">
          <ImageIcon className="h-8 w-8 text-muted-foreground/50" />
        </div>
      )}

      <img
        key={retryCount}
        src={imageUrl}
        alt={artifact.name || "Imagen"}
        className={cn(
          "max-w-full h-auto cursor-pointer transition-all rounded-xl shadow-sm hover:shadow-md",
          !isLoaded && "opacity-0"
        )}
        style={{ maxHeight: compact ? "200px" : "500px" }}
        onLoad={() => setIsLoaded(true)}
        onError={() => setHasError(true)}
        onClick={handleExpand}
        data-testid={`image-preview-${artifact.id}`}
      />

      <div className="absolute top-2 right-2 flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
        <Button
          variant="secondary"
          size="icon"
          className="h-8 w-8 bg-black/50 hover:bg-black/70 text-white border-0 backdrop-blur-sm"
          onClick={handleExpand}
          data-testid={`expand-image-${artifact.id}`}
        >
          <Eye className="h-4 w-4" />
        </Button>
        <Button
          variant="secondary"
          size="icon"
          className="h-8 w-8 bg-black/50 hover:bg-black/70 text-white border-0 backdrop-blur-sm"
          onClick={handleDownload}
          data-testid={`download-image-${artifact.id}`}
        >
          <Download className="h-4 w-4" />
        </Button>
      </div>
    </div>
  );
});

const DocumentArtifact = memo(function DocumentArtifact({
  artifact,
  onClick,
  onDownload,
}: {
  artifact: Artifact;
  onClick?: () => void;
  onDownload?: () => void;
}) {
  const theme = getFileTheme(artifact.name, artifact.mimeType);
  const type = detectArtifactType(artifact);
  const IconComponent = getArtifactIcon(type);

  const handleClick = useCallback((e: React.MouseEvent) => {
    e.stopPropagation();
    onClick?.();
  }, [onClick]);

  const handleDownload = useCallback(async (e: React.MouseEvent) => {
    e.stopPropagation();
    if (onDownload) {
      onDownload();
      return;
    }

    // Construct download URL from artifact path or use provided URL
    let downloadUrl =
      artifact.data?.downloadUrl ||
      artifact.url ||
      artifact.previewUrl ||
      artifact.data?.url;

    // If we have a path, construct the proper download endpoint
    const artifactPath = artifact.path || artifact.data?.filePath || artifact.data?.path;
    if (!downloadUrl && artifactPath) {
      const filename = artifactPath.split('/').pop();
      downloadUrl = `/api/artifacts/${filename}`;
    }

    if (!downloadUrl) return;

    try {
      await downloadArtifact(downloadUrl, artifact.name || "document");
    } catch (error) {
      console.error("[ArtifactDownload] Blob download failed, trying direct link:", error);
      // Fallback to direct link
      const link = document.createElement("a");
      link.href = downloadUrl;
      link.download = artifact.name || "document";
      link.click();
    }
  }, [onDownload, artifact]);

  return (
    <div
      className={cn(
        "flex items-center gap-3 p-3 rounded-xl border transition-all cursor-pointer",
        "bg-card hover:bg-accent/50 border-border hover:border-border/80",
        "hover:shadow-md group"
      )}
      onClick={handleClick}
      data-testid={`artifact-document-${artifact.id}`}
    >
      {/* Document Type Icon with Color */}
      <div
        className={cn(
          "flex items-center justify-center w-11 h-11 rounded-xl shrink-0 shadow-sm",
          "bg-gradient-to-br",
          theme.gradientFrom,
          theme.gradientTo
        )}
      >
        <span className="text-white text-sm font-bold">{theme.icon}</span>
      </div>

      {/* File Info */}
      <div className="flex-1 min-w-0">
        <p className="text-sm font-medium truncate text-foreground">
          {artifact.name}
        </p>
        <p className="text-xs text-muted-foreground mt-0.5">
          {theme.label}
        </p>
      </div>

      {/* Action Buttons - Always visible */}
      <div className="flex items-center gap-1 shrink-0">
        <Button
          variant="ghost"
          size="icon"
          className={cn("h-9 w-9 rounded-lg transition-colors", theme.textColor, "hover:bg-accent")}
          onClick={handleClick}
          title="Vista previa"
          data-testid={`preview-document-${artifact.id}`}
        >
          <Eye className="h-4.5 w-4.5" />
        </Button>
        <Button
          variant="ghost"
          size="icon"
          className="h-9 w-9 rounded-lg hover:bg-accent"
          onClick={handleDownload}
          title="Descargar"
          data-testid={`download-document-${artifact.id}`}
        >
          <Download className="h-4.5 w-4.5" />
        </Button>
      </div>
    </div>
  );
});

const SvgArtifact = memo(function SvgArtifact({
  artifact,
  onExpand,
  onDownload,
}: {
  artifact: Artifact;
  onExpand?: (url: string) => void;
  onDownload?: () => void;
}) {
  const [isExpanded, setIsExpanded] = useState(false);
  const [hasError, setHasError] = useState(false);

  const svgContent = useMemo(() => {
    if (artifact.content) return artifact.content;
    if (artifact.data?.content) return artifact.data.content;
    return null;
  }, [artifact]);

  const svgUrl = artifact.url || artifact.previewUrl;

  const handleExpand = useCallback(() => {
    if (svgUrl && onExpand) onExpand(svgUrl);
    else setIsExpanded(!isExpanded);
  }, [svgUrl, onExpand, isExpanded]);

  const handleDownload = useCallback((e: React.MouseEvent) => {
    e.stopPropagation();
    if (onDownload) {
      onDownload();
      return;
    }

    const content = svgContent || "";
    const blob = new Blob([content], { type: "image/svg+xml" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = artifact.name || "diagram.svg";
    link.click();
    URL.revokeObjectURL(url);
  }, [onDownload, svgContent, artifact.name]);

  if (hasError) {
    return (
      <div className="flex items-center gap-3 p-4 rounded-lg border bg-muted/30" data-testid={`artifact-svg-error-${artifact.id}`}>
        <AlertCircle className="h-5 w-5 text-muted-foreground" />
        <span className="text-sm text-muted-foreground">No se pudo renderizar el SVG</span>
        <Button variant="outline" size="sm" onClick={handleDownload}>
          <Download className="h-4 w-4 mr-1" />
          Descargar
        </Button>
      </div>
    );
  }

  return (
    <div
      className={cn(
        "relative group rounded-lg overflow-hidden border border-border bg-white dark:bg-slate-900",
        isExpanded && "fixed inset-4 z-50 shadow-2xl"
      )}
      data-testid={`artifact-svg-${artifact.id}`}
    >
      <div className="absolute top-2 right-2 flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity z-10">
        <Button
          variant="secondary"
          size="icon"
          className="h-8 w-8 bg-black/50 hover:bg-black/70 text-white border-0"
          onClick={handleExpand}
          data-testid={`expand-svg-${artifact.id}`}
        >
          {isExpanded ? <Minimize2 className="h-4 w-4" /> : <Maximize2 className="h-4 w-4" />}
        </Button>
        <Button
          variant="secondary"
          size="icon"
          className="h-8 w-8 bg-black/50 hover:bg-black/70 text-white border-0"
          onClick={handleDownload}
          data-testid={`download-svg-${artifact.id}`}
        >
          <Download className="h-4 w-4" />
        </Button>
      </div>

      <div
        className={cn(
          "flex items-center justify-center p-4 overflow-auto",
          isExpanded ? "h-full" : "max-h-[400px]"
        )}
      >
        {svgContent ? (
          <div
            className="svg-container"
            // FRONTEND FIX #2: Sanitize SVG content to prevent XSS
            dangerouslySetInnerHTML={{
              __html: DOMPurify.sanitize(svgContent, {
                USE_PROFILES: { svg: true, svgFilters: true },
                ADD_TAGS: ["use"],
              }),
            }}
            onError={() => setHasError(true)}
          />
        ) : svgUrl ? (
          <img
            src={svgUrl}
            alt={artifact.name}
            className="max-w-full h-auto"
            style={{ maxHeight: isExpanded ? "100%" : "350px" }}
            onError={() => setHasError(true)}
          />
        ) : (
          <div className="text-muted-foreground text-sm">SVG no disponible</div>
        )}
      </div>
    </div>
  );
});

const CodeArtifact = memo(function CodeArtifact({
  artifact,
  onDownload,
}: {
  artifact: Artifact;
  onDownload?: () => void;
}) {
  const [isExpanded, setIsExpanded] = useState(false);
  const [copied, setCopied] = useState(false);

  const code = artifact.content || artifact.data?.content || "";
  const language = artifact.language || artifact.data?.language ||
    artifact.name?.split('.').pop() || "text";

  const { html, isLoading } = useAsyncHighlight(code, language);

  const handleCopy = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(code);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch (err) {
      console.error("Failed to copy:", err);
    }
  }, [code]);

  const handleDownload = useCallback((e: React.MouseEvent) => {
    e.stopPropagation();
    if (onDownload) {
      onDownload();
      return;
    }
    const blob = new Blob([code], { type: "text/plain" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = artifact.name || "code.txt";
    link.click();
    URL.revokeObjectURL(url);
  }, [onDownload, code, artifact.name]);

  const lines = code.split('\n');
  const previewLines = isExpanded ? lines : lines.slice(0, 15);
  const hasMore = !isExpanded && lines.length > 15;

  return (
    <div
      className="relative group rounded-lg overflow-hidden border border-border bg-slate-950"
      data-testid={`artifact-code-${artifact.id}`}
    >
      <div className="flex items-center justify-between px-3 py-2 bg-slate-900 border-b border-slate-800">
        <div className="flex items-center gap-2">
          <Code className="h-4 w-4 text-slate-400" />
          <span className="text-xs text-slate-400 font-mono">{artifact.name}</span>
          <Badge variant="outline" className="text-[10px] px-1.5 py-0 h-4 bg-slate-800 border-slate-700 text-slate-300">
            {language}
          </Badge>
        </div>
        <div className="flex items-center gap-1">
          <Button
            variant="ghost"
            size="icon"
            className="h-7 w-7 text-slate-400 hover:text-white hover:bg-slate-800"
            onClick={handleCopy}
            data-testid={`copy-code-${artifact.id}`}
          >
            {copied ? <Check className="h-3.5 w-3.5 text-green-500" /> : <Copy className="h-3.5 w-3.5" />}
          </Button>
          <Button
            variant="ghost"
            size="icon"
            className="h-7 w-7 text-slate-400 hover:text-white hover:bg-slate-800"
            onClick={handleDownload}
            data-testid={`download-code-${artifact.id}`}
          >
            <Download className="h-3.5 w-3.5" />
          </Button>
        </div>
      </div>

      <div className={cn("overflow-auto", isExpanded ? "max-h-[600px]" : "max-h-[350px]")}>
        {isLoading ? (
          <pre className="p-4 text-sm font-mono text-slate-300 whitespace-pre-wrap">
            {previewLines.join('\n')}
          </pre>
        ) : (
          <div
            className="p-4 text-sm font-mono"
            // FRONTEND FIX #3: Sanitize highlighted code HTML
            dangerouslySetInnerHTML={{
              __html: DOMPurify.sanitize(
                html || `<pre class="text-slate-300">${previewLines.join('\n')}</pre>`,
                { ALLOWED_TAGS: ["pre", "code", "span"], ALLOWED_ATTR: ["class"] }
              ),
            }}
          />
        )}
      </div>

      {hasMore && (
        <button
          onClick={() => setIsExpanded(true)}
          className="w-full py-2 text-xs text-slate-400 hover:text-white bg-gradient-to-t from-slate-900 to-transparent flex items-center justify-center gap-1"
          data-testid={`expand-code-${artifact.id}`}
        >
          <ChevronDown className="h-3 w-3" />
          Ver {lines.length - 15} líneas más
        </button>
      )}
    </div>
  );
});

const DiagramArtifact = memo(function DiagramArtifact({
  artifact,
  onDownload,
}: {
  artifact: Artifact;
  onDownload?: () => void;
}) {
  const [isExpanded, setIsExpanded] = useState(false);
  const diagramCode = artifact.content || artifact.data?.content || "";

  const handleDownload = useCallback((e: React.MouseEvent) => {
    e.stopPropagation();
    if (onDownload) {
      onDownload();
      return;
    }
    const blob = new Blob([diagramCode], { type: "text/plain" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = artifact.name || "diagram.mmd";
    link.click();
    URL.revokeObjectURL(url);
  }, [onDownload, diagramCode, artifact.name]);

  return (
    <Collapsible open={isExpanded} onOpenChange={setIsExpanded}>
      <div className="rounded-lg border border-border overflow-hidden" data-testid={`artifact-diagram-${artifact.id}`}>
        <div className="flex items-center justify-between px-3 py-2 bg-muted/50">
          <div className="flex items-center gap-2">
            <Code className="h-4 w-4 text-muted-foreground" />
            <span className="text-sm font-medium">{artifact.name || "Diagrama"}</span>
            <Badge variant="outline" className="text-[10px]">Mermaid</Badge>
          </div>
          <div className="flex items-center gap-1">
            <CollapsibleTrigger asChild>
              <Button variant="ghost" size="sm" className="h-7 text-xs">
                {isExpanded ? (
                  <>
                    <ChevronDown className="h-3 w-3 mr-1" />
                    Ocultar código
                  </>
                ) : (
                  <>
                    <ChevronRight className="h-3 w-3 mr-1" />
                    Ver código
                  </>
                )}
              </Button>
            </CollapsibleTrigger>
            <Button
              variant="ghost"
              size="icon"
              className="h-7 w-7"
              onClick={handleDownload}
              data-testid={`download-diagram-${artifact.id}`}
            >
              <Download className="h-3.5 w-3.5" />
            </Button>
          </div>
        </div>

        <CollapsibleContent>
          <pre className="p-4 text-xs font-mono bg-slate-950 text-slate-300 overflow-auto max-h-[300px]">
            {diagramCode}
          </pre>
        </CollapsibleContent>

        <div className="p-4 bg-white dark:bg-slate-900 text-center text-sm text-muted-foreground">
          <p>Vista previa de diagrama Mermaid</p>
          <p className="text-xs mt-1">Próximamente: renderizado interactivo</p>
        </div>
      </div>
    </Collapsible>
  );
});

const FallbackArtifact = memo(function FallbackArtifact({
  artifact,
  onClick,
  onDownload,
}: {
  artifact: Artifact;
  onClick?: () => void;
  onDownload?: () => void;
}) {
  const theme = getFileTheme(artifact.name, artifact.mimeType);

  const handleClick = useCallback((e: React.MouseEvent) => {
    e.stopPropagation();
    onClick?.();
  }, [onClick]);

  const handleDownload = useCallback((e: React.MouseEvent) => {
    e.stopPropagation();
    if (onDownload) {
      onDownload();
      return;
    }
    const url = artifact.url || artifact.previewUrl;
    if (url) {
      const link = document.createElement("a");
      link.href = url;
      link.download = artifact.name;
      link.click();
    }
  }, [onDownload, artifact]);

  return (
    <div
      className={cn(
        "flex items-center gap-3 p-3 rounded-lg border transition-all",
        "bg-card hover:bg-accent/50 border-border",
        onClick && "cursor-pointer hover:border-border/80 hover:shadow-sm"
      )}
      onClick={handleClick}
      data-testid={`artifact-fallback-${artifact.id}`}
    >
      <div
        className={cn(
          "flex items-center justify-center w-10 h-10 rounded-lg shrink-0",
          theme.bgColor
        )}
      >
        <span className="text-white text-xs font-bold">{theme.icon}</span>
      </div>

      <div className="flex-1 min-w-0">
        <p className="text-sm font-medium truncate text-foreground">
          {artifact.name}
        </p>
        <p className="text-xs text-muted-foreground">
          {theme.label}
        </p>
      </div>

      <Button
        variant="ghost"
        size="icon"
        className="h-8 w-8 shrink-0"
        onClick={handleDownload}
        data-testid={`download-fallback-${artifact.id}`}
      >
        <Download className="h-4 w-4" />
      </Button>
    </div>
  );
});

export const ArtifactViewer = memo(function ArtifactViewer({
  artifact,
  onExpand,
  onDownload,
  onClick,
  compact = false,
  className,
}: ArtifactViewerProps) {
  const artifactType = detectArtifactType(artifact);

  const renderArtifact = () => {
    switch (artifactType) {
      case "image":
        return (
          <ImageArtifact
            artifact={artifact}
            onExpand={onExpand}
            onDownload={onDownload}
            compact={compact}
          />
        );

      case "document":
      case "pdf":
      case "spreadsheet":
      case "presentation":
        return (
          <DocumentArtifact
            artifact={artifact}
            onClick={onClick}
            onDownload={onDownload}
          />
        );

      case "svg":
        return (
          <SvgArtifact
            artifact={artifact}
            onExpand={onExpand}
            onDownload={onDownload}
          />
        );

      case "code":
        return (
          <CodeArtifact
            artifact={artifact}
            onDownload={onDownload}
          />
        );

      case "diagram":
        return (
          <DiagramArtifact
            artifact={artifact}
            onDownload={onDownload}
          />
        );

      case "text":
        return (
          <CodeArtifact
            artifact={{ ...artifact, language: "text" }}
            onDownload={onDownload}
          />
        );

      default:
        return (
          <FallbackArtifact
            artifact={artifact}
            onClick={onClick}
            onDownload={onDownload}
          />
        );
    }
  };

  return (
    <div className={cn("artifact-viewer", className)} data-testid={`artifact-viewer-${artifact.id}`}>
      {renderArtifact()}
    </div>
  );
});

export interface ArtifactGridProps {
  artifacts: Artifact[];
  onExpand?: (url: string) => void;
  onDownload?: (artifact: Artifact) => void;
  onClick?: (artifact: Artifact) => void;
  compact?: boolean;
  className?: string;
}

export const ArtifactGrid = memo(function ArtifactGrid({
  artifacts,
  onExpand,
  onDownload,
  onClick,
  compact = false,
  className,
}: ArtifactGridProps) {
  if (!artifacts || artifacts.length === 0) return null;

  const imageArtifacts = artifacts.filter(a => detectArtifactType(a) === "image" || detectArtifactType(a) === "svg");
  const documentArtifacts = artifacts.filter(a => {
    const type = detectArtifactType(a);
    return type === "document" || type === "pdf" || type === "spreadsheet" || type === "presentation";
  });
  const codeArtifacts = artifacts.filter(a => {
    const type = detectArtifactType(a);
    return type === "code" || type === "diagram" || type === "text";
  });
  const otherArtifacts = artifacts.filter(a => detectArtifactType(a) === "unknown");

  return (
    <div className={cn("space-y-4", className)} data-testid="artifact-grid">
      {imageArtifacts.length > 0 && (
        <div className="grid gap-3" data-testid="artifact-grid-images">
          {imageArtifacts.map(artifact => (
            <ArtifactViewer
              key={artifact.id}
              artifact={artifact}
              onExpand={onExpand}
              onDownload={() => onDownload?.(artifact)}
              compact={compact}
            />
          ))}
        </div>
      )}

      {documentArtifacts.length > 0 && (
        <div className="space-y-2" data-testid="artifact-grid-documents">
          {!compact && documentArtifacts.length > 0 && (
            <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
              Documentos
            </p>
          )}
          <div className="grid gap-2">
            {documentArtifacts.map(artifact => (
              <ArtifactViewer
                key={artifact.id}
                artifact={artifact}
                onClick={() => onClick?.(artifact)}
                onDownload={() => onDownload?.(artifact)}
                compact={compact}
              />
            ))}
          </div>
        </div>
      )}

      {codeArtifacts.length > 0 && (
        <div className="space-y-2" data-testid="artifact-grid-code">
          {!compact && codeArtifacts.length > 0 && (
            <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
              Código
            </p>
          )}
          <div className="grid gap-2">
            {codeArtifacts.map(artifact => (
              <ArtifactViewer
                key={artifact.id}
                artifact={artifact}
                onDownload={() => onDownload?.(artifact)}
                compact={compact}
              />
            ))}
          </div>
        </div>
      )}

      {otherArtifacts.length > 0 && (
        <div className="space-y-2" data-testid="artifact-grid-other">
          {!compact && otherArtifacts.length > 0 && (
            <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
              Archivos
            </p>
          )}
          <div className="grid gap-2">
            {otherArtifacts.map(artifact => (
              <ArtifactViewer
                key={artifact.id}
                artifact={artifact}
                onClick={() => onClick?.(artifact)}
                onDownload={() => onDownload?.(artifact)}
                compact={compact}
              />
            ))}
          </div>
        </div>
      )}
    </div>
  );
});

export default ArtifactViewer;
