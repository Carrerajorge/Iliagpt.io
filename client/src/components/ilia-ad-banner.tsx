import { useState, useEffect, useCallback, memo } from "react";
import { X, Megaphone } from "lucide-react";
import { cn } from "@/lib/utils";

interface AdData {
  id: number;
  title: string;
  description: string;
  imageUrl?: string | null;
  targetUrl: string;
  advertiser: string;
  keyword?: string;
}

interface IliaAdBannerProps {
  query?: string;
  messageId: string;
  className?: string;
}

const WhatsAppIcon = ({ className }: { className?: string }) => (
  <svg viewBox="0 0 24 24" fill="currentColor" className={className}>
    <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413z" />
  </svg>
);

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

  const isWhatsApp = ad?.targetUrl?.includes("wa.me");

  if (!ad || dismissed) return null;

  return (
    <div
      className={cn(
        "mt-2.5 rounded-xl border border-border/30 bg-muted/20 p-2.5 max-w-lg transition-all hover:bg-muted/35 group/ad",
        className
      )}
      data-testid={`ad-banner-${messageId}`}
    >
      <div className="flex items-center gap-1.5 mb-2">
        <Megaphone className="h-3 w-3 text-muted-foreground/50" />
        <span className="text-[9px] uppercase tracking-widest text-muted-foreground/50 font-medium select-none">
          Publicidad
        </span>
        <button
          onClick={() => setDismissed(true)}
          className="ml-auto p-0.5 rounded hover:bg-muted text-muted-foreground/30 hover:text-muted-foreground transition-colors opacity-0 group-hover/ad:opacity-100"
          data-testid={`ad-dismiss-${messageId}`}
          aria-label="Cerrar anuncio"
        >
          <X className="h-3 w-3" />
        </button>
      </div>

      <div className="flex items-center gap-3">
        <button
          onClick={handleClick}
          className="flex gap-2.5 items-center text-left flex-1 min-w-0 group/link"
          data-testid={`ad-click-${messageId}`}
        >
          {ad.imageUrl && (
            <img
              src={ad.imageUrl}
              alt={ad.title}
              className="w-11 h-11 rounded-lg object-cover flex-shrink-0 border border-border/20"
              data-testid={`ad-image-${messageId}`}
            />
          )}
          <div className="min-w-0 flex-1">
            <p className="text-[13px] font-medium text-foreground/85 truncate group-hover/link:text-primary transition-colors leading-tight">
              {ad.title}
            </p>
            <p className="text-[11px] text-muted-foreground/70 line-clamp-1 mt-0.5 leading-tight">
              {ad.description}
            </p>
            <p className="text-[9px] text-muted-foreground/40 mt-0.5 leading-tight">
              {ad.advertiser}
            </p>
          </div>
        </button>

        {isWhatsApp && (
          <button
            onClick={handleClick}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-[#25D366]/10 hover:bg-[#25D366]/20 border border-[#25D366]/20 hover:border-[#25D366]/30 transition-all flex-shrink-0 group/wa"
            data-testid={`ad-whatsapp-${messageId}`}
          >
            <WhatsAppIcon className="h-4 w-4 text-[#25D366]" />
            <span className="text-[11px] font-medium text-[#25D366] whitespace-nowrap">
              WhatsApp
            </span>
          </button>
        )}

        {!isWhatsApp && (
          <button
            onClick={handleClick}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-primary/5 hover:bg-primary/10 border border-primary/15 hover:border-primary/25 transition-all flex-shrink-0"
            data-testid={`ad-cta-${messageId}`}
          >
            <span className="text-[11px] font-medium text-primary whitespace-nowrap">
              Ver mas
            </span>
          </button>
        )}
      </div>
    </div>
  );
});

export default IliaAdBanner;
