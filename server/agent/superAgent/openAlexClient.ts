import { persistentJsonCacheGet, persistentJsonCacheSet } from "../../lib/persistentJsonCache";
import { sanitizeSearchQuery } from "../../lib/textSanitizers";

export interface OpenAlexWork {
  id: string;
  doi: string;
  title: string;
  publication_year: number;
  publication_date: string;
  primary_location: {
    source?: {
      display_name?: string;
    };
    landing_page_url?: string;
  } | null;
  authorships: Array<{
    author: {
      display_name: string;
    };
    institutions: Array<{
      display_name: string;
      country_code?: string;
      city?: string;
    }>;
  }>;
  abstract_inverted_index: Record<string, number[]> | null;
  keywords: Array<{ keyword: string }>;
  concepts: Array<{ display_name: string; score: number }>;
  cited_by_count: number;
  type: string;
  language: string;
  open_access: {
    is_oa: boolean;
    oa_url?: string;
  };
}

export interface AcademicCandidate {
  source: "openalex" | "crossref" | "semantic_scholar" | "scopus";
  sourceId: string;
  doi: string;
  title: string;
  year: number;
  publicationDate: string;
  journal: string;
  abstract: string;
  authors: string[];
  keywords: string[];
  language: string;
  documentType: string;
  citationCount: number;
  affiliations: string[];
  city: string;
  country: string;
  institutionCountryCodes: string[];
  primaryInstitutionCountryCode?: string;
  landingUrl: string;
  doiUrl: string;
  verified: boolean;
  relevanceScore: number;
  verificationStatus: "pending" | "verified" | "failed";
}

const OPENALEX_BASE = "https://api.openalex.org/works";
const OPENALEX_MAILTO = (process.env.OPENALEX_MAILTO || process.env.ACADEMIC_MAILTO || "").trim();
const BASE_USER_AGENT = (process.env.HTTP_USER_AGENT || "IliaGPT/1.0").trim();
const RATE_LIMIT_MS = 100;
const MAX_RETRIES = 3;
const BACKOFF_BASE_MS = 500;

/**
 * Sanitize and harden OpenAlex search query input
 */
function sanitizeOpenAlexQuery(raw: string): string {
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

async function fetchWithRetry(url: string, retries: number = MAX_RETRIES): Promise<Response | null> {
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      await rateLimit();

      const ua = OPENALEX_MAILTO && !/mailto:/i.test(BASE_USER_AGENT)
        ? `${BASE_USER_AGENT} (mailto:${OPENALEX_MAILTO})`
        : BASE_USER_AGENT;

      const response = await fetch(url, {
        headers: {
          "Accept": "application/json",
          "User-Agent": ua,
        },
      });

      if (response.ok) return response;

      // OpenAlex rate limit / transient server errors
      if ((response.status === 429 || response.status >= 500) && attempt < retries) {
        const jitter = Math.floor(Math.random() * 200);
        const backoff = BACKOFF_BASE_MS * Math.pow(2, attempt) + jitter;
        await new Promise(resolve => setTimeout(resolve, backoff));
        continue;
      }

      return response;
    } catch (error: any) {
      if (attempt < retries) {
        const jitter = Math.floor(Math.random() * 200);
        const backoff = BACKOFF_BASE_MS * Math.pow(2, attempt) + jitter;
        await new Promise(resolve => setTimeout(resolve, backoff));
        continue;
      }
      return null;
    }
  }

  return null;
}

function invertedIndexToText(inverted: Record<string, number[]> | null): string {
  if (!inverted) return "";
  
  const words: Array<[string, number]> = [];
  for (const [word, positions] of Object.entries(inverted)) {
    for (const pos of positions) {
      words.push([word, pos]);
    }
  }
  words.sort((a, b) => a[1] - b[1]);
  return words.map(w => w[0]).join(" ");
}

const COUNTRY_CODES: Record<string, string> = {
  "US": "United States", "GB": "United Kingdom", "UK": "United Kingdom",
  "CN": "China", "DE": "Germany", "FR": "France", "JP": "Japan",
  "BR": "Brazil", "IN": "India", "AU": "Australia", "CA": "Canada",
  "IT": "Italy", "ES": "Spain", "MX": "Mexico", "NL": "Netherlands",
  "KR": "South Korea", "IR": "Iran", "TR": "Turkey", "EG": "Egypt",
  "SA": "Saudi Arabia", "MY": "Malaysia", "ID": "Indonesia", "TH": "Thailand",
  "PT": "Portugal", "PL": "Poland", "RU": "Russia", "PK": "Pakistan",
  "NG": "Nigeria", "ZA": "South Africa", "CO": "Colombia", "CL": "Chile",
  "AR": "Argentina", "PE": "Peru", "VN": "Vietnam", "PH": "Philippines",
  "TW": "Taiwan", "SG": "Singapore", "HK": "Hong Kong", "GR": "Greece",
  "SE": "Sweden", "NO": "Norway", "DK": "Denmark", "FI": "Finland",
  "BE": "Belgium", "CH": "Switzerland", "AT": "Austria", "CZ": "Czech Republic",
  "HU": "Hungary", "RO": "Romania", "UA": "Ukraine", "IL": "Israel",
  "IQ": "Iraq", "JO": "Jordan", "LB": "Lebanon", "MA": "Morocco",
  "DZ": "Algeria", "TN": "Tunisia", "NZ": "New Zealand", "BD": "Bangladesh",
  "LK": "Sri Lanka", "IE": "Ireland", "AE": "United Arab Emirates",
};

const COUNTRY_NAMES_PATTERN = /\b(United States|USA|U\.S\.A\.|United Kingdom|UK|England|China|P\.R\. China|Germany|France|Japan|Brazil|Brasil|India|Australia|Canada|Italy|Italia|Spain|España|Mexico|México|Netherlands|South Korea|Korea|Iran|Turkey|Egypt|Saudi Arabia|Malaysia|Indonesia|Thailand|Portugal|Poland|Russia|Pakistan|Nigeria|South Africa|Colombia|Chile|Argentina|Peru|Vietnam|Philippines|Taiwan|Singapore|Hong Kong|Greece|Sweden|Norway|Denmark|Finland|Belgium|Switzerland|Austria|Czech Republic|Czechia|Hungary|Romania|Ukraine|Israel|Iraq|Jordan|Lebanon|Morocco|Algeria|Tunisia|New Zealand|Bangladesh|Sri Lanka|Ireland|United Arab Emirates|UAE)\b/i;

function extractCountryFromText(text: string): string {
  const match = text.match(COUNTRY_NAMES_PATTERN);
  if (match) {
    const found = match[1].toLowerCase();
    if (found === "usa" || found === "u.s.a." || found === "united states") return "United States";
    if (found === "uk" || found === "england" || found === "united kingdom") return "United Kingdom";
    if (found === "p.r. china") return "China";
    if (found === "brasil") return "Brazil";
    if (found === "italia") return "Italy";
    if (found === "españa") return "Spain";
    if (found === "méxico") return "Mexico";
    if (found === "korea" || found === "south korea") return "South Korea";
    if (found === "czechia") return "Czech Republic";
    if (found === "uae") return "United Arab Emirates";
    return match[1];
  }
  return "";
}

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

function extractCityFromText(text: string): string {
  const lower = text.toLowerCase();
  for (const [pattern, cityName] of Object.entries(KNOWN_CITIES)) {
    if (lower.includes(pattern)) {
      return cityName;
    }
  }
  const parts = text.split(/[,;]/);
  if (parts.length >= 2) {
    const possibleCity = parts[parts.length - 2].trim();
    if (possibleCity.length > 2 && possibleCity.length < 40 && !/^\d/.test(possibleCity) && !/university|institute|college|department|school|faculty|center|centre/i.test(possibleCity)) {
      return possibleCity;
    }
  }
  return "";
}

function extractCountryFromAffiliations(authorships: OpenAlexWork["authorships"]): string {
  for (const auth of authorships) {
    for (const inst of auth.institutions) {
      if (inst.country_code) {
        return COUNTRY_CODES[inst.country_code.toUpperCase()] || inst.country_code;
      }
      const fromText = extractCountryFromText(inst.display_name);
      if (fromText) return fromText;
    }
  }
  for (const auth of authorships) {
    for (const inst of auth.institutions) {
      const fromText = extractCountryFromText(inst.display_name);
      if (fromText) return fromText;
    }
  }
  return "Unknown";
}

function extractCityFromAffiliations(authorships: OpenAlexWork["authorships"]): string {
  for (const auth of authorships) {
    for (const inst of auth.institutions) {
      if (inst.city) {
        return inst.city;
      }
    }
  }
  for (const auth of authorships) {
    for (const inst of auth.institutions) {
      const fromText = extractCityFromText(inst.display_name);
      if (fromText) return fromText;
    }
  }
  return "Unknown";
}

function extractInstitutionCountryCodes(authorships: OpenAlexWork["authorships"]): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const auth of authorships || []) {
    for (const inst of auth.institutions || []) {
      const code = (inst.country_code || "").trim().toUpperCase();
      if (!code) continue;
      if (seen.has(code)) continue;
      seen.add(code);
      out.push(code);
    }
  }
  return out;
}

function extractPrimaryInstitutionCountryCode(authorships: OpenAlexWork["authorships"]): string | undefined {
  const code = (authorships?.[0]?.institutions?.[0]?.country_code || "").trim().toUpperCase();
  return code || undefined;
}

function mapWorkToCandidate(work: OpenAlexWork): AcademicCandidate {
  const doi = work.doi?.replace("https://doi.org/", "") || "";
  const abstract = invertedIndexToText(work.abstract_inverted_index);

  return {
    source: "openalex" as const,
    sourceId: work.id,
    doi,
    title: work.title || "",
    year: work.publication_year || 0,
    publicationDate: work.publication_date || "",
    journal: work.primary_location?.source?.display_name || "Unknown",
    abstract,
    authors: work.authorships.map(a => a.author.display_name).filter(Boolean),
    keywords: work.keywords?.map(k => k.keyword) || work.concepts?.slice(0, 5).map(c => c.display_name) || [],
    language: work.language || "en",
    documentType: work.type || "article",
    citationCount: work.cited_by_count || 0,
    affiliations: work.authorships.flatMap(a => a.institutions.map(i => i.display_name)).filter(Boolean),
    city: extractCityFromAffiliations(work.authorships),
    country: extractCountryFromAffiliations(work.authorships),
    institutionCountryCodes: extractInstitutionCountryCodes(work.authorships),
    primaryInstitutionCountryCode: extractPrimaryInstitutionCountryCode(work.authorships),
    landingUrl: work.primary_location?.landing_page_url || work.open_access?.oa_url || "",
    doiUrl: doi ? `https://doi.org/${doi}` : "",
    verified: false,
    relevanceScore: 0,
    verificationStatus: "pending" as const,
  };
}

export async function searchOpenAlex(
  query: string,
  options: {
    yearStart?: number;
    yearEnd?: number;
    maxResults?: number;
    countryCodes?: string[];
  } = {}
): Promise<AcademicCandidate[]> {
  const currentYear = new Date().getFullYear();
  const { yearStart = 2020, yearEnd = currentYear, maxResults = 100, countryCodes } = options;
  const clampedMax = Math.max(1, Math.min(500, maxResults));
  const clampedYearStart = Math.max(1900, Math.min(currentYear + 1, yearStart));
  const clampedYearEnd = Math.max(clampedYearStart, Math.min(currentYear + 1, yearEnd));

  // Sanitize query input
  const sanitized = sanitizeOpenAlexQuery(query);
  if (!sanitized) {
    console.warn("[OpenAlex] Empty query after sanitization");
    return [];
  }

  // Avoid ambiguous alternation that can cause excessive backtracking on crafted input.
  // Treat AND as just another separator and then split on whitespace.
  const normalized = sanitized.replace(/\s+AND\s+/gi, " ").trim();
  const searchTerms = normalized.split(/\s+/).filter(t => t.length > 2);
  const searchQuery = searchTerms.join(" ");

  try {
    const candidates: AcademicCandidate[] = [];
    let cursor = "*";

    while (candidates.length < clampedMax && cursor) {
      const remaining = clampedMax - candidates.length;

      const filters: string[] = [
        `from_publication_date:${clampedYearStart}-01-01`,
        `to_publication_date:${clampedYearEnd}-12-31`,
      ];

      const codes = (countryCodes || []).map(c => c.trim().toUpperCase()).filter(Boolean);
      if (codes.length > 0) {
        // Geographic filtering at query-time (strict)
        filters.push(`authorships.institutions.country_code:${Array.from(new Set(codes)).join("|")}`);
      }

      const params = new URLSearchParams({
        search: searchQuery,
        filter: filters.join(","),
        cursor,
        "per-page": String(Math.min(200, remaining)),
        sort: "cited_by_count:desc",
        select: [
          "id",
          "doi",
          "title",
          "publication_year",
          "publication_date",
          "primary_location",
          "authorships",
          "abstract_inverted_index",
          "keywords",
          "concepts",
          "cited_by_count",
          "type",
          "language",
          "open_access",
        ].join(","),
      });
      if (OPENALEX_MAILTO) params.set("mailto", OPENALEX_MAILTO);

      const url = `${OPENALEX_BASE}?${params}`;
      const response = await fetchWithRetry(url);

      if (!response) {
        console.error("[OpenAlex] Network error (no response)");
        break;
      }

      if (!response.ok) {
        console.error(`[OpenAlex] API error: ${response.status}`);
        break;
      }

      const data = await response.json();
      const results = data.results || [];

      for (const work of results as OpenAlexWork[]) {
        candidates.push(mapWorkToCandidate(work));
        if (candidates.length >= clampedMax) break;
      }

      cursor = data.meta?.next_cursor || "";
      if (!cursor || results.length === 0) break;
    }

    return candidates;
  } catch (error: any) {
    console.error(`[OpenAlex] Search error: ${error.message}`);
    return [];
  }
}

export async function lookupOpenAlexWorkByDoi(doi: string): Promise<AcademicCandidate | null> {
  const cleanDoi = (doi || "").replace(/^https?:\/\/doi\.org\//i, "").trim();
  if (!cleanDoi) return null;

  const cacheKey = cleanDoi.toLowerCase();
  const cached = await persistentJsonCacheGet<AcademicCandidate>("openalex.workByDoi", cacheKey);
  if (cached) return cached;

  const u = new URL(`${OPENALEX_BASE}/doi:${encodeURIComponent(cleanDoi)}`);
  if (OPENALEX_MAILTO) u.searchParams.set("mailto", OPENALEX_MAILTO);
  const response = await fetchWithRetry(u.toString());

  if (!response || !response.ok) return null;

  try {
    const data = await response.json();
    if (!data?.id) return null;
    const candidate = mapWorkToCandidate(data as OpenAlexWork);
    await persistentJsonCacheSet("openalex.workByDoi", cacheKey, candidate, 1000 * 60 * 60 * 24 * 30);
    return candidate;
  } catch {
    return null;
  }
}

export async function searchOpenAlexWithMultipleQueries(
  queries: string[],
  options: {
    yearStart?: number;
    yearEnd?: number;
    maxResults?: number;
  } = {}
): Promise<AcademicCandidate[]> {
  const allCandidates: AcademicCandidate[] = [];
  const seenDois = new Set<string>();

  for (const query of queries) {
    const candidates = await searchOpenAlex(query, options);
    
    for (const candidate of candidates) {
      const key = candidate.doi || candidate.title.toLowerCase().substring(0, 50);
      if (!seenDois.has(key)) {
        seenDois.add(key);
        allCandidates.push(candidate);
      }
    }
    
    await new Promise(resolve => setTimeout(resolve, 200));
  }

  return allCandidates;
}
