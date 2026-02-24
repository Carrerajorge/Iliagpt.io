/**
 * Chat Header Component
 * Title, menu, and action buttons
 */

import React, { useState } from 'react';
import {
    MoreHorizontal,
    Plus,
    Share2,
    Download,
    Trash2,
    Settings,
    ChevronDown,
    Pencil
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuSeparator,
    DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils';

interface ChatHeaderProps {
    title: string;
    onTitleChange?: (newTitle: string) => void;
    onNewChat: () => void;
    onShare?: () => void;
    onExport?: () => void;
    onDelete?: () => void;
    onSettings?: () => void;
    modelName?: string;
    isEditable?: boolean;
    className?: string;
}

export function ChatHeader({
    title,
    onTitleChange,
    onNewChat,
    onShare,
    onExport,
    onDelete,
    onSettings,
    modelName = 'Grok 3',
    isEditable = true,
    className,
}: ChatHeaderProps) {
    const [isEditing, setIsEditing] = useState(false);
    const [editTitle, setEditTitle] = useState(title);

    const handleSaveTitle = () => {
        if (editTitle.trim() && onTitleChange) {
            onTitleChange(editTitle.trim());
        }
        setIsEditing(false);
    };

    const handleKeyDown = (e: React.KeyboardEvent) => {
        if (e.key === 'Enter') {
            handleSaveTitle();
        } else if (e.key === 'Escape') {
            setEditTitle(title);
            setIsEditing(false);
        }
    };

    return (
        <header className={cn(
            "flex items-center justify-between px-4 py-3 border-b bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60",
            className
        )}>
            {/* Left: Title */}
            <div className="flex items-center gap-3 min-w-0">
                {isEditing ? (
                    <Input
                        value={editTitle}
                        onChange={(e) => setEditTitle(e.target.value)}
                        onBlur={handleSaveTitle}
                        onKeyDown={handleKeyDown}
                        className="h-8 max-w-[300px]"
                        autoFocus
                    />
                ) : (
                    <div
                        className="flex items-center gap-2 cursor-pointer group"
                        onClick={() => isEditable && setIsEditing(true)}
                    >
                        <h1 className="text-lg font-semibold truncate max-w-[300px]">
                            {title || 'Nuevo Chat'}
                        </h1>
                        {isEditable && (
                            <Pencil className="w-3.5 h-3.5 text-muted-foreground opacity-0 group-hover:opacity-100 transition-opacity" />
                        )}
                    </div>
                )}

                {/* Model Badge */}
                <span className="text-xs px-2 py-0.5 rounded-full bg-muted text-muted-foreground">
                    {modelName}
                </span>
            </div>

            {/* Right: Actions */}
            <div className="flex items-center gap-2">
                {/* New Chat Button */}
                <Button
                    variant="outline"
                    size="sm"
                    onClick={onNewChat}
                    className="hidden sm:flex"
                >
                    <Plus className="w-4 h-4 mr-1" />
                    Nuevo chat
                </Button>

                {/* More Actions Menu */}
                <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                        <Button variant="ghost" size="icon" className="h-8 w-8">
                            <MoreHorizontal className="w-4 h-4" />
                        </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end" className="w-48">
                        <DropdownMenuItem onClick={onNewChat} className="sm:hidden">
                            <Plus className="w-4 h-4 mr-2" />
                            Nuevo chat
                        </DropdownMenuItem>

                        {onShare && (
                            <DropdownMenuItem onClick={onShare}>
                                <Share2 className="w-4 h-4 mr-2" />
                                Compartir
                            </DropdownMenuItem>
                        )}

                        {onExport && (
                            <DropdownMenuItem onClick={onExport}>
                                <Download className="w-4 h-4 mr-2" />
                                Exportar
                            </DropdownMenuItem>
                        )}

                        <DropdownMenuSeparator />

                        {onSettings && (
                            <DropdownMenuItem onClick={onSettings}>
                                <Settings className="w-4 h-4 mr-2" />
                                Configuración
                            </DropdownMenuItem>
                        )}

                        {onDelete && (
                            <>
                                <DropdownMenuSeparator />
                                <DropdownMenuItem
                                    onClick={onDelete}
                                    className="text-red-500 focus:text-red-500"
                                >
                                    <Trash2 className="w-4 h-4 mr-2" />
                                    Eliminar
                                </DropdownMenuItem>
                            </>
                        )}
                    </DropdownMenuContent>
                </DropdownMenu>
            </div>
        </header>
    );
}
