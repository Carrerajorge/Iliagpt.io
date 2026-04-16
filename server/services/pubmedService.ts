import axios from "axios";
import { ScientificArticle, Author, SearchProgressEvent } from "@shared/scientificArticleSchema";

const PUBMED_BASE_URL = "https://eutils.ncbi.nlm.nih.gov/entrez/eutils";
const API_KEY = process.env.PUBMED_API_KEY || "";
const TOOL_NAME = "IliaGPT";
const EMAIL = process.env.PUBMED_EMAIL || "contact@iliagpt.com";

interface PubMedSearchResult {
  esearchresult: {
    count: string;
    idlist: string[];
    querykey?: string;
    webenv?: string;
  };
}

interface PubMedArticle {
  uid: string;
  pubdate: string;
  epubdate: string;
  source: string;
  authors: { name: string; authtype: string; clusterid: string }[];
  title: string;
  volume: string;
  issue: string;
  pages: string;
  lang: string[];
  issn: string;
  essn: string;
  pubtype: string[];
  fulljournalname: string;
  sortpubdate: string;
  pmcrefcount?: string;
  doi?: string;
  elocationid?: string;
}

export class PubMedService {
  private rateLimitDelay = API_KEY ? 100 : 334;

  async search(
    query: string,
    maxResults: number = 50,
    onProgress?: (event: SearchProgressEvent) => void
  ): Promise<ScientificArticle[]> {
    try {
      onProgress?.({
        type: "searching",
        source: "PubMed",
        articlesFound: 0,
        totalArticles: 0,
        message: "Iniciando búsqueda en PubMed...",
        timestamp: Date.now(),
      });

      const pmids = await this.searchPMIDs(query, maxResults);
      
      if (pmids.length === 0) {
        onProgress?.({
          type: "complete",
          source: "PubMed",
          articlesFound: 0,
          totalArticles: 0,
          message: "No se encontraron artículos en PubMed",
          timestamp: Date.now(),
        });
        return [];
      }

      onProgress?.({
        type: "found",
        source: "PubMed",
        articlesFound: pmids.length,
        totalArticles: pmids.length,
        message: `Encontrados ${pmids.length} artículos en PubMed, obteniendo detalles...`,
        timestamp: Date.now(),
      });

      const articles: ScientificArticle[] = [];
      const batchSize = 20;
      
      for (let i = 0; i < pmids.length; i += batchSize) {
        const batch = pmids.slice(i, i + batchSize);
        const batchArticles = await this.fetchArticleDetails(batch);
        articles.push(...batchArticles);
        
        onProgress?.({
          type: "filtering",
          source: "PubMed",
          articlesFound: articles.length,
          totalArticles: pmids.length,
          message: `Ya encontré ${articles.length} artículos de PubMed, seguiré buscando...`,
          timestamp: Date.now(),
        });
        
        await this.delay(this.rateLimitDelay);
      }

      onProgress?.({
        type: "complete",
        source: "PubMed",
        articlesFound: articles.length,
        totalArticles: articles.length,
        message: `Completada búsqueda en PubMed: ${articles.length} artículos`,
        timestamp: Date.now(),
      });

      return articles;
    } catch (error) {
      console.error("[PubMed] Search error:", error);
      onProgress?.({
        type: "error",
        source: "PubMed",
        articlesFound: 0,
        totalArticles: 0,
        message: `Error en PubMed: ${error instanceof Error ? error.message : "Error desconocido"}`,
        timestamp: Date.now(),
      });
      return [];
    }
  }

  private async searchPMIDs(query: string, maxResults: number): Promise<string[]> {
    const params = new URLSearchParams({
      db: "pubmed",
      term: query,
      retmax: maxResults.toString(),
      retmode: "json",
      sort: "relevance",
      ...(API_KEY && { api_key: API_KEY }),
      tool: TOOL_NAME,
      email: EMAIL,
    });

    const response = await axios.get<PubMedSearchResult>(
      `${PUBMED_BASE_URL}/esearch.fcgi?${params.toString()}`,
      { timeout: 30000 }
    );

    return response.data.esearchresult.idlist || [];
  }

  private async fetchArticleDetails(pmids: string[]): Promise<ScientificArticle[]> {
    const params = new URLSearchParams({
      db: "pubmed",
      id: pmids.join(","),
      retmode: "json",
      version: "2.0",
      ...(API_KEY && { api_key: API_KEY }),
      tool: TOOL_NAME,
      email: EMAIL,
    });

    const response = await axios.get(
      `${PUBMED_BASE_URL}/esummary.fcgi?${params.toString()}`,
      { timeout: 30000 }
    );

    const result = response.data.result;
    const articles: ScientificArticle[] = [];

    for (const pmid of pmids) {
      const data = result[pmid] as PubMedArticle;
      if (!data || !data.title) continue;

      const article = this.transformToScientificArticle(data, pmid);
      articles.push(article);
    }

    return articles;
  }

  private transformToScientificArticle(data: PubMedArticle, pmid: string): ScientificArticle {
    const authors: Author[] = (data.authors || []).map(author => {
      const nameParts = author.name.split(" ");
      const lastName = nameParts.pop() || author.name;
      const firstName = nameParts.join(" ");
      return {
        firstName,
        lastName,
        fullName: author.name,
      };
    });

    const pubDate = data.sortpubdate || data.pubdate;
    const year = pubDate ? parseInt(pubDate.split("/")[0]) : undefined;
    const month = pubDate ? parseInt(pubDate.split("/")[1]) : undefined;

    const doi = data.doi || (data.elocationid?.startsWith("doi:") 
      ? data.elocationid.replace("doi:", "").trim() 
      : undefined);

    const publicationType = this.mapPublicationType(data.pubtype);

    return {
      id: `pubmed_${pmid}`,
      source: "pubmed",
      title: data.title.replace(/\.$/, ""),
      authors,
      journal: {
        title: data.fulljournalname || data.source,
        abbreviation: data.source,
        issn: data.issn,
        eissn: data.essn,
        volume: data.volume,
        issue: data.issue,
        pages: data.pages,
      },
      publicationType,
      publicationDate: pubDate,
      year,
      month,
      doi,
      pmid,
      url: `https://pubmed.ncbi.nlm.nih.gov/${pmid}/`,
      language: data.lang?.[0] || "en",
      languages: data.lang,
      citationCount: data.pmcrefcount ? parseInt(data.pmcrefcount) : undefined,
      isPeerReviewed: true,
    };
  }

  private mapPublicationType(pubTypes: string[]): ScientificArticle["publicationType"] {
    if (!pubTypes || pubTypes.length === 0) return "journal_article";
    
    const typeMap: Record<string, ScientificArticle["publicationType"]> = {
      "Meta-Analysis": "meta_analysis",
      "Systematic Review": "systematic_review",
      "Review": "review",
      "Clinical Trial": "clinical_trial",
      "Randomized Controlled Trial": "randomized_controlled_trial",
      "Case Reports": "case_report",
      "Editorial": "editorial",
      "Letter": "letter",
      "Comment": "comment",
    };

    for (const pubType of pubTypes) {
      if (typeMap[pubType]) {
        return typeMap[pubType];
      }
    }

    return "journal_article";
  }

  private delay(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}

export const pubmedService = new PubMedService();
