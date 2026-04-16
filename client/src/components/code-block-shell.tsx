import { useState, useEffect, useRef, useCallback, useMemo } from "react";
import DOMPurify from "dompurify";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { VisuallyHidden } from "@radix-ui/react-visually-hidden";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { useAsyncHighlight } from "@/hooks/useAsyncHighlight";
import { useCodeAnnotations, type CodeAnnotation } from "@/hooks/useCodeAnnotations";
import { CodeAnnotationMarker } from "./code-annotation-marker";
import { CodeAnnotationTooltip } from "./code-annotation-tooltip";
import { CodeAnnotationSidebar } from "./code-annotation-sidebar";
import { CodeEditorModal } from "./code-editor-modal";
import {
  Copy,
  Check,
  Play,
  Edit3,
  MessageSquare,
  Loader2,
  PanelRightOpen,
  PanelRightClose,
  Plus,
} from "lucide-react";

type AnnotationType = 'info' | 'warning' | 'error' | 'explanation';

interface AnnotationFormState {
  isOpen: boolean;
  line: number;
  content: string;
  type: AnnotationType;
}

export interface CodeBlockShellProps {
  /** The code content to display */
  code: string;
  /** Programming language for syntax highlighting */
  language?: string;
  /** Show line numbers in the gutter */
  showLineNumbers?: boolean;
  /** Maximum height of the code container */
  maxHeight?: string;
  /** Line numbers to highlight as errors (red) */
  errorLines?: number[];
  /** Line numbers to highlight (yellow) */
  highlightedLines?: number[];
  /** Unique identifier for the code block, used for annotation persistence */
  blockId?: string;
  /** Enable annotation functionality */
  enableAnnotations?: boolean;
  /** Persist annotations to localStorage using blockId */
  persistAnnotations?: boolean;
  /** Show run button */
  runnable?: boolean;
  /** Show edit button and enable Monaco editor modal */
  editable?: boolean;
  /** Callback when code is copied */
  onCopy?: () => void;
  /** Callback when code is edited. Receives the new code string. If not provided, edits are stored in internal state. */
  onEdit?: (newCode: string) => void;
  /** Callback when run button is clicked */
  onRun?: () => void;
  /** Additional className for the container */
  className?: string;
}

const VIRTUALIZATION_THRESHOLD = 100;
const BUFFER_LINES = 10;
const LINE_HEIGHT = 22;

interface VirtualizedLinesProps {
  lines: string[];
  highlightedHtmlLines: string[];
  errorLines: Set<number>;
  highlightedLineSet: Set<number>;
  annotations: Map<number, CodeAnnotation>;
  showLineNumbers: boolean;
  containerHeight: number;
  onAddAnnotation?: (line: number) => void;
  onEditAnnotation?: (id: string, content: string) => void;
  onDeleteAnnotation?: (id: string) => void;
  onMarkerClick?: (annotation: CodeAnnotation) => void;
  annotationMode: boolean;
}

function VirtualizedLines({
  lines,
  highlightedHtmlLines,
  errorLines,
  highlightedLineSet,
  annotations,
  showLineNumbers,
  containerHeight,
  onAddAnnotation,
  onEditAnnotation,
  onDeleteAnnotation,
  onMarkerClick,
  annotationMode,
}: VirtualizedLinesProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [visibleRange, setVisibleRange] = useState({ start: 0, end: 50 });

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const handleScroll = () => {
      const scrollTop = container.scrollTop;
      const visibleLines = Math.ceil(containerHeight / LINE_HEIGHT);
      const start = Math.max(0, Math.floor(scrollTop / LINE_HEIGHT) - BUFFER_LINES);
      const end = Math.min(lines.length, start + visibleLines + BUFFER_LINES * 2);
      setVisibleRange({ start, end });
    };

    handleScroll();
    container.addEventListener("scroll", handleScroll, { passive: true });
    return () => container.removeEventListener("scroll", handleScroll);
  }, [lines.length, containerHeight]);

  const totalHeight = lines.length * LINE_HEIGHT;
  const offsetTop = visibleRange.start * LINE_HEIGHT;

  return (
    <div
      ref={containerRef}
      className="overflow-auto"
      style={{ height: containerHeight, maxHeight: containerHeight }}
      data-testid="code-virtualized-container"
    >
      <div style={{ height: totalHeight, position: "relative" }}>
        <div style={{ transform: `translateY(${offsetTop}px)` }}>
          {lines.slice(visibleRange.start, visibleRange.end).map((_, idx) => {
            const lineIndex = visibleRange.start + idx;
            const lineNum = lineIndex + 1;
            const isError = errorLines.has(lineNum);
            const isHighlighted = highlightedLineSet.has(lineNum);
            const annotation = annotations.get(lineNum);
            const htmlLine = highlightedHtmlLines[lineIndex] || "";

            return (
              <LineRow
                key={lineIndex}
                lineNum={lineNum}
                htmlLine={htmlLine}
                isError={isError}
                isHighlighted={isHighlighted}
                annotation={annotation}
                showLineNumbers={showLineNumbers}
                annotationMode={annotationMode}
                onAddAnnotation={onAddAnnotation}
                onEditAnnotation={onEditAnnotation}
                onDeleteAnnotation={onDeleteAnnotation}
                onMarkerClick={onMarkerClick}
              />
            );
          })}
        </div>
      </div>
    </div>
  );
}

interface LineRowProps {
  lineNum: number;
  htmlLine: string;
  isError: boolean;
  isHighlighted: boolean;
  annotation?: CodeAnnotation;
  showLineNumbers: boolean;
  annotationMode: boolean;
  onAddAnnotation?: (line: number) => void;
  onEditAnnotation?: (id: string, content: string) => void;
  onDeleteAnnotation?: (id: string) => void;
  onMarkerClick?: (annotation: CodeAnnotation) => void;
}

function LineRow({
  lineNum,
  htmlLine,
  isError,
  isHighlighted,
  annotation,
  showLineNumbers,
  annotationMode,
  onAddAnnotation,
  onEditAnnotation,
  onDeleteAnnotation,
  onMarkerClick,
}: LineRowProps) {
  const handleLineClick = useCallback(() => {
    if (annotationMode && onAddAnnotation && !annotation) {
      onAddAnnotation(lineNum);
    }
  }, [annotationMode, onAddAnnotation, lineNum, annotation]);

  const handleAnnotationClick = useCallback((ann: CodeAnnotation) => {
    onMarkerClick?.(ann);
  }, [onMarkerClick]);

  const markerElement = (
    <CodeAnnotationMarker
      lineNumber={lineNum}
      annotation={annotation}
      onAddAnnotation={onAddAnnotation}
      onAnnotationClick={handleAnnotationClick}
      annotationMode={annotationMode}
    />
  );

  return (
    <div
      className={cn(
        "flex group transition-colors duration-150",
        isError && "bg-red-500/20 border-l-2 border-red-500",
        isHighlighted && !isError && "bg-yellow-500/10 border-l-2 border-yellow-500",
        annotation && "bg-blue-500/5",
        annotationMode && !annotation && "cursor-pointer hover:bg-zinc-800/50"
      )}
      style={{ height: LINE_HEIGHT, lineHeight: `${LINE_HEIGHT}px` }}
      onClick={handleLineClick}
      data-testid={`code-line-${lineNum}`}
    >
      {showLineNumbers && (
        <div className="flex items-center">
          <span
            className="select-none text-zinc-500 text-right pr-2 pl-2 min-w-[2.5rem] text-xs font-mono"
            data-testid={`line-number-${lineNum}`}
          >
            {lineNum}
          </span>
          <div className="w-5 flex items-center justify-center border-r border-zinc-800 pr-1">
            {annotation ? (
              <CodeAnnotationTooltip
                annotation={annotation}
                onEdit={onEditAnnotation}
                onDelete={onDeleteAnnotation}
                trigger={markerElement}
                side="right"
              />
            ) : (
              markerElement
            )}
          </div>
        </div>
      )}
      <code
        className="flex-1 px-4 text-sm font-mono whitespace-pre overflow-hidden text-ellipsis"
        dangerouslySetInnerHTML={{ __html: DOMPurify.sanitize(htmlLine || "&nbsp;") }}
      />
    </div>
  );
}

export function CodeBlockShell({
  code,
  language = "text",
  showLineNumbers = true,
  maxHeight = "400px",
  errorLines = [],
  highlightedLines = [],
  blockId,
  enableAnnotations = false,
  persistAnnotations = false,
  runnable = false,
  editable = false,
  onCopy,
  onEdit,
  onRun,
  className,
}: CodeBlockShellProps) {
  const [copied, setCopied] = useState(false);
  const [annotationMode, setAnnotationMode] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [isEditorOpen, setIsEditorOpen] = useState(false);
  const [editedCode, setEditedCode] = useState(code);
  const [annotationForm, setAnnotationForm] = useState<AnnotationFormState>({
    isOpen: false,
    line: 0,
    content: '',
    type: 'info',
  });
  const codeContainerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setEditedCode(code);
  }, [code]);

  const generatedBlockId = useMemo(() => {
    return blockId || `code-block-${Math.random().toString(36).substring(2, 11)}`;
  }, [blockId]);

  const {
    annotations,
    addAnnotation,
    updateAnnotation,
    removeAnnotation,
  } = useCodeAnnotations(generatedBlockId, persistAnnotations);

  const displayCode = editedCode;
  const { html, isLoading, error } = useAsyncHighlight(displayCode, language);

  const openAnnotationForm = useCallback((line: number) => {
    setAnnotationForm({
      isOpen: true,
      line,
      content: '',
      type: 'info',
    });
  }, []);

  const closeAnnotationForm = useCallback(() => {
    setAnnotationForm(prev => ({ ...prev, isOpen: false }));
  }, []);

  const submitAnnotation = useCallback(() => {
    if (annotationForm.content.trim()) {
      addAnnotation(annotationForm.line, annotationForm.content.trim(), annotationForm.type);
    }
    closeAnnotationForm();
  }, [annotationForm, addAnnotation, closeAnnotationForm]);

  const handleAddAnnotation = useCallback((line: number) => {
    openAnnotationForm(line);
  }, [openAnnotationForm]);

  const lines = useMemo(() => displayCode.split("\n"), [displayCode]);
  const lineCount = lines.length;
  const shouldVirtualize = lineCount > VIRTUALIZATION_THRESHOLD;

  const highlightedHtmlLines = useMemo(() => {
    if (!html) return lines.map(() => "");
    return html.split("\n");
  }, [html, lines]);

  const errorLineSet = useMemo(() => new Set(errorLines), [errorLines]);
  const highlightedLineSet = useMemo(() => new Set(highlightedLines), [highlightedLines]);

  const handleCopy = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(displayCode);
      setCopied(true);
      onCopy?.();
      setTimeout(() => setCopied(false), 2000);
    } catch (err) {
      console.error("Failed to copy:", err);
    }
  }, [displayCode, onCopy]);

  const handleEdit = useCallback(() => {
    setIsEditorOpen(true);
  }, []);

  const handleSaveCode = useCallback((newCode: string) => {
    setEditedCode(newCode);
    if (onEdit) {
      onEdit(newCode);
    }
  }, [onEdit]);

  const handleRun = useCallback(() => {
    onRun?.();
  }, [onRun]);

  const toggleAnnotationMode = useCallback(() => {
    setAnnotationMode((prev) => {
      const newMode = !prev;
      if (newMode && annotations.size > 0) {
        setSidebarOpen(true);
      }
      return newMode;
    });
  }, [annotations.size]);

  const toggleSidebar = useCallback(() => {
    setSidebarOpen((prev) => !prev);
  }, []);

  const containerHeightPx = useMemo(() => {
    const parsed = parseInt(maxHeight, 10);
    return isNaN(parsed) ? 400 : parsed;
  }, [maxHeight]);

  const scrollToLine = useCallback((lineNum: number) => {
    const container = codeContainerRef.current;
    if (!container) return;

    const targetScrollTop = (lineNum - 1) * LINE_HEIGHT;
    container.scrollTo({
      top: Math.max(0, targetScrollTop - containerHeightPx / 3),
      behavior: "smooth",
    });

    const lineElement = container.querySelector(`[data-testid="code-line-${lineNum}"]`);
    if (lineElement) {
      lineElement.classList.add("ring-2", "ring-blue-500/50");
      setTimeout(() => {
        lineElement.classList.remove("ring-2", "ring-blue-500/50");
      }, 2000);
    }
  }, [containerHeightPx]);

  const handleSidebarAnnotationClick = useCallback((annotation: CodeAnnotation) => {
    scrollToLine(annotation.line);
  }, [scrollToLine]);

  const handleMarkerClick = useCallback((annotation: CodeAnnotation) => {
    if (!sidebarOpen) {
      setSidebarOpen(true);
    }
  }, [sidebarOpen]);

  const annotationsArray = useMemo(() => Array.from(annotations.values()), [annotations]);

  return (
    <div
      className={cn(
        "rounded-xl border border-zinc-800/80 bg-[#0d0d0d]/95 backdrop-blur-md overflow-hidden shadow-xl shadow-black/20",
        className
      )}
      data-testid="code-block-shell"
    >
      <div
        className="flex items-center justify-between px-4 py-2 bg-gradient-to-b from-zinc-800/40 to-zinc-900/40 border-b border-zinc-800/60 backdrop-blur-sm"
        data-testid="code-block-toolbar"
      >
        <div className="flex items-center gap-3">
          <div className="flex gap-1.5 mr-2">
            <div className="w-3 h-3 rounded-full bg-[#FF5F56] border border-[#E0443E] shadow-sm"></div>
            <div className="w-3 h-3 rounded-full bg-[#FFBD2E] border border-[#DEA123] shadow-sm"></div>
            <div className="w-3 h-3 rounded-full bg-[#27C93F] border border-[#1AAB29] shadow-sm"></div>
          </div>
          <span className="text-[11px] text-zinc-400 font-mono tracking-wider">
            {language}
          </span>
          <span className="text-[11px] text-zinc-600 font-mono">
            {lineCount} {lineCount === 1 ? "line" : "lines"}
          </span>
        </div>

        <div className="flex items-center gap-1">
          {enableAnnotations && (
            <>
              <Button
                variant="ghost"
                size="sm"
                className={cn(
                  "h-7 w-7 p-0 text-zinc-400 hover:text-white hover:bg-zinc-800",
                  annotationMode && "text-blue-400 bg-blue-500/10"
                )}
                onClick={toggleAnnotationMode}
                data-testid="button-annotate"
                title="Toggle annotation mode"
              >
                <MessageSquare className="w-3.5 h-3.5" />
              </Button>
              {annotationsArray.length > 0 && (
                <Button
                  variant="ghost"
                  size="sm"
                  className={cn(
                    "h-7 w-7 p-0 text-zinc-400 hover:text-white hover:bg-zinc-800",
                    sidebarOpen && "text-blue-400 bg-blue-500/10"
                  )}
                  onClick={toggleSidebar}
                  data-testid="button-toggle-sidebar"
                  title="Toggle annotations sidebar"
                >
                  {sidebarOpen ? (
                    <PanelRightClose className="w-3.5 h-3.5" />
                  ) : (
                    <PanelRightOpen className="w-3.5 h-3.5" />
                  )}
                </Button>
              )}
            </>
          )}

          {editable && onEdit && (
            <Button
              variant="ghost"
              size="sm"
              className="h-7 w-7 p-0 text-zinc-400 hover:text-white hover:bg-zinc-800"
              onClick={handleEdit}
              data-testid="button-edit"
              title="Edit code"
            >
              <Edit3 className="w-3.5 h-3.5" />
            </Button>
          )}

          {runnable && onRun && (
            <Button
              variant="ghost"
              size="sm"
              className="h-7 w-7 p-0 text-zinc-400 hover:text-emerald-400 hover:bg-emerald-500/10"
              onClick={handleRun}
              data-testid="button-run"
              title="Run code"
            >
              <Play className="w-3.5 h-3.5" />
            </Button>
          )}

          <Button
            variant="ghost"
            size="sm"
            className="h-7 w-7 p-0 text-zinc-400 hover:text-white hover:bg-zinc-800"
            onClick={handleCopy}
            data-testid="button-copy"
            title="Copy code"
          >
            {copied ? (
              <Check className="w-3.5 h-3.5 text-green-400" />
            ) : (
              <Copy className="w-3.5 h-3.5" />
            )}
          </Button>
        </div>
      </div>

      <div className="relative">
        {isLoading && (
          <div
            className="absolute inset-0 flex items-center justify-center bg-zinc-950/80 z-10"
            data-testid="code-loading"
          >
            <Loader2 className="w-5 h-5 text-zinc-400 animate-spin" />
          </div>
        )}

        {error && (
          <div
            className="absolute top-2 right-2 text-xs text-amber-400 bg-amber-500/10 px-2 py-1 rounded"
            data-testid="code-error"
          >
            Syntax highlighting unavailable
          </div>
        )}

        <div className="flex">
          <div className={cn("flex-1 min-w-0", sidebarOpen && enableAnnotations && "max-w-[70%]")}>
            {shouldVirtualize ? (
              <VirtualizedLines
                lines={lines}
                highlightedHtmlLines={highlightedHtmlLines}
                errorLines={errorLineSet}
                highlightedLineSet={highlightedLineSet}
                annotations={annotations}
                showLineNumbers={showLineNumbers}
                containerHeight={containerHeightPx}
                onAddAnnotation={enableAnnotations ? handleAddAnnotation : undefined}
                onEditAnnotation={enableAnnotations ? updateAnnotation : undefined}
                onDeleteAnnotation={enableAnnotations ? removeAnnotation : undefined}
                onMarkerClick={enableAnnotations ? handleMarkerClick : undefined}
                annotationMode={annotationMode}
              />
            ) : (
              <div
                ref={codeContainerRef}
                className="overflow-auto text-zinc-100"
                style={{ maxHeight }}
                data-testid="code-container"
              >
                {lines.map((_, lineIndex) => {
                  const lineNum = lineIndex + 1;
                  const isError = errorLineSet.has(lineNum);
                  const isHighlighted = highlightedLineSet.has(lineNum);
                  const annotation = annotations.get(lineNum);
                  const htmlLine = highlightedHtmlLines[lineIndex] || "";

                  return (
                    <LineRow
                      key={lineIndex}
                      lineNum={lineNum}
                      htmlLine={htmlLine}
                      isError={isError}
                      isHighlighted={isHighlighted}
                      annotation={annotation}
                      showLineNumbers={showLineNumbers}
                      annotationMode={annotationMode}
                      onAddAnnotation={enableAnnotations ? handleAddAnnotation : undefined}
                      onEditAnnotation={enableAnnotations ? updateAnnotation : undefined}
                      onDeleteAnnotation={enableAnnotations ? removeAnnotation : undefined}
                      onMarkerClick={enableAnnotations ? handleMarkerClick : undefined}
                    />
                  );
                })}
              </div>
            )}
          </div>

          {enableAnnotations && sidebarOpen && (
            <div className="w-[30%] min-w-[200px] max-w-[300px]" style={{ height: maxHeight }}>
              <CodeAnnotationSidebar
                annotations={annotationsArray}
                onAnnotationClick={handleSidebarAnnotationClick}
                onEdit={updateAnnotation}
                onDelete={removeAnnotation}
                isOpen={true}
                onToggle={toggleSidebar}
              />
            </div>
          )}
        </div>
      </div>

      {editable && (
        <CodeEditorModal
          open={isEditorOpen}
          onOpenChange={setIsEditorOpen}
          code={displayCode}
          language={language}
          title={`Edit ${language.charAt(0).toUpperCase() + language.slice(1)} Code`}
          onSave={handleSaveCode}
        />
      )}

      {enableAnnotations && (
        <Dialog open={annotationForm.isOpen} onOpenChange={(open) => !open && closeAnnotationForm()}>
          <DialogContent
            className="max-w-sm bg-zinc-900 border-zinc-700"
            data-testid="annotation-dialog"
          >
            <DialogHeader>
              <DialogTitle className="text-zinc-100">
                Add Annotation (Line {annotationForm.line})
              </DialogTitle>
              <VisuallyHidden>
                <DialogDescription>Agregar una anotación a la línea de código</DialogDescription>
              </VisuallyHidden>
            </DialogHeader>

            <div className="space-y-4 py-2">
              <div className="space-y-2">
                <Label htmlFor="annotation-type" className="text-xs text-zinc-400">
                  Type
                </Label>
                <Select
                  value={annotationForm.type}
                  onValueChange={(value: AnnotationType) =>
                    setAnnotationForm(prev => ({ ...prev, type: value }))
                  }
                >
                  <SelectTrigger
                    id="annotation-type"
                    className="bg-zinc-800 border-zinc-700 text-zinc-200"
                    data-testid="select-annotation-type"
                  >
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent className="bg-zinc-800 border-zinc-700">
                    <SelectItem value="info" className="text-blue-400">
                      ℹ️ Info
                    </SelectItem>
                    <SelectItem value="warning" className="text-yellow-400">
                      ⚠️ Warning
                    </SelectItem>
                    <SelectItem value="error" className="text-red-400">
                      ❌ Error
                    </SelectItem>
                    <SelectItem value="explanation" className="text-green-400">
                      💡 Explanation
                    </SelectItem>
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-2">
                <Label htmlFor="annotation-content" className="text-xs text-zinc-400">
                  Content
                </Label>
                <Textarea
                  id="annotation-content"
                  value={annotationForm.content}
                  onChange={(e) =>
                    setAnnotationForm(prev => ({ ...prev, content: e.target.value }))
                  }
                  placeholder="Enter your annotation..."
                  className="bg-zinc-800 border-zinc-700 text-zinc-200 placeholder:text-zinc-500 min-h-[100px] resize-none"
                  data-testid="textarea-annotation-content"
                  autoFocus
                />
              </div>
            </div>

            <DialogFooter>
              <Button
                variant="outline"
                size="sm"
                onClick={closeAnnotationForm}
                className="border-zinc-700 text-zinc-300 hover:bg-zinc-800"
                data-testid="button-cancel-annotation"
              >
                Cancel
              </Button>
              <Button
                size="sm"
                onClick={submitAnnotation}
                disabled={!annotationForm.content.trim()}
                className="bg-blue-600 hover:bg-blue-700 text-white"
                data-testid="button-submit-annotation"
              >
                <Plus className="w-3.5 h-3.5 mr-1" />
                Add
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      )}
    </div>
  );
}

export default CodeBlockShell;
