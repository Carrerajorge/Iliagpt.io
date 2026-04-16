import { ToolRegistryService, ToolDefinition, ToolCategory } from './toolRegistry';

export interface IntentMatch {
  toolId: string;
  confidence: number;
  reason: string;
}

export interface IntentResult {
  intent: string;
  matches: IntentMatch[];
  hasGap: boolean;
  gapReason?: string;
  complexity?: 'trivial' | 'simple' | 'complex';
  language?: string;
}

interface KeywordMapping {
  keywords: string[];
  category: ToolCategory;
  intentDescription: string;
}

interface CachedAnalysis {
  result: IntentResult;
  timestamp: number;
}

const KEYWORD_MAPPINGS: KeywordMapping[] = [
  {
    keywords: ['usuarios', 'users', 'user', 'usuario', 'crear usuario', 'create user', 'eliminar usuario', 'delete user', 'listar usuarios', 'list users', 'actualizar usuario', 'update user', 'nuevo usuario', 'new user'],
    category: 'users',
    intentDescription: 'User management'
  },
  {
    keywords: ['modelos', 'models', 'model', 'activar modelo', 'enable model', 'desactivar modelo', 'disable model', 'sincronizar modelos', 'sync models', 'ai', 'ia'],
    category: 'ai_models',
    intentDescription: 'AI Model management'
  },
  {
    keywords: ['reporte', 'report', 'reports', 'generar reporte', 'generate report', 'descargar reporte', 'download report', 'plantillas', 'templates', 'exportar', 'export'],
    category: 'reports',
    intentDescription: 'Report generation'
  },
  {
    keywords: ['seguridad', 'security', 'políticas', 'policies', 'policy', 'audit', 'auditoría', 'alertas', 'alerts', 'logs'],
    category: 'security',
    intentDescription: 'Security management'
  },
  {
    keywords: ['configuración', 'configuration', 'settings', 'ajustes', 'config', 'preferencias', 'preferences'],
    category: 'settings',
    intentDescription: 'Settings configuration'
  },
  {
    keywords: ['base de datos', 'database', 'db', 'tablas', 'tables', 'query', 'consulta', 'índices', 'indexes', 'sql'],
    category: 'database',
    intentDescription: 'Database operations'
  },
  {
    keywords: ['métricas', 'metrics', 'analytics', 'analíticas', 'estadísticas', 'statistics', 'dashboard', 'kpi', 'rendimiento', 'performance'],
    category: 'analytics',
    intentDescription: 'Analytics and metrics'
  },
  {
    keywords: ['pagos', 'payments', 'payment', 'facturación', 'billing', 'invoices', 'facturas', 'transacciones', 'transactions'],
    category: 'payments',
    intentDescription: 'Payment management'
  }
];

const ACTION_KEYWORDS: Record<string, string[]> = {
  list: ['listar', 'list', 'ver', 'view', 'mostrar', 'show', 'obtener', 'get', 'todos', 'all'],
  create: ['crear', 'create', 'nuevo', 'new', 'agregar', 'add', 'insertar', 'insert'],
  update: ['actualizar', 'update', 'modificar', 'modify', 'editar', 'edit', 'cambiar', 'change'],
  delete: ['eliminar', 'delete', 'borrar', 'remove', 'quitar'],
  enable: ['activar', 'enable', 'habilitar', 'encender', 'turn on'],
  disable: ['desactivar', 'disable', 'deshabilitar', 'apagar', 'turn off'],
  generate: ['generar', 'generate', 'crear reporte', 'create report', 'exportar', 'export'],
  sync: ['sincronizar', 'sync', 'synchronize', 'actualizar modelos', 'refresh']
};

export class IntentToolMapper {
  private toolRegistry: ToolRegistryService;

  private static readonly TRIVIAL_PATTERNS = /^(hola|gracias|ok|sí|si|no|bye|adios|chao)$/i;
  private static readonly SIMPLE_PATTERNS = /(qué es|define|traduce|cuánto es|what is|how to)/i;
  private static readonly ADMIN_PATTERNS = /(crear|delete|update|list|enable|disable|generar|export)/i;

  private readonly LANGUAGE_PATTERNS: Record<string, RegExp[]> = {
    es: [/\b(qué|cómo|cuándo|dónde|crear|usuario|hola|gracias|sistema)\b/i],
    en: [/\b(what|how|when|where|create|user|hello|thanks|system)\b/i],
    fr: [/\b(quoi|comment|quand|où|créer|utilisateur|bonjour|merci)\b/i],
    de: [/\b(was|wie|wann|wo|erstellen|benutzer|hallo|danke)\b/i],
    pt: [/\b(que|como|quando|onde|criar|usuário|olá|obrigado)\b/i]
  };

  private analysisCache: Map<string, CachedAnalysis> = new Map();
  private readonly CACHE_TTL_MS = 5 * 60 * 1000;

  constructor(toolRegistry: ToolRegistryService) {
    this.toolRegistry = toolRegistry;
  }

  detectLanguage(prompt: string): string {
    const lower = prompt.toLowerCase();
    const scores: Record<string, number> = { es: 0, en: 0, fr: 0, de: 0, pt: 0 };

    for (const [lang, patterns] of Object.entries(this.LANGUAGE_PATTERNS)) {
      for (const pattern of patterns) {
        const matches = lower.match(pattern);
        if (matches) scores[lang] += matches.length;
      }
    }

    const best = Object.entries(scores).sort((a, b) => b[1] - a[1])[0];
    return best[1] > 0 ? best[0] : 'en';
  }

  private fastPath(prompt: string): { skip: boolean; complexity: 'trivial' | 'simple' | 'complex' } {
    if (IntentToolMapper.TRIVIAL_PATTERNS.test(prompt)) {
      return { skip: true, complexity: 'trivial' };
    }
    if (IntentToolMapper.SIMPLE_PATTERNS.test(prompt) && !IntentToolMapper.ADMIN_PATTERNS.test(prompt)) {
      return { skip: true, complexity: 'simple' };
    }
    return { skip: false, complexity: 'complex' };
  }

  private getCacheKey(prompt: string): string {
    let hash = 0;
    for (let i = 0; i < prompt.length; i++) {
      const char = prompt.charCodeAt(i);
      hash = ((hash << 5) - hash) + char;
      hash = hash & hash;
    }
    return `intent_${hash}`;
  }

  private getFromCache(prompt: string): IntentResult | null {
    const key = this.getCacheKey(prompt);
    const cached = this.analysisCache.get(key);
    if (cached && Date.now() - cached.timestamp < this.CACHE_TTL_MS) {
      return cached.result;
    }
    if (cached) {
      this.analysisCache.delete(key);
    }
    return null;
  }

  private setCache(prompt: string, result: IntentResult): void {
    const key = this.getCacheKey(prompt);
    this.analysisCache.set(key, { result, timestamp: Date.now() });
    if (this.analysisCache.size > 1000) {
      const firstKey = this.analysisCache.keys().next().value;
      if (firstKey) this.analysisCache.delete(firstKey);
    }
  }

  map(userPrompt: string): IntentResult {
    const language = this.detectLanguage(userPrompt);
    const fastResult = this.fastPath(userPrompt);
    
    if (fastResult.skip) {
      return {
        intent: 'Conversational',
        matches: [],
        hasGap: false,
        complexity: fastResult.complexity,
        language
      };
    }

    const cached = this.getFromCache(userPrompt);
    if (cached) {
      return { ...cached, language };
    }

    const normalizedPrompt = userPrompt.toLowerCase().trim();
    const matches: IntentMatch[] = [];
    let detectedCategory: ToolCategory | null = null;
    let intentDescription = 'Unknown intent';

    for (const mapping of KEYWORD_MAPPINGS) {
      for (const keyword of mapping.keywords) {
        if (normalizedPrompt.includes(keyword)) {
          detectedCategory = mapping.category;
          intentDescription = mapping.intentDescription;
          break;
        }
      }
      if (detectedCategory) break;
    }

    if (detectedCategory) {
      const categoryTools = this.toolRegistry.getToolsByCategory(detectedCategory);
      const action = this.detectAction(normalizedPrompt);

      for (const tool of categoryTools) {
        const confidence = this.calculateConfidence(normalizedPrompt, tool, action);
        if (confidence > 0) {
          matches.push({
            toolId: tool.id,
            confidence,
            reason: this.generateReason(tool, action)
          });
        }
      }

      matches.sort((a, b) => b.confidence - a.confidence);
    }

    const bestMatch = matches[0];
    const hasGap = !bestMatch || bestMatch.confidence < 0.3;

    const result: IntentResult = {
      intent: intentDescription,
      matches,
      hasGap,
      gapReason: hasGap 
        ? this.generateGapReason(normalizedPrompt, detectedCategory) 
        : undefined,
      complexity: 'complex',
      language
    };

    this.setCache(userPrompt, result);
    return result;
  }

  private detectAction(prompt: string): string | null {
    for (const [action, keywords] of Object.entries(ACTION_KEYWORDS)) {
      if (keywords.some(k => prompt.includes(k))) {
        return action;
      }
    }
    return null;
  }

  private calculateConfidence(prompt: string, tool: ToolDefinition, action: string | null): number {
    let confidence = 0.1;

    for (const capability of tool.capabilities) {
      if (prompt.includes(capability.toLowerCase())) {
        confidence += 0.4;
        break;
      }
    }

    if (tool.name.toLowerCase().split(' ').some(word => prompt.includes(word))) {
      confidence += 0.2;
    }

    if (action) {
      const toolAction = tool.id.split('_')[0];
      const actionMatch = 
        (action === 'list' && toolAction === 'list') ||
        (action === 'create' && (toolAction === 'create' || toolAction === 'generate')) ||
        (action === 'update' && (toolAction === 'update' || toolAction === 'bulk')) ||
        (action === 'delete' && toolAction === 'delete') ||
        (action === 'enable' && toolAction === 'enable') ||
        (action === 'disable' && toolAction === 'disable') ||
        (action === 'generate' && (toolAction === 'generate' || toolAction === 'download')) ||
        (action === 'sync' && toolAction === 'sync');

      if (actionMatch) {
        confidence += 0.3;
      }
    }

    return Math.min(confidence, 1);
  }

  private generateReason(tool: ToolDefinition, action: string | null): string {
    if (action) {
      return `Matched '${action}' action to ${tool.name}`;
    }
    return `Category match: ${tool.name} (${tool.category})`;
  }

  private generateGapReason(prompt: string, category: ToolCategory | null): string {
    if (!category) {
      return `No category could be determined from the prompt: "${prompt.substring(0, 50)}..."`;
    }
    return `Intent detected for '${category}' category but no specific tool matched with high confidence. The request may require a new capability.`;
  }
}
