/**
 * ContextDetector.ts
 * Analyzes message content to detect the appropriate UI context/mode.
 */

export enum ContextType {
  CHAT = 'CHAT',
  CODE = 'CODE',
  DOCUMENT = 'DOCUMENT',
  RESEARCH = 'RESEARCH',
  DATA = 'DATA',
  CANVAS = 'CANVAS',
  CREATIVE = 'CREATIVE',
}

export interface ContextSignals {
  type: ContextType;
  confidence: number;
  signals: string[];
}

interface PatternMap {
  patterns: RegExp[];
  keywords: string[];
  weight: number;
}

interface MessageInput {
  role: 'user' | 'assistant' | 'system';
  content: string;
}

const CODE_PATTERNS: PatternMap = {
  patterns: [
    /```[\w]*\n[\s\S]+?```/g,
    /import\s+[\w{},\s]+\s+from\s+['"`]/g,
    /function\s+\w+\s*\(/g,
    /const\s+\w+\s*=\s*(?:async\s+)?\(/g,
    /class\s+\w+(?:\s+extends\s+\w+)?/g,
    /def\s+\w+\s*\(/g,
    /\bpublic\s+(?:static\s+)?(?:void|int|String|bool)\b/g,
    /\b(?:let|var|const)\s+\w+\s*[:=]/g,
    /\bif\s*\(.*\)\s*\{/g,
    /\bfor\s*\(.*\)\s*\{/g,
    /=>|->|\.\.\.|::/g,
    /npm\s+(?:install|run|start|build)/g,
    /git\s+(?:commit|push|pull|clone)/g,
    /#include\s*<[\w.]+>/g,
    /\bpip\s+install\b/g,
  ],
  keywords: [
    'debug', 'error', 'exception', 'stack trace', 'compile', 'syntax',
    'algorithm', 'recursion', 'loop', 'array', 'object', 'interface',
    'typescript', 'javascript', 'python', 'java', 'rust', 'golang',
    'api', 'endpoint', 'database', 'query', 'sql', 'regex', 'async',
    'await', 'promise', 'callback', 'middleware', 'framework', 'library',
    'package', 'module', 'component', 'hook', 'state', 'props',
  ],
  weight: 1.4,
};

const DOCUMENT_PATTERNS: PatternMap = {
  patterns: [
    /\b(?:write|draft|compose|create)\s+(?:a|an|the)\s+(?:document|report|letter|email|essay|article|proposal|memo|brief)/gi,
    /\b(?:introduction|conclusion|abstract|summary|paragraph|section|chapter)\b/gi,
    /\b(?:formal|professional|academic|technical)\s+(?:writing|document|report|letter)/gi,
    /\b(?:proofread|edit|revise|rewrite|format)\b/gi,
  ],
  keywords: [
    'essay', 'write', 'draft', 'document', 'report', 'letter', 'email',
    'article', 'blog', 'proposal', 'memo', 'brief', 'paragraph',
    'introduction', 'conclusion', 'outline', 'thesis', 'abstract',
    'proofread', 'edit', 'revise', 'rewrite', 'format', 'structure',
    'grammar', 'spelling', 'punctuation', 'tone', 'style',
    'heading', 'bullet', 'section', 'chapter', 'citation', 'reference',
  ],
  weight: 1.2,
};

const RESEARCH_PATTERNS: PatternMap = {
  patterns: [
    /\b(?:find|search|look up|look for|research|investigate)\s+(?:information|data|articles|papers|sources)\b/gi,
    /\b(?:what is|what are|who is|who are|when did|where is|how does|why does)\b/gi,
    /\b(?:compare|contrast|difference between|similarities between)\b/gi,
    /\b(?:pros and cons|advantages and disadvantages|benefits and drawbacks)\b/gi,
    /\b(?:overview|explanation|definition|history|background)\b/gi,
  ],
  keywords: [
    'find', 'search', 'research', 'investigate', 'explore', 'discover',
    'information', 'facts', 'evidence', 'source', 'citation', 'reference',
    'compare', 'contrast', 'analyze', 'evaluate', 'assess', 'review',
    'what is', 'explain', 'overview', 'history', 'background', 'context',
    'definition', 'meaning', 'concept', 'theory', 'hypothesis',
    'paper', 'study', 'journal', 'article', 'publication', 'academic',
  ],
  weight: 1.0,
};

const DATA_PATTERNS: PatternMap = {
  patterns: [
    /\b(?:chart|graph|plot|visualize|visualization)\b/gi,
    /\b(?:csv|excel|spreadsheet|dataset|dataframe)\b/gi,
    /\b(?:statistics|statistical|regression|correlation|variance|deviation)\b/gi,
    /\b(?:analyze|analyse)\s+(?:data|results|metrics|numbers|figures)\b/gi,
    /\b\d+(?:\.\d+)?%/g,
    /\b(?:average|mean|median|mode|sum|total|count)\b/gi,
  ],
  keywords: [
    'chart', 'graph', 'plot', 'visualize', 'visualization', 'diagram',
    'csv', 'excel', 'spreadsheet', 'dataset', 'dataframe', 'table',
    'statistics', 'statistical', 'regression', 'correlation', 'variance',
    'analyze data', 'data analysis', 'metrics', 'kpi', 'dashboard',
    'percentage', 'average', 'mean', 'median', 'trend', 'forecast',
    'bar chart', 'pie chart', 'line graph', 'scatter plot', 'histogram',
    'survey', 'results', 'findings', 'numbers', 'figures',
  ],
  weight: 1.3,
};

const CREATIVE_PATTERNS: PatternMap = {
  patterns: [
    /\b(?:write|create|compose)\s+(?:a|an)\s+(?:story|poem|song|script|novel|narrative|tale)\b/gi,
    /\b(?:creative|fictional|imaginative|fantastical)\b/gi,
    /\b(?:character|plot|setting|theme|conflict|resolution)\b/gi,
    /\b(?:once upon a time|in a world where|imagine if)\b/gi,
    /\b(?:rhyme|stanza|verse|chorus|metaphor|simile|alliteration)\b/gi,
  ],
  keywords: [
    'story', 'poem', 'creative', 'imagine', 'fiction', 'narrative',
    'novel', 'character', 'plot', 'setting', 'fantasy', 'sci-fi',
    'screenplay', 'script', 'dialogue', 'monologue', 'verse', 'stanza',
    'rhyme', 'metaphor', 'simile', 'imagery', 'tone', 'mood',
    'protagonist', 'antagonist', 'conflict', 'resolution', 'climax',
    'creative writing', 'storytelling', 'world-building', 'genre',
  ],
  weight: 1.1,
};

const CANVAS_PATTERNS: PatternMap = {
  patterns: [
    /\b(?:draw|sketch|design|create)\s+(?:a|an)\s+(?:diagram|flowchart|wireframe|mockup|layout|canvas)\b/gi,
    /\b(?:ui|ux|interface|wireframe|prototype|mockup)\b/gi,
    /\b(?:flowchart|mind map|diagram|architecture|layout)\b/gi,
  ],
  keywords: [
    'draw', 'sketch', 'diagram', 'flowchart', 'wireframe', 'mockup',
    'canvas', 'design', 'layout', 'ui', 'ux', 'interface', 'prototype',
    'mind map', 'architecture diagram', 'sequence diagram', 'class diagram',
    'visual', 'illustration', 'graphic', 'whiteboard',
  ],
  weight: 1.1,
};

export class ContextDetector {
  private readonly patternMaps: Map<ContextType, PatternMap> = new Map([
    [ContextType.CODE, CODE_PATTERNS],
    [ContextType.DOCUMENT, DOCUMENT_PATTERNS],
    [ContextType.RESEARCH, RESEARCH_PATTERNS],
    [ContextType.DATA, DATA_PATTERNS],
    [ContextType.CREATIVE, CREATIVE_PATTERNS],
    [ContextType.CANVAS, CANVAS_PATTERNS],
  ]);

  private scoreContext(
    text: string,
    patternMap: PatternMap,
    contextType: ContextType
  ): { score: number; signals: string[] } {
    const lowerText = text.toLowerCase();
    const signals: string[] = [];
    let rawScore = 0;

    // Pattern matching (higher weight)
    for (const pattern of patternMap.patterns) {
      const matches = text.match(pattern);
      if (matches && matches.length > 0) {
        rawScore += Math.min(matches.length * 0.15, 0.4);
        signals.push(`pattern:${pattern.source.substring(0, 30)}...`);
      }
    }

    // Keyword matching
    let keywordHits = 0;
    for (const keyword of patternMap.keywords) {
      if (lowerText.includes(keyword.toLowerCase())) {
        keywordHits++;
        signals.push(`keyword:${keyword}`);
      }
    }

    const keywordScore = (keywordHits / patternMap.keywords.length) * 0.8;
    rawScore += keywordScore;

    // Apply weight
    const weightedScore = Math.min(rawScore * patternMap.weight, 1.0);

    return { score: weightedScore, signals: signals.slice(0, 10) };
  }

  detect(messages: MessageInput[]): ContextSignals {
    if (!messages || messages.length === 0) {
      return {
        type: ContextType.CHAT,
        confidence: 0,
        signals: [],
      };
    }

    // Prioritize recent messages (last 5), weight them more heavily
    const recentMessages = messages.slice(-5);
    const olderMessages = messages.slice(0, -5);

    const recentText = recentMessages.map((m) => m.content).join('\n');
    const olderText = olderMessages.map((m) => m.content).join('\n');
    const combinedText = `${recentText}\n\n${olderText}`;

    const scores = new Map<ContextType, { score: number; signals: string[] }>();

    for (const [contextType, patternMap] of this.patternMaps) {
      const recentResult = this.scoreContext(recentText, patternMap, contextType);
      const olderResult = this.scoreContext(olderText, patternMap, contextType);

      // Recent messages weighted 70%, older 30%
      const combinedScore = recentResult.score * 0.7 + olderResult.score * 0.3;
      const allSignals = [...new Set([...recentResult.signals, ...olderResult.signals])];

      scores.set(contextType, { score: Math.min(combinedScore, 1.0), signals: allSignals });
    }

    // Find the highest scoring context
    let bestType = ContextType.CHAT;
    let bestScore = 0;
    let bestSignals: string[] = [];

    for (const [contextType, result] of scores) {
      if (result.score > bestScore) {
        bestScore = result.score;
        bestType = contextType;
        bestSignals = result.signals;
      }
    }

    // Only switch from CHAT if confidence is above a threshold
    const CONFIDENCE_THRESHOLD = 0.15;
    if (bestScore < CONFIDENCE_THRESHOLD) {
      return {
        type: ContextType.CHAT,
        confidence: 1 - bestScore,
        signals: ['default:chat'],
      };
    }

    return {
      type: bestType,
      confidence: bestScore,
      signals: bestSignals,
    };
  }
}
