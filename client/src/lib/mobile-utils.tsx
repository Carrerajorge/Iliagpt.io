/**
 * Mobile Enhancement Components
 * Swipe gestures, pull-to-refresh, responsive utilities
 */

import React, { useState, useRef, useEffect, useCallback } from 'react';
import { cn } from '@/lib/utils';
import { Loader2 } from 'lucide-react';

// ============= SWIPE GESTURE HOOK =============

interface SwipeHandlers {
  onSwipeLeft?: () => void;
  onSwipeRight?: () => void;
  onSwipeUp?: () => void;
  onSwipeDown?: () => void;
}

interface SwipeConfig {
  threshold?: number;
  preventScrollOnSwipe?: boolean;
}

export function useSwipe(
  handlers: SwipeHandlers,
  config: SwipeConfig = {}
) {
  const { threshold = 50, preventScrollOnSwipe = false } = config;
  const touchStart = useRef<{ x: number; y: number } | null>(null);
  const touchEnd = useRef<{ x: number; y: number } | null>(null);

  const onTouchStart = useCallback((e: TouchEvent) => {
    touchEnd.current = null;
    touchStart.current = {
      x: e.targetTouches[0].clientX,
      y: e.targetTouches[0].clientY
    };
  }, []);

  const onTouchMove = useCallback((e: TouchEvent) => {
    touchEnd.current = {
      x: e.targetTouches[0].clientX,
      y: e.targetTouches[0].clientY
    };

    if (preventScrollOnSwipe && touchStart.current) {
      const diffX = Math.abs(touchStart.current.x - e.targetTouches[0].clientX);
      const diffY = Math.abs(touchStart.current.y - e.targetTouches[0].clientY);
      if (diffX > diffY) {
        e.preventDefault();
      }
    }
  }, [preventScrollOnSwipe]);

  const onTouchEnd = useCallback(() => {
    if (!touchStart.current || !touchEnd.current) return;

    const diffX = touchStart.current.x - touchEnd.current.x;
    const diffY = touchStart.current.y - touchEnd.current.y;
    const absX = Math.abs(diffX);
    const absY = Math.abs(diffY);

    if (absX > absY && absX > threshold) {
      if (diffX > 0) {
        handlers.onSwipeLeft?.();
      } else {
        handlers.onSwipeRight?.();
      }
    } else if (absY > absX && absY > threshold) {
      if (diffY > 0) {
        handlers.onSwipeUp?.();
      } else {
        handlers.onSwipeDown?.();
      }
    }
  }, [handlers, threshold]);

  return {
    onTouchStart,
    onTouchMove,
    onTouchEnd
  };
}

// ============= SWIPEABLE CONTAINER =============

interface SwipeableProps extends SwipeHandlers {
  children: React.ReactNode;
  className?: string;
  threshold?: number;
}

export function Swipeable({
  children,
  className,
  threshold = 50,
  ...handlers
}: SwipeableProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const swipe = useSwipe(handlers, { threshold });

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    container.addEventListener('touchstart', swipe.onTouchStart, { passive: true });
    container.addEventListener('touchmove', swipe.onTouchMove, { passive: false });
    container.addEventListener('touchend', swipe.onTouchEnd, { passive: true });

    return () => {
      container.removeEventListener('touchstart', swipe.onTouchStart);
      container.removeEventListener('touchmove', swipe.onTouchMove);
      container.removeEventListener('touchend', swipe.onTouchEnd);
    };
  }, [swipe]);

  return (
    <div ref={containerRef} className={className}>
      {children}
    </div>
  );
}

// ============= PULL TO REFRESH =============

interface PullToRefreshProps {
  onRefresh: () => Promise<void>;
  children: React.ReactNode;
  threshold?: number;
  className?: string;
}

export function PullToRefresh({
  onRefresh,
  children,
  threshold = 80,
  className
}: PullToRefreshProps) {
  const [pullDistance, setPullDistance] = useState(0);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const touchStartY = useRef(0);
  const isAtTop = useRef(true);

  const handleTouchStart = (e: TouchEvent) => {
    if (containerRef.current) {
      isAtTop.current = containerRef.current.scrollTop === 0;
    }
    touchStartY.current = e.touches[0].clientY;
  };

  const handleTouchMove = (e: TouchEvent) => {
    if (!isAtTop.current || isRefreshing) return;

    const touchY = e.touches[0].clientY;
    const diff = touchY - touchStartY.current;

    if (diff > 0) {
      e.preventDefault();
      setPullDistance(Math.min(diff * 0.5, threshold * 1.5));
    }
  };

  const handleTouchEnd = async () => {
    if (pullDistance >= threshold && !isRefreshing) {
      setIsRefreshing(true);
      try {
        await onRefresh();
      } finally {
        setIsRefreshing(false);
      }
    }
    setPullDistance(0);
  };

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    container.addEventListener('touchstart', handleTouchStart, { passive: true });
    container.addEventListener('touchmove', handleTouchMove, { passive: false });
    container.addEventListener('touchend', handleTouchEnd, { passive: true });

    return () => {
      container.removeEventListener('touchstart', handleTouchStart);
      container.removeEventListener('touchmove', handleTouchMove);
      container.removeEventListener('touchend', handleTouchEnd);
    };
  });

  const progress = Math.min(pullDistance / threshold, 1);

  return (
    <div ref={containerRef} className={cn("overflow-auto", className)}>
      <div
        className="flex items-center justify-center transition-all duration-200"
        style={{ 
          height: pullDistance,
          opacity: progress
        }}
      >
        {isRefreshing ? (
          <Loader2 className="w-6 h-6 animate-spin text-primary" />
        ) : (
          <div 
            className="w-6 h-6 border-2 border-primary rounded-full"
            style={{ 
              transform: `rotate(${progress * 360}deg)`,
              borderTopColor: 'transparent'
            }}
          />
        )}
      </div>
      {children}
    </div>
  );
}

// ============= RESPONSIVE UTILS =============

export function useIsMobile(breakpoint = 768): boolean {
  const [isMobile, setIsMobile] = useState(false);

  useEffect(() => {
    const checkMobile = () => setIsMobile(window.innerWidth < breakpoint);
    checkMobile();

    window.addEventListener('resize', checkMobile);
    return () => window.removeEventListener('resize', checkMobile);
  }, [breakpoint]);

  return isMobile;
}

export function useMediaQuery(query: string): boolean {
  const [matches, setMatches] = useState(false);

  useEffect(() => {
    const mediaQuery = window.matchMedia(query);
    setMatches(mediaQuery.matches);

    const handler = (e: MediaQueryListEvent) => setMatches(e.matches);
    mediaQuery.addEventListener('change', handler);
    return () => mediaQuery.removeEventListener('change', handler);
  }, [query]);

  return matches;
}

// ============= BOTTOM SHEET =============

interface BottomSheetProps {
  isOpen: boolean;
  onClose: () => void;
  children: React.ReactNode;
  snapPoints?: number[];
}

export function BottomSheet({
  isOpen,
  onClose,
  children,
  snapPoints = [0.5, 0.9]
}: BottomSheetProps) {
  const [currentSnap, setCurrentSnap] = useState(0);
  const sheetRef = useRef<HTMLDivElement>(null);
  const dragStartY = useRef(0);
  const currentY = useRef(0);

  const height = snapPoints[currentSnap] * window.innerHeight;

  const handleDragStart = (e: React.TouchEvent) => {
    dragStartY.current = e.touches[0].clientY;
    currentY.current = 0;
  };

  const handleDrag = (e: React.TouchEvent) => {
    currentY.current = e.touches[0].clientY - dragStartY.current;
    if (sheetRef.current) {
      sheetRef.current.style.transform = `translateY(${Math.max(0, currentY.current)}px)`;
    }
  };

  const handleDragEnd = () => {
    if (currentY.current > 100) {
      if (currentSnap === 0) {
        onClose();
      } else {
        setCurrentSnap(Math.max(0, currentSnap - 1));
      }
    } else if (currentY.current < -50 && currentSnap < snapPoints.length - 1) {
      setCurrentSnap(currentSnap + 1);
    }

    if (sheetRef.current) {
      sheetRef.current.style.transform = '';
    }
  };

  if (!isOpen) return null;

  return (
    <>
      <div 
        className="fixed inset-0 bg-black/50 z-40"
        onClick={onClose}
      />
      <div
        ref={sheetRef}
        className="fixed bottom-0 left-0 right-0 bg-background rounded-t-xl z-50 transition-all duration-300"
        style={{ height }}
      >
        <div
          className="w-12 h-1 bg-muted-foreground/30 rounded-full mx-auto my-3 cursor-grab"
          onTouchStart={handleDragStart}
          onTouchMove={handleDrag}
          onTouchEnd={handleDragEnd}
        />
        <div className="px-4 pb-4 overflow-auto" style={{ height: height - 28 }}>
          {children}
        </div>
      </div>
    </>
  );
}

// ============= HAPTIC FEEDBACK =============

export function useHaptic() {
  const vibrate = (pattern: number | number[] = 10) => {
    if ('vibrate' in navigator) {
      navigator.vibrate(pattern);
    }
  };

  return {
    light: () => vibrate(10),
    medium: () => vibrate(20),
    heavy: () => vibrate([30, 10, 30]),
    success: () => vibrate([10, 50, 10]),
    error: () => vibrate([50, 30, 50, 30, 50])
  };
}

// ============= SAFE AREA PADDING =============

export function useSafeArea() {
  const [safeArea, setSafeArea] = useState({
    top: 0,
    bottom: 0,
    left: 0,
    right: 0
  });

  useEffect(() => {
    const style = getComputedStyle(document.documentElement);
    setSafeArea({
      top: parseInt(style.getPropertyValue('--sat') || '0'),
      bottom: parseInt(style.getPropertyValue('--sab') || '0'),
      left: parseInt(style.getPropertyValue('--sal') || '0'),
      right: parseInt(style.getPropertyValue('--sar') || '0')
    });
  }, []);

  return safeArea;
}
