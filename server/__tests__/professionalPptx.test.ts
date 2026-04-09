import { describe, it, expect } from "vitest";

describe("professional PPTX generator", () => {
  it("generates a valid .pptx with all slide types", async () => {
    const { generateProfessionalPptx } = await import("../services/documentGenerators/professionalPptxGenerator");
    const result = await generateProfessionalPptx({
      title: "Gestión Administrativa",
      subtitle: "Plan Estratégico 2026",
      author: "IliaGPT",
      slides: [
        { type: "content", title: "Objetivos", bullets: ["Optimizar procesos", "Reducir costos 15%", "Mejorar satisfacción del cliente"] },
        { type: "section", title: "Análisis del Mercado" },
        { type: "table", title: "Indicadores Clave", tableData: { headers: ["KPI", "Meta", "Actual"], rows: [["Ingresos", "$1M", "$850K"], ["Clientes", "500", "420"], ["NPS", "80", "72"]] } },
        { type: "two-column", title: "Fortalezas y Debilidades", leftBullets: ["Equipo experimentado", "Marca consolidada"], rightBullets: ["Falta de automatización", "Alta rotación"] },
        { type: "closing", title: "Gracias" },
      ],
    });

    // Valid PPTX (ZIP format)
    expect(result.buffer.length).toBeGreaterThan(15000);
    expect(result.buffer[0]).toBe(0x50); // P
    expect(result.buffer[1]).toBe(0x4B); // K
    expect(result.filename).toContain(".pptx");
    expect(result.mimeType).toContain("presentationml");
    expect(result.slideCount).toBeGreaterThanOrEqual(5); // at least user's slides
  });

  it("generates HTML preview with all slides", async () => {
    const { generateProfessionalPptx } = await import("../services/documentGenerators/professionalPptxGenerator");
    const result = await generateProfessionalPptx({
      title: "Test Preview",
      slides: [
        { type: "content", title: "Slide 1", bullets: ["Point A", "Point B"] },
        { type: "content", title: "Slide 2", text: "Some paragraph text here." },
      ],
    });

    expect(result.previewHtml).toBeDefined();
    expect(result.previewHtml.length).toBeGreaterThan(200);
    expect(result.previewHtml).toContain("Test Preview");
    expect(result.previewHtml).toContain("Slide 1");
    expect(result.previewHtml).toContain("Point A");
    expect(result.previewHtml).toContain("Diapositiva");
  });

  it("supports all 5 themes", async () => {
    const { generateProfessionalPptx } = await import("../services/documentGenerators/professionalPptxGenerator");
    const themes = ["corporate-blue", "executive-dark", "nature-green", "warm-amber", "minimal-gray"];

    for (const theme of themes) {
      const result = await generateProfessionalPptx({
        title: `Theme Test: ${theme}`,
        theme,
        slides: [{ type: "content", title: "Test", bullets: ["Theme works"] }],
      });
      expect(result.buffer.length).toBeGreaterThan(5000);
      expect(result.previewHtml).toContain("Theme Test");
    }
  });

  it("generates correct slide count in ZIP", async () => {
    const JSZip = (await import("jszip")).default;
    const { generateProfessionalPptx } = await import("../services/documentGenerators/professionalPptxGenerator");
    const result = await generateProfessionalPptx({
      title: "Count Test",
      slides: [
        { type: "content", title: "S1", bullets: ["A"] },
        { type: "content", title: "S2", bullets: ["B"] },
        { type: "content", title: "S3", bullets: ["C"] },
      ],
    });
    const zip = await JSZip.loadAsync(result.buffer);
    const slideFiles = Object.keys(zip.files).filter(f => /ppt\/slides\/slide\d+\.xml/.test(f));
    expect(slideFiles.length).toBeGreaterThanOrEqual(3); // at least 3 user slides
  });

  it("handles empty slides gracefully", async () => {
    const { generateProfessionalPptx } = await import("../services/documentGenerators/professionalPptxGenerator");
    const result = await generateProfessionalPptx({
      title: "Empty Test",
      slides: [],
    });
    // With no slides, still generates a valid (possibly empty) PPTX
    expect(result.buffer.length).toBeGreaterThan(0);
    expect(result.slideCount).toBeGreaterThanOrEqual(0);
  });
});
