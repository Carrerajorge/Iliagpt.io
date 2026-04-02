import { useState, useEffect, useCallback, memo } from "react";
import { ExternalLink, X, Megaphone } from "lucide-react";
import { cn } from "@/lib/utils";

interface AdData {
  id: number;
  title: string;
  description: string;
  imageUrl?: string | null;
  targetUrl: string;
  advertiser: string;
}

interface IliaAdBannerProps {
  query?: string;
  messageId: string;
  className?: string;
}

export const IliaAdBanner = memo(function IliaAdBanner({
  query,
  messageId,
  className,
}: IliaAdBannerProps) {
  const [ad, setAd] = useState<AdData | null>(null);
  const [dismissed, setDismissed] = useState(false);
  const [impressionLogged, setImpressionLogged] = useState(false);

  useEffect(() => {
    if (!query || dismissed) return;

    const controller = new AbortController();
    fetch(`/api/ads/match?q=${encodeURIComponent(query)}`, {
      signal: controller.signal,
    })
      .then((r) => r.json())
      .then((data) => {
        if (data.ad) setAd(data.ad);
      })
      .catch(() => {});

    return () => controller.abort();
  }, [query, dismissed]);

  useEffect(() => {
    if (!ad || impressionLogged) return;
    setImpressionLogged(true);
    fetch("/api/ads/impression", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ adId: ad.id, query }),
    }).catch(() => {});
  }, [ad, impressionLogged, query]);

  const handleClick = useCallback(() => {
    if (!ad) return;
    fetch("/api/ads/click", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ adId: ad.id }),
    }).catch(() => {});
    window.open(ad.targetUrl, "_blank", "noopener");
  }, [ad]);

  if (!ad || dismissed) return null;

  return (
    <div
      className={cn(
        "mt-3 rounded-lg border border-border/40 bg-muted/30 p-3 max-w-md transition-all hover:bg-muted/50 group/ad",
        className
      )}
      data-testid={`ad-banner-${messageId}`}
    >
      <div className="flex items-center gap-1.5 mb-1.5">
        <Megaphone className="h-3 w-3 text-muted-foreground/60" />
        <span className="text-[10px] uppercase tracking-wider text-muted-foreground/60 font-medium">
          Publicidad
        </span>
        <button
          onClick={() => setDismissed(true)}
          className="ml-auto p-0.5 rounded hover:bg-muted text-muted-foreground/40 hover:text-muted-foreground transition-colors opacity-0 group-hover/ad:opacity-100"
          data-testid={`ad-dismiss-${messageId}`}
        >
          <X className="h-3 w-3" />
        </button>
      </div>

      <button
        onClick={handleClick}
        className="flex gap-3 items-start text-left w-full group/link"
        data-testid={`ad-click-${messageId}`}
      >
        {ad.imageUrl && (
          <img
            src={ad.imageUrl}
            alt={ad.title}
            className="w-14 h-14 rounded-md object-cover flex-shrink-0"
            data-testid={`ad-image-${messageId}`}
          />
        )}
        <div className="min-w-0 flex-1">
          <p className="text-sm font-medium text-foreground/90 truncate group-hover/link:text-primary transition-colors flex items-center gap-1">
            {ad.title}
            <ExternalLink className="h-3 w-3 opacity-0 group-hover/link:opacity-60 transition-opacity flex-shrink-0" />
          </p>
          <p className="text-xs text-muted-foreground line-clamp-2 mt-0.5">
            {ad.description}
          </p>
          <p className="text-[10px] text-muted-foreground/50 mt-1">
            {ad.advertiser}
          </p>
        </div>
      </button>
    </div>
  );
});

export default IliaAdBanner;
