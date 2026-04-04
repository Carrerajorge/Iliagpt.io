import { IntentType, IntentClassification, IntentRule, NormalizedInput } from './types';

const INTENT_RULES: IntentRule[] = [
  {
    id: 'title_ideation_explicit',
    keywords: ['títulos', 'titulos', 'título', 'titulo', 'encabezado', 'encabezados', 'headline', 'headlines', 'title', 'titles'],
    patterns: [/(?:dame|genera|crea|proporciona|escribe|haz)\s+\d+\s+(?:títulos?|encabezados?)/i, /(?:\d+)\s+(?:títulos?|ideas?\s+de\s+títulos?)/i],
    intent: 'TITLE_IDEATION',
    priority: 10
  },
  {
    id: 'outline_explicit',
    keywords: ['índice', 'indice', 'outline', 'esquema', 'estructura', 'tabla de contenido', 'contenidos'],
    patterns: [/(?:crea|genera|haz)\s+(?:un\s+)?(?:índice|esquema|outline)/i, /estructura\s+(?:de|del|para)/i],
    intent: 'OUTLINE',
    priority: 10
  },
  {
    id: 'summarize_explicit',
    keywords: ['resume', 'resumen', 'resumir', 'summary', 'summarize', 'sintetiza', 'síntesis'],
    patterns: [/(?:haz|hazme|dame)\s+(?:un\s+)?resumen/i, /resume\s+(?:esto|el|la|este)/i],
    intent: 'SUMMARIZE',
    priority: 10
  },
  {
    id: 'explain_explicit',
    keywords: ['explica', 'explicar', 'explain', 'qué es', 'que es', 'what is', 'define', 'definir', 'definición'],
    patterns: [/(?:explica|explícame|dime)\s+(?:qué|que|cómo)/i, /qué\s+(?:es|son|significa)/i],
    intent: 'EXPLAIN',
    priority: 9
  },
  {
    id: 'translate_explicit',
    keywords: ['traduce', 'traducir', 'translate', 'traducción', 'translation'],
    patterns: [/traduce\s+(?:esto|al|a\s+(?:inglés|español|francés))/i, /translate\s+(?:this|to)/i],
    intent: 'TRANSLATE',
    priority: 10
  },
  {
    id: 'code_generation',
    keywords: ['código', 'codigo', 'code', 'programa', 'script', 'función', 'function', 'clase', 'class', 'método', 'method'],
    patterns: [/(?:escribe|genera|crea)\s+(?:un\s+)?(?:código|programa|script|función)/i, /(?:cómo|como)\s+(?:programo|codifico|hago\s+(?:un|una)\s+función)/i],
    intent: 'CODE_GENERATION',
    priority: 9
  },
  {
    id: 'data_analysis',
    keywords: ['analiza', 'análisis', 'analyze', 'analysis', 'datos', 'data', 'estadística', 'gráfico', 'tendencia'],
    patterns: [/analiza\s+(?:estos?\s+)?datos/i, /(?:haz|hazme)\s+(?:un\s+)?análisis/i],
    intent: 'DATA_ANALYSIS',
    priority: 9
  },
  {
    id: 'research',
    keywords: ['investiga', 'investigación', 'research', 'busca información', 'encuentra', 'artículos', 'papers', 'fuentes'],
    patterns: [/(?:investiga|busca)\s+(?:sobre|acerca\s+de|información)/i, /(?:encuentra|dame)\s+(?:artículos|papers|fuentes)/i],
    intent: 'RESEARCH',
    priority: 8
  },
  {
    id: 'comparison',
    keywords: ['compara', 'comparar', 'compare', 'diferencia', 'diferencias', 'versus', 'vs', 'mejor', 'peor'],
    patterns: [/compara\s+(?:.+)\s+(?:con|y|versus|vs)/i, /(?:cuál|cual)\s+es\s+(?:mejor|peor)/i, /diferencias?\s+entre/i],
    intent: 'COMPARISON',
    priority: 8
  },
  {
    id: 'creative_writing',
    keywords: ['historia', 'cuento', 'narrativa', 'ficción', 'story', 'tale', 'poema', 'poem', 'guión', 'script'],
    patterns: [/(?:escribe|crea|inventa)\s+(?:una?\s+)?(?:historia|cuento|narrativa|poema)/i],
    intent: 'CREATIVE_WRITING',
    priority: 7
  },
  {
    id: 'constrained_rewrite',
    keywords: ['reescribe', 'modifica', 'cambia', 'rewrite', 'modify', 'change', 'edita', 'edit', 'mejora', 'reemplaza', 'replace'],
    patterns: [/(?:reescribe|modifica|cambia|edita)\s+(?:solo|solamente|únicamente)?\s*(?:la|el|esto)/i, /(?:cambia|reemplaza)\s+(?:la|el)\s+(?:variable|palabra|parte)/i],
    intent: 'CONSTRAINED_REWRITE',
    priority: 8
  },
  {
    id: 'citation_format',
    keywords: ['citar', 'cita', 'citación', 'cite', 'citation', 'apa', 'mla', 'chicago', 'vancouver', 'ieee', 'harvard', 'iso 690', 'bibliografía', 'bibliography', 'referencia', 'referencias', 'reference'],
    patterns: [
      /(?:cit[ae]r?|format(?:ea|o)?)\s+(?:en\s+)?(?:apa|mla|chicago|vancouver|ieee|harvard)/i,
      /(?:formato|norma|estilo)\s+(?:apa|mla|chicago|vancouver|ieee|harvard)/i,
      /(?:apa|mla|chicago|vancouver|ieee|harvard)\s+(?:\d+(?:ma|th|va|ta)?\s+)?(?:edici[oó]n|edition)/i,
      /(?:genera|crea|haz|dame)\s+(?:la\s+)?(?:bibliografía|referencias|citas)/i,
    ],
    intent: 'CITATION_FORMAT',
    priority: 11
  },
  {
    id: 'academic_search',
    keywords: ['artículo', 'artículos', 'paper', 'papers', 'estudio', 'estudios', 'publicación', 'publicaciones', 'journal', 'revista científica', 'scholar', 'pubmed', 'scopus', 'tesis', 'thesis', 'disertación', 'peer-review', 'peer review'],
    patterns: [
      /(?:busca|encuentra|investiga)\s+(?:artículos?|papers?|estudios?|publicaciones?)\s+(?:sobre|de|acerca)/i,
      /(?:artículos?|papers?|estudios?)\s+(?:científicos?|académicos?|recientes?)/i,
      /(?:en|de)\s+(?:scholar|pubmed|scopus|scielo|arxiv|jstor)/i,
      /(?:base\s+de\s+datos\s+)?(?:académica|científica)/i,
      /(?:literatura|revisión\s+(?:de\s+)?literatura|estado\s+del\s+arte)/i,
    ],
    intent: 'ACADEMIC_SEARCH',
    priority: 10
  },
  {
    id: 'fact_check',
    keywords: ['verificar', 'verificación', 'verify', 'comprobar', 'fact-check', 'factcheck', 'cierto', 'verdad', 'falso', 'mito', 'confirmar'],
    patterns: [
      /(?:es\s+)?(?:cierto|verdad|falso|un\s+mito)\s+que/i,
      /(?:verifica|comprueba|confirma)\s+(?:si|que|esto)/i,
      /(?:fact.?check|verificación\s+de\s+(?:hechos|datos))/i,
    ],
    intent: 'FACT_CHECK',
    priority: 9
  }
];

export class IntentClassifier {
  private rules: IntentRule[];

  constructor() {
    this.rules = INTENT_RULES.sort((a, b) => b.priority - a.priority);
  }

  classify(input: NormalizedInput): IntentClassification {
    const text = input.cleanedText.toLowerCase();
    const matchedRules: string[] = [];
    let bestIntent: IntentType = 'GENERAL_CHAT';
    let bestScore = 0;

    for (const rule of this.rules) {
      let score = 0;

      for (const keyword of rule.keywords) {
        if (text.includes(keyword.toLowerCase())) {
          score += 2;
        }
      }

      for (const pattern of rule.patterns) {
        if (pattern.test(input.cleanedText)) {
          score += 5;
        }
      }

      if (score > 0) {
        score *= rule.priority / 10;
        
        if (score > bestScore) {
          bestScore = score;
          bestIntent = rule.intent;
          matchedRules.push(rule.id);
        }
      }
    }

    if (input.metadata.isQuestion && bestIntent === 'GENERAL_CHAT') {
      bestIntent = 'EXPLAIN';
    }

    const confidence = Math.min(bestScore / 15, 1);

    return {
      intent: bestIntent,
      confidence,
      matchedRules
    };
  }

  async classifyWithLLM(input: NormalizedInput, ruleBasedResult: IntentClassification): Promise<IntentClassification> {
    if (ruleBasedResult.confidence >= 0.7) {
      return ruleBasedResult;
    }

    return ruleBasedResult;
  }
}

export const intentClassifier = new IntentClassifier();
