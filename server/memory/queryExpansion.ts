/**
 * Query expansion for semantic search mode.
 * Ported from Clawi.
 * Extracts meaningful keywords from conversational queries.
 */

const STOP_WORDS_EN = new Set([
    "a", "an", "the", "this", "that", "these", "those",
    "i", "me", "my", "we", "our", "you", "your", "he", "she", "it", "they", "them",
    "is", "are", "was", "were", "be", "been", "being", "have", "has", "had", "do", "does", "did", "will", "would", "could", "should", "can", "may", "might",
    "in", "on", "at", "to", "for", "of", "with", "by", "from", "about", "into", "through", "during", "before", "after", "above", "below", "between", "under", "over",
    "and", "or", "but", "if", "then", "because", "as", "while", "when", "where", "what", "which", "who", "how", "why",
    "yesterday", "today", "tomorrow", "earlier", "later", "recently", "ago", "just", "now",
    "thing", "things", "stuff", "something", "anything", "everything", "nothing",
    "please", "help", "find", "show", "get", "tell", "give",
]);

const STOP_WORDS_ES = new Set([
    "el", "la", "los", "las", "un", "una", "unos", "unas", "este", "esta", "ese", "esa",
    "yo", "me", "mi", "nosotros", "nosotras", "tu", "tus", "usted", "ustedes", "ellos", "ellas",
    "de", "del", "a", "en", "con", "por", "para", "sobre", "entre", "y", "o", "pero", "si", "porque", "como",
    "es", "son", "fue", "fueron", "ser", "estar", "haber", "tener", "hacer",
    "ayer", "hoy", "mañana", "antes", "despues", "después", "ahora", "recientemente",
    "que", "qué", "cómo", "cuando", "cuándo", "donde", "dónde", "porqué", "favor", "ayuda",
]);

function isValidKeyword(token: string): boolean {
    if (!token || token.length === 0) return false;
    if (/^[a-zA-Z]+$/.test(token) && token.length < 3) return false;
    if (/^\\d+$/.test(token)) return false;
    if (/^[\\p{P}\\p{S}]+$/u.test(token)) return false;
    return true;
}

export function tokenize(text: string): string[] {
    const tokens: string[] = [];
    const normalized = text.toLowerCase().trim();
    const segments = normalized.split(/[\\s\\p{P}]+/u).filter(Boolean);

    for (const segment of segments) {
        tokens.push(segment);
    }

    return tokens;
}

export function extractKeywords(query: string): string[] {
    const tokens = tokenize(query);
    const keywords: string[] = [];
    const seen = new Set<string>();

    for (const token of tokens) {
        if (STOP_WORDS_EN.has(token) || STOP_WORDS_ES.has(token)) continue;
        if (!isValidKeyword(token)) continue;
        if (seen.has(token)) continue;

        seen.add(token);
        keywords.push(token);
    }

    return keywords;
}

export function expandQueryForFts(query: string): {
    original: string;
    keywords: string[];
    expanded: string;
} {
    const original = query.trim();
    const keywords = extractKeywords(original);
    const expanded = keywords.length > 0 ? `${original} OR ${keywords.join(" OR ")}` : original;

    return { original, keywords, expanded };
}
