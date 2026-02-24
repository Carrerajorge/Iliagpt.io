import fs from "node:fs/promises";
import { readFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";
import { describe, expect, it } from "vitest";
import { DocumentCliToolRunner } from "./orchestrator";
import type { ToolRunnerDocumentType } from "./types";

interface GoldenFixture {
  documentType: ToolRunnerDocumentType;
  requiredTools: string[];
  requiredValidationChecks: Array<"relationships" | "schema" | "images">;
}

const GOLDEN_DIR = path.join(process.cwd(), "test_fixtures", "tool_runner_golden");

function loadGolden(type: ToolRunnerDocumentType): GoldenFixture {
  return JSON.parse(readFileSync(path.join(GOLDEN_DIR, `${type}.golden.json`), "utf8")) as GoldenFixture;
}

function sha256(buffer: Buffer): string {
  return crypto.createHash("sha256").update(buffer).digest("hex");
}

function buildData(type: ToolRunnerDocumentType): Record<string, unknown> {
  if (type === "docx") {
    return {
      content: "Documento de prueba para golden files.\n\nEste contenido debe ser estable para pruebas de regresión.",
    };
  }

  if (type === "xlsx") {
    return {
      headers: ["Mes", "Ventas", "Margen"],
      rows: [
        ["Enero", 1200, 0.34],
        ["Febrero", 1450, 0.37],
      ],
    };
  }

  return {
    slides: [
      {
        title: "Resumen",
        content: ["Punto 1", "Punto 2", "Punto 3"],
      },
      {
        title: "Cierre",
        content: ["Conclusión principal"],
      },
    ],
  };
}

describe("DocumentCliToolRunner golden integration", () => {
  for (const type of ["docx", "xlsx", "pptx"] as const) {
    it(
      `matches golden contract for ${type} and enforces idempotent cache`,
      async () => {
        const cacheDir = await fs.mkdtemp(path.join(os.tmpdir(), `iliacodex-tool-runner-cache-${type}-`));

        try {
          const runner = new DocumentCliToolRunner({
            cacheDir,
            sandbox: "subprocess",
            maxRetries: 1,
            timeoutMs: 120_000,
          } as any);

          const golden = loadGolden(type);
          const request = {
            documentType: type,
            title: `Golden ${type.toUpperCase()} ${Date.now()}`,
            templateId: "custom",
            data: buildData(type),
            locale: "es",
          };

          const first = await runner.generate(request);

          expect(first.mimeType).toMatch(/openxmlformats-officedocument/);
          expect(first.report.documentType).toBe(type);
          expect(first.report.validation.valid).toBe(true);

          const firstTools = Array.from(new Set(first.report.traces.map((trace) => trace.tool)));
          for (const requiredTool of golden.requiredTools) {
            expect(firstTools).toContain(requiredTool);
          }

          for (const requiredCheck of golden.requiredValidationChecks) {
            expect(first.report.validation.checks[requiredCheck]).toBe(true);
          }

          const firstBuffer = await fs.readFile(first.artifactPath);
          expect(firstBuffer[0]).toBe(0x50);
          expect(firstBuffer[1]).toBe(0x4b);

          const second = await runner.generate(request);
          expect(second.report.cacheHit).toBe(true);

          const secondBuffer = await fs.readFile(second.artifactPath);
          expect(sha256(secondBuffer)).toBe(sha256(firstBuffer));
        } finally {
          await fs.rm(cacheDir, { recursive: true, force: true });
        }
      },
      180_000
    );
  }
});
