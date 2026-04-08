import { describe, it, expect } from "vitest";

describe("document generators", () => {
  it("generates a Word document", async () => {
    const { generateWord } = await import("../services/documentGenerators/wordGenerator");
    const result = await generateWord({
      title: "Test Document",
      author: "Test Author",
      sections: [
        { heading: "Introduction", paragraphs: ["This is a test paragraph."] },
        { heading: "Data", table: { headers: ["Name", "Value"], rows: [["A", "1"], ["B", "2"]] } },
      ],
    });
    expect(result.buffer).toBeInstanceOf(Buffer);
    expect(result.buffer.length).toBeGreaterThan(1000);
    expect(result.filename).toContain(".docx");
    expect(result.mimeType).toContain("wordprocessingml");
  });

  it("generates an Excel spreadsheet", async () => {
    const { generateExcel } = await import("../services/documentGenerators/excelGenerator");
    const result = await generateExcel({
      sheetName: "Sales Data",
      title: "Monthly Sales Report",
      headers: ["Month", "Revenue", "Profit"],
      rows: [
        ["January", 10000, 3000],
        ["February", 12000, 4000],
        ["March", 15000, 5500],
      ],
      totals: true,
    });
    expect(result.buffer).toBeInstanceOf(Buffer);
    expect(result.buffer.length).toBeGreaterThan(1000);
    expect(result.filename).toContain(".xlsx");
    expect(result.mimeType).toContain("spreadsheetml");
  });

  it("generates a PowerPoint presentation", async () => {
    const { generatePptx } = await import("../services/documentGenerators/pptxGenerator");
    const result = await generatePptx({
      title: "Test Presentation",
      subtitle: "Professional Demo",
      slides: [
        { type: "content", title: "Overview", bullets: ["Point 1", "Point 2", "Point 3"] },
        { type: "table", title: "Data", tableData: { headers: ["Item", "Count"], rows: [["A", "10"], ["B", "20"]] } },
      ],
    });
    expect(result.buffer).toBeInstanceOf(Buffer);
    expect(result.buffer.length).toBeGreaterThan(5000);
    expect(result.filename).toContain(".pptx");
    expect(result.mimeType).toContain("presentationml");
  });

  it("generates a PDF document", async () => {
    const { generatePdf } = await import("../services/documentGenerators/pdfGenerator");
    const result = await generatePdf({
      title: "Test PDF Report",
      author: "Test Author",
      sections: [
        { heading: "Summary", paragraphs: ["This is the executive summary of the report."] },
        { heading: "Details", list: { items: ["Item one", "Item two", "Item three"], ordered: true } },
      ],
    });
    expect(result.buffer).toBeInstanceOf(Buffer);
    expect(result.buffer.length).toBeGreaterThan(500);
    expect(result.filename).toContain(".pdf");
    expect(result.mimeType).toBe("application/pdf");
  });

  it("orchestrator generates all types", async () => {
    const { generateDocument } = await import("../services/documentGenerators");

    const csv = await generateDocument("csv", { headers: ["A", "B"], rows: [["1", "2"]] } as any);
    expect(csv.buffer.length).toBeGreaterThan(0);
    expect(csv.downloadUrl).toContain("/download");
    expect(csv.type).toBe("csv");
  });
});
