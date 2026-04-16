export interface SearchOptions {
  type?: 'messages' | 'chats' | 'documents' | 'all';
  userId: string;
  orgId?: string;
  limit?: number;
  offset?: number;
  dateFrom?: Date;
  dateTo?: Date;
}

export interface SearchResult {
  id: string;
  type: string;
  title: string;
  content: string;
  highlights: string[];
  score: number;
  timestamp: Date;
  metadata?: any;
}

interface IndexedDoc {
  id: string;
  type: string;
  title: string;
  content: string;
  tokens: Map<string, number>;
  userId: string;
  metadata?: any;
  timestamp: Date;
}

function tokenize(text: string): string[] {
  return text.toLowerCase().replace(/[^\w\s]/g, '').split(/\s+/).filter(Boolean);
}

function computeTf(tokens: string[]): Map<string, number> {
  const tf = new Map<string, number>();
  for (const t of tokens) tf.set(t, (tf.get(t) || 0) + 1);
  const len = tokens.length || 1;
  for (const [k, v] of tf) tf.set(k, v / len);
  return tf;
}

function highlight(content: string, queryTokens: string[]): string[] {
  const results: string[] = [];
  const sentences = content.split(/[.!?\n]+/).filter(Boolean);
  for (const s of sentences) {
    const lower = s.toLowerCase();
    if (queryTokens.some((t) => lower.includes(t))) {
      let marked = s.trim();
      for (const t of queryTokens) {
        marked = marked.replace(new RegExp(`(${t})`, 'gi'), '<mark>$1</mark>');
      }
      results.push(marked);
    }
    if (results.length >= 3) break;
  }
  return results;
}

export class SearchEngine {
  private index = new Map<string, IndexedDoc>();
  private docFreq = new Map<string, number>();
  private totalDocs = 0;
  private recentSearches = new Map<string, string[]>();

  indexDocument(id: string, type: string, title: string, content: string, userId: string, metadata?: any): void {
    const tokens = tokenize(`${title} ${content}`);
    const tf = computeTf(tokens);
    if (this.index.has(id)) {
      const old = this.index.get(id)!;
      for (const k of old.tokens.keys()) {
        const c = this.docFreq.get(k) || 1;
        if (c <= 1) this.docFreq.delete(k); else this.docFreq.set(k, c - 1);
      }
      this.totalDocs--;
    }
    this.index.set(id, { id, type, title, content, tokens: tf, userId, metadata, timestamp: new Date() });
    for (const k of tf.keys()) this.docFreq.set(k, (this.docFreq.get(k) || 0) + 1);
    this.totalDocs++;
  }

  async search(query: string, opts: SearchOptions): Promise<SearchResult[]> {
    const queryTokens = tokenize(query);
    if (!queryTokens.length) return [];
    this.addRecentSearch(opts.userId, query);
    const limit = opts.limit ?? 20;
    const offset = opts.offset ?? 0;
    const scored: { doc: IndexedDoc; score: number }[] = [];

    for (const doc of this.index.values()) {
      if (doc.userId !== opts.userId) continue;
      if (opts.type && opts.type !== 'all' && doc.type !== opts.type) continue;
      if (opts.dateFrom && doc.timestamp < opts.dateFrom) continue;
      if (opts.dateTo && doc.timestamp > opts.dateTo) continue;

      let score = 0;
      for (const qt of queryTokens) {
        const tf = doc.tokens.get(qt) || 0;
        if (tf === 0) continue;
        const df = this.docFreq.get(qt) || 1;
        const idf = Math.log((this.totalDocs + 1) / (df + 1)) + 1;
        score += tf * idf;
      }
      if (score > 0) scored.push({ doc, score });
    }

    scored.sort((a, b) => b.score - a.score);
    return scored.slice(offset, offset + limit).map(({ doc, score }) => ({
      id: doc.id,
      type: doc.type,
      title: doc.title,
      content: doc.content.slice(0, 300),
      highlights: highlight(doc.content, queryTokens),
      score,
      timestamp: doc.timestamp,
      metadata: doc.metadata,
    }));
  }

  async getSuggestions(prefix: string, userId: string): Promise<string[]> {
    const lower = prefix.toLowerCase();
    const history = this.recentSearches.get(userId) || [];
    return history.filter((s) => s.toLowerCase().startsWith(lower)).slice(0, 10);
  }

  private addRecentSearch(userId: string, query: string): void {
    const history = this.recentSearches.get(userId) || [];
    const filtered = history.filter((s) => s !== query);
    filtered.unshift(query);
    this.recentSearches.set(userId, filtered.slice(0, 100));
  }
}

export const searchEngine = new SearchEngine();

export function searchMessages(query: string, userId: string, limit = 20): Promise<SearchResult[]> {
  return searchEngine.search(query, { type: 'messages', userId, limit });
}

export function searchChats(query: string, userId: string, limit = 20): Promise<SearchResult[]> {
  return searchEngine.search(query, { type: 'chats', userId, limit });
}

export function indexDocument(id: string, type: string, title: string, content: string, userId: string, metadata?: any): void {
  searchEngine.indexDocument(id, type, title, content, userId, metadata);
}
