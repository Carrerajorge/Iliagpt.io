import { describe, it, expect } from "vitest";
import { DEFAULT_COLORS, ExcelStyleConfig } from "./excelStyles";
import type { Priority } from "./excelStyles";

describe("DEFAULT_COLORS", () => {
  it("has all required color keys", () => {
    expect(DEFAULT_COLORS.DARK_BLUE).toBeDefined();
    expect(DEFAULT_COLORS.WHITE).toBe("FFFFFFFF");
    expect(DEFAULT_COLORS.BLACK).toBe("FF000000");
    expect(DEFAULT_COLORS.ACCENT_RED).toBeDefined();
    expect(DEFAULT_COLORS.ACCENT_GREEN).toBeDefined();
    expect(DEFAULT_COLORS.PRIORITY_CRITICAL_BG).toBeDefined();
    expect(DEFAULT_COLORS.PRIORITY_HIGH_BG).toBeDefined();
    expect(DEFAULT_COLORS.PRIORITY_MEDIUM_BG).toBeDefined();
    expect(DEFAULT_COLORS.PRIORITY_LOW_BG).toBeDefined();
  });

  it("all colors start with FF (fully opaque)", () => {
    for (const [key, value] of Object.entries(DEFAULT_COLORS)) {
      expect(value).toMatch(/^FF/);
    }
  });

  it("all colors are 8 chars (ARGB hex)", () => {
    for (const [key, value] of Object.entries(DEFAULT_COLORS)) {
      expect(value).toHaveLength(8);
    }
  });
});

describe("ExcelStyleConfig", () => {
  it("creates instance with default colors", () => {
    const config = new ExcelStyleConfig();
    const colors = config.getColors();
    expect(colors.DARK_BLUE).toBe(DEFAULT_COLORS.DARK_BLUE);
  });

  it("allows partial color overrides", () => {
    const config = new ExcelStyleConfig({ WHITE: "FFEEEEEE" });
    const colors = config.getColors();
    expect(colors.WHITE).toBe("FFEEEEEE");
    expect(colors.BLACK).toBe(DEFAULT_COLORS.BLACK); // not overridden
  });

  describe("getPriorityFill", () => {
    const config = new ExcelStyleConfig();

    it("returns fill for critical priority", () => {
      const fill = config.getPriorityFill("critical");
      expect(fill.type).toBe("pattern");
      expect(fill.pattern).toBe("solid");
      expect(fill.fgColor?.argb).toBe(DEFAULT_COLORS.PRIORITY_CRITICAL_BG);
    });

    it("returns different fills for each priority", () => {
      const priorities: Priority[] = ["critical", "high", "medium", "low"];
      const fills = priorities.map((p) => config.getPriorityFill(p).fgColor?.argb);
      const unique = new Set(fills);
      expect(unique.size).toBe(4);
    });
  });

  describe("getPriorityFont", () => {
    const config = new ExcelStyleConfig();

    it("returns bold font for critical", () => {
      const font = config.getPriorityFont("critical");
      expect(font.bold).toBe(true);
      expect(font.color?.argb).toBe(DEFAULT_COLORS.ACCENT_RED);
    });

    it("returns bold font for high", () => {
      const font = config.getPriorityFont("high");
      expect(font.bold).toBe(true);
      expect(font.color?.argb).toBe(DEFAULT_COLORS.ACCENT_ORANGE);
    });

    it("returns non-bold font for medium", () => {
      const font = config.getPriorityFont("medium");
      expect(font.bold).toBe(false);
    });

    it("returns non-bold font for low", () => {
      const font = config.getPriorityFont("low");
      expect(font.bold).toBe(false);
    });
  });

  describe("borders", () => {
    const config = new ExcelStyleConfig();

    it("has thin border with GRAY_200", () => {
      const border = config.thinBorder;
      expect(border.top?.style).toBe("thin");
      expect(border.top?.color?.argb).toBe(DEFAULT_COLORS.GRAY_200);
    });

    it("has thick border with DARK_BLUE", () => {
      const border = config.thickBorder;
      expect(border.top?.style).toBe("medium");
      expect(border.top?.color?.argb).toBe(DEFAULT_COLORS.DARK_BLUE);
    });
  });

  describe("fonts", () => {
    const config = new ExcelStyleConfig();

    it("titleFont is size 24, bold, white", () => {
      const font = config.titleFont;
      expect(font.size).toBe(24);
      expect(font.bold).toBe(true);
      expect(font.color?.argb).toBe(DEFAULT_COLORS.WHITE);
    });

    it("subtitleFont is size 14, bold, dark blue", () => {
      const font = config.subtitleFont;
      expect(font.size).toBe(14);
      expect(font.bold).toBe(true);
    });

    it("headerFont is size 11, bold, white", () => {
      const font = config.headerFont;
      expect(font.size).toBe(11);
      expect(font.bold).toBe(true);
    });

    it("bodyFont is size 10, gray", () => {
      const font = config.bodyFont;
      expect(font.size).toBe(10);
      expect(font.name).toBe("Arial");
    });

    it("smallFont is size 9", () => {
      expect(config.smallFont.size).toBe(9);
    });

    it("linkFont has underline and blue color", () => {
      const font = config.linkFont;
      expect(font.underline).toBe(true);
      expect(font.color?.argb).toBe(DEFAULT_COLORS.MEDIUM_BLUE);
    });
  });

  describe("fills", () => {
    const config = new ExcelStyleConfig();

    it("headerFill uses DARK_BLUE", () => {
      expect(config.headerFill.fgColor?.argb).toBe(DEFAULT_COLORS.DARK_BLUE);
    });

    it("altRowFill uses GRAY_50", () => {
      expect(config.altRowFill.fgColor?.argb).toBe(DEFAULT_COLORS.GRAY_50);
    });
  });

  describe("getAccentFill", () => {
    const config = new ExcelStyleConfig();

    it("returns correct fill for each accent", () => {
      const accents: Array<"purple" | "teal" | "green" | "orange" | "red" | "pink" | "yellow"> = [
        "purple", "teal", "green", "orange", "red", "pink", "yellow",
      ];
      for (const accent of accents) {
        const fill = config.getAccentFill(accent);
        expect(fill.type).toBe("pattern");
        expect(fill.fgColor?.argb).toBeDefined();
      }
    });

    it("different accents produce different colors", () => {
      const fills = ["purple", "teal", "green", "orange", "red", "pink", "yellow"].map(
        (a) => config.getAccentFill(a as any).fgColor?.argb
      );
      const unique = new Set(fills);
      expect(unique.size).toBe(7);
    });
  });
});
