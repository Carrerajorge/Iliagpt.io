import axios from "axios";
import { ScientificArticle, Author, SearchProgressEvent } from "@shared/scientificArticleSchema";

const SCIELO_BASE_URL = "https://search.scielo.org";
const ARTICLE_META_URL = "http://articlemeta.scielo.org/api/v1";

export class ScieloService {
  async search(
    query: string,
    maxResults: number = 50,
    onProgress?: (event: SearchProgressEvent) => void
  ): Promise<ScientificArticle[]> {
    try {
      onProgress?.({
        type: "searching",
        source: "SciELO",
        articlesFound: 0,
        totalArticles: 0,
        message: "Iniciando búsqueda en SciELO...",
        timestamp: Date.now(),
      });

      const articles = await this.searchArticles(query, maxResults, onProgress);

      onProgress?.({
        type: "complete",
        source: "SciELO",
        articlesFound: articles.length,
        totalArticles: articles.length,
        message: `Completada búsqueda en SciELO: ${articles.length} artículos`,
        timestamp: Date.now(),
      });

      return articles;
    } catch (error) {
      console.error("[SciELO] Search error:", error);
      onProgress?.({
        type: "error",
        source: "SciELO",
        articlesFound: 0,
        totalArticles: 0,
        message: `Error en SciELO: ${error instanceof Error ? error.message : "Error desconocido"}`,
        timestamp: Date.now(),
      });
      return [];
    }
  }

  private async searchArticles(
    query: string,
    maxResults: number,
    onProgress?: (event: SearchProgressEvent) => void
  ): Promise<ScientificArticle[]> {
    const articles: ScientificArticle[] = [];
    const pageSize = 20;
    let offset = 0;
    let totalFound = 0;

    while (articles.length < maxResults) {
      try {
        const params = new URLSearchParams({
          q: query,
          lang: "es,en,pt",
          count: pageSize.toString(),
          from: offset.toString(),
          output: "json",
          format: "json",
        });

        const response = await axios.get(
          `${SCIELO_BASE_URL}/?${params.toString()}`,
          { 
            timeout: 30000,
            headers: {
              "Accept": "application/json",
              "User-Agent": "IliaGPT Scientific Search Agent",
            }
          }
        );

        const data = response.data;
        
        if (!data || typeof data !== 'object') {
          break;
        }

        const docs = data.response?.docs || data.docs || [];
        totalFound = data.response?.numFound || data.numFound || docs.length;

        if (docs.length === 0) {
          break;
        }

        for (const doc of docs) {
          if (articles.length >= maxResults) break;
          
          const article = this.transformToScientificArticle(doc);
          if (article) {
            articles.push(article);
          }
        }

        onProgress?.({
          type: "filtering",
          source: "SciELO",
          articlesFound: articles.length,
          totalArticles: Math.min(totalFound, maxResults),
          message: `Ya encontré ${articles.length} artículos de SciELO, seguiré buscando...`,
          timestamp: Date.now(),
        });

        offset += pageSize;
        
        if (docs.length < pageSize || offset >= totalFound) {
          break;
        }

        await this.delay(200);
      } catch (error) {
        console.error("[SciELO] Page fetch error:", error);
        break;
      }
    }

    return articles;
  }

  private transformToScientificArticle(doc: any): ScientificArticle | null {
    try {
      const id = doc.id || doc.pid || doc.code;
      if (!id) return null;

      const title = this.extractMultilang(doc.ti) || 
                    this.extractMultilang(doc.title) || 
                    doc.ti?.[0] || 
                    doc.title?.[0];
      
      if (!title) return null;

      const authors: Author[] = this.extractAuthors(doc);
      
      const abstract = this.extractMultilang(doc.ab) || 
                       this.extractMultilang(doc.abstract) ||
                       doc.ab?.[0] ||
                       doc.abstract?.[0];

      const year = this.extractYear(doc);
      const doi = doc.doi?.[0] || doc.doi;
      const journal = doc.ta?.[0] || doc.journal_title?.[0] || doc.journal;

      return {
        id: `scielo_${id}`,
        source: "scielo",
        title: title,
        authors,
        abstract,
        journal: journal ? {
          title: journal,
          volume: doc.volume?.[0] || doc.volume,
          issue: doc.issue?.[0] || doc.issue,
          pages: doc.pages?.[0] || doc.pages,
          issn: doc.issn?.[0] || doc.issn,
        } : undefined,
        publicationType: "journal_article",
        year,
        doi,
        scieloId: id,
        url: doc.fulltext_html?.[0] || `https://www.scielo.br/scielo.php?script=sci_arttext&pid=${id}`,
        pdfUrl: doc.fulltext_pdf?.[0],
        language: doc.la?.[0] || doc.language?.[0] || "es",
        languages: doc.la || doc.language,
        keywords: doc.kw || doc.keywords,
        isOpenAccess: true,
        isPeerReviewed: true,
      };
    } catch (error) {
      console.error("[SciELO] Transform error:", error);
      return null;
    }
  }

  private extractMultilang(field: any): string | undefined {
    if (!field) return undefined;
    if (typeof field === "string") return field;
    if (Array.isArray(field)) return field[0];
    if (typeof field === "object") {
      return field.es || field.en || field.pt || Object.values(field)[0] as string;
    }
    return undefined;
  }

  private extractAuthors(doc: any): Author[] {
    const authorField = doc.au || doc.authors || [];
    const authors: Author[] = [];

    for (const author of authorField) {
      if (typeof author === "string") {
        const parts = author.split(",").map((p: string) => p.trim());
        authors.push({
          lastName: parts[0] || author,
          firstName: parts[1] || "",
          fullName: parts.length > 1 ? `${parts[1]} ${parts[0]}` : author,
        });
      } else if (typeof author === "object") {
        authors.push({
          firstName: author.given || author.firstName || "",
          lastName: author.surname || author.lastName || "",
          fullName: author.name || `${author.given || ""} ${author.surname || ""}`.trim(),
          affiliation: author.affiliation,
          orcid: author.orcid,
        });
      }
    }

    return authors;
  }

  private extractYear(doc: any): number | undefined {
    const pubDate = doc.da || doc.publication_date || doc.year;
    if (!pubDate) return undefined;
    
    const dateStr = Array.isArray(pubDate) ? pubDate[0] : pubDate;
    const yearMatch = String(dateStr).match(/\d{4}/);
    return yearMatch ? parseInt(yearMatch[0]) : undefined;
  }

  private delay(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}

export const scieloService = new ScieloService();
