import { AcademicCandidate } from "./openAlexClient";
import { persistentJsonCacheGet, persistentJsonCacheSet } from "../../lib/persistentJsonCache";
import { sanitizeSearchQuery } from "../../lib/textSanitizers";

const CROSSREF_WORKS_BASE = "https://api.crossref.org/works";
const CROSSREF_MAILTO = (process.env.CROSSREF_MAILTO || process.env.ACADEMIC_MAILTO || "").trim();
const BASE_USER_AGENT = (process.env.HTTP_USER_AGENT || "IliaGPT/1.0").trim();
const RATE_LIMIT_MS = 200;
const MAX_RETRIES = 3;
const BACKOFF_BASE_MS = 1000;

/**
 * Sanitize and harden CrossRef search query input
 */
function sanitizeCrossRefQuery(raw: string): string {
    return sanitizeSearchQuery(raw, 500);
}

let lastRequestTime = 0;

async function rateLimit(): Promise<void> {
  const now = Date.now();
  const elapsed = now - lastRequestTime;
  if (elapsed < RATE_LIMIT_MS) {
    await new Promise(resolve => setTimeout(resolve, RATE_LIMIT_MS - elapsed));
  }
  lastRequestTime = Date.now();
}

async function fetchWithRetry(url: string, options: RequestInit, retries = MAX_RETRIES): Promise<Response> {
  for (let attempt = 0; attempt <= retries; attempt++) {
    await rateLimit();
    const response = await fetch(url, options);
    if ((response.status === 429 || response.status >= 500) && attempt < retries) {
      const waitTime = BACKOFF_BASE_MS * Math.pow(2, attempt);
      console.log(`[CrossRef] Rate limited, waiting ${waitTime}ms before retry ${attempt + 1}/${retries}`);
      await new Promise(resolve => setTimeout(resolve, waitTime));
      continue;
    }
    return response;
  }
  throw new Error("Max retries exceeded");
}

export interface CrossRefWork {
  DOI: string;
  title: string[];
  author?: Array<{
    given?: string;
    family?: string;
    name?: string;
    affiliation?: Array<{ name: string }>;
  }>;
  "container-title"?: string[];
  abstract?: string;
  volume?: string;
  issue?: string;
  page?: string;
  published?: { "date-parts": number[][] };
  "published-print"?: { "date-parts": number[][] };
  "published-online"?: { "date-parts": number[][] };
  issued?: { "date-parts": number[][] };
  type?: string;
  language?: string;
  subject?: string[];
  "is-referenced-by-count"?: number;
  URL?: string;
  link?: Array<{ URL: string; "content-type"?: string }>;
}

export interface CrossRefMetadata {
  doi: string;
  title: string;
  authors: string[];
  year: number;
  publicationDate?: string;
  journal: string;
  volume?: string;
  issue?: string;
  pages?: string;
  abstract: string;
  documentType: string;
  language: string;
  keywords: string[];
  citationCount: number;
  url: string;
  publisher: string;
  affiliations: string[];
  city: string;
  country: string;
}

function extractYear(work: CrossRefWork): number {
  const dateParts = 
    work.published?.["date-parts"]?.[0] ||
    work["published-print"]?.["date-parts"]?.[0] ||
    work["published-online"]?.["date-parts"]?.[0] ||
    work.issued?.["date-parts"]?.[0];
  
  return dateParts?.[0] || 0;
}

function datePartsToIso(parts: number[] | undefined): string | undefined {
  if (!parts || parts.length === 0) return undefined;
  const y = parts[0];
  if (!y || !Number.isFinite(y)) return undefined;
  const m = parts[1] && Number.isFinite(parts[1]) ? parts[1] : 1;
  const d = parts[2] && Number.isFinite(parts[2]) ? parts[2] : 1;
  const mm = String(Math.max(1, Math.min(12, m))).padStart(2, "0");
  const dd = String(Math.max(1, Math.min(31, d))).padStart(2, "0");
  return `${String(y).padStart(4, "0")}-${mm}-${dd}`;
}

function extractPublicationDate(work: CrossRefWork): string | undefined {
  const parts =
    work["published-online"]?.["date-parts"]?.[0] ||
    work["published-print"]?.["date-parts"]?.[0] ||
    work.published?.["date-parts"]?.[0] ||
    work.issued?.["date-parts"]?.[0];
  return datePartsToIso(parts);
}

function cleanAbstract(abstract: string | undefined): string {
  if (!abstract) return "";
  return abstract
    .replace(/<[^>]+>/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

const COUNTRY_PATTERNS: Record<string, string> = {
  "usa": "United States", "u.s.a.": "United States", "united states": "United States",
  "uk": "United Kingdom", "u.k.": "United Kingdom", "united kingdom": "United Kingdom", "england": "United Kingdom",
  "china": "China", "p.r. china": "China", "pr china": "China",
  "germany": "Germany", "deutschland": "Germany",
  "france": "France", "japan": "Japan", "brazil": "Brazil", "brasil": "Brazil",
  "india": "India", "australia": "Australia", "canada": "Canada",
  "italy": "Italy", "italia": "Italy", "spain": "Spain", "españa": "Spain",
  "mexico": "Mexico", "méxico": "Mexico", "netherlands": "Netherlands",
  "south korea": "South Korea", "korea": "South Korea", "republic of korea": "South Korea",
  "iran": "Iran", "turkey": "Turkey", "egypt": "Egypt", "saudi arabia": "Saudi Arabia",
  "malaysia": "Malaysia", "indonesia": "Indonesia", "thailand": "Thailand",
  "portugal": "Portugal", "poland": "Poland", "russia": "Russia",
  "pakistan": "Pakistan", "nigeria": "Nigeria", "south africa": "South Africa",
  "colombia": "Colombia", "chile": "Chile", "argentina": "Argentina", "peru": "Peru",
  "vietnam": "Vietnam", "philippines": "Philippines", "taiwan": "Taiwan",
  "singapore": "Singapore", "hong kong": "Hong Kong", "greece": "Greece",
  "sweden": "Sweden", "norway": "Norway", "denmark": "Denmark", "finland": "Finland",
  "belgium": "Belgium", "switzerland": "Switzerland", "austria": "Austria",
  "czech republic": "Czech Republic", "czechia": "Czech Republic",
  "hungary": "Hungary", "romania": "Romania", "ukraine": "Ukraine",
  "israel": "Israel", "iraq": "Iraq", "jordan": "Jordan", "lebanon": "Lebanon",
  "morocco": "Morocco", "algeria": "Algeria", "tunisia": "Tunisia",
  "new zealand": "New Zealand", "bangladesh": "Bangladesh", "sri lanka": "Sri Lanka",
};

const KNOWN_CITIES: Record<string, string> = {
  "beijing": "Beijing", "shanghai": "Shanghai", "guangzhou": "Guangzhou", "shenzhen": "Shenzhen",
  "new york": "New York", "los angeles": "Los Angeles", "chicago": "Chicago", "boston": "Boston",
  "san francisco": "San Francisco", "houston": "Houston", "seattle": "Seattle", "atlanta": "Atlanta",
  "london": "London", "manchester": "Manchester", "birmingham": "Birmingham", "cambridge": "Cambridge",
  "oxford": "Oxford", "edinburgh": "Edinburgh", "glasgow": "Glasgow", "bristol": "Bristol",
  "tokyo": "Tokyo", "osaka": "Osaka", "kyoto": "Kyoto", "nagoya": "Nagoya", "yokohama": "Yokohama",
  "berlin": "Berlin", "munich": "Munich", "frankfurt": "Frankfurt", "hamburg": "Hamburg", "cologne": "Cologne",
  "paris": "Paris", "lyon": "Lyon", "marseille": "Marseille", "toulouse": "Toulouse",
  "sydney": "Sydney", "melbourne": "Melbourne", "brisbane": "Brisbane", "perth": "Perth",
  "toronto": "Toronto", "vancouver": "Vancouver", "montreal": "Montreal", "ottawa": "Ottawa",
  "delhi": "Delhi", "mumbai": "Mumbai", "bangalore": "Bangalore", "chennai": "Chennai", "hyderabad": "Hyderabad",
  "sao paulo": "São Paulo", "rio de janeiro": "Rio de Janeiro", "brasilia": "Brasilia",
  "madrid": "Madrid", "barcelona": "Barcelona", "valencia": "Valencia", "seville": "Seville",
  "rome": "Rome", "milan": "Milan", "naples": "Naples", "turin": "Turin", "florence": "Florence",
  "amsterdam": "Amsterdam", "rotterdam": "Rotterdam", "the hague": "The Hague", "utrecht": "Utrecht",
  "seoul": "Seoul", "busan": "Busan", "incheon": "Incheon", "daegu": "Daegu",
  "singapore": "Singapore", "hong kong": "Hong Kong", "taipei": "Taipei", "kaohsiung": "Kaohsiung",
  "moscow": "Moscow", "saint petersburg": "Saint Petersburg", "st. petersburg": "Saint Petersburg",
  "cairo": "Cairo", "alexandria": "Alexandria", "giza": "Giza",
  "istanbul": "Istanbul", "ankara": "Ankara", "izmir": "Izmir",
  "tehran": "Tehran", "isfahan": "Isfahan", "tabriz": "Tabriz",
  "riyadh": "Riyadh", "jeddah": "Jeddah", "mecca": "Mecca",
  "dubai": "Dubai", "abu dhabi": "Abu Dhabi", "sharjah": "Sharjah",
  "kuala lumpur": "Kuala Lumpur", "penang": "Penang", "johor bahru": "Johor Bahru",
  "jakarta": "Jakarta", "surabaya": "Surabaya", "bandung": "Bandung",
  "bangkok": "Bangkok", "chiang mai": "Chiang Mai", "phuket": "Phuket",
  "hanoi": "Hanoi", "ho chi minh": "Ho Chi Minh City", "ho chi minh city": "Ho Chi Minh City",
  "manila": "Manila", "quezon city": "Quezon City", "cebu": "Cebu",
  "lima": "Lima", "bogota": "Bogotá", "bogotá": "Bogotá", "santiago": "Santiago",
  "buenos aires": "Buenos Aires", "cordoba": "Córdoba", "rosario": "Rosario",
  "mexico city": "Mexico City", "guadalajara": "Guadalajara", "monterrey": "Monterrey",
  "johannesburg": "Johannesburg", "cape town": "Cape Town", "durban": "Durban", "pretoria": "Pretoria",
  "lagos": "Lagos", "abuja": "Abuja", "nairobi": "Nairobi", "accra": "Accra",
  "tel aviv": "Tel Aviv", "jerusalem": "Jerusalem", "haifa": "Haifa",
  "vienna": "Vienna", "zurich": "Zurich", "geneva": "Geneva", "brussels": "Brussels",
  "copenhagen": "Copenhagen", "stockholm": "Stockholm", "oslo": "Oslo", "helsinki": "Helsinki",
  "prague": "Prague", "warsaw": "Warsaw", "budapest": "Budapest", "bucharest": "Bucharest",
  "athens": "Athens", "thessaloniki": "Thessaloniki", "lisbon": "Lisbon", "porto": "Porto",
  "dublin": "Dublin", "cork": "Cork", "belfast": "Belfast",
};

function extractLocationFromAffiliations(affiliations: string[]): { city: string; country: string } {
  let city = "Unknown";
  let country = "Unknown";

  for (const aff of affiliations) {
    const lower = aff.toLowerCase();
    
    for (const [pattern, countryName] of Object.entries(COUNTRY_PATTERNS)) {
      if (lower.includes(pattern)) {
        country = countryName;
        break;
      }
    }
    
    if (city === "Unknown") {
      for (const [pattern, cityName] of Object.entries(KNOWN_CITIES)) {
        if (lower.includes(pattern)) {
          city = cityName;
          break;
        }
      }
    }
    
    if (city === "Unknown" && country !== "Unknown") {
      const parts = aff.split(/[,;]/);
      if (parts.length >= 2) {
        const possibleCity = parts[parts.length - 2].trim();
        if (possibleCity.length > 2 && possibleCity.length < 50 && !/^\d/.test(possibleCity) && !/university|institute|college|department|school|faculty|center|centre/i.test(possibleCity)) {
          city = possibleCity;
        }
      }
    }
    
    if (country !== "Unknown" && city !== "Unknown") {
      break;
    }
  }

  return { city, country };
}

export async function lookupDOI(doi: string): Promise<CrossRefMetadata | null> {
  const cleanDoi = (doi || "").replace(/^https?:\/\/doi\.org\//i, "").trim();
  if (!cleanDoi) return null;

  const cacheKey = cleanDoi.toLowerCase();
  const cached = await persistentJsonCacheGet<CrossRefMetadata>("crossref.lookupDoi", cacheKey);
  if (cached) return cached;

  const u = new URL(`${CROSSREF_WORKS_BASE}/${encodeURIComponent(cleanDoi)}`);
  if (CROSSREF_MAILTO) u.searchParams.set("mailto", CROSSREF_MAILTO);
  
  console.log(`[CrossRef] Looking up DOI: ${cleanDoi}`);

  try {
    const ua = CROSSREF_MAILTO && !/mailto:/i.test(BASE_USER_AGENT)
      ? `${BASE_USER_AGENT} (mailto:${CROSSREF_MAILTO})`
      : BASE_USER_AGENT;

    const response = await fetchWithRetry(u.toString(), {
      headers: {
        "Accept": "application/json",
        "User-Agent": ua,
      },
    });

    if (!response.ok) {
      if (response.status !== 429) {
        console.error(`[CrossRef] DOI lookup failed: ${response.status}`);
      }
      return null;
    }

    const data = await response.json();
    const work: CrossRefWork = data.message;

    if (!work) return null;

    const authors = (work.author || []).map(a => {
      if (a.name) return a.name;
      const given = a.given || "";
      const family = a.family || "";
      return [given, family].filter(Boolean).join(" ").trim();
    }).filter(Boolean);

    const affiliations: string[] = [];
    for (const author of work.author || []) {
      for (const aff of author.affiliation || []) {
        if (aff.name && !affiliations.includes(aff.name)) {
          affiliations.push(aff.name);
        }
      }
    }

    const { city, country } = extractLocationFromAffiliations(affiliations);
    const publicationDate = extractPublicationDate(work);

    const metadata: CrossRefMetadata = {
      doi: work.DOI,
      title: work.title?.[0] || "",
      authors,
      year: extractYear(work),
      publicationDate,
      journal: work["container-title"]?.[0] || "Unknown",
      volume: work.volume || "",
      issue: work.issue || "",
      pages: work.page || "",
      abstract: cleanAbstract(work.abstract),
      documentType: work.type || "article",
      language: work.language || "en",
      keywords: work.subject || [],
      citationCount: work["is-referenced-by-count"] || 0,
      url: work.URL || `https://doi.org/${work.DOI}`,
      publisher: "CrossRef",
      affiliations,
      city,
      country,
    };

    await persistentJsonCacheSet("crossref.lookupDoi", cacheKey, metadata, 1000 * 60 * 60 * 24 * 30);
    return metadata;
  } catch (error: any) {
    console.error(`[CrossRef] Lookup error: ${error.message}`);
    return null;
  }
}

export async function searchCrossRef(
  query: string,
  options: {
    yearStart?: number;
    yearEnd?: number;
    maxResults?: number;
  } = {}
): Promise<AcademicCandidate[]> {
  const currentYear = new Date().getFullYear();
  const { yearStart = 2020, yearEnd = currentYear, maxResults = 100 } = options;
  const clampedMax = Math.max(1, Math.min(100, maxResults));
  const clampedYearStart = Math.max(1900, Math.min(currentYear + 1, yearStart));
  const clampedYearEnd = Math.max(clampedYearStart, Math.min(currentYear + 1, yearEnd));

  // Sanitize query input
  const sanitized = sanitizeCrossRefQuery(query);
  if (!sanitized) {
    console.warn("[CrossRef] Empty query after sanitization");
    return [];
  }

  await rateLimit();

  const params = new URLSearchParams({
    query: sanitized,
    rows: String(clampedMax),
    filter: `from-pub-date:${clampedYearStart}-01-01,until-pub-date:${clampedYearEnd}-12-31`,
    sort: "relevance",
  });
  if (CROSSREF_MAILTO) params.set("mailto", CROSSREF_MAILTO);

  const url = `${CROSSREF_WORKS_BASE}?${params}`;
  console.log(`[CrossRef] Searching: ${url}`);

  try {
    const ua = CROSSREF_MAILTO && !/mailto:/i.test(BASE_USER_AGENT)
      ? `${BASE_USER_AGENT} (mailto:${CROSSREF_MAILTO})`
      : BASE_USER_AGENT;

    const response = await fetch(url, {
      headers: {
        "Accept": "application/json",
        "User-Agent": ua,
      },
    });

    if (!response.ok) {
      console.error(`[CrossRef] Search error: ${response.status}`);
      return [];
    }

    const data = await response.json();
    const items = data.message?.items || [];
    
    console.log(`[CrossRef] Found ${items.length} results from ${data.message?.["total-results"] || 0} total`);

    const candidates: AcademicCandidate[] = items.map((work: CrossRefWork) => {
      const authors = (work.author || []).map(a => {
        if (a.name) return a.name;
        return [a.family, a.given].filter(Boolean).join(", ");
      }).filter(Boolean);

      const affiliations: string[] = [];
      for (const author of work.author || []) {
        for (const aff of author.affiliation || []) {
          if (aff.name && !affiliations.includes(aff.name)) {
            affiliations.push(aff.name);
          }
        }
      }

	      return {
	        source: "crossref" as const,
	        sourceId: work.DOI,
	        doi: work.DOI,
	        title: work.title?.[0] || "",
	        year: extractYear(work),
	        publicationDate: extractPublicationDate(work) || "",
	        journal: work["container-title"]?.[0] || "Unknown",
	        abstract: cleanAbstract(work.abstract),
	        authors,
	        keywords: work.subject || [],
	        language: work.language || "en",
	        documentType: work.type || "article",
	        citationCount: work["is-referenced-by-count"] || 0,
	        affiliations,
	        city: "Unknown",
	        country: "Unknown",
	        institutionCountryCodes: [],
	        landingUrl: work.URL || "",
	        doiUrl: work.DOI ? `https://doi.org/${work.DOI}` : "",
	        verified: false,
	        relevanceScore: 0,
	        verificationStatus: "pending" as const,
	      };
	    });

    return candidates;
  } catch (error: any) {
    console.error(`[CrossRef] Search error: ${error.message}`);
    return [];
  }
}

export interface VerifyDOIResult {
  valid: boolean;
  url: string;
  title: string;
  city?: string;
  country?: string;
  year?: number;
  publicationDate?: string;
  authors?: string[];
  journal?: string;
  abstract?: string;
  documentType?: string;
  language?: string;
  volume?: string;
  issue?: string;
  pages?: string;
  keywords?: string[];
}

export async function verifyDOI(doi: string): Promise<VerifyDOIResult> {
  const metadata = await lookupDOI(doi);
  
  if (!metadata) {
    return { valid: false, url: "", title: "" };
  }

  return {
    valid: true,
    url: metadata.url,
    title: metadata.title,
    city: metadata.city,
    country: metadata.country,
    year: metadata.year,
    publicationDate: metadata.publicationDate,
    volume: metadata.volume,
    issue: metadata.issue,
    pages: metadata.pages,
    authors: metadata.authors,
    journal: metadata.journal,
    abstract: metadata.abstract,
    documentType: metadata.documentType,
    language: metadata.language,
    keywords: metadata.keywords,
  };
}
