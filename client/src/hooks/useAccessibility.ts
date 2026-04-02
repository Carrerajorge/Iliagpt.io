import { useEffect, useRef, useCallback } from "react";
import { chatLogger } from "@/lib/logger";

interface FocusTrapOptions {
  enabled?: boolean;
  initialFocus?: boolean;
  returnFocus?: boolean;
}

/**
 * Trap focus within an element (for modals, dialogs, etc.)
 */
export function useFocusTrap<T extends HTMLElement>(options: FocusTrapOptions = {}) {
  const { enabled = true, initialFocus = true, returnFocus = true } = options;
  const containerRef = useRef<T>(null);
  const previousFocusRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    if (!enabled) return;

    const container = containerRef.current;
    if (!container) return;

    // Store previously focused element
    if (returnFocus) {
      previousFocusRef.current = document.activeElement as HTMLElement;
    }

    // Set initial focus
    if (initialFocus) {
      const focusableElements = getFocusableElements(container);
      const firstElement = focusableElements[0];
      firstElement?.focus();
    }

    // Handle tab navigation
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key !== "Tab") return;

      const focusableElements = getFocusableElements(container);
      if (focusableElements.length === 0) return;

      const firstElement = focusableElements[0];
      const lastElement = focusableElements[focusableElements.length - 1];

      // Shift + Tab on first element -> go to last
      if (e.shiftKey && document.activeElement === firstElement) {
        e.preventDefault();
        lastElement.focus();
      }
      // Tab on last element -> go to first
      else if (!e.shiftKey && document.activeElement === lastElement) {
        e.preventDefault();
        firstElement.focus();
      }
    };

    container.addEventListener("keydown", handleKeyDown);

    return () => {
      container.removeEventListener("keydown", handleKeyDown);
      
      // Return focus to previous element
      if (returnFocus && previousFocusRef.current) {
        previousFocusRef.current.focus();
      }
    };
  }, [enabled, initialFocus, returnFocus]);

  return containerRef;
}

/**
 * Get all focusable elements within a container
 */
function getFocusableElements(container: HTMLElement): HTMLElement[] {
  const selector = [
    'button:not([disabled])',
    'a[href]',
    'input:not([disabled])',
    'select:not([disabled])',
    'textarea:not([disabled])',
    '[tabindex]:not([tabindex="-1"])',
    '[contenteditable]',
  ].join(', ');

  return Array.from(container.querySelectorAll(selector)).filter(
    (el): el is HTMLElement => {
      // Check visibility
      const style = window.getComputedStyle(el);
      return style.display !== "none" && style.visibility !== "hidden";
    }
  );
}

/**
 * Hook to announce messages to screen readers
 */
export function useAnnouncer() {
  const announce = useCallback((
    message: string,
    priority: "polite" | "assertive" = "polite"
  ) => {
    // Find or create live region
    let liveRegion = document.getElementById(`aria-live-${priority}`);
    
    if (!liveRegion) {
      liveRegion = document.createElement("div");
      liveRegion.id = `aria-live-${priority}`;
      liveRegion.setAttribute("aria-live", priority);
      liveRegion.setAttribute("aria-atomic", "true");
      liveRegion.className = "sr-only";
      document.body.appendChild(liveRegion);
    }

    // Clear and set message
    liveRegion.textContent = "";
    setTimeout(() => {
      liveRegion!.textContent = message;
    }, 100);

    chatLogger.debug("Announced to screen reader", { message, priority });
  }, []);

  return { announce };
}

/**
 * Hook to manage focus states with visual indicators
 */
export function useFocusVisible() {
  const ref = useRef<HTMLElement>(null);

  useEffect(() => {
    const element = ref.current;
    if (!element) return;

    // Add focus-visible class on keyboard focus
    const handleFocus = (e: FocusEvent) => {
      const target = e.target as HTMLElement;
      if (wasKeyboardNavigation()) {
        target.classList.add("focus-visible");
      }
    };

    const handleBlur = (e: FocusEvent) => {
      const target = e.target as HTMLElement;
      target.classList.remove("focus-visible");
    };

    element.addEventListener("focus", handleFocus, true);
    element.addEventListener("blur", handleBlur, true);

    return () => {
      element.removeEventListener("focus", handleFocus, true);
      element.removeEventListener("blur", handleBlur, true);
    };
  }, []);

  return ref;
}

// Track keyboard navigation
let keyboardNavigation = false;

if (typeof window !== "undefined") {
  window.addEventListener("keydown", (e) => {
    if (e.key === "Tab") {
      keyboardNavigation = true;
    }
  });

  window.addEventListener("mousedown", () => {
    keyboardNavigation = false;
  });
}

function wasKeyboardNavigation(): boolean {
  return keyboardNavigation;
}

/**
 * Hook for skip links (accessibility)
 */
export function useSkipLink(targetId: string) {
  const handleSkip = useCallback(() => {
    const target = document.getElementById(targetId);
    if (target) {
      target.focus();
      target.scrollIntoView({ behavior: "smooth" });
    }
  }, [targetId]);

  return { handleSkip };
}

/**
 * Keyboard shortcut hook
 */
export function useKeyboardShortcut(
  key: string,
  callback: () => void,
  options: { ctrl?: boolean; shift?: boolean; alt?: boolean } = {}
) {
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key !== key) return;
      if (options.ctrl && !e.ctrlKey && !e.metaKey) return;
      if (options.shift && !e.shiftKey) return;
      if (options.alt && !e.altKey) return;

      e.preventDefault();
      callback();
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [key, callback, options.ctrl, options.shift, options.alt]);
}

/**
 * Hook to manage aria-expanded and aria-controls
 */
export function useExpandable(
  id: string,
  initialExpanded: boolean = false
) {
  const [expanded, setExpanded] = useState(initialExpanded);

  const toggle = useCallback(() => {
    setExpanded((prev) => !prev);
  }, []);

  const expand = useCallback(() => {
    setExpanded(true);
  }, []);

  const collapse = useCallback(() => {
    setExpanded(false);
  }, []);

  const buttonProps = {
    "aria-expanded": expanded,
    "aria-controls": id,
    onClick: toggle,
  };

  const contentProps = {
    id,
    "aria-hidden": !expanded,
  };

  return {
    expanded,
    toggle,
    expand,
    collapse,
    buttonProps,
    contentProps,
  };
}

import { useState } from "react";
