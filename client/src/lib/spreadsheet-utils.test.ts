import { describe, it, expect } from "vitest";
import {
  colToName,
  nameToCol,
  parseRef,
  makeRef,
  clamp,
  toNumber,
  isLikelyNumberString,
  formatValue,
  csvEscape,
  parseCSV,
  normSel,
  selectionLabel,
  newSheet,
  newWorkbook,
} from "./spreadsheet-utils";

describe("colToName", () => {
  it("converts single-letter columns", () => {
    expect(colToName(1)).toBe("A");
    expect(colToName(26)).toBe("Z");
  });
  it("converts double-letter columns", () => {
    expect(colToName(27)).toBe("AA");
    expect(colToName(28)).toBe("AB");
    expect(colToName(52)).toBe("AZ");
    expect(colToName(702)).toBe("ZZ");
  });
  it("converts triple-letter columns", () => {
    expect(colToName(703)).toBe("AAA");
  });
  it("returns empty for 0 or negative", () => {
    expect(colToName(0)).toBe("");
    expect(colToName(-1)).toBe("");
  });
});

describe("nameToCol", () => {
  it("converts single letters", () => {
    expect(nameToCol("A")).toBe(1);
    expect(nameToCol("Z")).toBe(26);
  });
  it("converts double letters", () => {
    expect(nameToCol("AA")).toBe(27);
    expect(nameToCol("AZ")).toBe(52);
    expect(nameToCol("ZZ")).toBe(702);
  });
  it("handles lowercase", () => {
    expect(nameToCol("a")).toBe(1);
    expect(nameToCol("aa")).toBe(27);
  });
  it("returns NaN for invalid input", () => {
    expect(nameToCol("1")).toBeNaN();
    expect(nameToCol("!")).toBeNaN();
  });
});

describe("parseRef", () => {
  it("parses simple references", () => {
    expect(parseRef("A1")).toEqual({ col: 1, row: 1, a1: "A1" });
    expect(parseRef("B10")).toEqual({ col: 2, row: 10, a1: "B10" });
    expect(parseRef("Z99")).toEqual({ col: 26, row: 99, a1: "Z99" });
  });
  it("handles lowercase input", () => {
    expect(parseRef("a1")).toEqual({ col: 1, row: 1, a1: "A1" });
  });
  it("trims whitespace", () => {
    expect(parseRef("  A1  ")).toEqual({ col: 1, row: 1, a1: "A1" });
  });
  it("returns null for invalid refs", () => {
    expect(parseRef("")).toBeNull();
    expect(parseRef("A0")).toBeNull();
    expect(parseRef("A")).toBeNull();
    expect(parseRef("1")).toBeNull();
    expect(parseRef("1A")).toBeNull();
  });
});

describe("makeRef", () => {
  it("creates references from row and col", () => {
    expect(makeRef(1, 1)).toBe("A1");
    expect(makeRef(10, 2)).toBe("B10");
    expect(makeRef(1, 27)).toBe("AA1");
  });
});

describe("clamp", () => {
  it("clamps values within range", () => {
    expect(clamp(5, 0, 10)).toBe(5);
    expect(clamp(-5, 0, 10)).toBe(0);
    expect(clamp(15, 0, 10)).toBe(10);
    expect(clamp(0, 0, 10)).toBe(0);
    expect(clamp(10, 0, 10)).toBe(10);
  });
});

describe("toNumber", () => {
  it("converts numbers", () => {
    expect(toNumber(42)).toBe(42);
    expect(toNumber(3.14)).toBe(3.14);
  });
  it("converts strings", () => {
    expect(toNumber("42")).toBe(42);
    expect(toNumber("3,14")).toBe(3.14);
    expect(toNumber("  10  ")).toBe(10);
  });
  it("returns 0 for invalid values", () => {
    expect(toNumber(null)).toBe(0);
    expect(toNumber(undefined)).toBe(0);
    expect(toNumber("abc")).toBe(0);
    expect(toNumber(NaN)).toBe(0);
    expect(toNumber(Infinity)).toBe(0);
  });
});

describe("isLikelyNumberString", () => {
  it("recognizes numbers", () => {
    expect(isLikelyNumberString("42")).toBe(true);
    expect(isLikelyNumberString("3.14")).toBe(true);
    expect(isLikelyNumberString("-10")).toBe(true);
    expect(isLikelyNumberString("+5")).toBe(true);
    expect(isLikelyNumberString("3,14")).toBe(true);
  });
  it("rejects non-numbers", () => {
    expect(isLikelyNumberString("")).toBe(false);
    expect(isLikelyNumberString("abc")).toBe(false);
    expect(isLikelyNumberString("12abc")).toBe(false);
  });
});

describe("formatValue", () => {
  it("formats general numbers", () => {
    expect(formatValue(42, { format: "general" })).toBe("42");
    expect(formatValue(3.14, { format: "general" })).toBe("3.14");
    expect(formatValue(1.0000000000001, { format: "general" })).toBe("1");
  });
  it("formats numbers with decimals", () => {
    expect(formatValue(3.14159, { format: "number", decimals: 2 })).toBe("3.14");
    expect(formatValue(3.14159, { format: "number", decimals: 4 })).toBe("3.1416");
  });
  it("formats percentages", () => {
    expect(formatValue(0.5, { format: "percent", decimals: 0 })).toBe("50%");
    expect(formatValue(0.1234, { format: "percent", decimals: 2 })).toBe("12.34%");
  });
  it("formats text", () => {
    expect(formatValue(42, { format: "text" })).toBe("42");
  });
  it("handles null/undefined", () => {
    expect(formatValue(null, { format: "general" })).toBe("");
    expect(formatValue(undefined, { format: "general" })).toBe("");
  });
  it("handles string values", () => {
    expect(formatValue("hello", { format: "general" })).toBe("hello");
  });
});

describe("csvEscape", () => {
  it("returns plain values unchanged", () => {
    expect(csvEscape("hello")).toBe("hello");
    expect(csvEscape(42)).toBe("42");
  });
  it("quotes values with commas", () => {
    expect(csvEscape("a,b")).toBe('"a,b"');
  });
  it("quotes values with newlines", () => {
    expect(csvEscape("a\nb")).toBe('"a\nb"');
  });
  it("escapes double quotes", () => {
    expect(csvEscape('say "hi"')).toBe('"say ""hi"""');
  });
  it("handles null/undefined", () => {
    expect(csvEscape(null)).toBe("");
    expect(csvEscape(undefined)).toBe("");
  });
});

describe("parseCSV", () => {
  it("parses simple CSV", () => {
    expect(parseCSV("a,b,c\n1,2,3")).toEqual([
      ["a", "b", "c"],
      ["1", "2", "3"],
    ]);
  });
  it("handles quoted fields", () => {
    expect(parseCSV('"hello, world",b')).toEqual([["hello, world", "b"]]);
  });
  it("handles escaped quotes", () => {
    expect(parseCSV('"say ""hi""",b')).toEqual([['say "hi"', "b"]]);
  });
  it("handles empty input", () => {
    expect(parseCSV("")).toEqual([[""]]);
  });
  it("ignores carriage returns", () => {
    expect(parseCSV("a,b\r\n1,2")).toEqual([
      ["a", "b"],
      ["1", "2"],
    ]);
  });
});

describe("normSel", () => {
  it("normalizes a selection", () => {
    expect(normSel({ r1: 5, c1: 3, r2: 1, c2: 1 })).toEqual({
      rMin: 1,
      rMax: 5,
      cMin: 1,
      cMax: 3,
    });
  });
  it("handles already normalized selection", () => {
    expect(normSel({ r1: 1, c1: 1, r2: 5, c2: 3 })).toEqual({
      rMin: 1,
      rMax: 5,
      cMin: 1,
      cMax: 3,
    });
  });
});

describe("selectionLabel", () => {
  it("returns single cell label", () => {
    expect(selectionLabel({ r1: 1, c1: 1, r2: 1, c2: 1 })).toBe("A1");
  });
  it("returns range label", () => {
    expect(selectionLabel({ r1: 1, c1: 1, r2: 5, c2: 3 })).toBe("A1:C5");
  });
});

describe("newSheet", () => {
  it("creates a sheet with defaults", () => {
    const sheet = newSheet();
    expect(sheet.name).toBe("Hoja1");
    expect(sheet.rows).toBe(100);
    expect(sheet.cols).toBe(26);
    expect(sheet.cells).toEqual({});
  });
  it("creates a sheet with custom params", () => {
    const sheet = newSheet("Data", 50, 10);
    expect(sheet.name).toBe("Data");
    expect(sheet.rows).toBe(50);
    expect(sheet.cols).toBe(10);
  });
});

describe("newWorkbook", () => {
  it("creates a workbook with one sheet", () => {
    const wb = newWorkbook();
    expect(wb.version).toBe(1);
    expect(wb.active).toBe(0);
    expect(wb.sheets).toHaveLength(1);
    expect(wb.sheets[0].name).toBe("Hoja1");
    expect(wb.createdAt).toBeTruthy();
  });
});
