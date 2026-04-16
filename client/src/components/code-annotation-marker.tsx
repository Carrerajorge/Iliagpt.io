import { useCallback } from "react";
import { cn } from "@/lib/utils";
import { Plus, Info, AlertTriangle, AlertCircle, Lightbulb } from "lucide-react";
import type { CodeAnnotation } from "@/hooks/useCodeAnnotations";

export interface CodeAnnotationMarkerProps {
  lineNumber: number;
  annotation?: CodeAnnotation;
  onAddAnnotation?: (line: number) => void;
  onAnnotationClick?: (annotation: CodeAnnotation) => void;
  annotationMode?: boolean;
}

const typeConfig = {
  info: {
    bg: "bg-blue-500",
    hoverBg: "hover:bg-blue-400",
    ring: "ring-blue-500/30",
    icon: Info,
  },
  warning: {
    bg: "bg-amber-500",
    hoverBg: "hover:bg-amber-400",
    ring: "ring-amber-500/30",
    icon: AlertTriangle,
  },
  error: {
    bg: "bg-red-500",
    hoverBg: "hover:bg-red-400",
    ring: "ring-red-500/30",
    icon: AlertCircle,
  },
  explanation: {
    bg: "bg-emerald-500",
    hoverBg: "hover:bg-emerald-400",
    ring: "ring-emerald-500/30",
    icon: Lightbulb,
  },
};

export function CodeAnnotationMarker({
  lineNumber,
  annotation,
  onAddAnnotation,
  onAnnotationClick,
  annotationMode = false,
}: CodeAnnotationMarkerProps) {
  const handleClick = useCallback((e: React.MouseEvent) => {
    e.stopPropagation();
    if (annotation && onAnnotationClick) {
      onAnnotationClick(annotation);
    } else if (annotationMode && onAddAnnotation) {
      onAddAnnotation(lineNumber);
    }
  }, [annotation, onAnnotationClick, annotationMode, onAddAnnotation, lineNumber]);

  if (annotation) {
    const config = typeConfig[annotation.type];
    const Icon = config.icon;

    return (
      <button
        onClick={handleClick}
        className={cn(
          "w-4 h-4 rounded-full flex items-center justify-center",
          "transition-all duration-200 ring-2",
          config.bg,
          config.hoverBg,
          config.ring,
          "hover:scale-110 hover:ring-4"
        )}
        title={`${annotation.type}: ${annotation.content.slice(0, 50)}${annotation.content.length > 50 ? '...' : ''}`}
        data-testid={`marker-annotation-${lineNumber}`}
      >
        <Icon className="w-2.5 h-2.5 text-white" />
      </button>
    );
  }

  if (annotationMode) {
    return (
      <button
        onClick={handleClick}
        className={cn(
          "w-4 h-4 rounded-full flex items-center justify-center",
          "bg-zinc-700 hover:bg-zinc-600",
          "transition-all duration-200",
          "opacity-0 group-hover:opacity-100",
          "hover:scale-110"
        )}
        title="Add annotation"
        data-testid={`marker-add-${lineNumber}`}
      >
        <Plus className="w-2.5 h-2.5 text-zinc-300" />
      </button>
    );
  }

  return (
    <div
      className="w-4 h-4"
      data-testid={`marker-empty-${lineNumber}`}
    />
  );
}

export default CodeAnnotationMarker;
