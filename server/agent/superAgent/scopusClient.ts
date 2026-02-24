import { SourceSignal } from "./contracts";
import { franc } from "franc";
import { sanitizePlainText } from "../../lib/textSanitizers";

// =============================================================================
// Types
// =============================================================================

export interface ScopusArticle {
  scopusId: string;
  eid: string;
  title: string;
  authors: string[];
  year: string;
  journal: string;
  abstract: string;
  keywords: string[];
  doi: string;
  citationCount: number;
  documentType: string;
  subtypeDescription?: string;
  language: string;
  affiliations: string[];
  affiliationCountry?: string;
  affiliationCity?: string;
  url: string;
  relevanceScore?: number;
}

export interface ScopusSearchResult {
  articles: ScopusArticle[];
  totalResults: number;
  query: string;
  searchTime: number;
  retries?: number;
  queryStrategy?: string;
}

export interface ExtractedKeywords {
  coreKeywords: string[];
  allKeywords: string[];
  yearRange?: { start: number; end: number };
  detectedLanguage?: string;
  originalPhrases?: string[];
}

// =============================================================================
// Constants & Configuration
// =============================================================================

const SCOPUS_API_BASE = "https://api.elsevier.com/content/search/scopus";
const SCOPUS_ABSTRACT_BASE = "https://api.elsevier.com/content/abstract/scopus_id";

const MAX_RETRIES = 3;
const BACKOFF_BASE_MS = 800;
const RATE_LIMIT_MS = 150;
const REQUEST_TIMEOUT_MS = 15000;
const MAX_PAGE_SIZE = 25;

let lastRequestTime = 0;

// =============================================================================
// Rate Limiting & Retry Infrastructure
// =============================================================================

async function rateLimit(): Promise<void> {
  const now = Date.now();
  const elapsed = now - lastRequestTime;
  if (elapsed < RATE_LIMIT_MS) {
    await new Promise(resolve => setTimeout(resolve, RATE_LIMIT_MS - elapsed));
  }
  lastRequestTime = Date.now();
}

async function fetchWithRetry(
  url: string,
  headers: Record<string, string>,
  retries: number = MAX_RETRIES
): Promise<{ response: Response | null; attempts: number }> {
  let attempts = 0;

  for (let attempt = 0; attempt <= retries; attempt++) {
    attempts++;
    try {
      await rateLimit();

      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

      const response = await fetch(url, {
        headers,
        signal: controller.signal,
      });

      clearTimeout(timeout);

      if (response.ok) return { response, attempts };

      // Rate limited (429) or transient server error (5xx) → retry
      if ((response.status === 429 || response.status >= 500) && attempt < retries) {
        const jitter = Math.floor(Math.random() * 300);
        const backoff = BACKOFF_BASE_MS * Math.pow(2, attempt) + jitter;
        console.warn(`[Scopus] HTTP ${response.status}, retrying in ${backoff}ms (attempt ${attempt + 1}/${retries})...`);
        await new Promise(resolve => setTimeout(resolve, backoff));
        continue;
      }

      // Non-retryable error
      const errorText = await response.text().catch(() => "");
      console.error(`[Scopus] API error: ${response.status} - ${errorText.substring(0, 200)}`);
      return { response: null, attempts };
    } catch (error: any) {
      const isTimeout = error.name === "AbortError";
      const label = isTimeout ? "Timeout" : "Network error";
      console.error(`[Scopus] ${label}: ${error.message} (attempt ${attempt + 1}/${retries + 1})`);

      if (attempt < retries) {
        const jitter = Math.floor(Math.random() * 300);
        const backoff = BACKOFF_BASE_MS * Math.pow(2, attempt) + jitter;
        await new Promise(resolve => setTimeout(resolve, backoff));
        continue;
      }
    }
  }

  return { response: null, attempts };
}

// =============================================================================
// Spanish → English Translation Dictionary (expanded)
// =============================================================================

const SPANISH_TO_ENGLISH: Record<string, string> = {
  // ── Construction / Engineering ──
  "acero": "steel",
  "reciclado": "recycled",
  "reciclada": "recycled",
  "concreto": "concrete",
  "hormigón": "concrete",
  "hormigon": "concrete",
  "resistencia": "strength",
  "construcción": "construction",
  "construccion": "construction",
  "sostenible": "sustainable",
  "sustentable": "sustainable",
  "sostenibilidad": "sustainability",
  "sustentabilidad": "sustainability",
  "materiales": "materials",
  "material": "material",
  "cemento": "cement",
  "estructuras": "structures",
  "estructura": "structure",
  "edificaciones": "buildings",
  "edificación": "building",
  "edificacion": "building",
  "ingeniería": "engineering",
  "ingenieria": "engineering",
  "civil": "civil",
  "ambiental": "environmental",
  "impacto": "impact",
  "carbono": "carbon",
  "emisiones": "emissions",
  "propiedades": "properties",
  "mecánicas": "mechanical",
  "mecanicas": "mechanical",
  "fibras": "fibers",
  "refuerzo": "reinforcement",
  "influencia": "influence",
  "efecto": "effect",
  "comportamiento": "behavior",
  "análisis": "analysis",
  "analisis": "analysis",
  "evaluación": "evaluation",
  "evaluacion": "evaluation",
  "estudio": "study",
  "investigación": "research",
  "investigacion": "research",
  "artículos": "articles",
  "articulos": "articles",
  "científicos": "scientific",
  "cientificos": "scientific",
  "sismo": "earthquake",
  "sísmico": "seismic",
  "sismico": "seismic",
  "geotecnia": "geotechnical",
  "pavimento": "pavement",
  "asfalto": "asphalt",
  "suelo": "soil",
  "suelos": "soils",
  "cimentación": "foundation",
  "cimentacion": "foundation",
  "puente": "bridge",
  "puentes": "bridges",
  "túnel": "tunnel",
  "tunel": "tunnel",
  "drenaje": "drainage",
  "hidráulica": "hydraulics",
  "hidraulica": "hydraulics",
  "topografía": "topography",
  "topografia": "topography",

  // ── Medical / Health ──
  "embarazo": "pregnancy",
  "embarazada": "pregnant",
  "gestación": "gestation",
  "gestacion": "gestation",
  "prenatal": "prenatal",
  "postnatal": "postnatal",
  "parto": "childbirth",
  "cesárea": "cesarean",
  "cesarea": "cesarean",
  "obstetricia": "obstetrics",
  "ginecología": "gynecology",
  "ginecologia": "gynecology",
  "materno": "maternal",
  "materna": "maternal",
  "fetal": "fetal",
  "neonatal": "neonatal",
  "lactancia": "breastfeeding",
  "amamantar": "breastfeed",
  "recién nacido": "newborn",
  "complicaciones": "complications",
  "riesgo": "risk",
  "factor": "factor",
  "factores": "factors",
  "hospital": "hospital",
  "hospitalario": "hospital",
  "clínico": "clinical",
  "clinico": "clinical",
  "tratamiento": "treatment",
  "diagnóstico": "diagnosis",
  "diagnostico": "diagnosis",
  "paciente": "patient",
  "pacientes": "patients",
  "médico": "medical",
  "medico": "medical",
  "salud": "health",
  "enfermedad": "disease",
  "enfermedades": "diseases",
  "síntoma": "symptom",
  "sintoma": "symptom",
  "síntomas": "symptoms",
  "sintomas": "symptoms",
  "prevención": "prevention",
  "prevencion": "prevention",
  "atención": "care",
  "atencion": "care",
  "nutrición": "nutrition",
  "nutricion": "nutrition",
  "vitamina": "vitamin",
  "ácido fólico": "folic acid",
  "hierro": "iron",
  "anemia": "anemia",
  "diabetes": "diabetes",
  "gestacional": "gestational",
  "hipertensión": "hypertension",
  "hipertension": "hypertension",
  "preeclampsia": "preeclampsia",
  "eclampsia": "eclampsia",
  "mortalidad": "mortality",
  "morbilidad": "morbidity",
  "epidemiología": "epidemiology",
  "epidemiologia": "epidemiology",
  "prevalencia": "prevalence",
  "incidencia": "incidence",
  "farmacología": "pharmacology",
  "farmacologia": "pharmacology",
  "medicamento": "drug",
  "medicamentos": "drugs",
  "fármaco": "drug",
  "farmaco": "drug",
  "terapia": "therapy",
  "cirugía": "surgery",
  "cirugia": "surgery",
  "oncología": "oncology",
  "oncologia": "oncology",
  "cáncer": "cancer",
  "cancer": "cancer",
  "tumor": "tumor",
  "inmunología": "immunology",
  "inmunologia": "immunology",
  "vacuna": "vaccine",
  "vacunas": "vaccines",
  "vacunación": "vaccination",
  "vacunacion": "vaccination",
  "infección": "infection",
  "infeccion": "infection",
  "virus": "virus",
  "bacteria": "bacteria",
  "antibiótico": "antibiotic",
  "antibiotico": "antibiotic",
  "resistencia antimicrobiana": "antimicrobial resistance",
  "pandemia": "pandemic",
  "covid": "COVID-19",
  "coronavirus": "coronavirus",
  "obesidad": "obesity",
  "sobrepeso": "overweight",
  "cardíaco": "cardiac",
  "cardiaco": "cardiac",
  "cardiovascular": "cardiovascular",
  "cerebrovascular": "cerebrovascular",
  "neurología": "neurology",
  "neurologia": "neurology",
  "psiquiatría": "psychiatry",
  "psiquiatria": "psychiatry",
  "depresión": "depression",
  "depresion": "depression",
  "ansiedad": "anxiety",
  "estrés": "stress",
  "estres": "stress",
  "rehabilitación": "rehabilitation",
  "rehabilitacion": "rehabilitation",
  "fisioterapia": "physiotherapy",
  "enfermería": "nursing",
  "enfermeria": "nursing",
  "pediatría": "pediatrics",
  "pediatria": "pediatrics",
  "geriatría": "geriatrics",
  "geriatria": "geriatrics",

  // ── Business / Economy / Supply Chain ──
  "economía": "economy",
  "economia": "economy",
  "económico": "economic",
  "economico": "economic",
  "circular": "circular",
  "cadena": "chain",
  "suministro": "supply",
  "logística": "logistics",
  "logistica": "logistics",
  "empresa": "company",
  "empresas": "companies",
  "empresarial": "business",
  "exportadora": "exporting",
  "exportadoras": "exporting",
  "exportación": "export",
  "exportacion": "export",
  "exportar": "export",
  "importación": "import",
  "importacion": "import",
  "comercio": "trade",
  "comercial": "commercial",
  "mercado": "market",
  "mercados": "markets",
  "financiero": "financial",
  "finanzas": "finance",
  "inversión": "investment",
  "inversion": "investment",
  "rentabilidad": "profitability",
  "productividad": "productivity",
  "competitividad": "competitiveness",
  "innovación": "innovation",
  "innovacion": "innovation",
  "emprendimiento": "entrepreneurship",
  "emprendedor": "entrepreneur",
  "pymes": "SMEs",
  "microempresa": "microenterprise",
  "gestión": "management",
  "gestion": "management",
  "administración": "administration",
  "administracion": "administration",
  "estrategia": "strategy",
  "estratégico": "strategic",
  "estrategico": "strategic",
  "liderazgo": "leadership",
  "gobernanza": "governance",
  "contabilidad": "accounting",
  "auditoría": "audit",
  "auditoria": "audit",
  "tributario": "tax",
  "impuesto": "tax",
  "impuestos": "taxes",
  "inflación": "inflation",
  "inflacion": "inflation",
  "pobreza": "poverty",
  "desigualdad": "inequality",
  "desarrollo": "development",
  "crecimiento": "growth",

  // ── Technology / Computing ──
  "tecnología": "technology",
  "tecnologia": "technology",
  "inteligencia artificial": "artificial intelligence",
  "aprendizaje automático": "machine learning",
  "aprendizaje profundo": "deep learning",
  "redes neuronales": "neural networks",
  "algoritmo": "algorithm",
  "algoritmos": "algorithms",
  "software": "software",
  "programación": "programming",
  "programacion": "programming",
  "ciberseguridad": "cybersecurity",
  "seguridad informática": "information security",
  "datos": "data",
  "base de datos": "database",
  "nube": "cloud",
  "computación": "computing",
  "computacion": "computing",
  "internet": "internet",
  "digital": "digital",
  "digitalización": "digitalization",
  "digitalizacion": "digitalization",
  "transformación digital": "digital transformation",
  "robótica": "robotics",
  "robotica": "robotics",
  "automatización": "automation",
  "automatizacion": "automation",
  "blockchain": "blockchain",
  "telecomunicaciones": "telecommunications",
  "sensor": "sensor",
  "sensores": "sensors",
  "simulación": "simulation",
  "simulacion": "simulation",
  "modelado": "modeling",
  "optimización": "optimization",
  "optimizacion": "optimization",

  // ── Education ──
  "educación": "education",
  "educacion": "education",
  "educativo": "educational",
  "enseñanza": "teaching",
  "ensenanza": "teaching",
  "aprendizaje": "learning",
  "pedagogía": "pedagogy",
  "pedagogia": "pedagogy",
  "didáctica": "didactics",
  "didactica": "didactics",
  "currículo": "curriculum",
  "curriculo": "curriculum",
  "docente": "teacher",
  "docentes": "teachers",
  "profesor": "professor",
  "estudiante": "student",
  "estudiantes": "students",
  "alumno": "student",
  "alumnos": "students",
  "universidad": "university",
  "universitario": "university",
  "escolar": "school",
  "escuela": "school",
  "rendimiento académico": "academic performance",
  "competencias": "competencies",
  "evaluación educativa": "educational assessment",
  "deserción": "dropout",
  "desercion": "dropout",
  "alfabetización": "literacy",
  "alfabetizacion": "literacy",
  "inclusión": "inclusion",
  "inclusion": "inclusion",
  "virtual": "virtual",
  "presencial": "face-to-face",

  // ── Psychology ──
  "psicología": "psychology",
  "psicologia": "psychology",
  "psicológico": "psychological",
  "psicologico": "psychological",
  "cognitivo": "cognitive",
  "conductual": "behavioral",
  "emocional": "emotional",
  "bienestar": "well-being",
  "autoestima": "self-esteem",
  "resiliencia": "resilience",
  "motivación": "motivation",
  "motivacion": "motivation",
  "percepción": "perception",
  "percepcion": "perception",
  "personalidad": "personality",
  "trastorno": "disorder",
  "trastornos": "disorders",
  "violencia": "violence",
  "acoso": "bullying",
  "adicción": "addiction",
  "adiccion": "addiction",

  // ── Law / Political Science ──
  "derecho": "law",
  "jurídico": "legal",
  "juridico": "legal",
  "legislación": "legislation",
  "legislacion": "legislation",
  "constitucional": "constitutional",
  "penal": "criminal",
  "laboral": "labor",
  "derechos humanos": "human rights",
  "justicia": "justice",
  "política": "policy",
  "politica": "policy",
  "políticas públicas": "public policy",
  "gobierno": "government",
  "democracia": "democracy",
  "corrupción": "corruption",
  "corrupcion": "corruption",
  "migración": "migration",
  "migracion": "migration",
  "migrante": "migrant",
  "refugiado": "refugee",

  // ── Environment / Agriculture ──
  "medio ambiente": "environment",
  "contaminación": "pollution",
  "contaminacion": "pollution",
  "residuos": "waste",
  "reciclaje": "recycling",
  "biodiversidad": "biodiversity",
  "ecosistema": "ecosystem",
  "deforestación": "deforestation",
  "deforestacion": "deforestation",
  "cambio climático": "climate change",
  "calentamiento global": "global warming",
  "energía renovable": "renewable energy",
  "energía solar": "solar energy",
  "energía eólica": "wind energy",
  "agua": "water",
  "hídrico": "water",
  "hidrico": "water",
  "agricultura": "agriculture",
  "agrícola": "agricultural",
  "agricola": "agricultural",
  "cultivo": "crop",
  "cultivos": "crops",
  "ganadería": "livestock",
  "ganaderia": "livestock",
  "pecuario": "livestock",
  "agroecología": "agroecology",
  "agroecologia": "agroecology",
  "orgánico": "organic",
  "organico": "organic",
  "riego": "irrigation",
  "fertilizante": "fertilizer",
  "plaguicida": "pesticide",
  "seguridad alimentaria": "food security",
  "alimento": "food",
  "alimentos": "food",

  // ── Social Sciences ──
  "sociología": "sociology",
  "sociologia": "sociology",
  "social": "social",
  "sociedad": "society",
  "comunidad": "community",
  "comunidades": "communities",
  "cultura": "culture",
  "cultural": "cultural",
  "identidad": "identity",
  "género": "gender",
  "genero": "gender",
  "feminismo": "feminism",
  "familia": "family",
  "niñez": "childhood",
  "ninez": "childhood",
  "adolescencia": "adolescence",
  "juventud": "youth",
  "envejecimiento": "aging",
  "urbano": "urban",
  "rural": "rural",
  "territorio": "territory",
  "población": "population",
  "poblacion": "population",
  "demografía": "demography",
  "demografia": "demography",
  "participación": "participation",
  "participacion": "participation",
  "ciudadanía": "citizenship",
  "ciudadania": "citizenship",

  // ── General Academic ──
  "método": "method",
  "metodo": "method",
  "métodos": "methods",
  "metodos": "methods",
  "metodología": "methodology",
  "metodologia": "methodology",
  "cualitativo": "qualitative",
  "cuantitativo": "quantitative",
  "mixto": "mixed",
  "muestra": "sample",
  "encuesta": "survey",
  "entrevista": "interview",
  "revisión sistemática": "systematic review",
  "metaanálisis": "meta-analysis",
  "metaanalisis": "meta-analysis",
  "resultado": "result",
  "resultados": "results",
  "conclusión": "conclusion",
  "conclusion": "conclusion",
  "hipótesis": "hypothesis",
  "hipotesis": "hypothesis",
  "variable": "variable",
  "variables": "variables",
  "correlación": "correlation",
  "correlacion": "correlation",
  "regresión": "regression",
  "regresion": "regression",
  "estadística": "statistics",
  "estadistica": "statistics",
  "significativo": "significant",
  "modelo": "model",
  "modelos": "models",
  "teoría": "theory",
  "teoria": "theory",
  "marco teórico": "theoretical framework",
  "literatura": "literature",
  "revisión": "review",
  "revision": "review",
  "perspectiva": "perspective",
  "enfoque": "approach",
  "comparativo": "comparative",
  "longitudinal": "longitudinal",
  "transversal": "cross-sectional",
  "experimental": "experimental",
  "observacional": "observational",
  "caso de estudio": "case study",
  "evidencia": "evidence",
  "índice": "index",
  "indice": "index",
  "indicador": "indicator",
  "indicadores": "indicators",
  "desempeño": "performance",
  "desempeno": "performance",
  "eficiencia": "efficiency",
  "eficacia": "efficacy",
  "efectividad": "effectiveness",
  "implementación": "implementation",
  "implementacion": "implementation",
  "intervención": "intervention",
  "intervencion": "intervention",
  "programa": "program",
  "proyecto": "project",
  "tendencia": "trend",
  "tendencias": "trends",
  "impacto ambiental": "environmental impact",
  "responsabilidad social": "social responsibility",
  "calidad": "quality",
  "mejora continua": "continuous improvement",
  "norma": "standard",
  "normas": "standards",
  "certificación": "certification",
  "certificacion": "certification",
};

// =============================================================================
// Phrase Map (multi-word Spanish → English academic phrases)
// =============================================================================

const PHRASE_MAP: Array<{ re: RegExp; add: string[] }> = [
  // Economy / Business
  { re: /\beconomia\s+circular\b/i, add: ["circular economy"] },
  { re: /\bcadena\s+de\s+suministro\b/i, add: ["supply chain"] },
  { re: /\bempresa(s)?\s+exportadora(s)?\b/i, add: ["export*"] },
  { re: /\bdesarrollo\s+sostenible\b/i, add: ["sustainable development"] },
  { re: /\bdesarrollo\s+sustentable\b/i, add: ["sustainable development"] },
  { re: /\bresponsabilidad\s+social\b/i, add: ["social responsibility", "CSR"] },
  { re: /\bresponsabilidad\s+social\s+empresarial\b/i, add: ["corporate social responsibility"] },
  { re: /\bcomercio\s+internacional\b/i, add: ["international trade"] },
  { re: /\bcomercio\s+exterior\b/i, add: ["foreign trade"] },
  { re: /\bventaja\s+competitiva\b/i, add: ["competitive advantage"] },
  { re: /\bgestion\s+del?\s+conocimiento\b/i, add: ["knowledge management"] },
  { re: /\bgestion\s+de\s+calidad\b/i, add: ["quality management"] },
  { re: /\bmejora\s+continua\b/i, add: ["continuous improvement"] },
  { re: /\bbalance\s+scorecard\b/i, add: ["balanced scorecard"] },
  { re: /\bcadena\s+de\s+valor\b/i, add: ["value chain"] },

  // Technology
  { re: /\binteligencia\s+artificial\b/i, add: ["artificial intelligence", "AI"] },
  { re: /\baprendizaje\s+(automatico|de\s+maquina)\b/i, add: ["machine learning"] },
  { re: /\baprendizaje\s+profundo\b/i, add: ["deep learning"] },
  { re: /\bredes?\s+neuronal(es)?\b/i, add: ["neural network*"] },
  { re: /\btransformacion\s+digital\b/i, add: ["digital transformation"] },
  { re: /\binternet\s+de\s+las\s+cosas\b/i, add: ["internet of things", "IoT"] },
  { re: /\bciencia\s+de\s+datos\b/i, add: ["data science"] },
  { re: /\bmineria\s+de\s+datos\b/i, add: ["data mining"] },
  { re: /\bcomputacion\s+en\s+la\s+nube\b/i, add: ["cloud computing"] },
  { re: /\brealidad\s+(virtual|aumentada)\b/i, add: ["virtual reality", "augmented reality"] },
  { re: /\bseguridad\s+informatica\b/i, add: ["cybersecurity", "information security"] },
  { re: /\bbase\s+de\s+datos\b/i, add: ["database"] },
  { re: /\bprocesamiento\s+de\s+lenguaje\s+natural\b/i, add: ["natural language processing", "NLP"] },
  { re: /\bvision\s+por\s+computador(a)?\b/i, add: ["computer vision"] },

  // Health / Medicine
  { re: /\bsalud\s+publica\b/i, add: ["public health"] },
  { re: /\bsalud\s+mental\b/i, add: ["mental health"] },
  { re: /\batencion\s+primaria\b/i, add: ["primary care", "primary health care"] },
  { re: /\bresistencia\s+antimicrobiana\b/i, add: ["antimicrobial resistance"] },
  { re: /\bensayo\s+clinico\b/i, add: ["clinical trial"] },
  { re: /\bfactor(es)?\s+de\s+riesgo\b/i, add: ["risk factor*"] },
  { re: /\bcalidad\s+de\s+vida\b/i, add: ["quality of life"] },
  { re: /\bseguridad\s+del?\s+paciente\b/i, add: ["patient safety"] },
  { re: /\benfermedades?\s+cronica(s)?\b/i, add: ["chronic disease*"] },
  { re: /\benfermedades?\s+cardiovascular(es)?\b/i, add: ["cardiovascular disease*"] },
  { re: /\bacido\s+folico\b/i, add: ["folic acid"] },
  { re: /\brecien\s+nacido(s)?\b/i, add: ["newborn*"] },
  { re: /\bparto\s+prematuro\b/i, add: ["preterm birth", "premature birth"] },
  { re: /\bmortalidad\s+materna\b/i, add: ["maternal mortality"] },
  { re: /\bmortalidad\s+infantil\b/i, add: ["infant mortality"] },

  // Education
  { re: /\beducacion\s+superior\b/i, add: ["higher education"] },
  { re: /\beducacion\s+basica\b/i, add: ["basic education", "primary education"] },
  { re: /\beducacion\s+virtual\b/i, add: ["online education", "e-learning"] },
  { re: /\beducacion\s+a\s+distancia\b/i, add: ["distance education", "e-learning"] },
  { re: /\brendimiento\s+academico\b/i, add: ["academic performance", "academic achievement"] },
  { re: /\bdesercion\s+escolar\b/i, add: ["school dropout"] },
  { re: /\beducacion\s+inclusiva\b/i, add: ["inclusive education"] },
  { re: /\bnecesidades\s+educativas\s+especiales\b/i, add: ["special educational needs"] },
  { re: /\bformacion\s+docente\b/i, add: ["teacher training"] },

  // Environment
  { re: /\bcambio\s+climatico\b/i, add: ["climate change"] },
  { re: /\bcalentamiento\s+global\b/i, add: ["global warming"] },
  { re: /\benergia\s+renovable\b/i, add: ["renewable energy"] },
  { re: /\benergia\s+solar\b/i, add: ["solar energy"] },
  { re: /\benergia\s+eolica\b/i, add: ["wind energy"] },
  { re: /\bhuella\s+de\s+carbono\b/i, add: ["carbon footprint"] },
  { re: /\bhuella\s+ecologica\b/i, add: ["ecological footprint"] },
  { re: /\bimpacto\s+ambiental\b/i, add: ["environmental impact"] },
  { re: /\bgestion\s+ambiental\b/i, add: ["environmental management"] },
  { re: /\brecursos\s+naturales\b/i, add: ["natural resources"] },
  { re: /\bseguridad\s+alimentaria\b/i, add: ["food security"] },
  { re: /\bcontaminacion\s+del?\s+agua\b/i, add: ["water pollution"] },
  { re: /\bcontaminacion\s+del?\s+aire\b/i, add: ["air pollution"] },
  { re: /\bservicios?\s+ecosistemico(s)?\b/i, add: ["ecosystem service*"] },
  { re: /\beconomia\s+verde\b/i, add: ["green economy"] },

  // Social / Law
  { re: /\bderechos?\s+humanos?\b/i, add: ["human rights"] },
  { re: /\bpoliticas?\s+publicas?\b/i, add: ["public policy"] },
  { re: /\bviolencia\s+de\s+genero\b/i, add: ["gender violence", "gender-based violence"] },
  { re: /\bviolencia\s+domestica\b/i, add: ["domestic violence"] },
  { re: /\bviolencia\s+intrafamiliar\b/i, add: ["domestic violence", "family violence"] },
  { re: /\bjusticia\s+social\b/i, add: ["social justice"] },
  { re: /\bseguridad\s+ciudadana\b/i, add: ["public safety", "citizen security"] },
  { re: /\btrabajo\s+infantil\b/i, add: ["child labor"] },
  { re: /\btrata\s+de\s+personas\b/i, add: ["human trafficking"] },
  { re: /\binclusion\s+social\b/i, add: ["social inclusion"] },
  { re: /\bbrecha\s+digital\b/i, add: ["digital divide"] },

  // Psychology
  { re: /\btrastorno(s)?\s+del?\s+espectro\s+autista\b/i, add: ["autism spectrum disorder*", "ASD"] },
  { re: /\btrastorno\s+por\s+deficit\s+de\s+atencion\b/i, add: ["attention deficit disorder", "ADHD"] },
  { re: /\btrastornos?\s+alimentario(s)?\b/i, add: ["eating disorder*"] },
  { re: /\binteligencia\s+emocional\b/i, add: ["emotional intelligence"] },
  { re: /\bsalud\s+ocupacional\b/i, add: ["occupational health"] },
  { re: /\briesgo\s+psicosocial\b/i, add: ["psychosocial risk"] },
  { re: /\bsindrome\s+de\s+burnout\b/i, add: ["burnout syndrome", "burnout"] },

  // Research methodology
  { re: /\brevision\s+sistematica\b/i, add: ["systematic review"] },
  { re: /\bmetaanalisis\b/i, add: ["meta-analysis"] },
  { re: /\bmeta[\s-]?analisis\b/i, add: ["meta-analysis"] },
  { re: /\bcaso\s+de\s+estudio\b/i, add: ["case study"] },
  { re: /\bestudio\s+de\s+caso\b/i, add: ["case study"] },
  { re: /\bmarco\s+teorico\b/i, add: ["theoretical framework"] },
  { re: /\binvestigacion\s+accion\b/i, add: ["action research"] },
  { re: /\binvestigacion\s+cualitativa\b/i, add: ["qualitative research"] },
  { re: /\binvestigacion\s+cuantitativa\b/i, add: ["quantitative research"] },

  // Construction specifics
  { re: /\bacero\s+reciclado\b/i, add: ["recycled steel"] },
  { re: /\bconcreto\s+reforzado\b/i, add: ["reinforced concrete"] },
  { re: /\bhormigon\s+armado\b/i, add: ["reinforced concrete"] },
  { re: /\bciclo\s+de\s+vida\b/i, add: ["life cycle"] },
  { re: /\banalisis\s+de\s+ciclo\s+de\s+vida\b/i, add: ["life cycle assessment", "LCA"] },
  { re: /\bhuella\s+hidrica\b/i, add: ["water footprint"] },
  { re: /\bconstruccion\s+sostenible\b/i, add: ["sustainable construction", "green building"] },
  { re: /\bedificio(s)?\s+verde(s)?\b/i, add: ["green building*"] },
  { re: /\beficiencia\s+energetica\b/i, add: ["energy efficiency"] },
];

// =============================================================================
// Stopwords
// =============================================================================

const STOPWORDS = new Set([
  // Spanish determiners, prepositions, conjunctions
  "el", "la", "los", "las", "un", "una", "unos", "unas",
  "de", "del", "al", "a", "en", "con", "por", "para", "sobre",
  "y", "o", "que", "como", "su", "sus", "es", "son", "fue", "fueron",
  "está", "estan", "este", "esta", "estos", "estas", "ese", "esa",
  "mi", "tu", "nos", "les", "se", "lo", "le", "me", "te",
  "si", "no", "más", "mas", "muy", "ya", "hay", "ser", "estar",
  "cuando", "donde", "quien", "cual", "entre", "sin", "hasta",
  "ante", "bajo", "desde", "hacia", "según", "segun", "tras",
  // English determiners, prepositions, conjunctions
  "the", "and", "or", "of", "in", "to", "for", "from", "with",
  "is", "are", "was", "were", "be", "been", "being",
  "at", "by", "on", "an", "it", "its", "this", "that",
  "not", "but", "if", "so", "as", "has", "had", "have",
  // Imperative/conversational words in natural language queries
  "uso", "buscarme", "quiero", "necesito", "dame", "encuentra", "busca",
  "colocalo", "ordenado", "tabla", "excel", "word", "pdf",
  "articulos", "cientificos", "favor", "hazme", "ayuda",
  "sobre", "acerca", "respecto", "relacionado", "relacionados",
  "tema", "temas", "informacion", "información",
  "reciente", "recientes", "último", "ultimo", "últimos", "ultimos",
  "mejor", "mejores", "importante", "importantes",
  // Region/filters often included in prompts
  "latinoamerica", "latinoamérica", "america", "américa", "latina", "latam",
  "españa", "espana", "solo", "solamente", "únicamente", "unicamente",
  "mundial", "global", "internacional",
]);

// =============================================================================
// Utility Functions
// =============================================================================

function stripAccents(text: string): string {
  return text.normalize("NFD").replace(/[\u0300-\u036f]/g, "");
}

function quoteIfNeeded(term: string): string {
  const t = term.trim();
  if (!t) return "";
  if (/[*?]/.test(t)) return t;
  if (/\b(AND|OR|NOT)\b/i.test(t)) return t;
  if (/\s|[()]/.test(t)) return `"${t.replace(/"/g, "")}"`;
  return t.replace(/"/g, "");
}

function sanitizeQueryInput(query: string): string {
  return sanitizePlainText(query, { maxLen: 2000, collapseWs: true });
}

function detectLanguageName(text: string): string {
  const sample = (text || "").replace(/\s+/g, " ").trim().slice(0, 2000);
  if (sample.length < 30) return "Unknown";
  const code = franc(sample);
  switch (code) {
    case "spa": return "Spanish";
    case "por": return "Portuguese";
    case "eng": return "English";
    case "fra": return "French";
    case "deu": return "German";
    case "ita": return "Italian";
    case "zho": return "Chinese";
    case "jpn": return "Japanese";
    case "kor": return "Korean";
    case "ara": return "Arabic";
    case "tur": return "Turkish";
    default: return "Unknown";
  }
}

// =============================================================================
// Keyword Extraction (improved)
// =============================================================================

export function extractSearchKeywords(query: string): ExtractedKeywords {
  const sanitized = sanitizeQueryInput(query);
  if (!sanitized) {
    return { coreKeywords: [], allKeywords: [], detectedLanguage: "Unknown" };
  }

  // Extract year ranges: "2020 al 2024", "2020-2024", "2020 to 2024", "desde 2020 hasta 2024"
  const yearMatch = sanitized.match(/(?:desde\s+)?(\d{4})\s*(?:al|-|hasta|to|a)\s*(\d{4})/i);
  const singleYearMatch = !yearMatch ? sanitized.match(/(?:desde|from|after|año|year)\s+(\d{4})/i) : null;

  let yearRange: { start: number; end: number } | undefined;
  if (yearMatch) {
    const s = parseInt(yearMatch[1]);
    const e = parseInt(yearMatch[2]);
    if (s >= 1900 && s <= 2100 && e >= 1900 && e <= 2100) {
      yearRange = { start: Math.min(s, e), end: Math.max(s, e) };
    }
  } else if (singleYearMatch) {
    const y = parseInt(singleYearMatch[1]);
    if (y >= 1900 && y <= 2100) {
      yearRange = { start: y, end: new Date().getFullYear() };
    }
  }

  let cleanQuery = sanitized
    .toLowerCase()
    .replace(/(?:desde\s+)?\d{4}\s*(?:al|-|hasta|to|a)\s*\d{4}/gi, "")
    .replace(/(?:desde|from|after|año|year)\s+\d{4}/gi, "")
    .replace(/[""\"\']/g, "")
    .replace(/[^\w\sáéíóúñü\-]/g, " ")
    .replace(/\s+/g, " ")
    .trim();

  const words = cleanQuery.split(/\s+/).filter(Boolean);
  const allKeywords: string[] = [];
  const originalPhrases: string[] = [];

  // 1) Phrase-level enrichment first (multi-word concepts)
  const cleanNoAccents = stripAccents(cleanQuery);
  for (const { re, add } of PHRASE_MAP) {
    if (re.test(cleanNoAccents)) {
      for (const term of add) {
        const t = term.trim();
        if (!t) continue;
        if (!allKeywords.includes(t)) {
          allKeywords.push(t);
          originalPhrases.push(t);
        }
      }
    }
  }

  // 2) Single-word translation and extraction
  for (const word of words) {
    if (word.length < 3) continue;

    const wordNoAccent = stripAccents(word);
    if (STOPWORDS.has(word) || STOPWORDS.has(wordNoAccent)) continue;

    // Try dictionary lookup with original, then accent-stripped
    const translated = SPANISH_TO_ENGLISH[word]
      || SPANISH_TO_ENGLISH[wordNoAccent]
      || word;

    if (!allKeywords.includes(translated) && !STOPWORDS.has(translated)) {
      allKeywords.push(translated);
    }
  }

  // 3) Select core keywords: prefer phrase-level translations, then single high-signal terms
  // Prioritize phrases (multi-word) because they carry more specificity
  const phraseKeywords = allKeywords.filter(k => k.includes(" ") || k.includes("*"));
  const singleKeywords = allKeywords.filter(k => !k.includes(" ") && !k.includes("*"));

  let coreKeywords: string[];
  if (phraseKeywords.length >= 2) {
    coreKeywords = phraseKeywords.slice(0, 3);
  } else if (phraseKeywords.length === 1) {
    coreKeywords = [...phraseKeywords, ...singleKeywords.slice(0, 2)];
  } else {
    coreKeywords = singleKeywords.slice(0, 3);
  }

  const detectedLanguage = detectLanguageName(sanitized);

  console.log(`[Scopus] Extracted keywords:`, { coreKeywords, allKeywords: allKeywords.slice(0, 10), yearRange, detectedLanguage });

  return { coreKeywords, allKeywords, yearRange, detectedLanguage, originalPhrases };
}

// =============================================================================
// Query Building (multi-strategy)
// =============================================================================

export function buildScopusQuery(extracted: ExtractedKeywords): string {
  const { coreKeywords, allKeywords, yearRange } = extracted;

  const keywordsToUse = coreKeywords.length >= 2 ? coreKeywords : allKeywords.slice(0, 5);

  if (keywordsToUse.length === 0) {
    throw new Error("No valid keywords extracted from query");
  }

  const phraseQuery = keywordsToUse.map(quoteIfNeeded).filter(Boolean).join(" AND ");
  let scopusQuery = `TITLE-ABS-KEY(${phraseQuery})`;

  if (yearRange) {
    scopusQuery += ` AND PUBYEAR > ${yearRange.start - 1} AND PUBYEAR < ${yearRange.end + 1}`;
  }

  console.log(`[Scopus] Built query: ${scopusQuery}`);
  return scopusQuery;
}

/**
 * Build a broader fallback query when the primary strict query returns too few results.
 * Uses OR instead of AND, and includes more keywords.
 */
function buildFallbackQuery(extracted: ExtractedKeywords): string {
  const { allKeywords, yearRange } = extracted;

  const kws = allKeywords.slice(0, 8);
  if (kws.length === 0) return "";

  // Use OR for broader recall
  const phraseQuery = kws.map(quoteIfNeeded).filter(Boolean).join(" OR ");
  let scopusQuery = `TITLE-ABS-KEY(${phraseQuery})`;

  if (yearRange) {
    scopusQuery += ` AND PUBYEAR > ${yearRange.start - 1} AND PUBYEAR < ${yearRange.end + 1}`;
  }

  return scopusQuery;
}

export function translateToEnglish(query: string): string {
  const extracted = extractSearchKeywords(query);
  const keywords = extracted.coreKeywords.length >= 2
    ? extracted.coreKeywords
    : extracted.allKeywords.slice(0, 5);
  return keywords.join(" ");
}

// =============================================================================
// Relevance Scoring (weighted)
// =============================================================================

function computeRelevanceScore(
  article: ScopusArticle,
  coreKeywords: string[],
  allKeywords: string[]
): number {
  if (coreKeywords.length === 0 && allKeywords.length === 0) return 0.5;

  const titleLower = (article.title || "").toLowerCase();
  const abstractLower = (article.abstract || "").toLowerCase();
  const keywordsLower = (article.keywords || []).join(" ").toLowerCase();
  const journalLower = (article.journal || "").toLowerCase();

  let score = 0;
  const maxPossible = coreKeywords.length * 3 + allKeywords.length * 1;

  // Core keywords carry more weight: title match (3x), abstract (2x), keyword (1.5x)
  for (const kw of coreKeywords) {
    const kwLower = kw.toLowerCase().replace(/\*/g, "");
    if (titleLower.includes(kwLower)) score += 3;
    else if (keywordsLower.includes(kwLower)) score += 1.5;
    else if (abstractLower.includes(kwLower)) score += 2;
    else if (journalLower.includes(kwLower)) score += 0.5;
  }

  // All keywords carry standard weight
  for (const kw of allKeywords) {
    const kwLower = kw.toLowerCase().replace(/\*/g, "");
    if (titleLower.includes(kwLower)) score += 1;
    else if (abstractLower.includes(kwLower)) score += 0.7;
    else if (keywordsLower.includes(kwLower)) score += 0.5;
  }

  // Bonus for citation count (logarithmic)
  if (article.citationCount > 0) {
    score += Math.min(2, Math.log10(article.citationCount + 1));
  }

  // Bonus for having abstract
  if (article.abstract && article.abstract.length > 100) {
    score += 0.5;
  }

  // Normalize to 0-1
  return Math.min(1, score / Math.max(1, maxPossible));
}

export function filterByRelevance(
  articles: ScopusArticle[],
  requiredKeywords: string[],
  threshold: number = 0
): ScopusArticle[] {
  if (requiredKeywords.length === 0) return articles;

  const minKeywordsRequired = Math.min(2, requiredKeywords.length);

  return articles.filter(article => {
    const searchText = `${article.title} ${article.abstract} ${article.keywords.join(" ")}`.toLowerCase();

    let matchCount = 0;
    for (const keyword of requiredKeywords) {
      const kwLower = keyword.toLowerCase().replace(/\*/g, "");
      if (kwLower.length < 2) continue;
      if (searchText.includes(kwLower)) {
        matchCount++;
      }
    }

    const hasAbstract = article.abstract && article.abstract.length > 50;
    const meetsThreshold = threshold > 0
      ? (article.relevanceScore ?? 0) >= threshold
      : matchCount >= minKeywordsRequired;

    if (!meetsThreshold) {
      console.log(`[Scopus] Filtered out: "${article.title.substring(0, 60)}..." (matched ${matchCount}/${requiredKeywords.length} keywords)`);
    }

    return meetsThreshold && hasAbstract;
  });
}

// =============================================================================
// Main Search Function (hardened)
// =============================================================================

export async function searchScopus(
  query: string,
  options: {
    maxResults?: number;
    startYear?: number;
    endYear?: number;
    documentType?: string;
    affilCountries?: string[];
  } = {}
): Promise<ScopusSearchResult> {
  const apiKey = process.env.SCOPUS_API_KEY;
  if (!apiKey) {
    throw new Error("SCOPUS_API_KEY not configured");
  }

  const sanitized = sanitizeQueryInput(query);
  if (!sanitized) {
    throw new Error("Empty or invalid search query");
  }

  const { maxResults = 25, documentType, affilCountries } = options;
  const startTime = Date.now();
  let totalRetries = 0;

  const extracted = extractSearchKeywords(sanitized);
  console.log(`[Scopus] Original query: "${sanitized}"`);

  if (extracted.allKeywords.length === 0) {
    throw new Error("No valid keywords could be extracted from the query");
  }

  const yearRange = extracted.yearRange ||
    (options.startYear && options.endYear
      ? { start: options.startYear, end: options.endYear }
      : options.startYear
        ? { start: options.startYear, end: new Date().getFullYear() }
        : undefined);

  const searchQuery = buildScopusQuery({ ...extracted, yearRange });

  let finalQuery = searchQuery;
  if (documentType) {
    finalQuery += ` AND DOCTYPE(${quoteIfNeeded(documentType)})`;
  }
  if (affilCountries && affilCountries.length > 0) {
    const clause = buildAffilCountryClause(affilCountries);
    if (clause) finalQuery += ` AND (${clause})`;
  }

  const headers = {
    "X-ELS-APIKey": apiKey,
    "Accept": "application/json",
  };

  // Phase 1: Primary strict query
  let rawArticles: ScopusArticle[] = [];
  let totalResults = 0;
  let queryStrategy = "primary";

  const primaryResult = await fetchScopusPages(finalQuery, headers, maxResults, extracted);
  rawArticles = primaryResult.articles;
  totalResults = primaryResult.totalResults;
  totalRetries += primaryResult.retries;

  // Phase 2: If primary query returned too few results, try broader fallback query
  if (rawArticles.length < maxResults && rawArticles.length < 10) {
    const fallbackQueryStr = buildFallbackQuery({ ...extracted, yearRange });
    if (fallbackQueryStr && fallbackQueryStr !== searchQuery) {
      let fallbackFinal = fallbackQueryStr;
      if (documentType) fallbackFinal += ` AND DOCTYPE(${quoteIfNeeded(documentType)})`;
      if (affilCountries && affilCountries.length > 0) {
        const clause = buildAffilCountryClause(affilCountries);
        if (clause) fallbackFinal += ` AND (${clause})`;
      }

      console.log(`[Scopus] Primary query yielded ${rawArticles.length} results, trying broader fallback...`);
      queryStrategy = "fallback";

      const fallbackResult = await fetchScopusPages(fallbackFinal, headers, maxResults, extracted);
      totalRetries += fallbackResult.retries;

      if (fallbackResult.totalResults > totalResults) {
        totalResults = fallbackResult.totalResults;
      }

      // Merge results, avoiding duplicates by EID
      const seenEids = new Set(rawArticles.map(a => a.eid).filter(Boolean));
      const seenDois = new Set(rawArticles.map(a => a.doi).filter(Boolean));
      for (const art of fallbackResult.articles) {
        if (art.eid && seenEids.has(art.eid)) continue;
        if (art.doi && seenDois.has(art.doi)) continue;
        rawArticles.push(art);
        if (art.eid) seenEids.add(art.eid);
        if (art.doi) seenDois.add(art.doi);
      }
    }
  }

  console.log(`[Scopus] Fetched ${rawArticles.length} raw articles, scoring and filtering...`);

  // Score all articles
  for (const article of rawArticles) {
    article.relevanceScore = computeRelevanceScore(article, extracted.coreKeywords, extracted.allKeywords);
  }

  // Sort by relevance score (descending), then by citation count
  rawArticles.sort((a, b) => {
    const scoreDiff = (b.relevanceScore ?? 0) - (a.relevanceScore ?? 0);
    if (Math.abs(scoreDiff) > 0.1) return scoreDiff;
    return (b.citationCount || 0) - (a.citationCount || 0);
  });

  // Tiered filtering: strict → relaxed → has-abstract
  let filteredArticles = filterByRelevance(rawArticles, extracted.coreKeywords);

  if (filteredArticles.length < maxResults) {
    const relaxedKeywords = extracted.allKeywords.slice(0, 8);
    const relaxed = filterByRelevance(rawArticles, relaxedKeywords);
    if (relaxed.length > filteredArticles.length) {
      filteredArticles = relaxed;
    }
  }

  if (filteredArticles.length < maxResults) {
    filteredArticles = rawArticles.filter(a => a.abstract && a.abstract.length > 50);
  }

  // Final fallback: return whatever we have if all filters fail
  if (filteredArticles.length === 0 && rawArticles.length > 0) {
    filteredArticles = rawArticles;
  }

  const finalArticles = filteredArticles.slice(0, maxResults);

  console.log(`[Scopus] After filtering: ${filteredArticles.length} relevant, returning ${finalArticles.length} (strategy: ${queryStrategy}, retries: ${totalRetries})`);

  return {
    articles: finalArticles,
    totalResults,
    query: searchQuery,
    searchTime: Date.now() - startTime,
    retries: totalRetries,
    queryStrategy,
  };
}

// =============================================================================
// Page Fetching (extracted for reuse with primary + fallback queries)
// =============================================================================

async function fetchScopusPages(
  query: string,
  headers: Record<string, string>,
  maxResults: number,
  extracted: ExtractedKeywords
): Promise<{ articles: ScopusArticle[]; totalResults: number; retries: number }> {
  const rawArticles: ScopusArticle[] = [];
  let totalResults = 0;
  let retries = 0;
  let start = 0;
  const targetRaw = maxResults * 3;
  const pageSize = Math.min(maxResults, MAX_PAGE_SIZE);

  const params = new URLSearchParams({
    query,
    count: pageSize.toString(),
    start: "0",
    sort: "-citedby-count",
    field: "dc:title,dc:creator,prism:coverDate,prism:publicationName,dc:description,authkeywords,prism:doi,citedby-count,subtypeDescription,dc:identifier,eid,affiliation,author",
  });

  while (rawArticles.length < targetRaw) {
    params.set("start", start.toString());

    const url = `${SCOPUS_API_BASE}?${params}`;
    const result = await fetchWithRetry(url, headers);
    retries += result.attempts - 1;

    if (!result.response) {
      console.error(`[Scopus] Failed to fetch page at offset ${start} after retries`);
      break;
    }

    let data: any;
    try {
      data = await result.response.json();
    } catch (parseError) {
      console.error(`[Scopus] JSON parse error for page at offset ${start}`);
      break;
    }

    const searchResults = data["search-results"];
    if (!searchResults || !searchResults.entry) break;

    totalResults = parseInt(searchResults["opensearch:totalResults"] || "0", 10);
    if (start === 0) {
      console.log(`[Scopus] Total in database: ${totalResults}`);
    }

    const entries = searchResults.entry;
    if (!Array.isArray(entries) || entries.length === 0) break;

    for (const entry of entries) {
      if (entry.error) continue;

      const eid = entry["eid"] || "";
      const scopusId = entry["dc:identifier"]?.replace("SCOPUS_ID:", "") || "";

      const scopusUrl = eid
        ? `https://www.scopus.com/record/display.uri?eid=${eid}&origin=resultslist`
        : entry.link?.find((l: any) => l["@ref"] === "scopus")?.["@href"] || "";

      const affiliationsList = extractAffiliations(entry.affiliation);
      const primaryAffiliation = getPrimaryAffiliation(entry.affiliation);

      const article: ScopusArticle = {
        scopusId,
        eid,
        title: entry["dc:title"] || "",
        authors: extractAuthors(entry),
        year: extractYear(entry["prism:coverDate"]),
        journal: entry["prism:publicationName"] || "",
        abstract: entry["dc:description"] || "",
        keywords: extractKeywords(entry["authkeywords"]),
        doi: entry["prism:doi"] || "",
        citationCount: parseInt(entry["citedby-count"] || "0", 10),
        documentType: entry["subtypeDescription"] || "Article",
        subtypeDescription: entry["subtypeDescription"],
        language: detectLanguageName(entry["dc:description"] || entry["dc:title"] || ""),
        affiliations: affiliationsList,
        affiliationCountry: primaryAffiliation.country,
        affiliationCity: primaryAffiliation.city,
        url: scopusUrl,
      };

      rawArticles.push(article);
      if (rawArticles.length >= targetRaw) break;
    }

    if (entries.length < pageSize || rawArticles.length >= targetRaw) {
      break;
    }

    start += pageSize;
    // Rate limiting handled by fetchWithRetry, but add small delay between pages
    await new Promise(resolve => setTimeout(resolve, 100));
  }

  return { articles: rawArticles, totalResults, retries };
}

// =============================================================================
// Abstract Fetching (hardened)
// =============================================================================

export async function fetchAbstract(scopusId: string): Promise<string> {
  const apiKey = process.env.SCOPUS_API_KEY;
  if (!apiKey || !scopusId) return "";

  const headers = {
    "X-ELS-APIKey": apiKey,
    "Accept": "application/json",
  };

  const result = await fetchWithRetry(`${SCOPUS_ABSTRACT_BASE}/${encodeURIComponent(scopusId)}`, headers, 2);

  if (!result.response) return "";

  try {
    const data = await result.response.json();
    return data["abstracts-retrieval-response"]?.coredata?.["dc:description"] || "";
  } catch {
    return "";
  }
}

// =============================================================================
// Conversion Utilities
// =============================================================================

export function scopusArticlesToSourceSignals(articles: ScopusArticle[]): SourceSignal[] {
  return articles.map((article, index) => ({
    id: `scopus_${article.scopusId || article.eid || index}`,
    url: article.url,
    title: article.title,
    snippet: article.abstract.substring(0, 300),
    domain: "scopus.com",
    score: Math.min(1, article.relevanceScore ?? (0.5 + (article.citationCount / 100))),
    fetched: true,
    content: article.abstract,
    claims: [],
    scopusData: article,
  }));
}

export function buildAffilCountryClause(countries: string[]): string {
  const unique = Array.from(new Set((countries || []).map(c => (c || "").trim()).filter(Boolean)));
  if (unique.length === 0) return "";
  return unique.map(c => `AFFILCOUNTRY(${quoteIfNeeded(c)})`).join(" OR ");
}

// =============================================================================
// Data Extraction Helpers
// =============================================================================

function extractAuthors(entry: any): string[] {
  if (entry.author && Array.isArray(entry.author)) {
    return entry.author.map((a: any) => {
      if (a.authname) return a.authname;
      const given = a["given-name"] || a["ce:given-name"] || "";
      const surname = a.surname || a["ce:surname"] || "";
      return `${surname}, ${given}`.trim();
    }).filter(Boolean);
  }
  if (entry["dc:creator"]) {
    return [entry["dc:creator"]];
  }
  return [];
}

function extractYear(coverDate: string | undefined): string {
  if (!coverDate) return "";
  const match = coverDate.match(/(\d{4})/);
  return match ? match[1] : "";
}

function extractKeywords(authkeywords: string | undefined): string[] {
  if (!authkeywords) return [];
  return authkeywords.split("|").map(k => k.trim()).filter(Boolean);
}

function extractAffiliations(affiliations: any): string[] {
  if (!affiliations) return [];
  if (!Array.isArray(affiliations)) affiliations = [affiliations];
  return affiliations.map((a: any) => {
    const name = a.affilname || "";
    const city = a["affiliation-city"] || "";
    const country = a["affiliation-country"] || "";
    return [name, city, country].filter(Boolean).join(", ");
  }).filter(Boolean);
}

function getPrimaryAffiliation(affiliations: any): { country: string; city: string } {
  if (!affiliations) return { country: "", city: "" };
  if (!Array.isArray(affiliations)) affiliations = [affiliations];
  if (affiliations.length === 0) return { country: "", city: "" };

  const first = affiliations[0];
  return {
    country: first["affiliation-country"] || "",
    city: first["affiliation-city"] || "",
  };
}

// =============================================================================
// Configuration Check
// =============================================================================

export function isScopusConfigured(): boolean {
  return !!process.env.SCOPUS_API_KEY;
}
