export interface ComplexityResult {
  score: number;
  category: 'trivial' | 'simple' | 'moderate' | 'complex' | 'architectural';
  signals: string[];
  recommended_path: 'fast' | 'standard' | 'orchestrated' | 'architect';
  estimated_tokens: number;
  dimensions: {
    cognitive_load: number;
    domain_breadth: number;
    steps_required: number;
    ambiguity_level: number;
    technical_depth: number;
  };
  agent_required: boolean;
  agent_reason?: string;
}

export class ComplexityAnalyzer {
  private cache: Map<string, {result: ComplexityResult, timestamp: number}> = new Map();
  private readonly CACHE_TTL_MS = 5 * 60 * 1000;

  private readonly TRIVIAL_PATTERNS = [
    /^(hola|hi|hello|hey|buenos días|buenas tardes|buenas noches|good morning|good afternoon|good evening)[\s!?.,]*$/i,
    /^(gracias|thanks|thank you|thx|ty|muchas gracias)[\s!?.,]*$/i,
    /^(ok|okay|sí|si|yes|no|nope|vale|bien|bueno|sure|got it)[\s!?.,]*$/i,
    /^(adiós|bye|goodbye|chao|hasta luego|see you)[\s!?.,]*$/i
  ];

  private readonly ARCHITECTURAL_PATTERNS = [
    /arquitectura|architecture/i,
    /microservicio|microservice/i,
    /millones|millions/i,
    /enterprise|empresarial/i,
    /plataforma completa|full platform|saas/i,
    /sistema distribuido|distributed system/i,
    /alta disponibilidad|high availability/i,
    /escalabilidad|scalability|scaling/i,
    /kubernetes|k8s/i,
    /infraestructura|infrastructure/i
  ];

  private readonly COMPLEX_PATTERNS = [
    /implementa|implement/i,
    /diseña|design/i,
    /sistema de|system for/i,
    /jwt|oauth|auth/i,
    /base de datos|database/i,
    /api rest|restful/i,
    /integración|integration/i,
    /seguridad|security/i
  ];

  private readonly MODERATE_PATTERNS = [
    /explica|explain/i,
    /ejemplo|example/i,
    /cómo funciona|how.*(work|function)/i,
    /diferencia|difference/i,
    /compara|compare/i,
    /debugging|debug/i,
    /async|await|promise/i
  ];

  private readonly SIMPLE_PATTERNS = [
    /\bqué es\b|\bwhat is\b/i,
    /\bdefine\b|\bdefinir\b/i,
    /\blist\b|\blistar\b/i
  ];

  private readonly AGENT_REQUIRED_PATTERNS: Array<{ pattern: RegExp; reason: string; category: string }> = [
    // === INVESTIGACIÓN Y ANÁLISIS ===
    { pattern: /\b(busca|buscar|search|find|investigar|investigate|research)\b.*\b(web|internet|online|en línea|información|information)\b/i, reason: "Requiere búsqueda web", category: "research" },
    { pattern: /\b(navega|navigate|browse|visita|visit|abre|open)\b.*\b(página|page|sitio|site|url|web)\b/i, reason: "Requiere navegación web", category: "research" },
    { pattern: /\b(verifica|verify|comprueba|check|confirma|confirm)\b.*\b(hechos|facts|información|information|datos|data)\b/i, reason: "Verificación de hechos", category: "research" },
    { pattern: /\b(recopila|collect|gather)\b.*\b(información|information|datos|data)\b.*\b(de|from|sobre|about|múltiples|multiple|varias|several)\b/i, reason: "Recopilación de información", category: "research" },
    { pattern: /\b(tendencias|trends|mercado|market|análisis de mercado|market analysis)\b/i, reason: "Análisis de mercado/tendencias", category: "research" },
    { pattern: /\b(informe|report|reporte)\b.*\b(investigación|research|completo|complete|detallado|detailed)\b/i, reason: "Generación de informe de investigación", category: "research" },
    { pattern: /\b(scrape|scrapear|extraer datos|extract data|web scraping)\b/i, reason: "Extracción de datos web", category: "research" },
    { pattern: /\b(gráfico|graph|chart|visualización|visualization|diagrama|diagram)\b.*\b(datos|data|estadísticas|statistics)\b/i, reason: "Generación de visualizaciones de datos", category: "research" },
    
    // === DESARROLLO DE SOFTWARE ===
    { pattern: /\b(desarrolla|develop|construye|build|programa|program|crea|create)\b.*\b(aplicación|application|app|sitio web|website|página web|web page)\b/i, reason: "Desarrollo de aplicación web", category: "development" },
    { pattern: /\b(landing page|página de aterrizaje|landing)\b/i, reason: "Creación de landing page", category: "development" },
    { pattern: /\b(aplicación móvil|mobile app|app móvil|react native|expo)\b/i, reason: "Desarrollo de aplicación móvil", category: "development" },
    { pattern: /\b(scaffold|scaffolding|inicializa|initialize|configura|configure)\b.*\b(proyecto|project|entorno|environment)\b/i, reason: "Scaffolding de proyecto", category: "development" },
    { pattern: /\b(base de datos|database|autenticación|authentication|login|registro|register)\b.*\b(usuarios|users|sistema|system)\b/i, reason: "Sistema con base de datos/autenticación", category: "development" },
    { pattern: /\b(debug|debugging|depura|depurar|corrige|fix)\b.*\b(código|code|error|bug|problema|problem)\b/i, reason: "Debugging de código", category: "development" },
    { pattern: /\b(ejecuta|execute|run|corre)\b.*\b(código|code|script|programa|program|python|javascript|shell|comando|command)\b/i, reason: "Ejecución de código", category: "development" },
    { pattern: /\b(instala|install|configura|configure|setup)\b.*\b(paquete|package|librería|library|dependencia|dependency)\b/i, reason: "Instalación/configuración de dependencias", category: "development" },
    { pattern: /\b(api|endpoint|backend|servidor|server|frontend)\b.*\b(crea|create|desarrolla|develop|implementa|implement)\b/i, reason: "Desarrollo de API/backend", category: "development" },
    
    // === CREACIÓN DE CONTENIDO ===
    { pattern: /\b(crea|create|genera|generate|haz|make|diseña|design)\b.*\b(documento|document|word|excel|pdf|csv|archivo|file)\b/i, reason: "Generación de documentos", category: "content" },
    { pattern: /\b(presentación|presentation|ppt|powerpoint|slides|diapositivas)\b/i, reason: "Creación de presentación", category: "content" },
    { pattern: /\b(genera|generate|crea|create)\b.*\b(imagen|image|foto|photo|ilustración|illustration|gráfico|graphic)\b/i, reason: "Generación de imágenes", category: "content" },
    { pattern: /\b(genera|generate|crea|create|produce)\b.*\b(video|vídeo|audio|sonido|sound|voz|voice)\b/i, reason: "Generación de multimedia", category: "content" },
    { pattern: /\b(transcribe|transcripción|transcription|speech to text|voz a texto)\b/i, reason: "Transcripción de audio", category: "content" },
    { pattern: /\b(redacta|write|escribe|draft|artículo|article|blog|post|contenido|content)\b.*\b(completo|complete|secciones|sections|partes|parts)\b/i, reason: "Redacción de contenido extenso", category: "content" },
    { pattern: /\b(cv|curriculum|currículum|carta de presentación|cover letter)\b|\bresume\b(?!\s+(este|esto|texto)\b)/i, reason: "Generación de CV/documentos profesionales", category: "content" },
    { pattern: /\b(edita|edit|modifica|modify)\b.*\b(imagen|image|foto|photo|video|audio)\b/i, reason: "Edición de multimedia", category: "content" },
    
    // === AUTOMATIZACIÓN Y PRODUCTIVIDAD ===
    { pattern: /\b(automatiza|automate|automatizar|automation|workflow|flujo de trabajo)\b/i, reason: "Automatización de flujo de trabajo", category: "automation" },
    { pattern: /\b(programa|schedule|agenda|planifica|plan)\b.*\b(tarea|task|recordatorio|reminder|recurrente|recurring)\b/i, reason: "Programación de tareas", category: "automation" },
    { pattern: /\b(monitorea|monitor|supervisa|supervise|vigila|watch)\b.*\b(sitio|site|web|página|page|servicio|service)\b/i, reason: "Monitoreo de servicios web", category: "automation" },
    { pattern: /\b(reserva|book|booking|compra|purchase|buy)\b.*\b(automática|automatic|proceso|process)\b/i, reason: "Automatización de reservas/compras", category: "automation" },
    { pattern: /\b(gestiona|manage|organiza|organize)\b.*\b(archivos|files|carpetas|folders|sistema|system)\b/i, reason: "Gestión de archivos del sistema", category: "automation" },
    { pattern: /\b(bot|robot|asistente automático|automatic assistant)\b/i, reason: "Creación de bot/asistente", category: "automation" },
    
    // === ANÁLISIS DE ARCHIVOS ===
    { pattern: /\b(analiza|analyze|procesa|process|lee|read)\b.*\b(archivo|file|documento|document|excel|spreadsheet|hoja de cálculo|pdf)\b/i, reason: "Análisis de archivos", category: "files" },
    { pattern: /\b(descarga|download|obtén|get|extrae|extract)\b.*\b(archivo|file|documento|document|datos|data)\b.*\b(de|from)\b/i, reason: "Descarga de archivos", category: "files" },
    { pattern: /\b(compara|compare|comparar)\b.*\b(varios|multiple|diferentes|different|archivos|files|documentos|documents)\b/i, reason: "Comparación de múltiples archivos", category: "files" },
    
    // === TAREAS MULTI-PASO ===
    { pattern: /\b(primero|first|luego|then|después|after|finalmente|finally)\b.*\b(luego|then|después|after|y después|and then)\b/i, reason: "Tarea de múltiples pasos", category: "multistep" },
    { pattern: /\b(paso\s+\d+|step\s+\d+|\d+\.\s+\w+|\d+\)\s+\w+)\b/i, reason: "Tarea con pasos enumerados", category: "multistep" },
    
    // === SOLICITUD EXPLÍCITA ===
    { pattern: /\b(usa el agente|use agent|modo agente|agent mode|con el agente|with agent)\b/i, reason: "Solicitud explícita de agente", category: "explicit" },
    
    // === URL DETECTADA ===
    { pattern: /https?:\/\/[^\s]+/i, reason: "URL detectada - navegación requerida", category: "research" }
  ];

  analyze(prompt: string, hasAttachments: boolean = false): ComplexityResult {
    const cached = this.getFromCache(prompt);
    if (cached) return cached;

    if (this.isTrivial(prompt)) {
      const result = this.createTrivialResult(prompt);
      this.setCache(prompt, result);
      return result;
    }

    const dimensions = {
      cognitive_load: this.analyzeCognitiveLoad(prompt),
      domain_breadth: this.analyzeDomainBreadth(prompt),
      steps_required: this.analyzeStepsRequired(prompt),
      ambiguity_level: this.analyzeAmbiguity(prompt),
      technical_depth: this.analyzeTechnicalDepth(prompt)
    };

    let score = Math.round(
      dimensions.cognitive_load * 0.25 +
      dimensions.domain_breadth * 0.2 +
      dimensions.steps_required * 0.2 +
      dimensions.ambiguity_level * 0.15 +
      dimensions.technical_depth * 0.2
    );

    score += this.calculateBoost(prompt);
    score = Math.max(1, Math.min(10, score));

    const agentCheck = this.checkAgentRequired(prompt, hasAttachments, dimensions.steps_required);

    const result: ComplexityResult = {
      score,
      category: this.scoreToCategory(score),
      signals: this.detectSignals(prompt, dimensions, score),
      recommended_path: this.getRecommendedPath(score),
      estimated_tokens: this.estimateTokens(prompt, score),
      dimensions,
      agent_required: agentCheck.required,
      agent_reason: agentCheck.reason
    };

    this.setCache(prompt, result);
    return result;
  }

  private checkAgentRequired(prompt: string, hasAttachments: boolean, stepsScore: number): { required: boolean; reason?: string } {
    for (const { pattern, reason } of this.AGENT_REQUIRED_PATTERNS) {
      if (pattern.test(prompt)) {
        return { required: true, reason };
      }
    }

    if (stepsScore >= 4) {
      return { required: true, reason: "Tarea compleja de múltiples pasos" };
    }

    if (hasAttachments && /\b(analiza|analyze|procesa|process|extrae|extract|resume|resumen|summarize)\b/i.test(prompt)) {
      return { required: true, reason: "Análisis de archivo adjunto" };
    }

    return { required: false };
  }

  private isTrivial(prompt: string): boolean {
    const trimmed = prompt.trim();
    if (trimmed.length < 15) {
      for (const pattern of this.TRIVIAL_PATTERNS) {
        if (pattern.test(trimmed)) return true;
      }
    }
    return trimmed.length < 5;
  }

  private createTrivialResult(prompt: string): ComplexityResult {
    return {
      score: prompt.trim().length < 10 ? 1 : 2,
      category: 'trivial',
      signals: ['trivial_pattern'],
      recommended_path: 'fast',
      estimated_tokens: Math.round(prompt.length / 4),
      dimensions: { cognitive_load: 1, domain_breadth: 1, steps_required: 1, ambiguity_level: 1, technical_depth: 1 },
      agent_required: false
    };
  }

  private calculateBoost(prompt: string): number {
    let boost = 0;
    let archCount = 0;
    let complexCount = 0;
    
    for (const pattern of this.ARCHITECTURAL_PATTERNS) {
      if (pattern.test(prompt)) archCount++;
    }
    
    for (const pattern of this.COMPLEX_PATTERNS) {
      if (pattern.test(prompt)) complexCount++;
    }

    for (const pattern of this.MODERATE_PATTERNS) {
      if (pattern.test(prompt)) {
        boost += 3;
        break;
      }
    }

    for (const pattern of this.SIMPLE_PATTERNS) {
      if (pattern.test(prompt)) {
        boost += 1;
        break;
      }
    }

    if (archCount >= 2) boost += 7;
    else if (archCount >= 1) boost += 5;

    if (complexCount >= 2) boost += 4;
    else if (complexCount >= 1) boost += 3;

    const wordCount = prompt.split(/\s+/).length;
    if (wordCount > 15) boost += 1;
    if (wordCount > 25) boost += 1;

    return boost;
  }

  private analyzeCognitiveLoad(prompt: string): number {
    const lower = prompt.toLowerCase();
    let score = 2;
    
    const highCog = ['analyze', 'analizar', 'design', 'diseñar', 'architect', 'optimize', 'optimizar', 'debug', 'refactor', 'compare', 'comparar'];
    const medCog = ['explain', 'explicar', 'implement', 'implementar', 'create', 'crear', 'build', 'construir'];
    const lowCog = ['what', 'qué', 'define', 'list', 'listar', 'show', 'mostrar'];

    highCog.forEach(w => { if (lower.includes(w)) score += 2; });
    medCog.forEach(w => { if (lower.includes(w)) score += 1; });
    lowCog.forEach(w => { if (lower.includes(w)) score -= 0.5; });

    return Math.max(1, Math.min(10, Math.round(score)));
  }

  private analyzeDomainBreadth(prompt: string): number {
    const lower = prompt.toLowerCase();
    const domains = ['database', 'base de datos', 'frontend', 'backend', 'security', 'seguridad', 'api', 'auth', 'autenticación', 'ui', 'ux', 'testing', 'deploy', 'devops', 'cache', 'redis', 'kubernetes', 'docker', 'microservice', 'gateway', 'load balancer'];
    let count = 0;
    domains.forEach(d => { if (lower.includes(d)) count++; });
    return Math.min(10, 1 + count * 2);
  }

  private analyzeStepsRequired(prompt: string): number {
    const lower = prompt.toLowerCase();
    const stepIndicators = ['then', 'después', 'luego', 'next', 'step', 'paso', 'first', 'primero', 'finally', 'finalmente', 'and then', 'y luego', 'after', 'después de'];
    let count = 0;
    stepIndicators.forEach(w => { if (lower.includes(w)) count++; });
    
    const conjunctions = (lower.match(/,|\by\b|\band\b/g) || []).length;
    count += Math.floor(conjunctions / 2);

    return Math.min(10, 1 + count);
  }

  private analyzeAmbiguity(prompt: string): number {
    const wordCount = prompt.split(/\s+/).length;
    if (wordCount < 3) return 2;
    if (wordCount < 6) return 5;
    if (wordCount < 10) return 3;
    return 2;
  }

  private analyzeTechnicalDepth(prompt: string): number {
    const lower = prompt.toLowerCase();
    const techTerms = ['algorithm', 'algoritmo', 'database', 'api', 'jwt', 'oauth', 'websocket', 'redis', 'sql', 'nosql', 'microservice', 'kubernetes', 'docker', 'cache', 'index', 'transaction', 'migration', 'arquitectura', 'sharding', 'replication', 'load balancer', 'cdn', 'ssl', 'https'];
    let score = 1;
    techTerms.forEach(t => { if (lower.includes(t)) score += 1.5; });
    return Math.min(10, Math.round(score));
  }

  private scoreToCategory(score: number): ComplexityResult['category'] {
    if (score <= 2) return 'trivial';
    if (score <= 4) return 'simple';
    if (score <= 6) return 'moderate';
    if (score <= 8) return 'complex';
    return 'architectural';
  }

  private getRecommendedPath(score: number): ComplexityResult['recommended_path'] {
    if (score <= 2) return 'fast';
    if (score <= 5) return 'standard';
    if (score <= 8) return 'orchestrated';
    return 'architect';
  }

  private detectSignals(prompt: string, dimensions: ComplexityResult['dimensions'], score: number): string[] {
    const signals: string[] = [];
    if (score >= 9) signals.push('architectural_scope');
    if (dimensions.cognitive_load >= 7) signals.push('high_reasoning_required');
    if (dimensions.domain_breadth >= 5) signals.push('multi_domain');
    if (dimensions.steps_required >= 5) signals.push('multi_step_task');
    if (dimensions.ambiguity_level >= 6) signals.push('needs_clarification');
    if (dimensions.technical_depth >= 7) signals.push('deep_technical');
    return signals;
  }

  private estimateTokens(prompt: string, score: number): number {
    const baseTokens = prompt.length / 4;
    const multiplier = 1 + (score * 0.5);
    return Math.round(baseTokens * multiplier);
  }

  private getCacheKey(prompt: string): string {
    let hash = 0;
    for (let i = 0; i < prompt.length; i++) {
      hash = ((hash << 5) - hash) + prompt.charCodeAt(i);
      hash = hash & hash;
    }
    return `complexity_${hash}`;
  }

  private getFromCache(prompt: string): ComplexityResult | null {
    const key = this.getCacheKey(prompt);
    const cached = this.cache.get(key);
    if (cached && Date.now() - cached.timestamp < this.CACHE_TTL_MS) return cached.result;
    if (cached) this.cache.delete(key);
    return null;
  }

  private setCache(prompt: string, result: ComplexityResult): void {
    const key = this.getCacheKey(prompt);
    this.cache.set(key, { result, timestamp: Date.now() });
    if (this.cache.size > 500) {
      const firstKey = this.cache.keys().next().value;
      if (firstKey) this.cache.delete(firstKey);
    }
  }
}

export const complexityAnalyzer = new ComplexityAnalyzer();
