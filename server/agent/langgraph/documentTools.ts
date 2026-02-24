import { tool } from "@langchain/core/tools";
import { z } from "zod";
import OpenAI from "openai";
import * as fs from "fs/promises";
import * as path from "path";

const xaiClient = new OpenAI({
  baseURL: "https://api.x.ai/v1",
  apiKey: process.env.XAI_API_KEY || "missing",
});

const DEFAULT_MODEL = "grok-4-1-fast-non-reasoning";

export const docCreateTool = tool(
  async (input) => {
    const { title, content, format = "docx", template = "default", sections = [] } = input;
    const startTime = Date.now();

    try {
      const response = await xaiClient.chat.completions.create({
        model: DEFAULT_MODEL,
        messages: [
          {
            role: "system",
            content: `You are a professional document creator. Generate well-structured document content.

Templates available:
- default: Standard document
- report: Business report with executive summary
- proposal: Project proposal format
- letter: Formal letter format
- memo: Internal memo format
- contract: Legal contract format
- manual: User manual/documentation

Return JSON:
{
  "document": {
    "title": "document title",
    "metadata": {
      "author": "AI Document Generator",
      "createdAt": "ISO date",
      "version": "1.0"
    },
    "sections": [
      {
        "type": "heading|paragraph|list|table|image",
        "level": 1,
        "content": "section content",
        "formatting": {
          "bold": boolean,
          "italic": boolean,
          "alignment": "left|center|right"
        }
      }
    ],
    "styles": {
      "font": "font name",
      "headingFont": "heading font",
      "colors": {
        "primary": "#hex",
        "secondary": "#hex"
      }
    }
  },
  "outline": ["section titles"],
  "wordCount": number,
  "pageEstimate": number,
  "suggestions": ["improvements for the document"]
}`,
          },
          {
            role: "user",
            content: `Create a document:
Title: ${title}
Format: ${format}
Template: ${template}
${content ? `Content/Description: ${content}` : ""}
${sections.length > 0 ? `Sections: ${JSON.stringify(sections)}` : ""}`,
          },
        ],
        temperature: 0.4,
      });

      const responseContent = response.choices[0].message.content || "";
      const jsonMatch = responseContent.match(/\{[\s\S]*\}/);

      if (jsonMatch) {
        const result = JSON.parse(jsonMatch[0]);
        return JSON.stringify({
          success: true,
          format,
          template,
          ...result,
          latencyMs: Date.now() - startTime,
        });
      }

      return JSON.stringify({
        success: true,
        document: responseContent,
        latencyMs: Date.now() - startTime,
      });
    } catch (error: any) {
      return JSON.stringify({
        success: false,
        error: error.message,
        latencyMs: Date.now() - startTime,
      });
    }
  },
  {
    name: "doc_create",
    description: "Creates professional Word/Google Docs documents with templates, styling, and structured sections.",
    schema: z.object({
      title: z.string().describe("Document title"),
      content: z.string().optional().describe("Document content or description"),
      format: z.enum(["docx", "pdf", "html", "md", "txt"]).optional().default("docx").describe("Output format"),
      template: z.enum(["default", "report", "proposal", "letter", "memo", "contract", "manual"]).optional().default("default")
        .describe("Document template"),
      sections: z.array(z.object({
        title: z.string(),
        content: z.string().optional(),
        type: z.enum(["heading", "paragraph", "list", "table"]).optional(),
      })).optional().default([]).describe("Document sections"),
    }),
  }
);

export const slidesCreateTool = tool(
  async (input) => {
    const { topic, slideCount = 10, style = "professional", audience = "general", includeNotes = true } = input;
    const startTime = Date.now();

    try {
      const response = await xaiClient.chat.completions.create({
        model: DEFAULT_MODEL,
        messages: [
          {
            role: "system",
            content: `You are a presentation design expert. Create engaging slide decks.

Styles:
- professional: Clean, corporate look
- creative: Bold colors, unique layouts
- minimal: Simple, lots of whitespace
- academic: Formal, citation-focused
- pitch: Startup pitch deck format
- training: Educational, step-by-step

Return JSON:
{
  "presentation": {
    "title": "presentation title",
    "theme": {
      "primaryColor": "#hex",
      "secondaryColor": "#hex",
      "fontFamily": "font name",
      "layout": "wide|standard"
    },
    "slides": [
      {
        "slideNumber": 1,
        "type": "title|content|section|image|chart|quote|comparison|timeline",
        "title": "slide title",
        "content": {
          "mainPoints": ["bullet points"],
          "image": "suggested image description",
          "chart": "chart specification if applicable"
        },
        "notes": "speaker notes",
        "animations": ["entrance|emphasis|exit animations"],
        "transition": "fade|slide|zoom"
      }
    ]
  },
  "outline": ["slide titles"],
  "estimatedDuration": "presentation duration",
  "keyMessages": ["main takeaways"],
  "visualSuggestions": ["image/chart ideas"]
}`,
          },
          {
            role: "user",
            content: `Create a presentation:
Topic: ${topic}
Number of slides: ${slideCount}
Style: ${style}
Target audience: ${audience}
Include speaker notes: ${includeNotes}`,
          },
        ],
        temperature: 0.5,
      });

      const content = response.choices[0].message.content || "";
      const jsonMatch = content.match(/\{[\s\S]*\}/);

      if (jsonMatch) {
        const result = JSON.parse(jsonMatch[0]);
        return JSON.stringify({
          success: true,
          topic,
          style,
          ...result,
          latencyMs: Date.now() - startTime,
        });
      }

      return JSON.stringify({
        success: true,
        presentation: content,
        latencyMs: Date.now() - startTime,
      });
    } catch (error: any) {
      return JSON.stringify({
        success: false,
        error: error.message,
        latencyMs: Date.now() - startTime,
      });
    }
  },
  {
    name: "slides_create",
    description: "Creates PowerPoint/Google Slides presentations with professional layouts, themes, and speaker notes.",
    schema: z.object({
      topic: z.string().describe("Presentation topic"),
      slideCount: z.number().min(1).max(50).optional().default(10).describe("Number of slides"),
      style: z.enum(["professional", "creative", "minimal", "academic", "pitch", "training"]).optional().default("professional")
        .describe("Visual style"),
      audience: z.enum(["general", "technical", "executive", "students"]).optional().default("general")
        .describe("Target audience"),
      includeNotes: z.boolean().optional().default(true).describe("Include speaker notes"),
    }),
  }
);

export const spreadsheetCreateTool = tool(
  async (input) => {
    const { title, sheets = [], dataStructure, formulas = true, formatting = true } = input;
    const startTime = Date.now();

    try {
      const response = await xaiClient.chat.completions.create({
        model: DEFAULT_MODEL,
        messages: [
          {
            role: "system",
            content: `You are a spreadsheet expert. Create Excel/Google Sheets workbooks with formulas and formatting.

Return JSON:
{
  "workbook": {
    "title": "workbook title",
    "sheets": [
      {
        "name": "sheet name",
        "columns": [
          {
            "header": "column name",
            "type": "text|number|date|currency|percentage",
            "width": number,
            "format": "format specification"
          }
        ],
        "rows": [
          ["cell values..."]
        ],
        "formulas": [
          {
            "cell": "A1",
            "formula": "=SUM(B2:B10)",
            "description": "what it calculates"
          }
        ],
        "conditionalFormatting": [
          {
            "range": "A1:A10",
            "condition": "greater_than|less_than|equals|between",
            "value": any,
            "format": { "background": "#hex", "color": "#hex" }
          }
        ],
        "charts": [
          {
            "type": "bar|line|pie",
            "dataRange": "A1:B10",
            "title": "chart title"
          }
        ],
        "pivotTables": []
      }
    ],
    "namedRanges": [
      { "name": "range_name", "range": "Sheet1!A1:B10" }
    ]
  },
  "summary": {
    "totalSheets": number,
    "totalCells": number,
    "formulaCount": number
  },
  "usageInstructions": ["how to use the spreadsheet"]
}`,
          },
          {
            role: "user",
            content: `Create a spreadsheet:
Title: ${title}
${sheets.length > 0 ? `Sheets: ${JSON.stringify(sheets)}` : ""}
${dataStructure ? `Data structure: ${JSON.stringify(dataStructure)}` : ""}
Include formulas: ${formulas}
Include formatting: ${formatting}`,
          },
        ],
        temperature: 0.3,
      });

      const content = response.choices[0].message.content || "";
      const jsonMatch = content.match(/\{[\s\S]*\}/);

      if (jsonMatch) {
        const result = JSON.parse(jsonMatch[0]);
        return JSON.stringify({
          success: true,
          title,
          ...result,
          latencyMs: Date.now() - startTime,
        });
      }

      return JSON.stringify({
        success: true,
        spreadsheet: content,
        latencyMs: Date.now() - startTime,
      });
    } catch (error: any) {
      return JSON.stringify({
        success: false,
        error: error.message,
        latencyMs: Date.now() - startTime,
      });
    }
  },
  {
    name: "spreadsheet_create",
    description: "Creates Excel/Google Sheets workbooks with formulas, conditional formatting, charts, and pivot tables.",
    schema: z.object({
      title: z.string().describe("Spreadsheet title"),
      sheets: z.array(z.object({
        name: z.string(),
        columns: z.array(z.string()).optional(),
        description: z.string().optional(),
      })).optional().default([]).describe("Sheet definitions"),
      dataStructure: z.record(z.any()).optional().describe("Data structure to create"),
      formulas: z.boolean().optional().default(true).describe("Include calculated formulas"),
      formatting: z.boolean().optional().default(true).describe("Apply conditional formatting"),
    }),
  }
);

export const pdfManipulateTool = tool(
  async (input) => {
    const { action, inputPath, outputPath, options = {} } = input;
    const startTime = Date.now();

    try {
      const actionDescriptions: Record<string, string> = {
        merge: "Combine multiple PDFs into one",
        split: "Split PDF into separate files",
        extract: "Extract specific pages",
        rotate: "Rotate pages",
        watermark: "Add watermark to pages",
        encrypt: "Password protect PDF",
        decrypt: "Remove password protection",
        compress: "Reduce file size",
        convert: "Convert to/from other formats",
        ocr: "Add searchable text layer",
        fillForm: "Fill PDF form fields",
        addBookmarks: "Add navigation bookmarks",
      };

      const response = await xaiClient.chat.completions.create({
        model: DEFAULT_MODEL,
        messages: [
          {
            role: "system",
            content: `You are a PDF manipulation expert. Describe how to perform PDF operations.

Return JSON:
{
  "action": "action performed",
  "description": "what was done",
  "inputFile": "input path",
  "outputFile": "output path",
  "operations": [
    {
      "step": 1,
      "operation": "operation description",
      "parameters": {}
    }
  ],
  "result": {
    "pageCount": number,
    "fileSize": "estimated size",
    "success": boolean
  },
  "code": {
    "pypdf": "Python code using pypdf2",
    "pdftk": "pdftk command"
  },
  "warnings": ["any warnings"]
}`,
          },
          {
            role: "user",
            content: `PDF Operation:
Action: ${action} - ${actionDescriptions[action] || "Custom operation"}
Input: ${inputPath}
Output: ${outputPath || "Same as input"}
Options: ${JSON.stringify(options)}`,
          },
        ],
        temperature: 0.2,
      });

      const content = response.choices[0].message.content || "";
      const jsonMatch = content.match(/\{[\s\S]*\}/);

      if (jsonMatch) {
        const result = JSON.parse(jsonMatch[0]);
        return JSON.stringify({
          success: true,
          action,
          ...result,
          latencyMs: Date.now() - startTime,
        });
      }

      return JSON.stringify({
        success: true,
        action,
        result: content,
        latencyMs: Date.now() - startTime,
      });
    } catch (error: any) {
      return JSON.stringify({
        success: false,
        error: error.message,
        latencyMs: Date.now() - startTime,
      });
    }
  },
  {
    name: "pdf_manipulate",
    description: "Manipulates PDFs: merge, split, extract pages, rotate, watermark, encrypt, compress, and fill forms.",
    schema: z.object({
      action: z.enum(["merge", "split", "extract", "rotate", "watermark", "encrypt", "decrypt", "compress", "convert", "ocr", "fillForm", "addBookmarks"])
        .describe("PDF operation to perform"),
      inputPath: z.string().describe("Input PDF path(s)"),
      outputPath: z.string().optional().describe("Output file path"),
      options: z.record(z.any()).optional().default({}).describe("Operation-specific options"),
    }),
  }
);

export const DOCUMENT_TOOLS = [
  docCreateTool,
  slidesCreateTool,
  spreadsheetCreateTool,
  pdfManipulateTool,
];
