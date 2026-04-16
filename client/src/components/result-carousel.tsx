import { memo, useState, useRef, useEffect, useCallback } from "react";
import { cn } from "@/lib/utils";
import { ChevronLeft, ChevronRight, ExternalLink, FileText } from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
import { Button } from "@/components/ui/button";

interface CarouselItem {
  id: string;
  title: string;
  description?: string;
  image?: string;
  url?: string;
  meta?: Record<string, string>;
}

interface ResultCarouselProps {
  items: CarouselItem[];
  title?: string;
  onItemClick?: (item: CarouselItem) => void;
  className?: string;
  itemsPerView?: number;
  autoPlay?: boolean;
  autoPlayInterval?: number;
}

export const ResultCarousel = memo(function ResultCarousel({
  items,
  title,
  onItemClick,
  className,
  itemsPerView = 3,
  autoPlay = false,
  autoPlayInterval = 5000,
}: ResultCarouselProps) {
  const [currentIndex, setCurrentIndex] = useState(0);
  const containerRef = useRef<HTMLDivElement>(null);
  const [isHovered, setIsHovered] = useState(false);

  const maxIndex = Math.max(0, items.length - itemsPerView);

  const goNext = useCallback(() => {
    setCurrentIndex(prev => Math.min(prev + 1, maxIndex));
  }, [maxIndex]);

  const goPrev = useCallback(() => {
    setCurrentIndex(prev => Math.max(prev - 1, 0));
  }, []);

  useEffect(() => {
    if (autoPlay && !isHovered) {
      const interval = setInterval(() => {
        setCurrentIndex(prev => {
          if (prev >= maxIndex) return 0;
          return prev + 1;
        });
      }, autoPlayInterval);
      return () => clearInterval(interval);
    }
  }, [autoPlay, autoPlayInterval, isHovered, maxIndex]);

  if (items.length === 0) return null;

  return (
    <div 
      className={cn("relative", className)}
      onMouseEnter={() => setIsHovered(true)}
      onMouseLeave={() => setIsHovered(false)}
    >
      {title && (
        <div className="flex items-center justify-between mb-3">
          <h4 className="text-sm font-medium text-muted-foreground">{title}</h4>
          <span className="text-xs text-muted-foreground">
            {currentIndex + 1}-{Math.min(currentIndex + itemsPerView, items.length)} de {items.length}
          </span>
        </div>
      )}

      <div className="relative overflow-hidden" ref={containerRef}>
        <motion.div
          className="flex gap-3"
          animate={{ x: `${-currentIndex * (100 / itemsPerView + 1)}%` }}
          transition={{ type: "spring", stiffness: 300, damping: 30 }}
        >
          {items.map((item) => (
            <CarouselCard
              key={item.id}
              item={item}
              onClick={() => onItemClick?.(item)}
              style={{ flex: `0 0 calc(${100 / itemsPerView}% - ${((itemsPerView - 1) * 12) / itemsPerView}px)` }}
            />
          ))}
        </motion.div>
      </div>

      {items.length > itemsPerView && (
        <>
          <Button
            variant="outline"
            size="icon"
            className={cn(
              "absolute left-0 top-1/2 -translate-y-1/2 -translate-x-1/2",
              "h-8 w-8 rounded-full shadow-md",
              "transition-opacity",
              currentIndex === 0 ? "opacity-0 pointer-events-none" : "opacity-100"
            )}
            onClick={goPrev}
          >
            <ChevronLeft className="w-4 h-4" />
          </Button>

          <Button
            variant="outline"
            size="icon"
            className={cn(
              "absolute right-0 top-1/2 -translate-y-1/2 translate-x-1/2",
              "h-8 w-8 rounded-full shadow-md",
              "transition-opacity",
              currentIndex >= maxIndex ? "opacity-0 pointer-events-none" : "opacity-100"
            )}
            onClick={goNext}
          >
            <ChevronRight className="w-4 h-4" />
          </Button>
        </>
      )}

      {items.length > itemsPerView && (
        <div className="flex justify-center gap-1 mt-3">
          {Array.from({ length: maxIndex + 1 }).map((_, index) => (
            <button
              key={index}
              onClick={() => setCurrentIndex(index)}
              className={cn(
                "w-1.5 h-1.5 rounded-full transition-colors",
                index === currentIndex ? "bg-primary" : "bg-muted-foreground/30"
              )}
            />
          ))}
        </div>
      )}
    </div>
  );
});

const CarouselCard = memo(function CarouselCard({
  item,
  onClick,
  style,
}: {
  item: CarouselItem;
  onClick?: () => void;
  style?: React.CSSProperties;
}) {
  return (
    <motion.div
      whileHover={{ scale: 1.02 }}
      whileTap={{ scale: 0.98 }}
      onClick={onClick}
      style={style}
      className={cn(
        "rounded-lg border bg-card overflow-hidden cursor-pointer",
        "hover:shadow-md transition-shadow"
      )}
    >
      {item.image ? (
        <div className="aspect-video w-full overflow-hidden bg-muted">
          <img
            src={item.image}
            alt={item.title}
            className="w-full h-full object-cover"
          />
        </div>
      ) : (
        <div className="aspect-video w-full bg-muted/50 flex items-center justify-center">
          <FileText className="w-8 h-8 text-muted-foreground/50" />
        </div>
      )}

      <div className="p-3 space-y-1.5">
        <h5 className="font-medium text-sm line-clamp-2">{item.title}</h5>
        
        {item.description && (
          <p className="text-xs text-muted-foreground line-clamp-2">
            {item.description}
          </p>
        )}

        {item.url && (
          <div className="flex items-center gap-1 text-xs text-primary">
            <ExternalLink className="w-3 h-3" />
            <span className="truncate">{new URL(item.url).hostname}</span>
          </div>
        )}

        {item.meta && Object.keys(item.meta).length > 0 && (
          <div className="flex flex-wrap gap-1 pt-1">
            {Object.entries(item.meta).slice(0, 2).map(([key, value]) => (
              <span 
                key={key}
                className="text-[10px] px-1.5 py-0.5 rounded bg-muted text-muted-foreground"
              >
                {value}
              </span>
            ))}
          </div>
        )}
      </div>
    </motion.div>
  );
});

export default ResultCarousel;
