import { z } from "zod";
import * as fs from "fs";
import * as path from "path";
import crypto from "crypto";

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

export async function realWebSearch(input: { query: string; maxResults?: number }): Promise<RealToolResult> {
  const { query, maxResults = 5 } = input;

  try {
    const wikiUrl = `https://en.wikipedia.org/w/api.php?action=opensearch&search=${encodeURIComponent(query)}&limit=${maxResults}&format=json&origin=*`;
    const response = await fetch(wikiUrl, {
      headers: {
        "User-Agent": "IliaGPT/1.0 (https://replit.com; E2E Testing)",
      },
    });

    const data = await response.json();

    const titles = data[1] || [];
    const snippets = data[2] || [];
    const urls = data[3] || [];

    const results: Array<{ title: string; url: string; snippet: string }> = [];

    for (let i = 0; i < Math.min(titles.length, maxResults); i++) {
      results.push({
        title: titles[i],
        url: urls[i],
        snippet: snippets[i] || "",
      });
    }

    const isValid = results.length > 0 && results.every(r => r.url && r.url.startsWith("http"));

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
      validationPassed: isValid,
    };
  } catch (error) {
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

export async function realDocumentCreate(input: { title: string; content: string; type: string }): Promise<RealToolResult> {
  const { title, content, type } = input;

  try {
    ensureArtifactsDir();
    const sanitizedTitle = title.replace(/[^a-zA-Z0-9_-]/g, "_").slice(0, 50);
    const filename = `${sanitizedTitle}_${Date.now()}.${type === "docx" ? "txt" : type}`;
    const filePath = path.join(ARTIFACTS_DIR, filename);

    let fileContent = content;
    if (type === "md") {
      fileContent = `# ${title}\n\n${content}`;
    } else if (type === "txt") {
      fileContent = `${title}\n${"=".repeat(title.length)}\n\n${content}`;
    }

    fs.writeFileSync(filePath, fileContent, "utf-8");

    const stats = fs.statSync(filePath);
    const isValid = fs.existsSync(filePath) && stats.size > 0;

    return {
      success: true,
      data: {
        documentId: crypto.randomUUID(),
        title,
        type,
        filePath,
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

    const pdfContent = `%PDF-1.4
1 0 obj
<< /Type /Catalog /Pages 2 0 R >>
endobj
2 0 obj
<< /Type /Pages /Kids [3 0 R] /Count 1 >>
endobj
3 0 obj
<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>
endobj
4 0 obj
<< /Length 200 >>
stream
BT
/F1 24 Tf
50 700 Td
(${title}) Tj
0 -40 Td
/F1 12 Tf
(${content.slice(0, 200).replace(/[()\\]/g, "\\$&")}) Tj
ET
endstream
endobj
5 0 obj
<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>
endobj
xref
0 6
0000000000 65535 f 
0000000009 00000 n 
0000000058 00000 n 
0000000115 00000 n 
0000000266 00000 n 
0000000518 00000 n 
trailer
<< /Size 6 /Root 1 0 R >>
startxref
595
%%EOF`;

    fs.writeFileSync(filename, pdfContent);

    const stats = fs.statSync(filename);
    const isValid = fs.existsSync(filename) && stats.size > 100;

    return {
      success: true,
      data: {
        pdfId: crypto.randomUUID(),
        title,
        filePath: filename,
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
