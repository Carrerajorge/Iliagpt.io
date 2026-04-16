import type { IntentType, OutputFormat, SupportedLocale } from "../../../../shared/schemas/intent";

export interface EvaluationExample {
  id: string;
  text: string;
  locale: SupportedLocale;
  expected_intent: IntentType;
  expected_format: OutputFormat;
  expected_slots?: Record<string, unknown>;
  tags: string[];
  difficulty: "easy" | "medium" | "hard";
}

export const EVALUATION_DATASET: EvaluationExample[] = [
  {
    id: "es_ppt_01",
    text: "Crea una presentación sobre inteligencia artificial",
    locale: "es",
    expected_intent: "CREATE_PRESENTATION",
    expected_format: "pptx",
    expected_slots: { topic: "inteligencia artificial" },
    tags: ["spanish", "presentation", "basic"],
    difficulty: "easy"
  },
  {
    id: "es_ppt_02",
    text: "Hazme unas diapositivas de marketing para ejecutivos",
    locale: "es",
    expected_intent: "CREATE_PRESENTATION",
    expected_format: "pptx",
    expected_slots: { topic: "marketing", audience: "executives" },
    tags: ["spanish", "presentation", "audience"],
    difficulty: "medium"
  },
  {
    id: "es_ppt_03",
    text: "Genera un pawer point de ventas con 10 slides",
    locale: "es",
    expected_intent: "CREATE_PRESENTATION",
    expected_format: "pptx",
    expected_slots: { topic: "ventas", num_slides: 10 },
    tags: ["spanish", "presentation", "typo"],
    difficulty: "medium"
  },
  {
    id: "es_doc_01",
    text: "Crea un documento sobre el proyecto",
    locale: "es",
    expected_intent: "CREATE_DOCUMENT",
    expected_format: "docx",
    expected_slots: { topic: "proyecto" },
    tags: ["spanish", "document", "basic"],
    difficulty: "easy"
  },
  {
    id: "es_doc_02",
    text: "Escribe un informe detallado sobre los resultados del Q4",
    locale: "es",
    expected_intent: "CREATE_DOCUMENT",
    expected_format: "docx",
    expected_slots: { topic: "resultados del Q4", length: "long" },
    tags: ["spanish", "document", "length"],
    difficulty: "medium"
  },
  {
    id: "es_xls_01",
    text: "Hazme un excel con los datos de ventas",
    locale: "es",
    expected_intent: "CREATE_SPREADSHEET",
    expected_format: "xlsx",
    expected_slots: { topic: "datos de ventas" },
    tags: ["spanish", "spreadsheet", "basic"],
    difficulty: "easy"
  },
  {
    id: "es_xls_02",
    text: "Genera una hoja de calculo con el presupuesto anual",
    locale: "es",
    expected_intent: "CREATE_SPREADSHEET",
    expected_format: "xlsx",
    expected_slots: { topic: "presupuesto anual" },
    tags: ["spanish", "spreadsheet", "basic"],
    difficulty: "easy"
  },
  {
    id: "es_sum_01",
    text: "Resúmeme este documento en puntos clave",
    locale: "es",
    expected_intent: "SUMMARIZE",
    expected_format: null,
    expected_slots: { bullet_points: true },
    tags: ["spanish", "summarize", "bullets"],
    difficulty: "easy"
  },
  {
    id: "es_trans_01",
    text: "Traduce este texto al inglés",
    locale: "es",
    expected_intent: "TRANSLATE",
    expected_format: null,
    expected_slots: { target_language: "en" },
    tags: ["spanish", "translate", "basic"],
    difficulty: "easy"
  },
  {
    id: "es_search_01",
    text: "Busca información sobre las tendencias del mercado 2025",
    locale: "es",
    expected_intent: "SEARCH_WEB",
    expected_format: null,
    tags: ["spanish", "search", "basic"],
    difficulty: "easy"
  },
  {
    id: "es_analyze_01",
    text: "Analiza este informe y dame tu opinión",
    locale: "es",
    expected_intent: "ANALYZE_DOCUMENT",
    expected_format: null,
    tags: ["spanish", "analyze", "basic"],
    difficulty: "easy"
  },
  {
    id: "en_ppt_01",
    text: "Create a presentation about climate change",
    locale: "en",
    expected_intent: "CREATE_PRESENTATION",
    expected_format: "pptx",
    expected_slots: { topic: "climate change" },
    tags: ["english", "presentation", "basic"],
    difficulty: "easy"
  },
  {
    id: "en_ppt_02",
    text: "Make me a slide deck for the quarterly review",
    locale: "en",
    expected_intent: "CREATE_PRESENTATION",
    expected_format: "pptx",
    expected_slots: { topic: "quarterly review" },
    tags: ["english", "presentation", "basic"],
    difficulty: "easy"
  },
  {
    id: "en_ppt_03",
    text: "Generate slides about AI for a technical audience with images",
    locale: "en",
    expected_intent: "CREATE_PRESENTATION",
    expected_format: "pptx",
    expected_slots: { topic: "AI", audience: "technical", include_images: true },
    tags: ["english", "presentation", "complex"],
    difficulty: "medium"
  },
  {
    id: "en_doc_01",
    text: "Write a report on market analysis",
    locale: "en",
    expected_intent: "CREATE_DOCUMENT",
    expected_format: "docx",
    expected_slots: { topic: "market analysis" },
    tags: ["english", "document", "basic"],
    difficulty: "easy"
  },
  {
    id: "en_doc_02",
    text: "Create a professional document about our company strategy",
    locale: "en",
    expected_intent: "CREATE_DOCUMENT",
    expected_format: "docx",
    expected_slots: { topic: "company strategy", style: "professional" },
    tags: ["english", "document", "style"],
    difficulty: "medium"
  },
  {
    id: "en_xls_01",
    text: "Create an Excel spreadsheet with budget data",
    locale: "en",
    expected_intent: "CREATE_SPREADSHEET",
    expected_format: "xlsx",
    expected_slots: { topic: "budget data" },
    tags: ["english", "spreadsheet", "basic"],
    difficulty: "easy"
  },
  {
    id: "en_sum_01",
    text: "Summarize this document for me",
    locale: "en",
    expected_intent: "SUMMARIZE",
    expected_format: null,
    tags: ["english", "summarize", "basic"],
    difficulty: "easy"
  },
  {
    id: "en_trans_01",
    text: "Translate this to Spanish",
    locale: "en",
    expected_intent: "TRANSLATE",
    expected_format: null,
    expected_slots: { target_language: "es" },
    tags: ["english", "translate", "basic"],
    difficulty: "easy"
  },
  {
    id: "en_search_01",
    text: "Search for information about machine learning trends",
    locale: "en",
    expected_intent: "SEARCH_WEB",
    expected_format: null,
    tags: ["english", "search", "basic"],
    difficulty: "easy"
  },
  {
    id: "pt_ppt_01",
    text: "Crie uma apresentação sobre o mercado brasileiro",
    locale: "pt",
    expected_intent: "CREATE_PRESENTATION",
    expected_format: "pptx",
    expected_slots: { topic: "mercado brasileiro" },
    tags: ["portuguese", "presentation", "basic"],
    difficulty: "easy"
  },
  {
    id: "pt_doc_01",
    text: "Faça um documento sobre o projeto de vendas",
    locale: "pt",
    expected_intent: "CREATE_DOCUMENT",
    expected_format: "docx",
    expected_slots: { topic: "projeto de vendas" },
    tags: ["portuguese", "document", "basic"],
    difficulty: "easy"
  },
  {
    id: "fr_ppt_01",
    text: "Créez une présentation sur le marketing digital",
    locale: "fr",
    expected_intent: "CREATE_PRESENTATION",
    expected_format: "pptx",
    expected_slots: { topic: "marketing digital" },
    tags: ["french", "presentation", "basic"],
    difficulty: "easy"
  },
  {
    id: "fr_doc_01",
    text: "Rédigez un rapport sur les ventes du trimestre",
    locale: "fr",
    expected_intent: "CREATE_DOCUMENT",
    expected_format: "docx",
    expected_slots: { topic: "ventes du trimestre" },
    tags: ["french", "document", "basic"],
    difficulty: "easy"
  },
  {
    id: "de_ppt_01",
    text: "Erstelle eine Präsentation über Nachhaltigkeit",
    locale: "de",
    expected_intent: "CREATE_PRESENTATION",
    expected_format: "pptx",
    expected_slots: { topic: "Nachhaltigkeit" },
    tags: ["german", "presentation", "basic"],
    difficulty: "easy"
  },
  {
    id: "de_doc_01",
    text: "Schreibe ein Dokument über das Projekt",
    locale: "de",
    expected_intent: "CREATE_DOCUMENT",
    expected_format: "docx",
    expected_slots: { topic: "Projekt" },
    tags: ["german", "document", "basic"],
    difficulty: "easy"
  },
  {
    id: "it_ppt_01",
    text: "Crea una presentazione sul prodotto nuovo",
    locale: "it",
    expected_intent: "CREATE_PRESENTATION",
    expected_format: "pptx",
    expected_slots: { topic: "prodotto nuovo" },
    tags: ["italian", "presentation", "basic"],
    difficulty: "easy"
  },
  {
    id: "it_doc_01",
    text: "Scrivi un documento sul piano di marketing",
    locale: "it",
    expected_intent: "CREATE_DOCUMENT",
    expected_format: "docx",
    expected_slots: { topic: "piano di marketing" },
    tags: ["italian", "document", "basic"],
    difficulty: "easy"
  },
  {
    id: "cs_01",
    text: "Create a presentación sobre AI trends",
    locale: "en",
    expected_intent: "CREATE_PRESENTATION",
    expected_format: "pptx",
    expected_slots: { topic: "AI trends" },
    tags: ["code-switching", "english-spanish", "presentation"],
    difficulty: "hard"
  },
  {
    id: "cs_02",
    text: "Hazme un document about ventas en Q4",
    locale: "es",
    expected_intent: "CREATE_DOCUMENT",
    expected_format: "docx",
    expected_slots: { topic: "ventas en Q4" },
    tags: ["code-switching", "spanish-english", "document"],
    difficulty: "hard"
  },
  {
    id: "typo_01",
    text: "Creame un pawer point de IA",
    locale: "es",
    expected_intent: "CREATE_PRESENTATION",
    expected_format: "pptx",
    expected_slots: { topic: "IA" },
    tags: ["typo", "spanish", "presentation"],
    difficulty: "medium"
  },
  {
    id: "typo_02",
    text: "Make a presenation about our product",
    locale: "en",
    expected_intent: "CREATE_PRESENTATION",
    expected_format: "pptx",
    expected_slots: { topic: "product" },
    tags: ["typo", "english", "presentation"],
    difficulty: "medium"
  },
  {
    id: "typo_03",
    text: "Genera un exel con los gastos",
    locale: "es",
    expected_intent: "CREATE_SPREADSHEET",
    expected_format: "xlsx",
    expected_slots: { topic: "gastos" },
    tags: ["typo", "spanish", "spreadsheet"],
    difficulty: "medium"
  },
  {
    id: "ambig_01",
    text: "Hazme algo sobre el proyecto",
    locale: "es",
    expected_intent: "NEED_CLARIFICATION",
    expected_format: null,
    tags: ["ambiguous", "spanish"],
    difficulty: "hard"
  },
  {
    id: "ambig_02",
    text: "Can you help me with the report?",
    locale: "en",
    expected_intent: "NEED_CLARIFICATION",
    expected_format: null,
    tags: ["ambiguous", "english"],
    difficulty: "hard"
  },
  {
    id: "chat_01",
    text: "Hola, cómo estás?",
    locale: "es",
    expected_intent: "CHAT_GENERAL",
    expected_format: null,
    tags: ["chat", "spanish", "greeting"],
    difficulty: "easy"
  },
  {
    id: "chat_02",
    text: "Thanks for your help!",
    locale: "en",
    expected_intent: "CHAT_GENERAL",
    expected_format: null,
    tags: ["chat", "english", "thanks"],
    difficulty: "easy"
  },
  {
    id: "ar_ppt_01",
    text: "أنشئ عرض تقديمي عن الذكاء الاصطناعي",
    locale: "ar",
    expected_intent: "CREATE_PRESENTATION",
    expected_format: "pptx",
    expected_slots: { topic: "الذكاء الاصطناعي" },
    tags: ["arabic", "presentation", "basic"],
    difficulty: "easy"
  },
  {
    id: "ar_doc_01",
    text: "اكتب مستند عن المشروع الجديد",
    locale: "ar",
    expected_intent: "CREATE_DOCUMENT",
    expected_format: "docx",
    expected_slots: { topic: "المشروع الجديد" },
    tags: ["arabic", "document", "basic"],
    difficulty: "easy"
  },
  {
    id: "ar_sum_01",
    text: "لخص هذا المستند من فضلك",
    locale: "ar",
    expected_intent: "SUMMARIZE",
    expected_format: null,
    tags: ["arabic", "summarize", "basic"],
    difficulty: "easy"
  },
  {
    id: "hi_ppt_01",
    text: "कृत्रिम बुद्धिमत्ता के बारे में प्रस्तुति बनाएं",
    locale: "hi",
    expected_intent: "CREATE_PRESENTATION",
    expected_format: "pptx",
    expected_slots: { topic: "कृत्रिम बुद्धिमत्ता" },
    tags: ["hindi", "presentation", "basic"],
    difficulty: "easy"
  },
  {
    id: "hi_doc_01",
    text: "प्रोजेक्ट के बारे में दस्तावेज़ बनाओ",
    locale: "hi",
    expected_intent: "CREATE_DOCUMENT",
    expected_format: "docx",
    tags: ["hindi", "document", "basic"],
    difficulty: "easy"
  },
  {
    id: "hi_trans_01",
    text: "इसे अंग्रेजी में अनुवाद करें",
    locale: "hi",
    expected_intent: "TRANSLATE",
    expected_format: null,
    tags: ["hindi", "translate", "basic"],
    difficulty: "easy"
  },
  {
    id: "ja_ppt_01",
    text: "AIについてのプレゼンを作成してください",
    locale: "ja",
    expected_intent: "CREATE_PRESENTATION",
    expected_format: "pptx",
    expected_slots: { topic: "AI" },
    tags: ["japanese", "presentation", "basic"],
    difficulty: "easy"
  },
  {
    id: "ja_doc_01",
    text: "プロジェクトについてのドキュメントを作って",
    locale: "ja",
    expected_intent: "CREATE_DOCUMENT",
    expected_format: "docx",
    tags: ["japanese", "document", "basic"],
    difficulty: "easy"
  },
  {
    id: "ja_sum_01",
    text: "この文書を要約して",
    locale: "ja",
    expected_intent: "SUMMARIZE",
    expected_format: null,
    tags: ["japanese", "summarize", "basic"],
    difficulty: "easy"
  },
  {
    id: "ko_ppt_01",
    text: "인공지능에 대한 프레젠테이션을 만들어주세요",
    locale: "ko",
    expected_intent: "CREATE_PRESENTATION",
    expected_format: "pptx",
    tags: ["korean", "presentation", "basic"],
    difficulty: "easy"
  },
  {
    id: "ko_xls_01",
    text: "판매 데이터로 스프레드시트 만들어줘",
    locale: "ko",
    expected_intent: "CREATE_SPREADSHEET",
    expected_format: "xlsx",
    tags: ["korean", "spreadsheet", "basic"],
    difficulty: "easy"
  },
  {
    id: "ko_trans_01",
    text: "이것을 영어로 번역해주세요",
    locale: "ko",
    expected_intent: "TRANSLATE",
    expected_format: null,
    tags: ["korean", "translate", "basic"],
    difficulty: "easy"
  },
  {
    id: "zh_ppt_01",
    text: "创建一个关于人工智能的演示文稿",
    locale: "zh",
    expected_intent: "CREATE_PRESENTATION",
    expected_format: "pptx",
    tags: ["chinese", "presentation", "basic"],
    difficulty: "easy"
  },
  {
    id: "zh_doc_01",
    text: "写一份关于项目的文档",
    locale: "zh",
    expected_intent: "CREATE_DOCUMENT",
    expected_format: "docx",
    tags: ["chinese", "document", "basic"],
    difficulty: "easy"
  },
  {
    id: "zh_sum_01",
    text: "总结这个文档",
    locale: "zh",
    expected_intent: "SUMMARIZE",
    expected_format: null,
    tags: ["chinese", "summarize", "basic"],
    difficulty: "easy"
  },
  {
    id: "ru_ppt_01",
    text: "Создай презентацию про искусственный интеллект",
    locale: "ru",
    expected_intent: "CREATE_PRESENTATION",
    expected_format: "pptx",
    tags: ["russian", "presentation", "basic"],
    difficulty: "easy"
  },
  {
    id: "ru_doc_01",
    text: "Напиши документ о проекте",
    locale: "ru",
    expected_intent: "CREATE_DOCUMENT",
    expected_format: "docx",
    tags: ["russian", "document", "basic"],
    difficulty: "easy"
  },
  {
    id: "ru_search_01",
    text: "Найди информацию о рыночных тенденциях",
    locale: "ru",
    expected_intent: "SEARCH_WEB",
    expected_format: null,
    tags: ["russian", "search", "basic"],
    difficulty: "easy"
  },
  {
    id: "tr_ppt_01",
    text: "Yapay zeka hakkında bir sunum oluştur",
    locale: "tr",
    expected_intent: "CREATE_PRESENTATION",
    expected_format: "pptx",
    tags: ["turkish", "presentation", "basic"],
    difficulty: "easy"
  },
  {
    id: "tr_doc_01",
    text: "Proje hakkında bir belge hazırla",
    locale: "tr",
    expected_intent: "CREATE_DOCUMENT",
    expected_format: "docx",
    tags: ["turkish", "document", "basic"],
    difficulty: "easy"
  },
  {
    id: "tr_trans_01",
    text: "Bunu İngilizceye çevir",
    locale: "tr",
    expected_intent: "TRANSLATE",
    expected_format: null,
    tags: ["turkish", "translate", "basic"],
    difficulty: "easy"
  },
  {
    id: "id_ppt_01",
    text: "Buat presentasi tentang kecerdasan buatan",
    locale: "id",
    expected_intent: "CREATE_PRESENTATION",
    expected_format: "pptx",
    tags: ["indonesian", "presentation", "basic"],
    difficulty: "easy"
  },
  {
    id: "id_doc_01",
    text: "Tulis dokumen tentang proyek",
    locale: "id",
    expected_intent: "CREATE_DOCUMENT",
    expected_format: "docx",
    tags: ["indonesian", "document", "basic"],
    difficulty: "easy"
  },
  {
    id: "id_sum_01",
    text: "Ringkas dokumen ini",
    locale: "id",
    expected_intent: "SUMMARIZE",
    expected_format: null,
    tags: ["indonesian", "summarize", "basic"],
    difficulty: "easy"
  }
];

export function getExamplesByLocale(locale: SupportedLocale): EvaluationExample[] {
  return EVALUATION_DATASET.filter(e => e.locale === locale);
}

export function getExamplesByIntent(intent: IntentType): EvaluationExample[] {
  return EVALUATION_DATASET.filter(e => e.expected_intent === intent);
}

export function getExamplesByTag(tag: string): EvaluationExample[] {
  return EVALUATION_DATASET.filter(e => e.tags.includes(tag));
}

export function getExamplesByDifficulty(difficulty: "easy" | "medium" | "hard"): EvaluationExample[] {
  return EVALUATION_DATASET.filter(e => e.difficulty === difficulty);
}

export function getDatasetStats(): {
  total: number;
  byLocale: Record<string, number>;
  byIntent: Record<string, number>;
  byDifficulty: Record<string, number>;
} {
  const stats = {
    total: EVALUATION_DATASET.length,
    byLocale: {} as Record<string, number>,
    byIntent: {} as Record<string, number>,
    byDifficulty: {} as Record<string, number>
  };

  for (const example of EVALUATION_DATASET) {
    stats.byLocale[example.locale] = (stats.byLocale[example.locale] || 0) + 1;
    stats.byIntent[example.expected_intent] = (stats.byIntent[example.expected_intent] || 0) + 1;
    stats.byDifficulty[example.difficulty] = (stats.byDifficulty[example.difficulty] || 0) + 1;
  }

  return stats;
}
