import { GoogleGenAI } from "@google/genai";
import type { IntentType } from "../../../shared/schemas/intent";
import { logStructured } from "./telemetry";

const isTestEnv =
  process.env.NODE_ENV === "test" ||
  !!process.env.VITEST_WORKER_ID ||
  !!process.env.VITEST_POOL_ID;

// Only initialize AI if we have a valid key AND we're not in tests (avoid network flakiness/timeouts)
const hasGeminiKey =
  !isTestEnv && !!(process.env.GEMINI_API_KEY && process.env.GEMINI_API_KEY.trim().length > 10);
const ai = hasGeminiKey ? new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY! }) : null;

// NOTE: In some Gemini projects/keys, `text-embedding-004` is not available.
// Use env override so production can select an available embedding model.
const EMBEDDING_MODEL = process.env.GEMINI_EMBEDDING_MODEL || "gemini-embedding-001";
const EMBEDDING_DIMENSIONS = 768;
const BATCH_SIZE = 100;
const RATE_LIMIT_DELAY_MS = 100;
const MAX_RETRIES = 3;

interface IndexedExample {
  intent: IntentType;
  text: string;
  embedding: number[];
  layer: number;
  neighbors: number[];
}

interface HNSWConfig {
  M: number;
  efConstruction: number;
  efSearch: number;
  maxLayers: number;
}

const DEFAULT_HNSW_CONFIG: HNSWConfig = {
  M: 16,
  efConstruction: 200,
  efSearch: 100,
  maxLayers: 6
};

const INTENT_EXAMPLES: Record<IntentType, string[]> = {
  CREATE_PRESENTATION: [
    "create a powerpoint about artificial intelligence",
    "make me a presentation on climate change",
    "generate slides for my sales pitch",
    "build a slide deck about our quarterly results",
    "I need a ppt on machine learning",
    "prepare presentation slides about marketing strategy",
    "design a slideshow for the conference",
    "crear una presentacion sobre inteligencia artificial",
    "hazme unas diapositivas de marketing",
    "generar pptx sobre el mercado",
    "arma un powerpoint de ventas",
    "necesito una presentacion sobre el proyecto",
    "prepara unas slides sobre finanzas",
    "faire une présentation sur le marketing",
    "créer des diapositives sur la technologie",
    "préparer une présentation powerpoint",
    "erstelle eine präsentation über das projekt",
    "mach mir eine powerpoint über marketing",
    "bereite eine präsentation vor über",
    "criar uma apresentacao sobre vendas",
    "fazer slides sobre tecnologia",
    "preparar apresentação de powerpoint",
    "creare una presentazione sul prodotto",
    "fare delle slide sulla strategia",
    "preparare una presentazione aziendale",
    "make a deck about startup funding",
    "create investor pitch slides",
    "generate training presentation",
    "build onboarding slideshow",
    "prepare keynote presentation",
    "crea un ppt de recursos humanos",
    "genera una presentacion ejecutiva",
    "haz slides para la junta directiva",
    "diseña diapositivas sobre innovación",
    "prepara una presentacion de producto",
    "faire un diaporama sur la finance",
    "créer une présentation commerciale",
    "préparer des slides pour la réunion",
    "erstelle folien für das meeting",
    "mach eine präsentation über digitalisierung",
    "create quarterly earnings presentation",
    "make product launch slides",
    "generate company overview deck",
    "build team introduction slideshow",
    "prepare project status presentation",
    "crea slides del plan de negocio",
    "genera diapositivas de resultados",
    "haz una presentacion de estrategia",
    "prepara ppt sobre sostenibilidad",
    "diseña slides para el cliente",
    "أنشئ عرض تقديمي عن الذكاء الاصطناعي",
    "اصنع شرائح عن التسويق",
    "حضر عرض تقديمي للاجتماع",
    "أعد عرض عن المبيعات",
    "صمم شرائح باوربوينت",
    "प्रस्तुति बनाएं कृत्रिम बुद्धिमत्ता के बारे में",
    "मार्केटिंग पर स्लाइड बनाओ",
    "बिक्री के लिए पीपीटी तैयार करें",
    "प्रोजेक्ट के बारे में प्रस्तुति बनाएं",
    "मीटिंग के लिए स्लाइड्स बनाओ",
    "AIについてのプレゼンを作成して",
    "マーケティングのスライドを作って",
    "販売戦略のパワーポイントを準備して",
    "会議用のプレゼンテーションを作成",
    "製品紹介のスライドを生成して",
    "인공지능에 대한 프레젠테이션을 만들어줘",
    "마케팅 슬라이드 작성해",
    "분기 결과 발표자료 만들기",
    "프로젝트 상태 프레젠테이션 준비해",
    "팀 소개 슬라이드 생성",
    "创建一个关于人工智能的演示",
    "制作营销幻灯片",
    "生成销售演示文稿",
    "准备季度业绩演示",
    "做一个产品发布ppt",
    "создай презентацию про искусственный интеллект",
    "сделай слайды о маркетинге",
    "подготовь презентацию для встречи",
    "создать powerpoint о продажах",
    "сделать презентацию о проекте",
    "yapay zeka hakkında sunum oluştur",
    "pazarlama sunumu hazırla",
    "satış için slaytlar yap",
    "proje durumu sunumu oluştur",
    "toplantı için powerpoint hazırla",
    "buat presentasi tentang kecerdasan buatan",
    "siapkan slide pemasaran",
    "buat ppt penjualan",
    "hasilkan presentasi proyek",
    "persiapkan slide untuk rapat"
  ],
  CREATE_DOCUMENT: [
    "write a report on market trends",
    "create a document about the project status",
    "generate a word document with meeting notes",
    "make me an essay on renewable energy",
    "draft a business proposal",
    "compose a technical specification",
    "prepare a project charter",
    "crear un documento sobre el proyecto",
    "escribir un informe de resultados",
    "generar un reporte en word",
    "hazme un documento con las conclusiones",
    "redacta un ensayo sobre economía",
    "prepara un acta de reunión",
    "escribe las especificaciones técnicas",
    "rédiger un rapport sur les ventes",
    "créer un document de synthèse",
    "préparer un compte-rendu de réunion",
    "dokument erstellen über das meeting",
    "einen bericht schreiben über",
    "ein word dokument erstellen",
    "criar um documento sobre o cliente",
    "escrever um relatório de vendas",
    "gerar um documento word",
    "scrivere un documento sul prodotto",
    "creare un rapporto sulle vendite",
    "preparare un documento tecnico",
    "write executive summary",
    "create project documentation",
    "generate status report",
    "draft meeting minutes",
    "compose white paper",
    "crea un informe ejecutivo",
    "escribe documentación del proyecto",
    "genera un reporte de avance",
    "redacta las minutas de reunión",
    "prepara un documento de análisis",
    "rédiger un document technique",
    "créer un résumé exécutif",
    "préparer la documentation projet",
    "schreibe ein protokoll",
    "erstelle eine technische dokumentation",
    "write case study document",
    "create policy document",
    "generate user guide",
    "draft contract document",
    "compose newsletter content",
    "crea un caso de estudio",
    "genera un documento de políticas",
    "escribe una guía de usuario",
    "redacta un contrato",
    "prepara contenido de newsletter",
    "أنشئ مستند عن المشروع",
    "اكتب تقرير عن المبيعات",
    "حضر وثيقة تقنية",
    "أعد ملف عن الاجتماع",
    "صمم مستند سياسات",
    "दस्तावेज़ बनाएं प्रोजेक्ट के बारे में",
    "बिक्री रिपोर्ट लिखें",
    "तकनीकी दस्तावेज़ तैयार करें",
    "मीटिंग नोट्स बनाओ",
    "व्यावसायिक प्रस्ताव तैयार करें",
    "プロジェクトについてのドキュメントを作成して",
    "報告書を書いて",
    "技術仕様書を作って",
    "会議のメモを作成",
    "契約書を準備して",
    "프로젝트에 대한 문서 작성해",
    "보고서 써줘",
    "기술 문서 만들어",
    "회의록 작성해",
    "사용자 가이드 생성",
    "创建关于项目的文档",
    "写销售报告",
    "生成技术规范文档",
    "准备会议记录",
    "制作用户指南",
    "создай документ о проекте",
    "напиши отчет о продажах",
    "подготовь техническую документацию",
    "создать протокол встречи",
    "написать руководство пользователя",
    "proje hakkında belge oluştur",
    "satış raporu yaz",
    "teknik döküman hazırla",
    "toplantı tutanağı oluştur",
    "kullanıcı kılavuzu yaz",
    "buat dokumen tentang proyek",
    "tulis laporan penjualan",
    "siapkan dokumen teknis",
    "buat notulen rapat",
    "hasilkan panduan pengguna"
  ],
  CREATE_SPREADSHEET: [
    "create an excel with the budget data",
    "make a spreadsheet with sales figures",
    "generate a table with customer information",
    "build an xlsx with financial projections",
    "prepare a data sheet with inventory",
    "design a tracking spreadsheet",
    "set up a budget worksheet",
    "crear un excel con los datos de ventas",
    "hazme una tabla con los gastos",
    "generar una hoja de calculo con el presupuesto",
    "arma un excel con las metricas",
    "prepara una planilla de seguimiento",
    "diseña una tabla de inventario",
    "crea un worksheet de finanzas",
    "créer un tableur avec les données",
    "faire un excel de suivi des ventes",
    "préparer une feuille de calcul budget",
    "excel erstellen mit den verkaufszahlen",
    "eine tabelle machen mit kundendaten",
    "ein spreadsheet vorbereiten",
    "criar uma planilha com os dados",
    "fazer um excel de controle",
    "gerar uma tabela de vendas",
    "creare un foglio excel con i numeri",
    "fare una tabella con i dati",
    "preparare un foglio di calcolo",
    "create sales tracking sheet",
    "build expense report spreadsheet",
    "generate inventory worksheet",
    "make project timeline table",
    "design KPI dashboard sheet",
    "crea una hoja de seguimiento",
    "genera un excel de gastos",
    "haz una tabla de inventario",
    "prepara un worksheet de KPIs",
    "diseña una planilla de proyectos",
    "créer un tableau de bord excel",
    "faire une feuille de suivi",
    "préparer un tableur d'inventaire",
    "erstelle eine tracking tabelle",
    "mach ein ausgaben spreadsheet",
    "create employee roster sheet",
    "build customer database excel",
    "generate financial model spreadsheet",
    "make scheduling worksheet",
    "design capacity planning table",
    "crea un roster de empleados",
    "genera una base de datos en excel",
    "haz un modelo financiero",
    "prepara una hoja de horarios",
    "diseña una tabla de capacidad",
    "أنشئ جدول ببيانات المبيعات",
    "اصنع جدول بيانات للميزانية",
    "حضر ورقة عمل للمخزون",
    "أعد إكسل بالأرقام المالية",
    "صمم جدول متابعة",
    "एक्सेल बनाएं बिक्री डेटा के साथ",
    "स्प्रेडशीट बनाओ बजट के लिए",
    "इन्वेंटरी टेबल तैयार करें",
    "वित्तीय मॉडल बनाएं",
    "ट्रैकिंग शीट बनाओ",
    "売上データのエクセルを作成して",
    "予算のスプレッドシートを作って",
    "在庫管理の表を準備して",
    "財務モデルのエクセル作成",
    "追跡シートを作って",
    "판매 데이터 엑셀 만들어줘",
    "예산 스프레드시트 작성해",
    "재고 테이블 준비해",
    "재무 모델 엑셀 생성",
    "추적 시트 만들어",
    "创建销售数据的电子表格",
    "制作预算excel",
    "生成库存表格",
    "准备财务模型表格",
    "做一个跟踪表",
    "создай таблицу с данными о продажах",
    "сделай excel с бюджетом",
    "подготовь таблицу инвентаря",
    "создать финансовую модель в excel",
    "сделать таблицу отслеживания",
    "satış verileriyle excel oluştur",
    "bütçe tablosu hazırla",
    "envanter tablosu yap",
    "finansal model excel oluştur",
    "takip tablosu hazırla",
    "buat excel dengan data penjualan",
    "siapkan spreadsheet anggaran",
    "buat tabel inventaris",
    "hasilkan model keuangan excel",
    "buat lembar pelacakan"
  ],
  SUMMARIZE: [
    "summarize this document for me",
    "give me a brief summary of the text",
    "what are the key points",
    "condense this into bullet points",
    "provide a synopsis of the content",
    "give me the highlights",
    "extract the main ideas",
    "resumeme este documento",
    "hazme un resumen del texto",
    "cuales son los puntos clave",
    "sintetiza esta informacion",
    "dame los puntos principales",
    "extrae las ideas centrales",
    "haz un resumen ejecutivo",
    "résumer ce document",
    "donner un résumé du texte",
    "quels sont les points clés",
    "zusammenfassung des textes",
    "gib mir die wichtigsten punkte",
    "fasse das zusammen",
    "resumir este documento",
    "dar um resumo do texto",
    "quais são os pontos principais",
    "riassumere questo testo",
    "dammi un riassunto",
    "quali sono i punti chiave",
    "tldr this document",
    "brief me on this content",
    "what does this say in short",
    "summarize in 3 sentences",
    "give me the executive summary",
    "resumelo en 3 frases",
    "dame el tldr",
    "hazme un brief del contenido",
    "sintetiza en puntos clave",
    "resumen corto por favor",
    "fais-moi un résumé rapide",
    "résume en quelques phrases",
    "donne-moi l'essentiel",
    "kurze zusammenfassung bitte",
    "was sind die hauptpunkte",
    "digest this information",
    "compress this to main points",
    "outline the key takeaways",
    "what's the gist",
    "break down the main points",
    "resumelo rapido",
    "extrae lo importante",
    "dame la esencia",
    "puntos clave del documento",
    "resumen en viñetas",
    "لخص هذا المستند",
    "أعطني ملخص النص",
    "ما هي النقاط الرئيسية",
    "اختصر هذا المحتوى",
    "استخرج الأفكار الرئيسية",
    "इस दस्तावेज़ का सारांश दें",
    "पाठ का संक्षिप्त विवरण दें",
    "मुख्य बिंदु क्या हैं",
    "संक्षेप में बताएं",
    "महत्वपूर्ण बातें निकालें",
    "この文書を要約して",
    "ポイントを教えて",
    "要点をまとめて",
    "簡潔に説明して",
    "主要なアイデアを抽出",
    "이 문서 요약해줘",
    "핵심 포인트 알려줘",
    "간략히 정리해",
    "주요 내용 추출해",
    "요점만 말해줘",
    "总结这个文档",
    "给我摘要",
    "关键点是什么",
    "简述主要内容",
    "提取要点",
    "подведи итог этого документа",
    "дай краткое содержание",
    "какие ключевые моменты",
    "сжато изложи суть",
    "выдели главное",
    "bu belgeyi özetle",
    "ana noktaları ver",
    "kısaca anlat",
    "özet çıkar",
    "önemli noktaları çıkar",
    "ringkas dokumen ini",
    "berikan ringkasan",
    "apa poin utamanya",
    "intisari dari ini",
    "ekstrak ide utama"
  ],
  TRANSLATE: [
    "translate this to spanish",
    "convert this text to french",
    "translate the document to german",
    "change this to english",
    "put this in italian",
    "render this in portuguese",
    "translate from english to spanish",
    "traduce esto al ingles",
    "pasar este texto a frances",
    "traducir el documento al aleman",
    "cambiar a español",
    "ponlo en italiano",
    "traducir al portugues",
    "pasa esto a ingles",
    "traduire en anglais",
    "traduire ce texte en espagnol",
    "mettre en allemand",
    "ins deutsche übersetzen",
    "auf englisch übersetzen",
    "in spanisch umwandeln",
    "traduzir para portugues",
    "traduzir este texto para inglês",
    "passar para espanhol",
    "tradurre in italiano",
    "tradurre questo in inglese",
    "mettere in francese",
    "translate to chinese",
    "convert to japanese",
    "translate into korean",
    "put this in arabic",
    "render in russian",
    "traduce al chino",
    "traducir al japones",
    "pasar a coreano",
    "ponlo en arabe",
    "traducir al ruso",
    "traduire en chinois",
    "traduire en japonais",
    "mettre en arabe",
    "ins chinesische übersetzen",
    "auf japanisch übersetzen",
    "how do you say this in spanish",
    "what is this in french",
    "english version please",
    "spanish translation needed",
    "german version of this",
    "como se dice en ingles",
    "version en frances por favor",
    "necesito traduccion al aleman",
    "pasalo a portugues",
    "version italiana de esto",
    "ترجم هذا إلى العربية",
    "حول النص إلى الإنجليزية",
    "ترجمة الوثيقة إلى الفرنسية",
    "ضعه بالإسبانية",
    "ترجم من العربية للإنجليزية",
    "इसे हिंदी में अनुवाद करें",
    "अंग्रेजी में बदलें",
    "फ्रेंच में अनुवाद करें",
    "स्पेनिश संस्करण दें",
    "इसे जर्मन में रखें",
    "これを日本語に翻訳して",
    "英語に変換して",
    "スペイン語に訳して",
    "フランス語版をお願い",
    "中国語に翻訳",
    "이것을 한국어로 번역해",
    "영어로 바꿔줘",
    "일본어로 번역해",
    "스페인어 버전 만들어",
    "중국어로 변환",
    "翻译成中文",
    "转换成英文",
    "翻译成日语",
    "翻成韩语",
    "法语版本",
    "переведи на русский",
    "переведи на английский",
    "перевод на испанский",
    "переведи текст на немецкий",
    "на французском языке",
    "bunu türkçeye çevir",
    "ingilizceye çevir",
    "ispanyolcaya tercüme et",
    "almancaya çevir",
    "fransızca versiyonu",
    "terjemahkan ke bahasa indonesia",
    "ubah ke bahasa inggris",
    "terjemahkan ke jepang",
    "versi bahasa spanyol",
    "alih bahasa ke mandarin"
  ],
  SEARCH_WEB: [
    "search for information about climate change",
    "find me data on market trends",
    "look up the latest news on technology",
    "research competitors in the industry",
    "search the web for startup funding",
    "find articles about renewable energy",
    "look for statistics on ecommerce",
    "busca informacion sobre el mercado",
    "encuentra datos sobre la competencia",
    "investiga las tendencias de ventas",
    "buscar en internet sobre el tema",
    "busca noticias sobre tecnologia",
    "encuentra articulos de marketing",
    "investiga sobre startups",
    "rechercher sur le web",
    "trouver des informations sur",
    "chercher des articles sur",
    "im internet suchen nach",
    "suche nach informationen über",
    "finde daten zu",
    "pesquisar sobre o tema",
    "buscar informações sobre",
    "encontrar dados sobre",
    "cercare informazioni su",
    "trovare articoli su",
    "ricercare dati su",
    "google this topic for me",
    "what does the internet say about",
    "find recent news on",
    "search for studies about",
    "look up research on",
    "busca en google sobre",
    "que dice internet sobre",
    "encuentra noticias recientes de",
    "busca estudios sobre",
    "investiga papers de",
    "recherche google sur",
    "qu'est-ce qu'on trouve sur",
    "trouve des études sur",
    "google suche nach",
    "was sagt das internet über",
    "find me information online",
    "search online databases for",
    "look up industry reports on",
    "research market data for",
    "find academic papers about",
    "busca informacion online",
    "investiga en bases de datos",
    "encuentra reportes de industria",
    "busca datos de mercado",
    "encuentra papers academicos",
    "ابحث عن معلومات عن",
    "جد بيانات عن السوق",
    "ابحث في الإنترنت عن",
    "استكشف أخبار التقنية",
    "ابحث عن مقالات عن",
    "जानकारी खोजें",
    "बाजार के रुझान खोजें",
    "इंटरनेट पर खोजें",
    "प्रतिस्पर्धियों पर शोध करें",
    "नवीनतम समाचार खोजें",
    "情報を検索して",
    "マーケットデータを探して",
    "最新ニュースを調べて",
    "競合について調査して",
    "研究論文を見つけて",
    "정보 검색해줘",
    "시장 동향 찾아봐",
    "인터넷에서 검색해",
    "경쟁사 조사해",
    "최신 뉴스 찾아",
    "搜索关于气候变化的信息",
    "查找市场数据",
    "网上搜索这个主题",
    "研究竞争对手",
    "查找最新新闻",
    "найди информацию о",
    "поищи данные о рынке",
    "исследуй тему",
    "найди статьи про",
    "что говорит интернет о",
    "hakkında bilgi ara",
    "pazar verileri bul",
    "internette araştır",
    "rakipler hakkında araştır",
    "son haberleri bul",
    "cari informasi tentang",
    "temukan data pasar",
    "telusuri internet tentang",
    "riset pesaing",
    "cari artikel terbaru"
  ],
  ANALYZE_DOCUMENT: [
    "analyze this report for insights",
    "review the document and give feedback",
    "evaluate the quality of this text",
    "examine the data and find patterns",
    "assess this proposal",
    "critique this document",
    "provide analysis of this content",
    "analiza este informe",
    "revisa el documento",
    "evalua la calidad del texto",
    "examina los datos",
    "valora esta propuesta",
    "critica este documento",
    "dame un analisis del contenido",
    "analyser ce rapport",
    "évaluer ce document",
    "examiner les données",
    "analysieren sie das dokument",
    "bewerte diesen text",
    "untersuche die daten",
    "analisar este relatorio",
    "avaliar este documento",
    "examinar os dados",
    "analizzare questo documento",
    "valutare questo testo",
    "esaminare i dati",
    "what insights can you find",
    "review this for errors",
    "check this document for issues",
    "find problems in this text",
    "evaluate the argument",
    "que insights puedes encontrar",
    "revisa esto por errores",
    "verifica el documento por problemas",
    "encuentra errores en el texto",
    "evalua el argumento",
    "quels insights peux-tu trouver",
    "vérifie les erreurs",
    "trouve les problèmes",
    "welche erkenntnisse findest du",
    "prüfe auf fehler",
    "give me your assessment",
    "what do you think of this",
    "rate this proposal",
    "score this document",
    "provide constructive feedback",
    "dame tu evaluacion",
    "que opinas de esto",
    "califica esta propuesta",
    "puntua este documento",
    "dame feedback constructivo",
    "حلل هذا التقرير",
    "راجع المستند وأعطني رأيك",
    "قيم جودة النص",
    "افحص البيانات",
    "قدم تحليل للمحتوى",
    "इस रिपोर्ट का विश्लेषण करें",
    "दस्तावेज़ की समीक्षा करें",
    "टेक्स्ट की गुणवत्ता का मूल्यांकन करें",
    "डेटा की जांच करें",
    "प्रस्ताव का आकलन करें",
    "このレポートを分析して",
    "ドキュメントをレビューして",
    "テキストの品質を評価して",
    "データを検証して",
    "フィードバックをください",
    "이 보고서 분석해줘",
    "문서 검토해줘",
    "텍스트 품질 평가해",
    "데이터 패턴 찾아줘",
    "제안서 평가해",
    "分析这份报告",
    "审查文档并给出反馈",
    "评估文本质量",
    "检查数据模式",
    "评估这个提案",
    "проанализируй этот отчет",
    "дай оценку документу",
    "оцени качество текста",
    "найди закономерности в данных",
    "дай свой отзыв",
    "bu raporu analiz et",
    "belgeyi gözden geçir",
    "metin kalitesini değerlendir",
    "verileri incele",
    "teklifi değerlendir",
    "analisis laporan ini",
    "tinjau dokumen dan beri masukan",
    "evaluasi kualitas teks",
    "periksa data",
    "nilai proposal ini"
  ],
  CHAT_GENERAL: [
    "hello how are you",
    "thanks for your help",
    "what can you do",
    "tell me about yourself",
    "good morning",
    "nice to meet you",
    "how does this work",
    "hola como estas",
    "gracias por tu ayuda",
    "que puedes hacer",
    "cuentame sobre ti",
    "buenos dias",
    "encantado de conocerte",
    "como funciona esto",
    "bonjour comment allez vous",
    "merci pour votre aide",
    "que pouvez-vous faire",
    "hallo wie geht es dir",
    "danke für die hilfe",
    "was kannst du",
    "ola como voce esta",
    "obrigado pela ajuda",
    "o que voce pode fazer",
    "ciao come stai",
    "grazie per l'aiuto",
    "cosa puoi fare",
    "hey there",
    "what's up",
    "how are you doing",
    "nice talking to you",
    "goodbye",
    "hola que tal",
    "todo bien",
    "como te va",
    "hasta luego",
    "adios",
    "salut ça va",
    "au revoir",
    "à bientôt",
    "tschüss",
    "auf wiedersehen",
    "hi friend",
    "hello assistant",
    "are you there",
    "can you help me",
    "I have a question",
    "hola amigo",
    "estas ahi",
    "me puedes ayudar",
    "tengo una pregunta",
    "necesito ayuda",
    "مرحبا كيف حالك",
    "شكرا لمساعدتك",
    "ماذا يمكنك أن تفعل",
    "صباح الخير",
    "هل يمكنك مساعدتي",
    "नमस्ते कैसे हो",
    "धन्यवाद मदद के लिए",
    "आप क्या कर सकते हैं",
    "सुप्रभात",
    "क्या आप मेरी मदद कर सकते हैं",
    "こんにちは元気ですか",
    "助けてくれてありがとう",
    "何ができますか",
    "おはようございます",
    "手伝ってもらえますか",
    "안녕하세요",
    "도움 감사합니다",
    "뭘 할 수 있어요",
    "좋은 아침이에요",
    "도와주실 수 있나요",
    "你好吗",
    "谢谢你的帮助",
    "你能做什么",
    "早上好",
    "你能帮我吗",
    "привет как дела",
    "спасибо за помощь",
    "что ты умеешь",
    "доброе утро",
    "ты можешь мне помочь",
    "merhaba nasılsın",
    "yardımın için teşekkürler",
    "ne yapabilirsin",
    "günaydın",
    "bana yardım edebilir misin",
    "halo apa kabar",
    "terima kasih bantuannya",
    "apa yang bisa kamu lakukan",
    "selamat pagi",
    "bisakah kamu membantu saya"
  ],
  NEED_CLARIFICATION: []
};

let indexedExamples: IndexedExample[] = [];
let isIndexInitialized = false;
let isIndexInitializing = false;
let initPromise: Promise<void> | null = null;
let embeddingCache = new Map<string, number[]>();

function cosineSimilarity(a: number[], b: number[]): number {
  if (a.length !== b.length) return 0;
  let dotProduct = 0;
  let normA = 0;
  let normB = 0;
  for (let i = 0; i < a.length; i++) {
    dotProduct += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  const magnitude = Math.sqrt(normA) * Math.sqrt(normB);
  return magnitude === 0 ? 0 : dotProduct / magnitude;
}

// Simple TF-IDF style fallback embedding when no API key
function generateSimpleEmbedding(text: string): number[] {
  const normalized = text.toLowerCase().replace(/[^\w\s]/g, "");
  const words = normalized.split(/\s+/).filter(w => w.length > 2);
  const embedding = new Array(EMBEDDING_DIMENSIONS).fill(0);
  
  for (let i = 0; i < words.length; i++) {
    const word = words[i];
    // Use multiple hash positions for better distribution
    const hash1 = Math.abs(hashCode(word)) % EMBEDDING_DIMENSIONS;
    const hash2 = Math.abs(hashCode(word + "_2")) % EMBEDDING_DIMENSIONS;
    const hash3 = Math.abs(hashCode(word + "_3")) % EMBEDDING_DIMENSIONS;
    
    embedding[hash1] += 1 / (i + 1);
    embedding[hash2] += 0.5 / (i + 1);
    embedding[hash3] += 0.25 / (i + 1);
  }
  
  // L2 normalize
  const magnitude = Math.sqrt(embedding.reduce((sum, val) => sum + val * val, 0));
  if (magnitude > 0) {
    for (let i = 0; i < embedding.length; i++) {
      embedding[i] /= magnitude;
    }
  }
  
  return embedding;
}

function hashCode(str: string): number {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    const char = str.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash = hash & hash;
  }
  return hash;
}

async function generateEmbedding(text: string): Promise<number[]> {
  const cacheKey = text.toLowerCase().trim().substring(0, 500);
  const cached = embeddingCache.get(cacheKey);
  if (cached) return cached;

  // If no Gemini API key, use simple fallback immediately
  if (!ai) {
    const embedding = generateSimpleEmbedding(text);
    embeddingCache.set(cacheKey, embedding);
    return embedding;
  }

  for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
    try {
      const result = await ai.models.embedContent({
        model: EMBEDDING_MODEL,
        contents: [{ parts: [{ text }] }]
      });

      const embedding = result.embeddings?.[0]?.values;
      if (!embedding || embedding.length === 0) {
        throw new Error("Empty embedding returned");
      }

      embeddingCache.set(cacheKey, embedding);
      return embedding;
    } catch (error: any) {
      const isRateLimit = error.message?.includes("429") || error.message?.includes("rate");
      if (isRateLimit && attempt < MAX_RETRIES - 1) {
        const delay = RATE_LIMIT_DELAY_MS * Math.pow(2, attempt);
        await new Promise(r => setTimeout(r, delay));
        continue;
      }
      if (attempt === MAX_RETRIES - 1) {
        logStructured("warn", "Embedding generation failed, using fallback", {
          error: error.message,
          text_preview: text.substring(0, 50)
        });
        // Fallback to simple embedding instead of throwing
        const embedding = generateSimpleEmbedding(text);
        embeddingCache.set(cacheKey, embedding);
        return embedding;
      }
    }
  }
  // Final fallback
  const embedding = generateSimpleEmbedding(text);
  embeddingCache.set(cacheKey, embedding);
  return embedding;
}

async function generateEmbeddingsBatch(texts: string[]): Promise<number[][]> {
  const results: number[][] = [];
  
  for (let i = 0; i < texts.length; i += BATCH_SIZE) {
    const batch = texts.slice(i, i + BATCH_SIZE);
    const batchPromises = batch.map(text => generateEmbedding(text));
    const batchResults = await Promise.all(batchPromises);
    results.push(...batchResults);
    
    if (i + BATCH_SIZE < texts.length) {
      await new Promise(r => setTimeout(r, RATE_LIMIT_DELAY_MS));
    }
  }
  
  return results;
}

function selectLayerForNewNode(): number {
  const ml = 1 / Math.log(DEFAULT_HNSW_CONFIG.M);
  return Math.floor(-Math.log(Math.random()) * ml);
}

function selectNeighbors(
  queryEmbedding: number[],
  candidates: number[],
  M: number
): number[] {
  const scored = candidates.map(idx => ({
    idx,
    similarity: cosineSimilarity(queryEmbedding, indexedExamples[idx].embedding)
  }));
  
  scored.sort((a, b) => b.similarity - a.similarity);
  return scored.slice(0, M).map(s => s.idx);
}

function searchLayerGreedy(
  queryEmbedding: number[],
  entryPoint: number,
  ef: number,
  layer: number
): number[] {
  const visited = new Set<number>();
  const candidates: { idx: number; similarity: number }[] = [];
  const results: { idx: number; similarity: number }[] = [];
  
  const startSim = cosineSimilarity(queryEmbedding, indexedExamples[entryPoint].embedding);
  candidates.push({ idx: entryPoint, similarity: startSim });
  results.push({ idx: entryPoint, similarity: startSim });
  visited.add(entryPoint);
  
  while (candidates.length > 0) {
    candidates.sort((a, b) => b.similarity - a.similarity);
    const current = candidates.shift()!;
    
    const worstResult = results.length > 0 
      ? Math.min(...results.map(r => r.similarity))
      : -1;
    
    if (results.length >= ef && current.similarity < worstResult) {
      break;
    }
    
    const example = indexedExamples[current.idx];
    if (example.layer < layer) continue;
    
    for (const neighborIdx of example.neighbors) {
      if (visited.has(neighborIdx)) continue;
      visited.add(neighborIdx);
      
      const neighbor = indexedExamples[neighborIdx];
      if (neighbor.layer < layer) continue;
      
      const similarity = cosineSimilarity(queryEmbedding, neighbor.embedding);
      
      if (results.length < ef || similarity > worstResult) {
        candidates.push({ idx: neighborIdx, similarity });
        results.push({ idx: neighborIdx, similarity });
        
        if (results.length > ef) {
          results.sort((a, b) => b.similarity - a.similarity);
          results.pop();
        }
      }
    }
  }
  
  return results.map(r => r.idx);
}

function insertIntoIndex(
  intent: IntentType,
  text: string,
  embedding: number[]
): void {
  // IMPORTANT: we must add the new node to `indexedExamples` before creating back-links.
  // Otherwise we can temporarily store neighbor references to an index that doesn't exist yet,
  // and traversal can hit `indexedExamples[newIdx] === undefined` (reading '.layer').
  const newIdx = indexedExamples.length;
  const layer = Math.min(selectLayerForNewNode(), DEFAULT_HNSW_CONFIG.maxLayers - 1);

  const newExample: IndexedExample = {
    intent,
    text,
    embedding,
    layer,
    neighbors: [],
  };

  indexedExamples.push(newExample);

  if (newIdx === 0) {
    return;
  }

  let entryPoint = 0;
  for (let l = DEFAULT_HNSW_CONFIG.maxLayers - 1; l > layer; l--) {
    const results = searchLayerGreedy(embedding, entryPoint, 1, l);
    if (results.length > 0) {
      entryPoint = results[0];
    }
  }

  for (let l = layer; l >= 0; l--) {
    const candidates = searchLayerGreedy(
      embedding,
      entryPoint,
      DEFAULT_HNSW_CONFIG.efConstruction,
      l
    );

    const neighbors = selectNeighbors(embedding, candidates, DEFAULT_HNSW_CONFIG.M);

    for (const neighborIdx of neighbors) {
      newExample.neighbors.push(neighborIdx);

      const neighbor = indexedExamples[neighborIdx];
      if (!neighbor) continue;

      if (!neighbor.neighbors.includes(newIdx)) {
        if (neighbor.neighbors.length < DEFAULT_HNSW_CONFIG.M * 2) {
          neighbor.neighbors.push(newIdx);
        } else {
          const allNeighbors = [...neighbor.neighbors, newIdx];
          neighbor.neighbors = selectNeighbors(
            neighbor.embedding,
            allNeighbors,
            DEFAULT_HNSW_CONFIG.M * 2
          );
        }
      }
    }

    if (candidates.length > 0) {
      entryPoint = candidates[0];
    }
  }
}

export async function initializeEmbeddingIndex(): Promise<void> {
  if (isIndexInitialized) return;
  
  if (isIndexInitializing && initPromise) {
    return initPromise;
  }
  
  isIndexInitializing = true;
  
  initPromise = (async () => {
    const startTime = Date.now();
    logStructured("info", "Starting semantic embedding index initialization", {});
    
    try {
      const allTexts: { intent: IntentType; text: string }[] = [];
      
      for (const [intent, examples] of Object.entries(INTENT_EXAMPLES) as [IntentType, string[]][]) {
        if (intent === "NEED_CLARIFICATION") continue;
        for (const text of examples) {
          allTexts.push({ intent, text });
        }
      }
      
      logStructured("info", "Generating embeddings for examples", {
        total_examples: allTexts.length
      });
      
      const batchSize = 20;
      for (let i = 0; i < allTexts.length; i += batchSize) {
        const batch = allTexts.slice(i, i + batchSize);
        const texts = batch.map(b => b.text);
        
        try {
          const embeddings = await generateEmbeddingsBatch(texts);
          
          for (let j = 0; j < batch.length; j++) {
            insertIntoIndex(batch[j].intent, batch[j].text, embeddings[j]);
          }
          
          if (i % 100 === 0 && i > 0) {
            logStructured("info", "Index build progress", {
              indexed: indexedExamples.length,
              total: allTexts.length
            });
          }
        } catch (error: any) {
          logStructured("warn", "Batch embedding failed, continuing with fallback", {
            batch_start: i,
            error: error.message
          });
        }
      }
      
      isIndexInitialized = true;
      const duration = Date.now() - startTime;
      
      logStructured("info", "Semantic embedding index initialized", {
        total_indexed: indexedExamples.length,
        duration_ms: duration,
        avg_neighbors: indexedExamples.length > 0
          ? indexedExamples.reduce((sum, e) => sum + e.neighbors.length, 0) / indexedExamples.length
          : 0
      });
    } catch (error: any) {
      logStructured("error", "Failed to initialize embedding index", {
        error: error.message
      });
      isIndexInitializing = false;
      throw error;
    }
  })();
  
  return initPromise;
}

export interface SemanticKNNResult {
  intent: IntentType;
  confidence: number;
  top_matches: Array<{
    intent: IntentType;
    similarity: number;
    text: string;
  }>;
  embedding: number[];
  method: "semantic_knn";
}

export async function semanticKNNMatch(
  text: string,
  k: number = 20
): Promise<SemanticKNNResult | null> {
  if (!isIndexInitialized || indexedExamples.length === 0) {
    return null;
  }
  
  try {
    const queryEmbedding = await generateEmbedding(text);
    
    let entryPoint = 0;
    for (let l = DEFAULT_HNSW_CONFIG.maxLayers - 1; l > 0; l--) {
      const results = searchLayerGreedy(queryEmbedding, entryPoint, 1, l);
      if (results.length > 0) {
        entryPoint = results[0];
      }
    }
    
    const candidateIndices = searchLayerGreedy(
      queryEmbedding,
      entryPoint,
      DEFAULT_HNSW_CONFIG.efSearch,
      0
    );
    
    const scored = candidateIndices.map(idx => ({
      idx,
      intent: indexedExamples[idx].intent,
      text: indexedExamples[idx].text,
      similarity: cosineSimilarity(queryEmbedding, indexedExamples[idx].embedding)
    }));
    
    scored.sort((a, b) => b.similarity - a.similarity);
    const topK = scored.slice(0, k);
    
    const intentCounts = new Map<IntentType, { count: number; totalSim: number; maxSim: number }>();
    
    for (const match of topK) {
      const current = intentCounts.get(match.intent) || { count: 0, totalSim: 0, maxSim: 0 };
      current.count++;
      current.totalSim += match.similarity;
      current.maxSim = Math.max(current.maxSim, match.similarity);
      intentCounts.set(match.intent, current);
    }
    
    let bestIntent: IntentType = "CHAT_GENERAL";
    let bestScore = 0;
    
    for (const [intent, stats] of intentCounts) {
      const avgSim = stats.totalSim / stats.count;
      const majorityBonus = stats.count / k;
      const score = avgSim * 0.7 + majorityBonus * 0.2 + stats.maxSim * 0.1;
      
      if (score > bestScore) {
        bestScore = score;
        bestIntent = intent;
      }
    }
    
    const bestStats = intentCounts.get(bestIntent)!;
    const topSimilarity = topK[0]?.similarity || 0;
    const avgSimilarity = bestStats.totalSim / bestStats.count;
    const majorityRatio = bestStats.count / k;
    
    const confidence = Math.min(
      0.98,
      topSimilarity * 0.4 + avgSimilarity * 0.35 + majorityRatio * 0.25
    );
    
    return {
      intent: bestIntent,
      confidence,
      top_matches: topK.slice(0, 5).map(m => ({
        intent: m.intent,
        similarity: m.similarity,
        text: m.text
      })),
      embedding: queryEmbedding,
      method: "semantic_knn"
    };
  } catch (error: any) {
    logStructured("error", "Semantic KNN match failed", {
      error: error.message,
      text_preview: text.substring(0, 50)
    });
    return null;
  }
}

export function addExampleToIndex(
  intent: IntentType,
  text: string,
  embedding: number[]
): void {
  if (intent === "NEED_CLARIFICATION") return;
  
  insertIntoIndex(intent, text, embedding);
  
  logStructured("info", "Added example to semantic index", {
    intent,
    text_preview: text.substring(0, 50),
    total_indexed: indexedExamples.length
  });
}

export function isSemanticIndexReady(): boolean {
  return isIndexInitialized && indexedExamples.length > 0;
}

export function getIndexStats(): {
  total_examples: number;
  by_intent: Record<IntentType, number>;
  avg_neighbors: number;
  max_layer: number;
} {
  const byIntent: Record<IntentType, number> = {
    CREATE_PRESENTATION: 0,
    CREATE_DOCUMENT: 0,
    CREATE_SPREADSHEET: 0,
    SUMMARIZE: 0,
    TRANSLATE: 0,
    SEARCH_WEB: 0,
    ANALYZE_DOCUMENT: 0,
    CHAT_GENERAL: 0,
    NEED_CLARIFICATION: 0
  };
  
  let maxLayer = 0;
  let totalNeighbors = 0;
  
  for (const example of indexedExamples) {
    byIntent[example.intent]++;
    maxLayer = Math.max(maxLayer, example.layer);
    totalNeighbors += example.neighbors.length;
  }
  
  return {
    total_examples: indexedExamples.length,
    by_intent: byIntent,
    avg_neighbors: indexedExamples.length > 0 
      ? totalNeighbors / indexedExamples.length 
      : 0,
    max_layer: maxLayer
  };
}

export { generateEmbedding, cosineSimilarity };
