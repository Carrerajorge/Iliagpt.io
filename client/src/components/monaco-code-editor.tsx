import React, { Suspense, useCallback, useEffect, useRef, useState } from "react";
import { cn } from "@/lib/utils";
import { Skeleton } from "@/components/ui/skeleton";
import { Loader2 } from "lucide-react";
import type { OnMount } from "@monaco-editor/react";
import type * as Monaco from "monaco-editor";
import { EditorErrorBoundary } from "@/components/error-boundaries";

const MonacoEditorLazy = React.lazy(() => import("@monaco-editor/react"));

export interface MonacoCodeEditorProps {
  code: string;
  language?: string;
  readOnly?: boolean;
  onChange?: (value: string) => void;
  onSave?: (value: string) => void;
  onCancel?: () => void;
  height?: string;
  theme?: "dark" | "light" | "auto";
  highlightedLines?: number[];
  errorLines?: number[];
  annotations?: Map<number, string>;
  className?: string;
  showMinimap?: boolean;
}

function EditorSkeleton({ height }: { height: string }) {
  return (
    <div
      className="flex flex-col gap-2 p-4 bg-zinc-950 rounded-lg"
      style={{ height }}
      data-testid="monaco-editor-skeleton"
    >
      <div className="flex items-center gap-2">
        <Loader2 className="w-4 h-4 text-zinc-400 animate-spin" />
        <span className="text-sm text-zinc-400">Loading editor...</span>
      </div>
      <div className="flex-1 space-y-2">
        <Skeleton className="h-4 w-3/4 bg-zinc-800" />
        <Skeleton className="h-4 w-1/2 bg-zinc-800" />
        <Skeleton className="h-4 w-5/6 bg-zinc-800" />
        <Skeleton className="h-4 w-2/3 bg-zinc-800" />
        <Skeleton className="h-4 w-4/5 bg-zinc-800" />
      </div>
    </div>
  );
}

function getTheme(themeProp: "dark" | "light" | "auto"): "vs-dark" | "light" {
  if (themeProp === "auto") {
    return document.documentElement.classList.contains("dark") ? "vs-dark" : "light";
  }
  return themeProp === "dark" ? "vs-dark" : "light";
}

function MonacoEditorInner({
  code,
  language = "javascript",
  readOnly = false,
  onChange,
  onSave,
  onCancel,
  height = "400px",
  theme = "auto",
  highlightedLines = [],
  errorLines = [],
  annotations = new Map(),
  showMinimap = false,
}: MonacoCodeEditorProps) {
  const editorRef = useRef<Monaco.editor.IStandaloneCodeEditor | null>(null);
  const monacoRef = useRef<typeof Monaco | null>(null);
  const decorationsRef = useRef<string[]>([]);
  const [currentValue, setCurrentValue] = useState(code);
  const [resolvedTheme, setResolvedTheme] = useState<"vs-dark" | "light">(() => getTheme(theme));

  useEffect(() => {
    setCurrentValue(code);
  }, [code]);

  useEffect(() => {
    if (theme === "auto") {
      const observer = new MutationObserver(() => {
        setResolvedTheme(getTheme("auto"));
      });
      observer.observe(document.documentElement, {
        attributes: true,
        attributeFilter: ["class"],
      });
      return () => observer.disconnect();
    } else {
      setResolvedTheme(getTheme(theme));
    }
  }, [theme]);

  const updateDecorations = useCallback(() => {
    if (!editorRef.current || !monacoRef.current) return;

    const monaco = monacoRef.current;
    const editor = editorRef.current;

    const decorations: Monaco.editor.IModelDeltaDecoration[] = [];

    errorLines.forEach((line) => {
      decorations.push({
        range: new monaco.Range(line, 1, line, 1),
        options: {
          isWholeLine: true,
          className: "monaco-error-line",
          glyphMarginClassName: "monaco-error-glyph",
          linesDecorationsClassName: "monaco-error-line-decoration",
        },
      });
    });

    highlightedLines.forEach((line) => {
      if (!errorLines.includes(line)) {
        decorations.push({
          range: new monaco.Range(line, 1, line, 1),
          options: {
            isWholeLine: true,
            className: "monaco-highlighted-line",
            linesDecorationsClassName: "monaco-highlight-line-decoration",
          },
        });
      }
    });

    annotations.forEach((annotation, line) => {
      decorations.push({
        range: new monaco.Range(line, 1, line, 1),
        options: {
          isWholeLine: true,
          glyphMarginClassName: "monaco-annotation-glyph",
          glyphMarginHoverMessage: { value: annotation },
        },
      });
    });

    decorationsRef.current = editor.deltaDecorations(decorationsRef.current, decorations);
  }, [errorLines, highlightedLines, annotations]);

  useEffect(() => {
    updateDecorations();
  }, [updateDecorations]);

  const handleEditorDidMount: OnMount = useCallback(
    (editor, monaco) => {
      editorRef.current = editor;
      monacoRef.current = monaco;

      updateDecorations();

      editor.addAction({
        id: "save-code",
        label: "Save Code",
        keybindings: [monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyS],
        run: () => {
          if (onSave) {
            const model = editor.getModel();
            if (model) {
              onSave(model.getValue());
            }
          }
        },
      });

      editor.addAction({
        id: "cancel-edit",
        label: "Cancel Edit",
        keybindings: [monaco.KeyCode.Escape],
        run: () => {
          if (onCancel) {
            onCancel();
          }
        },
      });
    },
    [updateDecorations, onSave, onCancel]
  );

  const handleChange = useCallback(
    (value: string | undefined) => {
      const newValue = value || "";
      setCurrentValue(newValue);
      onChange?.(newValue);
    },
    [onChange]
  );

  return (
    <div className="monaco-editor-wrapper" data-testid="monaco-editor-wrapper">
      <style>{`
        .monaco-error-line {
          background-color: rgba(239, 68, 68, 0.2) !important;
        }
        .monaco-error-glyph {
          background-color: #ef4444;
          width: 4px !important;
          margin-left: 3px;
        }
        .monaco-error-line-decoration {
          background-color: #ef4444;
          width: 2px !important;
        }
        .monaco-highlighted-line {
          background-color: rgba(234, 179, 8, 0.1) !important;
        }
        .monaco-highlight-line-decoration {
          background-color: #eab308;
          width: 2px !important;
        }
        .monaco-annotation-glyph {
          background-color: #3b82f6;
          width: 4px !important;
          margin-left: 3px;
          border-radius: 2px;
        }
      `}</style>
      <MonacoEditorLazy
        height={height}
        language={language}
        value={currentValue}
        theme={resolvedTheme}
        onChange={handleChange}
        onMount={handleEditorDidMount}
        options={{
          readOnly,
          minimap: { enabled: showMinimap },
          fontSize: 14,
          fontFamily: "'JetBrains Mono', 'Fira Code', 'Monaco', monospace",
          lineNumbers: "on",
          glyphMargin: true,
          folding: true,
          lineDecorationsWidth: 10,
          lineNumbersMinChars: 3,
          scrollBeyondLastLine: false,
          automaticLayout: true,
          tabSize: 2,
          wordWrap: "on",
          padding: { top: 12, bottom: 12 },
          renderLineHighlight: "line",
          cursorBlinking: "smooth",
          cursorSmoothCaretAnimation: "on",
          smoothScrolling: true,
          contextmenu: true,
          formatOnPaste: true,
          formatOnType: true,
        }}
      />
    </div>
  );
}

export function MonacoCodeEditor(props: MonacoCodeEditorProps) {
  return (
    <div className={cn("rounded-lg overflow-hidden border border-zinc-800", props.className)}>
      <EditorErrorBoundary editorType="monaco" fallbackContent={props.code}>
        <Suspense fallback={<EditorSkeleton height={props.height || "400px"} />}>
          <MonacoEditorInner {...props} />
        </Suspense>
      </EditorErrorBoundary>
    </div>
  );
}
