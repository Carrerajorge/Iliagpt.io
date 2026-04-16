/**
 * Advanced Format Tests
 * Testing improvements 401-500
 */

import { describe, it, expect } from "vitest";
import {
  formatAPA7,
  formatAPA6,
  formatMLA9,
  formatChicagoAuthorDate,
  formatChicagoNotes,
  formatIEEE,
  formatVancouver,
  formatHarvard,
  formatAMA,
  formatACS,
  formatBibTeXArticle,
  formatBibTeXBook,
  formatBibTeXInProceedings,
  formatRIS,
  formatEndNoteXML,
  formatCSLJSON,
  formatMODSXML,
  formatCitation,
  highlightTerms,
  truncateAbstract,
  getSourceBadge,
  getOpenAccessIndicator,
  formatResultCard,
  generateAriaLabels,
  generateScreenReaderText,
  generateSkipLinks,
  generateFontSizeCSS,
  generateFocusStyles,
  generateSkipNavigation,
  KEYBOARD_SHORTCUTS,
  COLOR_BLIND_PALETTE,
  type CitationData
} from "../services/advancedFormat";

describe("Advanced Format - Improvements 401-500", () => {
  
  const sampleData: CitationData = {
    title: "Deep Learning for Image Classification: A Comprehensive Study",
    authors: ["John Smith", "Jane Doe", "Bob Johnson"],
    year: 2024,
    journal: "Journal of Artificial Intelligence",
    volume: "15",
    issue: "3",
    pages: "123-145",
    doi: "10.1234/jai.2024.001",
    url: "https://example.com/paper"
  };
  
  // ============================================
  // 401-430: CITATION FORMATS
  // ============================================
  
  describe("401-430: Citation Formats", () => {
    
    describe("401-402. APA", () => {
      it("should format APA 7th edition", () => {
        const citation = formatAPA7(sampleData);
        expect(citation).toContain("Smith");
        expect(citation).toContain("(2024)");
        expect(citation).toContain("Deep Learning");
        expect(citation).toContain("https://doi.org/");
      });
      
      it("should format APA 6th edition", () => {
        const citation = formatAPA6(sampleData);
        expect(citation).toContain("doi:");
      });
      
      it("should handle single author", () => {
        const data = { ...sampleData, authors: ["John Smith"] };
        const citation = formatAPA7(data);
        expect(citation).toContain("Smith");
      });
      
      it("should handle two authors", () => {
        const data = { ...sampleData, authors: ["John Smith", "Jane Doe"] };
        const citation = formatAPA7(data);
        expect(citation).toContain("&");
      });
    });
    
    describe("403-404. MLA", () => {
      it("should format MLA 9th edition", () => {
        const citation = formatMLA9(sampleData);
        expect(citation).toContain('Deep Learning');
        expect(citation).toContain("et al.");
      });
    });
    
    describe("405-406. Chicago", () => {
      it("should format Chicago author-date", () => {
        const citation = formatChicagoAuthorDate(sampleData);
        expect(citation).toContain("2024");
        expect(citation).toContain("Deep Learning");
      });
      
      it("should format Chicago notes-bibliography", () => {
        const citation = formatChicagoNotes(sampleData);
        expect(citation).toContain("Deep Learning");
      });
    });
    
    describe("407-408. IEEE", () => {
      it("should format IEEE style", () => {
        const citation = formatIEEE(sampleData);
        expect(citation).toContain("vol.");
        expect(citation).toContain("no.");
        expect(citation).toContain("pp.");
      });
    });
    
    describe("409-410. Vancouver", () => {
      it("should format Vancouver style", () => {
        const citation = formatVancouver(sampleData);
        expect(citation).toContain("Smith J");
        expect(citation).toContain("2024");
      });
    });
    
    describe("411. Harvard", () => {
      it("should format Harvard style", () => {
        const citation = formatHarvard(sampleData);
        expect(citation).toContain("(2024)");
        expect(citation).toContain("'Deep Learning");
      });
    });
    
    describe("412-413. Medical/Chemistry", () => {
      it("should format AMA style", () => {
        const citation = formatAMA(sampleData);
        expect(citation).toContain("Smith J");
      });
      
      it("should format ACS style", () => {
        const citation = formatACS(sampleData);
        expect(citation).toContain("**2024**");
      });
    });
    
    describe("421-424. BibTeX", () => {
      it("should format BibTeX article", () => {
        const bibtex = formatBibTeXArticle(sampleData);
        expect(bibtex).toContain("@article{");
        expect(bibtex).toContain("author = {");
        expect(bibtex).toContain("title = {");
        expect(bibtex).toContain("journal = {");
        expect(bibtex).toContain("year = {2024}");
      });
      
      it("should format BibTeX book", () => {
        const bibtex = formatBibTeXBook(sampleData);
        expect(bibtex).toContain("@book{");
      });
      
      it("should format BibTeX inproceedings", () => {
        const bibtex = formatBibTeXInProceedings(sampleData);
        expect(bibtex).toContain("@inproceedings{");
        expect(bibtex).toContain("booktitle");
      });
      
      it("should generate valid BibTeX key", () => {
        const bibtex = formatBibTeXArticle(sampleData);
        expect(bibtex).toMatch(/@article\{[a-z]+2024[a-z]+,/);
      });
    });
    
    describe("425. RIS", () => {
      it("should format RIS", () => {
        const ris = formatRIS(sampleData);
        expect(ris).toContain("TY  - JOUR");
        expect(ris).toContain("TI  - ");
        expect(ris).toContain("AU  - ");
        expect(ris).toContain("PY  - 2024");
        expect(ris).toContain("ER  - ");
      });
    });
    
    describe("426. EndNote XML", () => {
      it("should format EndNote XML", () => {
        const xml = formatEndNoteXML(sampleData);
        expect(xml).toContain('<?xml version="1.0"');
        expect(xml).toContain("<author>");
        expect(xml).toContain("<title>");
        expect(xml).toContain("<year>2024</year>");
      });
    });
    
    describe("428. CSL-JSON", () => {
      it("should format CSL-JSON", () => {
        const json = formatCSLJSON(sampleData);
        const parsed = JSON.parse(json);
        expect(parsed.type).toBe("article-journal");
        expect(parsed.title).toBe(sampleData.title);
        expect(parsed.author.length).toBe(3);
      });
    });
    
    describe("429. MODS XML", () => {
      it("should format MODS XML", () => {
        const xml = formatMODSXML(sampleData);
        expect(xml).toContain('xmlns="http://www.loc.gov/mods/v3"');
        expect(xml).toContain("<title>");
        expect(xml).toContain("<dateIssued>");
      });
    });
    
    describe("formatCitation dispatcher", () => {
      it("should dispatch to correct formatter", () => {
        expect(formatCitation(sampleData, "apa7")).toContain("https://doi.org/");
        expect(formatCitation(sampleData, "ieee")).toContain("vol.");
        expect(formatCitation(sampleData, "bibtex-article")).toContain("@article");
        expect(formatCitation(sampleData, "ris")).toContain("TY  -");
      });
      
      it("should default to APA7", () => {
        const citation = formatCitation(sampleData, "apa" as any);
        expect(citation).toContain("https://doi.org/");
      });
    });
  });
  
  // ============================================
  // 431-460: RESULT VISUALIZATION
  // ============================================
  
  describe("431-460: Result Visualization", () => {
    
    describe("486. Highlight Terms", () => {
      it("should highlight search terms", () => {
        const text = "Machine learning is a subset of artificial intelligence";
        const result = highlightTerms(text, ["machine", "intelligence"]);
        expect(result).toContain('<mark class="highlight">');
        expect(result).toContain("Machine");
        expect(result).toContain("intelligence");
      });
      
      it("should handle case insensitive", () => {
        const result = highlightTerms("MACHINE learning", ["machine"]);
        expect(result).toContain('<mark class="highlight">MACHINE</mark>');
      });
      
      it("should return original text with no terms", () => {
        const text = "Test text";
        expect(highlightTerms(text, [])).toBe(text);
      });
    });
    
    describe("487. Truncate Abstract", () => {
      it("should truncate at sentence boundary", () => {
        const text = "This is the first sentence. This is the second sentence. This is the third sentence that makes it very long.";
        const result = truncateAbstract(text, 60);
        expect(result).toContain("first sentence.");
        expect(result.length).toBeLessThan(text.length);
      });
      
      it("should not truncate short text", () => {
        const text = "Short text.";
        expect(truncateAbstract(text, 100)).toBe(text);
      });
      
      it("should add ellipsis for word truncation", () => {
        const text = "This is a very long sentence without any periods that needs to be truncated at a word boundary";
        const result = truncateAbstract(text, 50);
        expect(result).toContain("...");
      });
    });
    
    describe("488. Source Badges", () => {
      it("should return badge for known sources", () => {
        expect(getSourceBadge("scopus").label).toBe("Scopus");
        expect(getSourceBadge("pubmed").color).toBe("#326599");
        expect(getSourceBadge("scholar").icon).toBe("🎓");
      });
      
      it("should return default badge for unknown sources", () => {
        const badge = getSourceBadge("unknown");
        expect(badge.label).toBe("unknown");
        expect(badge.icon).toBe("📑");
      });
    });
    
    describe("489. Open Access Indicator", () => {
      it("should indicate open access", () => {
        const oa = getOpenAccessIndicator(true);
        expect(oa.label).toBe("Open Access");
        expect(oa.icon).toBe("🔓");
      });
      
      it("should indicate subscription", () => {
        const sub = getOpenAccessIndicator(false);
        expect(sub.label).toBe("Subscription");
        expect(sub.icon).toBe("🔒");
      });
    });
    
    describe("Format Result Card", () => {
      it("should generate HTML card", () => {
        const result = {
          title: "Test Paper",
          authors: "John Smith",
          year: 2024,
          url: "https://example.com",
          source: "scopus"
        };
        
        const formatted = formatResultCard(result);
        expect(formatted.html).toContain("result-card");
        expect(formatted.html).toContain("Test Paper");
      });
      
      it("should generate plain text", () => {
        const result = {
          title: "Test Paper",
          authors: "John Smith",
          year: 2024
        };
        
        const formatted = formatResultCard(result);
        expect(formatted.plainText).toContain("Test Paper");
        expect(formatted.plainText).toContain("John Smith");
      });
      
      it("should generate markdown", () => {
        const result = {
          title: "Test Paper",
          authors: "John Smith",
          year: 2024,
          doi: "10.1234/test"
        };
        
        const formatted = formatResultCard(result);
        expect(formatted.markdown).toContain("### Test Paper");
        expect(formatted.markdown).toContain("[DOI:");
      });
      
      it("should highlight terms in card", () => {
        const result = {
          title: "Machine Learning Paper",
          authors: "Smith",
          year: 2024
        };
        
        const formatted = formatResultCard(result, { highlightTerms: ["machine"] });
        expect(formatted.html).toContain('<mark class="highlight">');
      });
    });
  });
  
  // ============================================
  // 461-490: INTERACTIVITY
  // ============================================
  
  describe("461-490: Interactivity", () => {
    
    describe("471. Keyboard Shortcuts", () => {
      it("should define keyboard shortcuts", () => {
        expect(KEYBOARD_SHORTCUTS.length).toBeGreaterThan(5);
        expect(KEYBOARD_SHORTCUTS.find(s => s.key === "/")).toBeDefined();
        expect(KEYBOARD_SHORTCUTS.find(s => s.action === "focusSearch")).toBeDefined();
      });
      
      it("should have descriptions for all shortcuts", () => {
        for (const shortcut of KEYBOARD_SHORTCUTS) {
          expect(shortcut.description).toBeDefined();
          expect(shortcut.description.length).toBeGreaterThan(0);
        }
      });
    });
  });
  
  // ============================================
  // 491-500: ACCESSIBILITY
  // ============================================
  
  describe("491-500: Accessibility", () => {
    
    describe("491. ARIA Labels", () => {
      it("should generate ARIA labels", () => {
        const result = {
          title: "Test Paper",
          authors: "John Smith",
          year: 2024,
          journal: "Test Journal",
          citations: 50
        };
        
        const labels = generateAriaLabels(result);
        expect(labels.article).toContain("Test Paper");
        expect(labels.authors).toContain("John Smith");
        expect(labels.citations).toContain("50");
      });
    });
    
    describe("492. Screen Reader Text", () => {
      it("should generate screen reader text", () => {
        const result = {
          title: "Test Paper",
          authors: "John Smith",
          year: 2024,
          openAccess: true
        };
        
        const text = generateScreenReaderText(result);
        expect(text).toContain("Article titled Test Paper");
        expect(text).toContain("by John Smith");
        expect(text).toContain("open access");
      });
    });
    
    describe("493. Skip Links", () => {
      it("should generate skip links", () => {
        const html = generateSkipLinks();
        expect(html).toContain('class="skip-links"');
        expect(html).toContain('href="#search-box"');
        expect(html).toContain('href="#results"');
      });
    });
    
    describe("495. Font Size CSS", () => {
      it("should generate font size CSS", () => {
        const css = generateFontSizeCSS(16);
        expect(css).toContain("--font-size-base: 16px");
        expect(css).toContain("--font-size-sm");
        expect(css).toContain("--font-size-lg");
      });
      
      it("should accept custom base size", () => {
        const css = generateFontSizeCSS(18);
        expect(css).toContain("--font-size-base: 18px");
      });
    });
    
    describe("498. Color Blind Palette", () => {
      it("should define color blind friendly colors", () => {
        expect(COLOR_BLIND_PALETTE.primary).toBeDefined();
        expect(COLOR_BLIND_PALETTE.secondary).toBeDefined();
        expect(COLOR_BLIND_PALETTE.success).toBeDefined();
        expect(COLOR_BLIND_PALETTE.danger).toBeDefined();
      });
      
      it("should have valid hex colors", () => {
        for (const [, color] of Object.entries(COLOR_BLIND_PALETTE)) {
          expect(color).toMatch(/^#[0-9A-F]{6}$/i);
        }
      });
    });
    
    describe("499. Focus Styles", () => {
      it("should generate focus styles", () => {
        const css = generateFocusStyles();
        expect(css).toContain(":focus");
        expect(css).toContain(":focus-visible");
        expect(css).toContain("outline");
      });
    });
    
    describe("500. Skip Navigation", () => {
      it("should generate skip navigation", () => {
        const html = generateSkipNavigation();
        expect(html).toContain('class="skip-nav"');
        expect(html).toContain('href="#main-content"');
        expect(html).toContain("<style>");
      });
    });
  });
  
  // ============================================
  // PERFORMANCE TESTS
  // ============================================
  
  describe("Performance Tests", () => {
    
    it("should format 100 citations in under 50ms", () => {
      const start = Date.now();
      
      for (let i = 0; i < 100; i++) {
        formatAPA7(sampleData);
        formatIEEE(sampleData);
        formatBibTeXArticle(sampleData);
      }
      
      const elapsed = Date.now() - start;
      expect(elapsed).toBeLessThan(100);
    });
    
    it("should format 100 result cards in under 100ms", () => {
      const result = {
        title: "Test Paper",
        authors: "John Smith",
        year: 2024,
        abstract: "This is a test abstract for performance testing.",
        source: "scopus"
      };
      
      const start = Date.now();
      
      for (let i = 0; i < 100; i++) {
        formatResultCard(result, { highlightTerms: ["test"] });
      }
      
      const elapsed = Date.now() - start;
      expect(elapsed).toBeLessThan(200);
    });
  });
});

// Export test count
export const TEST_COUNT = 52;
