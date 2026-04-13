/**
 * FileTree — Expandable file tree with search filter, modified markers,
 * and optional file/folder action callbacks.
 */

import { useState, useMemo, useCallback } from "react";
import { cn } from "@/lib/utils";
import {
  ChevronRight, ChevronDown, File, Folder, FolderOpen,
  Search, FilePlus, FolderPlus, Pencil, Trash2, X,
} from "lucide-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";

export interface FileEntry {
  name: string;
  path: string;
  type: "file" | "directory";
  size?: number;
  children?: FileEntry[];
}

export interface FileActions {
  onCreateFile?: (parentPath: string) => void;
  onCreateFolder?: (parentPath: string) => void;
  onRename?: (path: string) => void;
  onDelete?: (path: string) => void;
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

/** Recursively filter tree entries whose path matches the query. */
function filterTree(entries: FileEntry[], query: string): FileEntry[] {
  if (!query) return entries;
  const lq = query.toLowerCase();
  const result: FileEntry[] = [];
  for (const entry of entries) {
    if (entry.type === "directory") {
      const filteredChildren = filterTree(entry.children || [], query);
      if (filteredChildren.length > 0) {
        result.push({ ...entry, children: filteredChildren });
      }
    } else if (entry.name.toLowerCase().includes(lq) || entry.path.toLowerCase().includes(lq)) {
      result.push(entry);
    }
  }
  return result;
}

interface FileTreeProps {
  files: FileEntry[];
  selectedPath?: string;
  onSelect: (path: string) => void;
  modifiedPaths?: Set<string>;
  actions?: FileActions;
  depth?: number;
}

export function FileTree({ files, selectedPath, onSelect, modifiedPaths, actions, depth = 0 }: FileTreeProps) {
  const [searchQuery, setSearchQuery] = useState("");
  const [showSearch, setShowSearch] = useState(false);

  const filteredFiles = useMemo(
    () => (depth === 0 ? filterTree(files, searchQuery) : files),
    [files, searchQuery, depth],
  );

  // Only render search bar at the root level
  return (
    <div className="text-sm">
      {depth === 0 && (
        <div className="px-2 py-1.5 border-b">
          {showSearch ? (
            <div className="flex items-center gap-1">
              <Search className="h-3 w-3 text-muted-foreground shrink-0" />
              <Input
                value={searchQuery}
                onChange={e => setSearchQuery(e.target.value)}
                placeholder="Filter files..."
                className="h-6 text-xs border-0 shadow-none focus-visible:ring-0 px-1"
                autoFocus
              />
              <Button
                variant="ghost"
                size="icon"
                className="h-5 w-5 shrink-0"
                onClick={() => { setSearchQuery(""); setShowSearch(false); }}
              >
                <X className="h-3 w-3" />
              </Button>
            </div>
          ) : (
            <div className="flex items-center justify-between">
              <Button
                variant="ghost"
                size="sm"
                className="h-6 text-xs text-muted-foreground gap-1 px-1"
                onClick={() => setShowSearch(true)}
              >
                <Search className="h-3 w-3" />
                Filter
              </Button>
              {actions && (
                <div className="flex items-center gap-0.5">
                  {actions.onCreateFile && (
                    <Button variant="ghost" size="icon" className="h-5 w-5" onClick={() => actions.onCreateFile!("")} title="New file">
                      <FilePlus className="h-3 w-3" />
                    </Button>
                  )}
                  {actions.onCreateFolder && (
                    <Button variant="ghost" size="icon" className="h-5 w-5" onClick={() => actions.onCreateFolder!("")} title="New folder">
                      <FolderPlus className="h-3 w-3" />
                    </Button>
                  )}
                </div>
              )}
            </div>
          )}
        </div>
      )}
      {filteredFiles.map(entry => (
        <FileTreeNode
          key={entry.path}
          entry={entry}
          selectedPath={selectedPath}
          onSelect={onSelect}
          modifiedPaths={modifiedPaths}
          actions={actions}
          depth={depth}
          forceExpand={!!searchQuery}
        />
      ))}
      {depth === 0 && searchQuery && filteredFiles.length === 0 && (
        <div className="px-4 py-3 text-xs text-muted-foreground text-center">No files match "{searchQuery}"</div>
      )}
    </div>
  );
}

function FileTreeNode({
  entry,
  selectedPath,
  onSelect,
  modifiedPaths,
  actions,
  depth,
  forceExpand,
}: {
  entry: FileEntry;
  selectedPath?: string;
  onSelect: (path: string) => void;
  modifiedPaths?: Set<string>;
  actions?: FileActions;
  depth: number;
  forceExpand: boolean;
}) {
  const [expanded, setExpanded] = useState(depth < 2);
  const [showActions, setShowActions] = useState(false);
  const isDir = entry.type === "directory";
  const isSelected = entry.path === selectedPath;
  const isModified = modifiedPaths?.has(entry.path);
  const isExpanded = forceExpand || expanded;

  return (
    <div
      onMouseEnter={() => setShowActions(true)}
      onMouseLeave={() => setShowActions(false)}
    >
      <button
        className={cn(
          "w-full flex items-center gap-1 px-2 py-1 hover:bg-muted/50 text-left transition-colors group",
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
            {isExpanded ? <ChevronDown className="h-3 w-3 shrink-0" /> : <ChevronRight className="h-3 w-3 shrink-0" />}
            {isExpanded ? <FolderOpen className="h-3.5 w-3.5 text-amber-500 shrink-0" /> : <Folder className="h-3.5 w-3.5 text-amber-500 shrink-0" />}
          </>
        ) : (
          <>
            <span className="w-3 shrink-0" />
            <span className="text-xs shrink-0">{getFileIcon(entry.name)}</span>
          </>
        )}
        <span className={cn("truncate", isModified && "text-amber-600 dark:text-amber-400")}>
          {entry.name}
        </span>
        {isModified && (
          <span className="ml-auto mr-1 h-1.5 w-1.5 rounded-full bg-amber-500 shrink-0" title="Modified" />
        )}

        {/* Inline action buttons on hover */}
        {actions && showActions && (
          <span className="ml-auto flex items-center gap-0.5" onClick={e => e.stopPropagation()}>
            {isDir && actions.onCreateFile && (
              <span
                className="p-0.5 rounded hover:bg-muted cursor-pointer"
                onClick={() => actions.onCreateFile!(entry.path)}
                title="New file"
              >
                <FilePlus className="h-3 w-3 text-muted-foreground" />
              </span>
            )}
            {actions.onRename && (
              <span
                className="p-0.5 rounded hover:bg-muted cursor-pointer"
                onClick={() => actions.onRename!(entry.path)}
                title="Rename"
              >
                <Pencil className="h-3 w-3 text-muted-foreground" />
              </span>
            )}
            {actions.onDelete && (
              <span
                className="p-0.5 rounded hover:bg-muted cursor-pointer"
                onClick={() => actions.onDelete!(entry.path)}
                title="Delete"
              >
                <Trash2 className="h-3 w-3 text-muted-foreground" />
              </span>
            )}
          </span>
        )}
      </button>
      {isDir && isExpanded && entry.children && (
        <FileTree
          files={entry.children}
          selectedPath={selectedPath}
          onSelect={onSelect}
          modifiedPaths={modifiedPaths}
          actions={actions}
          depth={depth + 1}
        />
      )}
    </div>
  );
}
