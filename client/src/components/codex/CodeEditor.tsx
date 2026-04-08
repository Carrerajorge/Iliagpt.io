/**
 * CodeEditor — Simple code editor with line numbers and syntax indication.
 */

import { useState, useCallback, useRef, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Copy, Save, Check } from "lucide-react";
import { cn } from "@/lib/utils";

interface CodeEditorProps {
  path: string;
  content: string;
  readOnly?: boolean;
  onSave?: (content: string) => Promise<void>;
}

const LANG_MAP: Record<string, string> = {
  ".ts": "TypeScript", ".tsx": "TypeScript React", ".js": "JavaScript", ".jsx": "JavaScript React",
  ".py": "Python", ".json": "JSON", ".css": "CSS", ".html": "HTML", ".md": "Markdown",
  ".yml": "YAML", ".yaml": "YAML", ".toml": "TOML", ".sql": "SQL", ".sh": "Shell",
  ".rs": "Rust", ".go": "Go", ".java": "Java",
};

function detectLanguage(path: string): string {
  const ext = path.slice(path.lastIndexOf(".")).toLowerCase();
  return LANG_MAP[ext] || "Text";
}

export function CodeEditor({ path, content, readOnly = false, onSave }: CodeEditorProps) {
  const [value, setValue] = useState(content);
  const [isDirty, setIsDirty] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [copied, setCopied] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const language = detectLanguage(path);

  useEffect(() => {
    setValue(content);
    setIsDirty(false);
  }, [content, path]);

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

  const lines = value.split("\n");
  const lineNumberWidth = String(lines.length).length * 10 + 16;

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="flex items-center justify-between px-3 py-2 border-b bg-muted/30">
        <div className="flex items-center gap-2 min-w-0">
          <span className="text-sm font-mono truncate">{path.split("/").pop()}</span>
          <Badge variant="outline" className="text-xs">{language}</Badge>
          {isDirty && <Badge variant="default" className="text-xs bg-amber-500">Modified</Badge>}
        </div>
        <div className="flex items-center gap-1">
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

      {/* Editor */}
      <div className="flex-1 relative overflow-hidden">
        {/* Line numbers */}
        <div
          className="absolute left-0 top-0 bottom-0 bg-muted/50 border-r text-right select-none overflow-hidden"
          style={{ width: lineNumberWidth }}
        >
          <div className="py-2 px-1">
            {lines.map((_, i) => (
              <div key={i} className="text-xs text-muted-foreground leading-5 font-mono pr-2">
                {i + 1}
              </div>
            ))}
          </div>
        </div>

        {/* Textarea */}
        <textarea
          ref={textareaRef}
          value={value}
          onChange={handleChange}
          onKeyDown={handleKeyDown}
          readOnly={readOnly}
          className={cn(
            "absolute inset-0 resize-none bg-transparent font-mono text-sm leading-5 p-2 outline-none",
            "overflow-auto whitespace-pre tab-size-2",
            readOnly && "opacity-80",
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
        <span>{readOnly ? "Read-only" : "Ctrl+S to save"}</span>
      </div>
    </div>
  );
}
