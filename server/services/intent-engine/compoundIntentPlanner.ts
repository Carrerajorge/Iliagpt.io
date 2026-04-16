import { nanoid } from "nanoid";
import type { SupportedLocale } from "../../../shared/schemas/intent";

export type DocumentType = 
  | "REPORT" 
  | "CV" 
  | "LETTER" 
  | "REQUEST" 
  | "MINUTES" 
  | "PROPOSAL" 
  | "MANUAL"
  | "ESSAY"
  | "SUMMARY";

export interface ResearchStep {
  type: "WEB_RESEARCH";
  query: string;
  constraints: {
    language: string;
    region?: string;
    recency_days?: number;
  };
  min_sources: number;
}

export interface EvidenceBuildStep {
  type: "EVIDENCE_BUILD";
  dedupe: boolean;
  rank: "bm25" | "embeddings" | "bm25+embeddings";
}

export interface OutlineStep {
  type: "OUTLINE";
  sections: string[];
}

export interface DraftSectionsStep {
  type: "DRAFT_SECTIONS";
  require_citations: boolean;
}

export interface FactVerifyStep {
  type: "FACT_VERIFY";
  halt_below_rate: number;
}

export interface RenderDocxStep {
  type: "RENDER_DOCX";
  template: string;
  theme: string;
}

export type CompoundPlanStep = 
  | ResearchStep 
  | EvidenceBuildStep 
  | OutlineStep 
  | DraftSectionsStep 
  | FactVerifyStep 
  | RenderDocxStep;

export interface CompoundIntentResult {
  isCompound: boolean;
  intent: "CREATE_DOCUMENT" | "CHAT_GENERAL";
  doc_type: DocumentType | null;
  output_format: "docx" | "pdf" | "txt" | null;
  topic: string | null;
  requires_research: boolean;
  plan: {
    id: string;
    steps: CompoundPlanStep[];
  } | null;
  confidence: number;
  locale: SupportedLocale;
}

const RESEARCH_VERBS: Record<string, string[]> = {
  es: ["investiga", "investigar", "busca", "buscar", "averigua", "averiguar", "indaga", "indagar", "explora", "explorar", "analiza", "analizar", "estudia", "estudiar", "recopila", "recopilar"],
  en: ["research", "investigate", "search", "look up", "find", "explore", "analyze", "study", "gather", "collect", "discover", "examine"],
  pt: ["pesquisa", "pesquisar", "investiga", "investigar", "busca", "buscar", "explora", "explorar", "analisa", "analisar"],
  fr: ["recherche", "rechercher", "investigue", "investiguer", "explore", "explorer", "analyse", "analyser", "étudie", "étudier"],
  de: ["recherchiere", "recherchieren", "untersuche", "untersuchen", "suche", "suchen", "forsche", "forschen", "analysiere", "analysieren"],
  it: ["ricerca", "ricercare", "investiga", "investigare", "esplora", "esplorare", "analizza", "analizzare", "studia", "studiare"],
  ja: ["調査", "調べ", "研究", "探す", "分析", "検索"],
  zh: ["调查", "研究", "搜索", "查找", "分析", "探索"],
  ko: ["조사", "연구", "검색", "찾아", "분석"],
  ar: ["ابحث", "تحقق", "استكشف", "حلل", "ادرس"],
  hi: ["खोज", "अनुसंधान", "जांच", "विश्लेषण"],
  ru: ["исследуй", "исследовать", "изучи", "изучить", "найди", "найти", "проанализируй", "проанализировать"],
  tr: ["araştır", "araştırmak", "incele", "incelemek", "bul", "bulmak", "analiz et"],
  id: ["teliti", "meneliti", "cari", "mencari", "analisis", "menganalisis"]
};

const DOCUMENT_KEYWORDS: Record<string, { patterns: string[]; doc_type: DocumentType }[]> = {
  es: [
    { patterns: ["informe", "reporte", "report"], doc_type: "REPORT" },
    { patterns: ["cv", "currículum", "curriculum", "hoja de vida"], doc_type: "CV" },
    { patterns: ["carta", "letter"], doc_type: "LETTER" },
    { patterns: ["solicitud", "petición"], doc_type: "REQUEST" },
    { patterns: ["acta", "minuta", "minutes"], doc_type: "MINUTES" },
    { patterns: ["propuesta", "proposal"], doc_type: "PROPOSAL" },
    { patterns: ["manual", "guía"], doc_type: "MANUAL" },
    { patterns: ["ensayo", "essay"], doc_type: "ESSAY" },
    { patterns: ["resumen", "summary"], doc_type: "SUMMARY" }
  ],
  en: [
    { patterns: ["report", "analysis report", "research report"], doc_type: "REPORT" },
    { patterns: ["cv", "resume", "curriculum vitae"], doc_type: "CV" },
    { patterns: ["letter", "cover letter", "formal letter"], doc_type: "LETTER" },
    { patterns: ["request", "application", "petition"], doc_type: "REQUEST" },
    { patterns: ["minutes", "meeting notes", "meeting minutes"], doc_type: "MINUTES" },
    { patterns: ["proposal", "project proposal", "business proposal"], doc_type: "PROPOSAL" },
    { patterns: ["manual", "guide", "handbook"], doc_type: "MANUAL" },
    { patterns: ["essay", "paper"], doc_type: "ESSAY" },
    { patterns: ["summary", "executive summary", "brief"], doc_type: "SUMMARY" }
  ],
  pt: [
    { patterns: ["relatório", "report"], doc_type: "REPORT" },
    { patterns: ["cv", "currículo"], doc_type: "CV" },
    { patterns: ["carta"], doc_type: "LETTER" },
    { patterns: ["solicitação", "pedido"], doc_type: "REQUEST" },
    { patterns: ["ata", "minuta"], doc_type: "MINUTES" },
    { patterns: ["proposta"], doc_type: "PROPOSAL" },
    { patterns: ["manual", "guia"], doc_type: "MANUAL" }
  ],
  fr: [
    { patterns: ["rapport", "compte rendu"], doc_type: "REPORT" },
    { patterns: ["cv", "curriculum"], doc_type: "CV" },
    { patterns: ["lettre"], doc_type: "LETTER" },
    { patterns: ["demande", "requête"], doc_type: "REQUEST" },
    { patterns: ["procès-verbal", "compte-rendu"], doc_type: "MINUTES" },
    { patterns: ["proposition", "offre"], doc_type: "PROPOSAL" },
    { patterns: ["manuel", "guide"], doc_type: "MANUAL" }
  ],
  de: [
    { patterns: ["bericht", "report"], doc_type: "REPORT" },
    { patterns: ["lebenslauf", "cv"], doc_type: "CV" },
    { patterns: ["brief", "schreiben"], doc_type: "LETTER" },
    { patterns: ["antrag", "anfrage"], doc_type: "REQUEST" },
    { patterns: ["protokoll"], doc_type: "MINUTES" },
    { patterns: ["vorschlag", "angebot"], doc_type: "PROPOSAL" },
    { patterns: ["handbuch", "anleitung"], doc_type: "MANUAL" }
  ],
  it: [
    { patterns: ["rapporto", "relazione"], doc_type: "REPORT" },
    { patterns: ["cv", "curriculum"], doc_type: "CV" },
    { patterns: ["lettera"], doc_type: "LETTER" },
    { patterns: ["richiesta", "domanda"], doc_type: "REQUEST" },
    { patterns: ["verbale", "minuta"], doc_type: "MINUTES" },
    { patterns: ["proposta"], doc_type: "PROPOSAL" },
    { patterns: ["manuale", "guida"], doc_type: "MANUAL" }
  ],
  ja: [
    { patterns: ["レポート", "報告書", "報告"], doc_type: "REPORT" },
    { patterns: ["履歴書", "職務経歴書"], doc_type: "CV" },
    { patterns: ["手紙", "書簡"], doc_type: "LETTER" },
    { patterns: ["申請書", "依頼書"], doc_type: "REQUEST" },
    { patterns: ["議事録"], doc_type: "MINUTES" },
    { patterns: ["提案書", "企画書"], doc_type: "PROPOSAL" },
    { patterns: ["マニュアル", "手引き"], doc_type: "MANUAL" }
  ],
  zh: [
    { patterns: ["报告", "研究报告"], doc_type: "REPORT" },
    { patterns: ["简历", "履历"], doc_type: "CV" },
    { patterns: ["信函", "信件"], doc_type: "LETTER" },
    { patterns: ["申请", "请求"], doc_type: "REQUEST" },
    { patterns: ["会议记录", "纪要"], doc_type: "MINUTES" },
    { patterns: ["提案", "建议书"], doc_type: "PROPOSAL" },
    { patterns: ["手册", "指南"], doc_type: "MANUAL" }
  ],
  ko: [
    { patterns: ["보고서", "리포트"], doc_type: "REPORT" },
    { patterns: ["이력서"], doc_type: "CV" },
    { patterns: ["편지", "서신"], doc_type: "LETTER" },
    { patterns: ["요청서", "신청서"], doc_type: "REQUEST" },
    { patterns: ["회의록"], doc_type: "MINUTES" },
    { patterns: ["제안서"], doc_type: "PROPOSAL" },
    { patterns: ["매뉴얼", "안내서"], doc_type: "MANUAL" }
  ],
  ar: [
    { patterns: ["تقرير", "تقارير"], doc_type: "REPORT" },
    { patterns: ["سيرة ذاتية"], doc_type: "CV" },
    { patterns: ["رسالة", "خطاب"], doc_type: "LETTER" },
    { patterns: ["طلب", "التماس"], doc_type: "REQUEST" },
    { patterns: ["محضر", "محضر اجتماع"], doc_type: "MINUTES" },
    { patterns: ["اقتراح", "مقترح"], doc_type: "PROPOSAL" },
    { patterns: ["دليل", "كتيب"], doc_type: "MANUAL" }
  ],
  hi: [
    { patterns: ["रिपोर्ट", "प्रतिवेदन"], doc_type: "REPORT" },
    { patterns: ["बायोडाटा", "रेज़्यूमे"], doc_type: "CV" },
    { patterns: ["पत्र"], doc_type: "LETTER" },
    { patterns: ["आवेदन", "निवेदन"], doc_type: "REQUEST" },
    { patterns: ["कार्यवृत्त"], doc_type: "MINUTES" },
    { patterns: ["प्रस्ताव"], doc_type: "PROPOSAL" },
    { patterns: ["मैनुअल", "गाइड"], doc_type: "MANUAL" }
  ],
  ru: [
    { patterns: ["отчёт", "отчет", "доклад"], doc_type: "REPORT" },
    { patterns: ["резюме", "cv"], doc_type: "CV" },
    { patterns: ["письмо"], doc_type: "LETTER" },
    { patterns: ["заявка", "запрос", "заявление"], doc_type: "REQUEST" },
    { patterns: ["протокол"], doc_type: "MINUTES" },
    { patterns: ["предложение", "коммерческое предложение"], doc_type: "PROPOSAL" },
    { patterns: ["руководство", "инструкция"], doc_type: "MANUAL" }
  ],
  tr: [
    { patterns: ["rapor"], doc_type: "REPORT" },
    { patterns: ["özgeçmiş", "cv"], doc_type: "CV" },
    { patterns: ["mektup"], doc_type: "LETTER" },
    { patterns: ["başvuru", "talep"], doc_type: "REQUEST" },
    { patterns: ["tutanak"], doc_type: "MINUTES" },
    { patterns: ["teklif", "öneri"], doc_type: "PROPOSAL" },
    { patterns: ["kılavuz", "el kitabı"], doc_type: "MANUAL" }
  ],
  id: [
    { patterns: ["laporan", "report"], doc_type: "REPORT" },
    { patterns: ["cv", "daftar riwayat hidup"], doc_type: "CV" },
    { patterns: ["surat"], doc_type: "LETTER" },
    { patterns: ["permohonan", "permintaan"], doc_type: "REQUEST" },
    { patterns: ["notulen", "risalah"], doc_type: "MINUTES" },
    { patterns: ["proposal", "usulan"], doc_type: "PROPOSAL" },
    { patterns: ["panduan", "manual"], doc_type: "MANUAL" }
  ]
};

const FORMAT_KEYWORDS: Record<string, string[]> = {
  docx: ["word", "docx", "documento word", "word document", "doc"],
  pdf: ["pdf"],
  txt: ["texto", "text", "txt", "plain text"]
};

const REPORT_SECTIONS: Record<string, string[]> = {
  es: ["resumen ejecutivo", "contexto", "hallazgos", "análisis", "conclusiones", "recomendaciones", "referencias"],
  en: ["executive summary", "background", "findings", "analysis", "conclusions", "recommendations", "references"],
  pt: ["resumo executivo", "contexto", "descobertas", "análise", "conclusões", "recomendações", "referências"],
  fr: ["résumé exécutif", "contexte", "résultats", "analyse", "conclusions", "recommandations", "références"],
  de: ["zusammenfassung", "hintergrund", "ergebnisse", "analyse", "schlussfolgerungen", "empfehlungen", "referenzen"],
  it: ["sommario esecutivo", "contesto", "risultati", "analisi", "conclusioni", "raccomandazioni", "riferimenti"],
  ja: ["エグゼクティブサマリー", "背景", "調査結果", "分析", "結論", "推奨事項", "参考文献"],
  zh: ["执行摘要", "背景", "调查结果", "分析", "结论", "建议", "参考文献"],
  ko: ["요약", "배경", "조사 결과", "분석", "결론", "권고사항", "참고문헌"],
  ar: ["الملخص التنفيذي", "السياق", "النتائج", "التحليل", "الاستنتاجات", "التوصيات", "المراجع"],
  hi: ["कार्यकारी सारांश", "पृष्ठभूमि", "निष्कर्ष", "विश्लेषण", "निष्कर्ष", "सिफारिशें", "संदर्भ"],
  ru: ["резюме", "контекст", "результаты", "анализ", "выводы", "рекомендации", "ссылки"],
  tr: ["yönetici özeti", "bağlam", "bulgular", "analiz", "sonuçlar", "öneriler", "kaynaklar"],
  id: ["ringkasan eksekutif", "latar belakang", "temuan", "analisis", "kesimpulan", "rekomendasi", "referensi"]
};

function extractTopic(text: string, locale: SupportedLocale): string | null {
  const patterns: Record<string, RegExp[]> = {
    es: [
      /(?:investiga|busca|averigua|analiza)\s+(?:sobre\s+)?(?:el\s+tema\s+de\s+)?["']?(.+?)["']?\s+(?:y\s+(?:crea|genera|haz|elabora|redacta))/i,
      /(?:sobre|acerca de)\s+["']?(.+?)["']?\s+(?:y\s+(?:crea|genera|haz|elabora|redacta))/i,
      /(?:investiga|busca)\s+["']?(.+?)["']?\s*$/i
    ],
    en: [
      /(?:research|investigate|look up|search for|find)\s+(?:about\s+)?["']?(.+?)["']?\s+(?:and\s+(?:create|generate|make|write))/i,
      /(?:about|on)\s+["']?(.+?)["']?\s+(?:and\s+(?:create|generate|make|write))/i,
      /(?:research|investigate)\s+["']?(.+?)["']?\s*$/i
    ]
  };

  const localePatterns = patterns[locale] || patterns.en;
  for (const pattern of localePatterns) {
    const match = text.match(pattern);
    if (match && match[1]) {
      return match[1].trim();
    }
  }

  const genericPatterns = [
    /(?:sobre|about|acerca de|on|regarding)\s+["']?([^"'\n]{3,160})["']?\s+(?:y|and|et|und|e)\s+/i,
    /["']([^"']+)["']/
  ];

  for (const pattern of genericPatterns) {
    const match = text.match(pattern);
    if (match && match[1]) {
      return match[1].trim();
    }
  }

  return null;
}

function hasResearchVerb(text: string, locale: SupportedLocale): boolean {
  const normalizedText = text.toLowerCase();
  const verbs = [...(RESEARCH_VERBS[locale] || []), ...RESEARCH_VERBS.en];
  
  return verbs.some(verb => {
    const regex = new RegExp(`\\b${verb}\\b|${verb}`, "i");
    return regex.test(normalizedText);
  });
}

function detectDocumentType(text: string, locale: SupportedLocale): { doc_type: DocumentType | null; confidence: number } {
  const normalizedText = text.toLowerCase();
  const keywords = [...(DOCUMENT_KEYWORDS[locale] || []), ...(DOCUMENT_KEYWORDS.en || [])];
  
  for (const { patterns, doc_type } of keywords) {
    for (const pattern of patterns) {
      if (normalizedText.includes(pattern.toLowerCase())) {
        return { doc_type, confidence: 0.9 };
      }
    }
  }
  
  return { doc_type: null, confidence: 0 };
}

function detectOutputFormat(text: string): "docx" | "pdf" | "txt" | null {
  const normalizedText = text.toLowerCase();
  
  for (const [format, keywords] of Object.entries(FORMAT_KEYWORDS)) {
    for (const keyword of keywords) {
      if (normalizedText.includes(keyword)) {
        return format as "docx" | "pdf" | "txt";
      }
    }
  }
  
  return "docx";
}

function generateResearchPlan(
  topic: string,
  doc_type: DocumentType,
  locale: SupportedLocale
): CompoundPlanStep[] {
  const sections = REPORT_SECTIONS[locale] || REPORT_SECTIONS.en;
  
  const templateMap: Record<DocumentType, string> = {
    REPORT: "report_v1",
    CV: "cv_v1",
    LETTER: "letter_v1",
    REQUEST: "request_v1",
    MINUTES: "minutes_v1",
    PROPOSAL: "proposal_v1",
    MANUAL: "manual_v1",
    ESSAY: "essay_v1",
    SUMMARY: "summary_v1"
  };

  return [
    {
      type: "WEB_RESEARCH",
      query: topic,
      constraints: {
        language: locale,
        region: undefined,
        recency_days: 365
      },
      min_sources: 5
    },
    {
      type: "EVIDENCE_BUILD",
      dedupe: true,
      rank: "bm25+embeddings"
    },
    {
      type: "OUTLINE",
      sections
    },
    {
      type: "DRAFT_SECTIONS",
      require_citations: true
    },
    {
      type: "FACT_VERIFY",
      halt_below_rate: 0.8
    },
    {
      type: "RENDER_DOCX",
      template: templateMap[doc_type] || "report_v1",
      theme: "default"
    }
  ];
}

export function detectCompoundIntent(
  text: string,
  locale: SupportedLocale
): CompoundIntentResult {
  const hasResearch = hasResearchVerb(text, locale);
  const { doc_type, confidence: docConfidence } = detectDocumentType(text, locale);
  const outputFormat = detectOutputFormat(text);
  const topic = extractTopic(text, locale);
  
  const isCompound = hasResearch && doc_type !== null;
  
  if (!isCompound) {
    return {
      isCompound: false,
      intent: doc_type ? "CREATE_DOCUMENT" : "CHAT_GENERAL",
      doc_type,
      output_format: outputFormat,
      topic,
      requires_research: false,
      plan: null,
      confidence: docConfidence || 0.5,
      locale
    };
  }
  
  const plan = {
    id: nanoid(),
    steps: generateResearchPlan(topic || text, doc_type, locale)
  };
  
  return {
    isCompound: true,
    intent: "CREATE_DOCUMENT",
    doc_type,
    output_format: outputFormat,
    topic,
    requires_research: true,
    plan,
    confidence: Math.min(0.95, docConfidence + 0.1),
    locale
  };
}

export function isResearchEnabled(): boolean {
  return process.env.WEB_RESEARCH_ENABLED !== "false";
}

export interface CompoundPlanValidation {
  isValid: boolean;
  errors: string[];
  warnings: string[];
}

export function validateCompoundPlan(
  result: CompoundIntentResult
): CompoundPlanValidation {
  const errors: string[] = [];
  const warnings: string[] = [];
  
  if (!result.isCompound || !result.plan) {
    return { isValid: true, errors: [], warnings: [] };
  }
  
  if (result.requires_research && !isResearchEnabled()) {
    errors.push("research_not_enabled");
  }
  
  if (!result.topic) {
    warnings.push("topic_not_extracted");
  }
  
  const hasResearchStep = result.plan.steps.some(s => s.type === "WEB_RESEARCH");
  const hasRenderStep = result.plan.steps.some(s => s.type === "RENDER_DOCX");
  
  if (result.requires_research && !hasResearchStep) {
    errors.push("missing_research_step");
  }
  
  if (!hasRenderStep) {
    errors.push("missing_render_step");
  }
  
  return {
    isValid: errors.length === 0,
    errors,
    warnings
  };
}

export function serializeCompoundResult(result: CompoundIntentResult): Record<string, unknown> {
  return {
    isCompound: result.isCompound,
    intent: result.intent,
    doc_type: result.doc_type,
    output_format: result.output_format,
    topic: result.topic,
    requires_research: result.requires_research,
    plan: result.plan ? {
      id: result.plan.id,
      steps: result.plan.steps
    } : null,
    confidence: result.confidence,
    locale: result.locale
  };
}
