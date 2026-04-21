/**
 * Tests for the opt-in Playwright-backed scrapers. Both the HTML
 * parsers and the policy-stack orchestration are covered — with
 * injected launcher + robots fetcher so no real browser or network is
 * required.
 */

import { describe, expect, it, vi } from "vitest";
import {
  scrapeScopus,
  scrapeWos,
  BROWSER_SCRAPER_INTERNAL,
  type Launcher,
} from "../services/searchBrain/browserScraper";

function okLauncher(html: string, status = 200): Launcher {
  return {
    fetchHtml: vi.fn(async () => ({ ok: status >= 200 && status < 300, status, html })),
  };
}

const ROBOTS_ALLOW = `User-agent: *\nAllow: /\n`;

function allowAllFetcher() {
  return vi.fn(async () => ROBOTS_ALLOW);
}

// ─── Scopus parser ────────────────────────────────────────────────────────

describe("parseScopusHtml", () => {
  it("extracts result cards from the list-doc layout", () => {
    const html = `
      <html><body>
        <div class="list-doc">
          <h4><a class="docTitle" href="/record/display.uri?eid=123">Effects of melatonin on sleep</a></h4>
          <div class="authors">García, J.; López, M.</div>
          <div class="year">2023</div>
          <div class="sourceTitle">Rev. Med.</div>
          <span class="citedBy">42</span>
        </div>
      </body></html>`;
    const out = BROWSER_SCRAPER_INTERNAL.parseScopusHtml(html, 10, "q");
    expect(out).toHaveLength(1);
    expect(out[0]!.title).toContain("Effects of melatonin");
    expect(out[0]!.year).toBe("2023");
    expect(out[0]!.citations).toBe(42);
    expect(out[0]!.url).toContain("/record/display.uri?eid=123");
  });

  it("returns [] when login-gated", () => {
    const html = `
      <html><body>
        <p>Please sign in with your institutional account to view results.</p>
      </body></html>`;
    expect(BROWSER_SCRAPER_INTERNAL.parseScopusHtml(html, 10, "q")).toEqual([]);
  });

  it("caps at maxResults", () => {
    const blocks = Array.from({ length: 10 }, (_, i) =>
      `<div class="list-doc"><h4><a class="docTitle" href="/a${i}">T${i}</a></h4></div>`,
    ).join("");
    expect(BROWSER_SCRAPER_INTERNAL.parseScopusHtml(`<html><body>${blocks}</body></html>`, 3, "q")).toHaveLength(3);
  });
});

// ─── WoS parser ───────────────────────────────────────────────────────────

describe("parseWosHtml", () => {
  it("extracts result summary cards", () => {
    const html = `
      <html><body>
        <app-summary-title>
          <a class="title" href="/wos/woscc/full-record/WOS:12345">Title of Paper</a>
          <div class="authors">Doe, J.; Roe, A.</div>
          <div class="year">2022</div>
          <div class="journal">Nature</div>
          <span class="times-cited">17</span>
        </app-summary-title>
      </body></html>`;
    const out = BROWSER_SCRAPER_INTERNAL.parseWosHtml(html, 10, "q");
    expect(out).toHaveLength(1);
    expect(out[0]!.title).toBe("Title of Paper");
    expect(out[0]!.citations).toBe(17);
    expect(out[0]!.journal).toBe("Nature");
    expect(out[0]!.url).toContain("/wos/woscc/full-record/WOS:12345");
  });

  it("skips entries missing title/href", () => {
    const html = `
      <html><body>
        <app-summary-title></app-summary-title>
        <app-summary-title><a class="title" href="/ok">OK</a></app-summary-title>
      </body></html>`;
    expect(BROWSER_SCRAPER_INTERNAL.parseWosHtml(html, 10, "q")).toHaveLength(1);
  });
});

// ─── URL absolutisation ───────────────────────────────────────────────────

describe("absolutise URLs", () => {
  it("Scopus: relative → scopus.com", () => {
    expect(BROWSER_SCRAPER_INTERNAL.absolutiseScopusUrl("/a/b")).toBe("https://www.scopus.com/a/b");
    expect(BROWSER_SCRAPER_INTERNAL.absolutiseScopusUrl("https://other/")).toBe("https://other/");
  });

  it("WoS: relative → webofscience.com", () => {
    expect(BROWSER_SCRAPER_INTERNAL.absolutiseWosUrl("/a/b")).toBe("https://www.webofscience.com/a/b");
  });
});

// ─── Orchestration ────────────────────────────────────────────────────────

describe("scrapeScopus", () => {
  it("robots allow + parser hit → returns results", async () => {
    const launcher = okLauncher(`
      <html><body>
        <div class="list-doc">
          <h4><a class="docTitle" href="/r/1">Paper 1</a></h4>
          <div class="authors">A</div>
          <div class="year">2020</div>
        </div>
      </body></html>`);
    const results = await scrapeScopus({
      query: "melatonin",
      launcher,
      robotsFetcher: allowAllFetcher(),
    });
    expect(results).toHaveLength(1);
    expect(results[0]!.title).toBe("Paper 1");
  });

  it("robots disallow → empty + launcher never called", async () => {
    const launcher: Launcher = { fetchHtml: vi.fn(async () => ({ ok: true, status: 200, html: "" })) };
    const robotsFetcher = vi.fn(async () => "User-agent: *\nDisallow: /results/");
    const results = await scrapeScopus({
      query: "q",
      launcher,
      robotsFetcher,
    });
    expect(results).toEqual([]);
    expect(launcher.fetchHtml).not.toHaveBeenCalled();
  });

  it("empty query short-circuits", async () => {
    const launcher: Launcher = { fetchHtml: vi.fn(async () => null) };
    const results = await scrapeScopus({ query: "", launcher, robotsFetcher: allowAllFetcher() });
    expect(results).toEqual([]);
    expect(launcher.fetchHtml).not.toHaveBeenCalled();
  });

  it("launcher fetch failure → empty", async () => {
    const launcher: Launcher = { fetchHtml: vi.fn(async () => null) };
    const results = await scrapeScopus({ query: "q", launcher, robotsFetcher: allowAllFetcher() });
    expect(results).toEqual([]);
  });

  it("non-OK status → empty", async () => {
    const launcher = okLauncher("<html><body>forbidden</body></html>", 403);
    const results = await scrapeScopus({ query: "q", launcher, robotsFetcher: allowAllFetcher() });
    expect(results).toEqual([]);
  });

  it("launcher throws → empty (fail soft)", async () => {
    const launcher: Launcher = {
      fetchHtml: vi.fn(async () => {
        throw new Error("browser crashed");
      }),
    };
    const results = await scrapeScopus({ query: "q", launcher, robotsFetcher: allowAllFetcher() });
    expect(results).toEqual([]);
  });
});

describe("scrapeWos", () => {
  it("mirrors scopus behaviour on robots + parser flow", async () => {
    const launcher = okLauncher(`
      <html><body>
        <app-summary-title>
          <a class="title" href="/x">WoS Paper</a>
        </app-summary-title>
      </body></html>`);
    const results = await scrapeWos({
      query: "q",
      launcher,
      robotsFetcher: allowAllFetcher(),
    });
    expect(results).toHaveLength(1);
    expect(results[0]!.source).toBe("wos");
  });
});
