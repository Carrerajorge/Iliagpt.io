/**
 * Global Keyboard Shortcuts Hook
 * 
 * Features:
 * - Configurable shortcuts with conflict detection
 * - Platform-aware modifiers (Cmd vs Ctrl)
 * - Scope-based activation (global, chat, editor)
 * - Customizable via user preferences
 */

import { useEffect, useCallback, useRef } from "react";

export interface ShortcutDefinition {
    key: string;                      // Key code (e.g., "k", "Enter", "Escape")
    modifiers?: ("ctrl" | "meta" | "alt" | "shift")[];
    action: () => void;
    description: string;
    scope?: "global" | "chat" | "editor" | "modal";
    preventDefault?: boolean;
    enabled?: boolean;
}

export interface UseKeyboardShortcutsOptions {
    scope?: "global" | "chat" | "editor" | "modal";
    enabled?: boolean;
}

// Detect platform for modifier display
const isMac = typeof navigator !== "undefined" && /Mac|iPod|iPhone|iPad/.test(navigator.platform);

// Default shortcuts
export const DEFAULT_SHORTCUTS: ShortcutDefinition[] = [
    {
        key: "k",
        modifiers: isMac ? ["meta"] : ["ctrl"],
        action: () => { },
        description: "Open command palette",
        scope: "global",
        preventDefault: true,
    },
    {
        key: "Enter",
        modifiers: isMac ? ["meta"] : ["ctrl"],
        action: () => { },
        description: "Send message",
        scope: "chat",
        preventDefault: true,
    },
    {
        key: "n",
        modifiers: isMac ? ["meta", "shift"] : ["ctrl", "shift"],
        action: () => { },
        description: "New conversation",
        scope: "global",
        preventDefault: true,
    },
    {
        key: "/",
        modifiers: isMac ? ["meta"] : ["ctrl"],
        action: () => { },
        description: "Toggle sidebar",
        scope: "global",
        preventDefault: true,
    },
    {
        key: "Escape",
        modifiers: [],
        action: () => { },
        description: "Close modal / Cancel",
        scope: "modal",
        preventDefault: true,
    },
    {
        key: "s",
        modifiers: isMac ? ["meta"] : ["ctrl"],
        action: () => { },
        description: "Save / Export",
        scope: "global",
        preventDefault: true,
    },
    {
        key: "f",
        modifiers: isMac ? ["meta"] : ["ctrl"],
        action: () => { },
        description: "Search conversations",
        scope: "global",
        preventDefault: true,
    },
    {
        key: "ArrowUp",
        modifiers: isMac ? ["meta"] : ["ctrl"],
        action: () => { },
        description: "Edit last message",
        scope: "chat",
        preventDefault: true,
    },
    {
        key: "l",
        modifiers: isMac ? ["meta", "shift"] : ["ctrl", "shift"],
        action: () => { },
        description: "Clear chat",
        scope: "chat",
        preventDefault: true,
    },
    {
        key: ",",
        modifiers: isMac ? ["meta"] : ["ctrl"],
        action: () => { },
        description: "Open settings",
        scope: "global",
        preventDefault: true,
    },
];

// Check if event matches shortcut
function matchesShortcut(event: KeyboardEvent, shortcut: ShortcutDefinition): boolean {
    // Check key (case-insensitive for letters)
    const eventKey = event.key.length === 1 ? event.key.toLowerCase() : event.key;
    const shortcutKey = shortcut.key.length === 1 ? shortcut.key.toLowerCase() : shortcut.key;

    if (eventKey !== shortcutKey) return false;

    const modifiers = shortcut.modifiers || [];

    // Check modifiers
    const ctrlRequired = modifiers.includes("ctrl");
    const metaRequired = modifiers.includes("meta");
    const altRequired = modifiers.includes("alt");
    const shiftRequired = modifiers.includes("shift");

    // On Mac, Cmd is meta; on Windows/Linux, Ctrl is ctrl
    const primaryModifier = isMac ? event.metaKey : event.ctrlKey;
    const primaryRequired = isMac ? metaRequired : ctrlRequired;

    if (primaryRequired && !primaryModifier) return false;
    if (!primaryRequired && primaryModifier) return false;

    if (altRequired !== event.altKey) return false;
    if (shiftRequired !== event.shiftKey) return false;

    return true;
}

// Format shortcut for display
export function formatShortcut(shortcut: ShortcutDefinition): string {
    const parts: string[] = [];
    const modifiers = shortcut.modifiers || [];

    if (modifiers.includes("ctrl") || modifiers.includes("meta")) {
        parts.push(isMac ? "⌘" : "Ctrl");
    }
    if (modifiers.includes("alt")) {
        parts.push(isMac ? "⌥" : "Alt");
    }
    if (modifiers.includes("shift")) {
        parts.push(isMac ? "⇧" : "Shift");
    }

    // Format key
    let key = shortcut.key;
    switch (key) {
        case "Enter": key = "↵"; break;
        case "Escape": key = "Esc"; break;
        case "ArrowUp": key = "↑"; break;
        case "ArrowDown": key = "↓"; break;
        case "ArrowLeft": key = "←"; break;
        case "ArrowRight": key = "→"; break;
        default: key = key.toUpperCase();
    }

    parts.push(key);
    return parts.join(isMac ? "" : "+");
}

// Main hook
export function useKeyboardShortcuts(
    shortcuts: ShortcutDefinition[],
    options: UseKeyboardShortcutsOptions = {}
): void {
    const { scope = "global", enabled = true } = options;
    const shortcutsRef = useRef(shortcuts);

    // Update ref when shortcuts change
    useEffect(() => {
        shortcutsRef.current = shortcuts;
    }, [shortcuts]);

    const handleKeyDown = useCallback((event: KeyboardEvent) => {
        if (!enabled) return;

        // Skip if user is typing in an input (unless scope allows)
        const target = event.target as HTMLElement;
        const isInput = target.tagName === "INPUT" ||
            target.tagName === "TEXTAREA" ||
            target.isContentEditable;

        // Allow Escape in inputs for modal scope
        if (isInput && scope !== "modal" && event.key !== "Escape") {
            // For chat scope, allow send shortcut in textarea
            if (scope !== "chat" || event.key !== "Enter") {
                return;
            }
        }

        for (const shortcut of shortcutsRef.current) {
            // Check scope
            if (shortcut.scope && shortcut.scope !== scope && shortcut.scope !== "global") {
                continue;
            }

            // Check if enabled
            if (shortcut.enabled === false) {
                continue;
            }

            // Check match
            if (matchesShortcut(event, shortcut)) {
                if (shortcut.preventDefault !== false) {
                    event.preventDefault();
                    event.stopPropagation();
                }

                shortcut.action();
                return;
            }
        }
    }, [enabled, scope]);

    useEffect(() => {
        document.addEventListener("keydown", handleKeyDown);
        return () => document.removeEventListener("keydown", handleKeyDown);
    }, [handleKeyDown]);
}

// Get all shortcuts for help display
export function getAllShortcuts(): {
    shortcut: string;
    description: string;
    scope: string;
}[] {
    return DEFAULT_SHORTCUTS.map(s => ({
        shortcut: formatShortcut(s),
        description: s.description,
        scope: s.scope || "global",
    }));
}

// Check for conflicts
export function checkConflicts(
    shortcuts: ShortcutDefinition[]
): { shortcut1: string; shortcut2: string; key: string }[] {
    const conflicts: { shortcut1: string; shortcut2: string; key: string }[] = [];

    for (let i = 0; i < shortcuts.length; i++) {
        for (let j = i + 1; j < shortcuts.length; j++) {
            const s1 = shortcuts[i];
            const s2 = shortcuts[j];

            // Same scope or one is global
            const sameScope =
                s1.scope === s2.scope ||
                s1.scope === "global" ||
                s2.scope === "global";

            if (!sameScope) continue;

            // Same key combo
            const sameKey = s1.key.toLowerCase() === s2.key.toLowerCase();
            const sameModifiers =
                JSON.stringify(s1.modifiers?.sort()) ===
                JSON.stringify(s2.modifiers?.sort());

            if (sameKey && sameModifiers) {
                conflicts.push({
                    shortcut1: s1.description,
                    shortcut2: s2.description,
                    key: formatShortcut(s1),
                });
            }
        }
    }

    return conflicts;
}

export default {
    useKeyboardShortcuts,
    formatShortcut,
    getAllShortcuts,
    checkConflicts,
    DEFAULT_SHORTCUTS,
    isMac,
};
