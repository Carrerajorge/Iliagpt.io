import { performOCR, isScannedDocument, OCRResult } from './ocrService';
import natural from 'natural';
import { franc } from 'franc';

export interface TableCell {
  text: string;
  row: number;
  col: number;
  rowSpan?: number;
  colSpan?: number;
}

export interface ExtractedTable {
  rows: string[][];
  headers?: string[];
  rowCount: number;
  colCount: number;
  confidence: number;
}

export interface ExtractedFigure {
  type: 'image' | 'chart' | 'diagram' | 'graph';
  description?: string;
  pageNumber?: number;
  position?: { x: number; y: number; width: number; height: number };
  base64?: string;
}

export interface MathExpression {
  latex: string;
  text: string;
  position?: { start: number; end: number };
  type: 'inline' | 'block';
}

export interface DocumentSection {
  level: number;
  title: string;
  content: string;
  startIndex: number;
  endIndex: number;
  children: DocumentSection[];
}

export interface NamedEntity {
  text: string;
  type: 'PERSON' | 'ORGANIZATION' | 'LOCATION' | 'DATE' | 'MONEY' | 'EMAIL' | 'PHONE' | 'URL';
  confidence: number;
  positions: { start: number; end: number }[];
}

export interface Citation {
  raw: string;
  format: 'APA' | 'Vancouver' | 'Chicago' | 'MLA' | 'Harvard' | 'unknown';
  authors?: string[];
  year?: string;
  title?: string;
  journal?: string;
  volume?: string;
  pages?: string;
  doi?: string;
  url?: string;
}

export interface SentimentResult {
  overall: 'positive' | 'negative' | 'neutral';
  score: number;
  confidence: number;
  breakdown?: {
    positive: number;
    negative: number;
    neutral: number;
  };
}

export interface ReadabilityMetrics {
  fleschReadingEase: number;
  fleschKincaidGrade: number;
  gunningFog: number;
  smogIndex: number;
  colemanLiauIndex: number;
  automatedReadabilityIndex: number;
  averageGrade: number;
  readingLevel: 'elementary' | 'middle_school' | 'high_school' | 'college' | 'graduate';
}

export interface QualityAnalysis {
  score: number;
  issues: QualityIssue[];
  suggestions: string[];
  hasEmptyPages: boolean;
  hasTruncatedText: boolean;
  hasFormattingErrors: boolean;
  completeness: number;
}

export interface QualityIssue {
  type: 'empty_section' | 'truncated_text' | 'formatting_error' | 'missing_content' | 'encoding_issue';
  severity: 'low' | 'medium' | 'high';
  description: string;
  location?: { start: number; end: number };
}

export interface DuplicateSection {
  text: string;
  occurrences: { start: number; end: number }[];
  similarity: number;
}

export interface CoherenceAnalysis {
  score: number;
  transitions: TransitionQuality[];
  overallFlow: 'excellent' | 'good' | 'fair' | 'poor';
  suggestions: string[];
}

export interface TransitionQuality {
  fromSection: string;
  toSection: string;
  score: number;
  hasConnector: boolean;
}

export interface DensityMetrics {
  contentDensity: number;
  informationRatio: number;
  wordCount: number;
  uniqueWordCount: number;
  lexicalDiversity: number;
  averageSentenceLength: number;
  averageWordLength: number;
  fillerWordRatio: number;
  technicalTermDensity: number;
}

export interface DocumentSummary {
  title?: string;
  abstract: string;
  keyPoints: string[];
  sectionSummaries: { section: string; summary: string }[];
  keywords: string[];
  estimatedReadingTime: number;
}

export interface AdvancedAnalysisResult {
  ocrApplied: boolean;
  ocrConfidence?: number;
  extractedText: string;
  language: {
    code: string;
    name: string;
    confidence: number;
  };
  tables: ExtractedTable[];
  figures: ExtractedFigure[];
  mathExpressions: MathExpression[];
  structure: DocumentSection[];
  entities: NamedEntity[];
  citations: Citation[];
  sentiment: SentimentResult;
  readability: ReadabilityMetrics;
  quality: QualityAnalysis;
  duplicates: DuplicateSection[];
  coherence: CoherenceAnalysis;
  density: DensityMetrics;
  summary?: DocumentSummary;
  processingTime: number;
}

const LANGUAGE_NAMES: Record<string, string> = {
  eng: 'English',
  spa: 'Spanish',
  fra: 'French',
  deu: 'German',
  por: 'Portuguese',
  ita: 'Italian',
  rus: 'Russian',
  zho: 'Chinese',
  jpn: 'Japanese',
  kor: 'Korean',
  ara: 'Arabic',
  hin: 'Hindi',
  und: 'Unknown'
};

const FILLER_WORDS_EN = new Set([
  'the', 'a', 'an', 'and', 'or', 'but', 'is', 'are', 'was', 'were', 'be', 'been', 'being',
  'have', 'has', 'had', 'do', 'does', 'did', 'will', 'would', 'could', 'should', 'may',
  'might', 'must', 'shall', 'can', 'need', 'dare', 'ought', 'used', 'to', 'of', 'in',
  'for', 'on', 'with', 'at', 'by', 'from', 'as', 'into', 'through', 'during', 'before',
  'after', 'above', 'below', 'between', 'under', 'again', 'further', 'then', 'once',
  'here', 'there', 'when', 'where', 'why', 'how', 'all', 'each', 'few', 'more', 'most',
  'other', 'some', 'such', 'no', 'nor', 'not', 'only', 'own', 'same', 'so', 'than',
  'too', 'very', 'just', 'also', 'now', 'this', 'that', 'these', 'those', 'it', 'its'
]);

const FILLER_WORDS_ES = new Set([
  'el', 'la', 'los', 'las', 'un', 'una', 'unos', 'unas', 'y', 'o', 'pero', 'es', 'son',
  'era', 'eran', 'ser', 'sido', 'siendo', 'tener', 'tiene', 'tenía', 'hacer', 'hace',
  'hizo', 'de', 'del', 'en', 'para', 'por', 'con', 'sin', 'sobre', 'entre', 'hacia',
  'desde', 'hasta', 'durante', 'antes', 'después', 'que', 'cual', 'cuales', 'quien',
  'quienes', 'como', 'cuando', 'donde', 'porque', 'si', 'no', 'más', 'menos', 'muy',
  'mucho', 'poco', 'todo', 'toda', 'todos', 'todas', 'este', 'esta', 'estos', 'estas',
  'ese', 'esa', 'esos', 'esas', 'aquel', 'aquella', 'su', 'sus', 'mi', 'mis', 'tu', 'tus'
]);

const TRANSITION_WORDS = new Set([
  'however', 'therefore', 'furthermore', 'moreover', 'additionally', 'consequently',
  'nevertheless', 'meanwhile', 'subsequently', 'accordingly', 'thus', 'hence',
  'indeed', 'specifically', 'particularly', 'notably', 'significantly',
  'sin embargo', 'por lo tanto', 'además', 'no obstante', 'asimismo', 'por consiguiente',
  'en consecuencia', 'mientras tanto', 'posteriormente', 'así', 'por ende',
  'de hecho', 'específicamente', 'particularmente', 'notablemente', 'significativamente'
]);

export async function analyzeDocumentAdvanced(
  buffer: Buffer,
  mimeType: string,
  existingText?: string,
  options: { includeOCR?: boolean; generateSummary?: boolean } = {}
): Promise<AdvancedAnalysisResult> {
  const startTime = Date.now();
  let text = existingText || '';
  let ocrApplied = false;
  let ocrConfidence: number | undefined;

  if (options.includeOCR !== false && isScannedDocument(buffer, mimeType, text)) {
    try {
      const ocrResult = await performOCR(buffer);
      if (ocrResult.text && ocrResult.text.length > text.length) {
        text = ocrResult.text;
        ocrApplied = true;
        ocrConfidence = ocrResult.confidence;
      }
    } catch (error) {
      console.error('[AdvancedAnalyzer] OCR failed:', error);
    }
  }

  const language = detectLanguage(text);
  const tables = extractTables(text);
  const figures = detectFigures(text);
  const mathExpressions = extractMathExpressions(text);
  const structure = analyzeStructure(text);
  const entities = extractNamedEntities(text);
  const citations = extractCitations(text);
  const sentiment = analyzeSentiment(text, language.code);
  const readability = calculateReadability(text);
  const quality = analyzeQuality(text, structure);
  const duplicates = detectDuplicates(text);
  const coherence = analyzeCoherence(text, structure);
  const density = calculateDensity(text, language.code);

  const result: AdvancedAnalysisResult = {
    ocrApplied,
    ocrConfidence,
    extractedText: text,
    language,
    tables,
    figures,
    mathExpressions,
    structure,
    entities,
    citations,
    sentiment,
    readability,
    quality,
    duplicates,
    coherence,
    density,
    processingTime: Date.now() - startTime
  };

  return result;
}

export function detectLanguage(text: string): { code: string; name: string; confidence: number } {
  if (!text || text.length < 20) {
    return { code: 'und', name: 'Unknown', confidence: 0 };
  }

  try {
    const code = franc(text.slice(0, 5000));
    const name = LANGUAGE_NAMES[code] || code;
    
    const confidence = text.length > 500 ? 0.95 : text.length > 100 ? 0.8 : 0.6;
    
    return { code, name, confidence };
  } catch {
    return { code: 'und', name: 'Unknown', confidence: 0 };
  }
}

export function extractTables(text: string): ExtractedTable[] {
  const tables: ExtractedTable[] = [];
  
  const tablePatterns = [
    /\|([^\n]+\|)+\n\|[-:| ]+\|\n(\|[^\n]+\|\n)+/gm,
    /(?:^|\n)([^\t\n]+\t[^\t\n]+(?:\t[^\t\n]+)*\n)+/gm,
  ];

  for (const pattern of tablePatterns) {
    const matches = text.matchAll(pattern);
    for (const match of matches) {
      const tableText = match[0];
      const rows = parseTableRows(tableText);
      if (rows.length >= 2 && rows[0].length >= 2) {
        tables.push({
          rows,
          headers: rows[0],
          rowCount: rows.length,
          colCount: rows[0]?.length || 0,
          confidence: 0.8
        });
      }
    }
  }

  return tables;
}

function parseTableRows(tableText: string): string[][] {
  const lines = tableText.trim().split('\n');
  const rows: string[][] = [];
  
  for (const line of lines) {
    if (line.includes('|')) {
      const cells = line.split('|')
        .map(cell => cell.trim())
        .filter(cell => cell && !cell.match(/^[-:]+$/));
      if (cells.length > 0) {
        rows.push(cells);
      }
    } else if (line.includes('\t')) {
      const cells = line.split('\t').map(cell => cell.trim());
      if (cells.length > 1) {
        rows.push(cells);
      }
    }
  }
  
  return rows;
}

export function detectFigures(text: string): ExtractedFigure[] {
  const figures: ExtractedFigure[] = [];
  
  const figurePatterns = [
    /(?:Figure|Fig\.?|Figura|Gráfico|Chart|Diagram)\s*(\d+)[\s.:]*([^\n]+)?/gi,
    /\[(?:Image|Imagen|Figure|Figura):\s*([^\]]+)\]/gi,
    /<<\s*(?:insert|insertar)\s+(?:figure|imagen|gráfico)\s*>>/gi,
  ];

  for (const pattern of figurePatterns) {
    const matches = text.matchAll(pattern);
    for (const match of matches) {
      figures.push({
        type: 'image',
        description: match[2] || match[1] || 'Detected figure reference'
      });
    }
  }

  return figures;
}

export function extractMathExpressions(text: string): MathExpression[] {
  const expressions: MathExpression[] = [];
  
  const inlinePatterns = [
    /\$([^$]+)\$/g,
    /\\\\?\(([^)]+)\\\\?\)/g,
  ];
  
  const blockPatterns = [
    /\$\$([^$]+)\$\$/g,
    /\\\\?\[([^\]]+)\\\\?\]/g,
    /\\begin\{equation\}([\s\S]*?)\\end\{equation\}/g,
    /\\begin\{align\}([\s\S]*?)\\end\{align\}/g,
  ];

  for (const pattern of inlinePatterns) {
    const matches = text.matchAll(pattern);
    for (const match of matches) {
      expressions.push({
        latex: match[1],
        text: latexToText(match[1]),
        type: 'inline',
        position: { start: match.index!, end: match.index! + match[0].length }
      });
    }
  }

  for (const pattern of blockPatterns) {
    const matches = text.matchAll(pattern);
    for (const match of matches) {
      expressions.push({
        latex: match[1],
        text: latexToText(match[1]),
        type: 'block',
        position: { start: match.index!, end: match.index! + match[0].length }
      });
    }
  }

  return expressions;
}

function latexToText(latex: string): string {
  return latex
    .replace(/\\frac\{([^}]+)\}\{([^}]+)\}/g, '($1)/($2)')
    .replace(/\\sqrt\{([^}]+)\}/g, 'sqrt($1)')
    .replace(/\\sum/g, 'Σ')
    .replace(/\\prod/g, 'Π')
    .replace(/\\int/g, '∫')
    .replace(/\\alpha/g, 'α')
    .replace(/\\beta/g, 'β')
    .replace(/\\gamma/g, 'γ')
    .replace(/\\delta/g, 'δ')
    .replace(/\\pi/g, 'π')
    .replace(/\\theta/g, 'θ')
    .replace(/\\sigma/g, 'σ')
    .replace(/\\mu/g, 'μ')
    .replace(/\\lambda/g, 'λ')
    .replace(/\\infty/g, '∞')
    .replace(/\^(\{[^}]+\}|\w)/g, '^$1')
    .replace(/_(\{[^}]+\}|\w)/g, '_$1')
    .replace(/[{}]/g, '')
    .replace(/\\/g, '');
}

export function analyzeStructure(text: string): DocumentSection[] {
  const sections: DocumentSection[] = [];
  const lines = text.split('\n');
  
  const headingPatterns = [
    { pattern: /^#{1,6}\s+(.+)$/, levelFn: (m: string) => (m.match(/^#+/) || ['#'])[0].length },
    { pattern: /^(\d+\.)+\s+(.+)$/, levelFn: (m: string) => (m.match(/\d+\./g) || []).length },
    { pattern: /^(CHAPTER|CAPÍTULO|SECTION|SECCIÓN)\s+(\d+|[IVXLC]+)[.:]\s*(.+)?$/i, levelFn: () => 1 },
    { pattern: /^([A-Z][A-Z\s]{2,50})$/, levelFn: () => 2 },
  ];

  let currentIndex = 0;
  
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    
    for (const { pattern, levelFn } of headingPatterns) {
      const match = line.match(pattern);
      if (match) {
        const title = match[match.length - 1] || match[1] || line;
        const level = levelFn(line);
        
        const contentStart = currentIndex + line.length + 1;
        let contentEnd = text.length;
        
        for (let j = i + 1; j < lines.length; j++) {
          const nextLine = lines[j].trim();
          for (const hp of headingPatterns) {
            if (hp.pattern.test(nextLine)) {
              contentEnd = text.indexOf(nextLine, contentStart);
              break;
            }
          }
          if (contentEnd !== text.length) break;
        }
        
        sections.push({
          level,
          title: title.trim(),
          content: text.slice(contentStart, contentEnd).trim(),
          startIndex: currentIndex,
          endIndex: contentEnd,
          children: []
        });
        break;
      }
    }
    
    currentIndex += line.length + 1;
  }

  return buildHierarchy(sections);
}

function buildHierarchy(sections: DocumentSection[]): DocumentSection[] {
  const root: DocumentSection[] = [];
  const stack: DocumentSection[] = [];

  for (const section of sections) {
    while (stack.length > 0 && stack[stack.length - 1].level >= section.level) {
      stack.pop();
    }

    if (stack.length === 0) {
      root.push(section);
    } else {
      stack[stack.length - 1].children.push(section);
    }

    stack.push(section);
  }

  return root;
}

export function extractNamedEntities(text: string): NamedEntity[] {
  const entities: NamedEntity[] = [];
  const seen = new Map<string, NamedEntity>();

  const patterns: { pattern: RegExp; type: NamedEntity['type'] }[] = [
    { pattern: /\b[A-Z][a-z]+(?:\s+[A-Z][a-z]+)+\b/g, type: 'PERSON' },
    { pattern: /\b(?:Inc\.|Corp\.|LLC|Ltd\.|S\.A\.|S\.L\.|Company|Corporation|Universidad|University|Instituto|Institute)\b[^.]*\b/gi, type: 'ORGANIZATION' },
    { pattern: /\b(?:January|February|March|April|May|June|July|August|September|October|November|December|Enero|Febrero|Marzo|Abril|Mayo|Junio|Julio|Agosto|Septiembre|Octubre|Noviembre|Diciembre)\s+\d{1,2},?\s+\d{4}\b/gi, type: 'DATE' },
    { pattern: /\b\d{1,2}[\/\-]\d{1,2}[\/\-]\d{2,4}\b/g, type: 'DATE' },
    { pattern: /\$\s*[\d,]+(?:\.\d{2})?\b|\b(?:USD|EUR|MXN)\s*[\d,]+(?:\.\d{2})?\b/gi, type: 'MONEY' },
    { pattern: /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Z|a-z]{2,}\b/g, type: 'EMAIL' },
    { pattern: /\b(?:\+?\d{1,3}[-.\s]?)?\(?\d{2,3}\)?[-.\s]?\d{3,4}[-.\s]?\d{4}\b/g, type: 'PHONE' },
    { pattern: /https?:\/\/[^\s<>"{}|\\^`\[\]]+/g, type: 'URL' },
  ];

  for (const { pattern, type } of patterns) {
    const matches = text.matchAll(pattern);
    for (const match of matches) {
      const entityText = match[0].trim();
      if (entityText.length < 2) continue;
      
      const key = `${type}:${entityText.toLowerCase()}`;
      
      if (seen.has(key)) {
        seen.get(key)!.positions.push({ start: match.index!, end: match.index! + entityText.length });
      } else {
        const entity: NamedEntity = {
          text: entityText,
          type,
          confidence: 0.7,
          positions: [{ start: match.index!, end: match.index! + entityText.length }]
        };
        seen.set(key, entity);
        entities.push(entity);
      }
    }
  }

  return entities;
}

export function extractCitations(text: string): Citation[] {
  const citations: Citation[] = [];

  const apaPattern = /([A-Z][a-zA-Z]+(?:,?\s+[A-Z]\.?\s*)+(?:,?\s*(?:&|y|and)\s*[A-Z][a-zA-Z]+(?:,?\s+[A-Z]\.?\s*)+)*)\s*\((\d{4})\)\.\s*([^.]+)\./g;
  const vancouverPattern = /(\d+)\.\s+([^.]+)\.\s+([^.]+)\.\s+(\d{4});?\s*(\d+)?(?:\((\d+)\))?:?\s*([\d-]+)?/g;
  const doiPattern = /(?:doi:|https?:\/\/doi\.org\/)(10\.\d{4,}\/[^\s]+)/gi;

  const apaMatches = text.matchAll(apaPattern);
  for (const match of apaMatches) {
    citations.push({
      raw: match[0],
      format: 'APA',
      authors: match[1].split(/,?\s*(?:&|y|and)\s*/).map(a => a.trim()),
      year: match[2],
      title: match[3].trim()
    });
  }

  const vancouverMatches = text.matchAll(vancouverPattern);
  for (const match of vancouverMatches) {
    citations.push({
      raw: match[0],
      format: 'Vancouver',
      authors: [match[2].trim()],
      title: match[3].trim(),
      year: match[4],
      volume: match[5],
      pages: match[7]
    });
  }

  const doiMatches = text.matchAll(doiPattern);
  for (const match of doiMatches) {
    const existing = citations.find(c => c.raw.includes(match[1]));
    if (existing) {
      existing.doi = match[1];
    } else {
      citations.push({
        raw: match[0],
        format: 'unknown',
        doi: match[1]
      });
    }
  }

  return citations;
}

export function analyzeSentiment(text: string, languageCode: string): SentimentResult {
  const analyzer = new natural.SentimentAnalyzer('English', natural.PorterStemmer, 'afinn');
  const tokenizer = new natural.WordTokenizer();
  
  const tokens = tokenizer.tokenize(text.toLowerCase()) || [];
  const score = analyzer.getSentiment(tokens);
  
  let positive = 0, negative = 0, neutral = 0;
  
  for (const token of tokens) {
    const wordScore = getWordSentiment(token);
    if (wordScore > 0) positive++;
    else if (wordScore < 0) negative++;
    else neutral++;
  }
  
  const total = positive + negative + neutral || 1;
  
  return {
    overall: score > 0.1 ? 'positive' : score < -0.1 ? 'negative' : 'neutral',
    score: Math.max(-1, Math.min(1, score)),
    confidence: Math.min(0.95, 0.5 + (Math.abs(score) * 0.5)),
    breakdown: {
      positive: positive / total,
      negative: negative / total,
      neutral: neutral / total
    }
  };
}

function getWordSentiment(word: string): number {
  const positive = new Set(['good', 'great', 'excellent', 'amazing', 'wonderful', 'fantastic', 'love', 'happy', 'best', 'success', 'bueno', 'excelente', 'maravilloso', 'increíble', 'éxito']);
  const negative = new Set(['bad', 'terrible', 'awful', 'horrible', 'hate', 'worst', 'failure', 'sad', 'poor', 'malo', 'terrible', 'horrible', 'fracaso', 'triste']);
  
  if (positive.has(word)) return 1;
  if (negative.has(word)) return -1;
  return 0;
}

export function calculateReadability(text: string): ReadabilityMetrics {
  const sentences = text.split(/[.!?]+/).filter(s => s.trim().length > 0);
  const words = text.split(/\s+/).filter(w => w.match(/\w/));
  const syllableCount = words.reduce((sum, word) => sum + countSyllables(word), 0);
  
  const totalSentences = Math.max(1, sentences.length);
  const totalWords = Math.max(1, words.length);
  const totalSyllables = Math.max(1, syllableCount);
  
  const avgWordsPerSentence = totalWords / totalSentences;
  const avgSyllablesPerWord = totalSyllables / totalWords;
  
  const complexWords = words.filter(w => countSyllables(w) >= 3).length;
  const longWords = words.filter(w => w.length > 6).length;
  
  const fleschReadingEase = 206.835 - (1.015 * avgWordsPerSentence) - (84.6 * avgSyllablesPerWord);
  const fleschKincaidGrade = (0.39 * avgWordsPerSentence) + (11.8 * avgSyllablesPerWord) - 15.59;
  const gunningFog = 0.4 * (avgWordsPerSentence + 100 * (complexWords / totalWords));
  const smogIndex = 1.043 * Math.sqrt(complexWords * (30 / totalSentences)) + 3.1291;
  const colemanLiauIndex = (5.89 * (text.replace(/\s/g, '').length / totalWords)) - (30 * (totalSentences / totalWords)) - 15.8;
  const automatedReadabilityIndex = (4.71 * (text.replace(/\s/g, '').length / totalWords)) + (0.5 * avgWordsPerSentence) - 21.43;
  
  const averageGrade = (fleschKincaidGrade + gunningFog + smogIndex + colemanLiauIndex + automatedReadabilityIndex) / 5;
  
  let readingLevel: ReadabilityMetrics['readingLevel'];
  if (averageGrade <= 5) readingLevel = 'elementary';
  else if (averageGrade <= 8) readingLevel = 'middle_school';
  else if (averageGrade <= 12) readingLevel = 'high_school';
  else if (averageGrade <= 16) readingLevel = 'college';
  else readingLevel = 'graduate';
  
  return {
    fleschReadingEase: Math.round(fleschReadingEase * 10) / 10,
    fleschKincaidGrade: Math.round(fleschKincaidGrade * 10) / 10,
    gunningFog: Math.round(gunningFog * 10) / 10,
    smogIndex: Math.round(smogIndex * 10) / 10,
    colemanLiauIndex: Math.round(colemanLiauIndex * 10) / 10,
    automatedReadabilityIndex: Math.round(automatedReadabilityIndex * 10) / 10,
    averageGrade: Math.round(averageGrade * 10) / 10,
    readingLevel
  };
}

function countSyllables(word: string): number {
  word = word.toLowerCase().replace(/[^a-z]/g, '');
  if (word.length <= 3) return 1;
  
  word = word.replace(/(?:[^laeiouy]es|ed|[^laeiouy]e)$/, '');
  word = word.replace(/^y/, '');
  
  const matches = word.match(/[aeiouy]{1,2}/g);
  return matches ? matches.length : 1;
}

export function analyzeQuality(text: string, structure: DocumentSection[]): QualityAnalysis {
  const issues: QualityIssue[] = [];
  let score = 100;
  
  const paragraphs = text.split(/\n\n+/);
  const emptyParagraphs = paragraphs.filter(p => p.trim().length < 5);
  
  if (emptyParagraphs.length > paragraphs.length * 0.2) {
    issues.push({
      type: 'empty_section',
      severity: 'medium',
      description: `Found ${emptyParagraphs.length} empty or near-empty paragraphs`
    });
    score -= 10;
  }
  
  if (text.includes('…') || text.includes('...') || text.match(/\[\s*\.\.\.\s*\]/)) {
    issues.push({
      type: 'truncated_text',
      severity: 'high',
      description: 'Text appears to be truncated or incomplete'
    });
    score -= 15;
  }
  
  const encodingIssues = text.match(/[\ufffd\u0000-\u0008\u000b\u000c\u000e-\u001f]/g);
  if (encodingIssues && encodingIssues.length > 5) {
    issues.push({
      type: 'encoding_issue',
      severity: 'medium',
      description: `Found ${encodingIssues.length} encoding errors or invalid characters`
    });
    score -= 10;
  }
  
  const formattingErrors = text.match(/([^\n])\n([a-z])/g);
  if (formattingErrors && formattingErrors.length > text.length / 500) {
    issues.push({
      type: 'formatting_error',
      severity: 'low',
      description: 'Possible line break issues detected (mid-sentence breaks)'
    });
    score -= 5;
  }
  
  const completeness = calculateCompleteness(text, structure);
  
  const suggestions: string[] = [];
  if (score < 80) suggestions.push('Consider reviewing and cleaning the document');
  if (issues.some(i => i.type === 'encoding_issue')) suggestions.push('Re-export the document with proper encoding');
  if (issues.some(i => i.type === 'truncated_text')) suggestions.push('Verify the complete document was uploaded');
  
  return {
    score: Math.max(0, score),
    issues,
    suggestions,
    hasEmptyPages: emptyParagraphs.length > 0,
    hasTruncatedText: issues.some(i => i.type === 'truncated_text'),
    hasFormattingErrors: issues.some(i => i.type === 'formatting_error'),
    completeness
  };
}

function calculateCompleteness(text: string, structure: DocumentSection[]): number {
  let score = 0;
  
  if (text.length > 100) score += 20;
  if (structure.length > 0) score += 20;
  if (text.match(/introduction|introducción/i)) score += 15;
  if (text.match(/conclusion|conclusión/i)) score += 15;
  if (text.match(/reference|bibliograf|works cited/i)) score += 15;
  if (!text.match(/\[\s*\.\.\.\s*\]|continued|continúa/i)) score += 15;
  
  return Math.min(100, score);
}

export function detectDuplicates(text: string): DuplicateSection[] {
  const duplicates: DuplicateSection[] = [];
  const sentences = text.split(/[.!?]+/).map(s => s.trim()).filter(s => s.length > 50);
  const seen = new Map<string, number[]>();
  
  for (let i = 0; i < sentences.length; i++) {
    const normalized = sentences[i].toLowerCase().replace(/\s+/g, ' ');
    
    for (const [existing, indices] of seen.entries()) {
      const similarity = calculateSimilarity(normalized, existing);
      if (similarity > 0.85) {
        indices.push(i);
      }
    }
    
    if (!Array.from(seen.keys()).some(k => calculateSimilarity(normalized, k) > 0.85)) {
      seen.set(normalized, [i]);
    }
  }
  
  for (const [sentence, indices] of seen.entries()) {
    if (indices.length > 1) {
      duplicates.push({
        text: sentence.slice(0, 200),
        occurrences: indices.map(i => ({ start: i, end: i + 1 })),
        similarity: 1.0
      });
    }
  }
  
  return duplicates;
}

function calculateSimilarity(a: string, b: string): number {
  const wordsA = new Set(a.split(/\s+/));
  const wordsB = new Set(b.split(/\s+/));
  
  const intersection = new Set([...wordsA].filter(x => wordsB.has(x)));
  const union = new Set([...wordsA, ...wordsB]);
  
  return intersection.size / union.size;
}

export function analyzeCoherence(text: string, structure: DocumentSection[]): CoherenceAnalysis {
  const transitions: TransitionQuality[] = [];
  let totalScore = 0;
  
  for (let i = 0; i < structure.length - 1; i++) {
    const current = structure[i];
    const next = structure[i + 1];
    
    const hasConnector = TRANSITION_WORDS.has(
      (next.content.split(/\s+/)[0] || '').toLowerCase()
    );
    
    const similarity = calculateSimilarity(current.content, next.content);
    const score = hasConnector ? 0.8 : similarity > 0.3 ? 0.6 : 0.4;
    
    transitions.push({
      fromSection: current.title,
      toSection: next.title,
      score,
      hasConnector
    });
    
    totalScore += score;
  }
  
  const averageScore = transitions.length > 0 ? totalScore / transitions.length : 0.5;
  
  let overallFlow: CoherenceAnalysis['overallFlow'];
  if (averageScore >= 0.8) overallFlow = 'excellent';
  else if (averageScore >= 0.6) overallFlow = 'good';
  else if (averageScore >= 0.4) overallFlow = 'fair';
  else overallFlow = 'poor';
  
  const suggestions: string[] = [];
  if (averageScore < 0.6) {
    suggestions.push('Consider adding transition words between sections');
    suggestions.push('Ensure logical flow from one topic to the next');
  }
  
  return {
    score: Math.round(averageScore * 100),
    transitions,
    overallFlow,
    suggestions
  };
}

export function calculateDensity(text: string, languageCode: string): DensityMetrics {
  const words = text.split(/\s+/).filter(w => w.match(/\w/));
  const sentences = text.split(/[.!?]+/).filter(s => s.trim().length > 0);
  const uniqueWords = new Set(words.map(w => w.toLowerCase()));
  
  const fillerWords = languageCode === 'spa' ? FILLER_WORDS_ES : FILLER_WORDS_EN;
  const fillerCount = words.filter(w => fillerWords.has(w.toLowerCase())).length;
  
  const technicalPattern = /\b[A-Z]{2,}|\b\w+(?:tion|ment|ness|ity|ology|ography|esis|osis)\b/g;
  const technicalTerms = text.match(technicalPattern) || [];
  
  const wordCount = words.length || 1;
  
  return {
    contentDensity: Math.round((1 - fillerCount / wordCount) * 100),
    informationRatio: Math.round((uniqueWords.size / wordCount) * 100) / 100,
    wordCount,
    uniqueWordCount: uniqueWords.size,
    lexicalDiversity: Math.round((uniqueWords.size / wordCount) * 100) / 100,
    averageSentenceLength: Math.round(wordCount / Math.max(1, sentences.length)),
    averageWordLength: Math.round(words.join('').length / wordCount * 10) / 10,
    fillerWordRatio: Math.round((fillerCount / wordCount) * 100) / 100,
    technicalTermDensity: Math.round((technicalTerms.length / wordCount) * 1000) / 10
  };
}

export const advancedDocumentAnalyzer = {
  analyze: analyzeDocumentAdvanced,
  detectLanguage,
  extractTables,
  detectFigures,
  extractMathExpressions,
  analyzeStructure,
  extractNamedEntities,
  extractCitations,
  analyzeSentiment,
  calculateReadability,
  analyzeQuality,
  detectDuplicates,
  analyzeCoherence,
  calculateDensity
};
