import { httpGet } from "./internetAccess";
import { JSDOM } from "jsdom";

type SR = { title: string; url: string; snippet: string };

async function safeJson<T = any>(url: string, headers?: Record<string, string>): Promise<T | null> {
  try {
    const r = await httpGet(url, 0, headers);
    if (r.status < 200 || r.status >= 300) return null;
    return JSON.parse(r.body) as T;
  } catch {
    return null;
  }
}

export async function dbPubMed(query: string): Promise<SR[]> {
  const sr = await safeJson<any>(`https://eutils.ncbi.nlm.nih.gov/entrez/eutils/esearch.fcgi?db=pubmed&retmode=json&retmax=5&term=${encodeURIComponent(query)}`);
  const ids: string[] = sr?.esearchresult?.idlist || [];
  if (!ids.length) return [];
  const summary = await safeJson<any>(`https://eutils.ncbi.nlm.nih.gov/entrez/eutils/esummary.fcgi?db=pubmed&retmode=json&id=${ids.join(",")}`);
  return ids.map((id) => {
    const item = summary?.result?.[id] || {};
    return {
      title: `${item.title || id} (PubMed)`,
      url: `https://pubmed.ncbi.nlm.nih.gov/${id}/`,
      snippet: `${item.source || ""} · ${item.pubdate || ""} · ${(item.authors || []).slice(0, 3).map((a: any) => a.name).join(", ")}`,
    };
  });
}

export async function dbSemanticScholar(query: string): Promise<SR[]> {
  const r = await safeJson<any>(`https://api.semanticscholar.org/graph/v1/paper/search?query=${encodeURIComponent(query)}&limit=5&fields=title,abstract,year,authors,url`);
  return (r?.data || []).map((p: any) => ({
    title: `${p.title} (Semantic Scholar)`,
    url: p.url || `https://www.semanticscholar.org/paper/${p.paperId}`,
    snippet: `${p.year || ""} · ${(p.authors || []).slice(0, 3).map((a: any) => a.name).join(", ")} · ${(p.abstract || "").slice(0, 200)}`,
  }));
}

export async function dbOpenAlex(query: string): Promise<SR[]> {
  const r = await safeJson<any>(`https://api.openalex.org/works?search=${encodeURIComponent(query)}&per-page=5`);
  return (r?.results || []).map((w: any) => ({
    title: `${w.title} (OpenAlex)`,
    url: w.doi ? `https://doi.org/${w.doi.replace(/^https?:\/\/doi.org\//, "")}` : w.id,
    snippet: `${w.publication_year || ""} · cited ${w.cited_by_count || 0}× · ${(w.authorships || []).slice(0, 3).map((a: any) => a.author?.display_name).join(", ")}`,
  }));
}

export async function dbCrossRef(query: string): Promise<SR[]> {
  const r = await safeJson<any>(`https://api.crossref.org/works?query=${encodeURIComponent(query)}&rows=5`);
  return (r?.message?.items || []).map((w: any) => ({
    title: `${(w.title || [])[0] || "Untitled"} (CrossRef)`,
    url: w.URL || (w.DOI ? `https://doi.org/${w.DOI}` : ""),
    snippet: `${w.publisher || ""} · ${(w.author || []).slice(0, 3).map((a: any) => `${a.given || ""} ${a.family || ""}`).join(", ")}`,
  }));
}

export async function dbHackerNews(query: string): Promise<SR[]> {
  const r = await safeJson<any>(`https://hn.algolia.com/api/v1/search?query=${encodeURIComponent(query)}&hitsPerPage=5`);
  return (r?.hits || []).map((h: any) => ({
    title: `${h.title || h.story_title || "HN"} (Hacker News)`,
    url: h.url || `https://news.ycombinator.com/item?id=${h.objectID}`,
    snippet: `${h.points || 0} points · ${h.num_comments || 0} comments · by ${h.author}`,
  }));
}

export async function dbReddit(query: string): Promise<SR[]> {
  const r = await safeJson<any>(`https://www.reddit.com/search.json?q=${encodeURIComponent(query)}&limit=5`, { "User-Agent": "openclaw-research/1.0" });
  return (r?.data?.children || []).map((c: any) => {
    const d = c.data || {};
    return {
      title: `${d.title} (r/${d.subreddit})`,
      url: `https://www.reddit.com${d.permalink}`,
      snippet: `${d.score || 0} ↑ · ${d.num_comments || 0} comments · ${(d.selftext || "").slice(0, 200)}`,
    };
  });
}

export async function dbGitHub(query: string): Promise<SR[]> {
  const r = await safeJson<any>(`https://api.github.com/search/repositories?q=${encodeURIComponent(query)}&per_page=5`, { Accept: "application/vnd.github+json" });
  return (r?.items || []).map((repo: any) => ({
    title: `${repo.full_name} (GitHub)`,
    url: repo.html_url,
    snippet: `★ ${repo.stargazers_count} · ${repo.language || "?"} · ${repo.description || ""}`,
  }));
}

export async function dbOpenLibrary(query: string): Promise<SR[]> {
  const r = await safeJson<any>(`https://openlibrary.org/search.json?q=${encodeURIComponent(query)}&limit=5`);
  return (r?.docs || []).map((b: any) => ({
    title: `${b.title} (Open Library)`,
    url: `https://openlibrary.org${b.key}`,
    snippet: `by ${(b.author_name || []).slice(0, 3).join(", ")} · first published ${b.first_publish_year || "?"}`,
  }));
}

export async function dbGoogleBooks(query: string): Promise<SR[]> {
  const r = await safeJson<any>(`https://www.googleapis.com/books/v1/volumes?q=${encodeURIComponent(query)}&maxResults=5`);
  return (r?.items || []).map((b: any) => {
    const v = b.volumeInfo || {};
    return {
      title: `${v.title} (Google Books)`,
      url: v.infoLink || v.canonicalVolumeLink || "",
      snippet: `${(v.authors || []).slice(0, 3).join(", ")} · ${v.publishedDate || ""} · ${(v.description || "").slice(0, 200)}`,
    };
  });
}

export async function dbWikidata(query: string): Promise<SR[]> {
  const r = await safeJson<any>(`https://www.wikidata.org/w/api.php?action=wbsearchentities&search=${encodeURIComponent(query)}&language=en&format=json&limit=5`);
  return (r?.search || []).map((e: any) => ({
    title: `${e.label} (Wikidata)`,
    url: `https://www.wikidata.org/wiki/${e.id}`,
    snippet: e.description || "",
  }));
}

export async function dbDOAJ(query: string): Promise<SR[]> {
  const r = await safeJson<any>(`https://doaj.org/api/search/articles/${encodeURIComponent(query)}?pageSize=5`);
  return (r?.results || []).map((a: any) => {
    const b = a.bibjson || {};
    const links = b.link || [];
    return {
      title: `${b.title} (DOAJ)`,
      url: links[0]?.url || `https://doaj.org/article/${a.id}`,
      snippet: `${b.year || ""} · ${(b.author || []).slice(0, 3).map((au: any) => au.name).join(", ")} · ${(b.abstract || "").slice(0, 200)}`,
    };
  });
}

export async function dbWorldBank(query: string): Promise<SR[]> {
  const r = await safeJson<any>(`https://search.worldbank.org/api/v3/wds?qterm=${encodeURIComponent(query)}&rows=5&format=json`);
  const docs = r?.documents || {};
  return Object.values(docs).map((d: any) => ({
    title: `${d.display_title || d.title || "Untitled"} (World Bank)`,
    url: d.url || d.pdfurl || "",
    snippet: `${d.docdt || ""} · ${d.docty || ""} · ${(d.abstracts || "").slice(0, 200)}`,
  }));
}

export async function dbREST_Countries(query: string): Promise<SR[]> {
  const r = await safeJson<any[]>(`https://restcountries.com/v3.1/name/${encodeURIComponent(query)}?fields=name,capital,population,region,flags`);
  return (r || []).slice(0, 5).map((c: any) => ({
    title: `${c.name?.common} (REST Countries)`,
    url: c.flags?.alt ? `https://en.wikipedia.org/wiki/${encodeURIComponent(c.name.common)}` : "",
    snippet: `Capital: ${(c.capital || ["?"])[0]} · Population: ${c.population?.toLocaleString() || "?"} · Region: ${c.region}`,
  }));
}

export async function dbCoinGecko(query: string): Promise<SR[]> {
  const r = await safeJson<any>(`https://api.coingecko.com/api/v3/search?query=${encodeURIComponent(query)}`);
  return (r?.coins || []).slice(0, 5).map((c: any) => ({
    title: `${c.name} (${c.symbol?.toUpperCase()}) — CoinGecko`,
    url: `https://www.coingecko.com/en/coins/${c.id}`,
    snippet: `Market cap rank: ${c.market_cap_rank || "—"}`,
  }));
}

export async function dbMusicBrainz(query: string): Promise<SR[]> {
  const r = await safeJson<any>(`https://musicbrainz.org/ws/2/recording?query=${encodeURIComponent(query)}&fmt=json&limit=5`, { "User-Agent": "openclaw-research/1.0 (contact@local)" });
  return (r?.recordings || []).map((rec: any) => ({
    title: `${rec.title} (MusicBrainz)`,
    url: `https://musicbrainz.org/recording/${rec.id}`,
    snippet: `${(rec["artist-credit"] || []).map((a: any) => a.name).join(", ")} · ${rec.length ? Math.floor(rec.length / 1000) + "s" : ""}`,
  }));
}

export async function dbNominatim(query: string): Promise<SR[]> {
  const r = await safeJson<any[]>(`https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(query)}&format=json&limit=5`, { "User-Agent": "openclaw-research/1.0" });
  return (r || []).map((p: any) => ({
    title: `${p.display_name} (OpenStreetMap)`,
    url: `https://www.openstreetmap.org/?mlat=${p.lat}&mlon=${p.lon}#map=14/${p.lat}/${p.lon}`,
    snippet: `Lat ${p.lat} · Lon ${p.lon} · type ${p.type}`,
  }));
}

export async function dbCORE(query: string): Promise<SR[]> {
  const r = await safeJson<any>(`https://api.core.ac.uk/v3/search/works?q=${encodeURIComponent(query)}&limit=5`);
  return (r?.results || []).map((w: any) => ({
    title: `${w.title} (CORE)`,
    url: w.downloadUrl || w.doi || w.sourceFulltextUrls?.[0] || "",
    snippet: `${w.yearPublished || ""} · ${(w.authors || []).slice(0, 3).map((a: any) => a.name).join(", ")} · ${(w.abstract || "").slice(0, 200)}`,
  }));
}

export const FREE_DATABASES: { name: string; run: (q: string) => Promise<SR[]> }[] = [
  { name: "pubmed", run: dbPubMed },
  { name: "semantic-scholar", run: dbSemanticScholar },
  { name: "openalex", run: dbOpenAlex },
  { name: "crossref", run: dbCrossRef },
  { name: "doaj", run: dbDOAJ },
  { name: "core", run: dbCORE },
  { name: "hackernews", run: dbHackerNews },
  { name: "reddit", run: dbReddit },
  { name: "github", run: dbGitHub },
  { name: "open-library", run: dbOpenLibrary },
  { name: "google-books", run: dbGoogleBooks },
  { name: "wikidata", run: dbWikidata },
  { name: "world-bank", run: dbWorldBank },
  { name: "rest-countries", run: dbREST_Countries },
  { name: "coingecko", run: dbCoinGecko },
  { name: "musicbrainz", run: dbMusicBrainz },
  { name: "openstreetmap", run: dbNominatim },
];
