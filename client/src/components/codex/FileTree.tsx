/**
 * FileTree — Expandable file tree with icons by file type.
 */

import { useState } from "react";
import { cn } from "@/lib/utils";
import { ChevronRight, ChevronDown, File, Folder, FolderOpen } from "lucide-react";

export interface FileEntry {
  name: string;
  path: string;
  type: "file" | "directory";
  size?: number;
  children?: FileEntry[];
}

const FILE_ICONS: Record<string, string> = {
  ".tsx": "⚛️", ".ts": "📘", ".js": "📒", ".jsx": "⚛️",
  ".json": "📋", ".css": "🎨", ".html": "🌐", ".md": "📝",
  ".py": "🐍", ".rs": "🦀", ".go": "🐹", ".java": "☕",
  ".yml": "⚙️", ".yaml": "⚙️", ".toml": "⚙️", ".env": "🔒",
  ".svg": "🖼️", ".png": "🖼️", ".jpg": "🖼️",
};

function getFileIcon(name: string): string {
  const ext = name.slice(name.lastIndexOf(".")).toLowerCase();
  return FILE_ICONS[ext] || "📄";
}

interface FileTreeProps {
  files: FileEntry[];
  selectedPath?: string;
  onSelect: (path: string) => void;
  depth?: number;
}

export function FileTree({ files, selectedPath, onSelect, depth = 0 }: FileTreeProps) {
  return (
    <div className="text-sm">
      {files.map(entry => (
        <FileTreeNode
          key={entry.path}
          entry={entry}
          selectedPath={selectedPath}
          onSelect={onSelect}
          depth={depth}
        />
      ))}
    </div>
  );
}

function FileTreeNode({
  entry,
  selectedPath,
  onSelect,
  depth,
}: {
  entry: FileEntry;
  selectedPath?: string;
  onSelect: (path: string) => void;
  depth: number;
}) {
  const [expanded, setExpanded] = useState(depth < 2);
  const isDir = entry.type === "directory";
  const isSelected = entry.path === selectedPath;

  return (
    <div>
      <button
        className={cn(
          "w-full flex items-center gap-1 px-2 py-1 hover:bg-muted/50 text-left transition-colors",
          isSelected && "bg-primary/10 text-primary",
        )}
        style={{ paddingLeft: `${depth * 16 + 8}px` }}
        onClick={() => {
          if (isDir) setExpanded(!expanded);
          else onSelect(entry.path);
        }}
      >
        {isDir ? (
          <>
            {expanded ? <ChevronDown className="h-3 w-3 shrink-0" /> : <ChevronRight className="h-3 w-3 shrink-0" />}
            {expanded ? <FolderOpen className="h-3.5 w-3.5 text-amber-500 shrink-0" /> : <Folder className="h-3.5 w-3.5 text-amber-500 shrink-0" />}
          </>
        ) : (
          <>
            <span className="w-3 shrink-0" />
            <span className="text-xs shrink-0">{getFileIcon(entry.name)}</span>
          </>
        )}
        <span className="truncate">{entry.name}</span>
      </button>
      {isDir && expanded && entry.children && (
        <FileTree
          files={entry.children}
          selectedPath={selectedPath}
          onSelect={onSelect}
          depth={depth + 1}
        />
      )}
    </div>
  );
}
