/**
 * Advanced Query Processor v4.0
 * Improvements 101-200: Advanced Query Processing
 * 
 * 101-115: Boolean Operators
 * 116-130: Semantic Processing  
 * 131-145: Correction & Suggestions
 * 146-160: Multi-language Support
 * 161-175: Query Analysis
 * 176-200: Advanced Filters
 */

import crypto from "crypto";

// ============================================
// TYPES
// ============================================

export interface ParsedQuery {
  original: string;
  normalized: string;
  tokens: Token[];
  fields: FieldQuery[];
  filters: QueryFilters;
  language: string;
  suggestions: string[];
  expandedQueries: string[];
  booleanTree?: BooleanNode;
}

export interface Token {
  type: "term" | "operator" | "phrase" | "field" | "wildcard" | "range";
  value: string;
  position: number;
  boosted?: boolean;
  required?: boolean;
  excluded?: boolean;
}

export interface FieldQuery {
  field: string;
  value: string;
  operator: ":" | "=" | ">" | "<" | ">=" | "<=";
}

export interface QueryFilters {
  yearFrom?: number;
  yearTo?: number;
  authors?: string[];
  institutions?: string[];
  countries?: string[];
  journals?: string[];
  documentTypes?: string[];
  languages?: string[];
  openAccessOnly?: boolean;
  peerReviewedOnly?: boolean;
  excludeRetracted?: boolean;
  minCitations?: number;
  maxAuthors?: number;
  hasAbstract?: boolean;
  hasData?: boolean;
  hasCode?: boolean;
}

export interface BooleanNode {
  type: "AND" | "OR" | "NOT" | "NEAR" | "TERM";
  value?: string;
  children?: BooleanNode[];
  proximity?: number;
}

// ============================================
// 101-115: BOOLEAN OPERATORS
// ============================================

// 101. Parser de operadores AND/OR/NOT
const BOOLEAN_OPERATORS = /\b(AND|OR|NOT|NEAR\/?\d*|SAME)\b/gi;
const FIELD_OPERATORS = /\b(author|title|abstract|doi|year|source|journal|institution|country):["']?([^"'\s]+)["']?/gi;

// 102. Paréntesis anidados
function parseParentheses(query: string): { groups: string[]; flat: string } {
  const groups: string[] = [];
  let depth = 0;
  let current = "";
  let flat = "";
  
  for (let i = 0; i < query.length; i++) {
    const char = query[i];
    if (char === "(") {
      if (depth === 0) {
        flat += query.substring(0, i).trim();
      }
      depth++;
      if (depth > 1) current += char;
    } else if (char === ")") {
      depth--;
      if (depth === 0) {
        groups.push(current.trim());
        current = "";
      } else if (depth > 0) {
        current += char;
      }
    } else if (depth > 0) {
      current += char;
    }
  }
  
  return { groups, flat: flat || query };
}

// 103. Operador NEAR para proximidad
function parseNearOperator(query: string): { terms: [string, string]; proximity: number }[] {
  const nearMatches: { terms: [string, string]; proximity: number }[] = [];
  const regex = /(\w+)\s+NEAR\/?(\d*)\s+(\w+)/gi;
  let match;
  
  while ((match = regex.exec(query)) !== null) {
    nearMatches.push({
      terms: [match[1], match[3]],
      proximity: parseInt(match[2]) || 5
    });
  }
  
  return nearMatches;
}

// 105. Wildcard * para truncamiento
function expandWildcards(query: string): string {
  // Convert * to regex-like pattern
  return query.replace(/(\w+)\*/g, (_, prefix) => `${prefix}*`);
}

// 106. Búsqueda por frase exacta con comillas
function extractPhrases(query: string): { phrases: string[]; remaining: string } {
  const phrases: string[] = [];
  const phraseRegex = /"([^"]+)"|'([^']+)'/g;
  let remaining = query;
  let match;
  
  while ((match = phraseRegex.exec(query)) !== null) {
    phrases.push(match[1] || match[2]);
    remaining = remaining.replace(match[0], " ");
  }
  
  return { phrases, remaining: remaining.trim() };
}

// 107-108. Operadores + y -
function parseModifiers(query: string): { required: string[]; excluded: string[]; normal: string } {
  const required: string[] = [];
  const excluded: string[] = [];
  let normal = query;
  
  // +term (required)
  const reqRegex = /\+(\w+)/g;
  let match;
  while ((match = reqRegex.exec(query)) !== null) {
    required.push(match[1]);
    normal = normal.replace(match[0], " ");
  }
  
  // -term (excluded)
  const exclRegex = /-(\w+)/g;
  while ((match = exclRegex.exec(query)) !== null) {
    excluded.push(match[1]);
    normal = normal.replace(match[0], " ");
  }
  
  return { required, excluded, normal: normal.trim() };
}

// 109. Rango numérico (2020..2024)
function parseRanges(query: string): { ranges: { field: string; from: number; to: number }[]; remaining: string } {
  const ranges: { field: string; from: number; to: number }[] = [];
  const rangeRegex = /(\w+)?:?(\d{4})\.\.(\d{4})/g;
  let remaining = query;
  let match;
  
  while ((match = rangeRegex.exec(query)) !== null) {
    ranges.push({
      field: match[1] || "year",
      from: parseInt(match[2]),
      to: parseInt(match[3])
    });
    remaining = remaining.replace(match[0], " ");
  }
  
  return { ranges, remaining: remaining.trim() };
}

// 110-115. Operadores de campo específico
function parseFieldQueries(query: string): { fields: FieldQuery[]; remaining: string } {
  const fields: FieldQuery[] = [];
  const fieldRegex = /\b(author|title|abstract|doi|year|source|journal|institution|country|type):(["']?)([^"'\s]+)\2/gi;
  let remaining = query;
  let match;
  
  while ((match = fieldRegex.exec(query)) !== null) {
    fields.push({
      field: match[1].toLowerCase(),
      value: match[3],
      operator: ":"
    });
    remaining = remaining.replace(match[0], " ");
  }
  
  return { fields, remaining: remaining.trim() };
}

// ============================================
// 116-130: SEMANTIC PROCESSING
// ============================================

// Medical terms (MeSH-like)
const MEDICAL_TERMS: Record<string, string[]> = {
  "covid": ["COVID-19", "SARS-CoV-2", "coronavirus disease 2019"],
  "diabetes": ["diabetes mellitus", "DM", "hyperglycemia"],
  "cancer": ["neoplasm", "malignancy", "carcinoma", "tumor"],
  "heart": ["cardiac", "cardiovascular", "myocardial"],
  "depression": ["depressive disorder", "major depression", "MDD"],
  "alzheimer": ["Alzheimer's disease", "AD", "dementia"],
  "hypertension": ["high blood pressure", "HTN", "arterial hypertension"],
  "obesity": ["overweight", "BMI", "adiposity"],
  "stroke": ["cerebrovascular accident", "CVA", "ischemic stroke"],
  "arthritis": ["rheumatoid arthritis", "RA", "osteoarthritis"]
};

// 123. Detección de términos médicos
function detectMedicalTerms(query: string): string[] {
  const found: string[] = [];
  const lower = query.toLowerCase();
  
  for (const [term, synonyms] of Object.entries(MEDICAL_TERMS)) {
    if (lower.includes(term)) {
      found.push(term, ...synonyms);
    }
  }
  
  return [...new Set(found)];
}

// 121-122. Reconocimiento de autores e instituciones
const INSTITUTION_PATTERNS = [
  /\b(university|universidad|universidade|université)\s+(?:of\s+)?(\w+(?:\s+\w+)?)/gi,
  /\b(MIT|Harvard|Stanford|Oxford|Cambridge|Yale|Princeton)\b/gi,
  /\bInstitut[eo]?\s+(?:de\s+)?(\w+)/gi
];

function extractInstitutions(query: string): string[] {
  const institutions: string[] = [];
  
  for (const pattern of INSTITUTION_PATTERNS) {
    let match;
    while ((match = pattern.exec(query)) !== null) {
      institutions.push(match[0].trim());
    }
    pattern.lastIndex = 0;
  }
  
  return institutions;
}

// 120. Extracción de entidades nombradas (simple)
function extractNamedEntities(query: string): { people: string[]; places: string[]; organizations: string[] } {
  const people: string[] = [];
  const places: string[] = [];
  const organizations: string[] = [];
  
  // Simple capitalized word detection
  const capitalizedWords = query.match(/\b[A-Z][a-z]+(?:\s+[A-Z][a-z]+)*\b/g) || [];
  
  // Common places
  const placePatterns = /\b(USA|UK|China|Japan|Germany|France|Brazil|India|Spain|Mexico|Peru|Colombia|Argentina|Chile)\b/gi;
  const placeMatches = query.match(placePatterns) || [];
  places.push(...placeMatches);
  
  return { people, places, organizations };
}

// 118. Detección de intención de búsqueda
type SearchIntent = "lookup" | "comparison" | "methodology" | "review" | "data" | "general";

function detectSearchIntent(query: string): SearchIntent {
  const lower = query.toLowerCase();
  
  if (/\bvs\.?\b|\bversus\b|\bcompare|comparison|difference|between/i.test(lower)) {
    return "comparison";
  }
  if (/\bmethod|methodology|technique|approach|algorithm|protocol/i.test(lower)) {
    return "methodology";
  }
  if (/\breview|systematic|meta-analysis|overview|survey|state.of.the.art/i.test(lower)) {
    return "review";
  }
  if (/\bdataset|data|database|corpus|benchmark/i.test(lower)) {
    return "data";
  }
  if (/\bwhat is|define|definition|meaning of/i.test(lower)) {
    return "lookup";
  }
  
  return "general";
}

// 119. Clasificación automática de tema
const TOPIC_KEYWORDS: Record<string, string[]> = {
  "medicine": ["health", "disease", "treatment", "patient", "clinical", "medical", "therapy", "diagnosis"],
  "computer_science": ["algorithm", "software", "programming", "machine learning", "AI", "neural", "data", "computing"],
  "biology": ["gene", "protein", "cell", "organism", "evolution", "species", "DNA", "RNA"],
  "physics": ["quantum", "particle", "energy", "wave", "relativity", "matter", "force"],
  "chemistry": ["molecule", "reaction", "compound", "synthesis", "catalyst", "element"],
  "psychology": ["behavior", "cognitive", "mental", "emotion", "perception", "memory"],
  "economics": ["market", "economy", "trade", "price", "GDP", "inflation", "finance"],
  "education": ["learning", "teaching", "student", "school", "curriculum", "pedagogy"]
};

function classifyTopic(query: string): string[] {
  const lower = query.toLowerCase();
  const topics: string[] = [];
  
  for (const [topic, keywords] of Object.entries(TOPIC_KEYWORDS)) {
    const matches = keywords.filter(kw => lower.includes(kw)).length;
    if (matches >= 1) {
      topics.push(topic);
    }
  }
  
  return topics.length > 0 ? topics : ["general"];
}

// ============================================
// 131-145: CORRECTION & SUGGESTIONS
// ============================================

// Extended spell checker dictionaries (language-aware)
const EN_CORRECTIONS: Record<string, string> = {
  // English typos
  machne: "machine",
  learing: "learning",
  artifical: "artificial",
  inteligence: "intelligence",
  neurla: "neural",
  netowrk: "network",
  algoritm: "algorithm",
  reserach: "research",
  anlaysis: "analysis",
  studie: "study",
  developement: "development",
  managment: "management",
  enviroment: "environment",
  goverment: "government",
  occured: "occurred",
  recieve: "receive",
  seperate: "separate",
  untill: "until",
  wich: "which",
  becuase: "because",
  definately: "definitely",
  occurence: "occurrence",
  accomodate: "accommodate",
  apparant: "apparent",
  begining: "beginning",
  beleive: "believe",
  colum: "column",
  commitee: "committee",
  concious: "conscious",
  existance: "existence",
  foriegn: "foreign",
  happend: "happened",
  imediately: "immediately",
  independant: "independent",
  knowlege: "knowledge",
  liason: "liaison",
  millenium: "millennium",
  noticable: "noticeable",
  ocasionally: "occasionally",
  paralel: "parallel",
  persistant: "persistent",
  posession: "possession",
  publically: "publicly",
  reccomend: "recommend",
  refered: "referred",
  relevent: "relevant",
  rythm: "rhythm",
  similer: "similar",
  suprise: "surprise",
  tendancy: "tendency",
  therefor: "therefore",
  tommorow: "tomorrow",
  truely: "truly",
  wierd: "weird",
};

const ES_CORRECTIONS: Record<string, string> = {
  // Spanish typos / missing accents
  educacion: "educación",
  investigacion: "investigación",
  metodologia: "metodología",
  analisis: "análisis",
  tecnologia: "tecnología",
  informacion: "información",
  comunicacion: "comunicación",
  evaluacion: "evaluación",
  aplicacion: "aplicación",
  organizacion: "organización",
  administracion: "administración",
  cientifico: "científico",
  academico: "académico",
  matematicas: "matemáticas",
  estadistica: "estadística",
};

const PT_CORRECTIONS: Record<string, string> = {
  // Portuguese typos / missing accents
  educacao: "educação",
  comunicacao: "comunicação",
  informacao: "informação",
};

const ALL_CORRECTIONS: Record<string, string> = {
  ...EN_CORRECTIONS,
  ...ES_CORRECTIONS,
  ...PT_CORRECTIONS,
};

function getSpellingCorrections(language: string): Record<string, string> {
  switch (language) {
    case "es":
      // Spanish queries often contain English terms; keep EN corrections too.
      return { ...EN_CORRECTIONS, ...ES_CORRECTIONS };
    case "pt":
      return { ...EN_CORRECTIONS, ...PT_CORRECTIONS };
    default:
      return EN_CORRECTIONS;
  }
}

// 131. Spell checker con diccionario académico
function correctSpelling(query: string, language?: string): { corrected: string; corrections: string[] } {
  let corrected = query;
  const corrections: string[] = [];
  const map = language ? getSpellingCorrections(language) : ALL_CORRECTIONS;
  
  const words = query.split(/\s+/);
  for (const word of words) {
    const lower = word.toLowerCase();
    if (map[lower]) {
      corrected = corrected.replace(new RegExp(`\\b${word}\\b`, "gi"), map[lower]);
      corrections.push(`${word} → ${map[lower]}`);
    }
  }
  
  return { corrected, corrections };
}

// 136. Sugerencias de términos relacionados
const RELATED_TERMS: Record<string, string[]> = {
  "machine learning": ["deep learning", "neural networks", "artificial intelligence", "data mining"],
  "neural network": ["deep learning", "convolutional", "recurrent", "transformer"],
  "covid": ["pandemic", "vaccine", "infection", "public health"],
  "climate change": ["global warming", "greenhouse", "carbon emissions", "sustainability"],
  "renewable energy": ["solar", "wind", "hydroelectric", "sustainable"],
  "blockchain": ["cryptocurrency", "distributed ledger", "smart contracts"],
  "quantum computing": ["qubits", "superposition", "entanglement"],
  "natural language processing": ["NLP", "text mining", "sentiment analysis", "chatbot"]
};

function suggestRelatedTerms(query: string): string[] {
  const lower = query.toLowerCase();
  const suggestions: string[] = [];
  
  for (const [term, related] of Object.entries(RELATED_TERMS)) {
    if (lower.includes(term)) {
      suggestions.push(...related);
    }
  }
  
  return [...new Set(suggestions)].slice(0, 5);
}

// 137. Expansión automática de abreviaciones
const ABBREVIATIONS: Record<string, string> = {
  "ai": "artificial intelligence",
  "ml": "machine learning",
  "dl": "deep learning",
  "nlp": "natural language processing",
  "cv": "computer vision",
  "iot": "internet of things",
  "api": "application programming interface",
  "rnn": "recurrent neural network",
  "cnn": "convolutional neural network",
  "lstm": "long short-term memory",
  "gpt": "generative pre-trained transformer",
  "bert": "bidirectional encoder representations from transformers",
  "svm": "support vector machine",
  "knn": "k-nearest neighbors",
  "pca": "principal component analysis",
  "gdp": "gross domestic product",
  "who": "world health organization",
  "fda": "food and drug administration",
  "nih": "national institutes of health",
  "eu": "european union",
  "uk": "united kingdom",
  "usa": "united states of america"
};

function expandAbbreviations(query: string): string {
  let expanded = query;
  
  for (const [abbr, full] of Object.entries(ABBREVIATIONS)) {
    const regex = new RegExp(`\\b${abbr}\\b`, "gi");
    if (regex.test(query)) {
      // Add both abbreviation and expansion
      expanded = expanded.replace(regex, `(${abbr} OR "${full}")`);
    }
  }
  
  return expanded;
}

// ============================================
// 146-160: MULTI-LANGUAGE SUPPORT
// ============================================

// Language patterns
const LANGUAGE_PATTERNS: Record<string, RegExp> = {
  "es": /\b(el|la|los|las|de|del|que|en|con|para|por|un|una|es|son|fue|muy|más|como|pero|sobre|entre|desde|hasta|según|hacia|mediante|aunque|porque|mientras|siempre|nunca|también|todavía|además)\b/gi,
  "pt": /\b(o|a|os|as|do|da|dos|das|em|com|para|por|um|uma|é|são|foi|muito|mais|como|mas|sobre|entre|desde|até|segundo|embora|porque|enquanto|sempre|nunca|também|ainda|além)\b/gi,
  "en": /\b(the|a|an|is|are|was|were|have|has|had|will|would|can|could|should|may|might|must|this|that|these|those|what|which|who|where|when|how|why|because|although|however|therefore|moreover|furthermore)\b/gi,
  "fr": /\b(le|la|les|de|du|des|un|une|et|ou|mais|pour|avec|dans|sur|par|que|qui|est|sont|était|être|avoir|fait|très|plus|moins|aussi|donc|ainsi|parce|lorsque|pendant|depuis|jusqu|entre)\b/gi,
  "de": /\b(der|die|das|ein|eine|und|oder|aber|für|mit|in|auf|von|zu|ist|sind|war|haben|hat|sehr|mehr|weniger|auch|also|damit|weil|obwohl|während|seit|zwischen)\b/gi
};

// 146. Detección de idioma con alta precisión
function detectLanguagePrecise(text: string): { language: string; confidence: number } {
  const scores: Record<string, number> = {};
  
  for (const [lang, pattern] of Object.entries(LANGUAGE_PATTERNS)) {
    const matches = (text.match(pattern) || []).length;
    const wordCount = text.split(/\s+/).length;
    scores[lang] = matches / Math.max(wordCount, 1);
  }
  
  const sorted = Object.entries(scores).sort((a, b) => b[1] - a[1]);
  const [topLang, topScore] = sorted[0] || ["en", 0];
  const [secondLang, secondScore] = sorted[1] || ["", 0];
  
  // Calculate confidence based on difference between top two
  const confidence = topScore > 0 ? Math.min(1, (topScore - secondScore) / topScore + 0.5) : 0.5;
  
  return {
    language: topScore > 0.05 ? topLang : "en",
    confidence
  };
}

// 152. Mapeo de términos ES↔EN↔PT
const TRANSLATION_MAP: Record<string, Record<string, string>> = {
  "es": {
    "machine learning": "aprendizaje automático",
    "artificial intelligence": "inteligencia artificial",
    "deep learning": "aprendizaje profundo",
    "neural network": "red neuronal",
    "data science": "ciencia de datos",
    "research": "investigación",
    "study": "estudio",
    "analysis": "análisis",
    "method": "método",
    "results": "resultados",
    "conclusion": "conclusión",
    "introduction": "introducción",
    "abstract": "resumen",
    "keywords": "palabras clave"
  },
  "pt": {
    "machine learning": "aprendizado de máquina",
    "artificial intelligence": "inteligência artificial",
    "deep learning": "aprendizado profundo",
    "neural network": "rede neural",
    "data science": "ciência de dados",
    "research": "pesquisa",
    "study": "estudo",
    "analysis": "análise",
    "method": "método",
    "results": "resultados",
    "conclusion": "conclusão",
    "introduction": "introdução",
    "abstract": "resumo",
    "keywords": "palavras-chave"
  }
};

// 147. Traducción automática de query (simple)
function translateTerms(query: string, fromLang: string, toLang: string): string {
  if (fromLang === toLang) return query;
  
  let translated = query;
  const map = TRANSLATION_MAP[toLang];
  
  if (map) {
    for (const [en, local] of Object.entries(map)) {
      // Try both directions
      translated = translated.replace(new RegExp(en, "gi"), local);
      translated = translated.replace(new RegExp(local, "gi"), en);
    }
  }
  
  return translated;
}

// 155. Stopwords por idioma
const STOPWORDS: Record<string, Set<string>> = {
  "en": new Set(["a", "an", "the", "and", "or", "but", "in", "on", "at", "to", "for", "of", "with", "by", "from", "is", "are", "was", "were", "be", "been", "being", "have", "has", "had", "do", "does", "did", "will", "would", "could", "should", "may", "might", "must", "shall", "can", "this", "that", "these", "those", "it", "its"]),
  "es": new Set(["el", "la", "los", "las", "un", "una", "unos", "unas", "de", "del", "al", "en", "con", "por", "para", "es", "son", "fue", "ser", "estar", "como", "que", "y", "o", "pero", "si", "no", "más", "muy", "su", "sus", "este", "esta", "estos", "estas"]),
  "pt": new Set(["o", "a", "os", "as", "um", "uma", "uns", "umas", "de", "do", "da", "dos", "das", "em", "no", "na", "nos", "nas", "com", "por", "para", "é", "são", "foi", "ser", "estar", "como", "que", "e", "ou", "mas", "se", "não", "mais", "muito", "seu", "sua"]),
  "fr": new Set(["le", "la", "les", "un", "une", "des", "de", "du", "dans", "sur", "par", "pour", "avec", "et", "ou", "mais", "que", "qui", "est", "sont", "était", "etre", "être", "avoir", "fait", "très", "plus", "moins", "aussi", "donc", "ainsi", "parce", "lorsque", "pendant", "depuis", "jusqu", "entre"]),
  "de": new Set(["der", "die", "das", "ein", "eine", "und", "oder", "aber", "für", "mit", "in", "auf", "von", "zu", "ist", "sind", "war", "haben", "hat", "sehr", "mehr", "weniger", "auch", "also", "damit", "weil", "obwohl", "während", "seit", "zwischen"])
};

function removeStopwords(query: string, language: string): string {
  const stopwords = STOPWORDS[language] || STOPWORDS["en"];
  const words = query.split(/\s+/);
  return words.filter(w => !stopwords.has(w.toLowerCase())).join(" ");
}

// ============================================
// 161-175: QUERY ANALYSIS
// ============================================

// 165-167. Keyword extraction algorithms

// RAKE-like keyword extraction
function extractKeywordsRAKE(text: string): string[] {
  const stopwords = STOPWORDS["en"];
  const words = text.toLowerCase().split(/\s+/);
  const phrases: string[] = [];
  let currentPhrase: string[] = [];
  
  for (const word of words) {
    if (stopwords.has(word) || word.length < 2) {
      if (currentPhrase.length > 0) {
        phrases.push(currentPhrase.join(" "));
        currentPhrase = [];
      }
    } else {
      currentPhrase.push(word);
    }
  }
  if (currentPhrase.length > 0) {
    phrases.push(currentPhrase.join(" "));
  }
  
  // Score by word frequency and co-occurrence
  const wordFreq: Record<string, number> = {};
  const wordDegree: Record<string, number> = {};
  
  for (const phrase of phrases) {
    const phraseWords = phrase.split(" ");
    for (const word of phraseWords) {
      wordFreq[word] = (wordFreq[word] || 0) + 1;
      wordDegree[word] = (wordDegree[word] || 0) + phraseWords.length;
    }
  }
  
  const wordScores: Record<string, number> = {};
  for (const word of Object.keys(wordFreq)) {
    wordScores[word] = wordDegree[word] / wordFreq[word];
  }
  
  // Score phrases
  const phraseScores = phrases.map(phrase => ({
    phrase,
    score: phrase.split(" ").reduce((sum, w) => sum + (wordScores[w] || 0), 0)
  }));
  
  return phraseScores
    .sort((a, b) => b.score - a.score)
    .slice(0, 10)
    .map(p => p.phrase);
}

// TextRank-like keyword extraction (simplified)
function extractKeywordsTextRank(text: string): string[] {
  const stopwords = STOPWORDS["en"];
  const words = text.toLowerCase()
    .replace(/[^\w\s]/g, " ")
    .split(/\s+/)
    .filter(w => w.length > 2 && !stopwords.has(w));
  
  // Build co-occurrence graph
  const cooccurrence: Record<string, Record<string, number>> = {};
  const windowSize = 4;
  
  for (let i = 0; i < words.length; i++) {
    const word = words[i];
    if (!cooccurrence[word]) cooccurrence[word] = {};
    
    for (let j = Math.max(0, i - windowSize); j < Math.min(words.length, i + windowSize); j++) {
      if (i !== j) {
        const neighbor = words[j];
        cooccurrence[word][neighbor] = (cooccurrence[word][neighbor] || 0) + 1;
      }
    }
  }
  
  // Simple PageRank-like scoring
  const scores: Record<string, number> = {};
  const damping = 0.85;
  const iterations = 10;
  
  // Initialize
  for (const word of Object.keys(cooccurrence)) {
    scores[word] = 1;
  }
  
  // Iterate
  for (let iter = 0; iter < iterations; iter++) {
    const newScores: Record<string, number> = {};
    for (const word of Object.keys(cooccurrence)) {
      let sum = 0;
      for (const [neighbor, weight] of Object.entries(cooccurrence[word])) {
        const neighborTotal = Object.values(cooccurrence[neighbor] || {}).reduce((a, b) => a + b, 0);
        if (neighborTotal > 0) {
          sum += (weight / neighborTotal) * (scores[neighbor] || 1);
        }
      }
      newScores[word] = (1 - damping) + damping * sum;
    }
    Object.assign(scores, newScores);
  }
  
  return Object.entries(scores)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10)
    .map(([word]) => word);
}

// 168-169. TF-IDF and BM25 scoring

function calculateTFIDF(term: string, document: string, corpus: string[]): number {
  const docWords = document.toLowerCase().split(/\s+/);
  const termLower = term.toLowerCase();
  
  // TF: term frequency in document
  const tf = docWords.filter(w => w === termLower).length / docWords.length;
  
  // IDF: inverse document frequency
  const docsWithTerm = corpus.filter(doc => doc.toLowerCase().includes(termLower)).length;
  const idf = Math.log((corpus.length + 1) / (docsWithTerm + 1)) + 1;
  
  return tf * idf;
}

function calculateBM25(term: string, document: string, corpus: string[], k1 = 1.5, b = 0.75): number {
  const docWords = document.toLowerCase().split(/\s+/);
  const termLower = term.toLowerCase();
  
  const avgDocLength = corpus.reduce((sum, doc) => sum + doc.split(/\s+/).length, 0) / corpus.length;
  const docLength = docWords.length;
  
  // Term frequency
  const tf = docWords.filter(w => w === termLower).length;
  
  // IDF
  const docsWithTerm = corpus.filter(doc => doc.toLowerCase().includes(termLower)).length;
  const idf = Math.log((corpus.length - docsWithTerm + 0.5) / (docsWithTerm + 0.5) + 1);
  
  // BM25
  const tfNorm = (tf * (k1 + 1)) / (tf + k1 * (1 - b + b * (docLength / avgDocLength)));
  
  return idf * tfNorm;
}

// 172-173. Query difficulty and performance prediction
function predictQueryDifficulty(query: string): { difficulty: "easy" | "medium" | "hard"; factors: string[] } {
  const factors: string[] = [];
  let score = 0;
  
  // Long queries are harder
  const wordCount = query.split(/\s+/).length;
  if (wordCount > 10) {
    score += 2;
    factors.push("long query");
  } else if (wordCount > 5) {
    score += 1;
    factors.push("moderate length");
  }
  
  // Complex operators
  if (/\bAND\b|\bOR\b|\bNOT\b/i.test(query)) {
    score += 1;
    factors.push("boolean operators");
  }
  
  // Phrases
  if (/"[^"]+"/.test(query)) {
    score += 1;
    factors.push("exact phrases");
  }
  
  // Field queries
  if (/\w+:/.test(query)) {
    score += 1;
    factors.push("field queries");
  }
  
  // Rare terms (very long words)
  if (/\w{15,}/.test(query)) {
    score += 1;
    factors.push("rare terms");
  }
  
  // Non-English
  const lang = detectLanguagePrecise(query);
  if (lang.language !== "en") {
    score += 1;
    factors.push(`non-English (${lang.language})`);
  }
  
  if (score >= 4) return { difficulty: "hard", factors };
  if (score >= 2) return { difficulty: "medium", factors };
  return { difficulty: "easy", factors };
}

// ============================================
// 176-200: ADVANCED FILTERS
// ============================================

// Parse filter expressions from query
function parseFilters(query: string): { filters: QueryFilters; cleanQuery: string } {
  const filters: QueryFilters = {};
  let cleanQuery = query;
  
  // 176. institution:Harvard
  const instMatch = query.match(/institution:["']?([^"'\s]+)["']?/i);
  if (instMatch) {
    filters.institutions = [instMatch[1]];
    cleanQuery = cleanQuery.replace(instMatch[0], "");
  }
  
  // 177. country:USA
  const countryMatch = query.match(/country:["']?([^"'\s]+)["']?/i);
  if (countryMatch) {
    filters.countries = [countryMatch[1]];
    cleanQuery = cleanQuery.replace(countryMatch[0], "");
  }
  
  // 180. mincitations:100
  const citMatch = query.match(/mincitations?:(\d+)/i);
  if (citMatch) {
    filters.minCitations = parseInt(citMatch[1]);
    cleanQuery = cleanQuery.replace(citMatch[0], "");
  }
  
  // 186. peerreviewed:true
  const peerMatch = query.match(/peer-?reviewed?:(true|false|yes|no)/i);
  if (peerMatch) {
    filters.peerReviewedOnly = ["true", "yes"].includes(peerMatch[1].toLowerCase());
    cleanQuery = cleanQuery.replace(peerMatch[0], "");
  }
  
  // 188. retracted:exclude
  const retractedMatch = query.match(/retracted?:(exclude|include|only)/i);
  if (retractedMatch) {
    filters.excludeRetracted = retractedMatch[1].toLowerCase() === "exclude";
    cleanQuery = cleanQuery.replace(retractedMatch[0], "");
  }
  
  // 181. maxauthors:5
  const authorsMatch = query.match(/maxauthors?:(\d+)/i);
  if (authorsMatch) {
    filters.maxAuthors = parseInt(authorsMatch[1]);
    cleanQuery = cleanQuery.replace(authorsMatch[0], "");
  }
  
  // 182. hasabstract:true
  const abstractMatch = query.match(/hasabstract:(true|false|yes|no)/i);
  if (abstractMatch) {
    filters.hasAbstract = ["true", "yes"].includes(abstractMatch[1].toLowerCase());
    cleanQuery = cleanQuery.replace(abstractMatch[0], "");
  }
  
  // 183-184. hasdata:true, hascode:true
  const dataMatch = query.match(/hasdata:(true|false|yes|no)/i);
  if (dataMatch) {
    filters.hasData = ["true", "yes"].includes(dataMatch[1].toLowerCase());
    cleanQuery = cleanQuery.replace(dataMatch[0], "");
  }
  
  const codeMatch = query.match(/hascode:(true|false|yes|no)/i);
  if (codeMatch) {
    filters.hasCode = ["true", "yes"].includes(codeMatch[1].toLowerCase());
    cleanQuery = cleanQuery.replace(codeMatch[0], "");
  }
  
  // 193-199. Document type filters
  const typePatterns = [
    { pattern: /\breview\b/i, type: "review" },
    { pattern: /\bmeta-?analysis\b/i, type: "meta-analysis" },
    { pattern: /\bsystematic review\b/i, type: "systematic-review" },
    { pattern: /\bclinical trial\b/i, type: "clinical-trial" },
    { pattern: /\brandomized controlled trial\b|\brct\b/i, type: "rct" },
    { pattern: /\bcase study\b/i, type: "case-study" },
    { pattern: /\bthesis\b|\bdissertation\b/i, type: "thesis" },
    { pattern: /\bconference\b/i, type: "conference" }
  ];
  
  const typeMatch = query.match(/type:["']?([^"'\s]+)["']?/i);
  if (typeMatch) {
    filters.documentTypes = [typeMatch[1]];
    cleanQuery = cleanQuery.replace(typeMatch[0], "");
  }
  
  // Open access filter
  const oaMatch = query.match(/openaccess:(true|false|yes|no)/i);
  if (oaMatch) {
    filters.openAccessOnly = ["true", "yes"].includes(oaMatch[1].toLowerCase());
    cleanQuery = cleanQuery.replace(oaMatch[0], "");
  }
  
  // Language filter
  const langMatch = query.match(/lang(?:uage)?:["']?([^"'\s]+)["']?/i);
  if (langMatch) {
    filters.languages = [langMatch[1]];
    cleanQuery = cleanQuery.replace(langMatch[0], "");
  }
  
  return { filters, cleanQuery: cleanQuery.trim().replace(/\s+/g, " ") };
}

// ============================================
// MAIN PARSER
// ============================================

export function parseQuery(query: string): ParsedQuery {
  const original = query;
  
  // 1. Extract phrases first (preserve them)
  const { phrases, remaining: afterPhrases } = extractPhrases(query);
  
  // 2. Parse field queries
  const { fields, remaining: afterFields } = parseFieldQueries(afterPhrases);
  
  // 3. Parse filters
  const { filters, cleanQuery: afterFilters } = parseFilters(afterFields);
  
  // 4. Parse modifiers (+, -)
  const { required, excluded, normal: afterModifiers } = parseModifiers(afterFilters);
  
  // 5. Parse ranges
  const { ranges, remaining: afterRanges } = parseRanges(afterModifiers);
  
  // Apply year ranges to filters
  for (const range of ranges) {
    if (range.field === "year") {
      filters.yearFrom = range.from;
      filters.yearTo = range.to;
    }
  }
  
  // 6. Detect language
  const langResult = detectLanguagePrecise(original);
  
  // 7. Correct spelling
  const { corrected, corrections } = correctSpelling(afterRanges, langResult.language);
  
  // 8. Normalize
  const normalized = corrected
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\s+/g, " ")
    .trim();
  
  // 9. Remove stopwords
  const withoutStopwords = removeStopwords(normalized, langResult.language);
  
  // 10. Extract keywords
  const keywords = extractKeywordsRAKE(original);
  
  // 11. Expand abbreviations for search
  const expanded = expandAbbreviations(withoutStopwords);
  
  // 12. Get suggestions
  const suggestions = suggestRelatedTerms(original);
  
  // 13. Build expanded queries
  const expandedQueries = [
    withoutStopwords,
    ...phrases.map(p => `"${p}"`),
    ...required,
    expanded !== withoutStopwords ? expanded : ""
  ].filter(Boolean);
  
  // 14. Build tokens
  const tokens: Token[] = [];
  let position = 0;
  
  for (const phrase of phrases) {
    tokens.push({ type: "phrase", value: phrase, position: position++ });
  }
  
  for (const word of withoutStopwords.split(/\s+/).filter(Boolean)) {
    const isRequired = required.includes(word);
    const isExcluded = excluded.includes(word);
    tokens.push({ 
      type: "term", 
      value: word, 
      position: position++,
      required: isRequired,
      excluded: isExcluded
    });
  }
  
  return {
    original,
    normalized,
    tokens,
    fields,
    filters,
    language: langResult.language,
    suggestions,
    expandedQueries: [...new Set(expandedQueries)]
  };
}

// ============================================
// QUERY BUILDER (for APIs)
// ============================================

export function buildSearchQuery(parsed: ParsedQuery, targetAPI: "scopus" | "pubmed" | "scholar" | "crossref" | "semantic"): string {
  let query = "";
  
  switch (targetAPI) {
    case "scopus":
      // Scopus query syntax
      const scopusParts: string[] = [];
      
      for (const token of parsed.tokens) {
        if (token.type === "phrase") {
          scopusParts.push(`"${token.value}"`);
        } else if (token.excluded) {
          scopusParts.push(`AND NOT ${token.value}`);
        } else if (token.required) {
          scopusParts.push(`AND ${token.value}`);
        } else {
          scopusParts.push(token.value);
        }
      }
      
      for (const field of parsed.fields) {
        switch (field.field) {
          case "author": scopusParts.push(`AUTH(${field.value})`); break;
          case "title": scopusParts.push(`TITLE(${field.value})`); break;
          case "abstract": scopusParts.push(`ABS(${field.value})`); break;
          case "journal": scopusParts.push(`SRCTITLE(${field.value})`); break;
          case "year": scopusParts.push(`PUBYEAR IS ${field.value}`); break;
          case "doi": scopusParts.push(`DOI(${field.value})`); break;
        }
      }
      
      query = scopusParts.join(" ");
      break;
      
    case "pubmed":
      // PubMed query syntax
      const pubmedParts: string[] = [];
      
      for (const token of parsed.tokens) {
        if (token.type === "phrase") {
          pubmedParts.push(`"${token.value}"`);
        } else if (token.excluded) {
          pubmedParts.push(`NOT ${token.value}`);
        } else {
          pubmedParts.push(token.value);
        }
      }
      
      for (const field of parsed.fields) {
        switch (field.field) {
          case "author": pubmedParts.push(`${field.value}[Author]`); break;
          case "title": pubmedParts.push(`${field.value}[Title]`); break;
          case "journal": pubmedParts.push(`${field.value}[Journal]`); break;
          case "year": pubmedParts.push(`${field.value}[Date - Publication]`); break;
        }
      }
      
      // Add date filter
      if (parsed.filters.yearFrom && parsed.filters.yearTo) {
        pubmedParts.push(`${parsed.filters.yearFrom}:${parsed.filters.yearTo}[Date - Publication]`);
      }
      
      query = pubmedParts.join(" AND ");
      break;
      
    case "scholar":
      // Google Scholar simple query
      query = parsed.tokens
        .filter(t => !t.excluded)
        .map(t => t.type === "phrase" ? `"${t.value}"` : t.value)
        .join(" ");
      
      // Add excluded terms
      const excluded = parsed.tokens.filter(t => t.excluded).map(t => `-${t.value}`);
      if (excluded.length > 0) {
        query += " " + excluded.join(" ");
      }
      
      // Add author
      const authorField = parsed.fields.find(f => f.field === "author");
      if (authorField) {
        query += ` author:${authorField.value}`;
      }
      break;
      
    case "crossref":
    case "semantic":
      // Simple query for CrossRef and Semantic Scholar
      query = parsed.tokens
        .filter(t => !t.excluded)
        .map(t => t.type === "phrase" ? `"${t.value}"` : t.value)
        .join(" ");
      break;
  }
  
  return query.trim();
}

// ============================================
// EXPORTS
// ============================================

export {
  detectLanguagePrecise,
  correctSpelling,
  extractKeywordsRAKE,
  extractKeywordsTextRank,
  calculateTFIDF,
  calculateBM25,
  predictQueryDifficulty,
  detectSearchIntent,
  classifyTopic,
  detectMedicalTerms,
  extractInstitutions,
  suggestRelatedTerms,
  expandAbbreviations,
  translateTerms,
  removeStopwords
};
