import ExcelJS from "exceljs";
import { ScientificArticle, generateAPA7Citation } from "@shared/scientificArticleSchema";

export class ScientificExcelGenerator {
  async generateExcel(
    articles: ScientificArticle[],
    query: string
  ): Promise<Buffer> {
    const workbook = new ExcelJS.Workbook();
    workbook.creator = "IliaGPT";
    workbook.created = new Date();
    
    const mainSheet = workbook.addWorksheet("Artículos Científicos");
    this.createMainSheet(mainSheet, articles, query);
    
    const bibSheet = workbook.addWorksheet("Bibliografía APA 7");
    this.createBibliographySheet(bibSheet, articles);
    
    const statsSheet = workbook.addWorksheet("Estadísticas");
    this.createStatsSheet(statsSheet, articles);

    const buffer = await workbook.xlsx.writeBuffer();
    return Buffer.from(buffer);
  }

  private createMainSheet(sheet: ExcelJS.Worksheet, articles: ScientificArticle[], query: string): void {
    sheet.addRow([`Búsqueda: ${query}`]);
    sheet.addRow([`Fecha: ${new Date().toLocaleDateString("es-ES")}`]);
    sheet.addRow([`Total de artículos: ${articles.length}`]);
    sheet.addRow([]);

    const headers = [
      "N°",
      "Título",
      "Autores",
      "Año",
      "Revista",
      "Volumen",
      "Número",
      "Páginas",
      "DOI",
      "PMID",
      "Tipo de Publicación",
      "Citaciones",
      "Idioma",
      "Open Access",
      "Abstract",
      "Palabras Clave",
      "URL",
      "Fuente",
      "Citación APA 7",
    ];

    const headerRow = sheet.addRow(headers);
    headerRow.font = { bold: true, color: { argb: "FFFFFFFF" } };
    headerRow.fill = {
      type: "pattern",
      pattern: "solid",
      fgColor: { argb: "FF2563EB" },
    };
    headerRow.alignment = { vertical: "middle", horizontal: "center", wrapText: true };

    for (let i = 0; i < articles.length; i++) {
      const article = articles[i];
      const apa = generateAPA7Citation(article);
      
      const row = sheet.addRow([
        i + 1,
        article.title,
        article.authors.map(a => a.fullName).join("; "),
        article.year || "N/A",
        article.journal?.title || "N/A",
        article.journal?.volume || "N/A",
        article.journal?.issue || "N/A",
        article.journal?.pages || "N/A",
        article.doi || "N/A",
        article.pmid || "N/A",
        this.translatePublicationType(article.publicationType),
        article.citationCount ?? "N/A",
        article.language || "N/A",
        article.isOpenAccess ? "Sí" : "No",
        article.abstract || "No disponible",
        article.keywords?.join("; ") || "N/A",
        article.url || "N/A",
        article.source.toUpperCase(),
        apa,
      ]);

      if (i % 2 === 0) {
        row.fill = {
          type: "pattern",
          pattern: "solid",
          fgColor: { argb: "FFF3F4F6" },
        };
      }

      row.alignment = { vertical: "top", wrapText: true };
    }

    sheet.columns = [
      { width: 5 },   // N°
      { width: 50 },  // Título
      { width: 40 },  // Autores
      { width: 8 },   // Año
      { width: 30 },  // Revista
      { width: 10 },  // Volumen
      { width: 10 },  // Número
      { width: 12 },  // Páginas
      { width: 25 },  // DOI
      { width: 12 },  // PMID
      { width: 20 },  // Tipo
      { width: 10 },  // Citaciones
      { width: 10 },  // Idioma
      { width: 12 },  // Open Access
      { width: 60 },  // Abstract
      { width: 30 },  // Palabras Clave
      { width: 40 },  // URL
      { width: 12 },  // Fuente
      { width: 60 },  // APA
    ];

    sheet.autoFilter = {
      from: { row: 5, column: 1 },
      to: { row: 5 + articles.length, column: headers.length },
    };
  }

  private createBibliographySheet(sheet: ExcelJS.Worksheet, articles: ScientificArticle[]): void {
    sheet.addRow(["Bibliografía en formato APA 7ma Edición"]);
    sheet.addRow([`Generada: ${new Date().toLocaleDateString("es-ES")}`]);
    sheet.addRow([]);

    const sortedArticles = [...articles].sort((a, b) => {
      const authorA = a.authors[0]?.lastName || "";
      const authorB = b.authors[0]?.lastName || "";
      return authorA.localeCompare(authorB);
    });

    for (const article of sortedArticles) {
      const apa = generateAPA7Citation(article);
      const row = sheet.addRow([apa]);
      row.alignment = { wrapText: true };
    }

    sheet.getColumn(1).width = 120;
    
    sheet.getRow(1).font = { bold: true, size: 14 };
  }

  private createStatsSheet(sheet: ExcelJS.Worksheet, articles: ScientificArticle[]): void {
    sheet.addRow(["Estadísticas de la Búsqueda"]);
    sheet.addRow([]);

    sheet.addRow(["Total de artículos", articles.length]);
    
    const sourceCount = new Map<string, number>();
    const yearCount = new Map<number, number>();
    const typeCount = new Map<string, number>();
    const languageCount = new Map<string, number>();
    let openAccessCount = 0;

    for (const article of articles) {
      sourceCount.set(article.source, (sourceCount.get(article.source) || 0) + 1);
      
      if (article.year) {
        yearCount.set(article.year, (yearCount.get(article.year) || 0) + 1);
      }
      
      const type = article.publicationType || "other";
      typeCount.set(type, (typeCount.get(type) || 0) + 1);
      
      const lang = article.language || "unknown";
      languageCount.set(lang, (languageCount.get(lang) || 0) + 1);
      
      if (article.isOpenAccess) openAccessCount++;
    }

    sheet.addRow([]);
    sheet.addRow(["Por Fuente"]);
    for (const [source, count] of sourceCount) {
      sheet.addRow([`  ${source.toUpperCase()}`, count]);
    }

    sheet.addRow([]);
    sheet.addRow(["Por Año (últimos 10)"]);
    const sortedYears = [...yearCount.entries()].sort((a, b) => b[0] - a[0]).slice(0, 10);
    for (const [year, count] of sortedYears) {
      sheet.addRow([`  ${year}`, count]);
    }

    sheet.addRow([]);
    sheet.addRow(["Por Tipo de Publicación"]);
    for (const [type, count] of typeCount) {
      sheet.addRow([`  ${this.translatePublicationType(type as any)}`, count]);
    }

    sheet.addRow([]);
    sheet.addRow(["Por Idioma"]);
    for (const [lang, count] of languageCount) {
      sheet.addRow([`  ${lang}`, count]);
    }

    sheet.addRow([]);
    sheet.addRow(["Open Access", openAccessCount]);
    sheet.addRow(["Acceso Restringido", articles.length - openAccessCount]);

    sheet.getColumn(1).width = 30;
    sheet.getColumn(2).width = 15;
    sheet.getRow(1).font = { bold: true, size: 14 };
  }

  private translatePublicationType(type?: string): string {
    const translations: Record<string, string> = {
      journal_article: "Artículo de Revista",
      review: "Revisión",
      systematic_review: "Revisión Sistemática",
      meta_analysis: "Meta-análisis",
      clinical_trial: "Ensayo Clínico",
      randomized_controlled_trial: "Ensayo Controlado Aleatorizado",
      case_report: "Reporte de Caso",
      case_series: "Serie de Casos",
      editorial: "Editorial",
      letter: "Carta",
      comment: "Comentario",
      conference_paper: "Artículo de Conferencia",
      book_chapter: "Capítulo de Libro",
      thesis: "Tesis",
      preprint: "Preprint",
      other: "Otro",
    };
    return translations[type || "other"] || type || "Otro";
  }
}

export const scientificExcelGenerator = new ScientificExcelGenerator();
