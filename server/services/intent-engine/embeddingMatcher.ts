import type { IntentType } from "../../../shared/schemas/intent";
import {
  initializeEmbeddingIndex,
  semanticKNNMatch,
  isSemanticIndexReady,
  addExampleToIndex,
  generateEmbedding,
  type SemanticKNNResult
} from "./semanticEmbeddings";
import { logStructured } from "./telemetry";

const INTENT_EXAMPLES: Record<IntentType, string[]> = {
  CREATE_PRESENTATION: [
    "create a powerpoint about artificial intelligence",
    "make me a presentation on climate change",
    "generate slides for my sales pitch",
    "build a slide deck about our quarterly results",
    "crear una presentacion sobre inteligencia artificial",
    "hazme unas diapositivas de marketing",
    "generar pptx sobre el mercado",
    "arma un powerpoint de ventas",
    "faire une présentation sur le marketing",
    "erstelle eine präsentation über das projekt",
    "criar uma apresentacao sobre vendas",
    "creare una presentazione sul prodotto"
  ],
  CREATE_DOCUMENT: [
    "write a report on market trends",
    "create a document about the project status",
    "generate a word document with meeting notes",
    "make me an essay on renewable energy",
    "crear un documento sobre el proyecto",
    "escribir un informe de resultados",
    "generar un reporte en word",
    "hazme un documento con las conclusiones",
    "rédiger un rapport sur les ventes",
    "dokument erstellen über das meeting",
    "criar um documento sobre o cliente",
    "scrivere un documento sul prodotto"
  ],
  CREATE_SPREADSHEET: [
    "create an excel with the budget data",
    "make a spreadsheet with sales figures",
    "generate a table with customer information",
    "build an xlsx with financial projections",
    "crear un excel con los datos de ventas",
    "hazme una tabla con los gastos",
    "generar una hoja de calculo con el presupuesto",
    "arma un excel con las metricas",
    "créer un tableur avec les données",
    "excel erstellen mit den verkaufszahlen",
    "criar uma planilha com os dados",
    "creare un foglio excel con i numeri"
  ],
  SUMMARIZE: [
    "summarize this document for me",
    "give me a brief summary of the text",
    "what are the key points",
    "condense this into bullet points",
    "resumeme este documento",
    "hazme un resumen del texto",
    "cuales son los puntos clave",
    "sintetiza esta informacion",
    "résumer ce document",
    "zusammenfassung des textes",
    "resumir este documento",
    "riassumere questo testo"
  ],
  TRANSLATE: [
    "translate this to spanish",
    "convert this text to french",
    "translate the document to german",
    "change this to english",
    "traduce esto al ingles",
    "pasar este texto a frances",
    "traducir el documento al aleman",
    "cambiar a español",
    "traduire en anglais",
    "ins deutsche übersetzen",
    "traduzir para portugues",
    "tradurre in italiano"
  ],
  SEARCH_WEB: [
    "search for information about climate change",
    "find me data on market trends",
    "look up the latest news on technology",
    "research competitors in the industry",
    "busca informacion sobre el mercado",
    "encuentra datos sobre la competencia",
    "investiga las tendencias de ventas",
    "buscar en internet sobre el tema",
    "rechercher sur le web",
    "im internet suchen nach",
    "pesquisar sobre o tema",
    "cercare informazioni su"
  ],
  ANALYZE_DOCUMENT: [
    "analyze this report for insights",
    "review the document and give feedback",
    "evaluate the quality of this text",
    "examine the data and find patterns",
    "analiza este informe",
    "revisa el documento",
    "evalua la calidad del texto",
    "examina los datos",
    "analyser ce rapport",
    "analysieren sie das dokument",
    "analisar este relatorio",
    "analizzare questo documento"
  ],
  CHAT_GENERAL: [
    "hello how are you",
    "thanks for your help",
    "what can you do",
    "tell me about yourself",
    "hola como estas",
    "gracias por tu ayuda",
    "que puedes hacer",
    "cuentame sobre ti",
    "bonjour comment allez vous",
    "hallo wie geht es dir",
    "ola como voce esta",
    "ciao come stai"
  ],
  NEED_CLARIFICATION: []
};

function tokenize(text: string): string[] {
  return text.toLowerCase()
    .replace(/[^\w\s]/g, " ")
    .split(/\s+/)
    .filter(t => t.length > 1);
}

function computeTermFrequency(tokens: string[]): Map<string, number> {
  const tf = new Map<string, number>();
  for (const token of tokens) {
    tf.set(token, (tf.get(token) || 0) + 1);
  }
  for (const [token, count] of tf) {
    tf.set(token, count / tokens.length);
  }
  return tf;
}

const documentFrequency = new Map<string, number>();
let totalDocuments = 0;

function initializeIDF(): void {
  if (totalDocuments > 0) return;
  
  const allExamples: string[] = [];
  for (const examples of Object.values(INTENT_EXAMPLES)) {
    allExamples.push(...examples);
  }
  
  totalDocuments = allExamples.length;
  
  for (const example of allExamples) {
    const tokens = new Set(tokenize(example));
    for (const token of tokens) {
      documentFrequency.set(token, (documentFrequency.get(token) || 0) + 1);
    }
  }
}

function computeIDF(term: string): number {
  const df = documentFrequency.get(term) || 0;
  if (df === 0) return 0;
  return Math.log(totalDocuments / df);
}

function computeTFIDF(text: string): Map<string, number> {
  initializeIDF();
  const tokens = tokenize(text);
  const tf = computeTermFrequency(tokens);
  const tfidf = new Map<string, number>();
  
  for (const [term, tfValue] of tf) {
    const idf = computeIDF(term);
    tfidf.set(term, tfValue * idf);
  }
  
  return tfidf;
}

function cosineSimilarity(vec1: Map<string, number>, vec2: Map<string, number>): number {
  let dotProduct = 0;
  let norm1 = 0;
  let norm2 = 0;
  
  for (const [term, value] of vec1) {
    norm1 += value * value;
    const v2 = vec2.get(term) || 0;
    dotProduct += value * v2;
  }
  
  for (const value of vec2.values()) {
    norm2 += value * value;
  }
  
  if (norm1 === 0 || norm2 === 0) return 0;
  
  return dotProduct / (Math.sqrt(norm1) * Math.sqrt(norm2));
}

let intentVectors: Map<IntentType, Map<string, number>[]> | null = null;

function initializeIntentVectors(): void {
  if (intentVectors) return;
  
  initializeIDF();
  intentVectors = new Map();
  
  for (const [intent, examples] of Object.entries(INTENT_EXAMPLES) as [IntentType, string[]][]) {
    const vectors: Map<string, number>[] = [];
    for (const example of examples) {
      vectors.push(computeTFIDF(example));
    }
    intentVectors.set(intent, vectors);
  }
}

export interface KNNResult {
  intent: IntentType;
  confidence: number;
  top_matches: Array<{
    intent: IntentType;
    similarity: number;
    example_index?: number;
    text?: string;
  }>;
  method: "tfidf_knn" | "semantic_knn";
  embedding?: number[];
}

export interface KNNMatchOptions {
  useSemantic?: boolean;
  k?: number;
  fallbackToTFIDF?: boolean;
}

const DEFAULT_KNN_OPTIONS: KNNMatchOptions = {
  useSemantic: true,
  k: 20,
  fallbackToTFIDF: true
};

export function tfidfKnnMatch(
  text: string,
  k: number = 5
): KNNResult {
  initializeIntentVectors();
  
  const queryVector = computeTFIDF(text);
  
  const allMatches: Array<{
    intent: IntentType;
    similarity: number;
    example_index: number;
  }> = [];
  
  for (const [intent, vectors] of intentVectors!.entries()) {
    if (intent === "NEED_CLARIFICATION") continue;
    
    for (let i = 0; i < vectors.length; i++) {
      const similarity = cosineSimilarity(queryVector, vectors[i]);
      allMatches.push({ intent, similarity, example_index: i });
    }
  }
  
  allMatches.sort((a, b) => b.similarity - a.similarity);
  
  const topK = allMatches.slice(0, k);
  
  const intentCounts = new Map<IntentType, { count: number; totalSim: number }>();
  for (const match of topK) {
    const current = intentCounts.get(match.intent) || { count: 0, totalSim: 0 };
    current.count++;
    current.totalSim += match.similarity;
    intentCounts.set(match.intent, current);
  }
  
  let bestIntent: IntentType = "CHAT_GENERAL";
  let bestScore = 0;
  
  for (const [intent, stats] of intentCounts) {
    const score = stats.count * (stats.totalSim / stats.count);
    if (score > bestScore) {
      bestScore = score;
      bestIntent = intent;
    }
  }
  
  const bestStats = intentCounts.get(bestIntent) || { count: 0, totalSim: 0 };
  const avgSimilarity = bestStats.count > 0 ? bestStats.totalSim / bestStats.count : 0;
  const majorityRatio = bestStats.count / k;
  
  const confidence = Math.min(0.95, avgSimilarity * 0.6 + majorityRatio * 0.4);
  
  return {
    intent: bestIntent,
    confidence,
    top_matches: topK,
    method: "tfidf_knn"
  };
}

export async function knnMatch(
  text: string,
  options: KNNMatchOptions = {}
): Promise<KNNResult> {
  const opts = { ...DEFAULT_KNN_OPTIONS, ...options };
  
  if (opts.useSemantic && isSemanticIndexReady()) {
    try {
      const semanticResult = await semanticKNNMatch(text, opts.k);
      
      if (semanticResult) {
        logStructured("info", "Semantic KNN match successful", {
          intent: semanticResult.intent,
          confidence: semanticResult.confidence,
          top_similarity: semanticResult.top_matches[0]?.similarity || 0
        });
        
        return {
          intent: semanticResult.intent,
          confidence: semanticResult.confidence,
          top_matches: semanticResult.top_matches.slice(0, 5),
          method: "semantic_knn",
          embedding: semanticResult.embedding
        };
      }
    } catch (error: any) {
      logStructured("warn", "Semantic KNN match failed, falling back to TF-IDF", {
        error: error.message
      });
    }
  }
  
  if (opts.fallbackToTFIDF) {
    logStructured("info", "Using TF-IDF KNN fallback", {
      semantic_available: isSemanticIndexReady(),
      use_semantic_requested: opts.useSemantic
    });
    
    return tfidfKnnMatch(text, Math.min(opts.k || 5, 10));
  }
  
  return {
    intent: "CHAT_GENERAL",
    confidence: 0.30,
    top_matches: [],
    method: "tfidf_knn"
  };
}

export function knnMatchSync(
  text: string,
  k: number = 5
): KNNResult {
  return tfidfKnnMatch(text, k);
}

export function getExampleCount(): number {
  return Object.values(INTENT_EXAMPLES).reduce((acc, arr) => acc + arr.length, 0);
}

export function addExample(intent: IntentType, example: string): void {
  if (INTENT_EXAMPLES[intent]) {
    INTENT_EXAMPLES[intent].push(example);
    intentVectors = null;
    totalDocuments = 0;
    documentFrequency.clear();
  }
}

export async function addExampleWithEmbedding(
  intent: IntentType, 
  example: string
): Promise<void> {
  addExample(intent, example);
  
  if (isSemanticIndexReady()) {
    try {
      const embedding = await generateEmbedding(example);
      addExampleToIndex(intent, example, embedding);
    } catch (error: any) {
      logStructured("warn", "Failed to add example to semantic index", {
        intent,
        error: error.message
      });
    }
  }
}

export { 
  initializeEmbeddingIndex, 
  isSemanticIndexReady,
  type SemanticKNNResult 
};
