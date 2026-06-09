import type { LucideIcon } from "lucide-react";
import { ImageIcon, Briefcase, BookOpen, Code2, Bot } from "lucide-react";

export type GptCategory = "image" | "productivity" | "research" | "coding" | "generic";

export interface GptCategoryVisual {
  icon: LucideIcon;
  label: string;
  gradient: string;
  ringColor: string;
  effectClass: string;
  mode: GptCategory;
  description: string;
}

const KEYWORDS: Record<Exclude<GptCategory, "generic">, RegExp> = {
  image: /dall[\s-]?e|imagen|image|picture|foto|photo|midjourney|flux|stable[\s-]?diffusion|dise[ñn]o|logo|art/i,
  productivity: /productividad|productivity|escritura|writing|text|email|docs|summary|resumen|asistente/i,
  research: /investigac|research|search|buscar|analysis|análisis|scholar|paper|estudio|deep[\s-]?research/i,
  coding: /program|coding|code|canvas|desarroll|developer|javascript|python|3d|html|typescript|react/i,
};

export function inferGptCategory(gpt: {
  name?: string;
  slug?: string;
  description?: string | null;
  categoryId?: string | null;
}): GptCategory {
  const haystack = [gpt.name, gpt.slug, gpt.description, gpt.categoryId]
    .filter(Boolean)
    .join(" ");
  if (KEYWORDS.image.test(haystack)) return "image";
  if (KEYWORDS.coding.test(haystack)) return "coding";
  if (KEYWORDS.research.test(haystack)) return "research";
  if (KEYWORDS.productivity.test(haystack)) return "productivity";
  return "generic";
}

export const CATEGORY_VISUALS: Record<GptCategory, GptCategoryVisual> = {
  image: {
    icon: ImageIcon,
    label: "Imagen",
    gradient: "from-pink-500/20 via-fuchsia-500/15 to-purple-500/20",
    ringColor: "ring-fuchsia-400/40",
    effectClass: "gpt-fx-image",
    mode: "image",
    description: "Genera imágenes con DALL-E",
  },
  productivity: {
    icon: Briefcase,
    label: "Texto",
    gradient: "from-sky-500/20 via-blue-500/15 to-indigo-500/20",
    ringColor: "ring-sky-400/40",
    effectClass: "gpt-fx-text",
    mode: "productivity",
    description: "Asistente de texto y productividad",
  },
  research: {
    icon: BookOpen,
    label: "Investigación",
    gradient: "from-amber-500/20 via-orange-500/15 to-rose-500/20",
    ringColor: "ring-amber-400/40",
    effectClass: "gpt-fx-research",
    mode: "research",
    description: "Busca y analiza información",
  },
  coding: {
    icon: Code2,
    label: "Canvas",
    gradient: "from-emerald-500/20 via-teal-500/15 to-cyan-500/20",
    ringColor: "ring-emerald-400/40",
    effectClass: "gpt-fx-code",
    mode: "coding",
    description: "Canvas para 1D/2D/3D/HTML",
  },
  generic: {
    icon: Bot,
    label: "GPT",
    gradient: "from-neutral-500/10 via-neutral-400/10 to-neutral-500/10",
    ringColor: "ring-neutral-400/30",
    effectClass: "gpt-fx-generic",
    mode: "generic",
    description: "GPT",
  },
};

export function getCategoryVisual(gpt: {
  name?: string;
  slug?: string;
  description?: string | null;
  categoryId?: string | null;
}): GptCategoryVisual {
  return CATEGORY_VISUALS[inferGptCategory(gpt)];
}

export function supportsHtmlInCanvas(): boolean {
  if (typeof document === "undefined") return false;
  const testCanvas = document.createElement("canvas");
  testCanvas.setAttribute("layoutsubtree", "");
  const ctx = testCanvas.getContext("2d");
  return !!(ctx && typeof (ctx as any).drawElementImage === "function");
}
