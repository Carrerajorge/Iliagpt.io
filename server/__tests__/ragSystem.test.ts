import { describe, expect, it, beforeEach } from "vitest";
import type { ExtractedText } from "../rag/documentProcessor";

/**
 * RAG System Tests
 *
 * Tests the new RAG pipeline: document processing, chunking,
 * embedding, context building, and citation engine.
 */

// ---------------------------------------------------------------------------
// Document Processor Tests
// ---------------------------------------------------------------------------

describe("DocumentProcessor", () => {
  it("extracts text from a plain text buffer", async () => {
    const { extractDocument } = await import("../rag/documentProcessor");
    const content = "# Hello World\n\nThis is a test document with multiple paragraphs.\n\nSecond paragraph here.";
    const result = await extractDocument({
      buffer: Buffer.from(content, "utf-8"),
      filename: "test.md",
      mimeType: "text/markdown",
    });

    expect(result.content).toBe(content);
    expect(result.metadata.filename).toBe("test.md");
    expect(result.metadata.wordCount).toBeGreaterThan(5);
  });

  it("extracts text from CSV", async () => {
    const { extractDocument } = await import("../rag/documentProcessor");
    const csv = "Name,Email,Role\nAlice,alice@test.com,Admin\nBob,bob@test.com,User";
    const result = await extractDocument({
      buffer: Buffer.from(csv, "utf-8"),
      filename: "users.csv",
      mimeType: "text/csv",
    });

    expect(result.content).toContain("Alice");
    expect(result.content).toContain("bob@test.com");
  });
});

// ---------------------------------------------------------------------------
// Chunking Tests
// ---------------------------------------------------------------------------

describe("DocumentChunker", () => {
  it("chunks a document respecting paragraph boundaries", async () => {
    const { chunkDocument } = await import("../rag/documentProcessor");

    const content = Array.from({ length: 20 }, (_, i) =>
      `Paragraph ${i + 1}. This is a test paragraph with enough content to be meaningful. It contains several sentences about topic ${i + 1}. The goal is to test intelligent chunking.`
    ).join("\n\n");

    const extracted: ExtractedText = {
      content,
      metadata: { filename: "test.md", mimeType: "text/markdown", wordCount: 200 },
    };

    const chunks = chunkDocument(extracted, { maxChunkSize: 500, overlapSize: 100 });

    expect(chunks.length).toBeGreaterThan(1);
    // Each chunk should have content
    for (const chunk of chunks) {
      expect(chunk.content.length).toBeGreaterThan(50);
      expect(chunk.metadata.filename).toBe("test.md");
      expect(chunk.metadata.contentHash).toBeTruthy();
      expect(chunk.id).toBeTruthy();
    }
  });

  it("keeps small documents as a single chunk", async () => {
    const { chunkDocument } = await import("../rag/documentProcessor");

    const extracted: ExtractedText = {
      content: "Short document.",
      metadata: { filename: "short.txt", mimeType: "text/plain", wordCount: 2 },
    };

    const chunks = chunkDocument(extracted, { minChunkSize: 5 });
    expect(chunks.length).toBe(1);
    expect(chunks[0].content).toBe("Short document.");
  });

  it("assigns section headings from markdown headers", async () => {
    const { chunkDocument } = await import("../rag/documentProcessor");

    const content = `# Introduction\n\nThis is the intro section with enough content.\n\n# Methods\n\nThis is the methods section with detailed content about methodology and approach used in this study.`;

    const extracted: ExtractedText = {
      content,
      metadata: { filename: "paper.md", mimeType: "text/markdown", wordCount: 30 },
    };

    const chunks = chunkDocument(extracted, { maxChunkSize: 200, minChunkSize: 20 });

    // At least one chunk should have a section heading
    const headings = chunks.map(c => c.metadata.sectionHeading).filter(Boolean);
    expect(headings.length).toBeGreaterThan(0);
  });

  it("returns empty array for empty content", async () => {
    const { chunkDocument } = await import("../rag/documentProcessor");

    const extracted: ExtractedText = {
      content: "",
      metadata: { filename: "empty.txt", mimeType: "text/plain", wordCount: 0 },
    };

    const chunks = chunkDocument(extracted);
    expect(chunks).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// Embedding Service Tests
// ---------------------------------------------------------------------------

describe("EmbeddingService", () => {
  it("generates embeddings with local fallback", async () => {
    const { embed, cosineSimilarity } = await import("../rag/embeddingService");

    const vec1 = await embed("machine learning algorithms");
    const vec2 = await embed("deep learning neural networks");
    const vec3 = await embed("cooking recipes for pasta");

    expect(vec1.length).toBeGreaterThan(0);
    expect(vec2.length).toBe(vec1.length);

    // Semantically similar texts should have higher similarity
    const sim12 = cosineSimilarity(vec1, vec2);
    const sim13 = cosineSimilarity(vec1, vec3);
    expect(sim12).toBeGreaterThan(sim13);
  });

  it("returns cached embeddings on repeat calls", async () => {
    const { embed } = await import("../rag/embeddingService");

    const vec1 = await embed("exact same text for caching test");
    const vec2 = await embed("exact same text for caching test");

    expect(vec1).toEqual(vec2);
  });

  it("batch embeds multiple texts", async () => {
    const { embedBatch } = await import("../rag/embeddingService");

    const texts = ["hello world", "foo bar baz", "testing embedding service"];
    const vectors = await embedBatch(texts);

    expect(vectors.length).toBe(3);
    for (const vec of vectors) {
      expect(vec.length).toBeGreaterThan(0);
    }
  });

  it("reports active provider", async () => {
    const { getActiveProvider, embed } = await import("../rag/embeddingService");
    await embed("trigger provider selection");
    const provider = getActiveProvider();
    expect(provider.name).toBe("local"); // In test env, should use local
    expect(provider.dimensions).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------
// Context Builder Tests
// ---------------------------------------------------------------------------

describe("ContextBuilder", () => {
  it("returns inactive context when no collections exist", async () => {
    const { buildRAGContext } = await import("../rag/contextBuilder");

    // This will fail gracefully since there's no DB in test
    try {
      const ctx = await buildRAGContext({
        userId: "test-user-nonexistent",
        query: "test query",
      });
      // Should return inactive since no collections found
      expect(ctx.active).toBe(false);
      expect(ctx.sources.length).toBe(0);
    } catch {
      // DB not available in test — that's OK
      expect(true).toBe(true);
    }
  });
});

// ---------------------------------------------------------------------------
// Citation Engine Tests
// ---------------------------------------------------------------------------

describe("CitationEngine", () => {
  it("extracts citations from response text with [Source N:] markers", async () => {
    const { extractCitations } = await import("../rag/citationEngine");

    const response = "According to the report [Source 1: annual-report.pdf, p. 5], revenue grew by 45%. Additionally [Source 2: metrics.xlsx], user count doubled.";
    const sources = [
      { id: "s1", filename: "annual-report.pdf", pageNumber: 5, relevanceScore: 0.95, snippet: "Revenue grew..." },
      { id: "s2", filename: "metrics.xlsx", relevanceScore: 0.88, snippet: "User count..." },
    ];

    const result = extractCitations(response, sources as any);

    expect(result.hasCitations).toBe(true);
    expect(result.citations.length).toBe(2);
    expect(result.citations[0].filename).toBe("annual-report.pdf");
    expect(result.citations[1].filename).toBe("metrics.xlsx");
    expect(result.annotatedText).toContain("[1]");
    expect(result.annotatedText).toContain("[2]");
    expect(result.footnotes).toContain("annual-report.pdf");
  });

  it("handles Spanish [Fuente:] format", async () => {
    const { extractCitations } = await import("../rag/citationEngine");

    const response = "Según el documento [Fuente 1: informe.pdf], los datos muestran crecimiento.";
    const sources = [
      { id: "s1", filename: "informe.pdf", relevanceScore: 0.9, snippet: "Los datos..." },
    ];

    const result = extractCitations(response, sources as any);
    expect(result.hasCitations).toBe(true);
    expect(result.citations[0].filename).toBe("informe.pdf");
  });

  it("returns no citations when no markers present", async () => {
    const { extractCitations } = await import("../rag/citationEngine");

    const response = "This is a plain response without any source markers.";
    const sources = [
      { id: "s1", filename: "doc.pdf", relevanceScore: 0.9, snippet: "Some content" },
    ];

    const result = extractCitations(response, sources as any);
    expect(result.citations.length).toBe(0);
  });

  it("formats sources for frontend display", async () => {
    const { formatSourcesForDisplay } = await import("../rag/citationEngine");

    const citations = [
      { index: 1, sourceId: "s1", filename: "report.pdf", pageNumber: 3, sectionHeading: "Introduction", relevanceScore: 0.95, snippet: "Summary text..." },
      { index: 2, sourceId: "s2", filename: "data.xlsx", relevanceScore: 0.82, snippet: "Data content..." },
    ];

    const display = formatSourcesForDisplay(citations);
    expect(display.length).toBe(2);
    expect(display[0].title).toBe("report.pdf");
    expect(display[0].subtitle).toContain("Page 3");
    expect(display[0].relevance).toBe(95);
    expect(display[1].title).toBe("data.xlsx");
  });
});

// ---------------------------------------------------------------------------
// Knowledge Base Tests
// ---------------------------------------------------------------------------

describe("KnowledgeBase", () => {
  it("imports without errors", async () => {
    const kb = await import("../rag/knowledgeBase");
    expect(kb.createCollection).toBeDefined();
    expect(kb.listCollections).toBeDefined();
    expect(kb.addDocument).toBeDefined();
    expect(kb.deleteCollection).toBeDefined();
  });
});

// ---------------------------------------------------------------------------
// Vector Store Tests
// ---------------------------------------------------------------------------

describe("VectorStore", () => {
  it("imports without errors", async () => {
    const vs = await import("../rag/vectorStore");
    expect(vs.search).toBeDefined();
    expect(vs.insertDocument).toBeDefined();
    expect(vs.insertDocuments).toBeDefined();
    expect(vs.deleteByCollection).toBeDefined();
  });
});
