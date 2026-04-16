import { 
  MultiIntentDetection, 
  MultiIntentDetectionSchema,
  TaskPlan,
  IntentType,
  MULTI_INTENT_THRESHOLD 
} from "../../../shared/schemas/multiIntent";

interface ConversationContext {
  messages: Array<{ role: string; content: string }>;
  userPreferences?: Record<string, any>;
  recentTasks?: string[];
}

const INTENT_PATTERNS: Record<IntentType, RegExp[]> = {
  search: [
    /\b(busca|buscar|encuentra|encontrar|search|find|look for|lookup)\b/i,
    /\b(qué es|what is|cuál es|which is|dime sobre|tell me about)\b/i
  ],
  analyze: [
    /\b(analiza|analyze|examina|examine|evalúa|evaluate|compara|compare)\b/i,
    /\b(analizar|análisis|analysis)\b/i
  ],
  generate: [
    /\b(genera|generate|crea|create|escribe|write|redacta|draft|haz|make)\b/i,
    /\b(diseña|design|construye|build)\b/i
  ],
  transform: [
    /\b(convierte|convert|transforma|transform|cambia|change|modifica|modify)\b/i,
    /\b(traduce|translate|reformatea|reformat)\b/i
  ],
  summarize: [
    /\b(resume|summarize|resumen|summary|sintetiza|synthesize)\b/i,
    /\b(breve|brief|conciso|concise|puntos clave|key points)\b/i
  ],
  extract: [
    /\b(extrae|extract|obtén|get|saca|pull out|identifica|identify)\b/i,
    /\b(lista|list|enumera|enumerate)\b/i
  ],
  navigate: [
    /\b(navega|navigate|ve a|go to|abre|open|visita|visit)\b/i,
    /\b(descarga|download|captura|capture|screenshot)\b/i
  ],
  chat: [
    /\b(hola|hello|hi|hey|gracias|thanks|oye|listen)\b/i
  ]
};

const SEPARATOR_PATTERNS = [
  /\b(y también|and also|además|also|luego|then|después|after that)\b/i,
  /\b(primero|first|segundo|second|tercero|third)\b/i,
  /\d+\s*[.)]\s*/,
  /[;]\s*/,
  /\n+/
];

const TASK_SPLIT_REGEX = /(?:^|\s)(?:primero|luego|después|segundo|tercero|cuarto|finalmente|por último|y también|además|then|first|second|third|finally|also)\s+/gi;

export class MultiIntentManager {
  async detectMultiIntent(
    message: string,
    context?: ConversationContext
  ): Promise<MultiIntentDetection> {
    const taskSegments = this.splitIntoTasks(message);
    const detectedIntents = this.analyzeIntents(message);
    const hasSeparators = this.detectSeparators(message);
    
    const taskCount = Math.max(taskSegments.length, detectedIntents.length);
    const intentCount = detectedIntents.length;
    
    let confidence = 0;
    
    if (taskCount > 1) {
      confidence = 0.5 + (Math.min(taskCount, 4) * 0.15);
    }
    
    if (hasSeparators && taskCount > 1) {
      confidence += 0.25;
    }
    
    if (message.length > 100 && taskCount > 1) {
      confidence += 0.1;
    }
    
    if (context?.messages && context.messages.length > 0) {
      const recentContext = this.analyzeRecentContext(context);
      if (recentContext.suggestsComplexTask) {
        confidence += 0.1;
      }
    }
    
    confidence = Math.min(confidence, 1);
    
    const isMultiIntent = confidence >= MULTI_INTENT_THRESHOLD && taskCount > 1;
    
    let suggestedPlan: TaskPlan[] | undefined;
    if (isMultiIntent) {
      if (taskSegments.length >= detectedIntents.length) {
        suggestedPlan = this.generateSuggestedPlanFromSegments(message, taskSegments);
      } else {
        suggestedPlan = this.generateSuggestedPlan(message, detectedIntents);
      }
    }
    
    return MultiIntentDetectionSchema.parse({
      isMultiIntent,
      confidence,
      detectedIntents,
      suggestedPlan
    });
  }
  
  private splitIntoTasks(message: string): string[] {
    const segments = message.split(TASK_SPLIT_REGEX)
      .map(s => s.trim())
      .filter(s => s.length > 5);
    
    if (segments.length <= 1) {
      const commaAndYSegments = message.split(/(?:,\s*|\s+y\s+)(?=(?:un(?:a|o)?\s+)?(?:crea|genera|haz|escribe|busca|analiza|resume|resumen|convierte|extrae|navega|abre|diseña|construye|imagen|tabla|lista|make|create|write|search|analyze|summarize|summary|transform|extract|navigate|open|design|build|image|table|list)\b)/i)
        .map(s => s.trim())
        .filter(s => s.length > 5);
      
      if (commaAndYSegments.length > 1) {
        return commaAndYSegments;
      }
    }
    
    return segments.length > 0 ? segments : [message];
  }
  
  private analyzeIntents(message: string): Array<{
    type: IntentType;
    description: string;
    keywords: string[];
  }> {
    const detected: Array<{
      type: IntentType;
      description: string;
      keywords: string[];
    }> = [];
    
    for (const [intentType, patterns] of Object.entries(INTENT_PATTERNS)) {
      const keywords: string[] = [];
      
      for (const pattern of patterns) {
        const matches = message.match(pattern);
        if (matches) {
          keywords.push(matches[0]);
        }
      }
      
      if (keywords.length > 0) {
        detected.push({
          type: intentType as IntentType,
          description: this.getIntentDescription(intentType as IntentType, message),
          keywords
        });
      }
    }
    
    return detected;
  }
  
  private detectSeparators(message: string): boolean {
    for (const pattern of SEPARATOR_PATTERNS) {
      if (pattern.test(message)) {
        return true;
      }
    }
    return false;
  }
  
  private analyzeRecentContext(context: ConversationContext): {
    suggestsComplexTask: boolean;
  } {
    const recentMessages = context.messages.slice(-3);
    const complexIndicators = [
      /\b(proyecto|project|tarea compleja|complex task)\b/i,
      /\b(varios pasos|multiple steps|proceso|process)\b/i
    ];
    
    for (const msg of recentMessages) {
      for (const indicator of complexIndicators) {
        if (indicator.test(msg.content)) {
          return { suggestsComplexTask: true };
        }
      }
    }
    
    return { suggestsComplexTask: false };
  }
  
  private getIntentDescription(type: IntentType, message: string): string {
    const descriptions: Record<IntentType, string> = {
      search: "Search for information",
      analyze: "Analyze data or content",
      generate: "Generate new content",
      transform: "Transform or convert content",
      summarize: "Summarize information",
      extract: "Extract specific data",
      navigate: "Navigate to web resources",
      chat: "General conversation"
    };
    return descriptions[type] || "Unknown intent";
  }
  
  private generateSuggestedPlanFromSegments(
    originalMessage: string,
    segments: string[]
  ): TaskPlan[] {
    const plan: TaskPlan[] = [];
    
    segments.forEach((segment, index) => {
      const intentType = this.detectIntentTypeForSegment(segment);
      const title = this.extractTaskTitle(segment);
      
      plan.push({
        id: `task_${index + 1}`,
        title,
        intentType,
        description: segment,
        requiredContext: [],
        executionMode: "sequential",
        dependencies: [],
        priority: segments.length - index
      });
    });
    
    return plan;
  }
  
  private detectIntentTypeForSegment(segment: string): IntentType {
    for (const [intentType, patterns] of Object.entries(INTENT_PATTERNS)) {
      for (const pattern of patterns) {
        if (pattern.test(segment)) {
          return intentType as IntentType;
        }
      }
    }
    return "generate";
  }
  
  private extractTaskTitle(segment: string): string {
    const cleanedSegment = segment
      .replace(/^(primero|luego|después|segundo|tercero|cuarto|finalmente|por último|y también|además|then|first|second|third|finally|also)\s*/i, '')
      .trim();
    
    const words = cleanedSegment.split(/\s+/).slice(0, 8);
    return words.join(' ') + (cleanedSegment.split(/\s+/).length > 8 ? '...' : '');
  }
  
  private generateSuggestedPlan(
    message: string,
    intents: Array<{ type: IntentType; description: string; keywords: string[] }>
  ): TaskPlan[] {
    const plan: TaskPlan[] = [];
    
    intents.forEach((intent, index) => {
      const hasDependent = index > 0 && this.intentsDependOnPrevious(intents[index - 1].type, intent.type);
      
      const relevantText = this.extractRelevantTextForIntent(message, intent.keywords);
      
      plan.push({
        id: `task_${index + 1}`,
        title: this.extractTaskTitle(relevantText),
        intentType: intent.type,
        description: relevantText,
        requiredContext: hasDependent ? [`task_${index}`] : [],
        executionMode: hasDependent ? "sequential" : "parallel",
        dependencies: hasDependent ? [`task_${index}`] : [],
        priority: intents.length - index
      });
    });
    
    return plan;
  }
  
  private extractRelevantTextForIntent(message: string, keywords: string[]): string {
    if (keywords.length === 0) return message;
    
    const keywordPattern = new RegExp(`(${keywords.map(k => k.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|')})`, 'i');
    const match = message.match(keywordPattern);
    
    if (!match || match.index === undefined) return message;
    
    const startIndex = match.index;
    const afterKeyword = message.slice(startIndex);
    
    const endMatch = afterKeyword.match(/[.,;]\s*(?=(?:crea|genera|haz|escribe|busca|analiza|resume|convierte|extrae|navega|abre|diseña|construye|investiga|make|create|write|search|analyze|summarize|transform|extract|navigate|open|design|build|investigate|y\s+(?:un|una|el|la))\b)/i);
    
    if (endMatch && endMatch.index !== undefined) {
      return afterKeyword.slice(0, endMatch.index).trim();
    }
    
    const sentenceEnd = afterKeyword.match(/[.!?]\s+(?=[A-ZÁÉÍÓÚÑ])/);
    if (sentenceEnd && sentenceEnd.index !== undefined) {
      return afterKeyword.slice(0, sentenceEnd.index + 1).trim();
    }
    
    return afterKeyword.trim();
  }
  
  private intentsDependOnPrevious(prev: IntentType, current: IntentType): boolean {
    const dependencyMap: Record<IntentType, IntentType[]> = {
      summarize: ["search", "extract", "navigate"],
      analyze: ["search", "extract", "navigate"],
      transform: ["search", "extract", "generate"],
      generate: ["search", "analyze"],
      extract: ["search", "navigate"],
      search: [],
      navigate: [],
      chat: []
    };
    
    return dependencyMap[current]?.includes(prev) ?? false;
  }
}

export const multiIntentManager = new MultiIntentManager();
