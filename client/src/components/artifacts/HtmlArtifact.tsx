import { useState, useCallback } from "react";
import { Eye, Code, Copy, Check } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

interface HtmlArtifactProps {
  content: string;
}

export function HtmlArtifact({ content }: HtmlArtifactProps) {
  const [view, setView] = useState<"preview" | "source">("preview");
  const [copied, setCopied] = useState(false);

  const handleCopy = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(content);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch (err) {
      console.error("Failed to copy:", err);
    }
  }, [content]);

  return (
    <div className="flex flex-col h-full">
      {/* Toolbar */}
      <div className="flex items-center justify-between px-4 py-2 border-b border-border bg-muted/50">
        <div className="flex items-center gap-1">
          <Button
            variant={view === "preview" ? "secondary" : "ghost"}
            size="sm"
            className="h-7 gap-1.5 text-xs"
            onClick={() => setView("preview")}
          >
            <Eye className="h-3.5 w-3.5" />
            Preview
          </Button>
          <Button
            variant={view === "source" ? "secondary" : "ghost"}
            size="sm"
            className="h-7 gap-1.5 text-xs"
            onClick={() => setView("source")}
          >
            <Code className="h-3.5 w-3.5" />
            Source
          </Button>
        </div>
        <Button
          variant="ghost"
          size="sm"
          className="h-7 gap-1.5 text-xs"
          onClick={handleCopy}
        >
          {copied ? (
            <>
              <Check className="h-3.5 w-3.5 text-green-500" />
              Copied
            </>
          ) : (
            <>
              <Copy className="h-3.5 w-3.5" />
              Copy
            </>
          )}
        </Button>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-auto">
        {view === "preview" ? (
          <iframe
            srcDoc={content}
            sandbox="allow-scripts"
            className="w-full h-full border-0 bg-white"
            title="HTML Preview"
          />
        ) : (
          <pre className="p-4 text-sm font-mono bg-slate-950 text-slate-200 whitespace-pre-wrap h-full overflow-auto">
            {content}
          </pre>
        )}
      </div>
    </div>
  );
}
