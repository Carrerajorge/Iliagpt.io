import { Logger } from '../../lib/logger';
import { HybridRetriever } from './HybridRetriever';

// ---------------------------------------------------------------------------
// Shared types (local definitions — not imported from UnifiedRAGPipeline)
// ---------------------------------------------------------------------------

interface RetrievedChunk {
  id: string;
  documentId: string;
  content: string;
  chunkIndex: number;
  metadata: Record<string, unknown>;
  tokens: number;
  score: number;
  source: string;
  retrievalMethod: 'vector' | 'bm25' | 'hybrid' | 'metadata';
}

interface RetrievedQuery {
  text: string;
  namespace: string;
  topK: number;
  filter?: Record<string, unknown>;
  hybridAlpha?: number;
  minScore?: number;
}

// ---------------------------------------------------------------------------
// Exported types
// ---------------------------------------------------------------------------

export interface DetectedLanguage {
  code: 'en' | 'es' | 'fr' | 'de' | 'pt' | 'it' | 'zh' | 'ja' | 'ko' | 'ar' | 'unknown';
  confidence: number; // 0-1
  script: 'latin' | 'cjk' | 'arabic' | 'cyrillic' | 'other';
}

export interface CrossLingualResult {
  chunk: RetrievedChunk;
  originalLanguage: string;
  queryLanguage: string;
  crossLingual: boolean;
  normalizedScore: number;
}

export interface LanguageProfile {
  languageCode: string;
  commonWords: string[];
  charRanges?: [number, number][];
}

export interface CrossLingualConfig {
  supportedLanguages: string[];       // default ['en','es','fr','de','pt']
  crossLingualBoost: number;          // default 0.1
  scoreNormalizationPerLanguage: boolean; // default true
  topKPerLanguage: number;            // default 5
  embeddingDim: number;               // default 256
}

// ---------------------------------------------------------------------------
// Language markers
// ---------------------------------------------------------------------------

const LANGUAGE_MARKERS: Record<string, string[]> = {
  en: ['the', 'and', 'is', 'are', 'was', 'were', 'have', 'that', 'this', 'with', 'from', 'they', 'will', 'been'],
  es: ['que', 'los', 'las', 'una', 'con', 'para', 'por', 'como', 'pero', 'más', 'del', 'está', 'todo'],
  fr: ['les', 'des', 'une', 'est', 'pas', 'que', 'son', 'dans', 'qui', 'sur', 'avec', 'tout'],
  de: ['die', 'der', 'das', 'und', 'ist', 'nicht', 'auch', 'sich', 'mit', 'dem', 'von', 'ein'],
  pt: ['que', 'não', 'para', 'uma', 'com', 'por', 'mas', 'como', 'mais', 'seu', 'ela'],
  it: ['che', 'non', 'una', 'del', 'per', 'con', 'sono', 'sul', 'dal', 'degli', 'alla'],
};

// ---------------------------------------------------------------------------
// Bilingual EN↔ES dictionary (50 word pairs)
// ---------------------------------------------------------------------------

const EN_ES_DICT: Record<string, string> = {
  search: 'buscar',
  find: 'encontrar',
  create: 'crear',
  delete: 'eliminar',
  update: 'actualizar',
  error: 'error',
  help: 'ayuda',
  user: 'usuario',
  file: 'archivo',
  data: 'datos',
  system: 'sistema',
  service: 'servicio',
  server: 'servidor',
  database: 'base',
  list: 'lista',
  name: 'nombre',
  type: 'tipo',
  value: 'valor',
  result: 'resultado',
  report: 'informe',
  message: 'mensaje',
  password: 'contraseña',
  access: 'acceso',
  login: 'iniciar',
  logout: 'cerrar',
  settings: 'configuración',
  language: 'idioma',
  document: 'documento',
  image: 'imagen',
  text: 'texto',
  email: 'correo',
  phone: 'teléfono',
  address: 'dirección',
  country: 'país',
  city: 'ciudad',
  date: 'fecha',
  time: 'tiempo',
  number: 'número',
  code: 'código',
  version: 'versión',
  download: 'descargar',
  upload: 'cargar',
  save: 'guardar',
  open: 'abrir',
  close: 'cerrar',
  view: 'ver',
  edit: 'editar',
  add: 'agregar',
  remove: 'quitar',
  test: 'prueba',
};

// Reverse ES→EN
const ES_EN_DICT: Record<string, string> = Object.fromEntries(
  Object.entries(EN_ES_DICT).map(([en, es]) => [es, en]),
);

// ---------------------------------------------------------------------------
// LanguageDetector (exported)
// ---------------------------------------------------------------------------

export class LanguageDetector {
  static detect(text: string): DetectedLanguage {
    if (!text || text.trim().length === 0) {
      return { code: 'unknown', confidence: 0, script: 'other' };
    }

    // -----------------------------------------------------------------------
    // Script detection via Unicode ranges
    // -----------------------------------------------------------------------
    const chars = Array.from(text);
    let cjkCount = 0;
    let arabicCount = 0;
    let cyrillicCount = 0;
    let latinCount = 0;

    for (const ch of chars) {
      const cp = ch.codePointAt(0) ?? 0;
      if ((cp >= 0x4E00 && cp <= 0x9FFF) ||
          (cp >= 0x3040 && cp <= 0x30FF) || // Hiragana/Katakana
          (cp >= 0xAC00 && cp <= 0xD7AF)) {  // Hangul
        cjkCount++;
      } else if (cp >= 0x0600 && cp <= 0x06FF) {
        arabicCount++;
      } else if (cp >= 0x0400 && cp <= 0x04FF) {
        cyrillicCount++;
      } else if ((cp >= 0x0041 && cp <= 0x007A) ||
                 (cp >= 0x00C0 && cp <= 0x024F)) {
        latinCount++;
      }
    }

    const total = chars.length;

    if (cjkCount / total > 0.15) {
      // Distinguish ZH / JA / KO by presence of kana or hangul
      const hasKana = chars.some(c => {
        const cp = c.codePointAt(0) ?? 0;
        return cp >= 0x3040 && cp <= 0x30FF;
      });
      const hasHangul = chars.some(c => {
        const cp = c.codePointAt(0) ?? 0;
        return cp >= 0xAC00 && cp <= 0xD7AF;
      });

      if (hasKana) return { code: 'ja', confidence: 0.85, script: 'cjk' };
      if (hasHangul) return { code: 'ko', confidence: 0.85, script: 'cjk' };
      return { code: 'zh', confidence: 0.85, script: 'cjk' };
    }

    if (arabicCount / total > 0.15) {
      return { code: 'ar', confidence: 0.85, script: 'arabic' };
    }

    if (cyrillicCount / total > 0.15) {
      return { code: 'unknown', confidence: 0.7, script: 'cyrillic' };
    }

    // -----------------------------------------------------------------------
    // Latin script: frequency-match against word lists
    // -----------------------------------------------------------------------
    const words = text.toLowerCase().split(/\W+/).filter(w => w.length > 1);
    if (words.length === 0) {
      return { code: 'unknown', confidence: 0, script: 'latin' };
    }

    const wordSet = new Set(words);
    const scores: Record<string, number> = {};

    for (const [lang, markers] of Object.entries(LANGUAGE_MARKERS)) {
      let matchCount = 0;
      for (const marker of markers) {
        if (wordSet.has(marker)) matchCount++;
      }
      scores[lang] = matchCount / markers.length;
    }

    const bestLang = Object.entries(scores).sort((a, b) => b[1] - a[1])[0];
    if (!bestLang || bestLang[1] === 0) {
      return { code: 'unknown', confidence: 0.1, script: 'latin' };
    }

    const [langCode, confidence] = bestLang;
    const validCodes = ['en', 'es', 'fr', 'de', 'pt', 'it', 'zh', 'ja', 'ko', 'ar'] as const;
    type ValidCode = typeof validCodes[number];

    const code: DetectedLanguage['code'] = validCodes.includes(langCode as ValidCode)
      ? (langCode as ValidCode)
      : 'unknown';

    return { code, confidence: Math.min(1, confidence * 2), script: 'latin' };
  }
}

// ---------------------------------------------------------------------------
// Default config
// ---------------------------------------------------------------------------

const DEFAULT_CROSS_LINGUAL_CONFIG: CrossLingualConfig = {
  supportedLanguages: ['en', 'es', 'fr', 'de', 'pt'],
  crossLingualBoost: 0.1,
  scoreNormalizationPerLanguage: true,
  topKPerLanguage: 5,
  embeddingDim: 256,
};

// ---------------------------------------------------------------------------
// CrossLingualRetriever
// ---------------------------------------------------------------------------

export class CrossLingualRetriever {
  private baseRetriever: HybridRetriever;
  private config: CrossLingualConfig;
  private chunkLanguageMap: Map<string, string> = new Map(); // chunkId → languageCode
  private languageCounts: Map<string, number> = new Map();

  constructor(baseRetriever: HybridRetriever, config?: Partial<CrossLingualConfig>) {
    this.baseRetriever = baseRetriever;
    this.config = { ...DEFAULT_CROSS_LINGUAL_CONFIG, ...(config ?? {}) };

    Logger.debug('CrossLingualRetriever initialized', { config: this.config });
  }

  addChunk(chunk: RetrievedChunk, vector?: number[]): void {
    const detected = LanguageDetector.detect(chunk.content);
    const langCode = detected.code === 'unknown' ? 'en' : detected.code;

    this.chunkLanguageMap.set(chunk.id, langCode);
    this.languageCounts.set(langCode, (this.languageCounts.get(langCode) ?? 0) + 1);

    // Build cross-lingual vector if none provided
    const effectiveVector = vector && vector.length > 0
      ? vector
      : this._computeCrossLingualVector(chunk.content, langCode);

    this.baseRetriever.addChunk(chunk, effectiveVector);

    Logger.debug('CrossLingualRetriever.addChunk', {
      chunkId: chunk.id,
      language: langCode,
      confidence: detected.confidence,
    });
  }

  async retrieve(query: RetrievedQuery): Promise<CrossLingualResult[]> {
    Logger.info('CrossLingualRetriever.retrieve', {
      query: query.text,
      namespace: query.namespace,
      topK: query.topK,
    });

    // Detect query language
    const queryLang = LanguageDetector.detect(query.text);
    const queryLangCode = queryLang.code === 'unknown' ? 'en' : queryLang.code;

    Logger.debug('CrossLingualRetriever: query language detected', {
      code: queryLangCode,
      confidence: queryLang.confidence,
    });

    // Retrieve per supported language using translated query hints
    const byLang = new Map<string, CrossLingualResult[]>();

    for (const targetLang of this.config.supportedLanguages) {
      const translatedQuery = this._translateQueryHint(query.text, queryLangCode, targetLang);
      const langQuery: RetrievedQuery = {
        ...query,
        text: translatedQuery,
        topK: this.config.topKPerLanguage,
      };

      // Compute cross-lingual vector for translated query
      const queryVector = this._computeCrossLingualVector(translatedQuery, targetLang);

      let rawResults: RetrievedChunk[];
      try {
        rawResults = await this.baseRetriever.retrieve(langQuery, queryVector);
      } catch (err) {
        Logger.warn('CrossLingualRetriever: base retrieval failed', {
          targetLang,
          error: err instanceof Error ? err.message : String(err),
        });
        continue;
      }

      const langResults: CrossLingualResult[] = rawResults.map(chunk => {
        const chunkLang = this.chunkLanguageMap.get(chunk.id) ?? 'unknown';
        const isCrossLingual = chunkLang !== queryLangCode;

        return {
          chunk,
          originalLanguage: chunkLang,
          queryLanguage: queryLangCode,
          crossLingual: isCrossLingual,
          normalizedScore: chunk.score,
        };
      });

      if (langResults.length > 0) {
        byLang.set(targetLang, langResults);
      }
    }

    // Per-language score normalization
    let normalizedByLang = byLang;
    if (this.config.scoreNormalizationPerLanguage) {
      normalizedByLang = this._normalizeScoresByLangMap(byLang);
    }

    // Apply cross-lingual boost to results in different language than query
    const boostedByLang = new Map<string, CrossLingualResult[]>();
    for (const [lang, results] of normalizedByLang) {
      boostedByLang.set(lang, results.map(r => ({
        ...r,
        normalizedScore: r.crossLingual
          ? r.normalizedScore + this.config.crossLingualBoost
          : r.normalizedScore,
      })));
    }

    // Merge with language diversity
    const merged = this._mergeLanguageResults(boostedByLang, query.topK);

    Logger.info('CrossLingualRetriever.retrieve complete', {
      totalReturned: merged.length,
      languagesFound: Array.from(boostedByLang.keys()),
    });

    return merged;
  }

  private _normalizeScoresByLanguage(results: CrossLingualResult[]): CrossLingualResult[] {
    if (results.length === 0) return results;

    const scores = results.map(r => r.normalizedScore);
    const minScore = Math.min(...scores);
    const maxScore = Math.max(...scores);
    const range = maxScore - minScore;

    if (range === 0) return results.map(r => ({ ...r, normalizedScore: 1.0 }));

    return results.map(r => ({
      ...r,
      normalizedScore: (r.normalizedScore - minScore) / range,
    }));
  }

  private _normalizeScoresByLangMap(
    byLang: Map<string, CrossLingualResult[]>,
  ): Map<string, CrossLingualResult[]> {
    const result = new Map<string, CrossLingualResult[]>();

    for (const [lang, results] of byLang) {
      result.set(lang, this._normalizeScoresByLanguage(results));
    }

    return result;
  }

  private _translateQueryHint(query: string, sourceLang: string, targetLang: string): string {
    // Only handle EN↔ES for now; all other pairs return original
    if (sourceLang === targetLang) return query;

    let dict: Record<string, string> | null = null;
    if (sourceLang === 'en' && targetLang === 'es') dict = EN_ES_DICT;
    else if (sourceLang === 'es' && targetLang === 'en') dict = ES_EN_DICT;

    if (!dict) return query;

    const words = query.split(/(\s+)/); // preserve whitespace
    const translated = words.map(token => {
      const lower = token.toLowerCase().trim();
      if (lower && dict && Object.prototype.hasOwnProperty.call(dict, lower)) {
        const replacement = dict[lower];
        // Preserve capitalization of first letter
        if (token[0] === token[0].toUpperCase() && token[0] !== token[0].toLowerCase()) {
          return replacement.charAt(0).toUpperCase() + replacement.slice(1);
        }
        return replacement;
      }
      return token;
    });

    return translated.join('');
  }

  private _mergeLanguageResults(
    byLang: Map<string, CrossLingualResult[]>,
    totalTopK: number,
  ): CrossLingualResult[] {
    if (byLang.size === 0) return [];

    // Cap each language at topKPerLanguage
    const cappedByLang = new Map<string, CrossLingualResult[]>();
    for (const [lang, results] of byLang) {
      cappedByLang.set(lang, results.slice(0, this.config.topKPerLanguage));
    }

    // Round-robin interleaving for language diversity
    const langQueues = Array.from(cappedByLang.values()).map(arr => [...arr]);
    const merged: CrossLingualResult[] = [];
    const seen = new Set<string>();

    let hasMore = true;
    while (hasMore && merged.length < totalTopK) {
      hasMore = false;

      for (const queue of langQueues) {
        if (queue.length === 0) continue;
        hasMore = true;

        const item = queue.shift()!;
        if (!seen.has(item.chunk.id)) {
          seen.add(item.chunk.id);
          merged.push(item);
          if (merged.length >= totalTopK) break;
        }
      }
    }

    // Final sort by normalizedScore
    merged.sort((a, b) => b.normalizedScore - a.normalizedScore);

    return merged.slice(0, totalTopK);
  }

  private _computeCrossLingualVector(text: string, sourceLang: string): number[] {
    const dim = this.config.embeddingDim;
    const vector = new Array<number>(dim).fill(0);

    // Hash-based pseudo-embedding
    const words = text.toLowerCase().split(/\W+/).filter(w => w.length > 0);
    for (const word of words) {
      const hash = this._hashString(word);
      for (let i = 0; i < dim; i++) {
        // Spread hash across dimensions via different bit offsets
        const bitPos = (hash >> (i % 32)) & 1;
        vector[i] += bitPos ? 1 : -1;
      }
    }

    // Normalize to unit vector
    const norm = Math.sqrt(vector.reduce((s, v) => s + v * v, 0)) || 1;
    for (let i = 0; i < dim; i++) {
      vector[i] /= norm;
    }

    // Language offset: add language-code hash to first 8 dims to create alignment space
    const langHash = this._hashString(sourceLang);
    for (let i = 0; i < 8 && i < dim; i++) {
      const langBit = (langHash >> i) & 0xFF;
      vector[i] += (langBit / 255) * 0.1; // small offset to cluster by language
    }

    return vector;
  }

  private _hashString(str: string): number {
    let hash = 0x811C9DC5; // FNV-1a 32-bit offset basis
    for (let i = 0; i < str.length; i++) {
      hash ^= str.charCodeAt(i);
      hash = Math.imul(hash, 0x01000193); // FNV prime
      hash >>>= 0; // keep as unsigned 32-bit
    }
    return hash;
  }

  getLanguageDistribution(): Map<string, number> {
    return new Map(this.languageCounts);
  }

  getSupportedLanguages(): string[] {
    return [...this.config.supportedLanguages];
  }
}
