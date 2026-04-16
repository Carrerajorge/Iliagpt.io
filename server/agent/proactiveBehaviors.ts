/**
 * Proactive agent behaviors — anticipates user needs and offers help.
 * Detects patterns in AI responses and conversation context to surface
 * at most 2 relevant suggestions, ranked by priority * confidence.
 */
export interface ProactiveAction {
  type: 'suggest_tool' | 'offer_help' | 'warn' | 'remind' | 'optimize';
  title: string;
  description?: string;
  action?: string;
  priority: number;   // 1-10, higher = more important
  confidence: number; // 0-1
}

// --- Detection helpers (exported for testing / reuse) ---

const NUMBER_RE = /(?<!\w)(?:\d{1,3}(?:[.,]\d{3})*(?:[.,]\d+)?|\d+(?:[.,]\d+)?)%?(?!\w)/g;
const TABLE_RE = /[|┃┆─┄━┅]+|(\t\S+){2,}/;
const CODE_BLOCK_RE = /```[\s\S]*?```|`[^`]+`/;
const CODE_KW_RE = /\b(?:function|const|let|var|class|import|export|def|return|if|for|while)\b/;

export function hasDataInResponse(text: string): boolean {
  const nums = text.match(NUMBER_RE);
  if (nums && nums.length >= 3) return true;
  if (TABLE_RE.test(text)) return true;
  return text.includes('%') && !!nums && nums.length >= 2;
}

export function detectCodeBlocks(text: string): boolean {
  if (CODE_BLOCK_RE.test(text)) return true;
  return text.split('\n').filter(l => CODE_KW_RE.test(l)).length >= 3;
}

export function isShortAnswer(text: string, question: string): boolean {
  const clean = text.replace(/```[\s\S]*?```/g, '').trim();
  if (clean.length >= 200) return false;
  const complex = /\b(cómo|como|por qué|porqué|porque|explica|analiza|compara|describe|what|how|why|explain|analyze|compare|describe)\b/i;
  return question.length > 60 || complex.test(question);
}

// --- Internal types ---

type Opts = {
  userMessage: string;
  aiResponse: string;
  intent: string;
  conversationLength: number;
  hasAttachments: boolean;
  attachmentTypes?: string[];
  locale: string;
};

const es = (locale: string) => locale.startsWith('es');
const t = (locale: string, spa: string, eng: string) => es(locale) ? spa : eng;

// --- Detectors (each returns 0 or 1 action) ---

function detectDataViz(o: Opts): ProactiveAction | null {
  if (!hasDataInResponse(o.aiResponse)) return null;
  return {
    type: 'suggest_tool', priority: 7, confidence: 0.75,
    title: t(o.locale, 'Puedo crear un gráfico con estos datos', 'I can create a chart with this data'),
    description: t(o.locale, 'Detecté que hay números o datos. ¿Quieres que los visualice?', 'I detected numbers or data. Want me to visualize them?'),
    action: t(o.locale, 'Crea un gráfico con los datos anteriores', 'Create a chart with the data above'),
  };
}

function detectDocConversion(o: Opts): ProactiveAction | null {
  const resp = o.aiResponse.toLowerCase();
  const intent = o.intent.toLowerCase();
  if (resp.includes('word') || resp.includes('.docx') || intent.includes('word'))
    return {
      type: 'suggest_tool', priority: 5, confidence: 0.7,
      title: t(o.locale, '¿Lo quieres en otro formato?', 'Want it in another format?'),
      description: t(o.locale, '¿Lo quieres también en PDF o PowerPoint?', 'Do you also want it as PDF or PowerPoint?'),
      action: t(o.locale, 'Conviértelo a PDF', 'Convert it to PDF'),
    };
  if (resp.includes('excel') || resp.includes('.xlsx') || intent.includes('excel'))
    return {
      type: 'suggest_tool', priority: 5, confidence: 0.65,
      title: t(o.locale, '¿Necesitas un gráfico o resumen?', 'Need a chart or summary?'),
      description: t(o.locale, 'Puedo generar un gráfico o resumen de la hoja de cálculo.', 'I can generate a chart or summary from the spreadsheet.'),
      action: t(o.locale, 'Crea un gráfico con los datos del Excel', 'Create a chart from the Excel data'),
    };
  if (resp.includes('powerpoint') || resp.includes('.pptx') || intent.includes('ppt'))
    return {
      type: 'suggest_tool', priority: 4, confidence: 0.65,
      title: t(o.locale, '¿Lo quieres como PDF?', 'Want it as PDF?'),
      description: t(o.locale, '¿Lo quieres como PDF para compartir más fácilmente?', 'Want it as PDF for easier sharing?'),
      action: t(o.locale, 'Conviértelo a PDF', 'Convert it to PDF'),
    };
  return null;
}

function detectCodeImprovement(o: Opts): ProactiveAction | null {
  if (!detectCodeBlocks(o.aiResponse)) return null;
  return {
    type: 'optimize', priority: 6, confidence: 0.7,
    title: t(o.locale, '¿Quieres mejorar este código?', 'Want to improve this code?'),
    description: t(o.locale, '¿Quieres que agregue tests o lo optimice para mejor rendimiento?', 'Want me to add tests or optimize it for better performance?'),
    action: t(o.locale, 'Agrega tests para este código', 'Add tests for this code'),
  };
}

function detectResearchDeepening(o: Opts): ProactiveAction | null {
  if (!isShortAnswer(o.aiResponse, o.userMessage)) return null;
  return {
    type: 'offer_help', priority: 6, confidence: 0.6,
    title: t(o.locale, 'Puedo investigar más a fondo', 'I can research this more deeply'),
    description: t(o.locale, 'Puedo investigar más a fondo con fuentes académicas.', 'I can do deeper research with academic sources.'),
    action: t(o.locale, 'Investiga esto con más detalle y fuentes académicas', 'Research this in more detail with academic sources'),
  };
}

function detectFileAnalysis(o: Opts): ProactiveAction | null {
  if (!o.hasAttachments) return null;
  if (/\b(anali[zs]|revis|examin|resume|review|analyz|extract|summar|parse|read)\b/i.test(o.userMessage)) return null;
  const hint = o.attachmentTypes?.length ? ` (${o.attachmentTypes.join(', ')})` : '';
  return {
    type: 'offer_help', priority: 7, confidence: 0.8,
    title: t(o.locale, 'Detecté que subiste un archivo', 'I noticed you uploaded a file'),
    description: t(o.locale, `Detecté que subiste un archivo${hint}. ¿Quieres que lo analice?`, `I noticed you uploaded a file${hint}. Want me to analyze it?`),
    action: t(o.locale, 'Analiza el archivo que subí', 'Analyze the file I uploaded'),
  };
}

function detectTranslation(o: Opts): ProactiveAction | null {
  if (o.aiResponse.length < 500) return null;
  return {
    type: 'offer_help', priority: 3, confidence: 0.5,
    title: t(o.locale, '¿Necesitas esto en inglés?', '¿Necesitas esto en español?'),
    description: t(o.locale, 'Puedo traducir esta respuesta al inglés si lo necesitas.', 'I can translate this response to Spanish if you need.'),
    action: t(o.locale, 'Tradúcelo al inglés', 'Translate it to Spanish'),
  };
}

function detectSummary(o: Opts): ProactiveAction | null {
  if (o.conversationLength <= 10) return null;
  return {
    type: 'remind', priority: 4, confidence: 0.65,
    title: t(o.locale, '¿Quieres un resumen de la conversación?', 'Want a conversation summary?'),
    description: t(o.locale, 'La conversación es larga. ¿Quieres un resumen de lo que hemos hablado?', 'The conversation is getting long. Want a summary of what we discussed?'),
    action: t(o.locale, 'Resume la conversación', 'Summarize the conversation'),
  };
}

function detectErrorRecovery(o: Opts): ProactiveAction | null {
  const resp = o.aiResponse.toLowerCase();
  const weak = [
    'no estoy seguro', "i'm not sure", 'no tengo información', "i don't have information",
    'podría estar equivocado', 'i might be wrong', 'lo siento, no puedo', "sorry, i can't",
    'no tengo acceso', "i don't have access", 'no puedo confirmar', 'i cannot confirm',
  ];
  if (!weak.some(s => resp.includes(s))) return null;
  return {
    type: 'warn', priority: 8, confidence: 0.7,
    title: t(o.locale, 'Mi respuesta pudo ser incompleta', 'My response may have been incomplete'),
    description: t(o.locale, 'Mi respuesta anterior pudo ser incompleta. ¿Quieres que busque más información?', 'My previous response may have been incomplete. Want me to search for more?'),
    action: t(o.locale, 'Busca más información sobre esto', 'Search for more information about this'),
  };
}

// --- Main entry point ---

const DETECTORS = [
  detectFileAnalysis, detectErrorRecovery, detectDataViz, detectCodeImprovement,
  detectResearchDeepening, detectDocConversion, detectSummary, detectTranslation,
];

export function detectProactiveActions(opts: Opts): ProactiveAction[] {
  const actions: ProactiveAction[] = [];
  for (const fn of DETECTORS) {
    const a = fn(opts);
    if (a) actions.push(a);
  }
  return actions
    .sort((a, b) => b.priority * b.confidence - a.priority * a.confidence)
    .slice(0, 2);
}
