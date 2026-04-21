/**
 * Tests covering the broader ACADEMIC_PATTERNS added so common
 * research-intent queries trigger the academic-search branch even
 * when they don't explicitly mention numbers, "científico", etc.
 */

import { describe, expect, it } from "vitest";
import { needsAcademicSearch } from "../services/webSearch";

describe("needsAcademicSearch — new broader triggers", () => {
  it.each([
    "dame artículos sobre gestión administrativa",
    "necesito papers sobre burnout docente",
    "buscame tesis sobre educación inclusiva",
    "estudios sobre salud mental adolescente",
    "investigaciones recientes acerca del cambio climático",
    "revisión sistemática de intervenciones cognitivo-conductuales",
    "revisión narrativa sobre gestión administrativa",
    "hazme un marco teórico para mi tesis",
    "necesito los antecedentes de la investigación",
    "state of the art on transformer models",
    "literature review on quantum error correction",
  ])("matches: %s", (q) => {
    expect(needsAcademicSearch(q)).toBe(true);
  });

  it.each([
    "hola",
    "cómo estás",
    "abre mi calendario",
    "agendame una reunión",
    "genera una imagen de un gato",
    "suma 2 + 2",
  ])("does NOT match (non-academic): %s", (q) => {
    expect(needsAcademicSearch(q)).toBe(false);
  });

  it("still matches every legacy pattern", () => {
    for (const q of [
      "dame 5 artículos científicos sobre X",
      "cita apa 7 de un artículo",
      "necesito cita",
      "formato apa",
      "scholar search",
      "peer-reviewed",
      "pubmed",
      "scielo",
      "bibliography",
      "research paper on X",
    ]) {
      expect(needsAcademicSearch(q)).toBe(true);
    }
  });
});
