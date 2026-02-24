/**
 * Suggested Prompts Component
 *
 * Shows suggested conversation starters when the chat is empty
 * to help users get started with ILIAGPT
 */

import { useState } from "react";
import { Sparkles, FileText, Image, Search, Code, Brain, Lightbulb, ArrowRight } from "lucide-react";
import { cn } from "@/lib/utils";

interface SuggestedPrompt {
    id: string;
    icon: React.ReactNode;
    label: string;
    prompt: string;
    color: string;
    bgColor: string;
}

const defaultPrompts: SuggestedPrompt[] = [
    {
        id: "creative",
        icon: <Sparkles className="h-4 w-4" />,
        label: "Escribe una historia",
        prompt: "Escribe una historia corta sobre un robot que descubre las emociones",
        color: "text-purple-600 dark:text-purple-400",
        bgColor: "bg-purple-100 dark:bg-purple-900/30 hover:bg-purple-200 dark:hover:bg-purple-900/50",
    },
    {
        id: "document",
        icon: <FileText className="h-4 w-4" />,
        label: "Crea un documento",
        prompt: "Crea un documento profesional para una propuesta de proyecto",
        color: "text-blue-600 dark:text-blue-400",
        bgColor: "bg-blue-100 dark:bg-blue-900/30 hover:bg-blue-200 dark:hover:bg-blue-900/50",
    },
    {
        id: "image",
        icon: <Image className="h-4 w-4" />,
        label: "Genera una imagen",
        prompt: "Genera una imagen de un paisaje futurista con ciudades flotantes",
        color: "text-pink-600 dark:text-pink-400",
        bgColor: "bg-pink-100 dark:bg-pink-900/30 hover:bg-pink-200 dark:hover:bg-pink-900/50",
    },
    {
        id: "research",
        icon: <Search className="h-4 w-4" />,
        label: "Busca información",
        prompt: "Investiga las últimas tendencias en inteligencia artificial",
        color: "text-cyan-600 dark:text-cyan-400",
        bgColor: "bg-cyan-100 dark:bg-cyan-900/30 hover:bg-cyan-200 dark:hover:bg-cyan-900/50",
    },
    {
        id: "code",
        icon: <Code className="h-4 w-4" />,
        label: "Ayúdame a programar",
        prompt: "Ayúdame a crear una función en JavaScript que valide emails",
        color: "text-green-600 dark:text-green-400",
        bgColor: "bg-green-100 dark:bg-green-900/30 hover:bg-green-200 dark:hover:bg-green-900/50",
    },
    {
        id: "brainstorm",
        icon: <Lightbulb className="h-4 w-4" />,
        label: "Genera ideas",
        prompt: "Dame 10 ideas creativas para un proyecto de emprendimiento",
        color: "text-yellow-600 dark:text-yellow-400",
        bgColor: "bg-yellow-100 dark:bg-yellow-900/30 hover:bg-yellow-200 dark:hover:bg-yellow-900/50",
    },
];

interface SuggestedPromptsProps {
    onSelectPrompt: (prompt: string) => void;
    className?: string;
    variant?: "grid" | "list" | "compact";
    maxItems?: number;
}

export function SuggestedPrompts({
    onSelectPrompt,
    className,
    variant = "grid",
    maxItems = 4
}: SuggestedPromptsProps) {
    const [hoveredId, setHoveredId] = useState<string | null>(null);

    const displayPrompts = defaultPrompts.slice(0, maxItems);

    if (variant === "compact") {
        return (
            <div className={cn("flex flex-wrap gap-2 justify-center", className)}>
                {displayPrompts.map((prompt) => (
                    <button
                        key={prompt.id}
                        onClick={() => onSelectPrompt(prompt.prompt)}
                        className={cn(
                            "inline-flex items-center gap-2 px-3 py-1.5 rounded-full text-sm font-medium transition-all duration-200",
                            prompt.bgColor,
                            prompt.color
                        )}
                        data-testid={`suggested-prompt-${prompt.id}`}
                    >
                        {prompt.icon}
                        {prompt.label}
                    </button>
                ))}
            </div>
        );
    }

    if (variant === "list") {
        return (
            <div className={cn("space-y-2", className)}>
                {displayPrompts.map((prompt) => (
                    <button
                        key={prompt.id}
                        onClick={() => onSelectPrompt(prompt.prompt)}
                        onMouseEnter={() => setHoveredId(prompt.id)}
                        onMouseLeave={() => setHoveredId(null)}
                        className={cn(
                            "w-full flex items-center gap-3 p-3 rounded-xl text-left transition-all duration-200",
                            prompt.bgColor,
                            "group"
                        )}
                        data-testid={`suggested-prompt-${prompt.id}`}
                    >
                        <div className={cn(
                            "flex items-center justify-center w-8 h-8 rounded-lg",
                            prompt.color,
                            "bg-white/50 dark:bg-black/20"
                        )}>
                            {prompt.icon}
                        </div>
                        <div className="flex-1 min-w-0">
                            <span className={cn("font-medium text-sm", prompt.color)}>
                                {prompt.label}
                            </span>
                            <p className="text-xs text-muted-foreground truncate mt-0.5">
                                {prompt.prompt}
                            </p>
                        </div>
                        <ArrowRight className={cn(
                            "h-4 w-4 transition-transform duration-200",
                            prompt.color,
                            hoveredId === prompt.id ? "translate-x-1" : ""
                        )} />
                    </button>
                ))}
            </div>
        );
    }

    // Grid variant (default)
    return (
        <div className={cn(
            "grid grid-cols-2 gap-3",
            className
        )}>
            {displayPrompts.map((prompt) => (
                <button
                    key={prompt.id}
                    onClick={() => onSelectPrompt(prompt.prompt)}
                    onMouseEnter={() => setHoveredId(prompt.id)}
                    onMouseLeave={() => setHoveredId(null)}
                    className={cn(
                        "flex flex-col items-start gap-2 p-4 rounded-xl text-left transition-all duration-200",
                        prompt.bgColor,
                        "group hover:shadow-md"
                    )}
                    data-testid={`suggested-prompt-${prompt.id}`}
                >
                    <div className={cn(
                        "flex items-center justify-center w-8 h-8 rounded-lg",
                        prompt.color,
                        "bg-white/50 dark:bg-black/20"
                    )}>
                        {prompt.icon}
                    </div>
                    <span className={cn("font-medium text-sm", prompt.color)}>
                        {prompt.label}
                    </span>
                    <p className="text-xs text-muted-foreground line-clamp-2">
                        {prompt.prompt}
                    </p>
                </button>
            ))}
        </div>
    );
}

export default SuggestedPrompts;
