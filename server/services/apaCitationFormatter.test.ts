import { describe, it, expect } from "vitest";
import {
  formatAuthorsAPA,
  formatInTextCitation,
  formatNarrativeCitation,
  formatAPA7Reference,
  generateBibliography,
  generateBibliographyForWord,
  crossRefToAPACitation,
  validateCitation,
  APACitation,
  InTextCitation,
} from "./apaCitationFormatter";

// =============================================================================
// formatAuthorsAPA
// =============================================================================
describe("formatAuthorsAPA", () => {
  it("returns 'Anonymous' when authors array is empty", () => {
    expect(formatAuthorsAPA([])).toBe("Anonymous");
  });

  it("returns 'Anonymous' when authors is null/undefined", () => {
    expect(formatAuthorsAPA(null as any)).toBe("Anonymous");
    expect(formatAuthorsAPA(undefined as any)).toBe("Anonymous");
  });

  it("returns a single author already in APA format unchanged", () => {
    expect(formatAuthorsAPA(["Smith, J. A."])).toBe("Smith, J. A.");
  });

  it("converts 'First Last' format to 'Last, F.' for a single author", () => {
    expect(formatAuthorsAPA(["John Smith"])).toBe("Smith, J.");
  });

  it("converts 'First Middle Last' format with initials", () => {
    expect(formatAuthorsAPA(["John Andrew Smith"])).toBe("Smith, J. A.");
  });

  it("joins two authors with ', &'", () => {
    const result = formatAuthorsAPA(["Smith, J.", "Doe, R."]);
    expect(result).toBe("Smith, J., & Doe, R.");
  });

  it("joins three authors with commas and '&' before the last", () => {
    const result = formatAuthorsAPA(["Smith, J.", "Doe, R.", "Lee, K."]);
    expect(result).toBe("Smith, J., Doe, R., & Lee, K.");
  });

  it("lists all authors when there are up to 20", () => {
    const authors = Array.from({ length: 20 }, (_, i) => `Author${i}, A.`);
    const result = formatAuthorsAPA(authors);
    expect(result).toContain("& Author19, A.");
    // Should contain all 20 authors
    expect(result).toContain("Author0, A.");
    expect(result).toContain("Author10, A.");
  });

  it("uses ellipsis notation for 21+ authors (first 19 ... last)", () => {
    const authors = Array.from({ length: 25 }, (_, i) => `Author${i}, A.`);
    const result = formatAuthorsAPA(authors);
    expect(result).toContain("...");
    expect(result).toContain("Author24, A.");
    expect(result).toContain("Author18, A.");
    // Should NOT contain author 19 through 23 explicitly
    expect(result).not.toContain("& Author24");
  });

  it("handles a single-name author (mononym)", () => {
    expect(formatAuthorsAPA(["Madonna"])).toBe("Madonna");
  });
});

// =============================================================================
// formatInTextCitation
// =============================================================================
describe("formatInTextCitation", () => {
  it("formats single author in-text citation", () => {
    const citation: InTextCitation = { authors: ["Smith, J."], year: 2023 };
    expect(formatInTextCitation(citation)).toBe("(Smith, 2023)");
  });

  it("formats two-author in-text citation with '&'", () => {
    const citation: InTextCitation = { authors: ["Smith, J.", "Doe, R."], year: 2020 };
    expect(formatInTextCitation(citation)).toBe("(Smith & Doe, 2020)");
  });

  it("formats three+ authors with 'et al.'", () => {
    const citation: InTextCitation = { authors: ["Smith, J.", "Doe, R.", "Lee, K."], year: 2019 };
    expect(formatInTextCitation(citation)).toBe("(Smith et al., 2019)");
  });

  it("uses 'Anonymous' for zero authors", () => {
    const citation: InTextCitation = { authors: [], year: 2021 };
    expect(formatInTextCitation(citation)).toBe("(Anonymous, 2021)");
  });

  it("includes single page number with 'p.'", () => {
    const citation: InTextCitation = { authors: ["Smith, J."], year: 2023, pageNumbers: "42" };
    expect(formatInTextCitation(citation)).toBe("(Smith, 2023, p. 42)");
  });

  it("includes page range with 'pp.'", () => {
    const citation: InTextCitation = { authors: ["Smith, J."], year: 2023, pageNumbers: "42-50" };
    expect(formatInTextCitation(citation)).toBe("(Smith, 2023, pp. 42-50)");
  });

  it("handles string year", () => {
    const citation: InTextCitation = { authors: ["Smith, J."], year: "n.d." };
    expect(formatInTextCitation(citation)).toBe("(Smith, n.d.)");
  });
});

// =============================================================================
// formatNarrativeCitation
// =============================================================================
describe("formatNarrativeCitation", () => {
  it("formats single author narrative", () => {
    const citation: InTextCitation = { authors: ["Smith, J."], year: 2023 };
    expect(formatNarrativeCitation(citation)).toBe("Smith (2023)");
  });

  it("formats two authors with 'and' (not '&')", () => {
    const citation: InTextCitation = { authors: ["Smith, J.", "Doe, R."], year: 2020 };
    expect(formatNarrativeCitation(citation)).toBe("Smith and Doe (2020)");
  });

  it("formats 3+ authors with 'et al.'", () => {
    const citation: InTextCitation = { authors: ["Smith, J.", "Doe, R.", "Lee, K."], year: 2019 };
    expect(formatNarrativeCitation(citation)).toBe("Smith et al. (2019)");
  });

  it("handles anonymous when no authors", () => {
    const citation: InTextCitation = { authors: [], year: 2021 };
    expect(formatNarrativeCitation(citation)).toBe("Anonymous (2021)");
  });
});

// =============================================================================
// formatAPA7Reference
// =============================================================================
describe("formatAPA7Reference", () => {
  it("formats a journal article with volume, issue, pages, and DOI", () => {
    const citation: APACitation = {
      authors: ["Smith, J."],
      year: 2023,
      title: "A Study on Testing",
      journal: "Journal of Tests",
      volume: 10,
      issue: 3,
      pages: "100-120",
      doi: "10.1234/test.2023",
      sourceType: "journal",
    };
    const result = formatAPA7Reference(citation);
    expect(result).toContain("Smith, J. (2023).");
    expect(result).toContain("A Study on Testing.");
    expect(result).toContain("*Journal of Tests*");
    expect(result).toContain("*10*");
    expect(result).toContain("(3)");
    expect(result).toContain("100-120");
    expect(result).toContain("https://doi.org/10.1234/test.2023");
  });

  it("formats a book with edition and publisher", () => {
    const citation: APACitation = {
      authors: ["Doe, R."],
      year: 2020,
      title: "The Art of Code",
      publisher: "Tech Press",
      edition: "2nd ed.",
      sourceType: "book",
    };
    const result = formatAPA7Reference(citation);
    expect(result).toContain("*The Art of Code*");
    expect(result).toContain("(2nd ed.)");
    expect(result).toContain("Tech Press.");
  });

  it("formats a website with retrieved date and URL", () => {
    const citation: APACitation = {
      authors: ["Lee, K."],
      year: 2021,
      title: "Understanding AI",
      publisher: "AI Blog",
      url: "https://example.com/ai",
      retrievedDate: "October 15, 2021",
      sourceType: "website",
    };
    const result = formatAPA7Reference(citation);
    expect(result).toContain("*Understanding AI*");
    expect(result).toContain("AI Blog.");
    expect(result).toContain("Retrieved October 15, 2021, from");
    expect(result).toContain("https://example.com/ai");
  });

  it("formats a book chapter with editors", () => {
    const citation: APACitation = {
      authors: ["Writer, A."],
      year: 2022,
      title: "Chapter Title",
      journal: "Book Title",
      pages: "10-30",
      editors: ["Editor, B."],
      publisher: "Publisher Co",
      sourceType: "chapter",
    };
    const result = formatAPA7Reference(citation);
    expect(result).toContain("In B. Editor (Ed.),");
    expect(result).toContain("*Book Title*");
    expect(result).toContain("(pp. 10-30)");
    expect(result).toContain("Publisher Co.");
  });

  it("formats a thesis with university name", () => {
    const citation: APACitation = {
      authors: ["Student, A."],
      year: 2023,
      title: "My Dissertation",
      publisher: "MIT",
      url: "https://example.com/thesis",
      sourceType: "thesis",
    };
    const result = formatAPA7Reference(citation);
    expect(result).toContain("*My Dissertation*");
    expect(result).toContain("[Doctoral dissertation, MIT]");
    expect(result).toContain("https://example.com/thesis");
  });

  it("formats a conference paper with location", () => {
    const citation: APACitation = {
      authors: ["Speaker, C."],
      year: 2022,
      title: "Conference Talk",
      journal: "Proceedings of CONF 2022",
      city: "Berlin",
      country: "Germany",
      sourceType: "conference",
    };
    const result = formatAPA7Reference(citation);
    expect(result).toContain("Conference Talk.");
    expect(result).toContain("*Proceedings of CONF 2022*.");
    expect(result).toContain("Berlin, Germany.");
  });

  it("formats a report with publisher and URL", () => {
    const citation: APACitation = {
      authors: ["Agency, N."],
      year: 2021,
      title: "Annual Report",
      publisher: "Government Press",
      url: "https://example.com/report",
      sourceType: "report",
    };
    const result = formatAPA7Reference(citation);
    expect(result).toContain("*Annual Report*");
    expect(result).toContain("Government Press.");
    expect(result).toContain("https://example.com/report");
  });

  it("formats 'other' source type generically", () => {
    const citation: APACitation = {
      authors: ["Unknown, X."],
      year: 2020,
      title: "Some Title",
      doi: "https://doi.org/10.9999/other",
      sourceType: "other",
    };
    const result = formatAPA7Reference(citation);
    expect(result).toContain("Some Title.");
    expect(result).toContain("https://doi.org/10.9999/other");
  });

  it("uses URL when DOI is absent in a journal article", () => {
    const citation: APACitation = {
      authors: ["Doe, J."],
      year: 2023,
      title: "No DOI Article",
      journal: "Open Journal",
      url: "https://example.com/article",
      sourceType: "journal",
    };
    const result = formatAPA7Reference(citation);
    expect(result).toContain("https://example.com/article");
    expect(result).not.toContain("doi.org");
  });
});

// =============================================================================
// generateBibliography
// =============================================================================
describe("generateBibliography", () => {
  it("returns empty string for empty array", () => {
    expect(generateBibliography([])).toBe("");
  });

  it("sorts entries alphabetically and separates with double newlines", () => {
    const citations: APACitation[] = [
      { authors: ["Zeta, Z."], year: 2020, title: "Z Paper", sourceType: "other" },
      { authors: ["Alpha, A."], year: 2021, title: "A Paper", sourceType: "other" },
    ];
    const result = generateBibliography(citations);
    const entries = result.split("\n\n");
    expect(entries).toHaveLength(2);
    // Alpha should come before Zeta
    expect(entries[0]).toContain("Alpha");
    expect(entries[1]).toContain("Zeta");
  });
});

// =============================================================================
// generateBibliographyForWord
// =============================================================================
describe("generateBibliographyForWord", () => {
  it("returns object with title 'Referencias' and sorted entries", () => {
    const citations: APACitation[] = [
      { authors: ["Beta, B."], year: 2022, title: "B Paper", sourceType: "other" },
      { authors: ["Alpha, A."], year: 2021, title: "A Paper", sourceType: "other" },
    ];
    const result = generateBibliographyForWord(citations);
    expect(result.title).toBe("Referencias");
    expect(result.entries).toHaveLength(2);
    expect(result.entries[0]).toContain("Alpha");
  });
});

// =============================================================================
// crossRefToAPACitation
// =============================================================================
describe("crossRefToAPACitation", () => {
  it("converts CrossRef metadata to APACitation with sourceType 'journal'", () => {
    const metadata = {
      doi: "10.1000/test",
      title: "Test Article",
      authors: ["Smith, J."],
      year: 2023,
      journal: "Test Journal",
      volume: "5",
      issue: "2",
      pages: "10-20",
      abstract: "An abstract.",
      keywords: ["testing"],
      url: "https://example.com",
    };
    const result = crossRefToAPACitation(metadata);
    expect(result.sourceType).toBe("journal");
    expect(result.doi).toBe("10.1000/test");
    expect(result.title).toBe("Test Article");
    expect(result.journal).toBe("Test Journal");
    expect(result.volume).toBe("5");
    expect(result.issue).toBe("2");
    expect(result.pages).toBe("10-20");
    expect(result.abstract).toBe("An abstract.");
    expect(result.keywords).toEqual(["testing"]);
  });

  it("handles missing optional fields", () => {
    const metadata = {
      doi: "10.2000/min",
      title: "Minimal Article",
      authors: ["Doe, R."],
      year: 2024,
      journal: "Min Journal",
    };
    const result = crossRefToAPACitation(metadata);
    expect(result.volume).toBeUndefined();
    expect(result.issue).toBeUndefined();
    expect(result.pages).toBeUndefined();
    expect(result.url).toBeUndefined();
  });
});

// =============================================================================
// validateCitation
// =============================================================================
describe("validateCitation", () => {
  it("returns valid for a complete journal citation", () => {
    const result = validateCitation({
      authors: ["Smith, J."],
      year: 2023,
      title: "A Title",
      sourceType: "journal",
      journal: "A Journal",
    });
    expect(result.valid).toBe(true);
    expect(result.errors).toHaveLength(0);
  });

  it("reports missing authors", () => {
    const result = validateCitation({ year: 2023, title: "X", sourceType: "other" });
    expect(result.valid).toBe(false);
    expect(result.errors).toContain("At least one author is required");
  });

  it("reports missing year", () => {
    const result = validateCitation({ authors: ["A"], title: "X", sourceType: "other" });
    expect(result.valid).toBe(false);
    expect(result.errors).toContain("Publication year is required");
  });

  it("reports missing title", () => {
    const result = validateCitation({ authors: ["A"], year: 2023, sourceType: "other" });
    expect(result.valid).toBe(false);
    expect(result.errors).toContain("Title is required");
  });

  it("reports missing sourceType", () => {
    const result = validateCitation({ authors: ["A"], year: 2023, title: "X" });
    expect(result.valid).toBe(false);
    expect(result.errors).toContain("Source type is required");
  });

  it("reports missing journal for journal sourceType", () => {
    const result = validateCitation({ authors: ["A"], year: 2023, title: "X", sourceType: "journal" });
    expect(result.valid).toBe(false);
    expect(result.errors).toContain("Journal name is required for journal articles");
  });

  it("reports missing publisher for book sourceType", () => {
    const result = validateCitation({ authors: ["A"], year: 2023, title: "X", sourceType: "book" });
    expect(result.valid).toBe(false);
    expect(result.errors).toContain("Publisher is required for books");
  });

  it("collects multiple errors at once", () => {
    const result = validateCitation({});
    expect(result.valid).toBe(false);
    expect(result.errors.length).toBeGreaterThan(2);
  });
});
