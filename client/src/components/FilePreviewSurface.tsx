import React, { useMemo } from "react";
import DOMPurify from "dompurify";
import { cn } from "@/lib/utils";
import type { FilePreviewData } from "@/lib/filePreviewTypes";

interface FilePreviewSurfaceProps {
  preview: FilePreviewData;
  variant?: "thumbnail" | "modal";
  className?: string;
}

const PREVIEW_ALLOWED_TAGS = [
  "article",
  "div",
  "section",
  "span",
  "h1",
  "h2",
  "h3",
  "h4",
  "h5",
  "h6",
  "p",
  "br",
  "strong",
  "em",
  "u",
  "b",
  "i",
  "ul",
  "ol",
  "li",
  "table",
  "thead",
  "tbody",
  "tfoot",
  "tr",
  "th",
  "td",
  "caption",
  "colgroup",
  "col",
  "img",
  "style",
];

const PREVIEW_ALLOWED_ATTR = [
  "class",
  "style",
  "src",
  "alt",
  "title",
  "colspan",
  "rowspan",
  "aria-label",
];

function sanitizePreviewHtml(html: string): string {
  return DOMPurify.sanitize(html, {
    ALLOWED_TAGS: PREVIEW_ALLOWED_TAGS,
    ALLOWED_ATTR: PREVIEW_ALLOWED_ATTR,
    FORBID_TAGS: ["script", "iframe", "object", "embed", "form", "input", "button"],
    FORBID_ATTR: ["onerror", "onload", "onclick", "onmouseover", "onmouseenter"],
  });
}

export function FilePreviewSurface({
  preview,
  variant = "modal",
  className,
}: FilePreviewSurfaceProps) {
  const sanitizedHtml = useMemo(
    () => (preview.html ? sanitizePreviewHtml(preview.html) : ""),
    [preview.html],
  );

  if (preview.html) {
    if (variant === "thumbnail") {
      const scale = preview.type === "pptx" ? 0.22 : preview.type === "xlsx" || preview.type === "csv" ? 0.24 : 0.28;

      return (
        <div className={cn("relative h-full w-full overflow-hidden rounded-xl bg-white text-black", className)}>
          <div
            className="pointer-events-none absolute inset-0 origin-top-left"
            style={{
              transform: `scale(${scale})`,
              width: `${100 / scale}%`,
              height: `${100 / scale}%`,
            }}
            dangerouslySetInnerHTML={{ __html: sanitizedHtml }}
          />
        </div>
      );
    }

    return (
      <div
        className={cn("min-h-full w-full overflow-auto rounded-xl", className)}
        dangerouslySetInnerHTML={{ __html: sanitizedHtml }}
      />
    );
  }

  if (preview.content) {
    return variant === "thumbnail" ? (
      <div className={cn("h-full w-full overflow-hidden rounded-xl bg-white px-3 py-2 text-[10px] leading-4 text-slate-700", className)}>
        <pre className="line-clamp-6 whitespace-pre-wrap font-mono">{preview.content}</pre>
      </div>
    ) : (
      <pre className={cn("whitespace-pre-wrap break-words rounded-xl bg-muted/50 p-4 text-sm", className)}>
        {preview.content}
      </pre>
    );
  }

  return (
    <div className={cn("flex h-full w-full items-center justify-center rounded-xl bg-muted/40 px-3 text-center text-xs text-muted-foreground", className)}>
      {preview.message || "Vista previa no disponible"}
    </div>
  );
}
