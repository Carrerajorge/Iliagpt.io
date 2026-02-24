import { describe, it, expect, vi, beforeEach } from "vitest";
import ExcelJS from "exceljs";
import mammoth from "mammoth";

vi.mock("../agent/superAgent/unifiedArticleSearch", () => {
  const mk = (n: number, partial: any = {}) => ({
    id: `mock_${n}`,
    source: partial.source || "openalex",
    title: partial.title || `Circular economy supply chain article ${n}`,
    authors: partial.authors || [],
    year: partial.year || "2024",
    publicationDate: partial.publicationDate,
    journal: partial.journal || "n.d.",
    abstract: partial.abstract || "",
    keywords: partial.keywords || [],
    doi: partial.doi,
    url: partial.url || "",
    volume: partial.volume,
    issue: partial.issue,
    pages: partial.pages,
    language: partial.language || "en",
    documentType: partial.documentType || "Article",
    city: partial.city,
    country: partial.country,
    institutionCountryCodes: partial.institutionCountryCodes,
    primaryInstitutionCountryCode: partial.primaryInstitutionCountryCode,
    citationCount: partial.citationCount,
    apaCitation: partial.apaCitation || "",
    fieldProvenance: partial.fieldProvenance,
  });

  const articles = [
    // Passing OpenAlex (MX only)
    ...Array.from({ length: 80 }, (_, i) =>
      mk(i, {
        source: "openalex",
        doi: i % 2 === 0 ? `10.5555/mock.${i}` : undefined,
        url: i % 2 === 0 ? `https://doi.org/10.5555/mock.${i}` : "",
        country: "Mexico",
        city: "Mexico City",
        institutionCountryCodes: ["MX"],
        primaryInstitutionCountryCode: "MX",
      })
    ),
    // Passing SciELO with explicit country
    ...Array.from({ length: 25 }, (_, i) =>
      mk(100 + i, {
        source: "scielo",
        doi: `10.5555/scielo.${i}`,
        url: `https://doi.org/10.5555/scielo.${i}`,
        country: "Colombia",
        city: "Bogotá",
        language: "es",
      })
    ),
    // Failing OpenAlex (mixed US+MX) should be dropped in geoStrict=all
    ...Array.from({ length: 15 }, (_, i) =>
      mk(200 + i, {
        source: "openalex",
        doi: `10.5555/bad.${i}`,
        url: `https://doi.org/10.5555/bad.${i}`,
        country: "Mexico",
        institutionCountryCodes: ["US", "MX"],
        primaryInstitutionCountryCode: "US",
      })
    ),
  ];

  return {
    unifiedArticleSearch: {
      isScopusConfigured: () => true,
      isWosConfigured: () => false,
      isPubMedConfigured: () => false,
      isSciELOConfigured: () => true,
      isRedalycConfigured: () => true,
      searchAllSources: vi.fn(async (_query: string) => {
        return {
          articles,
          totalBySource: {
            scopus: 0,
            wos: 0,
            openalex: 95,
            duckduckgo: 0,
            pubmed: 0,
            scielo: 25,
            redalyc: 0,
          },
          query: _query,
          searchTime: 1,
          errors: [],
        };
      }),
      generateExcelReport: () => Buffer.from(""),
      generateAPACitationsList: () => "",
    },
    default: {},
  };
});

vi.mock("../agent/superAgent/crossrefClient", () => {
  return {
    searchCrossRef: vi.fn(async (query: string) => {
      const h = Array.from(query).reduce((acc, ch) => ((acc * 31 + ch.charCodeAt(0)) >>> 0), 0);
      const suffix = h.toString(16);
      const doi = `10.1234/resolved.${suffix}`;
      // Make DOI resolution by title very confident (title match = 1.0)
      return [
        {
          source: "crossref",
          sourceId: doi,
          doi,
          title: query,
          year: 2024,
          publicationDate: "2024-06-01",
          journal: "Journal of Cleaner Production",
          abstract: "",
          authors: ["Perez, Juan"],
          keywords: ["circular economy", "supply chain"],
          language: "en",
          documentType: "article",
          citationCount: 0,
          affiliations: [],
          city: "Unknown",
          country: "Unknown",
          institutionCountryCodes: [],
          landingUrl: "",
          doiUrl: "",
          verified: false,
          relevanceScore: 0,
          verificationStatus: "pending",
        },
      ];
    }),
    verifyDOI: vi.fn(async (doi: string) => {
      return {
        valid: true,
        url: `https://doi.org/${doi}`,
        title: `Resolved ${doi}`,
        year: 2024,
        publicationDate: "2024-06-01",
        authors: ["Perez, Juan", "Garcia, Maria"],
        journal: "Journal of Cleaner Production",
        abstract: "This is a sufficiently long abstract to be considered meaningful for coverage metrics.",
        keywords: ["circular economy", "supply chain", "export"],
        volume: "12",
        issue: "3",
        pages: "45-67",
        city: "Bogotá",
        country: "Colombia",
      };
    }),
  };
});

vi.mock("../agent/superAgent/openAlexClient", () => {
  return {
    lookupOpenAlexWorkByDoi: vi.fn(async (doi: string) => {
      return {
        source: "openalex",
        sourceId: `oa_${doi}`,
        doi,
        title: `OA ${doi}`,
        year: 2024,
        publicationDate: "2024-06-15",
        journal: "Journal of Cleaner Production",
        abstract: "OpenAlex abstract long enough to count as meaningful for enrichment and coverage.",
        authors: ["Perez, Juan"],
        keywords: ["circular economy", "logistics"],
        language: "en",
        documentType: "article",
        citationCount: 10,
        affiliations: ["Universidad Nacional de Colombia"],
        city: "Bogotá",
        country: "Colombia",
        institutionCountryCodes: ["CO"],
        primaryInstitutionCountryCode: "CO",
        landingUrl: `https://example.org/${doi}`,
        doiUrl: `https://doi.org/${doi}`,
        verified: false,
        relevanceScore: 0,
        verificationStatus: "pending",
      };
    }),
  };
});

describe("academicArticlesExport (integration-ish)", () => {
  beforeEach(() => {
    process.env.ACADEMIC_CACHE_DISABLED = "1";
    process.env.ACADEMIC_JSON_REPORT_DISABLED = "1";
  });

  it(
    "returns 100 articles with strict geo filtering, enriches missing fields, and writes Excel+Word outputs",
    async () => {
    const { exportAcademicArticlesFromPrompt } = await import("../services/academicArticlesExport");

    const prompt =
      "buscarme 100 articulos cientificos solo de latinoamerica y españa sobre economía circular en la cadena de suministro del 2021 al 2025 y colocalo en un excel y luego en un word";

    const result = await exportAcademicArticlesFromPrompt(prompt);

    expect(result.plan.geoStrict).toBe(true);
    expect(result.plan.geoStrictMode).toBe("all");
    expect(result.stats.totalReturned).toBe(100);

    // Ensure failing mixed-country OpenAlex works got dropped
    expect(result.articles.some((a) => (a.institutionCountryCodes || []).includes("US"))).toBe(false);

    // Coverage should improve because verifyDOI provides DOI/abstract/keywords/journal for many.
    expect(result.stats.coverage.doi.present).toBeGreaterThan(0);
    expect(result.stats.coverage.abstract.present).toBeGreaterThan(0);

    // Excel: should include diagnostics/provenance sheets
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(result.excelBuffer);
    const sheetNames = wb.worksheets.map((s) => s.name);
    expect(sheetNames).toContain("Articles");
    expect(sheetNames).toContain("Diagnostics");
    expect(sheetNames).toContain("Provenance");

    const articlesSheet = wb.getWorksheet("Articles");
    expect(articlesSheet).toBeTruthy();
    const header = (articlesSheet!.getRow(1).values as any[]).slice(1);
    expect(header).toEqual([
      "Authors",
      "Title",
      "Year",
      "Journal",
      "Abstract",
      "Keywords",
      "Language",
      "Document Type",
      "DOI",
      "City of publication",
      "Country of study",
      "Scopus",
    ]);

    // Provenance sheet should have at least one row for a field
    const provSheet = wb.getWorksheet("Provenance")!;
    expect(provSheet.rowCount).toBeGreaterThan(1);

    // Word: should contain DOI links in extracted text
    const raw = await mammoth.extractRawText({ buffer: result.wordBuffer });
    expect(raw.value).toContain("https://doi.org/");
  },
  60000);
});
