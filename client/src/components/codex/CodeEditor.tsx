/**
 * CodeEditor — Code editor with tabs, syntax highlighting (shiki),
 * inline diff view, and visible read-only state.
 */

import { useState, useCallback, useRef, useEffect, useMemo } from "react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Copy, Save, Check, X, Lock, Diff } from "lucide-react";
import { cn } from "@/lib/utils";
import { highlightCode } from "@/lib/shikiHighlighter";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface EditorTab {
  path: string;
  content: string;
  isDirty?: boolean;
}

interface CodeEditorProps {
  path: string;
  content: string;
  readOnly?: boolean;
  onSave?: (content: string) => Promise<void>;
  /** Multiple open files — renders a tab bar when provided */
  tabs?: EditorTab[];
  onTabSelect?: (path: string) => void;
  onTabClose?: (path: string) => void;
  /** Original content for diff view */
  originalContent?: string;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const LANG_MAP: Record<string, string> = {
  ".ts": "TypeScript", ".tsx": "TypeScript React", ".js": "JavaScript", ".jsx": "JavaScript React",
  ".py": "Python", ".json": "JSON", ".css": "CSS", ".html": "HTML", ".md": "Markdown",
  ".yml": "YAML", ".yaml": "YAML", ".toml": "TOML", ".sql": "SQL", ".sh": "Shell",
  ".rs": "Rust", ".go": "Go", ".java": "Java",
};

const EXT_TO_LANG: Record<string, string> = {
  ".ts": "typescript", ".tsx": "tsx", ".js": "javascript", ".jsx": "jsx",
  ".py": "python", ".json": "json", ".css": "css", ".html": "html", ".md": "markdown",
  ".yml": "yaml", ".yaml": "yaml", ".toml": "toml", ".sql": "sql", ".sh": "bash",
  ".rs": "rust", ".go": "go", ".java": "java",
};

function detectLanguage(path: string): string {
  const ext = path.slice(path.lastIndexOf(".")).toLowerCase();
  return LANG_MAP[ext] || "Text";
}

function detectShikiLang(path: string): string {
  const ext = path.slice(path.lastIndexOf(".")).toLowerCase();
  return EXT_TO_LANG[ext] || "text";
}

/** Simple line-level diff: returns per-line markers. */
function computeLineDiff(original: string, modified: string): Array<"same" | "added" | "removed"> {
  const origLines = original.split("\n");
  const modLines = modified.split("\n");
  const markers: Array<"same" | "added" | "removed"> = [];
  const maxLen = Math.max(origLines.length, modLines.length);
  for (let i = 0; i < maxLen; i++) {
    if (i >= origLines.length) markers.push("added");
    else if (i >= modLines.length) markers.push("removed");
    else if (origLines[i] !== modLines[i]) markers.push("added");
    else markers.push("same");
  }
  return markers;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function CodeEditor({
  path, content, readOnly = false, onSave,
  tabs, onTabSelect, onTabClose,
  originalContent,
}: CodeEditorProps) {
  const [value, setValue] = useState(content);
  const [isDirty, setIsDirty] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [copied, setCopied] = useState(false);
  const [showDiff, setShowDiff] = useState(false);
  const [highlightedHtml, setHighlightedHtml] = useState<string | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const highlightRef = useRef<HTMLDivElement>(null);
  const language = detectLanguage(path);

  // Sync content when path or content changes
  useEffect(() => {
    setValue(content);
    setIsDirty(false);
    setShowDiff(false);
  }, [content, path]);

  // Syntax highlighting overlay
  useEffect(() => {
    let cancelled = false;
    const lang = detectShikiLang(path);
    highlightCode(value, lang).then(html => {
      if (!cancelled) setHighlightedHtml(html);
    });
    return () => { cancelled = true; };
  }, [value, path]);

  const handleChange = useCallback((e: React.ChangeEvent<HTMLTextAreaElement>) => {
    setValue(e.target.value);
    setIsDirty(true);
  }, []);

  const handleSave = useCallback(async () => {
    if (!onSave || !isDirty) return;
    setIsSaving(true);
    try {
      await onSave(value);
      setIsDirty(false);
    } finally {
      setIsSaving(false);
    }
  }, [onSave, value, isDirty]);

  const handleKeyDown = useCallback((e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if ((e.ctrlKey || e.metaKey) && e.key === "s") {
      e.preventDefault();
      handleSave();
    }
    if (e.key === "Tab") {
      e.preventDefault();
      const ta = e.currentTarget;
      const start = ta.selectionStart;
      const end = ta.selectionEnd;
      const newValue = value.slice(0, start) + "  " + value.slice(end);
      setValue(newValue);
      setIsDirty(true);
      requestAnimationFrame(() => {
        ta.selectionStart = ta.selectionEnd = start + 2;
      });
    }
  }, [handleSave, value]);

  const handleCopy = useCallback(() => {
    navigator.clipboard.writeText(value);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }, [value]);

  // Sync scroll between textarea and highlight overlay
  const handleScroll = useCallback(() => {
    if (textareaRef.current && highlightRef.current) {
      highlightRef.current.scrollTop = textareaRef.current.scrollTop;
      highlightRef.current.scrollLeft = textareaRef.current.scrollLeft;
    }
  }, []);

  const lines = value.split("\n");
  const lineNumberWidth = String(lines.length).length * 10 + 16;

  const diffMarkers = useMemo(
    () => (showDiff && originalContent != null ? computeLineDiff(originalContent, value) : null),
    [showDiff, originalContent, value],
  );

  const hasDiff = originalContent != null;

  return (
    <div className="flex flex-col h-full">
      {/* Tab bar */}
      {tabs && tabs.length > 0 && (
        <div className="flex items-center border-b bg-muted/20 overflow-x-auto">
          {tabs.map(tab => {
            const fileName = tab.path.split("/").pop() || tab.path;
            const isActive = tab.path === path;
            return (
              <div
                key={tab.path}
                className={cn(
                  "flex items-center gap-1 px-3 py-1.5 text-xs border-r cursor-pointer shrink-0 transition-colors",
                  isActive ? "bg-background text-foreground border-b-2 border-b-primary" : "text-muted-foreground hover:bg-muted/50",
                )}
                onClick={() => onTabSelect?.(tab.path)}
              >
                <span className="truncate max-w-[120px]">{fileName}</span>
                {tab.isDirty && <span className="h-1.5 w-1.5 rounded-full bg-amber-500 shrink-0" />}
                {onTabClose && (
                  <button
                    className="ml-1 p-0.5 rounded hover:bg-muted"
                    onClick={e => { e.stopPropagation(); onTabClose(tab.path); }}
                  >
                    <X className="h-3 w-3" />
                  </button>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* Header */}
      <div className="flex items-center justify-between px-3 py-2 border-b bg-muted/30">
        <div className="flex items-center gap-2 min-w-0">
          <span className="text-sm font-mono truncate">{path.split("/").pop()}</span>
          <Badge variant="outline" className="text-xs">{language}</Badge>
          {isDirty && <Badge variant="default" className="text-xs bg-amber-500">Modified</Badge>}
          {readOnly && (
            <Badge variant="secondary" className="text-xs gap-1">
              <Lock className="h-3 w-3" /> Read-only
            </Badge>
          )}
        </div>
        <div className="flex items-center gap-1">
          {hasDiff && (
            <Button
              variant={showDiff ? "secondary" : "ghost"}
              size="icon"
              className="h-7 w-7"
              onClick={() => setShowDiff(!showDiff)}
              title="Toggle diff view"
            >
              <Diff className="h-3.5 w-3.5" />
            </Button>
          )}
          <Button variant="ghost" size="icon" className="h-7 w-7" onClick={handleCopy}>
            {copied ? <Check className="h-3.5 w-3.5 text-green-500" /> : <Copy className="h-3.5 w-3.5" />}
          </Button>
          {!readOnly && onSave && (
            <Button variant="ghost" size="icon" className="h-7 w-7" onClick={handleSave} disabled={!isDirty || isSaving}>
              <Save className="h-3.5 w-3.5" />
            </Button>
          )}
        </div>
      </div>

      {/* Editor area */}
      <div className="flex-1 relative overflow-hidden">
        {/* Read-only overlay banner */}
        {readOnly && (
          <div className="absolute top-0 left-0 right-0 z-20 bg-amber-500/10 border-b border-amber-500/30 px-3 py-1 text-xs text-amber-700 dark:text-amber-300 flex items-center gap-1.5">
            <Lock className="h-3 w-3" />
            Agent is running — file is read-only
          </div>
        )}

        {/* Line numbers with optional diff markers */}
        <div
          className="absolute left-0 top-0 bottom-0 bg-muted/50 border-r text-right select-none overflow-hidden"
          style={{ width: lineNumberWidth }}
        >
          <div className={cn("py-2 px-1", readOnly && "pt-8")}>
            {lines.map((_, i) => (
              <div
                key={i}
                className={cn(
                  "text-xs leading-5 font-mono pr-2",
                  diffMarkers?.[i] === "added" && "bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-400",
                  diffMarkers?.[i] === "removed" && "bg-red-100 dark:bg-red-900/30 text-red-700 dark:text-red-400",
                  !diffMarkers && "text-muted-foreground",
                )}
              >
                {i + 1}
              </div>
            ))}
          </div>
        </div>

        {/* Syntax highlight underlay */}
        {highlightedHtml && (
          <div
            ref={highlightRef}
            className={cn(
              "absolute inset-0 font-mono text-sm leading-5 p-2 overflow-hidden pointer-events-none whitespace-pre",
              readOnly && "pt-8",
              "[&_pre]:!bg-transparent [&_pre]:!m-0 [&_pre]:!p-0 [&_code]:!bg-transparent",
            )}
            style={{ paddingLeft: lineNumberWidth + 8 }}
            dangerouslySetInnerHTML={{ __html: highlightedHtml }}
          />
        )}

        {/* Textarea (transparent text over highlighted underlay) */}
        <textarea
          ref={textareaRef}
          value={value}
          onChange={handleChange}
          onKeyDown={handleKeyDown}
          onScroll={handleScroll}
          readOnly={readOnly}
          className={cn(
            "absolute inset-0 resize-none bg-transparent font-mono text-sm leading-5 p-2 outline-none",
            "overflow-auto whitespace-pre tab-size-2",
            highlightedHtml ? "text-transparent caret-foreground" : "",
            readOnly && "cursor-default pt-8",
          )}
          style={{ paddingLeft: lineNumberWidth + 8 }}
          spellCheck={false}
          autoComplete="off"
          autoCorrect="off"
          autoCapitalize="off"
        />
      </div>

      {/* Footer */}
      <div className="flex items-center justify-between px-3 py-1 border-t bg-muted/30 text-xs text-muted-foreground">
        <span>{lines.length} lines</span>
        <span>
          {readOnly ? (
            <span className="flex items-center gap-1"><Lock className="h-3 w-3" /> Read-only</span>
          ) : (
            "Ctrl+S to save"
          )}
        </span>
      </div>
    </div>
  );
}
