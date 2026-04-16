import {
  unifiedArticleSearch,
  type UnifiedArticle,
  type ArticleField,
  type FieldProvenance,
  type FieldProvenanceSource,
  type SearchOptions as UnifiedSearchOptions,
} from "../agent/superAgent/unifiedArticleSearch";
import { searchCrossRef, verifyDOI, type VerifyDOIResult } from "../agent/superAgent/crossrefClient";
import { lookupOpenAlexWorkByDoi, type AcademicCandidate } from "../agent/superAgent/openAlexClient";
import ExcelJS from "exceljs";
import { Document, Packer, Paragraph, TextRun, HeadingLevel, AlignmentType } from "docx";
import { persistentJsonCacheGet, persistentJsonCacheSet } from "../lib/persistentJsonCache";
import { sanitizePlainText } from "../lib/textSanitizers";
import * as fs from "fs/promises";
import * as path from "path";

export type AcademicRegion = {
  latam: boolean;
  spain: boolean;
};

export type AcademicGeoStrictMode = "all" | "primary";

export interface AcademicArticlesExportPlan {
  topicQuery: string;
  requestedCount: number;
  yearFrom?: number;
  yearTo?: number;
  region: AcademicRegion;
  geoStrict?: boolean;
  geoStrictMode?: AcademicGeoStrictMode;
  // Scopus-only filter: affiliation countries list
  affilCountries?: string[];
  sources: NonNullable<UnifiedSearchOptions["sources"]>;
}

export interface AcademicArticlesExportDebug {
  queryVariants: string[];
  candidateCounts: {
    total: number;
    deduped: number;
    regionFiltered: number;
    enrichPool: number;
    enrichedDeduped: number;
    enrichedRegionFiltered: number;
    final: number;
  };
  errors: string[];
  jsonReportPath?: string;
}

export interface AcademicArticlesExportResult {
  plan: AcademicArticlesExportPlan;
  articles: UnifiedArticle[];
  excelBuffer: Buffer;
  wordBuffer: Buffer;
  debug?: AcademicArticlesExportDebug;
  stats: {
    totalReturned: number;
    totalRequested: number;
    bySource: Record<string, number>;
    coverage: Record<
      "doi" | "abstract" | "keywords" | "journal" | "city" | "country" | "language" | "documentType",
      { present: number; missing: number }
    >;
    notes: string[];
  };
}

const LATAM_COUNTRIES_EN = [
  "Argentina",
  "Bolivia",
  "Brazil",
  "Chile",
  "Colombia",
  "Costa Rica",
  "Cuba",
  "Dominican Republic",
  "Ecuador",
  "El Salvador",
  "Guatemala",
  "Honduras",
  "Mexico",
  "Nicaragua",
  "Panama",
  "Paraguay",
  "Peru",
  "Puerto Rico",
  "Uruguay",
  "Venezuela",
];

const ISO2_BY_COUNTRY_EN: Record<string, string> = {
  argentina: "AR",
  bolivia: "BO",
  brazil: "BR",
  chile: "CL",
  colombia: "CO",
  "costa rica": "CR",
  cuba: "CU",
  "dominican republic": "DO",
  ecuador: "EC",
  "el salvador": "SV",
  guatemala: "GT",
  honduras: "HN",
  mexico: "MX",
  nicaragua: "NI",
  panama: "PA",
  paraguay: "PY",
  peru: "PE",
  "puerto rico": "PR",
  uruguay: "UY",
  venezuela: "VE",
  spain: "ES",
};

function affilCountriesToIso2Codes(affilCountries: string[] | undefined): string[] | undefined {
  if (!affilCountries || affilCountries.length === 0) return undefined;
  const seen = new Set<string>();
  const out: string[] = [];
  for (const c of affilCountries) {
    const key = (c || "").trim().toLowerCase();
    const code = ISO2_BY_COUNTRY_EN[key];
    if (!code) continue;
    if (seen.has(code)) continue;
    seen.add(code);
    out.push(code);
  }
  return out.length > 0 ? out : undefined;
}

function detectRegion(prompt: string): AcademicRegion {
  const p = prompt.toLowerCase();
  const latam = /\b(latinoam[eé]rica|america\s+latina|am[eé]rica\s+latina|latam)\b/i.test(p);
  const spain = /\b(espa[ñn]a)\b/i.test(p);
  return { latam, spain };
}

function detectGeoStrict(prompt: string): { geoStrict: boolean; geoStrictMode?: AcademicGeoStrictMode } {
  const p = prompt.toLowerCase();

  // "primer autor", "autor principal", etc.
  const primary = /\b(primer\s+autor|autor\s+principal|first\s+author|primary\s+author)\b/i.test(p);
  if (primary) return { geoStrict: true, geoStrictMode: "primary" };

  // "solo", "exclusivamente", "estricto"
  const strict = /\b(solo|s[óo]lo|[uú]nicamente|unicamente|exclusivamente|estricto|estrictamente)\b/i.test(p);
  if (strict) return { geoStrict: true, geoStrictMode: "all" };

  return { geoStrict: false };
}

function extractCount(prompt: string): number {
  // "buscarme 100 articulos", "buscame 50 papers", etc.
  const m = prompt.match(/\b(?:buscarme|buscame|dame|necesito|encuentra(?:me)?)\s+(\d{1,3})\s+(?:art[ií]culos?|papers?|estudios?)\b/i);
  if (m) {
    const n = parseInt(m[1], 10);
    if (!Number.isNaN(n) && n > 0) return Math.min(100, n);
  }
  return 50;
}

function extractYearRange(prompt: string): { yearFrom?: number; yearTo?: number } {
  const m = prompt.match(/\b(19\d{2}|20\d{2})\s*(?:al|-|hasta|to)\s*(19\d{2}|20\d{2})\b/i);
  if (!m) return {};
  const a = parseInt(m[1], 10);
  const b = parseInt(m[2], 10);
  if (Number.isNaN(a) || Number.isNaN(b)) return {};
  return { yearFrom: Math.min(a, b), yearTo: Math.max(a, b) };
}

function extractTopicQuery(prompt: string): string {
  // Try to capture: "... sobre <TOPIC> del 2021 al 2025 ..." or before export instructions.
  const m = prompt.match(/(?:\bsobre\b|\bacerca\s+de\b|\brelacionad[ao]\s+con\b)\s+([^.\n]{3,240})/i);
  if (m?.[1]?.trim()) return m[1].trim();

  // Fallback: strip common "find me N papers" prefix and trailing export instructions
  let t = prompt.trim();
  t = t.replace(/\b(?:buscarme|buscame|dame|necesito|encuentra(?:me)?)\s+\d{1,3}\s+(?:art[ií]culos?|papers?|estudios?)\b/i, "").trim();
  t = t.replace(/\b(en|en\s+un)\s+(excel|xlsx|word|docx)\b[\s\S]*$/i, "").trim();
  return t || prompt.trim();
}

function detectSourceFlags(prompt: string): {
  wantsWos: boolean;
  wantsDuckDuckGo: boolean;
  freeOnly: boolean;
  noScopus: boolean;
  noWos: boolean;
  noDuckDuckGo: boolean;
} {
  const p = prompt.toLowerCase();

  const wantsWos = /\b(wos|web\s*of\s*science|clarivate)\b/i.test(p);
  const wantsDuckDuckGo = /\b(duckduckgo|duck\s*duck\s*go|ddg)\b/i.test(p);

  const noScopus = /\b(?:sin|no)\s+scopus\b/i.test(p);
  const noWos = /\b(?:sin|no)\s+(?:wos|web\s*of\s*science)\b/i.test(p);
  const noDuckDuckGo = /\b(?:sin|no)\s+(?:duckduckgo|duck\s*duck\s*go|ddg)\b/i.test(p);

  // If the user insists on "only free" sources, skip paid/closed APIs (Scopus/WoS).
  // Note: "gratis" is ambiguous; treat it as strict only when phrased explicitly.
  const freeOnly =
    /\b(100%\s*gratis|solo\s+gratis|totalmente\s+gratis|sin\s+costo|gratuito\s+para\s+siempre)\b/i.test(p) ||
    (/\bgratis\b/i.test(p) && (noScopus || noWos));

  return {
    wantsWos,
    wantsDuckDuckGo,
    freeOnly,
    noScopus,
    noWos,
    noDuckDuckGo,
  };
}

function normalizeCountry(country: string): string {
  return country.trim().toLowerCase();
}

function buildAffilCountries(region: AcademicRegion): string[] | undefined {
  const list: string[] = [];
  if (region.latam) list.push(...LATAM_COUNTRIES_EN);
  if (region.spain) list.push("Spain");
  const unique = Array.from(new Set(list.map(c => c.trim()).filter(Boolean)));
  return unique.length > 0 ? unique : undefined;
}

/**
 * Sanitize export prompt to prevent injection
 */
function sanitizeExportPrompt(raw: string): string {
  return sanitizePlainText(raw, { maxLen: 2000, collapseWs: true });
}

export function planAcademicArticlesExport(prompt: string): AcademicArticlesExportPlan {
  const sanitizedPrompt = sanitizeExportPrompt(prompt);
  const region = detectRegion(sanitizedPrompt);
  const geo = detectGeoStrict(sanitizedPrompt);
  const requestedCount = extractCount(sanitizedPrompt);
  const { yearFrom, yearTo } = extractYearRange(sanitizedPrompt);
  const topicQuery = extractTopicQuery(sanitizedPrompt);
  const flags = detectSourceFlags(sanitizedPrompt);

  // For region-restricted requests, avoid PubMed because we can't reliably enforce affiliation country.
  let sources: AcademicArticlesExportPlan["sources"] =
    region.latam || region.spain
      ? ["scopus", "openalex", "scielo", "redalyc"]
      : ["scopus", "openalex", "pubmed", "scielo", "redalyc"];

  if (flags.freeOnly) {
    sources = region.latam || region.spain
      ? ["openalex", "scielo", "redalyc", "duckduckgo"]
      : ["openalex", "pubmed", "scielo", "redalyc", "duckduckgo"];
  }

  if (flags.wantsWos) sources = [...sources, "wos"];
  if (flags.wantsDuckDuckGo) sources = [...sources, "duckduckgo"];

  if (flags.noScopus) sources = sources.filter((s) => s !== "scopus");
  if (flags.noWos) sources = sources.filter((s) => s !== "wos");
  if (flags.noDuckDuckGo) sources = sources.filter((s) => s !== "duckduckgo");

  sources = Array.from(new Set(sources));

  return {
    topicQuery,
    requestedCount,
    yearFrom,
    yearTo,
    region,
    geoStrict: geo.geoStrict,
    geoStrictMode: geo.geoStrictMode,
    affilCountries: buildAffilCountries(region),
    sources,
  };
}

function isAllowedByRegion(
  article: UnifiedArticle,
  plan: AcademicArticlesExportPlan,
  allowedCountries: Set<string> | null,
  allowedCountryCodes: Set<string> | null,
): boolean {
  if (!allowedCountries) return true;

  const country = (article.country || "").trim();
  const normalized = country ? normalizeCountry(country) : "";

  // Scopus: enforce strict affiliation-country matching when available.
  if (article.source === "scopus") {
    return normalized.length > 0 && allowedCountries.has(normalized);
  }

  // OpenAlex: apply strict geo logic when requested. Query-time filter only guarantees "some" institution in-region.
  if (article.source === "openalex") {
    const codes = (article.institutionCountryCodes || [])
      .map((c) => (c || "").trim().toUpperCase())
      .filter(Boolean);
    const primary = (article.primaryInstitutionCountryCode || "").trim().toUpperCase();

    if (plan.geoStrict) {
      if (plan.geoStrictMode === "primary") {
        if (primary && allowedCountryCodes?.has(primary)) return true;
        // Fallback to extracted country string if we couldn't extract a code.
        return normalized.length > 0 && normalized !== "unknown" && normalized !== "n.d."
          ? allowedCountries.has(normalized)
          : false;
      }

      // "all": discard works that have any institution outside the allowed set.
      if (codes.length > 0 && allowedCountryCodes) {
        for (const c of codes) {
          if (!allowedCountryCodes.has(c)) return false;
        }
        return true;
      }

      // Strict but no codes: require an explicit country match.
      return normalized.length > 0 && normalized !== "unknown" && normalized !== "n.d."
        ? allowedCountries.has(normalized)
        : false;
    }

    // Non-strict: trust query-time filter if we asked OpenAlex with a country filter.
    if (normalized.length > 0 && normalized !== "unknown" && normalized !== "n.d.") {
      return allowedCountries.has(normalized);
    }
    return !!plan.affilCountries;
  }

  // SciELO / Redalyc: many records don't expose a clean country. Treat "LatAm" as allowed only if requested.
  if (normalized === "latam") return plan.region.latam && !plan.geoStrict;

  // If we have a real country, enforce it.
  if (normalized.length > 0 && normalized !== "n.d.") return allowedCountries.has(normalized);

  // Unknown country: allow only for LatAm requests and only for region-focused sources.
  if (!plan.geoStrict && (article.source === "scielo" || article.source === "redalyc")) return plan.region.latam;

  // Otherwise drop to avoid leaking global content into a strict region filter.
  return false;
}

function formatAuthorAPA(author: string): string {
  const a = (author || "").trim();
  if (!a) return "";

  const commaParts = a.split(",").map(p => p.trim()).filter(Boolean);
  if (commaParts.length >= 2) {
    const lastName = commaParts[0];
    const given = commaParts.slice(1).join(" ");
    const initials = given
      .split(/\s+/)
      .filter(Boolean)
      .map(n => (n.endsWith(".") ? n.charAt(0).toUpperCase() + "." : n.charAt(0).toUpperCase() + "."))
      .join(" ");
    return `${lastName}, ${initials}`.trim();
  }

  const spaceParts = a.split(/\s+/).map(p => p.trim()).filter(Boolean);
  if (spaceParts.length >= 2) {
    const lastName = spaceParts[spaceParts.length - 1];
    const given = spaceParts.slice(0, -1);
    const initials = given.map(n => n.charAt(0).toUpperCase() + ".").join(" ");
    return `${lastName}, ${initials}`.trim();
  }

  return a;
}

function formatAuthorsAPA7(authors: string[]): string {
  const list = (authors || []).map(formatAuthorAPA).filter(Boolean);
  if (list.length === 0) return "Author unknown";
  if (list.length === 1) return list[0];
  if (list.length === 2) return `${list[0]} & ${list[1]}`;
  if (list.length <= 20) return `${list.slice(0, -1).join(", ")}, & ${list[list.length - 1]}`;
  return `${list.slice(0, 19).join(", ")}, ... ${list[list.length - 1]}`;
}

const APA_FONT = "Times New Roman";
const APA_SIZE = 24; // 12pt in docx half-points

function normalizeWhitespace(text: string): string {
  return (text || "").replace(/\s+/g, " ").trim();
}

function ensureEndsWithPeriod(text: string): string {
  const t = normalizeWhitespace(text);
  if (!t) return "";
  return t.endsWith(".") ? t : `${t}.`;
}

function buildApaCitationRuns(article: UnifiedArticle): TextRun[] {
  const authors = formatAuthorsAPA7(article.authors || []);
  const year = normalizeWhitespace(article.year || "n.d.") || "n.d.";
  const title = ensureEndsWithPeriod(article.title || "Untitled");

  const journal = normalizeWhitespace(article.journal || "");
  const volume = normalizeWhitespace(article.volume || "");
  const issue = normalizeWhitespace(article.issue || "");
  const pages = normalizeWhitespace(article.pages || "");

  const doi = normalizeWhitespace(article.doi || "");
  const doiUrl = doi ? `https://doi.org/${doi}` : "";
  const rawUrl = normalizeWhitespace(article.url || "");
  const linkUrl = doiUrl || (/^https?:\/\//i.test(rawUrl) ? rawUrl : "");

  const runs: TextRun[] = [
    new TextRun({ text: `${authors} (${year}). ${title} `, font: APA_FONT, size: APA_SIZE }),
  ];

  if (!journal) {
    if (linkUrl) runs.push(new TextRun({ text: `🔗 ${linkUrl}`, font: APA_FONT, size: APA_SIZE }));
    return runs;
  }

  // Journal title (italic)
  runs.push(new TextRun({ text: journal, italics: true, font: APA_FONT, size: APA_SIZE }));

  // APA: Journal Title, 12(3), 45-67. https://doi.org/...
  if (volume) {
    runs.push(new TextRun({ text: ", ", font: APA_FONT, size: APA_SIZE }));
    runs.push(new TextRun({ text: volume, italics: true, font: APA_FONT, size: APA_SIZE }));
    if (issue) runs.push(new TextRun({ text: `(${issue})`, font: APA_FONT, size: APA_SIZE }));
    if (pages) runs.push(new TextRun({ text: `, ${pages}`, font: APA_FONT, size: APA_SIZE }));
    runs.push(new TextRun({ text: ".", font: APA_FONT, size: APA_SIZE }));
  } else if (pages) {
    runs.push(new TextRun({ text: `, ${pages}.`, font: APA_FONT, size: APA_SIZE }));
  } else {
    runs.push(new TextRun({ text: ".", font: APA_FONT, size: APA_SIZE }));
  }

  if (linkUrl) runs.push(new TextRun({ text: ` 🔗 ${linkUrl}`, font: APA_FONT, size: APA_SIZE }));

  return runs;
}

async function generateApaReferencesDocx(topic: string, articles: UnifiedArticle[]): Promise<Buffer> {
  const sorted = [...articles].sort((a, b) => {
    const aKey = (a.authors?.[0] || "").toLowerCase();
    const bKey = (b.authors?.[0] || "").toLowerCase();
    if (aKey !== bKey) return aKey.localeCompare(bKey);
    const at = (a.title || "").toLowerCase();
    const bt = (b.title || "").toLowerCase();
    return at.localeCompare(bt);
  });

  const children: Paragraph[] = [
    new Paragraph({
      heading: HeadingLevel.HEADING_1,
      alignment: AlignmentType.CENTER,
      spacing: { after: 300 },
      children: [
        new TextRun({ text: "Referencias", bold: true, font: "Times New Roman", size: 32 }),
      ],
    }),
    new Paragraph({
      alignment: AlignmentType.CENTER,
      spacing: { after: 500 },
      children: [
        new TextRun({ text: "(Formato APA 7ma Edicion)", italics: true, font: "Times New Roman", size: 24 }),
      ],
    }),
    new Paragraph({
      spacing: { after: 400 },
      children: [
        new TextRun({ text: `Tema: ${topic}`, font: "Times New Roman", size: 22, italics: true }),
      ],
    }),
  ];

  for (const a of sorted) {
    children.push(
      new Paragraph({
        spacing: { after: 240 },
        indent: { hanging: 720, left: 720 },
        children: buildApaCitationRuns(a),
      })
    );
  }

  const doc = new Document({
    creator: "IliaGPT",
    title: `Referencias APA7 - ${topic}`,
    sections: [{ properties: {}, children }],
  });

  return await Packer.toBuffer(doc);
}

function normalizeLanguageLabel(lang: string | undefined): string {
  const l = (lang || "").trim();
  if (!l) return "n.d.";
  const lower = l.toLowerCase();

  const map: Record<string, string> = {
    es: "Spanish",
    spa: "Spanish",
    spanish: "Spanish",
    español: "Spanish",
    espanol: "Spanish",
    pt: "Portuguese",
    por: "Portuguese",
    portuguese: "Portuguese",
    português: "Portuguese",
    portugues: "Portuguese",
    en: "English",
    eng: "English",
    english: "English",
    fr: "French",
    fra: "French",
    french: "French",
  };

  return map[lower] || l;
}

async function generateAcademicArticlesExcel(
  articles: UnifiedArticle[],
  options?: {
    plan?: AcademicArticlesExportPlan;
    stats?: AcademicArticlesExportResult["stats"];
    debug?: AcademicArticlesExportDebug;
  }
): Promise<Buffer> {
  // Columns: Authors Title Year Journal Abstract Keywords Language Document Type DOI City of publication Country of study Scopus
  const sorted = [...articles].sort((a, b) => {
    const aKey = (a.authors?.[0] || "").toLowerCase();
    const bKey = (b.authors?.[0] || "").toLowerCase();
    if (aKey !== bKey) return aKey.localeCompare(bKey);
    const at = (a.title || "").toLowerCase();
    const bt = (b.title || "").toLowerCase();
    if (at !== bt) return at.localeCompare(bt);
    return (b.year || "").localeCompare(a.year || "");
  });

  const workbook = new ExcelJS.Workbook();
  workbook.creator = "IliaGPT";
  workbook.created = new Date();

  const sheet = workbook.addWorksheet("Articles", {
    views: [{ state: "frozen", ySplit: 1 }],
  });

  sheet.columns = [
    { header: "Authors", key: "authors", width: 40 },
    { header: "Title", key: "title", width: 60 },
    { header: "Year", key: "year", width: 8 },
    { header: "Journal", key: "journal", width: 30 },
    { header: "Abstract", key: "abstract", width: 80 },
    { header: "Keywords", key: "keywords", width: 35 },
    { header: "Language", key: "language", width: 12 },
    { header: "Document Type", key: "documentType", width: 18 },
    { header: "DOI", key: "doi", width: 28 },
    { header: "City of publication", key: "city", width: 22 },
    { header: "Country of study", key: "country", width: 22 },
    { header: "Scopus", key: "scopus", width: 10 },
  ];

  // Style header row
  const headerRow = sheet.getRow(1);
  headerRow.font = { bold: true, color: { argb: "FFFFFFFF" } };
  headerRow.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF1A365D" } };
  headerRow.alignment = { vertical: "middle", horizontal: "center", wrapText: true };
  headerRow.height = 22;

  for (const a of sorted) {
    sheet.addRow({
      authors: a.authors?.join(", ") || "n.d.",
      title: a.title || "n.d.",
      year: a.year || "n.d.",
      journal: a.journal || "n.d.",
      abstract: a.abstract || "n.d.",
      keywords: (a.keywords || []).join(", ") || "n.d.",
      language: normalizeLanguageLabel(a.language),
      documentType: a.documentType || "Article",
      doi: a.doi ? `🔗 https://doi.org/${a.doi}` : "",
      city: a.city || "n.d.",
      country: a.country || "n.d.",
      scopus: a.source === "scopus" ? "Yes" : "No",
    });
  }

  // Style rows (wrap long text)
  for (let rowIdx = 2; rowIdx <= sheet.rowCount; rowIdx++) {
    const row = sheet.getRow(rowIdx);
    row.alignment = { vertical: "top", wrapText: true };
  }

  // Auto-filter
  const lastColLetter = sheet.getColumn(sheet.columnCount).letter;
  sheet.autoFilter = {
    from: "A1",
    to: `${lastColLetter}1`,
  };

  // ---------------------------------------------------------------------------
  // Diagnostics sheet (coverage/errors/query variants/etc.)
  // ---------------------------------------------------------------------------
  const diag = workbook.addWorksheet("Diagnostics", {
    views: [{ state: "frozen", ySplit: 1 }],
  });

  diag.columns = [
    { header: "Category", key: "category", width: 18 },
    { header: "Key", key: "key", width: 26 },
    { header: "Value", key: "value", width: 120 },
    { header: "Notes", key: "notes", width: 50 },
  ];

  const diagHeader = diag.getRow(1);
  diagHeader.font = { bold: true, color: { argb: "FFFFFFFF" } };
  diagHeader.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF0B3D2E" } };
  diagHeader.alignment = { vertical: "middle", horizontal: "center", wrapText: true };
  diagHeader.height = 20;

  const addDiag = (category: string, key: string, value: string, notes?: string) => {
    diag.addRow({ category, key, value, notes: notes || "" });
  };

  const plan = options?.plan;
  const stats = options?.stats;
  const debug = options?.debug;

  if (plan) {
    addDiag("plan", "topic", plan.topicQuery || "n.d.");
    addDiag("plan", "requestedCount", String(plan.requestedCount));
    addDiag("plan", "yearRange", plan.yearFrom && plan.yearTo ? `${plan.yearFrom}-${plan.yearTo}` : "n.d.");
    addDiag("plan", "region", [
      plan.region.latam ? "LatAm" : null,
      plan.region.spain ? "Spain" : null,
    ].filter(Boolean).join(" + ") || "n.d.");
    addDiag("plan", "geoStrict", plan.geoStrict ? "true" : "false", plan.geoStrict ? (plan.geoStrictMode || "all") : "");
    addDiag("plan", "sources", (plan.sources || []).join(", ") || "n.d.");
  }

  if (stats) {
    addDiag("result", "returned", `${stats.totalReturned}/${stats.totalRequested}`);
    const sourcesLine = Object.entries(stats.bySource || {})
      .sort((a, b) => b[1] - a[1])
      .map(([k, v]) => `${k}:${v}`)
      .join(", ");
    addDiag("result", "bySource", sourcesLine || "n.d.");

    const cov = stats.coverage;
    if (cov) {
      for (const field of Object.keys(cov) as Array<keyof typeof cov>) {
        const c = cov[field];
        const total = c.present + c.missing;
        const pct = total ? Math.round((c.present / total) * 100) : 0;
        addDiag("coverage", String(field), `${c.present}/${total}`, `${pct}%`);
      }
    }

    for (const n of stats.notes || []) addDiag("notes", "", n);
  }

  if (debug) {
    for (const q of debug.queryVariants || []) addDiag("queries", "", q);
    addDiag(
      "counts",
      "pool",
      `total=${debug.candidateCounts.total}; deduped=${debug.candidateCounts.deduped}; region=${debug.candidateCounts.regionFiltered}`,
      `enrichPool=${debug.candidateCounts.enrichPool}; enrichedDeduped=${debug.candidateCounts.enrichedDeduped}; enrichedRegion=${debug.candidateCounts.enrichedRegionFiltered}; final=${debug.candidateCounts.final}`
    );
    if (debug.jsonReportPath) addDiag("result", "jsonReportPath", debug.jsonReportPath);
    for (const e of debug.errors || []) addDiag("errors", "", e);
  }

  // Wrap text
  for (let rowIdx = 2; rowIdx <= diag.rowCount; rowIdx++) {
    const row = diag.getRow(rowIdx);
    row.alignment = { vertical: "top", wrapText: true };
  }

  // ---------------------------------------------------------------------------
  // Provenance sheet (who filled which fields)
  // ---------------------------------------------------------------------------
  const prov = workbook.addWorksheet("Provenance", {
    views: [{ state: "frozen", ySplit: 1 }],
  });

  prov.columns = [
    { header: "DOI", key: "doi", width: 28 },
    { header: "Title", key: "title", width: 60 },
    { header: "Field", key: "field", width: 18 },
    { header: "Value", key: "value", width: 70 },
    { header: "Source", key: "source", width: 14 },
    { header: "Confidence", key: "confidence", width: 12 },
    { header: "Note", key: "note", width: 40 },
  ];

  const provHeader = prov.getRow(1);
  provHeader.font = { bold: true, color: { argb: "FFFFFFFF" } };
  provHeader.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF1A365D" } };
  provHeader.alignment = { vertical: "middle", horizontal: "center", wrapText: true };
  provHeader.height = 20;

  const fieldValue = (a: UnifiedArticle, f: ArticleField): string => {
    switch (f) {
      case "authors": return (a.authors || []).join(", ");
      case "keywords": return (a.keywords || []).join(", ");
      case "abstract": return (a.abstract || "").slice(0, 500);
      case "publicationDate": return a.publicationDate || "";
      case "title": return a.title || "";
      case "year": return a.year || "";
      case "journal": return a.journal || "";
      case "language": return a.language || "";
      case "documentType": return a.documentType || "";
      case "doi": return a.doi || "";
      case "url": return a.url || "";
      case "volume": return a.volume || "";
      case "issue": return a.issue || "";
      case "pages": return a.pages || "";
      case "city": return a.city || "";
      case "country": return a.country || "";
      default: return "";
    }
  };

  for (const a of sorted) {
    const fp = a.fieldProvenance || {};
    for (const [field, provInfo] of Object.entries(fp) as Array<[ArticleField, FieldProvenance]>) {
      prov.addRow({
        doi: a.doi || "",
        title: a.title || "",
        field,
        value: fieldValue(a, field),
        source: provInfo.source,
        confidence: typeof provInfo.confidence === "number" ? provInfo.confidence.toFixed(2) : "",
        note: provInfo.note || "",
      });
    }
  }

  for (let rowIdx = 2; rowIdx <= prov.rowCount; rowIdx++) {
    const row = prov.getRow(rowIdx);
    row.alignment = { vertical: "top", wrapText: true };
  }

  return Buffer.from(await workbook.xlsx.writeBuffer());
}

export async function exportAcademicArticlesFromPrompt(prompt: string): Promise<AcademicArticlesExportResult> {
  const plan = planAcademicArticlesExport(prompt);
  const allowedCountries = plan.affilCountries ? new Set(plan.affilCountries.map(normalizeCountry)) : null;
  const allowedCountryCodesArr = affilCountriesToIso2Codes(plan.affilCountries);
  const allowedCountryCodes = allowedCountryCodesArr ? new Set(allowedCountryCodesArr.map((c) => c.toUpperCase())) : null;

  const notes: string[] = [];

  const sources = plan.sources.filter((s) => {
    if (s === "scopus") {
      const ok = unifiedArticleSearch.isScopusConfigured();
      if (!ok) notes.push("Scopus no esta configurado (faltante SCOPUS_API_KEY).");
      return ok;
    }
    if (s === "wos") {
      const ok = typeof (unifiedArticleSearch as any).isWosConfigured === "function"
        ? (unifiedArticleSearch as any).isWosConfigured()
        : false;
      if (!ok) notes.push("Web of Science no esta configurado (faltante WOS_API_KEY).");
      return ok;
    }
    if (s === "pubmed") return unifiedArticleSearch.isPubMedConfigured();
    if (s === "scielo") return unifiedArticleSearch.isSciELOConfigured();
    if (s === "redalyc") return unifiedArticleSearch.isRedalycConfigured();
    if (s === "openalex") return true;
    if (s === "duckduckgo") return true;
    return true;
  });

  const internalMaxResults = Math.min(1200, Math.max(400, plan.requestedCount * 8));
  const internalMaxPerSource = Math.min(800, Math.max(120, plan.requestedCount * 4));
  const dateFrom = Number.isFinite(plan.yearFrom as number) ? new Date(Date.UTC(plan.yearFrom as number, 0, 1, 0, 0, 0)) : null;
  const dateTo = Number.isFinite(plan.yearTo as number) ? new Date(Date.UTC(plan.yearTo as number, 11, 31, 23, 59, 59)) : null;

  function normalizeTextKey(text: string): string {
    return (text || "")
      .toLowerCase()
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .replace(/[^\w\s]/g, " ")
      .replace(/\s+/g, " ")
      .trim();
  }

  function normalizeTitleKey(title: string): string {
    return normalizeTextKey(title).substring(0, 140);
  }

  function normalizeDoi(doi: string | undefined): string | undefined {
    const d = (doi || "").trim();
    if (!d) return undefined;
    return d
      .replace(/^https?:\/\/doi\.org\//i, "")
      .replace(/^doi:\s*/i, "")
      .replace(/[\s]+/g, "")
      .replace(/[),.;]+$/g, "")
      .trim();
  }

  function isMissingScalar(value: string | undefined): boolean {
    const v = (value || "").trim().toLowerCase();
    return !v || v === "n.d." || v === "unknown" || v === "latam";
  }

  function parsePublicationDate(value: string | undefined): Date | null {
    const v = (value || "").trim();
    if (!v) return null;
    // Accept YYYY or YYYY-MM or YYYY-MM-DD
    const m = v.match(/^(\d{4})(?:-(\d{2}))?(?:-(\d{2}))?/);
    if (!m) return null;
    const y = parseInt(m[1], 10);
    const mo = m[2] ? parseInt(m[2], 10) : 1;
    const d = m[3] ? parseInt(m[3], 10) : 1;
    if (!Number.isFinite(y)) return null;
    return new Date(Date.UTC(y, Math.max(0, Math.min(11, mo - 1)), Math.max(1, Math.min(31, d)), 0, 0, 0));
  }

  function isAllowedByDateRange(article: UnifiedArticle): boolean {
    if (!dateFrom && !dateTo) return true;

    const pd = parsePublicationDate(article.publicationDate);
    if (pd) {
      if (dateFrom && pd < dateFrom) return false;
      if (dateTo && pd > dateTo) return false;
      return true;
    }

    const y = parseInt((article.year || "").trim(), 10);
    if (Number.isFinite(y)) {
      if (plan.yearFrom && y < plan.yearFrom) return false;
      if (plan.yearTo && y > plan.yearTo) return false;
    }
    return true;
  }

  function hasMeaningfulAbstract(value: string | undefined): boolean {
    const v = (value || "").trim();
    if (!v) return false;
    if (v.toLowerCase() === "n.d.") return false;
    return v.length >= 60;
  }

  const baseSourceConfidence: Record<FieldProvenanceSource, number> = {
    scopus: 0.95,
    wos: 0.9,
    openalex: 0.85,
    scielo: 0.8,
    redalyc: 0.78,
    duckduckgo: 0.65,
    pubmed: 0.8,
    crossref: 0.92,
    generated: 0.3,
    inferred: 0.55,
    unknown: 0.1,
  };

  function ensureProvenance(article: UnifiedArticle): NonNullable<UnifiedArticle["fieldProvenance"]> {
    if (!article.fieldProvenance) article.fieldProvenance = {};
    return article.fieldProvenance!;
  }

  function setProv(
    article: UnifiedArticle,
    field: ArticleField,
    source: FieldProvenanceSource,
    confidence: number,
    note?: string
  ): void {
    const fp = ensureProvenance(article);
    fp[field] = { source, confidence: Math.max(0, Math.min(1, confidence)), note };
  }

  function initProvenanceFromSource(article: UnifiedArticle): UnifiedArticle {
    const out: UnifiedArticle = { ...article };
    const fp = ensureProvenance(out);
    const source = (out.source || "unknown") as FieldProvenanceSource;
    const conf = baseSourceConfidence[source] ?? 0.7;

    const setIfPresent = (field: ArticleField, present: boolean, note?: string) => {
      if (!present) return;
      if (fp[field]) return;
      fp[field] = { source, confidence: conf, note };
    };

    setIfPresent("title", !isMissingScalar(out.title));
    setIfPresent("authors", (out.authors || []).length > 0);
    setIfPresent("year", !isMissingScalar(out.year));
    setIfPresent("publicationDate", !isMissingScalar(out.publicationDate));
    setIfPresent("journal", !isMissingScalar(out.journal));
    setIfPresent("abstract", hasMeaningfulAbstract(out.abstract));
    setIfPresent("keywords", (out.keywords || []).length > 0);
    setIfPresent("language", !isMissingScalar(out.language));
    setIfPresent("documentType", !isMissingScalar(out.documentType));
    setIfPresent("doi", !!normalizeDoi(out.doi));
    setIfPresent("url", !isMissingScalar(out.url));
    setIfPresent("volume", !isMissingScalar(out.volume));
    setIfPresent("issue", !isMissingScalar(out.issue));
    setIfPresent("pages", !isMissingScalar(out.pages));
    setIfPresent("city", !isMissingScalar(out.city));
    setIfPresent("country", !isMissingScalar(out.country));

    return out;
  }

  function completenessScore(a: UnifiedArticle): number {
    let score = 0;
    if (!isMissingScalar(a.year)) score += 1;
    if (!isMissingScalar(a.journal)) score += 1;
    if (hasMeaningfulAbstract(a.abstract)) score += 2;
    if ((a.keywords || []).length > 0) score += 2;
    if (!isMissingScalar(a.language)) score += 1;
    if (!isMissingScalar(a.documentType)) score += 1;
    if (!isMissingScalar(a.doi)) score += 2;
    if (!isMissingScalar(a.country)) score += 2;
    if (!isMissingScalar(a.city)) score += 1;
    return score;
  }

  function chooseBetter(existing: UnifiedArticle, incoming: UnifiedArticle): UnifiedArticle {
    const aScore = completenessScore(existing);
    const bScore = completenessScore(incoming);
    if (bScore !== aScore) return bScore > aScore ? incoming : existing;

    const aAbs = (existing.abstract || "").length;
    const bAbs = (incoming.abstract || "").length;
    if (bAbs !== aAbs) return bAbs > aAbs ? incoming : existing;

    const aKw = (existing.keywords || []).length;
    const bKw = (incoming.keywords || []).length;
    if (bKw !== aKw) return bKw > aKw ? incoming : existing;

    // Prefer Scopus if tie.
    const rank: Record<string, number> = { scopus: 5, wos: 4, openalex: 3, scielo: 2, redalyc: 2, duckduckgo: 1, pubmed: 1 };
    const ar = rank[existing.source] || 0;
    const br = rank[incoming.source] || 0;
    if (br !== ar) return br > ar ? incoming : existing;

    return existing;
  }

  function dedupeUnifiedArticles(articles: UnifiedArticle[]): UnifiedArticle[] {
    const map = new Map<string, UnifiedArticle>();
    for (const a of articles) {
      const doi = normalizeDoi(a.doi);
      const key = doi ? `doi:${doi.toLowerCase()}` : `title:${normalizeTitleKey(a.title)}`;
      const prev = map.get(key);
      if (!prev) {
        map.set(key, { ...a, doi: doi || a.doi });
        continue;
      }
      map.set(key, chooseBetter(prev, { ...a, doi: doi || a.doi }));
    }
    return Array.from(map.values());
  }

  function buildQueryVariants(topic: string): string[] {
    const base = (topic || "").trim();
    if (!base) return [];

    const variants: string[] = [base];

    const ascii = base.normalize("NFD").replace(/[\u0300-\u036f]/g, "");
    if (ascii !== base) variants.push(ascii);

    // Lightweight domain translation (helps OpenAlex recall).
    let en = ascii;
    const replacements: Array<[RegExp, string]> = [
      [/\beconomia\s+circular\b/gi, "circular economy"],
      [/\beconom[ií]a\s+circular\b/gi, "circular economy"],
      [/\bcadena\s+de\s+suministro\b/gi, "supply chain"],
      [/\bempresa(?:s)?\s+exportadora(?:s)?\b/gi, "exporting company"],
      [/\bexportadora(?:s)?\b/gi, "exporter"],
      [/\bimpacto\b/gi, "impact"],
      [/\blog[ií]stica\b/gi, "logistics"],
      [/\bsostenibilidad\b/gi, "sustainability"],
    ];
    for (const [re, rep] of replacements) {
      en = en.replace(re, rep);
    }
    if (en !== base && en !== ascii) variants.push(en);

    // Core terms only
    variants.push("circular economy supply chain");
    variants.push("circular economy supply chain exporter");

    return Array.from(new Set(variants.map(v => v.trim()).filter(Boolean)));
  }

  function tokenSet(title: string): Set<string> {
    return new Set(
      normalizeTextKey(title)
        .split(" ")
        .filter(Boolean)
        .filter((t) => t.length >= 3 && !["the", "and", "for", "with", "from", "sobre", "para", "del", "una", "uno", "los", "las", "que", "de", "en"].includes(t))
    );
  }

  function titleSimilarity(a: string, b: string): number {
    const A = tokenSet(a);
    const B = tokenSet(b);
    if (A.size === 0 || B.size === 0) return 0;
    let inter = 0;
    for (const t of A) if (B.has(t)) inter++;
    const union = A.size + B.size - inter;
    return union === 0 ? 0 : inter / union;
  }

  async function mapLimit<T, R>(items: T[], limit: number, fn: (item: T, idx: number) => Promise<R>): Promise<R[]> {
    const results: R[] = new Array(items.length);
    let next = 0;
    const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
      while (true) {
        const i = next++;
        if (i >= items.length) return;
        results[i] = await fn(items[i], i);
      }
    });
    await Promise.all(workers);
    return results;
  }

  function mergeKeywords(...lists: Array<string[] | undefined>): string[] {
    const out: string[] = [];
    const seen = new Set<string>();
    for (const l of lists) {
      for (const k of l || []) {
        const kw = (k || "").trim();
        if (!kw) continue;
        const key = kw.toLowerCase();
        if (seen.has(key)) continue;
        seen.add(key);
        out.push(kw);
      }
    }
    return out;
  }

  const KEYWORD_STOPWORDS = new Set<string>([
    // English
    "a", "an", "the", "and", "or", "of", "in", "on", "for", "with", "to", "from", "by", "at",
    "is", "are", "was", "were", "be", "been", "being", "as", "it", "its", "into", "this", "that",
    "these", "those", "we", "our", "their", "they", "them",
    // Spanish
    "el", "la", "los", "las", "un", "una", "unos", "unas", "y", "o", "de", "del", "al", "en",
    "para", "por", "con", "sin", "sobre", "entre", "desde", "hacia", "que", "se", "su", "sus",
    "es", "son", "fue", "fueron", "ser", "como", "más", "mas",
    // Portuguese
    "o", "a", "os", "as", "um", "uma", "uns", "umas", "e", "ou", "de", "do", "da", "dos", "das",
    "em", "para", "por", "com", "sem", "sobre", "entre", "desde", "que", "se", "sua", "suas",
    // Generic academic glue
    "study", "studies", "analysis", "results", "method", "methods", "approach",
    "articulo", "articulos", "artículo", "artículos", "estudio", "estudios",
  ]);

  function generateKeywordsFallback(title: string, abstract: string, maxKeywords: number = 10): string[] {
    const text = normalizeTextKey(`${title || ""} ${abstract || ""}`);
    const tokens = text
      .split(/\s+/)
      .map((t) => t.trim())
      .filter(Boolean)
      .filter((t) => t.length >= 3)
      .filter((t) => !KEYWORD_STOPWORDS.has(t))
      .filter((t) => !/^\d+$/.test(t));

    if (tokens.length === 0) return [];

    const uni = new Map<string, number>();
    const bi = new Map<string, number>();

    for (let i = 0; i < tokens.length; i++) {
      const t = tokens[i];
      uni.set(t, (uni.get(t) || 0) + 1);
      if (i < tokens.length - 1) {
        const b = `${tokens[i]} ${tokens[i + 1]}`;
        bi.set(b, (bi.get(b) || 0) + 1);
      }
    }

    const pick: string[] = [];
    const seen = new Set<string>();

    const bigrams = Array.from(bi.entries())
      .filter(([_, c]) => c >= 2)
      .sort((a, b) => b[1] - a[1])
      .map(([k]) => k);

    for (const k of bigrams) {
      if (pick.length >= Math.ceil(maxKeywords / 2)) break;
      const key = k.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      pick.push(k);
    }

    const unigrams = Array.from(uni.entries())
      .sort((a, b) => b[1] - a[1])
      .map(([k]) => k);

    for (const k of unigrams) {
      if (pick.length >= maxKeywords) break;
      const key = k.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      pick.push(k);
    }

    return pick;
  }

  function mergeAuthors(primary: string[], secondary: string[] | undefined): string[] {
    if (primary && primary.length > 0) return primary;
    return (secondary || []).filter(Boolean);
  }

  const doiCrossrefCache = new Map<string, Promise<VerifyDOIResult | null>>();
  const doiOpenAlexCache = new Map<string, Promise<AcademicCandidate | null>>();
  const titleDoiCache = new Map<string, Promise<string | undefined>>();

  async function resolveDoiByTitle(title: string): Promise<string | undefined> {
    const key = normalizeTitleKey(title);
    if (!key) return undefined;

    const cached = titleDoiCache.get(key);
    if (cached) return await cached;

    const persisted = await persistentJsonCacheGet<{ doi: string | null; score?: number }>("academic.titleToDoi", key);
    if (persisted) return persisted.doi || undefined;

    const looksLikeDoi = (d: string): boolean => /^10\.\d{4,9}\/\S+$/i.test((d || "").trim());

    const p = (async () => {
      const candidates = await searchCrossRef(title, {
        yearStart: plan.yearFrom,
        yearEnd: plan.yearTo,
        maxResults: 5,
      });

      let best: { doi: string; score: number } | null = null;
      for (const c of candidates) {
        if (!c.doi) continue;
        const doi = normalizeDoi(c.doi);
        if (!doi || !looksLikeDoi(doi)) continue;

        const sim = titleSimilarity(title, c.title);
        if (sim <= 0) continue;

        let s = sim;
        const y = Number.isFinite(c.year as any) ? (c.year as any as number) : 0;
        if (plan.yearFrom && plan.yearTo && y) {
          if (y < plan.yearFrom || y > plan.yearTo) s *= 0.6;
          else s = s * 0.85 + 0.15;
        }

        if (!best || s > best.score) best = { doi: c.doi, score: s };
      }

      if (!best || best.score < 0.55) {
        await persistentJsonCacheSet("academic.titleToDoi", key, { doi: null }, 1000 * 60 * 60 * 24 * 2);
        return undefined;
      }

      const resolved = normalizeDoi(best.doi);
      if (!resolved) {
        await persistentJsonCacheSet("academic.titleToDoi", key, { doi: null }, 1000 * 60 * 60 * 24 * 2);
        return undefined;
      }

      await persistentJsonCacheSet("academic.titleToDoi", key, { doi: resolved, score: best.score }, 1000 * 60 * 60 * 24 * 60);
      return resolved;
    })();

    titleDoiCache.set(key, p);
    return await p;
  }

  async function getCrossref(doi: string): Promise<VerifyDOIResult | null> {
    const key = doi.toLowerCase();
    const cached = doiCrossrefCache.get(key);
    if (cached) return await cached;

    const p = (async () => {
      const res = await verifyDOI(doi);
      return res.valid ? res : null;
    })();

    doiCrossrefCache.set(key, p);
    return await p;
  }

  async function getOpenAlex(doi: string): Promise<AcademicCandidate | null> {
    const key = doi.toLowerCase();
    const cached = doiOpenAlexCache.get(key);
    if (cached) return await cached;

    const p = lookupOpenAlexWorkByDoi(doi).catch(() => null);
    doiOpenAlexCache.set(key, p);
    return await p;
  }

  async function enrichOne(article: UnifiedArticle): Promise<UnifiedArticle> {
    const out: UnifiedArticle = { ...article };
    ensureProvenance(out);

    // Step 1: DOI resolution (if missing)
    const currentDoi = normalizeDoi(out.doi);
    if (!currentDoi) {
      const resolved = await resolveDoiByTitle(out.title);
      if (resolved) {
        out.doi = resolved;
        if (!out.url) out.url = `https://doi.org/${resolved}`;
        setProv(out, "doi", "crossref", 0.75, "resolved from title");
        if (out.url) setProv(out, "url", "crossref", 0.7, "doi url");
      }
    } else {
      out.doi = currentDoi;
    }

    const doi = normalizeDoi(out.doi);
    if (!doi) return out;

    // Step 2: hydrate via Crossref + OpenAlex (in parallel, but only if needed).
    // Important: avoid hammering external APIs when the record is already complete enough.
    const needsCrossref =
      (!out.authors || out.authors.length === 0) ||
      isMissingScalar(out.year) ||
      isMissingScalar(out.publicationDate) ||
      isMissingScalar(out.journal) ||
      isMissingScalar(out.volume) ||
      isMissingScalar(out.issue) ||
      isMissingScalar(out.pages) ||
      !hasMeaningfulAbstract(out.abstract) ||
      (out.keywords || []).length === 0 ||
      isMissingScalar(out.language) ||
      isMissingScalar(out.documentType) ||
      !out.url;

    const needsOpenAlex =
      (!out.authors || out.authors.length === 0) ||
      isMissingScalar(out.year) ||
      isMissingScalar(out.publicationDate) ||
      isMissingScalar(out.journal) ||
      !hasMeaningfulAbstract(out.abstract) ||
      (out.keywords || []).length === 0 ||
      isMissingScalar(out.language) ||
      isMissingScalar(out.documentType) ||
      !out.url;

    const [cr, oa] = await Promise.all([
      needsCrossref ? getCrossref(doi) : Promise.resolve(null),
      needsOpenAlex ? getOpenAlex(doi) : Promise.resolve(null),
    ]);

    // Authors
    if (!out.authors || out.authors.length === 0) {
      if (cr?.authors && cr.authors.length > 0) {
        out.authors = cr.authors;
        setProv(out, "authors", "crossref", 0.92);
      } else if (oa?.authors && oa.authors.length > 0) {
        out.authors = oa.authors;
        setProv(out, "authors", "openalex", 0.85);
      }
    }

    // Year
    if (isMissingScalar(out.year) && cr?.year) {
      out.year = String(cr.year);
      setProv(out, "year", "crossref", 0.92);
    }
    if (isMissingScalar(out.year) && oa?.year) {
      out.year = String(oa.year);
      setProv(out, "year", "openalex", 0.85);
    }

    // Publication date (prefer OpenAlex publication_date for early-access handling)
    if (isMissingScalar(out.publicationDate) && oa?.publicationDate) {
      out.publicationDate = oa.publicationDate;
      setProv(out, "publicationDate", "openalex", 0.85);
    }
    if (isMissingScalar(out.publicationDate) && cr?.publicationDate) {
      out.publicationDate = cr.publicationDate;
      setProv(out, "publicationDate", "crossref", 0.9);
    }

    // Journal
    if (isMissingScalar(out.journal) && oa?.journal) {
      out.journal = oa.journal;
      setProv(out, "journal", "openalex", 0.85);
    }
    if (isMissingScalar(out.journal) && cr?.journal) {
      out.journal = cr.journal;
      setProv(out, "journal", "crossref", 0.92);
    }

    // Volume/issue/pages (Crossref is best)
    if (isMissingScalar(out.volume) && cr?.volume) {
      out.volume = cr.volume;
      setProv(out, "volume", "crossref", 0.9);
    }
    if (isMissingScalar(out.issue) && cr?.issue) {
      out.issue = cr.issue;
      setProv(out, "issue", "crossref", 0.9);
    }
    if (isMissingScalar(out.pages) && cr?.pages) {
      out.pages = cr.pages;
      setProv(out, "pages", "crossref", 0.85);
    }

    // Abstract
    if (!hasMeaningfulAbstract(out.abstract) && oa?.abstract) {
      out.abstract = oa.abstract;
      setProv(out, "abstract", "openalex", 0.82);
    }
    if (!hasMeaningfulAbstract(out.abstract) && cr?.abstract) {
      out.abstract = cr.abstract;
      setProv(out, "abstract", "crossref", 0.85);
    }

    // Keywords
    const hadKeywords = (out.keywords || []).length > 0;
    const mergedKeywords = hadKeywords
      ? mergeKeywords(out.keywords, oa?.keywords, cr?.keywords)
      : mergeKeywords(oa?.keywords, cr?.keywords);
    out.keywords = mergedKeywords;

    if (!hadKeywords && mergedKeywords.length > 0) {
      if ((oa?.keywords || []).length > 0 && (cr?.keywords || []).length > 0) {
        setProv(out, "keywords", "inferred", 0.65, "merged openalex + crossref");
      } else if ((oa?.keywords || []).length > 0) {
        setProv(out, "keywords", "openalex", 0.75);
      } else if ((cr?.keywords || []).length > 0) {
        setProv(out, "keywords", "crossref", 0.78);
      }
    }

    if ((out.keywords || []).length === 0) {
      const generated = generateKeywordsFallback(out.title, out.abstract, 10);
      if (generated.length > 0) {
        out.keywords = generated;
        setProv(out, "keywords", "generated", 0.3, "extracted from title/abstract");
      }
    }
    if ((out.keywords || []).length > 15) out.keywords = (out.keywords || []).slice(0, 15);

    // Language
    if (isMissingScalar(out.language) && oa?.language) {
      out.language = oa.language;
      setProv(out, "language", "openalex", 0.8);
    }
    if (isMissingScalar(out.language) && cr?.language) {
      out.language = cr.language;
      setProv(out, "language", "crossref", 0.82);
    }

    // Document type
    if (isMissingScalar(out.documentType) && oa?.documentType) {
      out.documentType = oa.documentType;
      setProv(out, "documentType", "openalex", 0.75);
    }
    if (isMissingScalar(out.documentType) && cr?.documentType) {
      out.documentType = cr.documentType;
      setProv(out, "documentType", "crossref", 0.78);
    }

    // City / Country
    if (isMissingScalar(out.country) && oa?.country) {
      out.country = oa.country;
      setProv(out, "country", "openalex", 0.7, "from affiliations");
    }
    if (isMissingScalar(out.country) && cr?.country) {
      out.country = cr.country;
      setProv(out, "country", "crossref", 0.75, "from affiliations");
    }
    if (isMissingScalar(out.city) && oa?.city) {
      out.city = oa.city;
      setProv(out, "city", "openalex", 0.65, "from affiliations");
    }
    if (isMissingScalar(out.city) && cr?.city) {
      out.city = cr.city;
      setProv(out, "city", "crossref", 0.7, "from affiliations");
    }

    // Geo helpers for strict mode
    if ((!out.institutionCountryCodes || out.institutionCountryCodes.length === 0) && oa?.institutionCountryCodes?.length) {
      out.institutionCountryCodes = oa.institutionCountryCodes;
    }
    if (!out.primaryInstitutionCountryCode && oa?.primaryInstitutionCountryCode) {
      out.primaryInstitutionCountryCode = oa.primaryInstitutionCountryCode;
    }

    // URL
    if (!out.url && oa?.doiUrl) {
      out.url = oa.doiUrl;
      setProv(out, "url", "openalex", 0.8, "doi url");
    }
    if (!out.url && oa?.landingUrl) {
      out.url = oa.landingUrl;
      setProv(out, "url", "openalex", 0.7, "landing page");
    }

    return out;
  }

  function computeCoverage(articles: UnifiedArticle[]): AcademicArticlesExportResult["stats"]["coverage"] {
    const keys = ["doi", "abstract", "keywords", "journal", "city", "country", "language", "documentType"] as const;
    const cov: any = {};
    for (const k of keys) cov[k] = { present: 0, missing: 0 };

    for (const a of articles) {
      cov.doi[normalizeDoi(a.doi) ? "present" : "missing"]++;
      cov.journal[!isMissingScalar(a.journal) ? "present" : "missing"]++;
      cov.abstract[hasMeaningfulAbstract(a.abstract) ? "present" : "missing"]++;
      cov.keywords[(a.keywords || []).length > 0 ? "present" : "missing"]++;
      cov.language[!isMissingScalar(a.language) ? "present" : "missing"]++;
      cov.documentType[!isMissingScalar(a.documentType) ? "present" : "missing"]++;
      cov.city[!isMissingScalar(a.city) ? "present" : "missing"]++;
      cov.country[!isMissingScalar(a.country) ? "present" : "missing"]++;
    }

    return cov;
  }

  // 1) Fetch a large candidate pool (variants help reach 100 under strict geo filters)
  const queries = buildQueryVariants(plan.topicQuery);
  const allCandidates: UnifiedArticle[] = [];
  const allErrors: string[] = [];

  for (let i = 0; i < queries.length; i++) {
    const q = queries[i];
    const variantSources = i === 0
      ? sources
      : sources.filter((s) => s === "openalex" || s === "duckduckgo");

    const searchResult = await unifiedArticleSearch.searchAllSources(q, {
      maxResults: internalMaxResults,
      maxPerSource: internalMaxPerSource,
      startYear: plan.yearFrom,
      endYear: plan.yearTo,
      sources: variantSources,
      affilCountries: plan.affilCountries,
    });

    allCandidates.push(...searchResult.articles.map(initProvenanceFromSource));
    allErrors.push(...(searchResult.errors || []));

    const deduped = dedupeUnifiedArticles(allCandidates);
    const filtered = deduped.filter((a) =>
      isAllowedByRegion(a, plan, allowedCountries, allowedCountryCodes) && isAllowedByDateRange(a)
    );

    // Once we have enough pool, stop searching to keep latency bounded.
    if (filtered.length >= Math.max(plan.requestedCount * 2, plan.requestedCount + 30)) {
      break;
    }
  }

  const dedupedPool = dedupeUnifiedArticles(allCandidates);
  const regionFilteredPool = dedupedPool.filter((a) =>
    isAllowedByRegion(a, plan, allowedCountries, allowedCountryCodes) && isAllowedByDateRange(a)
  );

  // 2) Enrich the top pool to maximize completeness
  const enrichPool = regionFilteredPool
    .slice(0, Math.min(regionFilteredPool.length, Math.max(180, plan.requestedCount * 3)));

  const enrichedPool = await mapLimit(enrichPool, 6, async (a) => enrichOne(a));
  const enrichedDeduped = dedupeUnifiedArticles(enrichedPool);
  const enrichedRegionFiltered = enrichedDeduped.filter((a) =>
    isAllowedByRegion(a, plan, allowedCountries, allowedCountryCodes) && isAllowedByDateRange(a)
  );

  // 3) Rank by completeness, then source preference, then year desc
  const sourceRank: Record<string, number> = { scopus: 5, wos: 4, openalex: 3, scielo: 2, redalyc: 2, duckduckgo: 1, pubmed: 1 };
  const ranked = [...enrichedRegionFiltered].sort((a, b) => {
    const sa = completenessScore(a);
    const sb = completenessScore(b);
    if (sb !== sa) return sb - sa;
    const ra = sourceRank[a.source] || 0;
    const rb = sourceRank[b.source] || 0;
    if (rb !== ra) return rb - ra;
    const ya = parseInt(a.year || "", 10);
    const yb = parseInt(b.year || "", 10);
    if (Number.isFinite(ya) && Number.isFinite(yb) && yb !== ya) return yb - ya;
    const ak = (a.authors?.[0] || "").toLowerCase();
    const bk = (b.authors?.[0] || "").toLowerCase();
    if (ak !== bk) return ak.localeCompare(bk);
    return (a.title || "").localeCompare(b.title || "");
  });

  const finalArticles = ranked.slice(0, plan.requestedCount);

  if (finalArticles.length < plan.requestedCount) {
    notes.push(`No se lograron ${plan.requestedCount} articulos con los filtros; se encontraron ${finalArticles.length}.`);
  }

  const uniqueErrors = Array.from(new Set(allErrors.map((e) => (e || "").trim()).filter(Boolean)));
  for (const e of uniqueErrors.slice(0, 5)) notes.push(e);

  const bySource: Record<string, number> = {};
  for (const a of finalArticles) bySource[a.source] = (bySource[a.source] || 0) + 1;

  const coverage = computeCoverage(finalArticles);

  const stats: AcademicArticlesExportResult["stats"] = {
    totalReturned: finalArticles.length,
    totalRequested: plan.requestedCount,
    bySource,
    coverage,
    notes,
  };

  const debug: AcademicArticlesExportDebug = {
    queryVariants: queries,
    candidateCounts: {
      total: allCandidates.length,
      deduped: dedupedPool.length,
      regionFiltered: regionFilteredPool.length,
      enrichPool: enrichPool.length,
      enrichedDeduped: enrichedDeduped.length,
      enrichedRegionFiltered: enrichedRegionFiltered.length,
      final: finalArticles.length,
    },
    errors: uniqueErrors,
  };

  // Optional: persist a JSON report for audit/debugging (stored under .local/, ignored by git)
  if (!/^(1|true|yes)$/i.test(process.env.ACADEMIC_JSON_REPORT_DISABLED || "")) {
    try {
      const reportDir = path.join(process.cwd(), ".local", "academic-export");
      await fs.mkdir(reportDir, { recursive: true });
      const reportPath = path.join(reportDir, `academic_export_${Date.now()}.json`);
      debug.jsonReportPath = reportPath;
      const payload = JSON.stringify({ plan, stats, debug, articles: finalArticles }, null, 2);
      await fs.writeFile(reportPath, payload, "utf8");
    } catch (err: any) {
      notes.push(`No se pudo guardar el reporte JSON de diagnostico: ${err?.message || String(err)}`);
    }
  }

  const excelBuffer = await generateAcademicArticlesExcel(finalArticles, { plan, stats, debug });
  const wordBuffer = await generateApaReferencesDocx(plan.topicQuery, finalArticles);

  return {
    plan,
    articles: finalArticles,
    excelBuffer,
    wordBuffer,
    debug,
    stats: {
      ...stats,
    },
  };
}
