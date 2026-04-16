interface LanguageScore {
  language: string;
  score: number;
  confidence: number;
}

interface DetectionResult {
  detected: string;
  confidence: number;
  alternatives: LanguageScore[];
}

const LANGUAGE_PATTERNS: Record<string, RegExp[]> = {
  es: [
    /\b(el|la|los|las|un|una|unos|unas)\b/gi,
    /\b(de|del|en|con|por|para|sobre|entre)\b/gi,
    /\b(que|qué|como|cómo|donde|dónde|cuando|cuándo)\b/gi,
    /\b(es|son|está|están|ser|estar|tener|hacer)\b/gi,
    /\b(yo|tú|él|ella|nosotros|ustedes|ellos)\b/gi,
    /\b(muy|más|menos|también|siempre|nunca)\b/gi,
    /[áéíóúüñ¿¡]/gi,
  ],
  en: [
    /\b(the|a|an)\b/gi,
    /\b(is|are|was|were|be|been|being)\b/gi,
    /\b(have|has|had|do|does|did)\b/gi,
    /\b(will|would|could|should|can|may|might)\b/gi,
    /\b(I|you|he|she|it|we|they)\b/gi,
    /\b(and|or|but|if|then|because|so)\b/gi,
    /\b(very|more|most|also|always|never)\b/gi,
  ],
  pt: [
    /\b(o|a|os|as|um|uma|uns|umas)\b/gi,
    /\b(de|do|da|dos|das|em|no|na|nos|nas)\b/gi,
    /\b(que|como|onde|quando|porque)\b/gi,
    /\b(é|são|está|estão|ser|estar|ter|fazer)\b/gi,
    /\b(eu|tu|você|ele|ela|nós|vocês|eles)\b/gi,
    /[ãõçáéíóúâêôà]/gi,
  ],
  fr: [
    /\b(le|la|les|un|une|des)\b/gi,
    /\b(de|du|des|à|au|aux|en|dans)\b/gi,
    /\b(que|qui|où|quand|comment|pourquoi)\b/gi,
    /\b(est|sont|être|avoir|faire|aller)\b/gi,
    /\b(je|tu|il|elle|nous|vous|ils|elles)\b/gi,
    /[àâäéèêëïîôùûüÿç]/gi,
  ],
  de: [
    /\b(der|die|das|ein|eine)\b/gi,
    /\b(und|oder|aber|wenn|weil|dass)\b/gi,
    /\b(ist|sind|war|waren|sein|haben|werden)\b/gi,
    /\b(ich|du|er|sie|es|wir|ihr|Sie)\b/gi,
    /[äöüß]/gi,
  ],
};

const STOPWORDS: Record<string, Set<string>> = {
  es: new Set(["el", "la", "de", "que", "y", "en", "un", "es", "se", "no", "los", "del", "las", "por", "con", "una", "para", "al", "son", "como", "más", "su", "le", "ya", "o", "pero", "fue", "este"]),
  en: new Set(["the", "be", "to", "of", "and", "a", "in", "that", "have", "i", "it", "for", "not", "on", "with", "he", "as", "you", "do", "at", "this", "but", "his", "by", "from", "they", "we", "say", "her", "she"]),
  pt: new Set(["o", "a", "de", "que", "e", "do", "da", "em", "um", "para", "é", "com", "não", "uma", "os", "no", "se", "na", "por", "mais", "as", "dos", "como", "mas", "foi", "ao", "ele", "das", "tem"]),
  fr: new Set(["le", "de", "un", "être", "et", "à", "il", "avoir", "ne", "je", "son", "que", "se", "qui", "ce", "dans", "en", "du", "elle", "au", "pour", "pas", "avec", "sur", "faire", "plus", "dire"]),
  de: new Set(["der", "die", "und", "in", "den", "von", "zu", "das", "mit", "sich", "des", "auf", "für", "ist", "im", "dem", "nicht", "ein", "eine", "als", "auch", "es", "an", "werden", "aus", "er", "hat"]),
};

export function detectLanguage(text: string): DetectionResult {
  if (!text || text.trim().length === 0) {
    return {
      detected: "es",
      confidence: 0,
      alternatives: [],
    };
  }

  const normalizedText = text.toLowerCase();
  const scores: Record<string, number> = {};

  for (const [language, patterns] of Object.entries(LANGUAGE_PATTERNS)) {
    let score = 0;
    
    for (const pattern of patterns) {
      const matches = normalizedText.match(pattern) || [];
      score += matches.length;
    }

    const stopwords = STOPWORDS[language];
    if (stopwords) {
      const words = normalizedText.split(/\s+/);
      for (const word of words) {
        if (stopwords.has(word)) {
          score += 2;
        }
      }
    }

    scores[language] = score;
  }

  const totalScore = Object.values(scores).reduce((a, b) => a + b, 0);
  
  const languageScores: LanguageScore[] = Object.entries(scores)
    .map(([language, score]) => ({
      language,
      score,
      confidence: totalScore > 0 ? score / totalScore : 0,
    }))
    .sort((a, b) => b.score - a.score);

  const detected = languageScores[0];
  
  const confidence = detected.confidence > 0.5 
    ? Math.min(detected.confidence * 1.2, 1) 
    : detected.confidence;

  return {
    detected: detected.language,
    confidence,
    alternatives: languageScores.slice(1, 3),
  };
}

export function detectLanguageFromHistory(messages: string[]): string {
  const combined = messages.slice(-5).join(" ");
  const result = detectLanguage(combined);
  
  if (result.confidence >= 0.4) {
    return result.detected;
  }

  const languageCounts: Record<string, number> = {};
  for (const message of messages.slice(-10)) {
    const { detected } = detectLanguage(message);
    languageCounts[detected] = (languageCounts[detected] || 0) + 1;
  }

  const sorted = Object.entries(languageCounts).sort((a, b) => b[1] - a[1]);
  return sorted[0]?.[0] || "es";
}

export function getLanguageName(code: string): string {
  const names: Record<string, string> = {
    es: "Español",
    en: "English",
    pt: "Português",
    fr: "Français",
    de: "Deutsch",
  };
  return names[code] || code.toUpperCase();
}

export function shouldRespondInLanguage(
  userMessage: string,
  conversationHistory: string[] = []
): string {
  const messageResult = detectLanguage(userMessage);
  
  if (messageResult.confidence >= 0.6) {
    return messageResult.detected;
  }

  if (conversationHistory.length > 0) {
    return detectLanguageFromHistory(conversationHistory);
  }

  return messageResult.detected;
}

export default {
  detectLanguage,
  detectLanguageFromHistory,
  getLanguageName,
  shouldRespondInLanguage,
};
