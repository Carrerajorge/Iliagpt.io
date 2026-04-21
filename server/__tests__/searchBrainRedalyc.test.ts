/**
 * Tests for Redalyc HTML scraper.
 *
 * We test the parser in isolation using hand-crafted fixtures — no
 * network. The scraping fetch layer is only exercised at integration
 * time; here we verify the markup-to-AcademicResult pipeline.
 */

import { describe, expect, it } from "vitest";

import { parseRedalycHtml, REDALYC_INTERNAL } from "../services/searchBrain/redalycProvider";

describe("redalycProvider.parseRedalycHtml", () => {
  it("returns empty array when the HTML has no result nodes", () => {
    expect(parseRedalycHtml("<html><body><p>no results</p></body></html>", 20)).toEqual([]);
    expect(parseRedalycHtml("", 20)).toEqual([]);
  });

  it("parses a single search hit", () => {
    const html = `
      <html><body>
        <div class="resultado">
          <h2><a href="/articulo.oa?id=12345">Efectos de la melatonina en adolescentes</a></h2>
          <div class="autores">García, J.; López, M.</div>
          <div class="revista">Revista Chilena de Pediatría</div>
          <div class="anio">2023</div>
          <div class="resumen">Este estudio evalúa los efectos...</div>
          <a href="https://doi.org/10.1234/abc.2023">DOI</a>
          <a href="/pdf/12345.pdf">PDF</a>
        </div>
      </body></html>`;
    const results = parseRedalycHtml(html, 20);
    expect(results).toHaveLength(1);
    const r = results[0]!;
    expect(r.title).toMatch(/melatonina/i);
    expect(r.authors).toMatch(/García/);
    expect(r.year).toBe("2023");
    expect(r.doi).toBe("10.1234/abc.2023");
    expect(r.pdfUrl).toContain("/pdf/12345.pdf");
    expect(r.url).toContain("/articulo.oa?id=12345");
    expect(r.abstract).toMatch(/estudio/);
  });

  it("respects maxResults", () => {
    const block = `
      <div class="resultado">
        <h2><a href="/a">Title</a></h2>
        <div class="autores">A</div>
      </div>`.repeat(10);
    const html = `<html><body>${block}</body></html>`;
    expect(parseRedalycHtml(html, 3)).toHaveLength(3);
  });

  it("skips hits missing a title or link", () => {
    const html = `
      <html><body>
        <div class="resultado"><h2></h2></div>
        <div class="resultado"><h2><a>no href</a></h2></div>
        <div class="resultado"><h2><a href="/ok">OK</a></h2><div class="autores">X</div></div>
      </body></html>`;
    expect(parseRedalycHtml(html, 10)).toHaveLength(1);
  });

  it("extractDoi handles the common doi.org URL format", () => {
    expect(REDALYC_INTERNAL.extractDoi("https://doi.org/10.1234/abc.def")).toBe("10.1234/abc.def");
    expect(REDALYC_INTERNAL.extractDoi("http://dx.doi.org/10.9999/zzz")).toBe("10.9999/zzz");
    expect(REDALYC_INTERNAL.extractDoi("https://example.com/")).toBeUndefined();
  });

  it("normaliseUrl preserves absolute URLs and absolutises relative ones", () => {
    expect(REDALYC_INTERNAL.normaliseUrl("https://x.com/a")).toBe("https://x.com/a");
    expect(REDALYC_INTERNAL.normaliseUrl("/foo")).toBe("https://www.redalyc.org/foo");
    expect(REDALYC_INTERNAL.normaliseUrl("foo")).toBe("https://www.redalyc.org/foo");
  });
});
