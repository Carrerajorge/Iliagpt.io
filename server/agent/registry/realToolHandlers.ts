import { z } from "zod";
import * as fs from "fs";
import * as path from "path";
import crypto from "crypto";
import { EnterpriseDocumentService, type DocumentSection as EnterpriseDocumentSection } from "../../services/enterpriseDocumentService";
import { generateProfessionalOfficeDocument, toProfessionalOfficePrompt } from "../../services/professionalOfficeGenerator";

const ARTIFACTS_DIR = path.join(process.cwd(), "artifacts");

function ensureArtifactsDir(): void {
  if (!fs.existsSync(ARTIFACTS_DIR)) {
    fs.mkdirSync(ARTIFACTS_DIR, { recursive: true });
  }
}

export interface RealToolResult {
  success: boolean;
  data: Record<string, unknown>;
  message: string;
  artifacts?: string[];
  validationPassed: boolean;
}

function buildDocumentSectionsFromContent(title: string, content: string): EnterpriseDocumentSection[] {
  const normalized = String(content || "").replace(/\r\n/g, "\n").trim();
  if (!normalized) {
    return [{
      id: "section-1",
      title: "Contenido",
      content: title,
      level: 1,
    }];
  }

  const headingRe = /^(#{1,3})\s+(.+)$/;
  const lines = normalized.split("\n");
  const sections: EnterpriseDocumentSection[] = [];
  let currentSection: EnterpriseDocumentSection | null = null;

  const flushCurrentSection = () => {
    if (!currentSection) return;
    currentSection.content = currentSection.content.trim() || "Contenido generado automáticamente.";
    sections.push(currentSection);
    currentSection = null;
  };

  for (const rawLine of lines) {
    const line = rawLine.trimEnd();
    const headingMatch = line.match(headingRe);

    if (headingMatch) {
      flushCurrentSection();
      const hashes = headingMatch[1].length;
      currentSection = {
        id: `section-${sections.length + 1}`,
        title: headingMatch[2].trim(),
        content: "",
        level: hashes === 1 ? 1 : hashes === 2 ? 2 : 3,
      };
      continue;
    }

    if (!currentSection) {
      currentSection = {
        id: `section-${sections.length + 1}`,
        title: "Contenido",
        content: "",
        level: 1,
      };
    }

    currentSection.content += `${line}\n`;
  }

  flushCurrentSection();

  return sections.length > 0
    ? sections
    : [{
        id: "section-1",
        title: "Contenido",
        content: normalized,
        level: 1,
      }];
}

export async function realWebSearch(input: { query: string; maxResults?: number }): Promise<RealToolResult> {
  const { query, maxResults = 5 } = input;

  try {
    const { searchWeb } = await import("../../services/webSearch");
    const webResults = await searchWeb(query, maxResults);

    if (webResults.results && webResults.results.length > 0) {
      const results = webResults.results
        .filter(r => r.url && (r.url.startsWith("http://") || r.url.startsWith("https://")))
        .slice(0, maxResults)
        .map(r => ({
          title: r.title,
          url: r.url,
          snippet: r.snippet || "",
        }));

      return {
        success: true,
        data: {
          query,
          resultsCount: results.length,
          results,
          source: "duckduckgo",
          searchPerformed: true,
          timestamp: new Date().toISOString(),
        },
        message: `Found ${results.length} web results for "${query}"`,
        validationPassed: results.length > 0,
      };
    }

    console.log(`[realWebSearch] DuckDuckGo returned no results, falling back to Wikipedia for: "${query}"`);
    const wikiUrl = `https://en.wikipedia.org/w/api.php?action=opensearch&search=${encodeURIComponent(query)}&limit=${maxResults}&format=json&origin=*`;
    const response = await fetch(wikiUrl, {
      headers: { "User-Agent": "IliaGPT/1.0 (https://replit.com)" },
    });

    const data = await response.json();
    const titles = data[1] || [];
    const snippets = data[2] || [];
    const urls = data[3] || [];

    const results: Array<{ title: string; url: string; snippet: string }> = [];
    for (let i = 0; i < Math.min(titles.length, maxResults); i++) {
      results.push({ title: titles[i], url: urls[i], snippet: snippets[i] || "" });
    }

    return {
      success: true,
      data: {
        query,
        resultsCount: results.length,
        results,
        source: "wikipedia-opensearch",
        searchPerformed: true,
        timestamp: new Date().toISOString(),
      },
      message: `Found ${results.length} results for "${query}"`,
      validationPassed: results.length > 0,
    };
  } catch (error) {
    console.error(`[realWebSearch] Search failed for "${query}":`, error);
    return {
      success: false,
      data: { query, error: String(error) },
      message: `Search failed: ${error}`,
      validationPassed: false,
    };
  }
}

export async function realBrowseUrl(input: { url: string }): Promise<RealToolResult> {
  const { url } = input;

  try {
    const response = await fetch(url, {
      headers: {
        "User-Agent": "Mozilla/5.0 (compatible; IliaGPT/1.0)",
      },
    });

    const html = await response.text();
    const titleMatch = html.match(/<title[^>]*>([^<]+)<\/title>/i);
    const title = titleMatch ? titleMatch[1].trim() : "No title";

    const textContent = html
      .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, "")
      .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, "")
      .replace(/<[^>]+>/g, " ")
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, 5000);

    ensureArtifactsDir();
    const artifactPath = path.join(ARTIFACTS_DIR, `browse_${crypto.randomUUID().slice(0, 8)}.html`);
    fs.writeFileSync(artifactPath, html.slice(0, 50000));

    const isValid = html.length > 100 && textContent.length > 50;

    return {
      success: true,
      data: {
        url,
        title,
        status: response.status,
        contentLength: html.length,
        textPreview: textContent.slice(0, 500),
        fullTextLength: textContent.length,
        timestamp: new Date().toISOString(),
      },
      message: `Fetched "${title}" (${html.length} bytes)`,
      artifacts: [artifactPath],
      validationPassed: isValid,
    };
  } catch (error) {
    return {
      success: false,
      data: { url, error: String(error) },
      message: `Browse failed: ${error}`,
      validationPassed: false,
    };
  }
}

export async function realDocumentCreate(input: { title: string; content: string; type: string; prompt?: string; audience?: string; language?: string; professional?: boolean }): Promise<RealToolResult> {
  const { title, content, type } = input;

  try {
    ensureArtifactsDir();
    const sanitizedTitle = title.replace(/[^a-zA-Z0-9_-]/g, "_").slice(0, 50);
    const filename = `${sanitizedTitle}_${Date.now()}.${type}`;
    const filePath = path.join(ARTIFACTS_DIR, filename);

    let mimeType = "text/plain";

    const officeTypeMap: Record<string, "word" | "excel" | "ppt"> = {
      docx: "word",
      xlsx: "excel",
      pptx: "ppt",
    };

    const officeType = officeTypeMap[type];
    if (officeType && input.professional !== false) {
      const generated = await generateProfessionalOfficeDocument({
        type: officeType,
        title,
        prompt: toProfessionalOfficePrompt(input),
        audience: input.audience,
        language: input.language,
      });

      mimeType = generated.mimeType;
      fs.writeFileSync(filePath, generated.buffer);
    } else if (type === "docx" || type === "pdf") {
      const documentService = EnterpriseDocumentService.create("professional");
      const sections = buildDocumentSectionsFromContent(title, content);
      const documentResult = await documentService.generateDocument({
        type: type === "docx" ? "docx" : "pdf",
        title,
        author: "ILIAGPT AI",
        sections,
        options: {
          includeTableOfContents: sections.length > 1,
          includePageNumbers: true,
          includeHeader: true,
          includeFooter: true,
        },
      });

      if (!documentResult.success || !documentResult.buffer) {
        throw new Error(documentResult.error || `Unable to generate ${type.toUpperCase()} document`);
      }

      mimeType = documentResult.mimeType;
      fs.writeFileSync(filePath, documentResult.buffer);
    } else {
      let fileContent = content;
      if (type === "md") {
        mimeType = "text/markdown";
        fileContent = `# ${title}\n\n${content}`;
      } else if (type === "txt") {
        mimeType = "text/plain";
        fileContent = `${title}\n${"=".repeat(title.length)}\n\n${content}`;
      }

      fs.writeFileSync(filePath, fileContent, "utf-8");
    }

    const stats = fs.statSync(filePath);
    const isValid = fs.existsSync(filePath) && stats.size > 0;

    return {
      success: true,
      data: {
        documentId: crypto.randomUUID(),
        title,
        type,
        filePath,
        mimeType,
        fileSize: stats.size,
        created: new Date().toISOString(),
      },
      message: `Created document "${title}" at ${filePath}`,
      artifacts: [filePath],
      validationPassed: isValid,
    };
  } catch (error) {
    return {
      success: false,
      data: { title, error: String(error) },
      message: `Document creation failed: ${error}`,
      validationPassed: false,
    };
  }
}

export async function realPdfGenerate(input: { title: string; content: string; outputPath?: string }): Promise<RealToolResult> {
  const { title, content, outputPath } = input;

  try {
    ensureArtifactsDir();
    const sanitizedTitle = title.replace(/[^a-zA-Z0-9_-]/g, "_").slice(0, 50);
    const filename = outputPath || path.join(ARTIFACTS_DIR, `${sanitizedTitle}_${Date.now()}.pdf`);

    const dir = path.dirname(filename);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }

    const documentService = EnterpriseDocumentService.create("professional");
    const sections = buildDocumentSectionsFromContent(title, content);
    const pdfResult = await documentService.generateDocument({
      type: "pdf",
      title,
      author: "ILIAGPT AI",
      sections,
      options: {
        includePageNumbers: true,
        includeHeader: true,
        includeFooter: true,
      },
    });

    if (!pdfResult.success || !pdfResult.buffer) {
      throw new Error(pdfResult.error || "Unable to generate PDF");
    }

    fs.writeFileSync(filename, pdfResult.buffer);

    const stats = fs.statSync(filename);
    const isValid = fs.existsSync(filename) && stats.size > 100;

    return {
      success: true,
      data: {
        pdfId: crypto.randomUUID(),
        title,
        filePath: filename,
        mimeType: "application/pdf",
        fileSize: stats.size,
        pageCount: 1,
        created: new Date().toISOString(),
      },
      message: `Generated PDF "${title}" at ${filename}`,
      artifacts: [filename],
      validationPassed: isValid,
    };
  } catch (error) {
    return {
      success: false,
      data: { title, error: String(error) },
      message: `PDF generation failed: ${error}`,
      validationPassed: false,
    };
  }
}

export async function realDataAnalyze(input: { data: unknown[]; operation: string }): Promise<RealToolResult> {
  const { data, operation } = input;

  try {
    if (!Array.isArray(data) || data.length === 0) {
      return {
        success: false,
        data: { error: "Data must be a non-empty array" },
        message: "Invalid data input",
        validationPassed: false,
      };
    }

    const numericData = data.map(d => {
      if (typeof d === "number") return d;
      if (typeof d === "object" && d !== null) {
        const vals = Object.values(d).filter(v => typeof v === "number");
        return vals.length > 0 ? vals[0] : 0;
      }
      return Number(d) || 0;
    });

    const sum = numericData.reduce((a, b) => a + b, 0);
    const mean = sum / numericData.length;
    const sorted = [...numericData].sort((a, b) => a - b);
    const median = sorted.length % 2 === 0
      ? (sorted[sorted.length / 2 - 1] + sorted[sorted.length / 2]) / 2
      : sorted[Math.floor(sorted.length / 2)];
    const min = Math.min(...numericData);
    const max = Math.max(...numericData);
    const variance = numericData.reduce((acc, val) => acc + Math.pow(val - mean, 2), 0) / numericData.length;
    const stdDev = Math.sqrt(variance);

    const result = {
      count: numericData.length,
      sum: Number(sum.toFixed(4)),
      mean: Number(mean.toFixed(4)),
      median: Number(median.toFixed(4)),
      min,
      max,
      range: max - min,
      variance: Number(variance.toFixed(4)),
      stdDev: Number(stdDev.toFixed(4)),
      operation,
      timestamp: new Date().toISOString(),
    };

    const isValid = typeof result.mean === "number" && !isNaN(result.mean) && result.count > 0;

    return {
      success: true,
      data: result,
      message: `Analyzed ${numericData.length} data points: mean=${result.mean}, median=${result.median}`,
      validationPassed: isValid,
    };
  } catch (error) {
    return {
      success: false,
      data: { error: String(error) },
      message: `Data analysis failed: ${error}`,
      validationPassed: false,
    };
  }
}

export async function realHashGenerate(input: { data: string; algorithm: string }): Promise<RealToolResult> {
  const { data, algorithm } = input;

  try {
    const hash = crypto.createHash(algorithm).update(data).digest("hex");

    return {
      success: true,
      data: {
        hash,
        algorithm,
        inputLength: data.length,
        timestamp: new Date().toISOString(),
      },
      message: `Generated ${algorithm} hash`,
      validationPassed: hash.length > 0,
    };
  } catch (error) {
    return {
      success: false,
      data: { error: String(error) },
      message: `Hash generation failed: ${error}`,
      validationPassed: false,
    };
  }
}

export async function realSlidesCreate(input: { title: string; slides: any[]; template?: string }): Promise<RealToolResult> {
  const { title, slides, template } = input;
  try {
    // Dynamic import to avoid circular dependencies or load issues if not needed
    const { documentCreator } = await import("../sandbox/documentCreator");

    // Map generic input to strongly typed DocumentSlide
    const typedSlides = slides.map(s => ({
      title: s.title,
      content: s.content,
      bullets: s.bullets,
      imageUrl: s.imageUrl,
      // chart: s.chart // Pending complex mapping if needed
    }));

    const result = await documentCreator.createPptx(title, typedSlides, template);

    return {
      success: result.success,
      data: result.data || {},
      message: result.message,
      artifacts: result.filesCreated,
      validationPassed: result.success,
    };
  } catch (error) {
    return {
      success: false,
      data: { error: String(error) },
      message: `Failed to create slides: ${error}`,
      validationPassed: false,
    };
  }
}

export async function realSpreadsheetCreate(input: { title: string; sheets: any[] }): Promise<RealToolResult> {
  const { title, sheets } = input;
  try {
    const { documentCreator } = await import("../sandbox/documentCreator");

    const result = await documentCreator.createXlsx(title, sheets);

    return {
      success: result.success,
      data: result.data || {},
      message: result.message,
      artifacts: result.filesCreated,
      validationPassed: result.success,
    };
  } catch (error) {
    return {
      success: false,
      data: { error: String(error) },
      message: `Failed to create spreadsheet: ${error}`,
      validationPassed: false,
    };
  }
}

export const REAL_TOOL_HANDLERS: Record<string, (input: any) => Promise<RealToolResult>> = {
  web_search: realWebSearch,
  browse_url: realBrowseUrl,
  document_create: realDocumentCreate,
  pdf_generate: realPdfGenerate,
  slides_create: realSlidesCreate,
  spreadsheet_create: realSpreadsheetCreate,
  data_analyze: realDataAnalyze,
  hash: realHashGenerate,
};

export function hasRealHandler(toolName: string): boolean {
  return toolName in REAL_TOOL_HANDLERS;
}

export async function executeRealHandler(toolName: string, input: unknown): Promise<RealToolResult | null> {
  const handler = REAL_TOOL_HANDLERS[toolName];
  if (!handler) return null;
  return handler(input);
}
