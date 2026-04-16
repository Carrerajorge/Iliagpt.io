import { Router } from "express";
import fs from "fs/promises";
import os from "os";
import path from "path";
import { v4 as uuidv4 } from "uuid";
import { executeLocalControlRequest } from "./chatAiRouter";

const router = Router();

function extractFolderName(input: string): string | null {
  const prompt = String(input || "").trim();
  if (!prompt) return null;

  const patterns = [
    /(?:crea|crear|creame|haz|genera)\s+(?:una\s+)?(?:carpeta|caroeta|carepta)(?:\s+en\s+mi\s+(?:escritorio|excritorio))?(?:\s+(?:llamada|con\s+nombre))?\s+["']?([^"'\n]{1,120})["']?/i,
    /^(?:\/)?mkdir\s+["']?([^"'\n]{1,120})["']?$/i,
  ];

  for (const re of patterns) {
    const m = prompt.match(re);
    const candidate = m?.[1]?.trim().replace(/[.,;:!?]+$/g, "").trim();
    if (candidate) return candidate;
  }
  return null;
}

router.post("/local/create-folder", async (req, res) => {
  try {
    const bodyName = typeof req.body?.name === "string" ? req.body.name.trim() : "";
    const bodyPrompt = typeof req.body?.prompt === "string" ? req.body.prompt : "";
    const name = bodyName || extractFolderName(bodyPrompt);

    if (!name) {
      return res.status(400).json({ success: false, error: "Folder name is required" });
    }

    const invalid = /[\\/:*?"<>|]/.test(name) || name.includes("..");
    if (invalid) {
      return res.status(400).json({ success: false, error: "Invalid folder name" });
    }

    const folderPath = path.join(os.homedir(), "Desktop", name);
    await fs.mkdir(folderPath, { recursive: true });
    await fs.appendFile(
      path.join(os.homedir(), ".iliagpt-control-audit.log"),
      `${new Date().toISOString()} local_control_router mkdir path=${folderPath}\n`,
      "utf-8"
    );

    return res.json({
      success: true,
      name,
      path: folderPath,
      message: `Listo. Carpeta creada en tu escritorio: ${folderPath}`,
    });
  } catch (error: any) {
    return res.status(500).json({ success: false, error: error?.message || "Failed to create folder" });
  }
});

/**
 * General-purpose local control endpoint.
 * Accepts either:
 *   { command: "shell", args: ["ls -la"] }           — structured form
 *   { prompt: "ejecuta el comando ls -la" }           — natural language
 *   { prompt: "/local shell ls -la" }                 — prefixed form
 *
 * The frontend uses this to execute ANY local command (rm, read, write, shell, ls, cp, etc.)
 * without going through the LLM stream.
 */
router.post("/local/exec", async (req, res) => {
  try {
    const body = req.body || {};
    let inputText = "";

    // Option 1: Structured command + args
    if (typeof body.command === "string" && body.command.trim()) {
      const cmd = body.command.trim().toLowerCase();
      const argsArr = Array.isArray(body.args) ? body.args : [];
      const argsStr = argsArr.map((a: any) => String(a)).join(" ");
      const confirmFlag = body.confirm ? " confirmar" : "";
      inputText = `/local ${cmd} ${argsStr}${confirmFlag}`.trim();
    }
    // Option 2: Raw prompt (natural language or prefixed)
    else if (typeof body.prompt === "string" && body.prompt.trim()) {
      inputText = body.prompt.trim();
    }

    if (!inputText) {
      return res.status(400).json({
        success: false,
        error: "Se requiere 'command' o 'prompt'.",
        usage: {
          structured: { command: "shell", args: ["ls -la ~/Desktop"] },
          natural: { prompt: "ejecuta el comando ls -la" },
          prefixed: { prompt: "/local shell ls -la" },
        },
      });
    }

    const requestId = `local_exec_${uuidv4().replace(/-/g, "").slice(0, 12)}`;
    const userId = (req as any).userId || (req as any).session?.userId || "anonymous";

    const result = await executeLocalControlRequest(inputText, { requestId, userId });

    if (!result.handled) {
      return res.status(400).json({
        success: false,
        error: "No se detecto un comando local valido en el input.",
        input: inputText,
      });
    }

    return res.status(result.statusCode).json({
      success: result.ok,
      code: result.code,
      message: result.message,
      payload: result.payload || {},
    });
  } catch (error: any) {
    return res.status(500).json({
      success: false,
      error: error?.message || "Error al ejecutar comando local.",
    });
  }
});

export function createLocalControlRouter() {
  return router;
}
