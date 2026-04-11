import { test, expect, type Page } from "@playwright/test";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

type ArtifactKind = "docx" | "xlsx" | "pptx" | "pdf";

interface Scenario {
  name: string;
  prompt: string;
  expectedKinds: ArtifactKind[];
}

interface ParsedSseEvent {
  type: string;
  data: any;
}

interface CapturedStreamRecord {
  url: string;
  method: string;
  ok: boolean;
  status: number;
  raw: string;
  error?: string | null;
}

const SUCCESS_MESSAGE_BY_KIND: Record<ArtifactKind, RegExp> = {
  docx: /Documento listo para descargar\./i,
  xlsx: /Hoja de c[aá]lculo lista para descargar\./i,
  pptx: /Presentaci[oó]n lista para descargar\./i,
  pdf: /PDF listo para descargar\./i,
};

const CARD_LABEL_TEXT_BY_KIND: Record<ArtifactKind, string> = {
  docx: "Documento Word",
  xlsx: "Hoja de cálculo Excel",
  pptx: "Presentación PowerPoint",
  pdf: "Documento PDF",
};

const scenarios: Scenario[] = [
  {
    name: "DOCX estudio de mercado",
    prompt: "crea un Word profesional de estudio de mercado para software de administración empresarial en Latinoamérica",
    expectedKinds: ["docx"],
  },
  {
    name: "DOCX análisis de competencia",
    prompt: "crea un Word ejecutivo con análisis de competencia para una startup de logística last mile",
    expectedKinds: ["docx"],
  },
  {
    name: "DOCX benchmark de precios",
    prompt: "crea un documento Word con benchmark de precios para una marca ecommerce de cosmética premium",
    expectedKinds: ["docx"],
  },
  {
    name: "DOCX segmentación de clientes",
    prompt: "crea un Word formal con segmentación de clientes para una fintech B2C de créditos",
    expectedKinds: ["docx"],
  },
  {
    name: "DOCX encuesta de satisfacción",
    prompt: "crea un Word de resultados de encuesta de satisfacción y NPS para una cadena de clínicas",
    expectedKinds: ["docx"],
  },
  {
    name: "DOCX perfil de consumidor",
    prompt: "crea un Word profesional con perfil de consumidor para una marca de alimentos saludables",
    expectedKinds: ["docx"],
  },
  {
    name: "DOCX FODA",
    prompt: "crea un documento Word con análisis FODA para una empresa de energía solar residencial",
    expectedKinds: ["docx"],
  },
  {
    name: "DOCX PESTEL",
    prompt: "crea un Word ejecutivo con análisis PESTEL para una plataforma de educación online",
    expectedKinds: ["docx"],
  },
  {
    name: "DOCX TAM SAM SOM",
    prompt: "crea un Word con análisis TAM SAM SOM para una healthtech de telemedicina",
    expectedKinds: ["docx"],
  },
  {
    name: "DOCX plan comercial",
    prompt: "crea un Word profesional con plan comercial para el lanzamiento de un CRM para pymes",
    expectedKinds: ["docx"],
  },
  {
    name: "DOCX resumen ejecutivo",
    prompt: "crea un Word con resumen ejecutivo para directorio sobre estudio de mercado de banca digital",
    expectedKinds: ["docx"],
  },
  {
    name: "DOCX matriz de riesgos",
    prompt: "crea un Word con matriz de riesgos operativos para una empresa de manufactura ligera",
    expectedKinds: ["docx"],
  },
  {
    name: "XLSX proyección financiera",
    prompt: "crea un Excel profesional con proyección financiera trimestral para una empresa SaaS B2B",
    expectedKinds: ["xlsx"],
  },
  {
    name: "XLSX dashboard de ventas",
    prompt: "crea un Excel con dashboard de ventas por región y canal para una empresa retail",
    expectedKinds: ["xlsx"],
  },
  {
    name: "XLSX cohortes",
    prompt: "crea un Excel con análisis de cohortes de retención para una app de suscripción",
    expectedKinds: ["xlsx"],
  },
  {
    name: "XLSX funnel comercial",
    prompt: "crea un Excel con funnel comercial lead a cierre para una consultora B2B",
    expectedKinds: ["xlsx"],
  },
  {
    name: "XLSX costos y márgenes",
    prompt: "crea un Excel con análisis de costos y márgenes para un portafolio de productos industriales",
    expectedKinds: ["xlsx"],
  },
  {
    name: "XLSX inventario y demanda",
    prompt: "crea un Excel con inventario y pronóstico de demanda para una cadena de supermercados",
    expectedKinds: ["xlsx"],
  },
  {
    name: "XLSX cronograma operativo",
    prompt: "crea un Excel con cronograma operativo y capacidad semanal para una planta de producción",
    expectedKinds: ["xlsx"],
  },
  {
    name: "PPTX directorio",
    prompt: "crea un ppt profesional para directorio con estudio de mercado de una empresa de seguros digitales",
    expectedKinds: ["pptx"],
  },
  {
    name: "PPTX resultados de investigación",
    prompt: "crea un ppt ejecutivo con resultados de investigación de consumidores para una marca de bebidas",
    expectedKinds: ["pptx"],
  },
  {
    name: "PPTX propuesta comercial",
    prompt: "crea un powerpoint profesional con propuesta comercial enterprise para una plataforma de RRHH",
    expectedKinds: ["pptx"],
  },
  {
    name: "PDF reporte ejecutivo",
    prompt: "crea un pdf ejecutivo de estudio de mercado para una empresa de administración de edificios",
    expectedKinds: ["pdf"],
  },
  {
    name: "Híbrido Word + Excel",
    prompt: "crea un Word y un Excel profesionales con estudio de mercado, benchmark de precios y proyección financiera para una startup de delivery",
    expectedKinds: ["docx", "xlsx"],
  },
  {
    name: "Híbrido Word + Excel + PPT",
    prompt: "crea un Word, un Excel y un ppt profesionales con estudio de mercado, plan comercial y presentación para directorio de una fintech",
    expectedKinds: ["docx", "xlsx", "pptx"],
  },
];

function normalizeArtifactKind(value: unknown): ArtifactKind | null {
  const normalized = String(value || "").trim().toLowerCase();
  if (normalized === "docx" || normalized === "word" || normalized === "document") return "docx";
  if (normalized === "xlsx" || normalized === "excel" || normalized === "spreadsheet") return "xlsx";
  if (normalized === "pptx" || normalized === "ppt" || normalized === "presentation") return "pptx";
  if (normalized === "pdf") return "pdf";
  return null;
}

function parseSseEvents(raw: string): ParsedSseEvent[] {
  const events: ParsedSseEvent[] = [];
  let currentType = "message";
  let currentData: string[] = [];

  const pushEvent = () => {
    if (currentData.length === 0) return;
    const rawData = currentData.join("\n");
    let parsed: any = rawData;
    try {
      parsed = JSON.parse(rawData);
    } catch {
      parsed = rawData;
    }
    events.push({ type: currentType, data: parsed });
    currentType = "message";
    currentData = [];
  };

  for (const line of raw.split(/\r?\n/)) {
    if (!line.trim()) {
      pushEvent();
      continue;
    }
    if (line.startsWith("event:")) {
      currentType = line.slice("event:".length).trim();
      continue;
    }
    if (line.startsWith("data:")) {
      currentData.push(line.slice("data:".length).trim());
    }
  }
  pushEvent();
  return events;
}

function expectedSuccessMessage(scenario: Scenario): RegExp {
  if (scenario.expectedKinds.length > 1) {
    return /Se generaron \d+ archivos listos para descargar\./i;
  }
  return SUCCESS_MESSAGE_BY_KIND[scenario.expectedKinds[0]];
}

function expectedPreviewTestId(kind: ArtifactKind): string {
  if (kind === "docx") return "document-preview-docx";
  if (kind === "pdf") return "document-preview-pdf";
  return "document-preview-html";
}

async function validateDownloadedFile(filePath: string, kind: ArtifactKind): Promise<void> {
  const stat = await fs.stat(filePath);
  expect(stat.size).toBeGreaterThan(256);

  if (kind === "pdf") {
    const buffer = await fs.readFile(filePath);
    expect(buffer.subarray(0, 5).toString("utf8")).toBe("%PDF-");
    expect(buffer.toString("utf8").includes("%%EOF")).toBeTruthy();
    return;
  }

  if (kind === "xlsx") {
    const { default: ExcelJS } = await import("exceljs");
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.readFile(filePath);
    expect(workbook.worksheets.length).toBeGreaterThan(0);
    const firstSheet = workbook.worksheets[0];
    expect(firstSheet.actualRowCount).toBeGreaterThan(0);
    const firstRowValues = firstSheet.getRow(1).values.filter(Boolean);
    expect(firstRowValues.length).toBeGreaterThan(0);
    return;
  }

  const { default: JSZip } = await import("jszip");
  const zip = await JSZip.loadAsync(await fs.readFile(filePath));
  if (kind === "docx") {
    const { default: mammoth } = await import("mammoth");
    expect(zip.file("[Content_Types].xml")).toBeTruthy();
    expect(zip.file("word/document.xml")).toBeTruthy();
    const rawText = await mammoth.extractRawText({ path: filePath });
    expect(rawText.value.trim().length).toBeGreaterThan(60);
    return;
  }

  expect(zip.file("[Content_Types].xml")).toBeTruthy();
  expect(zip.file("ppt/presentation.xml")).toBeTruthy();
  const slideFiles = Object.keys(zip.files).filter((entry) => /^ppt\/slides\/slide\d+\.xml$/i.test(entry));
  expect(slideFiles.length).toBeGreaterThan(0);
}

async function validatePreview(page: Page, kind: ArtifactKind) {
  await expect(page.getByTestId("chat-artifact-split-preview")).toBeVisible({ timeout: 30_000 });
  await expect(page.getByTestId(expectedPreviewTestId(kind))).toBeVisible({ timeout: 30_000 });
  await expect(page.getByRole("textbox", { name: "Message input" })).toBeVisible();
  if (kind === "docx") {
    await expect(page.getByTestId("document-preview-docx-canvas")).toBeVisible({ timeout: 30_000 });
  }
  if (kind === "pdf") {
    await expect(page.getByTestId("pdf-canvas")).toBeVisible({ timeout: 30_000 });
  }
}

function artifactCardLocator(page: Page, kind: ArtifactKind) {
  return page
    .getByText(CARD_LABEL_TEXT_BY_KIND[kind], { exact: true })
    .locator("xpath=ancestor::div[contains(@class,'rounded-lg')][1]");
}

function toRelativePath(urlString: string): string {
  return new URL(urlString, "http://127.0.0.1:41732").pathname;
}

async function installChatStreamCapture(page: Page) {
  await page.addInitScript(() => {
    const globalWindow = window as typeof window & {
      __artifactTestStreams?: Promise<{
        url: string;
        method: string;
        ok: boolean;
        status: number;
        raw: string;
        error?: string | null;
      }>[];
      __artifactTestFetchWrapped?: boolean;
    };

    if (globalWindow.__artifactTestFetchWrapped) return;
    globalWindow.__artifactTestFetchWrapped = true;
    globalWindow.__artifactTestStreams = [];

    const originalFetch = window.fetch.bind(window);
    window.fetch = async (...args) => {
      const response = await originalFetch(...args);

      try {
        const [input, init] = args;
        const requestUrl =
          typeof input === "string" ? input : input instanceof Request ? input.url : String(input);
        const requestMethod = (
          init?.method || (input instanceof Request ? input.method : "GET") || "GET"
        ).toUpperCase();

        if (requestUrl.includes("/api/chat/stream") && requestMethod === "POST") {
          const clone = response.clone();
          globalWindow.__artifactTestStreams!.push(
            clone
              .text()
              .then((raw) => ({
                url: requestUrl,
                method: requestMethod,
                ok: clone.ok,
                status: clone.status,
                raw,
                error: null,
              }))
              .catch((error) => ({
                url: requestUrl,
                method: requestMethod,
                ok: clone.ok,
                status: clone.status,
                raw: "",
                error: error instanceof Error ? error.message : String(error),
              })),
          );
        }
      } catch {
        // Keep the app flow untouched even if the test probe fails.
      }

      return response;
    };
  });
}

async function getCapturedChatStream(page: Page, previousCount: number): Promise<CapturedStreamRecord> {
  await page.waitForFunction(
    (count) => {
      const globalWindow = window as typeof window & {
        __artifactTestStreams?: Promise<unknown>[];
      };
      return (globalWindow.__artifactTestStreams?.length || 0) > count;
    },
    previousCount,
    { timeout: 30_000 },
  );

  const records = await page.evaluate(async () => {
    const globalWindow = window as typeof window & {
      __artifactTestStreams?: Promise<CapturedStreamRecord>[];
    };
    const entries = globalWindow.__artifactTestStreams || [];
    return Promise.all(entries);
  });

  const latestRecord = records.at(-1);
  expect(latestRecord).toBeTruthy();
  return latestRecord!;
}

async function runScenario(page: Page, scenario: Scenario) {
  test.setTimeout(240_000);

  await installChatStreamCapture(page);
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "¿En qué puedo ayudarte?" })).toBeVisible({
    timeout: 60_000,
  });

  const composer = page.getByRole("textbox", { name: "Message input" });
  await expect(composer).toBeVisible({ timeout: 20_000 });

  const previousStreamCount = await page.evaluate(() => {
    const globalWindow = window as typeof window & {
      __artifactTestStreams?: Promise<unknown>[];
    };
    return globalWindow.__artifactTestStreams?.length || 0;
  });

  await composer.fill(scenario.prompt);
  await composer.press("Enter");

  await expect(page.getByText(expectedSuccessMessage(scenario))).toBeVisible({ timeout: 120_000 });
  await expect(page.getByText(/EventSource error/i)).toHaveCount(0);
  await expect(page.getByText(/^failed$/i)).toHaveCount(0);
  await expect(page.locator('[data-testid*="thinking-indicator"]')).toHaveCount(0);

  const streamResponse = await getCapturedChatStream(page, previousStreamCount);
  expect(streamResponse.ok).toBeTruthy();
  expect(streamResponse.error || "").toBeFalsy();
  const rawStream = streamResponse.raw;
  const events = parseSseEvents(rawStream);

  const productionStart = events.find((event) => event.type === "production_start");
  const productionEvents = events.filter((event) => event.type === "production_event");
  const artifactEvents = events.filter((event) => event.type === "artifact");
  const productionComplete = [...events].reverse().find((event) => event.type === "production_complete");
  const doneEvent = events.find((event) => event.type === "done");
  const productionError = events.find((event) => event.type === "production_error");

  expect(productionStart).toBeTruthy();
  expect(productionEvents.length).toBeGreaterThan(0);
  expect(artifactEvents.length).toBeGreaterThanOrEqual(scenario.expectedKinds.length);
  expect(productionComplete?.data?.success).toBeTruthy();
  expect(doneEvent).toBeTruthy();
  expect(productionError).toBeFalsy();

  const streamedKinds = artifactEvents
    .map((event) => normalizeArtifactKind(event.data?.type || event.data?.metadata?.docKind))
    .filter((value): value is ArtifactKind => value !== null);

  for (const expectedKind of scenario.expectedKinds) {
    expect(streamedKinds).toContain(expectedKind);
    await expect(artifactCardLocator(page, expectedKind)).toBeVisible({ timeout: 30_000 });
  }

  const viewButtons = page.locator('[data-testid^="button-view-artifact-"]');
  const previewButtons = page.locator('[data-testid^="button-preview-artifact-"]');
  const downloadButtons = page.locator('[data-testid^="button-download-artifact-"]');

  await expect(viewButtons).toHaveCount(scenario.expectedKinds.length, { timeout: 30_000 });
  await expect(previewButtons).toHaveCount(scenario.expectedKinds.length, { timeout: 30_000 });
  await expect(downloadButtons).toHaveCount(scenario.expectedKinds.length, { timeout: 30_000 });

  const normalizedArtifactEvents = artifactEvents
    .map((event) => ({
      kind: normalizeArtifactKind(event.data?.type || event.data?.metadata?.docKind),
      downloadUrl: String(event.data?.downloadUrl || ""),
      mimeType: String(event.data?.mimeType || ""),
      metadata: event.data?.metadata || {},
    }))
    .filter((entry) => entry.kind !== null && entry.downloadUrl);

  for (const expectedKind of scenario.expectedKinds) {
    const artifactFromStream = normalizedArtifactEvents.find((entry) => entry.kind === expectedKind);

    expect(artifactFromStream).toBeTruthy();
    expect(normalizeArtifactKind(artifactFromStream?.kind)).toBe(expectedKind);
    expect(artifactFromStream?.downloadUrl).toBeTruthy();
    expect(artifactFromStream?.mimeType.toLowerCase()).toContain(
      expectedKind === "docx"
        ? "wordprocessingml.document"
        : expectedKind === "xlsx"
          ? "spreadsheetml.sheet"
          : expectedKind === "pptx"
            ? "presentationml.presentation"
            : "application/pdf",
    );

    const artifactCard = artifactCardLocator(page, expectedKind);
    await expect(artifactCard).toBeVisible({ timeout: 30_000 });

    const viewButton = artifactCard.locator('[data-testid^="button-view-artifact-"]').first();
    await viewButton.click();
    await validatePreview(page, expectedKind);
    await page.getByTestId("chat-artifact-close-button").click();
    await expect(page.getByTestId("chat-artifact-split-preview")).toHaveCount(0);

    const previewButton = artifactCard.locator('[data-testid^="button-preview-artifact-"]').first();
    await previewButton.click();
    await validatePreview(page, expectedKind);
    await page.getByTestId("chat-artifact-close-button").click();
    await expect(page.getByTestId("chat-artifact-split-preview")).toHaveCount(0);

    const relativeDownloadPath = toRelativePath(artifactFromStream!.downloadUrl);
    const downloadResponsePromise = page.waitForResponse(
      (response) =>
        response.request().method() === "GET" &&
        new URL(response.url()).pathname === relativeDownloadPath,
      { timeout: 30_000 },
    );
    const downloadPromise = page.waitForEvent("download", { timeout: 30_000 });
    await artifactCard.locator('[data-testid^="button-download-artifact-"]').first().click();
    const [downloadResponse, download] = await Promise.all([downloadResponsePromise, downloadPromise]);
    expect(downloadResponse.ok()).toBeTruthy();

    const disposition = downloadResponse.headers()["content-disposition"] || "";
    expect(disposition.toLowerCase()).toContain("filename");
    expect(download.suggestedFilename().toLowerCase()).toContain(`.${expectedKind}`);

    const downloadDir = await fs.mkdtemp(path.join(os.tmpdir(), "ilia-doc-battery-"));
    const downloadPath = path.join(downloadDir, download.suggestedFilename());
    await download.saveAs(downloadPath);
    await validateDownloadedFile(downloadPath, expectedKind);

    if (expectedKind === "docx") {
      const officeRunId =
        typeof artifactFromStream?.metadata?.officeRunId === "string"
          ? String(artifactFromStream.metadata.officeRunId)
          : artifactFromStream?.downloadUrl.match(/\/api\/office-engine\/runs\/([0-9a-f-]{36})\//i)?.[1];

      if (officeRunId) {
        const runResponse = await page.request.get(`/api/office-engine/runs/${officeRunId}`);
        expect(runResponse.ok()).toBeTruthy();
        const runPayload = await runResponse.json();
        expect(runPayload.run.status).toBe("succeeded");
        expect(Array.isArray(runPayload.artifacts)).toBeTruthy();
        expect(runPayload.artifacts.length).toBeGreaterThan(0);
      }
    }
  }
}

test.describe("Chat document business battery", () => {
  for (const scenario of scenarios) {
    test(scenario.name, async ({ page }) => {
      await runScenario(page, scenario);
    });
  }
});
