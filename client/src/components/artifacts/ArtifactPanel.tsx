import { useState, useCallback, useRef } from "react";
import { Code, Eye, History, Play, Copy, Check, Pencil, X, MessageSquare } from "lucide-react";
import { useArtifactStore } from "@/stores/artifactStore";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
} from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { CodeArtifact } from "./CodeArtifact";
import { HtmlArtifact } from "./HtmlArtifact";
import { DiagramArtifact } from "./DiagramArtifact";
import { TableArtifact } from "./TableArtifact";
import { toast } from "@/hooks/use-toast";

type Tab = "code" | "preview" | "versions";

const typeLabels: Record<string, string> = {
  code: "Code",
  html: "HTML",
  diagram: "Diagram",
  table: "Table",
  text: "Text",
};

const runnableTypes = new Set(["html", "code"]);

function TabButton({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-md transition-colors ${
        active
          ? "bg-primary text-primary-foreground"
          : "text-muted-foreground hover:text-foreground hover:bg-muted"
      }`}
    >
      {children}
    </button>
  );
}

export function ArtifactPanel() {
  const { artifacts, activeArtifactId, isPanelOpen, closePanel, navigateVersion } =
    useArtifactStore();

  const [activeTab, setActiveTab] = useState<Tab>("code");
  const [isEditing, setIsEditing] = useState(false);
  const [editContent, setEditContent] = useState("");
  const [copied, setCopied] = useState(false);
  const iframeRef = useRef<HTMLIFrameElement>(null);

  const artifact = activeArtifactId ? artifacts.get(activeArtifactId) : null;
  const content = isEditing ? editContent : artifact?.content ?? "";

  const handleRun = useCallback(() => {
    setActiveTab("preview");
  }, []);

  const handleCopyToChat = useCallback(() => {
    if (!artifact) return;
    navigator.clipboard.writeText(artifact.content).then(() => {
      setCopied(true);
      toast({ title: "Copied to clipboard", description: "Artifact content copied. Paste it into the chat." });
      setTimeout(() => setCopied(false), 2000);
    });
  }, [artifact]);

  const handleEditToggle = useCallback(() => {
    if (!isEditing && artifact) {
      setEditContent(artifact.content);
    }
    setIsEditing((prev) => !prev);
  }, [isEditing, artifact]);

  const handleVersionSelect = useCallback(
    (index: number) => {
      if (!artifact) return;
      navigateVersion(artifact.id, index);
      setActiveTab("code");
    },
    [artifact, navigateVersion],
  );

  const formatTime = (ts: number) =>
    new Date(ts).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });

  return (
    <Sheet open={isPanelOpen} onOpenChange={(open) => !open && closePanel()}>
      <SheetContent
        side="right"
        className="w-full sm:max-w-none sm:w-[50vw] p-0 flex flex-col gap-0"
      >
        {artifact ? (
          <>
            {/* Header */}
            <SheetHeader className="px-4 py-3 border-b border-border space-y-0">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2 min-w-0">
                  <SheetTitle className="truncate text-base">{artifact.title}</SheetTitle>
                  <Badge variant="outline" className="text-[10px] shrink-0">
                    {typeLabels[artifact.type] ?? artifact.type}
                  </Badge>
                </div>
                <Button variant="ghost" size="icon" className="h-7 w-7 shrink-0" onClick={closePanel}>
                  <X className="h-4 w-4" />
                </Button>
              </div>
              <SheetDescription className="sr-only">
                Artifact panel showing {artifact.type} content
              </SheetDescription>
            </SheetHeader>

            {/* Toolbar */}
            <div className="flex items-center justify-between px-4 py-2 border-b border-border bg-muted/40">
              {/* Tabs */}
              <div className="flex items-center gap-1">
                <TabButton active={activeTab === "code"} onClick={() => setActiveTab("code")}>
                  <Code className="h-3.5 w-3.5" /> Code
                </TabButton>
                <TabButton active={activeTab === "preview"} onClick={() => setActiveTab("preview")}>
                  <Eye className="h-3.5 w-3.5" /> Preview
                </TabButton>
                <TabButton active={activeTab === "versions"} onClick={() => setActiveTab("versions")}>
                  <History className="h-3.5 w-3.5" /> Versions
                  {artifact.versions.length > 1 && (
                    <span className="ml-0.5 text-[10px] opacity-70">({artifact.versions.length})</span>
                  )}
                </TabButton>
              </div>

              {/* Actions */}
              <div className="flex items-center gap-1">
                {runnableTypes.has(artifact.type) && (
                  <Button variant="ghost" size="sm" className="h-7 gap-1 text-xs" onClick={handleRun}>
                    <Play className="h-3.5 w-3.5" /> Run
                  </Button>
                )}
                <Button variant="ghost" size="sm" className="h-7 gap-1 text-xs" onClick={handleEditToggle}>
                  <Pencil className="h-3.5 w-3.5" /> {isEditing ? "Done" : "Edit"}
                </Button>
                <Button variant="ghost" size="sm" className="h-7 gap-1 text-xs" onClick={handleCopyToChat}>
                  {copied ? <Check className="h-3.5 w-3.5" /> : <MessageSquare className="h-3.5 w-3.5" />}
                  {copied ? "Copied" : "Apply"}
                </Button>
              </div>
            </div>

            {/* Body */}
            <div className="flex-1 overflow-auto">
              {activeTab === "code" && (
                isEditing ? (
                  <textarea
                    className="w-full h-full min-h-[300px] p-4 font-mono text-sm bg-background text-foreground resize-none focus:outline-none"
                    value={editContent}
                    onChange={(e) => setEditContent(e.target.value)}
                    spellCheck={false}
                  />
                ) : (
                  <ArtifactContent type={artifact.type} content={content} language={artifact.language} />
                )
              )}

              {activeTab === "preview" && (
                artifact.type === "html" ? (
                  <iframe
                    ref={iframeRef}
                    title="Artifact preview"
                    srcDoc={content}
                    className="w-full h-full min-h-[400px] border-0 bg-white"
                    sandbox="allow-scripts allow-modals"
                  />
                ) : (
                  <div className="flex flex-col items-center justify-center h-full min-h-[300px] text-muted-foreground text-sm gap-2">
                    <Play className="h-8 w-8 opacity-30" />
                    <p>Preview not available for {typeLabels[artifact.type] ?? artifact.type} artifacts.</p>
                    <p className="text-xs">Execution is delegated to the agent runtime.</p>
                  </div>
                )
              )}

              {activeTab === "versions" && (
                <div className="p-4 space-y-2">
                  {artifact.versions.map((v, i) => (
                    <button
                      key={v.id}
                      type="button"
                      onClick={() => handleVersionSelect(i)}
                      className={`w-full text-left px-3 py-2 rounded-md border text-sm transition-colors ${
                        i === artifact.currentVersionIndex
                          ? "border-primary bg-primary/5 font-medium"
                          : "border-border hover:bg-muted"
                      }`}
                    >
                      <div className="flex items-center justify-between">
                        <span>{v.label ?? `v${i + 1}`}</span>
                        <span className="text-xs text-muted-foreground">{formatTime(v.timestamp)}</span>
                      </div>
                      <p className="text-xs text-muted-foreground mt-0.5 truncate">
                        {v.content.slice(0, 80)}
                        {v.content.length > 80 ? "..." : ""}
                      </p>
                    </button>
                  ))}
                </div>
              )}
            </div>
          </>
        ) : (
          <div className="flex items-center justify-center h-full text-muted-foreground text-sm">
            No artifact selected
          </div>
        )}
      </SheetContent>
    </Sheet>
  );
}

function ArtifactContent({ type, content, language }: { type: string; content: string; language?: string }) {
  switch (type) {
    case "code":
      return <CodeArtifact content={content} language={language} />;
    case "html":
      return <HtmlArtifact content={content} />;
    case "diagram":
      return <DiagramArtifact content={content} />;
    case "table":
      return <TableArtifact content={content} />;
    case "text":
      return <CodeArtifact content={content} language="text" />;
    default:
      return <CodeArtifact content={content} language={language} />;
  }
}
