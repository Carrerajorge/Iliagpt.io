/**
 * Accessibility Utilities and Components
 * WCAG 2.1 AA compliance helpers
 */

import React, { useEffect, useRef, useState, createContext, useContext } from 'react';
import { cn } from '@/lib/utils';

// ============= SKIP LINKS =============

export function SkipLinks() {
  return (
    <div className="sr-only focus-within:not-sr-only">
      <a
        href="#main-content"
        className="fixed top-2 left-2 z-[100] bg-primary text-primary-foreground px-4 py-2 rounded-md focus:outline-none focus:ring-2 focus:ring-ring"
      >
        Saltar al contenido principal
      </a>
      <a
        href="#chat-input"
        className="fixed top-2 left-48 z-[100] bg-primary text-primary-foreground px-4 py-2 rounded-md focus:outline-none focus:ring-2 focus:ring-ring"
      >
        Ir al chat
      </a>
    </div>
  );
}

// ============= FOCUS TRAP =============

interface FocusTrapProps {
  children: React.ReactNode;
  active?: boolean;
  returnFocusOnDeactivate?: boolean;
}

export function FocusTrap({ 
  children, 
  active = true, 
  returnFocusOnDeactivate = true 
}: FocusTrapProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const previousFocusRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    if (!active) return;

    previousFocusRef.current = document.activeElement as HTMLElement;

    const container = containerRef.current;
    if (!container) return;

    const focusableElements = container.querySelectorAll<HTMLElement>(
      'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'
    );
    const firstElement = focusableElements[0];
    const lastElement = focusableElements[focusableElements.length - 1];

    firstElement?.focus();

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key !== 'Tab') return;

      if (e.shiftKey) {
        if (document.activeElement === firstElement) {
          e.preventDefault();
          lastElement?.focus();
        }
      } else {
        if (document.activeElement === lastElement) {
          e.preventDefault();
          firstElement?.focus();
        }
      }
    };

    container.addEventListener('keydown', handleKeyDown);

    return () => {
      container.removeEventListener('keydown', handleKeyDown);
      if (returnFocusOnDeactivate && previousFocusRef.current) {
        previousFocusRef.current.focus();
      }
    };
  }, [active, returnFocusOnDeactivate]);

  return <div ref={containerRef}>{children}</div>;
}

// ============= LIVE REGION =============

interface LiveRegionProps {
  message: string;
  politeness?: 'polite' | 'assertive';
  className?: string;
}

export function LiveRegion({ 
  message, 
  politeness = 'polite',
  className 
}: LiveRegionProps) {
  return (
    <div
      role="status"
      aria-live={politeness}
      aria-atomic="true"
      className={cn("sr-only", className)}
    >
      {message}
    </div>
  );
}

// Hook for announcing messages
export function useAnnounce() {
  const [message, setMessage] = useState('');

  const announce = (text: string, delay = 100) => {
    setMessage('');
    setTimeout(() => setMessage(text), delay);
  };

  return { message, announce };
}

// ============= KEYBOARD NAVIGATION =============

interface KeyboardNavigationProps {
  children: React.ReactNode;
  orientation?: 'horizontal' | 'vertical';
  loop?: boolean;
  onSelect?: (index: number) => void;
}

export function KeyboardNavigation({
  children,
  orientation = 'vertical',
  loop = true,
  onSelect
}: KeyboardNavigationProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [activeIndex, setActiveIndex] = useState(0);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const items = container.querySelectorAll<HTMLElement>('[data-nav-item]');

    const handleKeyDown = (e: KeyboardEvent) => {
      const isVertical = orientation === 'vertical';
      const prevKey = isVertical ? 'ArrowUp' : 'ArrowLeft';
      const nextKey = isVertical ? 'ArrowDown' : 'ArrowRight';

      if (e.key === prevKey) {
        e.preventDefault();
        setActiveIndex((prev) => {
          const newIndex = prev - 1;
          if (newIndex < 0) return loop ? items.length - 1 : 0;
          return newIndex;
        });
      } else if (e.key === nextKey) {
        e.preventDefault();
        setActiveIndex((prev) => {
          const newIndex = prev + 1;
          if (newIndex >= items.length) return loop ? 0 : items.length - 1;
          return newIndex;
        });
      } else if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        onSelect?.(activeIndex);
      } else if (e.key === 'Home') {
        e.preventDefault();
        setActiveIndex(0);
      } else if (e.key === 'End') {
        e.preventDefault();
        setActiveIndex(items.length - 1);
      }
    };

    container.addEventListener('keydown', handleKeyDown);
    return () => container.removeEventListener('keydown', handleKeyDown);
  }, [orientation, loop, activeIndex, onSelect]);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const items = container.querySelectorAll<HTMLElement>('[data-nav-item]');
    items.forEach((item, index) => {
      item.setAttribute('tabindex', index === activeIndex ? '0' : '-1');
      if (index === activeIndex) {
        item.focus();
      }
    });
  }, [activeIndex]);

  return (
    <div ref={containerRef} role="listbox" aria-orientation={orientation}>
      {children}
    </div>
  );
}

// ============= HIGH CONTRAST MODE =============

interface HighContrastContextType {
  isHighContrast: boolean;
  toggleHighContrast: () => void;
}

const HighContrastContext = createContext<HighContrastContextType>({
  isHighContrast: false,
  toggleHighContrast: () => {}
});

export function HighContrastProvider({ children }: { children: React.ReactNode }) {
  const [isHighContrast, setIsHighContrast] = useState(() => {
    return localStorage.getItem('high-contrast') === 'true';
  });

  useEffect(() => {
    if (isHighContrast) {
      document.documentElement.classList.add('high-contrast');
    } else {
      document.documentElement.classList.remove('high-contrast');
    }
    localStorage.setItem('high-contrast', String(isHighContrast));
  }, [isHighContrast]);

  return (
    <HighContrastContext.Provider 
      value={{ 
        isHighContrast, 
        toggleHighContrast: () => setIsHighContrast(!isHighContrast) 
      }}
    >
      {children}
    </HighContrastContext.Provider>
  );
}

export function useHighContrast() {
  return useContext(HighContrastContext);
}

// ============= REDUCED MOTION =============

export function useReducedMotion(): boolean {
  const [reducedMotion, setReducedMotion] = useState(false);

  useEffect(() => {
    const mediaQuery = window.matchMedia('(prefers-reduced-motion: reduce)');
    setReducedMotion(mediaQuery.matches);

    const handler = (e: MediaQueryListEvent) => setReducedMotion(e.matches);
    mediaQuery.addEventListener('change', handler);
    return () => mediaQuery.removeEventListener('change', handler);
  }, []);

  return reducedMotion;
}

// ============= ACCESSIBLE BUTTON =============

interface AccessibleButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  loading?: boolean;
  loadingText?: string;
  icon?: React.ReactNode;
}

export function AccessibleButton({
  children,
  loading,
  loadingText = 'Cargando...',
  icon,
  disabled,
  className,
  ...props
}: AccessibleButtonProps) {
  return (
    <button
      {...props}
      disabled={disabled || loading}
      aria-busy={loading}
      aria-disabled={disabled || loading}
      className={cn(
        "inline-flex items-center justify-center gap-2",
        "focus:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2",
        "disabled:opacity-50 disabled:cursor-not-allowed",
        className
      )}
    >
      {loading ? (
        <>
          <span className="animate-spin">⏳</span>
          <span className="sr-only">{loadingText}</span>
          <span aria-hidden="true">{loadingText}</span>
        </>
      ) : (
        <>
          {icon}
          {children}
        </>
      )}
    </button>
  );
}

// ============= SCREEN READER ONLY =============

interface SrOnlyProps {
  children: React.ReactNode;
  focusable?: boolean;
}

export function SrOnly({ children, focusable }: SrOnlyProps) {
  return (
    <span
      className={cn(
        "absolute w-px h-px p-0 -m-px overflow-hidden whitespace-nowrap border-0",
        focusable && "focus:static focus:w-auto focus:h-auto focus:p-2 focus:m-0 focus:overflow-visible"
      )}
      style={{ clip: 'rect(0, 0, 0, 0)' }}
    >
      {children}
    </span>
  );
}

// ============= TOOLTIP WITH KEYBOARD SUPPORT =============

interface AccessibleTooltipProps {
  content: string;
  children: React.ReactNode;
}

export function AccessibleTooltip({ content, children }: AccessibleTooltipProps) {
  const [isVisible, setIsVisible] = useState(false);
  const id = useRef(`tooltip-${Math.random().toString(36).substring(7)}`);

  return (
    <div className="relative inline-block">
      <div
        onMouseEnter={() => setIsVisible(true)}
        onMouseLeave={() => setIsVisible(false)}
        onFocus={() => setIsVisible(true)}
        onBlur={() => setIsVisible(false)}
        aria-describedby={id.current}
      >
        {children}
      </div>
      <div
        id={id.current}
        role="tooltip"
        className={cn(
          "absolute bottom-full left-1/2 -translate-x-1/2 mb-2 px-2 py-1 text-xs bg-popover text-popover-foreground rounded shadow-lg whitespace-nowrap z-50 transition-opacity",
          isVisible ? "opacity-100" : "opacity-0 pointer-events-none"
        )}
      >
        {content}
      </div>
    </div>
  );
}
export { SkipLinks as SkipLink } from './accessibility';
