import { useCallback } from "react";
import { ChevronLeft, ChevronRight, X } from "lucide-react";
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

function ArtifactContent({
  type,
  content,
  language,
}: {
  type: string;
  content: string;
  language?: string;
}) {
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

const typeLabels: Record<string, string> = {
  code: "Code",
  html: "HTML",
  diagram: "Diagram",
  table: "Table",
  text: "Text",
};

export function ArtifactPanel() {
  const { artifacts, activeArtifactId, isPanelOpen, closePanel, navigateVersion } =
    useArtifactStore();

  const artifact = activeArtifactId ? artifacts.get(activeArtifactId) : null;

  const handlePrevVersion = useCallback(() => {
    if (!artifact) return;
    navigateVersion(artifact.id, artifact.currentVersionIndex - 1);
  }, [artifact, navigateVersion]);

  const handleNextVersion = useCallback(() => {
    if (!artifact) return;
    navigateVersion(artifact.id, artifact.currentVersionIndex + 1);
  }, [artifact, navigateVersion]);

  const canGoPrev = artifact ? artifact.currentVersionIndex > 0 : false;
  const canGoNext = artifact
    ? artifact.currentVersionIndex < artifact.versions.length - 1
    : false;

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
                  <SheetTitle className="truncate text-base">
                    {artifact.title}
                  </SheetTitle>
                  <Badge variant="outline" className="text-[10px] shrink-0">
                    {typeLabels[artifact.type] ?? artifact.type}
                  </Badge>
                </div>
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-7 w-7 shrink-0"
                  onClick={closePanel}
                >
                  <X className="h-4 w-4" />
                </Button>
              </div>

              {/* Version navigator */}
              {artifact.versions.length > 1 && (
                <div className="flex items-center gap-2 pt-1">
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-6 w-6"
                    disabled={!canGoPrev}
                    onClick={handlePrevVersion}
                  >
                    <ChevronLeft className="h-3.5 w-3.5" />
                  </Button>
                  <span className="text-xs text-muted-foreground tabular-nums">
                    {artifact.versions[artifact.currentVersionIndex]?.label ??
                      `v${artifact.currentVersionIndex + 1}`}{" "}
                    / {artifact.versions.length}
                  </span>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-6 w-6"
                    disabled={!canGoNext}
                    onClick={handleNextVersion}
                  >
                    <ChevronRight className="h-3.5 w-3.5" />
                  </Button>
                </div>
              )}
              <SheetDescription className="sr-only">
                Artifact panel showing {artifact.type} content
              </SheetDescription>
            </SheetHeader>

            {/* Body */}
            <div className="flex-1 overflow-hidden">
              <ArtifactContent
                type={artifact.type}
                content={artifact.content}
                language={artifact.language}
              />
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
