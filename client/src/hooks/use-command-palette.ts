/**
 * useCommandPalette Hook
 * 
 * Global keyboard shortcut listener for ⌘K / Ctrl+K
 */

import { useState, useEffect, useCallback } from "react";

export function useCommandPalette() {
    const [isOpen, setIsOpen] = useState(false);

    const open = useCallback(() => setIsOpen(true), []);
    const close = useCallback(() => setIsOpen(false), []);
    const toggle = useCallback(() => setIsOpen(prev => !prev), []);

    // Global keyboard listener
    useEffect(() => {
        const handleKeyDown = (e: KeyboardEvent) => {
            // ⌘K or Ctrl+K
            if ((e.metaKey || e.ctrlKey) && e.key === "k") {
                e.preventDefault();
                toggle();
                return;
            }

            // Quick shortcuts when palette is closed
            if (!isOpen && (e.metaKey || e.ctrlKey)) {
                // ⌘N for new chat
                if (e.key === "n" && !e.shiftKey) {
                    e.preventDefault();
                    window.dispatchEvent(new CustomEvent("shortcut:new-chat"));
                    return;
                }
            }
        };

        window.addEventListener("keydown", handleKeyDown);
        return () => window.removeEventListener("keydown", handleKeyDown);
    }, [isOpen, toggle]);

    return {
        isOpen,
        open,
        close,
        toggle,
    };
}
