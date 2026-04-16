import { z } from "zod";

export const AuthorSchema = z.object({
  firstName: z.string().optional(),
  lastName: z.string(),
  fullName: z.string(),
  affiliation: z.string().optional(),
  affiliations: z.array(z.string()).optional(),
  orcid: z.string().optional(),
  email: z.string().optional(),
  isCorresponding: z.boolean().optional(),
});

export const JournalSchema = z.object({
  title: z.string(),
  abbreviation: z.string().optional(),
  issn: z.string().optional(),
  eissn: z.string().optional(),
  volume: z.string().optional(),
  issue: z.string().optional(),
  pages: z.string().optional(),
  impactFactor: z.number().optional(),
  quartile: z.enum(["Q1", "Q2", "Q3", "Q4"]).optional(),
  publisher: z.string().optional(),
});

export const FundingSchema = z.object({
  agency: z.string(),
  grantNumber: z.string().optional(),
  country: z.string().optional(),
});

export const ScientificArticleSchema = z.object({
  id: z.string(),
  source: z.enum([
    "pubmed",
    "scielo",
    "semantic_scholar",
    "semantic",
    "crossref",
    "openalex",
    "core",
    "arxiv",
    "doaj",
    "base",
    "scopus",
    "scholar",
    "duckduckgo",
    "wos",
    "manual",
  ]),
  
  title: z.string(),
  titleTranslated: z.string().optional(),
  
  authors: z.array(AuthorSchema),
  
  abstract: z.string().optional(),
  abstractTranslated: z.string().optional(),
  
  journal: JournalSchema.optional(),
  
  publicationType: z.enum([
    "journal_article",
    "review",
    "systematic_review",
    "meta_analysis",
    "clinical_trial",
    "randomized_controlled_trial",
    "case_report",
    "case_series",
    "editorial",
    "letter",
    "comment",
    "conference_paper",
    "book_chapter",
    "thesis",
    "preprint",
    "other"
  ]).optional(),
  
  publicationDate: z.string().optional(),
  year: z.number().optional(),
  month: z.number().optional(),
  day: z.number().optional(),
  
  doi: z.string().optional(),
  pmid: z.string().optional(),
  pmcid: z.string().optional(),
  arxivId: z.string().optional(),
  scieloId: z.string().optional(),
  
  url: z.string().optional(),
  pdfUrl: z.string().optional(),
  fullTextUrl: z.string().optional(),
  
  keywords: z.array(z.string()).optional(),
  meshTerms: z.array(z.string()).optional(),
  subjects: z.array(z.string()).optional(),
  
  language: z.string().optional(),
  languages: z.array(z.string()).optional(),
  
  citationCount: z.number().optional(),
  referencesCount: z.number().optional(),
  
  isOpenAccess: z.boolean().optional(),
  openAccessStatus: z.enum(["gold", "green", "hybrid", "bronze", "closed"]).optional(),
  license: z.string().optional(),
  
  funding: z.array(FundingSchema).optional(),
  
  affiliations: z.array(z.string()).optional(),
  countries: z.array(z.string()).optional(),
  
  isPeerReviewed: z.boolean().optional(),
  isRetracted: z.boolean().optional(),
  
  createdAt: z.date().optional(),
  updatedAt: z.date().optional(),
});

export type Author = z.infer<typeof AuthorSchema>;
export type Journal = z.infer<typeof JournalSchema>;
export type Funding = z.infer<typeof FundingSchema>;
export type ScientificArticle = z.infer<typeof ScientificArticleSchema>;

export const SearchProgressEventSchema = z.object({
  type: z.enum(["searching", "found", "filtering", "complete", "error"]),
  source: z.string(),
  articlesFound: z.number(),
  totalArticles: z.number(),
  message: z.string(),
  timestamp: z.number(),
});

export type SearchProgressEvent = z.infer<typeof SearchProgressEventSchema>;

export const ScientificSearchResultSchema = z.object({
  query: z.string(),
  totalResults: z.number(),
  articles: z.array(ScientificArticleSchema),
  sources: z.array(z.object({
    name: z.string(),
    count: z.number(),
    status: z.enum(["success", "error", "timeout"]),
  })),
  searchDuration: z.number(),
  filters: z.object({
    yearFrom: z.number().optional(),
    yearTo: z.number().optional(),
    languages: z.array(z.string()).optional(),
    openAccessOnly: z.boolean().optional(),
    publicationTypes: z.array(z.string()).optional(),
  }).optional(),
});

export type ScientificSearchResult = z.infer<typeof ScientificSearchResultSchema>;

export function generateAPA7Citation(article: ScientificArticle): string {
  const authors = formatAuthorsAPA7(article.authors);
  const year = article.year || "n.d.";
  const title = article.title;
  const journal = article.journal?.title || "";
  const volume = article.journal?.volume || "";
  const issue = article.journal?.issue ? `(${article.journal.issue})` : "";
  const pages = article.journal?.pages || "";
  const doi = article.doi ? `https://doi.org/${article.doi}` : "";
  
  let citation = `${authors} (${year}). ${title}.`;
  
  if (journal) {
    citation += ` *${journal}*`;
    if (volume) {
      citation += `, *${volume}*${issue}`;
    }
    if (pages) {
      citation += `, ${pages}`;
    }
    citation += ".";
  }
  
  if (doi) {
    citation += ` 🔗 ${doi}`;
  }

  return citation;
}

function formatAuthorsAPA7(authors: Author[]): string {
  if (!authors || authors.length === 0) {
    return "Author unknown";
  }
  
  const formatAuthor = (author: Author): string => {
    if (author.lastName && author.firstName) {
      const initials = author.firstName
        .split(/\s+/)
        .map((name: string) => name.charAt(0).toUpperCase() + ".")
        .join(" ");
      return `${author.lastName}, ${initials}`;
    }
    return author.fullName || author.lastName;
  };
  
  if (authors.length === 1) {
    return formatAuthor(authors[0]);
  }
  
  if (authors.length === 2) {
    return `${formatAuthor(authors[0])} & ${formatAuthor(authors[1])}`;
  }
  
  if (authors.length <= 20) {
    const allButLast = authors.slice(0, -1).map(formatAuthor).join(", ");
    const last = formatAuthor(authors[authors.length - 1]);
    return `${allButLast}, & ${last}`;
  }
  
  const first19 = authors.slice(0, 19).map(formatAuthor).join(", ");
  const last = formatAuthor(authors[authors.length - 1]);
  return `${first19}, ... ${last}`;
}

export function formatArticleForDisplay(article: ScientificArticle): {
  title: string;
  authors: string;
  journal: string;
  year: string;
  citationCount: string;
  doi: string;
  url: string;
  abstract: string;
  keywords: string;
  source: string;
  openAccess: boolean;
  publicationType: string;
} {
  return {
    title: article.title,
    authors: article.authors.map((a: Author) => a.fullName || `${a.firstName} ${a.lastName}`).join(", "),
    journal: article.journal?.title || "N/A",
    year: article.year?.toString() || "N/A",
    citationCount: article.citationCount?.toString() || "N/A",
    doi: article.doi || "N/A",
    url: article.url ? `🔗 ${article.url}` : (article.doi ? `🔗 https://doi.org/${article.doi}` : "N/A"),
    abstract: article.abstract || "No disponible",
    keywords: article.keywords?.join(", ") || "N/A",
    source: article.source,
    openAccess: article.isOpenAccess || false,
    publicationType: article.publicationType || "journal_article",
  };
}
