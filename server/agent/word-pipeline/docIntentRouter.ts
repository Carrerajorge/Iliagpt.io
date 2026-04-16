import { v4 as uuidv4 } from "uuid";
import type { SupportedLocale } from "./contracts";
import {
  DocumentSpec,
  DocumentType,
  Tone,
  Audience,
  PageSetup,
  SectionSpecEnhanced,
  DOCUMENT_TYPE_DEFAULTS,
  DEFAULT_TYPOGRAPHY,
  DEFAULT_COLOR_PALETTE,
  DEFAULT_SPACING
} from "./documentSpec";
import { ThemeManager, ThemeId } from "./themeManager";

export interface DocIntentInput {
  query: string;
  locale: SupportedLocale;
  topic?: string;
  doc_type?: DocumentType;
  tone?: Tone;
  audience?: Audience;
  theme_id?: ThemeId;
}

export interface DocIntentOutput {
  documentSpec: DocumentSpec;
  suggestedTemplate: string;
  confidence: number;
  extractedEntities: {
    topic: string | null;
    recipient?: string;
    sender?: string;
    date?: string;
    organization?: string;
  };
}

const TONE_KEYWORDS: Record<SupportedLocale, Record<Tone, string[]>> = {
  es: {
    formal: ["formal", "profesional", "oficial"],
    professional: ["profesional", "corporativo", "empresarial"],
    academic: ["académico", "científico", "universitario"],
    conversational: ["informal", "casual", "amigable"],
    technical: ["técnico", "especializado"],
    persuasive: ["persuasivo", "convincente"],
    informative: ["informativo", "explicativo"]
  },
  en: {
    formal: ["formal", "official"],
    professional: ["professional", "corporate", "business"],
    academic: ["academic", "scholarly", "scientific"],
    conversational: ["informal", "casual", "friendly"],
    technical: ["technical", "specialized"],
    persuasive: ["persuasive", "compelling"],
    informative: ["informative", "explanatory"]
  },
  pt: {
    formal: ["formal", "oficial"],
    professional: ["profissional", "corporativo"],
    academic: ["acadêmico", "científico"],
    conversational: ["informal", "casual"],
    technical: ["técnico"],
    persuasive: ["persuasivo"],
    informative: ["informativo"]
  },
  fr: {
    formal: ["formel", "officiel"],
    professional: ["professionnel", "corporate"],
    academic: ["académique", "scientifique"],
    conversational: ["informel", "décontracté"],
    technical: ["technique"],
    persuasive: ["persuasif"],
    informative: ["informatif"]
  },
  de: {
    formal: ["formell", "offiziell"],
    professional: ["professionell", "geschäftlich"],
    academic: ["akademisch", "wissenschaftlich"],
    conversational: ["informell", "locker"],
    technical: ["technisch"],
    persuasive: ["überzeugend"],
    informative: ["informativ"]
  },
  it: {
    formal: ["formale", "ufficiale"],
    professional: ["professionale", "aziendale"],
    academic: ["accademico", "scientifico"],
    conversational: ["informale", "colloquiale"],
    technical: ["tecnico"],
    persuasive: ["persuasivo"],
    informative: ["informativo"]
  },
  ja: {
    formal: ["フォーマル", "正式"],
    professional: ["ビジネス", "プロフェッショナル"],
    academic: ["学術的", "アカデミック"],
    conversational: ["カジュアル", "くだけた"],
    technical: ["技術的"],
    persuasive: ["説得力のある"],
    informative: ["情報的"]
  },
  zh: {
    formal: ["正式", "官方"],
    professional: ["专业", "商务"],
    academic: ["学术", "科学"],
    conversational: ["非正式", "随意"],
    technical: ["技术"],
    persuasive: ["有说服力"],
    informative: ["信息性"]
  },
  ko: {
    formal: ["공식적", "정식"],
    professional: ["전문적", "비즈니스"],
    academic: ["학술적", "학문적"],
    conversational: ["비공식적", "캐주얼"],
    technical: ["기술적"],
    persuasive: ["설득력 있는"],
    informative: ["정보적"]
  },
  ar: {
    formal: ["رسمي"],
    professional: ["مهني", "احترافي"],
    academic: ["أكاديمي", "علمي"],
    conversational: ["غير رسمي"],
    technical: ["تقني"],
    persuasive: ["مقنع"],
    informative: ["إعلامي"]
  },
  hi: {
    formal: ["औपचारिक"],
    professional: ["पेशेवर", "व्यावसायिक"],
    academic: ["शैक्षणिक", "वैज्ञानिक"],
    conversational: ["अनौपचारिक"],
    technical: ["तकनीकी"],
    persuasive: ["प्रेरक"],
    informative: ["सूचनात्मक"]
  },
  ru: {
    formal: ["формальный", "официальный"],
    professional: ["профессиональный", "деловой"],
    academic: ["академический", "научный"],
    conversational: ["неформальный", "разговорный"],
    technical: ["технический"],
    persuasive: ["убедительный"],
    informative: ["информативный"]
  },
  tr: {
    formal: ["resmi", "formal"],
    professional: ["profesyonel", "iş"],
    academic: ["akademik", "bilimsel"],
    conversational: ["gayri resmi", "samimi"],
    technical: ["teknik"],
    persuasive: ["ikna edici"],
    informative: ["bilgilendirici"]
  },
  id: {
    formal: ["formal", "resmi"],
    professional: ["profesional", "bisnis"],
    academic: ["akademis", "ilmiah"],
    conversational: ["informal", "santai"],
    technical: ["teknis"],
    persuasive: ["persuasif"],
    informative: ["informatif"]
  }
};

const AUDIENCE_KEYWORDS: Record<string, Audience> = {
  "ejecutivo": "executive",
  "directivo": "executive",
  "gerente": "executive",
  "executive": "executive",
  "management": "executive",
  "técnico": "technical",
  "technical": "technical",
  "developer": "technical",
  "engineer": "technical",
  "académico": "academic",
  "academic": "academic",
  "researcher": "academic",
  "operativo": "operational",
  "operational": "operational",
  "staff": "operational",
  "general": "general",
  "público": "general",
  "public": "general",
  "cliente": "client",
  "client": "client",
  "customer": "client",
  "interno": "internal",
  "internal": "internal"
};

function detectTone(text: string, locale: SupportedLocale): Tone {
  const normalizedText = text.toLowerCase();
  const toneKeywords = TONE_KEYWORDS[locale] || TONE_KEYWORDS.en;

  for (const [tone, keywords] of Object.entries(toneKeywords)) {
    for (const keyword of keywords) {
      if (normalizedText.includes(keyword)) {
        return tone as Tone;
      }
    }
  }

  return "professional";
}

function detectAudience(text: string): Audience {
  const normalizedText = text.toLowerCase();

  for (const [keyword, audience] of Object.entries(AUDIENCE_KEYWORDS)) {
    if (normalizedText.includes(keyword)) {
      return audience;
    }
  }

  return "general";
}

function extractEntities(text: string, locale: SupportedLocale): {
  topic: string | null;
  recipient?: string;
  sender?: string;
  date?: string;
  organization?: string;
} {
  const entities: {
    topic: string | null;
    recipient?: string;
    sender?: string;
    date?: string;
    organization?: string;
  } = { topic: null };

  const topicPatterns = [
    /(?:sobre|about|acerca de|on|regarding)\s+["']?([^"'.]+?)["']?(?:\s+y|\s+and|$)/i,
    /(?:tema|topic|subject)[\s:]+["']?([^"'.]+?)["']?/i
  ];

  for (const pattern of topicPatterns) {
    const match = text.match(pattern);
    if (match && match[1]) {
      entities.topic = match[1].trim();
      break;
    }
  }

  const recipientPatterns = [
    /(?:para|to|destinatario|recipient)[\s:]+["']?([^"'.]+?)["']?(?:\s|$)/i
  ];

  for (const pattern of recipientPatterns) {
    const match = text.match(pattern);
    if (match && match[1]) {
      entities.recipient = match[1].trim();
      break;
    }
  }

  return entities;
}

function generateSections(docType: DocumentType, locale: SupportedLocale): SectionSpecEnhanced[] {
  const defaults = DOCUMENT_TYPE_DEFAULTS[docType];
  const sectionTypes = defaults.sections;

  return sectionTypes.map((sectionType, index) => ({
    id: uuidv4(),
    title: formatSectionTitle(sectionType, locale),
    type: sectionType as SectionSpecEnhanced["type"],
    level: sectionType === "title_page" ? 1 : 2,
    order: index,
    pageBreakBefore: ["title_page", "table_of_contents", "bibliography", "appendix"].includes(sectionType)
  }));
}

function formatSectionTitle(sectionType: string, locale: SupportedLocale): string {
  const titles: Record<string, Record<string, string>> = {
    title_page: { es: "Portada", en: "Title Page", pt: "Capa", fr: "Page de titre", de: "Titelseite" },
    table_of_contents: { es: "Índice", en: "Table of Contents", pt: "Sumário", fr: "Table des matières", de: "Inhaltsverzeichnis" },
    executive_summary: { es: "Resumen Ejecutivo", en: "Executive Summary", pt: "Resumo Executivo", fr: "Résumé Exécutif", de: "Zusammenfassung" },
    introduction: { es: "Introducción", en: "Introduction", pt: "Introdução", fr: "Introduction", de: "Einleitung" },
    methodology: { es: "Metodología", en: "Methodology", pt: "Metodologia", fr: "Méthodologie", de: "Methodik" },
    analysis: { es: "Análisis", en: "Analysis", pt: "Análise", fr: "Analyse", de: "Analyse" },
    results: { es: "Resultados", en: "Results", pt: "Resultados", fr: "Résultats", de: "Ergebnisse" },
    discussion: { es: "Discusión", en: "Discussion", pt: "Discussão", fr: "Discussion", de: "Diskussion" },
    conclusions: { es: "Conclusiones", en: "Conclusions", pt: "Conclusões", fr: "Conclusions", de: "Schlussfolgerungen" },
    recommendations: { es: "Recomendaciones", en: "Recommendations", pt: "Recomendações", fr: "Recommandations", de: "Empfehlungen" },
    bibliography: { es: "Referencias", en: "References", pt: "Referências", fr: "Références", de: "Referenzen" },
    appendix: { es: "Anexos", en: "Appendices", pt: "Anexos", fr: "Annexes", de: "Anhänge" },
    glossary: { es: "Glosario", en: "Glossary", pt: "Glossário", fr: "Glossaire", de: "Glossar" },
    contact: { es: "Contacto", en: "Contact", pt: "Contato", fr: "Contact", de: "Kontakt" },
    experience: { es: "Experiencia", en: "Experience", pt: "Experiência", fr: "Expérience", de: "Erfahrung" },
    education: { es: "Educación", en: "Education", pt: "Educação", fr: "Formation", de: "Bildung" },
    skills: { es: "Habilidades", en: "Skills", pt: "Habilidades", fr: "Compétences", de: "Fähigkeiten" },
    projects: { es: "Proyectos", en: "Projects", pt: "Projetos", fr: "Projets", de: "Projekte" },
    references: { es: "Referencias", en: "References", pt: "Referências", fr: "Références", de: "Referenzen" },
    letterhead: { es: "Membrete", en: "Letterhead", pt: "Cabeçalho", fr: "En-tête", de: "Briefkopf" },
    salutation: { es: "Saludo", en: "Salutation", pt: "Saudação", fr: "Salutation", de: "Anrede" },
    body: { es: "Cuerpo", en: "Body", pt: "Corpo", fr: "Corps", de: "Inhalt" },
    closing: { es: "Cierre", en: "Closing", pt: "Fechamento", fr: "Clôture", de: "Schluss" },
    signature: { es: "Firma", en: "Signature", pt: "Assinatura", fr: "Signature", de: "Unterschrift" },
    custom: { es: "Sección", en: "Section", pt: "Seção", fr: "Section", de: "Abschnitt" }
  };

  const sectionTitles = titles[sectionType];
  if (sectionTitles) {
    return sectionTitles[locale] || sectionTitles.en || sectionType;
  }

  return sectionType.replace(/_/g, " ").replace(/\b\w/g, l => l.toUpperCase());
}

export function routeDocIntent(input: DocIntentInput): DocIntentOutput {
  const docType = input.doc_type || "REPORT";
  const tone = input.tone || detectTone(input.query, input.locale);
  const audience = input.audience || detectAudience(input.query);
  const themeId = input.theme_id || "default";
  
  const themeManager = new ThemeManager(themeId, docType, input.locale);
  const extractedEntities = extractEntities(input.query, input.locale);
  
  if (input.topic) {
    extractedEntities.topic = input.topic;
  }

  const defaults = DOCUMENT_TYPE_DEFAULTS[docType];
  const sections = generateSections(docType, input.locale);

  const documentSpec: DocumentSpec = {
    id: uuidv4(),
    doc_type: docType,
    locale: input.locale,
    tone,
    audience,
    title: extractedEntities.topic || "",
    page_setup: {
      size: defaults.page_setup.size || "A4",
      orientation: defaults.page_setup.orientation || "portrait",
      margins: defaults.page_setup.margins,
      columns: defaults.page_setup.columns || 1,
      columnSpacing: 1.27
    },
    typography: themeManager.getTypography(),
    color_palette: themeManager.getColorPalette(),
    spacing: themeManager.getSpacing(),
    sections,
    template_id: `${docType.toLowerCase()}_v1`,
    theme_id: themeId,
    createdAt: new Date().toISOString()
  };

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

  return {
    documentSpec,
    suggestedTemplate: templateMap[docType],
    confidence: 0.85,
    extractedEntities
  };
}

export function validateDocIntentInput(input: unknown): input is DocIntentInput {
  if (!input || typeof input !== "object") return false;
  const obj = input as Record<string, unknown>;
  
  if (typeof obj.query !== "string") return false;
  if (typeof obj.locale !== "string") return false;
  
  return true;
}

export function getAvailableDocTypes(): { id: DocumentType; name: string; sections: string[] }[] {
  return Object.entries(DOCUMENT_TYPE_DEFAULTS).map(([id, defaults]) => ({
    id: id as DocumentType,
    name: id.replace(/_/g, " "),
    sections: defaults.sections
  }));
}
