import React from "react";
import { cn } from "@/lib/utils";
import {
    FileText,
    BarChart3,
    Search,
    Presentation,
    ListChecks,
    Languages,
    Sparkles,
    MessageSquare
} from "lucide-react";

interface PromptSuggestion {
    label: string;
    action: string;
    icon: React.ReactNode;
    category: "analyze" | "create" | "search" | "general";
}

const DEFAULT_SUGGESTIONS: PromptSuggestion[] = [
    {
        label: "Resumir documento",
        action: "Dame un resumen ejecutivo del documento",
        icon: <FileText className="w-4 h-4" />,
        category: "analyze"
    },
    {
        label: "Analizar datos",
        action: "Analiza los datos y dame los hallazgos clave",
        icon: <BarChart3 className="w-4 h-4" />,
        category: "analyze"
    },
    {
        label: "Extraer puntos clave",
        action: "Extrae los puntos más importantes del documento",
        icon: <ListChecks className="w-4 h-4" />,
        category: "analyze"
    },
    {
        label: "Buscar información",
        action: "Busca información sobre ",
        icon: <Search className="w-4 h-4" />,
        category: "search"
    },
    {
        label: "Crear presentación",
        action: "Crea una presentación profesional sobre ",
        icon: <Presentation className="w-4 h-4" />,
        category: "create"
    },
    {
        label: "Traducir",
        action: "Traduce el contenido al inglés",
        icon: <Languages className="w-4 h-4" />,
        category: "general"
    }
];

const DOCUMENT_SUGGESTIONS: PromptSuggestion[] = [
    {
        label: "Resumen ejecutivo",
        action: "Dame un resumen ejecutivo conciso",
        icon: <Sparkles className="w-4 h-4" />,
        category: "analyze"
    },
    {
        label: "Hallazgos clave",
        action: "¿Cuáles son los hallazgos más importantes?",
        icon: <ListChecks className="w-4 h-4" />,
        category: "analyze"
    },
    {
        label: "Analizar datos",
        action: "Analiza los datos numéricos del documento",
        icon: <BarChart3 className="w-4 h-4" />,
        category: "analyze"
    },
    {
        label: "Preguntas sugeridas",
        action: "¿Qué preguntas debería hacer sobre este documento?",
        icon: <MessageSquare className="w-4 h-4" />,
        category: "general"
    }
];

interface PromptSuggestionsProps {
    onSelect: (action: string) => void;
    hasAttachment?: boolean;
    className?: string;
}

export function PromptSuggestions({
    onSelect,
    hasAttachment = false,
    className
}: PromptSuggestionsProps) {
    const suggestions = hasAttachment ? DOCUMENT_SUGGESTIONS : DEFAULT_SUGGESTIONS;

    return (
        <div className={cn(
            "flex flex-wrap gap-3 justify-center p-3 animate-in fade-in-50 duration-300",
            className
        )}>
            {suggestions.map((suggestion, index) => (
                <button
                    key={index}
                    onClick={() => onSelect(suggestion.action)}
                    className={cn(
                        "group flex items-center gap-3 px-5 py-3 rounded-2xl",
                        "text-sm font-medium transition-all duration-300",
                        "bg-background/60 backdrop-blur-md border border-border/40 shadow-sm",
                        "hover:border-primary/30 hover:shadow-lg hover:-translate-y-1 text-foreground/80 hover:text-foreground",
                        "active:scale-95",
                        suggestion.category === "analyze" && "hover:bg-blue-500/5 dark:hover:bg-blue-400/10 hover:border-blue-500/30",
                        suggestion.category === "create" && "hover:bg-green-500/5 dark:hover:bg-green-400/10 hover:border-green-500/30",
                        suggestion.category === "search" && "hover:bg-purple-500/5 dark:hover:bg-purple-400/10 hover:border-purple-500/30",
                        suggestion.category === "general" && "hover:bg-muted/80"
                    )}
                >
                    <span className={cn(
                        "p-1.5 rounded-lg transition-colors duration-300 bg-muted/60 text-muted-foreground",
                        suggestion.category === "analyze" && "group-hover:bg-blue-500/10 group-hover:text-blue-500 dark:group-hover:text-blue-400",
                        suggestion.category === "create" && "group-hover:bg-green-500/10 group-hover:text-green-500 dark:group-hover:text-green-400",
                        suggestion.category === "search" && "group-hover:bg-purple-500/10 group-hover:text-purple-500 dark:group-hover:text-purple-400",
                        suggestion.category === "general" && "group-hover:bg-foreground/10 group-hover:text-foreground"
                    )}>
                        {suggestion.icon}
                    </span>
                    <span>{suggestion.label}</span>
                </button>
            ))}
        </div>
    );
}

export default PromptSuggestions;
