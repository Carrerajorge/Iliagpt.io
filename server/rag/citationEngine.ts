/**
 * Citation Engine — Extracts and formats source citations from RAG responses.
 *
 * Parses [Source: ...] markers from the LLM response,
 * maps them to the RAG sources, and generates:
 * - Inline citations for display
 * - A footnotes/bibliography section
 * - Structured citation data for the frontend
 */

import type { RAGSource } from "./contextBuilder";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface Citation {
  index: number;
  sourceId: string;
  filename: string;
  pageNumber?: number;
  sectionHeading?: string;
  relevanceScore: number;
  snippet: string;
  /** The text in the response that references this source */
  referencedText?: string;
}

export interface CitationResult {
  /** The response text with inline citation markers like [1], [2] */
  annotatedText: string;
  /** Structured citations for frontend rendering */
  citations: Citation[];
  /** Formatted footnotes section */
  footnotes: string;
  /** Whether any citations were found */
  hasCitations: boolean;
}

// ---------------------------------------------------------------------------
// Citation extraction and formatting
// ---------------------------------------------------------------------------

const SOURCE_PATTERN = /\[(?:Source|Fuente)\s*(\d+)?[:\s]*([^\]]*)\]/gi;

/**
 * Process an LLM response that may contain [Source: ...] markers.
 * Maps them to the RAG sources and produces clean inline citations.
 */
export function extractCitations(
  responseText: string,
  ragSources: RAGSource[],
): CitationResult {
  if (!responseText || ragSources.length === 0) {
    return {
      annotatedText: responseText,
      citations: [],
      footnotes: "",
      hasCitations: false,
    };
  }

  const citations: Citation[] = [];
  const usedSourceIds = new Set<string>();

  // Replace [Source N: filename, page] with [N] and track citations
  const annotatedText = responseText.replace(SOURCE_PATTERN, (match, indexStr, details) => {
    const sourceIndex = indexStr ? parseInt(indexStr, 10) - 1 : -1;

    // Try to match by index first
    let source: RAGSource | undefined;
    if (sourceIndex >= 0 && sourceIndex < ragSources.length) {
      source = ragSources[sourceIndex];
    }

    // If no index match, try to match by filename in the details
    if (!source && details) {
      const detailLower = details.toLowerCase().trim();
      source = ragSources.find(s =>
        detailLower.includes(s.filename.toLowerCase()) ||
        s.filename.toLowerCase().includes(detailLower.split(",")[0].trim()),
      );
    }

    if (!source) {
      // Can't resolve — keep original text but clean it up
      return match;
    }

    // Track this citation
    if (!usedSourceIds.has(source.id)) {
      usedSourceIds.add(source.id);
      citations.push({
        index: citations.length + 1,
        sourceId: source.id,
        filename: source.filename,
        pageNumber: source.pageNumber,
        sectionHeading: source.sectionHeading,
        relevanceScore: source.relevanceScore,
        snippet: source.snippet,
      });
    }

    const citationIndex = citations.findIndex(c => c.sourceId === source!.id) + 1;
    return `[${citationIndex}]`;
  });

  // Also check if the LLM mentioned filenames without using the [Source] format
  for (const source of ragSources) {
    if (usedSourceIds.has(source.id)) continue;
    const nameWithoutExt = source.filename.replace(/\.[^.]+$/, "");
    if (
      nameWithoutExt.length > 3 &&
      responseText.toLowerCase().includes(nameWithoutExt.toLowerCase())
    ) {
      usedSourceIds.add(source.id);
      citations.push({
        index: citations.length + 1,
        sourceId: source.id,
        filename: source.filename,
        pageNumber: source.pageNumber,
        sectionHeading: source.sectionHeading,
        relevanceScore: source.relevanceScore,
        snippet: source.snippet,
      });
    }
  }

  // Build footnotes
  const footnoteLines = citations.map(c => {
    const parts = [`[${c.index}] ${c.filename}`];
    if (c.pageNumber) parts.push(`p. ${c.pageNumber}`);
    if (c.sectionHeading) parts.push(c.sectionHeading);
    return parts.join(", ");
  });

  const footnotes = footnoteLines.length > 0
    ? "\n\n---\n**Fuentes:**\n" + footnoteLines.join("\n")
    : "";

  return {
    annotatedText,
    citations,
    footnotes,
    hasCitations: citations.length > 0,
  };
}

/**
 * Generate a sources section for display below the assistant message.
 * Returns structured data for the frontend to render as clickable source cards.
 */
export function formatSourcesForDisplay(citations: Citation[]): Array<{
  index: number;
  title: string;
  subtitle: string;
  snippet: string;
  relevance: number;
}> {
  return citations.map(c => ({
    index: c.index,
    title: c.filename,
    subtitle: [
      c.pageNumber ? `Page ${c.pageNumber}` : null,
      c.sectionHeading || null,
    ].filter(Boolean).join(" - "),
    snippet: c.snippet,
    relevance: Math.round(c.relevanceScore * 100),
  }));
}
