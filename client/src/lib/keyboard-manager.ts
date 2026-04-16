/**
 * Power User Keyboard Config - ILIAGPT PRO 3.0
 *
 * Advanced keyboard shortcuts and customization.
 */

// ============== Types ==============

export interface KeyBinding {
    id: string;
    key: string;
    ctrl?: boolean;
    shift?: boolean;
    alt?: boolean;
    meta?: boolean;
    action: string;
    description: string;
    category: KeyCategory;
}

export type KeyCategory =
    | "navigation"
    | "editing"
    | "chat"
    | "view"
    | "tools"
    | "custom";

// ============== Default Bindings ==============

export const DEFAULT_BINDINGS: KeyBinding[] = [
    // Navigation
    { id: "new-chat", key: "n", ctrl: true, action: "NEW_CHAT", description: "Nuevo chat", category: "navigation" },
    { id: "search", key: "k", ctrl: true, action: "OPEN_SEARCH", description: "Buscar", category: "navigation" },
    { id: "settings", key: ",", ctrl: true, action: "OPEN_SETTINGS", description: "Configuración", category: "navigation" },
    { id: "next-chat", key: "j", ctrl: true, action: "NEXT_CHAT", description: "Siguiente chat", category: "navigation" },
    { id: "prev-chat", key: "k", ctrl: true, action: "PREV_CHAT", description: "Chat anterior", category: "navigation" },

    // Editing
    { id: "focus-input", key: "/", action: "FOCUS_INPUT", description: "Enfocar input", category: "editing" },
    { id: "clear-input", key: "Escape", action: "CLEAR_INPUT", description: "Limpiar input", category: "editing" },
    { id: "submit", key: "Enter", ctrl: true, action: "SUBMIT", description: "Enviar mensaje", category: "editing" },

    // Chat
    { id: "regenerate", key: "r", ctrl: true, action: "REGENERATE", description: "Regenerar respuesta", category: "chat" },
    { id: "copy-last", key: "c", ctrl: true, shift: true, action: "COPY_LAST", description: "Copiar última respuesta", category: "chat" },
    { id: "stop", key: "s", ctrl: true, action: "STOP_GENERATION", description: "Detener generación", category: "chat" },

    // View
    { id: "toggle-sidebar", key: "b", ctrl: true, action: "TOGGLE_SIDEBAR", description: "Mostrar/ocultar sidebar", category: "view" },
    { id: "toggle-fullscreen", key: "f", ctrl: true, shift: true, action: "TOGGLE_FULLSCREEN", description: "Pantalla completa", category: "view" },
    { id: "zoom-in", key: "=", ctrl: true, action: "ZOOM_IN", description: "Aumentar zoom", category: "view" },
    { id: "zoom-out", key: "-", ctrl: true, action: "ZOOM_OUT", description: "Reducir zoom", category: "view" },

    // Tools
    { id: "prompt-library", key: "p", ctrl: true, shift: true, action: "OPEN_PROMPTS", description: "Biblioteca de prompts", category: "tools" },
    { id: "tool-catalog", key: "t", ctrl: true, shift: true, action: "OPEN_TOOLS", description: "Catálogo de tools", category: "tools" },
    { id: "voice-mode", key: "v", ctrl: true, action: "TOGGLE_VOICE", description: "Modo voz", category: "tools" },
];

// ============== Keyboard Manager ==============

type ActionHandler = () => void;

class KeyboardManager {
    private bindings: Map<string, KeyBinding> = new Map();
    private handlers: Map<string, ActionHandler> = new Map();
    private enabled = true;

    constructor() {
        this.loadBindings();
        this.setupListener();
    }

    private loadBindings(): void {
        // Load from localStorage or use defaults
        const saved = localStorage.getItem("keyboard_bindings");
        const bindings = saved ? JSON.parse(saved) : DEFAULT_BINDINGS;

        for (const binding of bindings) {
            this.bindings.set(binding.id, binding);
        }
    }

    private setupListener(): void {
        if (typeof window === "undefined") return;

        window.addEventListener("keydown", (e) => {
            if (!this.enabled) return;

            // Skip if typing in input
            const target = e.target as HTMLElement;
            if (target.tagName === "INPUT" || target.tagName === "TEXTAREA") {
                // Only allow specific shortcuts in inputs
                if (!e.ctrlKey && !e.metaKey) return;
            }

            for (const binding of this.bindings.values()) {
                if (this.matchesBinding(e, binding)) {
                    e.preventDefault();
                    this.executeAction(binding.action);
                    return;
                }
            }
        });
    }

    private matchesBinding(e: KeyboardEvent, binding: KeyBinding): boolean {
        const keyMatches = e.key.toLowerCase() === binding.key.toLowerCase();
        const ctrlMatches = (binding.ctrl ?? false) === (e.ctrlKey || e.metaKey);
        const shiftMatches = (binding.shift ?? false) === e.shiftKey;
        const altMatches = (binding.alt ?? false) === e.altKey;

        return keyMatches && ctrlMatches && shiftMatches && altMatches;
    }

    private executeAction(action: string): void {
        const handler = this.handlers.get(action);
        if (handler) {
            handler();
        } else {
            // Dispatch custom event for unregistered handlers
            window.dispatchEvent(new CustomEvent("keyboard-action", {
                detail: { action }
            }));
        }
    }

    // Public API

    registerHandler(action: string, handler: ActionHandler): void {
        this.handlers.set(action, handler);
    }

    unregisterHandler(action: string): void {
        this.handlers.delete(action);
    }

    updateBinding(id: string, newKey: Partial<KeyBinding>): void {
        const existing = this.bindings.get(id);
        if (existing) {
            this.bindings.set(id, { ...existing, ...newKey });
            this.saveBindings();
        }
    }

    private saveBindings(): void {
        const bindings = Array.from(this.bindings.values());
        localStorage.setItem("keyboard_bindings", JSON.stringify(bindings));
    }

    getBindings(): KeyBinding[] {
        return Array.from(this.bindings.values());
    }

    getBindingsByCategory(category: KeyCategory): KeyBinding[] {
        return this.getBindings().filter(b => b.category === category);
    }

    enable(): void {
        this.enabled = true;
    }

    disable(): void {
        this.enabled = false;
    }

    formatShortcut(binding: KeyBinding): string {
        const parts: string[] = [];
        if (binding.ctrl) parts.push("⌘");
        if (binding.shift) parts.push("⇧");
        if (binding.alt) parts.push("⌥");
        parts.push(binding.key.toUpperCase());
        return parts.join("");
    }

    resetToDefaults(): void {
        this.bindings.clear();
        for (const binding of DEFAULT_BINDINGS) {
            this.bindings.set(binding.id, binding);
        }
        this.saveBindings();
    }
}

// ============== Singleton ==============

let keyboardManager: KeyboardManager | null = null;

export function getKeyboardManager(): KeyboardManager {
    if (!keyboardManager) {
        keyboardManager = new KeyboardManager();
    }
    return keyboardManager;
}

export default KeyboardManager;
