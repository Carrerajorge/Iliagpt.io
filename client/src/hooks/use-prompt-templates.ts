import { useState, useEffect, useCallback } from "react";

export interface PromptTemplate {
  id: string;
  title: string;
  content: string;
  category?: string;
  createdAt: Date;
  usageCount: number;
}

const STORAGE_KEY = "sira-prompt-templates";

const DEFAULT_TEMPLATES: PromptTemplate[] = [
  {
    id: "default-1",
    title: "Explicar concepto",
    content: "Explica de manera simple y clara el siguiente concepto: ",
    category: "Aprendizaje",
    createdAt: new Date(),
    usageCount: 0,
  },
  {
    id: "default-2",
    title: "Resumir texto",
    content: "Resume el siguiente texto en puntos clave: ",
    category: "Productividad",
    createdAt: new Date(),
    usageCount: 0,
  },
  {
    id: "default-3",
    title: "Redactar email profesional",
    content: "Redacta un email profesional sobre: ",
    category: "Escritura",
    createdAt: new Date(),
    usageCount: 0,
  },
  {
    id: "default-4",
    title: "Código con explicación",
    content: "Escribe código para la siguiente tarea y explica cada paso: ",
    category: "Desarrollo",
    createdAt: new Date(),
    usageCount: 0,
  },
];

function loadTemplates(): PromptTemplate[] {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored) {
      const parsed = JSON.parse(stored);
      return parsed.map((t: PromptTemplate) => ({
        ...t,
        createdAt: new Date(t.createdAt),
      }));
    }
  } catch (e) {
    console.error("Error loading templates:", e);
  }
  return DEFAULT_TEMPLATES;
}

function saveTemplates(templates: PromptTemplate[]) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(templates));
  } catch (e) {
    console.error("Error saving templates:", e);
  }
}

export function usePromptTemplates() {
  const [templates, setTemplates] = useState<PromptTemplate[]>(() => loadTemplates());

  useEffect(() => {
    saveTemplates(templates);
  }, [templates]);

  const addTemplate = useCallback(
    (template: Omit<PromptTemplate, "id" | "createdAt" | "usageCount">) => {
      const newTemplate: PromptTemplate = {
        ...template,
        id: `template-${Date.now()}`,
        createdAt: new Date(),
        usageCount: 0,
      };
      setTemplates((prev) => [...prev, newTemplate]);
      return newTemplate;
    },
    []
  );

  const removeTemplate = useCallback((id: string) => {
    setTemplates((prev) => prev.filter((t) => t.id !== id));
  }, []);

  const updateTemplate = useCallback(
    (id: string, updates: Partial<Pick<PromptTemplate, "title" | "content" | "category">>) => {
      setTemplates((prev) =>
        prev.map((t) => (t.id === id ? { ...t, ...updates } : t))
      );
    },
    []
  );

  const incrementUsage = useCallback((id: string) => {
    setTemplates((prev) =>
      prev.map((t) =>
        t.id === id ? { ...t, usageCount: t.usageCount + 1 } : t
      )
    );
  }, []);

  const getByCategory = useCallback(
    (category: string) => templates.filter((t) => t.category === category),
    [templates]
  );

  const categories = Array.from(new Set(templates.map((t) => t.category).filter((c): c is string => Boolean(c))));

  return {
    templates,
    addTemplate,
    removeTemplate,
    updateTemplate,
    incrementUsage,
    getByCategory,
    categories,
  };
}
