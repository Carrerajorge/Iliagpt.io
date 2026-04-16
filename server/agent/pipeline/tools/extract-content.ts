import { ToolDefinition, ExecutionContext, ToolResult, Artifact } from "../types";
import { extractWithReadability, summarizeForLLM } from "../../extractor";
import crypto from "crypto";

export const extractContentTool: ToolDefinition = {
  id: "extract_content",
  name: "Extract Content",
  description: "Extract and process content from HTML, extracting main text, links, images, and metadata",
  category: "data",
  capabilities: ["extract", "parse", "scrape", "content", "text", "readability"],
  inputSchema: {
    html: { type: "string", description: "The HTML content to extract from", required: true },
    url: { type: "string", description: "The source URL for context" },
    extractLinks: { type: "boolean", description: "Whether to extract links", default: true },
    extractImages: { type: "boolean", description: "Whether to extract images", default: true },
    summarize: { type: "boolean", description: "Whether to create a summary", default: false },
    maxLength: { type: "number", description: "Maximum content length", default: 50000 }
  },
  outputSchema: {
    title: { type: "string", description: "The page title" },
    textContent: { type: "string", description: "The extracted text content" },
    links: { type: "array", description: "Extracted links" },
    images: { type: "array", description: "Extracted images" },
    summary: { type: "string", description: "Content summary if requested" }
  },
  
  async execute(context: ExecutionContext, params: Record<string, any>): Promise<ToolResult> {
    const { 
      html, 
      url = "https://example.com", 
      extractLinks: shouldExtractLinks = true,
      extractImages: shouldExtractImages = true,
      summarize = false,
      maxLength = 50000
    } = params;
    
    if (!html) {
      return {
        success: false,
        error: "No HTML content provided"
      };
    }

    try {
      const extracted = extractWithReadability(html, url);
      
      if (!extracted) {
        return {
          success: false,
          error: "Could not extract readable content from HTML"
        };
      }

      const artifacts: Artifact[] = [];
      
      const textContent = extracted.textContent.slice(0, maxLength);
      
      artifacts.push({
        id: crypto.randomUUID(),
        type: "text",
        name: `extracted_${extracted.title?.slice(0, 30) || "content"}.txt`,
        content: textContent,
        metadata: {
          title: extracted.title,
          byline: extracted.byline,
          siteName: extracted.siteName,
          length: extracted.length
        }
      });

      const result: any = {
        title: extracted.title,
        byline: extracted.byline,
        siteName: extracted.siteName,
        textContent,
        excerpt: extracted.excerpt,
        length: extracted.length
      };

      if (shouldExtractLinks) {
        result.links = extracted.links.slice(0, 100);
      }

      if (shouldExtractImages) {
        result.images = extracted.images.slice(0, 50);
      }

      if (summarize) {
        result.summary = summarizeForLLM(extracted, 2000);
      }

      return {
        success: true,
        data: result,
        artifacts,
        metadata: {
          title: extracted.title,
          originalLength: extracted.length,
          extractedLength: textContent.length
        }
      };
    } catch (error: any) {
      return {
        success: false,
        error: error.message
      };
    }
  }
};
