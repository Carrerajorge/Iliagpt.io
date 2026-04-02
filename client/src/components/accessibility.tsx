import React, { useEffect } from "react";
import { useAnnouncer } from "@/hooks/useAccessibility";

interface ScreenReaderAnnouncementProps {
  message: string;
  priority?: "polite" | "assertive";
  trigger?: any; // Re-announce when this changes
}

/**
 * Component for screen reader announcements
 * Use this to announce important state changes to screen reader users
 */
export function ScreenReaderAnnouncement({
  message,
  priority = "polite",
  trigger,
}: ScreenReaderAnnouncementProps) {
  const { announce } = useAnnouncer();

  useEffect(() => {
    announce(message, priority);
  }, [message, priority, trigger, announce]);

  return null;
}

/**
 * Live region component for dynamic content
 * Mount this at app root for screen reader support
 */
export function LiveRegions() {
  return (
    <>
      {/* Polite announcements (non-interrupting) */}
      <div
        id="aria-live-polite"
        aria-live="polite"
        aria-atomic="true"
        className="sr-only"
      />
      
      {/* Assertive announcements (interrupting) */}
      <div
        id="aria-live-assertive"
        aria-live="assertive"
        aria-atomic="true"
        className="sr-only"
      />
    </>
  );
}

/**
 * Skip link for keyboard navigation
 */
export function SkipLink({ targetId }: { targetId: string }) {
  const handleClick = () => {
    const target = document.getElementById(targetId);
    if (target) {
      target.focus();
      target.scrollIntoView({ behavior: "smooth" });
    }
  };

  return (
    <a
      href={`#${targetId}`}
      onClick={(e) => {
        e.preventDefault();
        handleClick();
      }}
      className="sr-only focus:not-sr-only focus:absolute focus:top-4 focus:left-4 
                 focus:z-50 focus:px-4 focus:py-2 focus:bg-primary focus:text-primary-foreground
                 focus:rounded-md focus:shadow-lg"
    >
      Saltar al contenido principal
    </a>
  );
}

/**
 * Visually hidden text for screen readers
 */
export function VisuallyHidden({ children }: { children: React.ReactNode }) {
  return <span className="sr-only">{children}</span>;
}

/**
 * Focus ring component for custom focus indicators
 */
export function FocusRing({
  children,
  className,
}: {
  children: React.ReactElement;
  className?: string;
}) {
  return (
    <div className={`focus-within:ring-2 focus-within:ring-primary focus-within:ring-offset-2 ${className}`}>
      {children}
    </div>
  );
}
