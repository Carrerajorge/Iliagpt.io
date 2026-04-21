/**
 * Tests for the client-side APA 7 formatter used by the Copy button.
 * Mirrors the assertions on the server-side formatter so parity is
 * guaranteed.
 */

import { describe, expect, it } from "vitest";
import { formatApa } from "./apa";

describe("formatApa", () => {
  it("single author, year, journal, DOI", () => {
    const s = formatApa({
      title: "Effects of melatonin",
      authors: ["García, J."],
      year: 2023,
      journal: "Rev. Med.",
      doi: "10.1/mel",
    });
    expect(s).toContain("García, J.");
    expect(s).toContain("(2023).");
    expect(s).toContain("Effects of melatonin.");
    expect(s).toContain("*Rev. Med.*");
    expect(s).toContain("https://doi.org/10.1/mel");
  });

  it("two authors joined with &", () => {
    expect(
      formatApa({
        title: "x",
        authors: ["García, J.", "López, M."],
        year: 2024,
      }),
    ).toContain("García, J., & López, M.");
  });

  it("many authors: first N + ', …' + last", () => {
    const many = Array.from({ length: 25 }, (_, i) => `Author${i}`);
    const s = formatApa({ title: "x", authors: many, year: 2024 });
    expect(s).toContain("Author0, Author1");
    expect(s).toContain("…");
    expect(s).toContain("Author24");
  });

  it("no year → (n.d.)", () => {
    const s = formatApa({ title: "Paper" });
    expect(s).toContain("(n.d.).");
  });

  it("no DOI but URL → URL used as last field", () => {
    const s = formatApa({
      title: "Paper",
      year: 2024,
      url: "https://example.org/paper",
    });
    expect(s).toContain("https://example.org/paper");
  });

  it("DOI wins over URL when both present", () => {
    const s = formatApa({
      title: "Paper",
      year: 2024,
      doi: "10.1/win",
      url: "https://example.org/paper",
    });
    expect(s).toContain("https://doi.org/10.1/win");
    expect(s).not.toContain("https://example.org/paper");
  });
});
