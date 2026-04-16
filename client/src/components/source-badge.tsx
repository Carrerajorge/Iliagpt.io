import React, { memo, useState } from "react";
import { ExternalLink, Globe } from "lucide-react";
import { cn } from "@/lib/utils";

interface SourceBadgeProps {
  name: string;
  url: string;
  className?: string;
}

export const SourceBadge = memo(function SourceBadge({ name, url, className }: SourceBadgeProps) {
  const [showTooltip, setShowTooltip] = useState(false);
  const [imageError, setImageError] = useState(false);
  
  let domain = "";
  try {
    const urlObj = new URL(url);
    domain = urlObj.hostname.replace(/^www\./, "");
  } catch {
    domain = name.toLowerCase().replace(/\s+/g, "");
  }
  
  const faviconUrl = `https://www.google.com/s2/favicons?domain=${domain}&sz=32`;
  
  return (
    <span className="relative inline-block">
      <a
        href={url}
        target="_blank"
        rel="noopener noreferrer"
        className={cn(
          "inline-flex items-center gap-1.5 px-2.5 py-1 ml-1",
          "text-xs font-medium rounded-full",
          "bg-muted/80 hover:bg-muted",
          "border border-border/50 hover:border-primary/30",
          "text-muted-foreground hover:text-foreground",
          "transition-all duration-200 cursor-pointer",
          "no-underline hover:no-underline",
          className
        )}
        onMouseEnter={() => setShowTooltip(true)}
        onMouseLeave={() => setShowTooltip(false)}
        data-testid={`source-badge-${name.toLowerCase().replace(/\s+/g, '-')}`}
      >
        {!imageError ? (
          <img
            src={faviconUrl}
            alt=""
            className="w-3.5 h-3.5 rounded-full object-contain"
            onError={() => setImageError(true)}
          />
        ) : (
          <Globe className="w-3 h-3" />
        )}
        <span className="max-w-[120px] truncate">{name}</span>
      </a>
      
      {showTooltip && (
        <div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-2 z-50 animate-in fade-in-0 zoom-in-95 duration-200">
          <div className="bg-popover border border-border rounded-lg shadow-lg p-3 min-w-[200px] max-w-[280px]">
            <div className="flex items-start gap-2.5">
              {!imageError ? (
                <img
                  src={faviconUrl}
                  alt=""
                  className="w-5 h-5 rounded-full object-contain flex-shrink-0 mt-0.5"
                />
              ) : (
                <Globe className="w-5 h-5 text-muted-foreground flex-shrink-0 mt-0.5" />
              )}
              <div className="flex-1 min-w-0">
                <p className="font-medium text-sm text-foreground truncate">{name}</p>
                <p className="text-xs text-muted-foreground truncate mt-0.5">{domain}</p>
              </div>
            </div>
            <div className="flex items-center gap-1 mt-2 pt-2 border-t border-border">
              <ExternalLink className="w-3 h-3 text-muted-foreground" />
              <span className="text-xs text-muted-foreground">Click para visitar</span>
            </div>
          </div>
          <div className="absolute top-full left-1/2 -translate-x-1/2 -mt-1">
            <div className="w-2 h-2 bg-popover border-r border-b border-border rotate-45" />
          </div>
        </div>
      )}
    </span>
  );
});

export function parseSourceBadges(text: string): React.ReactNode[] {
  const pattern = /\[\[FUENTE:([^\|]+)\|([^\]]+)\]\]/g;
  const parts: React.ReactNode[] = [];
  let lastIndex = 0;
  let match;
  let keyIndex = 0;
  
  while ((match = pattern.exec(text)) !== null) {
    if (match.index > lastIndex) {
      parts.push(text.slice(lastIndex, match.index));
    }
    
    const name = match[1].trim();
    const url = match[2].trim();
    parts.push(<SourceBadge key={`source-${keyIndex++}`} name={name} url={url} />);
    lastIndex = match.index + match[0].length;
  }
  
  if (lastIndex < text.length) {
    parts.push(text.slice(lastIndex));
  }
  
  return parts.length > 0 ? parts : [text];
}
