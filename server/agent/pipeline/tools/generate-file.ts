import { ToolDefinition, ExecutionContext, ToolResult, Artifact } from "../types";
import { ObjectStorageService } from "../../../objectStorage";
import { generateWordFromMarkdown } from "../../../services/markdownToDocx";
import crypto from "crypto";

const objectStorage = new ObjectStorageService();

export const generateFileTool: ToolDefinition = {
  id: "generate_file",
  name: "Generate File",
  description: "Generate a file with specified content and format (text, markdown, JSON, CSV, HTML, Word). For Word documents, provide content in Markdown format.",
  category: "file",
  capabilities: ["generate", "create", "file", "document", "export", "save", "word", "docx"],
  inputSchema: {
    content: { type: "string", description: "The content to write to the file. For Word documents, use Markdown format.", required: true },
    filename: { type: "string", description: "The filename to use", required: true },
    format: { 
      type: "string", 
      description: "The file format: text, markdown, json, csv, html, or word (.docx)",
      enum: ["text", "markdown", "json", "csv", "html", "word"],
      default: "text"
    },
    upload: { type: "boolean", description: "Whether to upload to storage", default: true }
  },
  outputSchema: {
    filename: { type: "string", description: "The generated filename" },
    storagePath: { type: "string", description: "The storage path if uploaded" },
    size: { type: "number", description: "The file size in bytes" }
  },
  
  async execute(context: ExecutionContext, params: Record<string, any>): Promise<ToolResult> {
    const { content, filename, format = "text", upload = true } = params;
    
    if (!content) {
      return {
        success: false,
        error: "No content provided"
      };
    }

    try {
      const mimeTypes: Record<string, string> = {
        text: "text/plain",
        markdown: "text/markdown",
        json: "application/json",
        csv: "text/csv",
        html: "text/html",
        word: "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
      };

      const extensions: Record<string, string> = {
        text: ".txt",
        markdown: ".md",
        json: ".json",
        csv: ".csv",
        html: ".html",
        word: ".docx"
      };

      const mimeType = mimeTypes[format] || "text/plain";
      const extension = extensions[format] || ".txt";
      const finalFilename = filename.includes(".") ? filename : `${filename}${extension}`;
      
      let contentBuffer: Buffer;
      let processedContent = content;
      
      if (format === "word") {
        const title = filename.replace(/\.(docx|doc)$/i, "").replace(/[-_]/g, " ");
        contentBuffer = await generateWordFromMarkdown(title, content);
        processedContent = content;
      } else {
        if (format === "json" && typeof content === "object") {
          processedContent = JSON.stringify(content, null, 2);
        }
        contentBuffer = Buffer.from(processedContent, "utf-8");
      }
      const size = contentBuffer.length;

      const artifacts: Artifact[] = [];
      let storagePath: string | undefined;

      if (upload) {
        try {
          const { uploadURL, storagePath: path } = await objectStorage.getObjectEntityUploadURLWithPath();
          await fetch(uploadURL, {
            method: "PUT",
            headers: { "Content-Type": mimeType },
            body: contentBuffer
          });
          storagePath = path;
        } catch (e) {
          console.error("Failed to upload file:", e);
        }
      }

      const artifactType = format === "word" ? "document" : 
                          format === "json" ? "json" : 
                          format === "markdown" ? "markdown" : 
                          format === "html" ? "html" : "text";
      
      artifacts.push({
        id: crypto.randomUUID(),
        type: artifactType,
        name: finalFilename,
        content: format === "word" ? contentBuffer.toString("base64") : processedContent.slice(0, 100000),
        storagePath,
        mimeType,
        size,
        metadata: { format, isBase64: format === "word" }
      });

      return {
        success: true,
        data: {
          filename: finalFilename,
          storagePath,
          size,
          mimeType
        },
        artifacts,
        metadata: {
          filename: finalFilename,
          format,
          size
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
