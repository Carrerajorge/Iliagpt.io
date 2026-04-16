import React from "react";
import { cn } from "@/lib/utils";
import { Download, FileText, FileSpreadsheet, Presentation, FileImage, File } from "lucide-react";

export interface ArtifactData {
  id: string;
  name: string;
  type: string;
  mimeType: string;
  size?: number;
  downloadUrl: string;
  previewUrl?: string;
}

const FILE_ICONS: Record<string, { icon: typeof FileText; color: string; bg: string }> = {
  docx: { icon: FileText, color: "text-blue-600 dark:text-blue-400", bg: "bg-blue-50 dark:bg-blue-900/20" },
  doc: { icon: FileText, color: "text-blue-600 dark:text-blue-400", bg: "bg-blue-50 dark:bg-blue-900/20" },
  xlsx: { icon: FileSpreadsheet, color: "text-green-600 dark:text-green-400", bg: "bg-green-50 dark:bg-green-900/20" },
  xls: { icon: FileSpreadsheet, color: "text-green-600 dark:text-green-400", bg: "bg-green-50 dark:bg-green-900/20" },
  pptx: { icon: Presentation, color: "text-orange-600 dark:text-orange-400", bg: "bg-orange-50 dark:bg-orange-900/20" },
  ppt: { icon: Presentation, color: "text-orange-600 dark:text-orange-400", bg: "bg-orange-50 dark:bg-orange-900/20" },
  pdf: { icon: FileText, color: "text-red-600 dark:text-red-400", bg: "bg-red-50 dark:bg-red-900/20" },
  png: { icon: FileImage, color: "text-purple-600 dark:text-purple-400", bg: "bg-purple-50 dark:bg-purple-900/20" },
  jpg: { icon: FileImage, color: "text-purple-600 dark:text-purple-400", bg: "bg-purple-50 dark:bg-purple-900/20" },
  csv: { icon: FileSpreadsheet, color: "text-green-600 dark:text-green-400", bg: "bg-green-50 dark:bg-green-900/20" },
};

function formatBytes(bytes?: number): string {
  if (!bytes) return "";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function getExtension(name: string): string {
  return name.split(".").pop()?.toLowerCase() || "";
}

interface ArtifactCardProps {
  artifact: ArtifactData;
  className?: string;
}

export function ArtifactCard({ artifact, className }: ArtifactCardProps) {
  const ext = artifact.type || getExtension(artifact.name);
  const fileConfig = FILE_ICONS[ext] || { icon: File, color: "text-zinc-600 dark:text-zinc-400", bg: "bg-zinc-50 dark:bg-zinc-800" };
  const Icon = fileConfig.icon;

  const handleDownload = () => {
    const a = document.createElement("a");
    a.href = artifact.downloadUrl;
    a.download = artifact.name;
    a.click();
  };

  return (
    <div
      className={cn(
        "flex items-center gap-3 px-3.5 py-2.5 rounded-xl border border-zinc-200/70 dark:border-zinc-700/50",
        "bg-white dark:bg-zinc-900/60 shadow-sm hover:shadow-md transition-shadow",
        "max-w-sm",
        className,
      )}
      data-testid="artifact-card"
    >
      {/* File icon */}
      <div className={cn("shrink-0 w-10 h-10 rounded-lg flex items-center justify-center", fileConfig.bg)}>
        <Icon className={cn("h-5 w-5", fileConfig.color)} />
      </div>

      {/* File info */}
      <div className="flex-1 min-w-0">
        <p className="text-sm font-medium text-zinc-800 dark:text-zinc-200 truncate">
          {artifact.name}
        </p>
        <p className="text-[11px] text-zinc-400 dark:text-zinc-500">
          {ext.toUpperCase()}
          {artifact.size ? ` · ${formatBytes(artifact.size)}` : ""}
        </p>
      </div>

      {/* Download button */}
      <button
        onClick={handleDownload}
        className={cn(
          "shrink-0 flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[12px] font-medium",
          "bg-zinc-900 dark:bg-white text-white dark:text-zinc-900",
          "hover:bg-zinc-800 dark:hover:bg-zinc-100 transition-colors",
          "focus:outline-none focus:ring-2 focus:ring-zinc-400/50",
        )}
        data-testid="artifact-download-btn"
      >
        <Download className="h-3.5 w-3.5" />
        Descargar
      </button>
    </div>
  );
}

export default ArtifactCard;
