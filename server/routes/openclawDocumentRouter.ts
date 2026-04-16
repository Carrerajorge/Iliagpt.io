/** OpenClaw Document Router — upload, analyze, and render documents. Mount: /api/openclaw/documents */
import { Router, Request, Response } from "express";
import multer from "multer";
import { documentAnalyzer, type DocumentAnalysis } from "../services/openclawDocumentAnalyzer";
import { getUserId } from "../types/express";
import { llmGateway } from "../lib/llmGateway";

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 500 * 1024 * 1024 } }); // 500MB

/** Per-user analysis cache: userId -> (docId -> analysis) */
const store = new Map<string, Map<string, DocumentAnalysis>>();

function put(a: DocumentAnalysis): void {
  if (!store.has(a.userId)) store.set(a.userId, new Map());
  store.get(a.userId)!.set(a.id, a);
}

function get(userId: string, docId: string): DocumentAnalysis | undefined {
  return store.get(userId)?.get(docId);
}

export function createOpenClawDocumentRouter(): Router {
  const router = Router();

  router.post("/upload", upload.single("file"), async (req: Request, res: Response) => {
    try {
      const userId = getUserId(req) || "anonymous";
      if (!req.file) return res.status(400).json({ error: "No file provided. Use multipart field 'file'." });
      const analysis = await documentAnalyzer.analyze(req.file.buffer, req.file.originalname, userId);
      put(analysis);
      res.json(analysis);
    } catch (err: any) {
      console.error("[OpenClawDoc] Upload failed:", err);
      res.status(500).json({ error: err.message || "Upload failed" });
    }
  });

  router.post("/analyze", async (req: Request, res: Response) => {
    try {
      const userId = getUserId(req) || "anonymous";
      const { documentId, question } = req.body as { documentId?: string; question?: string };
      if (!documentId || !question) return res.status(400).json({ error: "'documentId' and 'question' required." });
      const doc = get(userId, documentId);
      if (!doc) return res.status(404).json({ error: "Document not found. Upload it first." });

      const response = await llmGateway.chat([
        { role: "system" as const, content: "You are a document analysis assistant. Answer based strictly on the provided document. Include citations (quote relevant passages)." },
        { role: "user" as const, content: `Document: "${doc.filename}" (${doc.structure.type})\n\n---\n${doc.extractedText.slice(0, 60_000)}\n---\n\nQuestion: ${question}` },
      ], { userId });

      const citations: string[] = [];
      const re = /"([^"]{10,200})"/g;
      let m: RegExpExecArray | null;
      while ((m = re.exec(response.content)) !== null) citations.push(m[1]);
      res.json({ analysis: response.content, citations });
    } catch (err: any) {
      console.error("[OpenClawDoc] Analyze failed:", err);
      res.status(500).json({ error: err.message || "Analysis failed" });
    }
  });

  router.get("/:id", (req: Request, res: Response) => {
    const userId = getUserId(req) || "anonymous";
    const doc = get(userId, req.params.id);
    if (!doc) return res.status(404).json({ error: "Document not found" });
    res.json(doc);
  });

  router.post("/render", async (req: Request, res: Response) => {
    try {
      const { content, format } = req.body as { content?: string; format?: "latex" | "html" | "markdown" };
      if (!content) return res.status(400).json({ error: "'content' is required." });
      const katexModule = await import("katex");
      const renderToString = (katexModule as any).renderToString || (katexModule as any).default?.renderToString;
      if (typeof renderToString !== "function") return res.status(500).json({ error: "KaTeX unavailable" });
      const opts = (display: boolean) => ({ displayMode: display, throwOnError: false, output: "htmlAndMathml" as const, strict: "ignore" as const });
      let rendered = content.replace(/\$\$([\s\S]+?)\$\$/g, (_m, e: string) => {
        try { return renderToString(e.trim(), opts(true)); } catch { return `$$${e}$$`; }
      });
      rendered = rendered.replace(/(?<!\$)\$(?!\$)(.+?)(?<!\$)\$(?!\$)/g, (_m, e: string) => {
        try { return renderToString(e.trim(), opts(false)); } catch { return `$${e}$`; }
      });
      if (format === "html" || format === "latex") rendered = `<div class="openclaw-rendered">${rendered}</div>`;
      res.json({ rendered });
    } catch (err: any) {
      console.error("[OpenClawDoc] Render failed:", err);
      res.status(500).json({ error: err.message || "Render failed" });
    }
  });

  return router;
}
