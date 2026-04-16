import { useState, useCallback, useMemo } from "react";
import { Copy, Check } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

interface CodeArtifactProps {
  content: string;
  language?: string;
}

export function CodeArtifact({ content, language }: CodeArtifactProps) {
  const [copied, setCopied] = useState(false);

  const lines = useMemo(() => content.split("\n"), [content]);

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
        <div className="flex items-center gap-2">
          {language && (
            <Badge variant="secondary" className="text-xs font-mono">
              {language}
            </Badge>
          )}
          <span className="text-xs text-muted-foreground">
            {lines.length} lines
          </span>
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

      {/* Code display */}
      <div className="flex-1 overflow-auto bg-slate-950 p-4">
        <pre className="text-sm font-mono leading-relaxed">
          <code className={cn(language && `language-${language}`)}>
            {lines.map((line, i) => (
              <div key={i} className="flex">
                <span className="inline-block w-10 shrink-0 text-right pr-4 text-slate-500 select-none">
                  {i + 1}
                </span>
                <span className="text-slate-200 whitespace-pre-wrap break-all">
                  {line}
                </span>
              </div>
            ))}
          </code>
        </pre>
      </div>
    </div>
  );
}
