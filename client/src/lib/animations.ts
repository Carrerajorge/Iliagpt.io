/**
 * Shared CSS class constants for consistent animations across the app.
 * Respects prefers-reduced-motion via Tailwind's motion-safe/motion-reduce utilities.
 */

/** Message entrance animation */
export const messageEnter = "animate-in fade-in-0 slide-in-from-bottom-2 duration-200";

/** Sidebar toggle */
export const sidebarTransition = "transition-all duration-300 ease-in-out";

/** Theme transition */
export const themeTransition = "transition-colors duration-200";

/** Button hover */
export const buttonHover = "transition-transform hover:scale-[1.02] active:scale-[0.98]";

/** Typing indicator dots */
export const typingDot = "animate-bounce";
