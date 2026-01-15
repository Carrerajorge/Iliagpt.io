/**
 * MICHAT v3.1 — UX Renderer
 * Renderiza bloques UX con límites y sanitización
 */

import { UXLevel, UXBlock, UXLimits, DefaultLimits } from "./types";

function oneLine(s: string): string {
  return s.replace(/\s+/g, " ").trim();
}

function clip(s: string, maxChars: number): string {
  if (s.length <= maxChars) return s;
  return s.slice(0, Math.max(0, maxChars - 1)) + "…";
}

function clipLines(s: string, maxLines: number): string {
  const lines = s.split("\n").map((l) => l.trim()).filter(Boolean);
  if (lines.length <= maxLines) return lines.join("\n");
  return lines.slice(0, maxLines).join("\n") + "\n…";
}

export function summarizeValue(x: unknown): string {
  if (x === null || x === undefined) return "(vacío)";
  if (typeof x === "string") return clip(oneLine(x), 220);
  if (typeof x === "number" || typeof x === "boolean") return String(x);
  if (Array.isArray(x)) return `lista(${x.length})`;
  if (typeof x === "object") {
    const obj = x as Record<string, unknown>;
    if ("stored" in obj) return obj.stored ? "guardado" : "no guardado";
    if ("status" in obj) return String(obj.status);
    if ("totalFound" in obj) return `encontrados=${String(obj.totalFound)}`;
    if ("count" in obj) return `count=${String(obj.count)}`;
    if ("success" in obj) return obj.success ? "éxito" : "error";
    const keys = Object.keys(obj).slice(0, 6);
    const more = Object.keys(obj).length > keys.length ? ",…" : "";
    return `obj{${keys.join(",")}${more}}`;
  }
  return "(desconocido)";
}

export class UXRenderer {
  private levelGetter: () => UXLevel;

  constructor(getLevel?: () => UXLevel) {
    this.levelGetter = getLevel ?? (() => ((process.env.MICHAT_UI_LEVEL as UXLevel) || "minimal"));
  }

  level(): UXLevel {
    return this.levelGetter();
  }

  getLimits(level?: UXLevel): UXLimits {
    return DefaultLimits[level ?? this.level()];
  }

  wrapText(text: string, level?: UXLevel): string {
    const lim = this.getLimits(level);
    const clipped = clip(text.trim(), lim.maxChars);
    return clipLines(clipped, lim.maxLines);
  }

  textBlock(text: string, level?: UXLevel): UXBlock {
    return { type: "text", text: this.wrapText(text, level) };
  }

  toolBlock(toolName: string, out: unknown, level?: UXLevel, status: "ok" | "warn" | "error" = "ok"): UXBlock {
    const lvl = level ?? this.level();
    if (lvl === "debug") return { type: "debug", json: { tool: toolName, out } };
    return { 
      type: "tool", 
      name: toolName, 
      status, 
      summary: clip(summarizeValue(out), this.getLimits(lvl).maxToolSummaryChars) 
    };
  }

  workflowBlock(status: "ok" | "warn" | "error", summary: string, level?: UXLevel): UXBlock {
    const lvl = level ?? this.level();
    if (lvl === "debug") return { type: "debug", json: { workflow: { status, summary } } };
    return { type: "workflow", status, summary: clip(oneLine(summary), this.getLimits(lvl).maxChars) };
  }

  notice(tone: "info" | "success" | "warning" | "error", text: string, level?: UXLevel): UXBlock {
    return { type: "notice", tone, text: this.wrapText(text, level) };
  }

  bullets(title: string | undefined, items: string[], level?: UXLevel): UXBlock {
    const lim = this.getLimits(level);
    const clipped = items.map((i) => clip(oneLine(i), Math.max(40, Math.floor(lim.maxChars / 4))));
    return { type: "bullet", title, items: clipped.slice(0, lim.maxBulletItems) };
  }

  successNotice(text: string, level?: UXLevel): UXBlock {
    return this.notice("success", text, level);
  }

  errorNotice(text: string, level?: UXLevel): UXBlock {
    return this.notice("error", text, level);
  }

  warningNotice(text: string, level?: UXLevel): UXBlock {
    return this.notice("warning", text, level);
  }

  infoNotice(text: string, level?: UXLevel): UXBlock {
    return this.notice("info", text, level);
  }

  debugBlock(data: unknown): UXBlock {
    return { type: "debug", json: data };
  }

  followUpSuggestions(): UXBlock {
    return this.bullets("Siguientes pasos", [
      "Dime tu objetivo exacto (1 frase)",
      "Dime restricciones (latencia, costo, compliance)",
      "¿Lo quieres en modo API, web o móvil?",
    ]);
  }
}

export const globalUXRenderer = new UXRenderer();
