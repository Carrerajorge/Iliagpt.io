import { Router, Request, Response } from "express";
import { createScientificSearchOrchestrator } from "../services/scientificSearchOrchestrator";
import { scientificExcelGenerator } from "../services/scientificExcelGenerator";
import { scientificWordGenerator } from "../services/scientificWordGenerator";
import { SearchProgressEvent, ScientificSearchResult } from "@shared/scientificArticleSchema";

const router = Router();

router.get("/search/stream", async (req: Request, res: Response) => {
  const query = req.query.q as string;
  const maxResults = parseInt(req.query.maxResults as string) || 50;
  const sources = (req.query.sources as string)?.split(",") || ["all"];
  const yearFrom = req.query.yearFrom ? parseInt(req.query.yearFrom as string) : undefined;
  const yearTo = req.query.yearTo ? parseInt(req.query.yearTo as string) : undefined;

  if (!query) {
    return res.status(400).json({ error: "Query parameter 'q' is required" });
  }

  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");
  res.setHeader("X-Accel-Buffering", "no");

  const sendEvent = (event: string, data: any) => {
    res.write(`event: ${event}\n`);
    res.write(`data: ${JSON.stringify(data)}\n\n`);
  };

  const orchestrator = createScientificSearchOrchestrator();

  try {
    const result = await orchestrator.search(
      query,
      {
        maxResults,
        sources: sources as any,
        yearFrom,
        yearTo,
      },
      (event: SearchProgressEvent) => {
        sendEvent("progress", event);
      }
    );

    sendEvent("complete", result);
  } catch (error) {
    sendEvent("error", {
      message: error instanceof Error ? error.message : "Error desconocido",
    });
  } finally {
    res.end();
  }
});

router.post("/search", async (req: Request, res: Response) => {
  try {
    const { query, maxResults = 50, sources = ["all"], yearFrom, yearTo, languages, openAccessOnly } = req.body;

    if (!query) {
      return res.status(400).json({ error: "Query is required" });
    }

    const orchestrator = createScientificSearchOrchestrator();
    
    const result = await orchestrator.search(query, {
      maxResults,
      sources,
      yearFrom,
      yearTo,
      languages,
      openAccessOnly,
    });

    res.json(result);
  } catch (error) {
    console.error("[Scientific Search] Error:", error);
    res.status(500).json({ 
      error: "Error en la búsqueda científica",
      details: error instanceof Error ? error.message : "Error desconocido"
    });
  }
});

router.post("/export/excel", async (req: Request, res: Response) => {
  try {
    const { articles, query } = req.body;

    if (!articles || !Array.isArray(articles)) {
      return res.status(400).json({ error: "Articles array is required" });
    }

    const buffer = await scientificExcelGenerator.generateExcel(articles, query || "Búsqueda científica");

    res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
    res.setHeader("Content-Disposition", `attachment; filename="articulos_cientificos_${Date.now()}.xlsx"`);
    res.send(buffer);
  } catch (error) {
    console.error("[Scientific Export] Excel error:", error);
    res.status(500).json({ error: "Error generando Excel" });
  }
});

router.post("/export/word", async (req: Request, res: Response) => {
  try {
    const { articles, query, includeAbstracts = true } = req.body;

    if (!articles || !Array.isArray(articles)) {
      return res.status(400).json({ error: "Articles array is required" });
    }

    const buffer = await scientificWordGenerator.generateWord(articles, query || "Búsqueda científica", includeAbstracts);

    res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.wordprocessingml.document");
    res.setHeader("Content-Disposition", `attachment; filename="informe_cientifico_${Date.now()}.docx"`);
    res.send(buffer);
  } catch (error) {
    console.error("[Scientific Export] Word error:", error);
    res.status(500).json({ error: "Error generando Word" });
  }
});

export default router;
