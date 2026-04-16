const EMAIL_KEYWORDS = [
  'correo', 'correos', 'email', 'emails', 'mail', 'mails',
  'inbox', 'bandeja', 'mensaje', 'mensajes',
  'gmail', 'correspondencia'
];

const EMAIL_ACTION_VERBS = [
  'buscar', 'busca', 'leer', 'lee', 'revisar', 'revisa',
  'responder', 'responde', 'enviar', 'envía', 'mostrar', 'muestra',
  'search', 'read', 'check', 'reply', 'send', 'show', 'find', 'list'
];

const EMAIL_FILTERS = [
  'no leídos', 'no leidos', 'unread', 'sin leer',
  'importantes', 'important', 'starred', 'destacados',
  'recientes', 'recent', 'últimos', 'últimas'
];

export interface GmailIntentResult {
  hasGmailIntent: boolean;
  confidence: 'high' | 'medium' | 'low' | 'none';
  mentionDetected: boolean;
  keywordsFound: string[];
  suggestedAction: 'search' | 'read' | 'list' | 'reply' | 'none';
  searchQuery?: string;
  filters?: string[];
}

export function detectGmailIntent(
  prompt: string,
  isGmailActive: boolean,
  hasMention: boolean
): GmailIntentResult {
  const lowerPrompt = prompt.toLowerCase();
  
  if (hasMention || lowerPrompt.includes('@gmail')) {
    const extractedQuery = extractSearchQuery(prompt);
    return {
      hasGmailIntent: true,
      confidence: 'high',
      mentionDetected: true,
      keywordsFound: ['@Gmail'],
      suggestedAction: 'search',
      searchQuery: extractedQuery,
      filters: extractFilters(lowerPrompt)
    };
  }
  
  if (!isGmailActive) {
    return {
      hasGmailIntent: false,
      confidence: 'none',
      mentionDetected: false,
      keywordsFound: [],
      suggestedAction: 'none'
    };
  }
  
  const foundKeywords: string[] = [];
  let hasActionVerb = false;
  let hasEmailNoun = false;
  let suggestedAction: GmailIntentResult['suggestedAction'] = 'none';
  
  for (const keyword of EMAIL_KEYWORDS) {
    if (lowerPrompt.includes(keyword)) {
      foundKeywords.push(keyword);
      hasEmailNoun = true;
    }
  }
  
  for (const verb of EMAIL_ACTION_VERBS) {
    if (lowerPrompt.includes(verb)) {
      hasActionVerb = true;
      foundKeywords.push(verb);
      
      if (['buscar', 'busca', 'search', 'find'].includes(verb)) {
        suggestedAction = 'search';
      } else if (['leer', 'lee', 'read', 'revisar', 'revisa', 'check'].includes(verb)) {
        suggestedAction = 'read';
      } else if (['responder', 'responde', 'reply'].includes(verb)) {
        suggestedAction = 'reply';
      } else if (['mostrar', 'muestra', 'show', 'list'].includes(verb)) {
        suggestedAction = 'list';
      }
      break;
    }
  }
  
  if (hasActionVerb && hasEmailNoun) {
    return {
      hasGmailIntent: true,
      confidence: 'high',
      mentionDetected: false,
      keywordsFound: foundKeywords,
      suggestedAction: suggestedAction || 'list',
      searchQuery: extractSearchQuery(prompt),
      filters: extractFilters(lowerPrompt)
    };
  }
  
  if (hasEmailNoun && foundKeywords.length >= 2) {
    return {
      hasGmailIntent: true,
      confidence: 'medium',
      mentionDetected: false,
      keywordsFound: foundKeywords,
      suggestedAction: 'list',
      filters: extractFilters(lowerPrompt)
    };
  }
  
  if (foundKeywords.length > 0) {
    return {
      hasGmailIntent: false,
      confidence: 'low',
      mentionDetected: false,
      keywordsFound: foundKeywords,
      suggestedAction: 'none'
    };
  }
  
  return {
    hasGmailIntent: false,
    confidence: 'none',
    mentionDetected: false,
    keywordsFound: [],
    suggestedAction: 'none'
  };
}

function extractSearchQuery(prompt: string): string {
  const patterns = [
    /(?:buscar?|busca|search|find)\s+(?:correos?|emails?|mensajes?)?\s*(?:de|from|sobre|about)?\s*["']?([^"'\n]+)["']?/i,
    /(?:correos?|emails?|mensajes?)\s+(?:de|from)\s+["']?([^"'\n]+)["']?/i,
    /@gmail\s+(.+)/i
  ];
  
  for (const pattern of patterns) {
    const match = prompt.match(pattern);
    if (match && match[1]) {
      return match[1].trim();
    }
  }
  
  return '';
}

function extractFilters(prompt: string): string[] {
  const filters: string[] = [];
  
  for (const filter of EMAIL_FILTERS) {
    if (prompt.includes(filter)) {
      if (['no leídos', 'no leidos', 'unread', 'sin leer'].includes(filter)) {
        if (!filters.includes('UNREAD')) filters.push('UNREAD');
      } else if (['importantes', 'important'].includes(filter)) {
        if (!filters.includes('IMPORTANT')) filters.push('IMPORTANT');
      } else if (['destacados', 'starred'].includes(filter)) {
        if (!filters.includes('STARRED')) filters.push('STARRED');
      }
    }
  }
  
  return filters;
}
