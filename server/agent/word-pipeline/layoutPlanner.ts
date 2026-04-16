import { z } from "zod";
import { v4 as uuidv4 } from "uuid";
import type { SupportedLocale, SectionContent, Claim } from "./contracts";
import type { DocumentSpec, DocumentComponent, ComponentType, SectionSpecEnhanced } from "./documentSpec";
import { ThemeManager } from "./themeManager";

export const RenderBlockTypeSchema = z.enum([
  "paragraph",
  "heading",
  "list",
  "numbered_list",
  "table",
  "image",
  "chart",
  "callout",
  "quote",
  "code_block",
  "signature",
  "timeline",
  "skills_bar",
  "contact_info",
  "letterhead",
  "page_break",
  "horizontal_rule",
  "toc_entry",
  "bibliography_entry",
  "footnote_ref",
  "watermark",
  "header_content",
  "footer_content"
]);
export type RenderBlockType = z.infer<typeof RenderBlockTypeSchema>;

export const RenderBlockSchema = z.object({
  id: z.string().uuid(),
  type: RenderBlockTypeSchema,
  sectionId: z.string().uuid(),
  order: z.number().int().nonnegative(),
  content: z.any(),
  style: z.object({
    styleId: z.string(),
    alignment: z.enum(["left", "center", "right", "justify"]).optional(),
    indentLevel: z.number().int().nonnegative().optional(),
    pageBreakBefore: z.boolean().optional(),
    keepWithNext: z.boolean().optional(),
    columnSpan: z.number().int().positive().optional()
  }).optional(),
  citations: z.array(z.object({
    claimId: z.string().uuid(),
    sourceId: z.string().uuid(),
    marker: z.string()
  })).optional(),
  metadata: z.record(z.any()).optional()
});
export type RenderBlock = z.infer<typeof RenderBlockSchema>;

export const RenderSectionSchema = z.object({
  id: z.string().uuid(),
  title: z.string(),
  level: z.number().int().min(1).max(4),
  order: z.number().int().nonnegative(),
  pageBreakBefore: z.boolean().default(false),
  columns: z.number().int().min(1).max(3).default(1),
  blocks: z.array(RenderBlockSchema),
  headerContent: RenderBlockSchema.optional(),
  footerContent: RenderBlockSchema.optional()
});
export type RenderSection = z.infer<typeof RenderSectionSchema>;

export const RenderTreeSchema = z.object({
  id: z.string().uuid(),
  documentSpec: z.any(),
  sections: z.array(RenderSectionSchema),
  bibliography: z.array(z.object({
    id: z.string().uuid(),
    sourceId: z.string().uuid(),
    formatted: z.string(),
    order: z.number().int().nonnegative()
  })).optional(),
  footnotes: z.array(z.object({
    id: z.string().uuid(),
    marker: z.string(),
    content: z.string()
  })).optional(),
  watermark: z.object({
    text: z.string(),
    opacity: z.number().min(0).max(1)
  }).optional(),
  createdAt: z.string().datetime()
});
export type RenderTree = z.infer<typeof RenderTreeSchema>;

interface ParsedMarkdownBlock {
  type: RenderBlockType;
  content: string | string[] | Record<string, unknown>;
  level?: number;
  citations?: { claimId: string; sourceId: string; marker: string }[];
}

export class LayoutPlanner {
  private themeManager: ThemeManager;
  private documentSpec: DocumentSpec;
  private locale: SupportedLocale;

  constructor(documentSpec: DocumentSpec, themeManager: ThemeManager) {
    this.documentSpec = documentSpec;
    this.themeManager = themeManager;
    this.locale = documentSpec.locale;
  }

  planLayout(sectionContents: SectionContent[]): RenderTree {
    const sections: RenderSection[] = [];

    for (const sectionContent of sectionContents) {
      const specSection = this.documentSpec.sections.find(s => s.id === sectionContent.sectionId);
      if (!specSection) continue;

      const blocks = this.parseMarkdownToBlocks(sectionContent.markdown, sectionContent.claims, specSection);
      
      sections.push({
        id: specSection.id,
        title: specSection.title,
        level: specSection.level,
        order: specSection.order,
        pageBreakBefore: specSection.pageBreakBefore,
        columns: specSection.columns || 1,
        blocks
      });
    }

    const bibliography = this.extractBibliography(sectionContents);

    return {
      id: uuidv4(),
      documentSpec: this.documentSpec,
      sections: sections.sort((a, b) => a.order - b.order),
      bibliography,
      createdAt: new Date().toISOString()
    };
  }

  private parseMarkdownToBlocks(
    markdown: string,
    claims: Claim[],
    section: SectionSpecEnhanced
  ): RenderBlock[] {
    const blocks: RenderBlock[] = [];
    const lines = markdown.split("\n");
    let order = 0;
    let currentListItems: string[] = [];
    let currentListType: "list" | "numbered_list" | null = null;

    const flushList = () => {
      if (currentListItems.length > 0 && currentListType) {
        blocks.push({
          id: uuidv4(),
          type: currentListType,
          sectionId: section.id,
          order: order++,
          content: currentListItems,
          style: { styleId: "ListParagraph", indentLevel: 1 }
        });
        currentListItems = [];
        currentListType = null;
      }
    };

    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed) {
        flushList();
        continue;
      }

      const headingMatch = trimmed.match(/^(#{1,6})\s+(.+)$/);
      if (headingMatch) {
        flushList();
        const level = headingMatch[1].length;
        blocks.push({
          id: uuidv4(),
          type: "heading",
          sectionId: section.id,
          order: order++,
          content: { text: headingMatch[2], level },
          style: { 
            styleId: `Heading${Math.min(level, 4)}`,
            keepWithNext: true
          }
        });
        continue;
      }

      const bulletMatch = trimmed.match(/^[-*+]\s+(.+)$/);
      if (bulletMatch) {
        if (currentListType === "numbered_list") flushList();
        currentListType = "list";
        currentListItems.push(bulletMatch[1]);
        continue;
      }

      const numberMatch = trimmed.match(/^\d+\.\s+(.+)$/);
      if (numberMatch) {
        if (currentListType === "list") flushList();
        currentListType = "numbered_list";
        currentListItems.push(numberMatch[1]);
        continue;
      }

      const quoteMatch = trimmed.match(/^>\s+(.+)$/);
      if (quoteMatch) {
        flushList();
        blocks.push({
          id: uuidv4(),
          type: "quote",
          sectionId: section.id,
          order: order++,
          content: quoteMatch[1],
          style: { styleId: "Quote", indentLevel: 1 }
        });
        continue;
      }

      const codeBlockMatch = trimmed.match(/^```(\w*)?$/);
      if (codeBlockMatch) {
        continue;
      }

      const tableMatch = trimmed.match(/^\|(.+)\|$/);
      if (tableMatch) {
        flushList();
        const cells = tableMatch[1].split("|").map(c => c.trim());
        if (!cells.every(c => c.match(/^-+$/))) {
          blocks.push({
            id: uuidv4(),
            type: "table",
            sectionId: section.id,
            order: order++,
            content: { rows: [cells] },
            style: { styleId: "TableGrid" }
          });
        }
        continue;
      }

      const hrMatch = trimmed.match(/^[-*_]{3,}$/);
      if (hrMatch) {
        flushList();
        blocks.push({
          id: uuidv4(),
          type: "horizontal_rule",
          sectionId: section.id,
          order: order++,
          content: null
        });
        continue;
      }

      flushList();
      
      const citationRefs = this.extractCitationRefs(trimmed, claims);
      
      blocks.push({
        id: uuidv4(),
        type: "paragraph",
        sectionId: section.id,
        order: order++,
        content: trimmed,
        style: { styleId: "Normal" },
        citations: citationRefs.length > 0 ? citationRefs : undefined
      });
    }

    flushList();
    return blocks;
  }

  private extractCitationRefs(
    text: string,
    claims: Claim[]
  ): { claimId: string; sourceId: string; marker: string }[] {
    const refs: { claimId: string; sourceId: string; marker: string }[] = [];
    
    for (const claim of claims) {
      if (text.includes(claim.text.substring(0, 50)) && claim.citations.length > 0) {
        for (let i = 0; i < claim.citations.length; i++) {
          refs.push({
            claimId: claim.id,
            sourceId: claim.citations[i].id,
            marker: `[${refs.length + 1}]`
          });
        }
      }
    }

    return refs;
  }

  private extractBibliography(
    sectionContents: SectionContent[]
  ): { id: string; sourceId: string; formatted: string; order: number }[] {
    const allCitations = new Map<string, { sourceId: string; title: string }>();
    
    for (const section of sectionContents) {
      for (const claim of section.claims) {
        for (const citation of claim.citations) {
          if (!allCitations.has(citation.id)) {
            allCitations.set(citation.id, {
              sourceId: citation.id,
              title: citation.title
            });
          }
        }
      }
    }

    return Array.from(allCitations.values()).map((cite, index) => ({
      id: uuidv4(),
      sourceId: cite.sourceId,
      formatted: cite.title,
      order: index
    }));
  }

  addPageBreak(blocks: RenderBlock[], sectionId: string, order: number): RenderBlock {
    return {
      id: uuidv4(),
      type: "page_break",
      sectionId,
      order,
      content: null
    };
  }

  addTableOfContents(sections: RenderSection[]): RenderBlock {
    const tocEntries = sections
      .filter(s => s.level <= 3)
      .map(s => ({
        title: s.title,
        level: s.level,
        pageRef: "{{PAGE}}"
      }));

    return {
      id: uuidv4(),
      type: "toc_entry",
      sectionId: sections[0]?.id || uuidv4(),
      order: 0,
      content: tocEntries,
      style: { styleId: "TOC" }
    };
  }

  addSignatureBlock(sectionId: string, order: number, options: {
    name?: string;
    title?: string;
    date?: string;
  } = {}): RenderBlock {
    return {
      id: uuidv4(),
      type: "signature",
      sectionId,
      order,
      content: {
        name: options.name || "",
        title: options.title || "",
        date: options.date || new Date().toLocaleDateString(this.locale),
        lineWidth: 200
      },
      style: { styleId: "Normal", alignment: "left" }
    };
  }

  addSkillsBar(sectionId: string, order: number, skills: { name: string; level: number }[]): RenderBlock {
    return {
      id: uuidv4(),
      type: "skills_bar",
      sectionId,
      order,
      content: skills.map(s => ({
        name: s.name,
        level: Math.min(100, Math.max(0, s.level)),
        color: this.themeManager.getColorPalette().accent
      })),
      style: { styleId: "Normal" }
    };
  }

  addTimeline(sectionId: string, order: number, entries: { 
    date: string; 
    title: string; 
    description?: string 
  }[]): RenderBlock {
    return {
      id: uuidv4(),
      type: "timeline",
      sectionId,
      order,
      content: entries,
      style: { styleId: "Normal" }
    };
  }

  addCallout(sectionId: string, order: number, options: {
    type: "info" | "warning" | "success" | "error";
    title?: string;
    content: string;
  }): RenderBlock {
    const palette = this.themeManager.getColorPalette();
    const colorMap = {
      info: palette.accent,
      warning: palette.warningColor,
      success: palette.successColor,
      error: palette.errorColor
    };

    return {
      id: uuidv4(),
      type: "callout",
      sectionId,
      order,
      content: {
        type: options.type,
        title: options.title,
        text: options.content,
        color: colorMap[options.type]
      },
      style: { styleId: "Quote" }
    };
  }
}

export function createLayoutPlanner(
  documentSpec: DocumentSpec,
  themeManager: ThemeManager
): LayoutPlanner {
  return new LayoutPlanner(documentSpec, themeManager);
}

export function validateRenderTree(tree: RenderTree): { isValid: boolean; errors: string[] } {
  const errors: string[] = [];

  if (!tree.sections || tree.sections.length === 0) {
    errors.push("RenderTree has no sections");
  }

  for (const section of tree.sections || []) {
    if (!section.blocks || section.blocks.length === 0) {
      errors.push(`Section "${section.title}" has no blocks`);
    }

    for (const block of section.blocks || []) {
      if (!block.type) {
        errors.push(`Block ${block.id} has no type`);
      }
    }
  }

  return {
    isValid: errors.length === 0,
    errors
  };
}
