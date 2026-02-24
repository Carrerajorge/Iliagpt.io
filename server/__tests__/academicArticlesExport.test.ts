import { describe, it, expect } from "vitest";
import { planAcademicArticlesExport } from "../services/academicArticlesExport";
import { unifiedArticleSearch, type UnifiedArticle } from "../agent/superAgent/unifiedArticleSearch";
import * as XLSX from "xlsx";

describe("academicArticlesExport", () => {
  it("parses the user's Spanish prompt (count/years/region/topic)", () => {
    const prompt =
      "buscarme 100 articulos cientificos solo de latinoamerica y españa sobre Impacto de la economía circular en la cadena de suministro de una empresas exportadora del 2021 al 2025 y colocalo en un excel ...";

    const plan = planAcademicArticlesExport(prompt);

    expect(plan.requestedCount).toBe(100);
    expect(plan.yearFrom).toBe(2021);
    expect(plan.yearTo).toBe(2025);
    expect(plan.region.latam).toBe(true);
    expect(plan.region.spain).toBe(true);
    expect(plan.topicQuery.toLowerCase()).toContain("economía circular");
    expect(plan.sources).toEqual(["scopus", "openalex", "scielo", "redalyc"]);
    expect(plan.affilCountries || []).toContain("Spain");
    expect(plan.affilCountries || []).toContain("Mexico");
  });

  it("generates Excel with the required header order", () => {
    const articles: UnifiedArticle[] = [
      {
        id: "1",
        source: "scopus",
        title: "Test Title",
        authors: ["Perez, Juan", "Garcia, Maria"],
        year: "2023",
        journal: "Journal of Cleaner Production",
        abstract: "Abstract text",
        keywords: ["circular economy", "supply chain"],
        language: "en",
        documentType: "Article",
        doi: "10.1234/example",
        url: "https://doi.org/10.1234/example",
        city: "Mexico City",
        country: "Mexico",
        apaCitation: "Perez, J. (2023). Test Title. Journal of Cleaner Production. https://doi.org/10.1234/example",
      },
    ];

    const buf = unifiedArticleSearch.generateExcelReport(articles);
    const wb = XLSX.read(buf, { type: "buffer" });
    const sheet = wb.Sheets[wb.SheetNames[0]];
    const rows = XLSX.utils.sheet_to_json(sheet, { header: 1 }) as any[][];

    expect(rows[0]).toEqual([
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
  });
});
