import { describe, it, expect } from "vitest";
import {
  SparseGrid,
  getColumnName,
  getColumnIndex,
  parseCellRef,
  formatCellRef,
  parseRange,
} from "./sparseGrid";

describe("getColumnName", () => {
  it("converts 0 to A", () => expect(getColumnName(0)).toBe("A"));
  it("converts 25 to Z", () => expect(getColumnName(25)).toBe("Z"));
  it("converts 26 to AA", () => expect(getColumnName(26)).toBe("AA"));
  it("converts 27 to AB", () => expect(getColumnName(27)).toBe("AB"));
  it("converts 701 to ZZ", () => expect(getColumnName(701)).toBe("ZZ"));
  it("converts 702 to AAA", () => expect(getColumnName(702)).toBe("AAA"));
});

describe("getColumnIndex", () => {
  it("converts A to 0", () => expect(getColumnIndex("A")).toBe(0));
  it("converts Z to 25", () => expect(getColumnIndex("Z")).toBe(25));
  it("converts AA to 26", () => expect(getColumnIndex("AA")).toBe(26));
  it("converts AB to 27", () => expect(getColumnIndex("AB")).toBe(27));
  it("is case-insensitive", () => expect(getColumnIndex("a")).toBe(0));
  it("round-trips with getColumnName", () => {
    for (let i = 0; i < 100; i++) {
      expect(getColumnIndex(getColumnName(i))).toBe(i);
    }
  });
});

describe("parseCellRef", () => {
  it("parses A1 to {row: 0, col: 0}", () => {
    expect(parseCellRef("A1")).toEqual({ row: 0, col: 0 });
  });
  it("parses B3 to {row: 2, col: 1}", () => {
    expect(parseCellRef("B3")).toEqual({ row: 2, col: 1 });
  });
  it("parses AA10", () => {
    expect(parseCellRef("AA10")).toEqual({ row: 9, col: 26 });
  });
  it("returns null for invalid ref", () => {
    expect(parseCellRef("123")).toBeNull();
    expect(parseCellRef("")).toBeNull();
    expect(parseCellRef("A")).toBeNull();
  });
  it("is case-insensitive", () => {
    expect(parseCellRef("a1")).toEqual({ row: 0, col: 0 });
  });
});

describe("formatCellRef", () => {
  it("formats {0,0} as A1", () => expect(formatCellRef(0, 0)).toBe("A1"));
  it("formats {2,1} as B3", () => expect(formatCellRef(2, 1)).toBe("B3"));
  it("round-trips with parseCellRef", () => {
    const ref = formatCellRef(9, 26);
    expect(parseCellRef(ref)).toEqual({ row: 9, col: 26 });
  });
});

describe("parseRange", () => {
  it("parses single cell range", () => {
    const cells = parseRange("A1");
    expect(cells).toHaveLength(1);
    expect(cells[0]).toEqual({ row: 0, col: 0 });
  });

  it("parses multi-cell range", () => {
    const cells = parseRange("A1:B2");
    expect(cells).toHaveLength(4);
    expect(cells).toContainEqual({ row: 0, col: 0 });
    expect(cells).toContainEqual({ row: 0, col: 1 });
    expect(cells).toContainEqual({ row: 1, col: 0 });
    expect(cells).toContainEqual({ row: 1, col: 1 });
  });

  it("returns empty for invalid range", () => {
    expect(parseRange("invalid")).toHaveLength(0);
  });

  it("handles reversed range (end < start)", () => {
    const cells = parseRange("B2:A1");
    expect(cells).toHaveLength(4);
  });
});

describe("SparseGrid", () => {
  it("creates with default config", () => {
    const grid = new SparseGrid();
    expect(grid.maxRows).toBe(10000);
    expect(grid.maxCols).toBe(10000);
  });

  it("creates with custom config", () => {
    const grid = new SparseGrid({ maxRows: 100, maxCols: 50 });
    expect(grid.maxRows).toBe(100);
    expect(grid.maxCols).toBe(50);
  });

  it("gets empty cell as default", () => {
    const grid = new SparseGrid();
    expect(grid.getCell(0, 0).value).toBe("");
  });

  it("sets and gets cell data", () => {
    const grid = new SparseGrid();
    grid.setCell(0, 0, { value: "Hello" });
    expect(grid.getCell(0, 0).value).toBe("Hello");
  });

  it("merges cell data on set", () => {
    const grid = new SparseGrid();
    grid.setCell(0, 0, { value: "Hello", bold: true });
    grid.setCell(0, 0, { italic: true });
    const cell = grid.getCell(0, 0);
    expect(cell.value).toBe("Hello");
    expect(cell.bold).toBe(true);
    expect(cell.italic).toBe(true);
  });

  it("removes empty cells without formatting", () => {
    const grid = new SparseGrid();
    grid.setCell(0, 0, { value: "test" });
    expect(grid.getCellCount()).toBe(1);
    grid.setCell(0, 0, { value: "" });
    expect(grid.getCellCount()).toBe(0);
  });

  it("keeps cells with formatting even if value is empty", () => {
    const grid = new SparseGrid();
    grid.setCell(0, 0, { value: "", bold: true });
    expect(grid.getCellCount()).toBe(1);
  });

  it("deleteCell removes cell", () => {
    const grid = new SparseGrid();
    grid.setCell(0, 0, { value: "test" });
    grid.deleteCell(0, 0);
    expect(grid.getCellCount()).toBe(0);
  });

  it("hasData checks existence", () => {
    const grid = new SparseGrid();
    expect(grid.hasData(0, 0)).toBe(false);
    grid.setCell(0, 0, { value: "test" });
    expect(grid.hasData(0, 0)).toBe(true);
  });

  it("validateBounds checks row/col ranges", () => {
    const grid = new SparseGrid({ maxRows: 10, maxCols: 5 });
    expect(grid.validateBounds(0, 0).valid).toBe(true);
    expect(grid.validateBounds(9, 4).valid).toBe(true);
    expect(grid.validateBounds(10, 0).valid).toBe(false);
    expect(grid.validateBounds(0, 5).valid).toBe(false);
    expect(grid.validateBounds(-1, 0).valid).toBe(false);
  });

  it("safeSetCell validates before setting", () => {
    const grid = new SparseGrid({ maxRows: 10, maxCols: 5 });
    expect(grid.safeSetCell(0, 0, { value: "ok" }).valid).toBe(true);
    expect(grid.safeSetCell(100, 0, { value: "bad" }).valid).toBe(false);
  });

  it("getAllCells returns all cells", () => {
    const grid = new SparseGrid();
    grid.setCell(0, 0, { value: "A" });
    grid.setCell(1, 1, { value: "B" });
    const all = grid.getAllCells();
    expect(all).toHaveLength(2);
  });

  it("getCellsInRange returns cells in rectangle", () => {
    const grid = new SparseGrid();
    grid.setCell(0, 0, { value: "A" });
    grid.setCell(1, 1, { value: "B" });
    grid.setCell(5, 5, { value: "C" });
    const inRange = grid.getCellsInRange(0, 2, 0, 2);
    expect(inRange).toHaveLength(2);
  });

  it("getDataBounds returns null for empty grid", () => {
    const grid = new SparseGrid();
    expect(grid.getDataBounds()).toBeNull();
  });

  it("getDataBounds returns correct bounds", () => {
    const grid = new SparseGrid();
    grid.setCell(2, 3, { value: "A" });
    grid.setCell(5, 1, { value: "B" });
    const bounds = grid.getDataBounds();
    expect(bounds).toEqual({ minRow: 2, maxRow: 5, minCol: 1, maxCol: 3 });
  });

  it("clear removes all cells", () => {
    const grid = new SparseGrid();
    grid.setCell(0, 0, { value: "A" });
    grid.setCell(1, 1, { value: "B" });
    grid.clear();
    expect(grid.getCellCount()).toBe(0);
  });

  it("clone creates independent copy", () => {
    const grid = new SparseGrid();
    grid.setCell(0, 0, { value: "A" });
    const clone = grid.clone();
    clone.setCell(0, 0, { value: "B" });
    expect(grid.getCell(0, 0).value).toBe("A");
    expect(clone.getCell(0, 0).value).toBe("B");
  });

  it("toJSON and fromJSON round-trip", () => {
    const grid = new SparseGrid({ maxRows: 100, maxCols: 50 });
    grid.setCell(0, 0, { value: "Hello", bold: true });
    grid.setCell(1, 2, { value: "World" });
    const json = grid.toJSON();
    const restored = SparseGrid.fromJSON(json);
    expect(restored.getCell(0, 0).value).toBe("Hello");
    expect(restored.getCell(0, 0).bold).toBe(true);
    expect(restored.getCell(1, 2).value).toBe("World");
    expect(restored.maxRows).toBe(100);
  });

  describe("static validateCellRef", () => {
    it("accepts valid refs", () => {
      expect(SparseGrid.validateCellRef("A1").valid).toBe(true);
      expect(SparseGrid.validateCellRef("ZZ99").valid).toBe(true);
    });
    it("rejects invalid refs", () => {
      expect(SparseGrid.validateCellRef("123").valid).toBe(false);
      expect(SparseGrid.validateCellRef("").valid).toBe(false);
    });
  });

  describe("static validateRange", () => {
    it("accepts single cell", () => {
      expect(SparseGrid.validateRange("A1").valid).toBe(true);
    });
    it("accepts cell range", () => {
      expect(SparseGrid.validateRange("A1:B2").valid).toBe(true);
    });
    it("rejects invalid formats", () => {
      expect(SparseGrid.validateRange("A1:B2:C3").valid).toBe(false);
      expect(SparseGrid.validateRange("123").valid).toBe(false);
    });
  });
});
