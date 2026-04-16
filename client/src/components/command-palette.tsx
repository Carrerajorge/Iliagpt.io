/**
 * Command Palette - ILIAGPT PRO 3.0
 * 
 * Quick access to all features via ⌘K / Ctrl+K
 * Inspired by VS Code, Linear, Raycast
 */

import { useState, useEffect, useCallback, useMemo, useRef } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
    Search,
    MessageSquarePlus,
    Settings,
    Moon,
    Sun,
    Bot,
    Zap,
    Library,
    FolderPlus,
    Keyboard,
    LogOut,
    User,
    Trash2,
    Download,
    LayoutGrid,
    ArrowRight,
    Command
} from "lucide-react";
import { cn } from "@/lib/utils";
import { useLocation } from "wouter";

interface CommandItem {
    id: string;
    title: string;
    subtitle?: string;
    icon: React.ReactNode;
    shortcut?: string;
    action: () => void;
    category: "navigation" | "action" | "settings";
}

interface CommandPaletteProps {
    isOpen: boolean;
    onClose: () => void;
    onNewChat?: () => void;
    onOpenGpts?: () => void;
    onOpenSkills?: () => void;
    onOpenLibrary?: () => void;
    onOpenSettings?: () => void;
    onOpenShortcuts?: () => void;
    onToggleTheme?: () => void;
    isDarkMode?: boolean;
    chats?: Array<{ id: string; title: string }>;
    onSelectChat?: (id: string) => void;
}

export function CommandPalette({
    isOpen,
    onClose,
    onNewChat,
    onOpenGpts,
    onOpenSkills,
    onOpenLibrary,
    onOpenSettings,
    onOpenShortcuts,
    onToggleTheme,
    isDarkMode = false,
    chats = [],
    onSelectChat,
}: CommandPaletteProps) {
    const [query, setQuery] = useState("");
    const [selectedIndex, setSelectedIndex] = useState(0);
    const inputRef = useRef<HTMLInputElement>(null);
    const listRef = useRef<HTMLDivElement>(null);
    const [, setLocation] = useLocation();

    // Define all commands
    const commands: CommandItem[] = useMemo(() => [
        {
            id: "new-chat",
            title: "Nuevo chat",
            subtitle: "Iniciar una nueva conversación",
            icon: <MessageSquarePlus className="w-4 h-4" />,
            shortcut: "N",
            action: () => { onNewChat?.(); onClose(); },
            category: "action",
        },
        {
            id: "gpts",
            title: "GPTs",
            subtitle: "Explorar GPTs personalizados",
            icon: <Bot className="w-4 h-4" />,
            shortcut: "G",
            action: () => { onOpenGpts?.(); onClose(); },
            category: "navigation",
        },
        {
            id: "skills",
            title: "Skills",
            subtitle: "Ver habilidades disponibles",
            icon: <Zap className="w-4 h-4" />,
            shortcut: "S",
            action: () => { onOpenSkills?.(); onClose(); },
            category: "navigation",
        },
        {
            id: "library",
            title: "Biblioteca",
            subtitle: "Acceder a documentos guardados",
            icon: <Library className="w-4 h-4" />,
            shortcut: "L",
            action: () => { onOpenLibrary?.(); onClose(); },
            category: "navigation",
        },
        {
            id: "apps",
            title: "Aplicaciones",
            subtitle: "Ver todas las aplicaciones",
            icon: <LayoutGrid className="w-4 h-4" />,
            action: () => { setLocation("/apps"); onClose(); },
            category: "navigation",
        },
        {
            id: "settings",
            title: "Configuración",
            subtitle: "Ajustar preferencias",
            icon: <Settings className="w-4 h-4" />,
            shortcut: ",",
            action: () => { onOpenSettings?.(); onClose(); },
            category: "settings",
        },
        {
            id: "theme",
            title: isDarkMode ? "Modo claro" : "Modo oscuro",
            subtitle: "Cambiar tema de la interfaz",
            icon: isDarkMode ? <Sun className="w-4 h-4" /> : <Moon className="w-4 h-4" />,
            shortcut: "T",
            action: () => { onToggleTheme?.(); },
            category: "settings",
        },
        {
            id: "shortcuts",
            title: "Atajos de teclado",
            subtitle: "Ver todos los atajos",
            icon: <Keyboard className="w-4 h-4" />,
            shortcut: "?",
            action: () => { onOpenShortcuts?.(); onClose(); },
            category: "settings",
        },
        {
            id: "profile",
            title: "Perfil",
            subtitle: "Ver y editar tu perfil",
            icon: <User className="w-4 h-4" />,
            action: () => { setLocation("/profile"); onClose(); },
            category: "navigation",
        },
    ], [isDarkMode, onClose, onNewChat, onOpenGpts, onOpenSkills, onOpenLibrary, onOpenSettings, onToggleTheme, setLocation]);

    // Filter commands based on query
    const filteredCommands = useMemo(() => {
        if (!query.trim()) return commands;

        const lowerQuery = query.toLowerCase();
        return commands.filter(cmd =>
            cmd.title.toLowerCase().includes(lowerQuery) ||
            cmd.subtitle?.toLowerCase().includes(lowerQuery)
        );
    }, [query, commands]);

    // Filter chats based on query
    const filteredChats = useMemo(() => {
        if (!query.trim() || query.length < 2) return [];

        const lowerQuery = query.toLowerCase();
        return chats
            .filter(chat => chat.title.toLowerCase().includes(lowerQuery))
            .slice(0, 5);
    }, [query, chats]);

    // All items (commands + chats)
    const allItems = useMemo(() => [
        ...filteredCommands,
        ...filteredChats.map(chat => ({
            id: `chat-${chat.id}`,
            title: chat.title,
            subtitle: "Ir al chat",
            icon: <MessageSquarePlus className="w-4 h-4 text-muted-foreground" />,
            action: () => { onSelectChat?.(chat.id); onClose(); },
            category: "navigation" as const,
        })),
    ], [filteredCommands, filteredChats, onSelectChat, onClose]);

    // Reset on open
    useEffect(() => {
        if (isOpen) {
            setQuery("");
            setSelectedIndex(0);
            setTimeout(() => inputRef.current?.focus(), 50);
        }
    }, [isOpen]);

    // Reset selection when results change
    useEffect(() => {
        setSelectedIndex(0);
    }, [query]);

    // Keyboard navigation
    const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
        switch (e.key) {
            case "ArrowDown":
                e.preventDefault();
                setSelectedIndex(i => Math.min(i + 1, allItems.length - 1));
                break;
            case "ArrowUp":
                e.preventDefault();
                setSelectedIndex(i => Math.max(i - 1, 0));
                break;
            case "Enter":
                e.preventDefault();
                if (allItems[selectedIndex]) {
                    allItems[selectedIndex].action();
                }
                break;
            case "Escape":
                e.preventDefault();
                onClose();
                break;
        }
    }, [allItems, selectedIndex, onClose]);

    // Scroll selected item into view
    useEffect(() => {
        const list = listRef.current;
        if (!list) return;

        const selected = list.children[selectedIndex] as HTMLElement;
        if (selected) {
            selected.scrollIntoView({ block: "nearest" });
        }
    }, [selectedIndex]);

    // Group items by category
    const groupedItems = useMemo(() => {
        const groups: Record<string, typeof allItems> = {
            action: [],
            navigation: [],
            settings: [],
        };

        allItems.forEach(item => {
            groups[item.category]?.push(item);
        });

        return groups;
    }, [allItems]);

    if (!isOpen) return null;

    return (
        <AnimatePresence>
            <motion.div
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                className="fixed inset-0 z-[9999] flex items-start justify-center pt-[15vh]"
                onClick={onClose}
            >
                {/* Backdrop */}
                <div className="absolute inset-0 bg-black/50 backdrop-blur-sm" />

                {/* Palette */}
                <motion.div
                    initial={{ opacity: 0, scale: 0.95, y: -10 }}
                    animate={{ opacity: 1, scale: 1, y: 0 }}
                    exit={{ opacity: 0, scale: 0.95, y: -10 }}
                    transition={{ duration: 0.15, ease: "easeOut" }}
                    className="relative w-full max-w-xl mx-4 bg-background/95 backdrop-blur-xl rounded-2xl border border-border/50 shadow-2xl overflow-hidden"
                    onClick={e => e.stopPropagation()}
                >
                    {/* Search Input */}
                    <div className="flex items-center gap-3 px-4 py-3 border-b border-border/50">
                        <Search className="w-5 h-5 text-muted-foreground flex-shrink-0" />
                        <input
                            ref={inputRef}
                            type="text"
                            value={query}
                            onChange={e => setQuery(e.target.value)}
                            onKeyDown={handleKeyDown}
                            placeholder="Buscar comandos, chats..."
                            className="flex-1 bg-transparent text-base outline-none placeholder:text-muted-foreground/60"
                            autoComplete="off"
                            autoCorrect="off"
                            spellCheck={false}
                        />
                        <kbd className="hidden sm:flex items-center gap-1 px-2 py-1 text-xs text-muted-foreground bg-muted rounded-md">
                            <Command className="w-3 h-3" />K
                        </kbd>
                    </div>

                    {/* Results */}
                    <div ref={listRef} className="max-h-[60vh] overflow-y-auto py-2">
                        {allItems.length === 0 ? (
                            <div className="px-4 py-8 text-center text-muted-foreground">
                                <p className="text-sm">No se encontraron resultados</p>
                            </div>
                        ) : (
                            <>
                                {/* Actions */}
                                {groupedItems.action.length > 0 && (
                                    <div className="px-2 py-1">
                                        <div className="px-2 py-1.5 text-xs font-medium text-muted-foreground">
                                            Acciones
                                        </div>
                                        {groupedItems.action.map((item, idx) => (
                                            <CommandItemRow
                                                key={item.id}
                                                item={item}
                                                isSelected={allItems.indexOf(item) === selectedIndex}
                                                onSelect={() => item.action()}
                                                onHover={() => setSelectedIndex(allItems.indexOf(item))}
                                            />
                                        ))}
                                    </div>
                                )}

                                {/* Navigation */}
                                {groupedItems.navigation.length > 0 && (
                                    <div className="px-2 py-1">
                                        <div className="px-2 py-1.5 text-xs font-medium text-muted-foreground">
                                            Navegación
                                        </div>
                                        {groupedItems.navigation.map((item, idx) => (
                                            <CommandItemRow
                                                key={item.id}
                                                item={item}
                                                isSelected={allItems.indexOf(item) === selectedIndex}
                                                onSelect={() => item.action()}
                                                onHover={() => setSelectedIndex(allItems.indexOf(item))}
                                            />
                                        ))}
                                    </div>
                                )}

                                {/* Settings */}
                                {groupedItems.settings.length > 0 && (
                                    <div className="px-2 py-1">
                                        <div className="px-2 py-1.5 text-xs font-medium text-muted-foreground">
                                            Configuración
                                        </div>
                                        {groupedItems.settings.map((item, idx) => (
                                            <CommandItemRow
                                                key={item.id}
                                                item={item}
                                                isSelected={allItems.indexOf(item) === selectedIndex}
                                                onSelect={() => item.action()}
                                                onHover={() => setSelectedIndex(allItems.indexOf(item))}
                                            />
                                        ))}
                                    </div>
                                )}
                            </>
                        )}
                    </div>

                    {/* Footer */}
                    <div className="flex items-center justify-between px-4 py-2 border-t border-border/50 bg-muted/30">
                        <div className="flex items-center gap-4 text-xs text-muted-foreground">
                            <span className="flex items-center gap-1">
                                <kbd className="px-1.5 py-0.5 bg-muted rounded text-[10px]">↑↓</kbd>
                                navegar
                            </span>
                            <span className="flex items-center gap-1">
                                <kbd className="px-1.5 py-0.5 bg-muted rounded text-[10px]">↵</kbd>
                                seleccionar
                            </span>
                            <span className="flex items-center gap-1">
                                <kbd className="px-1.5 py-0.5 bg-muted rounded text-[10px]">esc</kbd>
                                cerrar
                            </span>
                        </div>
                    </div>
                </motion.div>
            </motion.div>
        </AnimatePresence>
    );
}

// Individual command row
function CommandItemRow({
    item,
    isSelected,
    onSelect,
    onHover,
}: {
    item: CommandItem;
    isSelected: boolean;
    onSelect: () => void;
    onHover: () => void;
}) {
    return (
        <button
            className={cn(
                "w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-left transition-colors",
                isSelected
                    ? "bg-primary/10 text-primary"
                    : "hover:bg-muted/50 text-foreground"
            )}
            onClick={onSelect}
            onMouseEnter={onHover}
        >
            <div className={cn(
                "flex items-center justify-center w-8 h-8 rounded-lg",
                isSelected ? "bg-primary/20" : "bg-muted"
            )}>
                {item.icon}
            </div>
            <div className="flex-1 min-w-0">
                <div className="font-medium text-sm truncate">{item.title}</div>
                {item.subtitle && (
                    <div className="text-xs text-muted-foreground truncate">{item.subtitle}</div>
                )}
            </div>
            {item.shortcut && (
                <kbd className="flex-shrink-0 px-2 py-1 text-xs text-muted-foreground bg-muted rounded">
                    ⌘{item.shortcut}
                </kbd>
            )}
            <ArrowRight className={cn(
                "w-4 h-4 flex-shrink-0 transition-opacity",
                isSelected ? "opacity-100" : "opacity-0"
            )} />
        </button>
    );
}

export default CommandPalette;
