/**
 * Prompt Template Library - ILIAGPT PRO 3.0
 * 
 * Reusable prompt templates with categories and variables.
 */

import { memo, useState, useMemo, useCallback } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
    Bookmark,
    Star,
    Search,
    Plus,
    Folder,
    FileText,
    Code,
    PenTool,
    Briefcase,
    GraduationCap,
    Zap,
    ChevronRight,
    X
} from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

// ============== Types ==============

export interface PromptTemplate {
    id: string;
    title: string;
    content: string;
    category: PromptCategory;
    variables?: PromptVariable[];
    isFavorite?: boolean;
    usageCount?: number;
    createdAt?: Date;
}

export interface PromptVariable {
    name: string;
    placeholder: string;
    defaultValue?: string;
}

export type PromptCategory =
    | "writing"
    | "coding"
    | "analysis"
    | "business"
    | "academic"
    | "creative"
    | "custom";

// ============== Default Templates ==============

export const DEFAULT_TEMPLATES: PromptTemplate[] = [
    {
        id: "summarize",
        title: "Resumir texto",
        content: "Resume el siguiente texto en {length} puntos clave:\n\n{text}",
        category: "writing",
        variables: [
            { name: "length", placeholder: "número de puntos", defaultValue: "5" },
            { name: "text", placeholder: "texto a resumir" },
        ],
    },
    {
        id: "explain-code",
        title: "Explicar código",
        content: "Explica el siguiente código {language} línea por línea:\n\n```{language}\n{code}\n```",
        category: "coding",
        variables: [
            { name: "language", placeholder: "lenguaje", defaultValue: "javascript" },
            { name: "code", placeholder: "código a explicar" },
        ],
    },
    {
        id: "refactor",
        title: "Refactorizar código",
        content: "Refactoriza el siguiente código {language} para mejorar {aspect}:\n\n```{language}\n{code}\n```",
        category: "coding",
        variables: [
            { name: "language", placeholder: "lenguaje", defaultValue: "typescript" },
            { name: "aspect", placeholder: "aspecto a mejorar", defaultValue: "legibilidad y rendimiento" },
            { name: "code", placeholder: "código a refactorizar" },
        ],
    },
    {
        id: "analyze-data",
        title: "Analizar datos",
        content: "Analiza los siguientes datos y proporciona:\n1. Tendencias principales\n2. Anomalías\n3. Recomendaciones\n\nDatos:\n{data}",
        category: "analysis",
        variables: [
            { name: "data", placeholder: "datos a analizar" },
        ],
    },
    {
        id: "email-professional",
        title: "Email profesional",
        content: "Redacta un email profesional para {recipient} sobre {topic}.\n\nTono: {tone}\nObjetivo: {goal}",
        category: "business",
        variables: [
            { name: "recipient", placeholder: "destinatario" },
            { name: "topic", placeholder: "tema" },
            { name: "tone", placeholder: "tono", defaultValue: "formal pero amigable" },
            { name: "goal", placeholder: "objetivo del email" },
        ],
    },
    {
        id: "research-outline",
        title: "Esquema de investigación",
        content: "Crea un esquema detallado para un trabajo de investigación sobre:\n\nTema: {topic}\nNivel: {level}\nExtensión: {length} páginas",
        category: "academic",
        variables: [
            { name: "topic", placeholder: "tema de investigación" },
            { name: "level", placeholder: "nivel académico", defaultValue: "universitario" },
            { name: "length", placeholder: "extensión", defaultValue: "10" },
        ],
    },
    {
        id: "brainstorm",
        title: "Lluvia de ideas",
        content: "Genera {count} ideas creativas para {topic}.\n\nContexto: {context}\nRestricciones: {constraints}",
        category: "creative",
        variables: [
            { name: "count", placeholder: "cantidad", defaultValue: "10" },
            { name: "topic", placeholder: "tema" },
            { name: "context", placeholder: "contexto", defaultValue: "ninguno" },
            { name: "constraints", placeholder: "restricciones", defaultValue: "ninguna" },
        ],
    },
];

// ============== Icons ==============

const categoryIcons: Record<PromptCategory, React.ReactNode> = {
    writing: <PenTool className="w-4 h-4" />,
    coding: <Code className="w-4 h-4" />,
    analysis: <FileText className="w-4 h-4" />,
    business: <Briefcase className="w-4 h-4" />,
    academic: <GraduationCap className="w-4 h-4" />,
    creative: <Zap className="w-4 h-4" />,
    custom: <Folder className="w-4 h-4" />,
};

const categoryLabels: Record<PromptCategory, string> = {
    writing: "Escritura",
    coding: "Código",
    analysis: "Análisis",
    business: "Negocios",
    academic: "Académico",
    creative: "Creativo",
    custom: "Personalizado",
};

// ============== Components ==============

interface PromptLibraryProps {
    isOpen: boolean;
    onClose: () => void;
    onSelect: (template: PromptTemplate, filledContent: string) => void;
    customTemplates?: PromptTemplate[];
}

export const PromptLibrary = memo(function PromptLibrary({
    isOpen,
    onClose,
    onSelect,
    customTemplates = [],
}: PromptLibraryProps) {
    const [search, setSearch] = useState("");
    const [selectedCategory, setSelectedCategory] = useState<PromptCategory | "all">("all");
    const [selectedTemplate, setSelectedTemplate] = useState<PromptTemplate | null>(null);
    const [variables, setVariables] = useState<Record<string, string>>({});

    const allTemplates = useMemo(() =>
        [...DEFAULT_TEMPLATES, ...customTemplates],
        [customTemplates]
    );

    const filteredTemplates = useMemo(() => {
        return allTemplates.filter(t => {
            const matchesSearch = search === "" ||
                t.title.toLowerCase().includes(search.toLowerCase()) ||
                t.content.toLowerCase().includes(search.toLowerCase());
            const matchesCategory = selectedCategory === "all" || t.category === selectedCategory;
            return matchesSearch && matchesCategory;
        });
    }, [allTemplates, search, selectedCategory]);

    const handleSelectTemplate = useCallback((template: PromptTemplate) => {
        setSelectedTemplate(template);
        const defaults: Record<string, string> = {};
        template.variables?.forEach(v => {
            defaults[v.name] = v.defaultValue || "";
        });
        setVariables(defaults);
    }, []);

    const handleUseTemplate = useCallback(() => {
        if (!selectedTemplate) return;

        let filled = selectedTemplate.content;
        Object.entries(variables).forEach(([key, value]) => {
            filled = filled.replace(new RegExp(`\\{${key}\\}`, "g"), value || `{${key}}`);
        });

        onSelect(selectedTemplate, filled);
        onClose();
    }, [selectedTemplate, variables, onSelect, onClose]);

    if (!isOpen) return null;

    return (
        <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 flex items-center justify-center p-4"
            onClick={onClose}
        >
            <div className="absolute inset-0 bg-black/50 backdrop-blur-sm" />

            <motion.div
                initial={{ scale: 0.95, opacity: 0 }}
                animate={{ scale: 1, opacity: 1 }}
                exit={{ scale: 0.95, opacity: 0 }}
                className="relative w-full max-w-3xl bg-background rounded-2xl border shadow-2xl overflow-hidden"
                onClick={e => e.stopPropagation()}
            >
                {/* Header */}
                <div className="flex items-center justify-between p-4 border-b">
                    <div className="flex items-center gap-2">
                        <Bookmark className="w-5 h-5 text-primary" />
                        <h2 className="text-lg font-semibold">Biblioteca de Prompts</h2>
                    </div>
                    <Button variant="ghost" size="icon" onClick={onClose}>
                        <X className="w-4 h-4" />
                    </Button>
                </div>

                <div className="flex h-[500px]">
                    {/* Sidebar */}
                    <div className="w-48 border-r p-2 space-y-1">
                        <button
                            className={cn(
                                "w-full flex items-center gap-2 px-3 py-2 rounded-lg text-sm transition-colors",
                                selectedCategory === "all"
                                    ? "bg-primary/10 text-primary"
                                    : "hover:bg-muted"
                            )}
                            onClick={() => setSelectedCategory("all")}
                        >
                            <Star className="w-4 h-4" />
                            Todos
                        </button>
                        {(Object.keys(categoryIcons) as PromptCategory[]).map(cat => (
                            <button
                                key={cat}
                                className={cn(
                                    "w-full flex items-center gap-2 px-3 py-2 rounded-lg text-sm transition-colors",
                                    selectedCategory === cat
                                        ? "bg-primary/10 text-primary"
                                        : "hover:bg-muted"
                                )}
                                onClick={() => setSelectedCategory(cat)}
                            >
                                {categoryIcons[cat]}
                                {categoryLabels[cat]}
                            </button>
                        ))}
                    </div>

                    {/* Content */}
                    <div className="flex-1 flex flex-col">
                        {/* Search */}
                        <div className="p-3 border-b">
                            <div className="relative">
                                <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                                <Input
                                    value={search}
                                    onChange={e => setSearch(e.target.value)}
                                    placeholder="Buscar plantillas..."
                                    className="pl-9"
                                />
                            </div>
                        </div>

                        {/* Templates Grid */}
                        <div className="flex-1 overflow-auto p-3">
                            {selectedTemplate ? (
                                <div className="space-y-4">
                                    <Button variant="ghost" size="sm" onClick={() => setSelectedTemplate(null)}>
                                        ← Volver
                                    </Button>
                                    <div className="bg-muted/50 rounded-lg p-4">
                                        <h3 className="font-semibold mb-2">{selectedTemplate.title}</h3>
                                        <p className="text-sm text-muted-foreground mb-4 whitespace-pre-wrap">
                                            {selectedTemplate.content}
                                        </p>

                                        {selectedTemplate.variables && selectedTemplate.variables.length > 0 && (
                                            <div className="space-y-3">
                                                <h4 className="text-sm font-medium">Variables</h4>
                                                {selectedTemplate.variables.map(v => (
                                                    <div key={v.name}>
                                                        <label className="text-xs text-muted-foreground">{v.placeholder}</label>
                                                        <Input
                                                            value={variables[v.name] || ""}
                                                            onChange={e => setVariables(prev => ({
                                                                ...prev,
                                                                [v.name]: e.target.value
                                                            }))}
                                                            placeholder={v.placeholder}
                                                            className="mt-1"
                                                        />
                                                    </div>
                                                ))}
                                            </div>
                                        )}
                                    </div>
                                    <Button onClick={handleUseTemplate} className="w-full">
                                        Usar plantilla
                                    </Button>
                                </div>
                            ) : (
                                <div className="grid grid-cols-2 gap-2">
                                    {filteredTemplates.map(template => (
                                        <button
                                            key={template.id}
                                            className="text-left p-3 rounded-lg border hover:border-primary/50 hover:bg-muted/50 transition-colors"
                                            onClick={() => handleSelectTemplate(template)}
                                        >
                                            <div className="flex items-center gap-2 mb-1">
                                                {categoryIcons[template.category]}
                                                <span className="font-medium text-sm">{template.title}</span>
                                            </div>
                                            <p className="text-xs text-muted-foreground line-clamp-2">
                                                {template.content.slice(0, 80)}...
                                            </p>
                                        </button>
                                    ))}
                                </div>
                            )}
                        </div>
                    </div>
                </div>
            </motion.div>
        </motion.div>
    );
});

export default PromptLibrary;
