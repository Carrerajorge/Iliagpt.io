import type { IntentType, OutputFormat, SupportedLocale, Slots } from "../../../shared/schemas/intent";
import * as fs from 'fs';
import * as path from 'path';
import { resolveSafePath } from '../../utils/pathSecurity';

const INTENT_ALIASES: Record<SupportedLocale, Record<IntentType, string[]>> = {
  es: {
    CREATE_PRESENTATION: [
      "ppt", "pptx", "powerpoint", "power point", "presentacion", "presentación",
      "diapositivas", "slides", "slide", "crear presentacion", "generar presentacion",
      "hacer diapositivas", "armar presentacion", "construir presentacion", "presenta"
    ],
    CREATE_DOCUMENT: [
      "doc", "docx", "word", "documento", "informe", "reporte",
      "crear documento", "generar documento", "hacer documento", "escribir documento",
      "elaborar informe", "redactar", "carta", "ensayo", "manual", "guia",
      "creame", "creame un", "creame una", "solicitud", "permiso", "oficio", "memorial",
      "hazme un documento", "genera un documento", "escribe un documento"
    ],
    CREATE_SPREADSHEET: [
      "xls", "xlsx", "excel", "hoja de calculo", "hoja de cálculo", "spreadsheet",
      "tabla", "crear excel", "generar excel", "hacer tabla", "planilla", "calcular"
    ],
    SUMMARIZE: [
      "resume", "resumen", "resumir", "resumeme", "sintetiza", "sintetizar",
      "sintesis", "condensar", "extracto", "puntos clave", "lo mas importante",
      "en pocas palabras", "briefing", "tldr"
    ],
    TRANSLATE: [
      "traduce", "traducir", "traduccion", "traducción", "al español", "al ingles",
      "al inglés", "en frances", "en francés", "en aleman", "en alemán",
      "pasar a", "convertir a idioma", "cambiar idioma"
    ],
    SEARCH_WEB: [
      "busca en internet", "buscar en web", "busca online", "google",
      "investigar", "buscar informacion", "encuentra informacion",
      "consultar", "averiguar", "indagar", "explorar web",
      "buscame", "búscame", "encuentrame", "encuéntrame",
      "busca articulos", "busca artículos", "buscar articulos",
      "encuentra articulos", "buscar noticias", "busca noticias"
    ],
    ANALYZE_DOCUMENT: [
      "analiza", "analizar", "análisis", "analisis", "revisa", "revisar",
      "evalua", "evaluar", "examina", "examinar", "interpreta", "interpretar",
      "diagnostico", "diagnóstico", "critica", "criticar"
    ],
    CHAT_GENERAL: [
      "hola", "gracias", "ok", "sí", "si", "no", "vale", "bien",
      "qué tal", "cómo estás", "buenos días", "buenas tardes", "buenas noches",
      "por favor", "ayuda"
    ],
    ANALYZE_DATA: [
      "analizar datos", "análisis de datos", "estadísticas", "estadisticas", "visualización",
      "visualizacion", "gráfico", "grafico", "dashboard", "métricas", "metricas",
      "tendencias", "correlación", "regresión", "pivot", "tabla dinámica",
      "kpi", "indicadores", "reporte de datos", "big data", "dataset"
    ],
    EXECUTE_CODE: [
      "ejecutar código", "ejecutar codigo", "python", "javascript", "script",
      "programar", "compilar", "correr código", "correr script", "código python",
      "código javascript", "nodejs", "algoritmo", "función", "automatizar con código"
    ],
    MANAGE_EMAIL: [
      "correo", "email", "gmail", "enviar correo", "leer correos", "bandeja de entrada",
      "enviar email", "redactar correo", "responder correo", "reenviar correo",
      "correo electrónico", "outlook", "inbox", "mail"
    ],
    MANAGE_CALENDAR: [
      "calendario", "evento", "recordatorio", "cita", "agendar", "programar reunión",
      "reunión", "meeting", "agenda", "horario", "disponibilidad", "crear evento",
      "añadir recordatorio", "google calendar", "programar cita"
    ],
    MANAGE_TASKS: [
      "tarea", "tareas", "to-do", "todo", "lista de tareas", "pendiente", "pendientes",
      "checklist", "asignar tarea", "crear tarea", "completar tarea", "prioridad",
      "trello", "jira", "asana", "linear", "things"
    ],
    SEND_MESSAGE: [
      "whatsapp", "wsp", "mensaje", "enviar mensaje", "sms", "slack", "telegram",
      "discord", "teams", "enviar por whatsapp", "mandar mensaje", "chat",
      "notificar", "avisar", "mensajería"
    ],
    MANAGE_DATABASE: [
      "base de datos", "sql", "consulta", "query", "postgres", "mysql", "mongodb",
      "firebase", "supabase", "redis", "elasticsearch", "tabla sql", "insertar datos",
      "consultar base", "migración", "schema"
    ],
    AUTOMATE_WORKFLOW: [
      "automatizar", "automatización", "flujo", "workflow", "cron", "programar tarea",
      "trigger", "webhook", "pipeline", "proceso automático", "rutina", "bot",
      "zapier", "n8n", "make", "integromat"
    ],
    MANAGE_INFRASTRUCTURE: [
      "docker", "kubernetes", "k8s", "aws", "azure", "gcp", "servidor", "deploy",
      "desplegar", "terraform", "ansible", "contenedor", "pod", "ec2", "s3",
      "lambda", "vercel", "heroku", "devops", "ci/cd", "pipeline ci"
    ],
    SECURITY_AUDIT: [
      "seguridad", "auditoría", "vulnerabilidad", "escaneo", "nmap", "pentesting",
      "firewall", "ssl", "certificado", "hacking ético", "owasp", "hardening",
      "encriptación", "contraseña", "1password", "burpsuite"
    ],
    MEDIA_GENERATE: [
      "imagen", "generar imagen", "foto", "ilustración", "diseño", "logo",
      "video", "generar video", "audio", "voz", "tts", "text to speech",
      "dall-e", "midjourney", "stable diffusion", "música", "podcast"
    ],
    INTEGRATION_ACTION: [
      "integración", "conectar", "sincronizar", "api", "webhook", "notion",
      "figma", "github", "gitlab", "stripe", "hubspot", "salesforce",
      "zendesk", "intercom", "twilio", "sendgrid", "mixpanel", "amplitude"
    ],
    NEED_CLARIFICATION: []
  },
  en: {
    CREATE_PRESENTATION: [
      "ppt", "pptx", "powerpoint", "power point", "presentation", "slides",
      "slide", "create presentation", "make presentation", "generate slides",
      "build presentation", "slide deck", "slidedeck"
    ],
    CREATE_DOCUMENT: [
      "doc", "docx", "word", "document", "report", "essay", "create document",
      "make document", "write document", "generate report", "letter", "article",
      "manual", "guide", "paper"
    ],
    CREATE_SPREADSHEET: [
      "xls", "xlsx", "excel", "spreadsheet", "sheet", "table",
      "create spreadsheet", "make excel", "generate table", "data table",
      "calculate", "formulas", "chart"
    ],
    SUMMARIZE: [
      "summary", "summarize", "summarise", "condense", "condensed",
      "extract key points", "key points", "tldr", "tl;dr", "brief", "briefing",
      "main points", "overview"
    ],
    TRANSLATE: [
      "translate", "translation", "to english", "to spanish", "to french",
      "to german", "to portuguese", "convert to", "change language"
    ],
    SEARCH_WEB: [
      "search web", "search online", "google", "research", "find information",
      "look up", "lookup", "browse", "find online", "web search"
    ],
    ANALYZE_DOCUMENT: [
      "analyze", "analyse", "analysis", "review", "evaluate", "evaluation",
      "examine", "interpret", "interpretation", "diagnosis", "critique"
    ],
    CHAT_GENERAL: [
      "hello", "hi", "hey", "thanks", "thank you", "ok", "yes", "no",
      "good morning", "good afternoon", "good evening", "please", "help"
    ],
    ANALYZE_DATA: [
      "analyze data", "data analysis", "statistics", "visualization", "chart",
      "graph", "dashboard", "metrics", "trends", "correlation", "regression",
      "pivot table", "kpi", "indicators", "data report", "big data", "dataset"
    ],
    EXECUTE_CODE: [
      "execute code", "run code", "python", "javascript", "script", "program",
      "compile", "run script", "python code", "javascript code", "nodejs",
      "algorithm", "function", "automate with code", "coding"
    ],
    MANAGE_EMAIL: [
      "email", "gmail", "send email", "read emails", "inbox", "compose email",
      "reply email", "forward email", "outlook", "mail", "electronic mail"
    ],
    MANAGE_CALENDAR: [
      "calendar", "event", "reminder", "appointment", "schedule meeting",
      "meeting", "agenda", "schedule", "availability", "create event",
      "add reminder", "google calendar", "schedule appointment"
    ],
    MANAGE_TASKS: [
      "task", "tasks", "to-do", "todo", "task list", "pending", "checklist",
      "assign task", "create task", "complete task", "priority",
      "trello", "jira", "asana", "linear", "things"
    ],
    SEND_MESSAGE: [
      "whatsapp", "message", "send message", "sms", "slack", "telegram",
      "discord", "teams", "send via whatsapp", "chat message",
      "notify", "alert", "messaging"
    ],
    MANAGE_DATABASE: [
      "database", "sql", "query", "postgres", "mysql", "mongodb",
      "firebase", "supabase", "redis", "elasticsearch", "sql table",
      "insert data", "query database", "migration", "schema"
    ],
    AUTOMATE_WORKFLOW: [
      "automate", "automation", "workflow", "cron", "schedule task",
      "trigger", "webhook", "pipeline", "automated process", "routine",
      "bot", "zapier", "n8n", "make", "integromat"
    ],
    MANAGE_INFRASTRUCTURE: [
      "docker", "kubernetes", "k8s", "aws", "azure", "gcp", "server", "deploy",
      "terraform", "ansible", "container", "pod", "ec2", "s3",
      "lambda", "vercel", "heroku", "devops", "ci/cd", "ci pipeline"
    ],
    SECURITY_AUDIT: [
      "security", "audit", "vulnerability", "scan", "nmap", "pentesting",
      "firewall", "ssl", "certificate", "ethical hacking", "owasp", "hardening",
      "encryption", "password", "1password", "burpsuite"
    ],
    MEDIA_GENERATE: [
      "image", "generate image", "photo", "illustration", "design", "logo",
      "video", "generate video", "audio", "voice", "tts", "text to speech",
      "dall-e", "midjourney", "stable diffusion", "music", "podcast"
    ],
    INTEGRATION_ACTION: [
      "integration", "connect", "sync", "api", "webhook", "notion",
      "figma", "github", "gitlab", "stripe", "hubspot", "salesforce",
      "zendesk", "intercom", "twilio", "sendgrid", "mixpanel", "amplitude"
    ],
    NEED_CLARIFICATION: []
  },
  pt: {
    CREATE_PRESENTATION: [
      "ppt", "pptx", "powerpoint", "apresentacao", "apresentação", "slides",
      "criar apresentacao", "fazer apresentacao", "gerar slides"
    ],
    CREATE_DOCUMENT: [
      "doc", "docx", "word", "documento", "relatorio", "relatório",
      "criar documento", "fazer documento", "escrever documento"
    ],
    CREATE_SPREADSHEET: [
      "xls", "xlsx", "excel", "planilha", "tabela", "criar planilha",
      "fazer tabela", "gerar excel"
    ],
    SUMMARIZE: [
      "resumo", "resumir", "sintetizar", "sintese", "síntese",
      "pontos principais", "principais pontos"
    ],
    TRANSLATE: [
      "traduzir", "traducao", "tradução", "para ingles", "para português",
      "para espanhol"
    ],
    SEARCH_WEB: [
      "buscar na internet", "pesquisar", "pesquisa web", "procurar informacao"
    ],
    ANALYZE_DOCUMENT: [
      "analisar", "analise", "análise", "revisar", "avaliar", "examinar"
    ],
    CHAT_GENERAL: [
      "ola", "olá", "obrigado", "obrigada", "ok", "sim", "não", "bom dia",
      "boa tarde", "boa noite", "por favor", "ajuda"
    ],
    ANALYZE_DATA: [],
    EXECUTE_CODE: [],
    MANAGE_EMAIL: [],
    MANAGE_CALENDAR: [],
    MANAGE_TASKS: [],
    SEND_MESSAGE: [],
    MANAGE_DATABASE: [],
    AUTOMATE_WORKFLOW: [],
    MANAGE_INFRASTRUCTURE: [],
    SECURITY_AUDIT: [],
    MEDIA_GENERATE: [],
    INTEGRATION_ACTION: [],
    NEED_CLARIFICATION: []
  },
  fr: {
    CREATE_PRESENTATION: [
      "ppt", "pptx", "powerpoint", "presentation", "présentation", "diapositives",
      "creer presentation", "créer présentation", "faire presentation"
    ],
    CREATE_DOCUMENT: [
      "doc", "docx", "word", "document", "rapport", "creer document",
      "créer document", "faire document", "rediger", "rédiger"
    ],
    CREATE_SPREADSHEET: [
      "xls", "xlsx", "excel", "tableur", "feuille de calcul", "tableau",
      "creer excel", "créer excel", "faire tableau"
    ],
    SUMMARIZE: [
      "resume", "résumé", "resumer", "résumer", "synthese", "synthèse",
      "condenser", "points cles", "points clés"
    ],
    TRANSLATE: [
      "traduire", "traduction", "en anglais", "en espagnol", "en allemand"
    ],
    SEARCH_WEB: [
      "chercher sur internet", "rechercher", "recherche web", "trouver information"
    ],
    ANALYZE_DOCUMENT: [
      "analyser", "analyse", "evaluer", "évaluer", "examiner", "interpreter"
    ],
    CHAT_GENERAL: [
      "bonjour", "salut", "merci", "ok", "oui", "non", "bonsoir",
      "s'il vous plait", "s'il vous plaît", "aide"
    ],
    ANALYZE_DATA: [],
    EXECUTE_CODE: [],
    MANAGE_EMAIL: [],
    MANAGE_CALENDAR: [],
    MANAGE_TASKS: [],
    SEND_MESSAGE: [],
    MANAGE_DATABASE: [],
    AUTOMATE_WORKFLOW: [],
    MANAGE_INFRASTRUCTURE: [],
    SECURITY_AUDIT: [],
    MEDIA_GENERATE: [],
    INTEGRATION_ACTION: [],
    NEED_CLARIFICATION: []
  },
  de: {
    CREATE_PRESENTATION: [
      "ppt", "pptx", "powerpoint", "prasentation", "präsentation", "folien",
      "prasentation erstellen", "präsentation erstellen", "folien machen"
    ],
    CREATE_DOCUMENT: [
      "doc", "docx", "word", "dokument", "bericht", "dokument erstellen",
      "dokument schreiben", "verfassen"
    ],
    CREATE_SPREADSHEET: [
      "xls", "xlsx", "excel", "tabelle", "kalkulationstabelle",
      "excel erstellen", "tabelle erstellen"
    ],
    SUMMARIZE: [
      "zusammenfassung", "zusammenfassen", "kurz zusammenfassen",
      "kernpunkte", "hauptpunkte"
    ],
    TRANSLATE: [
      "ubersetzen", "übersetzen", "ubersetzung", "übersetzung",
      "auf englisch", "auf spanisch"
    ],
    SEARCH_WEB: [
      "im internet suchen", "websuche", "recherchieren", "nachschlagen"
    ],
    ANALYZE_DOCUMENT: [
      "analysieren", "analyse", "bewerten", "prufen", "prüfen", "untersuchen"
    ],
    CHAT_GENERAL: [
      "hallo", "guten tag", "guten morgen", "danke", "ok", "ja", "nein",
      "guten abend", "bitte", "hilfe"
    ],
    ANALYZE_DATA: [],
    EXECUTE_CODE: [],
    MANAGE_EMAIL: [],
    MANAGE_CALENDAR: [],
    MANAGE_TASKS: [],
    SEND_MESSAGE: [],
    MANAGE_DATABASE: [],
    AUTOMATE_WORKFLOW: [],
    MANAGE_INFRASTRUCTURE: [],
    SECURITY_AUDIT: [],
    MEDIA_GENERATE: [],
    INTEGRATION_ACTION: [],
    NEED_CLARIFICATION: []
  },
  it: {
    CREATE_PRESENTATION: [
      "ppt", "pptx", "powerpoint", "presentazione", "diapositive",
      "creare presentazione", "fare presentazione", "generare slide"
    ],
    CREATE_DOCUMENT: [
      "doc", "docx", "word", "documento", "rapporto", "relazione",
      "creare documento", "fare documento", "scrivere documento"
    ],
    CREATE_SPREADSHEET: [
      "xls", "xlsx", "excel", "foglio di calcolo", "tabella",
      "creare excel", "fare tabella"
    ],
    SUMMARIZE: [
      "riassunto", "riassumere", "sintetizzare", "sintesi", "punti chiave"
    ],
    TRANSLATE: [
      "tradurre", "traduzione", "in inglese", "in spagnolo", "in francese"
    ],
    SEARCH_WEB: [
      "cercare su internet", "ricerca web", "trovare informazioni"
    ],
    ANALYZE_DOCUMENT: [
      "analizzare", "analisi", "valutare", "esaminare", "interpretare"
    ],
    CHAT_GENERAL: [
      "ciao", "buongiorno", "buonasera", "grazie", "ok", "sì", "no",
      "per favore", "aiuto"
    ],
    ANALYZE_DATA: [],
    EXECUTE_CODE: [],
    MANAGE_EMAIL: [],
    MANAGE_CALENDAR: [],
    MANAGE_TASKS: [],
    SEND_MESSAGE: [],
    MANAGE_DATABASE: [],
    AUTOMATE_WORKFLOW: [],
    MANAGE_INFRASTRUCTURE: [],
    SECURITY_AUDIT: [],
    MEDIA_GENERATE: [],
    INTEGRATION_ACTION: [],
    NEED_CLARIFICATION: []
  },
  ar: {
    CREATE_PRESENTATION: [
      "عرض تقديمي", "عرض", "تقديم", "شرائح", "باوربوينت", "بوربوينت",
      "إنشاء عرض", "صنع عرض", "تصميم عرض", "إعداد عرض تقديمي"
    ],
    CREATE_DOCUMENT: [
      "مستند", "وثيقة", "ملف", "تقرير", "مقال", "إنشاء مستند",
      "كتابة مستند", "إعداد تقرير", "وورد", "محرر"
    ],
    CREATE_SPREADSHEET: [
      "جدول", "جدول بيانات", "إكسل", "ورقة عمل", "حسابات",
      "إنشاء جدول", "عمل جدول", "ورقة حساب"
    ],
    SUMMARIZE: [
      "ملخص", "تلخيص", "لخص", "خلاصة", "اختصار", "اختصر",
      "النقاط الرئيسية", "أهم النقاط", "موجز"
    ],
    TRANSLATE: [
      "ترجم", "ترجمة", "ترجم إلى", "بالعربية", "بالإنجليزية",
      "حول إلى", "نقل إلى لغة"
    ],
    SEARCH_WEB: [
      "بحث", "ابحث", "بحث في الإنترنت", "جوجل", "استكشف",
      "ابحث عن", "جد معلومات", "بحث ويب"
    ],
    ANALYZE_DOCUMENT: [
      "تحليل", "حلل", "راجع", "مراجعة", "تقييم", "قيم",
      "فحص", "افحص", "دراسة", "ادرس"
    ],
    CHAT_GENERAL: [
      "مرحبا", "أهلا", "شكرا", "نعم", "لا", "حسنا",
      "صباح الخير", "مساء الخير", "من فضلك", "مساعدة"
    ],
    ANALYZE_DATA: [],
    EXECUTE_CODE: [],
    MANAGE_EMAIL: [],
    MANAGE_CALENDAR: [],
    MANAGE_TASKS: [],
    SEND_MESSAGE: [],
    MANAGE_DATABASE: [],
    AUTOMATE_WORKFLOW: [],
    MANAGE_INFRASTRUCTURE: [],
    SECURITY_AUDIT: [],
    MEDIA_GENERATE: [],
    INTEGRATION_ACTION: [],
    NEED_CLARIFICATION: []
  },
  hi: {
    CREATE_PRESENTATION: [
      "प्रस्तुति", "प्रेजेंटेशन", "स्लाइड", "स्लाइड्स", "पावरपॉइंट",
      "प्रस्तुति बनाएं", "स्लाइड बनाओ", "पीपीटी"
    ],
    CREATE_DOCUMENT: [
      "दस्तावेज़", "डॉक्यूमेंट", "रिपोर्ट", "लेख", "फ़ाइल",
      "दस्तावेज़ बनाएं", "रिपोर्ट लिखें", "वर्ड"
    ],
    CREATE_SPREADSHEET: [
      "स्प्रेडशीट", "एक्सेल", "तालिका", "शीट", "डेटा शीट",
      "एक्सेल बनाएं", "तालिका बनाओ", "गणना पत्रक"
    ],
    SUMMARIZE: [
      "सारांश", "संक्षेप", "सार", "मुख्य बिंदु", "संक्षिप्त करें",
      "छोटा करें", "महत्वपूर्ण बिंदु"
    ],
    TRANSLATE: [
      "अनुवाद", "अनुवाद करें", "हिंदी में", "अंग्रेजी में",
      "भाषा बदलें", "रूपांतरण"
    ],
    SEARCH_WEB: [
      "खोज", "खोजें", "इंटरनेट पर खोजें", "गूगल", "जानकारी ढूंढें",
      "वेब खोज", "ऑनलाइन खोजें"
    ],
    ANALYZE_DOCUMENT: [
      "विश्लेषण", "विश्लेषण करें", "समीक्षा", "समीक्षा करें",
      "मूल्यांकन", "जांच करें", "परीक्षण"
    ],
    CHAT_GENERAL: [
      "नमस्ते", "हैलो", "धन्यवाद", "हां", "नहीं", "ठीक है",
      "शुभ प्रभात", "कृपया", "मदद"
    ],
    ANALYZE_DATA: [],
    EXECUTE_CODE: [],
    MANAGE_EMAIL: [],
    MANAGE_CALENDAR: [],
    MANAGE_TASKS: [],
    SEND_MESSAGE: [],
    MANAGE_DATABASE: [],
    AUTOMATE_WORKFLOW: [],
    MANAGE_INFRASTRUCTURE: [],
    SECURITY_AUDIT: [],
    MEDIA_GENERATE: [],
    INTEGRATION_ACTION: [],
    NEED_CLARIFICATION: []
  },
  ja: {
    CREATE_PRESENTATION: [
      "プレゼン", "プレゼンテーション", "スライド", "パワーポイント", "パワポ",
      "プレゼン作成", "スライド作って", "発表資料", "ppt作成"
    ],
    CREATE_DOCUMENT: [
      "ドキュメント", "文書", "レポート", "報告書", "ワード",
      "文書作成", "レポート作成", "資料作成", "書類"
    ],
    CREATE_SPREADSHEET: [
      "スプレッドシート", "エクセル", "表", "表計算", "シート",
      "エクセル作成", "表作成", "データシート"
    ],
    SUMMARIZE: [
      "要約", "まとめ", "まとめて", "要点", "サマリー",
      "簡潔に", "ポイント", "概要"
    ],
    TRANSLATE: [
      "翻訳", "訳して", "日本語に", "英語に", "翻訳して",
      "言語変換", "通訳"
    ],
    SEARCH_WEB: [
      "検索", "調べて", "ググって", "ウェブ検索", "ネット検索",
      "情報を探して", "調査"
    ],
    ANALYZE_DOCUMENT: [
      "分析", "分析して", "レビュー", "評価", "評価して",
      "検討", "検証", "チェック"
    ],
    CHAT_GENERAL: [
      "こんにちは", "おはよう", "ありがとう", "はい", "いいえ",
      "よろしく", "助けて", "お願いします"
    ],
    ANALYZE_DATA: [],
    EXECUTE_CODE: [],
    MANAGE_EMAIL: [],
    MANAGE_CALENDAR: [],
    MANAGE_TASKS: [],
    SEND_MESSAGE: [],
    MANAGE_DATABASE: [],
    AUTOMATE_WORKFLOW: [],
    MANAGE_INFRASTRUCTURE: [],
    SECURITY_AUDIT: [],
    MEDIA_GENERATE: [],
    INTEGRATION_ACTION: [],
    NEED_CLARIFICATION: []
  },
  ko: {
    CREATE_PRESENTATION: [
      "프레젠테이션", "슬라이드", "파워포인트", "ppt", "발표자료",
      "프레젠테이션 만들어", "슬라이드 작성", "발표"
    ],
    CREATE_DOCUMENT: [
      "문서", "도큐먼트", "보고서", "리포트", "워드",
      "문서 작성", "문서 만들어", "보고서 작성"
    ],
    CREATE_SPREADSHEET: [
      "스프레드시트", "엑셀", "표", "시트", "데이터시트",
      "엑셀 만들어", "표 작성", "계산표"
    ],
    SUMMARIZE: [
      "요약", "정리", "요약해", "핵심", "포인트",
      "간략히", "요점", "개요"
    ],
    TRANSLATE: [
      "번역", "번역해", "한국어로", "영어로", "언어 변환",
      "통역", "번역하다"
    ],
    SEARCH_WEB: [
      "검색", "찾아봐", "구글", "웹검색", "인터넷 검색",
      "정보 찾기", "조사"
    ],
    ANALYZE_DOCUMENT: [
      "분석", "분석해", "리뷰", "평가", "검토",
      "검증", "체크"
    ],
    CHAT_GENERAL: [
      "안녕하세요", "안녕", "감사합니다", "네", "아니요",
      "좋아요", "도와주세요", "부탁해요"
    ],
    ANALYZE_DATA: [],
    EXECUTE_CODE: [],
    MANAGE_EMAIL: [],
    MANAGE_CALENDAR: [],
    MANAGE_TASKS: [],
    SEND_MESSAGE: [],
    MANAGE_DATABASE: [],
    AUTOMATE_WORKFLOW: [],
    MANAGE_INFRASTRUCTURE: [],
    SECURITY_AUDIT: [],
    MEDIA_GENERATE: [],
    INTEGRATION_ACTION: [],
    NEED_CLARIFICATION: []
  },
  zh: {
    CREATE_PRESENTATION: [
      "演示", "幻灯片", "ppt", "演示文稿", "报告", "展示",
      "创建演示", "制作幻灯片", "做ppt", "演示制作"
    ],
    CREATE_DOCUMENT: [
      "文档", "文件", "报告", "word", "文章",
      "创建文档", "写文档", "制作文件", "撰写"
    ],
    CREATE_SPREADSHEET: [
      "电子表格", "表格", "excel", "工作表", "数据表",
      "创建表格", "制作excel", "做表格"
    ],
    SUMMARIZE: [
      "摘要", "总结", "概要", "要点", "归纳",
      "简述", "概括", "精简"
    ],
    TRANSLATE: [
      "翻译", "译成", "中文", "英文", "翻成",
      "转换语言", "翻译成"
    ],
    SEARCH_WEB: [
      "搜索", "查找", "百度", "谷歌", "网上搜索",
      "查询", "找信息", "搜一下"
    ],
    ANALYZE_DOCUMENT: [
      "分析", "评估", "审查", "检查", "评价",
      "研究", "考察", "鉴定"
    ],
    CHAT_GENERAL: [
      "你好", "嗨", "谢谢", "是", "不是", "好的",
      "早上好", "请", "帮忙"
    ],
    ANALYZE_DATA: [],
    EXECUTE_CODE: [],
    MANAGE_EMAIL: [],
    MANAGE_CALENDAR: [],
    MANAGE_TASKS: [],
    SEND_MESSAGE: [],
    MANAGE_DATABASE: [],
    AUTOMATE_WORKFLOW: [],
    MANAGE_INFRASTRUCTURE: [],
    SECURITY_AUDIT: [],
    MEDIA_GENERATE: [],
    INTEGRATION_ACTION: [],
    NEED_CLARIFICATION: []
  },
  ru: {
    CREATE_PRESENTATION: [
      "презентация", "слайды", "powerpoint", "ppt", "слайд",
      "создать презентацию", "сделать презентацию", "подготовить презентацию"
    ],
    CREATE_DOCUMENT: [
      "документ", "файл", "отчет", "доклад", "word",
      "создать документ", "написать документ", "подготовить отчет"
    ],
    CREATE_SPREADSHEET: [
      "таблица", "excel", "электронная таблица", "spreadsheet",
      "создать таблицу", "сделать excel", "табличка"
    ],
    SUMMARIZE: [
      "резюме", "итог", "краткое содержание", "суть", "выжимка",
      "подытожить", "кратко", "основные моменты"
    ],
    TRANSLATE: [
      "перевод", "переводить", "перевести", "на русский", "на английский",
      "переведи", "перевод текста"
    ],
    SEARCH_WEB: [
      "поиск", "искать", "найти", "гугл", "яндекс",
      "найди информацию", "поищи", "интернет поиск"
    ],
    ANALYZE_DOCUMENT: [
      "анализ", "анализировать", "проанализировать", "оценка", "оценить",
      "рассмотреть", "изучить", "проверить"
    ],
    CHAT_GENERAL: [
      "привет", "здравствуйте", "спасибо", "да", "нет", "хорошо",
      "доброе утро", "пожалуйста", "помощь"
    ],
    ANALYZE_DATA: [],
    EXECUTE_CODE: [],
    MANAGE_EMAIL: [],
    MANAGE_CALENDAR: [],
    MANAGE_TASKS: [],
    SEND_MESSAGE: [],
    MANAGE_DATABASE: [],
    AUTOMATE_WORKFLOW: [],
    MANAGE_INFRASTRUCTURE: [],
    SECURITY_AUDIT: [],
    MEDIA_GENERATE: [],
    INTEGRATION_ACTION: [],
    NEED_CLARIFICATION: []
  },
  tr: {
    CREATE_PRESENTATION: [
      "sunum", "slayt", "powerpoint", "ppt", "slaytlar",
      "sunum oluştur", "sunum hazırla", "slayt yap"
    ],
    CREATE_DOCUMENT: [
      "belge", "dosya", "rapor", "word", "döküman",
      "belge oluştur", "döküman hazırla", "rapor yaz"
    ],
    CREATE_SPREADSHEET: [
      "tablo", "excel", "elektronik tablo", "spreadsheet",
      "tablo oluştur", "excel yap", "hesap tablosu"
    ],
    SUMMARIZE: [
      "özet", "özetle", "kısaca", "ana noktalar", "öz",
      "kısa özet", "temel noktalar"
    ],
    TRANSLATE: [
      "çeviri", "çevir", "tercüme", "türkçeye", "ingilizceye",
      "çevirmek", "dil değiştir"
    ],
    SEARCH_WEB: [
      "arama", "ara", "google", "internette ara", "bul",
      "bilgi bul", "web araması"
    ],
    ANALYZE_DOCUMENT: [
      "analiz", "analiz et", "değerlendir", "incele", "gözden geçir",
      "kontrol et", "inceleme"
    ],
    CHAT_GENERAL: [
      "merhaba", "selam", "teşekkürler", "evet", "hayır", "tamam",
      "günaydın", "lütfen", "yardım"
    ],
    ANALYZE_DATA: [],
    EXECUTE_CODE: [],
    MANAGE_EMAIL: [],
    MANAGE_CALENDAR: [],
    MANAGE_TASKS: [],
    SEND_MESSAGE: [],
    MANAGE_DATABASE: [],
    AUTOMATE_WORKFLOW: [],
    MANAGE_INFRASTRUCTURE: [],
    SECURITY_AUDIT: [],
    MEDIA_GENERATE: [],
    INTEGRATION_ACTION: [],
    NEED_CLARIFICATION: []
  },
  id: {
    CREATE_PRESENTATION: [
      "presentasi", "slide", "powerpoint", "ppt", "tayangan",
      "buat presentasi", "membuat presentasi", "siapkan slide"
    ],
    CREATE_DOCUMENT: [
      "dokumen", "berkas", "laporan", "word", "file",
      "buat dokumen", "tulis dokumen", "buat laporan"
    ],
    CREATE_SPREADSHEET: [
      "spreadsheet", "tabel", "excel", "lembar kerja",
      "buat tabel", "buat excel", "lembar data"
    ],
    SUMMARIZE: [
      "ringkasan", "ringkas", "rangkuman", "intisari", "poin utama",
      "singkat", "inti"
    ],
    TRANSLATE: [
      "terjemahan", "terjemahkan", "ke bahasa indonesia", "ke bahasa inggris",
      "alih bahasa", "ubah bahasa"
    ],
    SEARCH_WEB: [
      "pencarian", "cari", "google", "telusuri", "cari di internet",
      "temukan informasi", "web search"
    ],
    ANALYZE_DOCUMENT: [
      "analisis", "analisa", "tinjau", "evaluasi", "periksa",
      "kaji", "telaah"
    ],
    CHAT_GENERAL: [
      "halo", "hai", "terima kasih", "ya", "tidak", "oke",
      "selamat pagi", "tolong", "bantuan"
    ],
    ANALYZE_DATA: [],
    EXECUTE_CODE: [],
    MANAGE_EMAIL: [],
    MANAGE_CALENDAR: [],
    MANAGE_TASKS: [],
    SEND_MESSAGE: [],
    MANAGE_DATABASE: [],
    AUTOMATE_WORKFLOW: [],
    MANAGE_INFRASTRUCTURE: [],
    SECURITY_AUDIT: [],
    MEDIA_GENERATE: [],
    INTEGRATION_ACTION: [],
    NEED_CLARIFICATION: []
  }
};

const CREATION_VERBS: Record<SupportedLocale, string[]> = {
  es: [
    "crear", "crea", "creame", "créame", "generar", "genera", "generame",
    "hacer", "haz", "hazme", "armar", "arma", "armame",
    "construir", "construye", "exportar", "exporta",
    "elaborar", "elabora", "redactar", "redacta", "preparar", "prepara",
    "desarrollar", "desarrolla", "escribir", "escribe", "escribeme"
  ],
  en: [
    "create", "make", "generate", "build", "produce", "design", "draft",
    "write", "prepare", "develop", "compose", "construct"
  ],
  pt: [
    "criar", "crie", "gerar", "gere", "fazer", "faca", "faça",
    "construir", "elaborar", "preparar", "desenvolver", "escrever"
  ],
  fr: [
    "créer", "creer", "générer", "generer", "faire", "construire",
    "élaborer", "elaborer", "préparer", "preparer", "rédiger", "rediger"
  ],
  de: [
    "erstellen", "erstelle", "generieren", "generiere", "machen", "bauen",
    "entwickeln", "schreiben", "vorbereiten", "ausarbeiten"
  ],
  it: [
    "creare", "crea", "generare", "genera", "fare", "fai",
    "costruire", "elaborare", "preparare", "sviluppare", "scrivere"
  ],
  ar: [
    "إنشاء", "أنشئ", "توليد", "ولد", "صنع", "اصنع",
    "إعداد", "أعد", "تحضير", "حضر", "كتابة", "اكتب"
  ],
  hi: [
    "बनाएं", "बनाओ", "तैयार करें", "लिखें", "लिखो",
    "उत्पन्न करें", "निर्माण", "रचना"
  ],
  ja: [
    "作成", "作って", "作る", "生成", "作成して", "準備",
    "書いて", "書く", "用意して", "用意"
  ],
  ko: [
    "만들기", "만들어", "생성", "작성", "작성해", "준비",
    "써줘", "쓰기", "제작"
  ],
  zh: [
    "创建", "制作", "生成", "做", "写", "准备",
    "建立", "编写", "撰写"
  ],
  ru: [
    "создать", "создай", "сделать", "сделай", "генерировать", "подготовить",
    "написать", "напиши", "разработать"
  ],
  tr: [
    "oluştur", "oluşturmak", "yap", "yapmak", "hazırla", "hazırlamak",
    "yaz", "yazmak", "üret"
  ],
  id: [
    "buat", "buatkan", "membuat", "hasilkan", "siapkan", "menyiapkan",
    "tulis", "menulis", "kembangkan"
  ]
};

const FORMAT_KEYWORDS: Record<NonNullable<OutputFormat>, string[]> = {
  pptx: [
    "pptx", "ppt", "powerpoint", "power point", "presentacion", "presentación",
    "presentation", "slides", "diapositivas", "folien", "apresentacao", "diapositive",
    "عرض تقديمي", "प्रस्तुति", "プレゼン", "프레젠테이션", "演示", "презентация", "sunum", "presentasi",
    "deck", "slide deck", "slidedeck", "diapositiva", "presentasi"
  ],
  docx: [
    "docx", "doc", "word", "documento", "document", "informe", "reporte", "report",
    "dokument", "relatorio", "مستند", "दस्तावेज़", "ドキュメント", "문서", "文档", "документ", "belge", "dokumen",
    "ensayo", "paper", "resumen ejecutivo", "executive summary", "briefing", "guia", "guide", "manual",
    "carta", "letter", "propuesta", "proposal"
  ],
  xlsx: [
    "xlsx", "xls", "excel", "spreadsheet", "hoja de calculo", "tabla", "planilla",
    "tabelle", "tableur", "foglio", "جدول", "स्प्रेडशीट", "スプレッドシート", "스프레드시트",
    "电子表格", "таблица", "tablo", "spreadsheet", "csv", "data", "datos", "dataset",
    "cuadro", "matriz", "matrix", "base de datos", "database", "listado", "list"
  ],
  pdf: ["pdf", "portable document", "exportar pdf", "guardar como pdf", "archivo pdf"],
  txt: ["txt", "texto plano", "plain text", "text file", "archivo de texto"],
  csv: ["csv", "comma separated", "valores separados", "archivo csv"],
  html: ["html", "webpage", "pagina web", "página web", "sitio web", "website"]
};

const AUDIENCE_KEYWORDS: Record<string, string[]> = {
  executives: [
    "ejecutivos", "directivos", "ceo", "cfo", "c-level", "junta directiva", "board",
    "executives", "leadership", "dirigeants", "führungskräfte", "руководство", "yöneticiler"
  ],
  technical: [
    "tecnicos", "técnicos", "ingenieros", "developers", "programadores", "technical",
    "engineering", "technique", "technisch", "技术", "技術", "개발자", "технический", "teknik"
  ],
  general: [
    "general", "publico general", "público general", "everyone", "todos", "audiencia general",
    "grand public", "allgemein", "一般", "일반", "общий", "genel", "umum"
  ],
  academic: [
    "academico", "académico", "estudiantes", "students", "universidad", "university",
    "academic", "research", "académique", "akademisch", "学术", "学術", "학술", "академический", "akademik"
  ],
  clients: [
    "clientes", "customers", "clients", "compradores", "buyers", "clienti", "kunden",
    "العملاء", "客户", "고객", "клиенты", "müşteriler", "pelanggan"
  ],
  investors: [
    "inversores", "inversionistas", "investors", "stakeholders", "accionistas",
    "investisseurs", "investoren", "المستثمرين", "投资者", "투자자", "инвесторы", "yatırımcılar"
  ]
};

function levenshteinDistance(a: string, b: string): number {
  const matrix: number[][] = [];

  for (let i = 0; i <= b.length; i++) {
    matrix[i] = [i];
  }
  for (let j = 0; j <= a.length; j++) {
    matrix[0][j] = j;
  }

  for (let i = 1; i <= b.length; i++) {
    for (let j = 1; j <= a.length; j++) {
      if (b.charAt(i - 1) === a.charAt(j - 1)) {
        matrix[i][j] = matrix[i - 1][j - 1];
      } else {
        matrix[i][j] = Math.min(
          matrix[i - 1][j - 1] + 1,
          matrix[i][j - 1] + 1,
          matrix[i - 1][j] + 1
        );
      }
    }
  }

  return matrix[b.length][a.length];
}

function fuzzyMatch(text: string, target: string, threshold: number = 0.80): { match: boolean; similarity: number } {
  const normalizedText = text.toLowerCase();
  const normalizedTarget = target.toLowerCase();

  if (normalizedText.includes(normalizedTarget)) {
    return { match: true, similarity: 1.0 };
  }

  const distance = levenshteinDistance(normalizedText, normalizedTarget);
  const maxLength = Math.max(normalizedText.length, normalizedTarget.length);
  const similarity = 1 - (distance / maxLength);

  return { match: similarity >= threshold, similarity };
}

export interface RuleMatchResult {
  intent: IntentType;
  confidence: number;
  raw_score: number;
  matched_patterns: string[];
  output_format: OutputFormat;
  has_creation_verb: boolean;
}

const NON_LATIN_LOCALES: SupportedLocale[] = ["ar", "hi", "ja", "ko", "zh", "ru"];

function hasCreationVerb(normalizedText: string, locale: SupportedLocale): boolean {
  const verbs = [...(CREATION_VERBS[locale] || []), ...CREATION_VERBS.en];
  const isNonLatin = NON_LATIN_LOCALES.includes(locale);

  return verbs.some(verb => {
    if (isNonLatin) {
      return normalizedText.includes(verb.toLowerCase());
    }
    const pattern = new RegExp(`\\b${verb}\\b`, "i");
    return pattern.test(normalizedText);
  });
}

function detectOutputFormat(normalizedText: string): OutputFormat {
  for (const [format, keywords] of Object.entries(FORMAT_KEYWORDS) as [NonNullable<OutputFormat>, string[]][]) {
    for (const keyword of keywords) {
      if (normalizedText.includes(keyword.toLowerCase())) {
        return format;
      }
    }
  }
  return null;
}

export function extractSlots(normalizedText: string, originalText: string): Slots {
  const slots: Slots = {};

  const lengthPatterns: Array<{ pattern: RegExp; value: "short" | "medium" | "long" }> = [
    { pattern: /\b(breve|corto|corta|short|brief|rapido|rápido|conciso|kurz|court|breve|قصير|संक्षिप्त|短い|짧은|短|краткий|kısa|singkat)\b/i, value: "short" },
    { pattern: /\b(medio|mediano|mediana|medium|moderate|normal|mittel|moyen|متوسط|मध्यम|中程度|중간|中等|средний|orta|sedang)\b/i, value: "medium" },
    { pattern: /\b(largo|larga|long|extenso|extensa|detallado|detallada|completo|completa|exhaustivo|lang|détaillé|lungo|طويل|विस्तृत|長い|긴|长|подробный|uzun|panjang)\b/i, value: "long" }
  ];

  for (const { pattern, value } of lengthPatterns) {
    if (pattern.test(normalizedText)) {
      slots.length = value;
      break;
    }
  }

  for (const [audience, keywords] of Object.entries(AUDIENCE_KEYWORDS)) {
    for (const keyword of keywords) {
      if (normalizedText.includes(keyword.toLowerCase())) {
        slots.audience = audience;
        break;
      }
    }
    if (slots.audience) break;
  }

  const slidesPattern = /(\d+)\s*(?:diapositivas?|slides?|paginas?|páginas?|hojas?|folien?|diapositive?|شرائح?|स्लाइड|スライド|슬라이드|张|слайд|slayt|slide)/i;
  const slidesMatch = normalizedText.match(slidesPattern);
  if (slidesMatch) {
    slots.num_slides = parseInt(slidesMatch[1], 10);
  }

  if (/\b(con\s*)?imagenes?\b|\b(with\s*)?images?\b|\b(incluir?\s*)?fotos?\b|\billustrat|\bbilder\b|\bimmagini\b|\bصور\b|\bचित्र\b|\b画像\b|\b이미지\b|\b图片\b|\bизображения\b|\bresim\b|\bgambar\b/i.test(normalizedText)) {
    slots.include_images = true;
  }

  if (/\b(sin\s*)?imagenes?\b|\b(no\s*)?images?\b|\btext\s*only\b|\bsolo\s*texto\b|\bkeine\s*bilder\b|\bبدون صور\b|\bबिना चित्र\b|\b画像なし\b|\b이미지 없이\b|\b无图片\b|\bбез изображений\b|\bresimsiz\b|\btanpa gambar\b/i.test(normalizedText)) {
    slots.include_images = false;
  }

  if (/\bbullet\s*points?\b|\bviñetas?\b|\bpuntos?\b|\blista\b|\bitemized\b|\baufzaehlung\b|\bpuce\b|\bنقاط\b|\bबिंदु\b|\b箇条書き\b|\b글머리\b|\b要点\b|\bпункты\b|\bmaddeler\b|\bpoin\b/i.test(normalizedText)) {
    slots.bullet_points = true;
  }

  const stylePatterns: Array<{ pattern: RegExp; style: string }> = [
    { pattern: /\b(profesional|professional|formal|corporativo|corporate|business|formell|formel|رسمي|औपचारिक|フォーマル|공식|正式|формальный|resmi|formal)\b/i, style: "professional" },
    { pattern: /\b(creativo|creative|moderno|modern|innovador|kreativ|créatif|إبداعي|रचनात्मक|クリエイティブ|창의적|创意|креативный|yaratıcı|kreatif)\b/i, style: "creative" },
    { pattern: /\b(minimalista|minimal|simple|clean|limpio|schlicht|بسيط|सरल|シンプル|심플|简约|минималистичный|minimalist|sederhana)\b/i, style: "minimal" },
    { pattern: /\b(academico|académico|academic|científico|scientific|research|wissenschaftlich|académique|أكاديمي|शैक्षिक|学術|학술|学术|академический|akademik)\b/i, style: "academic" },
    { pattern: /\b(casual|informal|friendly|amigable|locker|غير رسمي|अनौपचारिक|カジュアル|캐주얼|休闲|неформальный|rahat|santai)\b/i, style: "casual" }
  ];

  for (const { pattern, style } of stylePatterns) {
    if (pattern.test(normalizedText)) {
      slots.style = style;
      break;
    }
  }

  const topicPatterns = [
    /(?:sobre|about|acerca\s+de|regarding|tema|topic|de|sur|über|su|عن|के बारे में|について|에 대해|关于|о|hakkında|tentang)\s+["']?([^"'\n,\.]{3,50})["']?/i,
    /(?:presentacion|documento|excel|informe|reporte|resumen|presentation|document|report)\s+(?:de|sobre|about|sur|über)\s+["']?([^"'\n,\.]{3,50})["']?/i
  ];

  for (const pattern of topicPatterns) {
    const match = originalText.match(pattern);
    if (match) {
      slots.topic = match[1].trim();
      break;
    }
  }

  const titlePatterns = [
    /(?:titulo|title|titulado|titled|llamado|called|intitulé|betitelt|عنوان|शीर्षक|タイトル|제목|标题|заголовок|başlık|judul)\s*:\s*["']?([^"'\n]{3,80})["']?/i,
    /(?:titulo|title|titulado|titled|llamado|called|intitulé|betitelt|عنوان|शीर्षक|タイトル|제목|标题|заголовок|başlık|judul)\s+["']?([^"'\n]{3,80})["']?/i
  ];

  for (const pattern of titlePatterns) {
    const match = originalText.match(pattern);
    if (match) {
      slots.title = match[1].trim();
      break;
    }
  }

  // ===================================================================================
  // AGENTIC IMPROVEMENT #4: Enhanced entity detection for pages, ranges, and sections
  // ===================================================================================

  // Detect specific page numbers (e.g., "page 3", "página 5", "página 3 y 4")
  const pagePatterns = [
    /(?:pagina|página|page|pag|p\.?)s?\s*(\d+(?:\s*(?:,|y|and|e|et|und|،|और|と|및|、|и|ve|dan)\s*\d+)*)/gi,
    /(\d+)(?:ª|°)?\s*(?:pagina|página|page)/gi
  ];

  for (const pattern of pagePatterns) {
    let match;
    const pageNumbers: number[] = [];
    // Reset lastIndex because we are iterating over the same regex object if reused, 
    // but here we recreate regex or iterate list. Ideally regex should be global.
    // The patterns above have 'g' flag.
    while ((match = pattern.exec(normalizedText)) !== null) {
      const nums = match[1].match(/\d+/g);
      if (nums) {
        pageNumbers.push(...nums.map(n => parseInt(n, 10)));
      }
    }

    if (pageNumbers.length > 0) {
      slots.page_numbers = Array.from(new Set(pageNumbers)).sort((a, b) => a - b);
      break;
    }
  }

  // Detect page ranges (e.g., "pages 1-5", "páginas 3 a 7", "from page 2 to 10")
  const rangePatterns = [
    /(?:paginas?|páginas?|pages?)\s*(\d+)\s*(?:-|a|to|bis|à|al|até|до|から)\s*(\d+)/gi,
    /(?:desde|from|de|von|da|من|से|から|부터|从|от|den|dari)?\s*(?:la\s*)?(?:pagina|página|page|pag)\s*(\d+)\s*(?:hasta|to|a|bis|à|al|até|до|まで|까지|到|до|e|dan)\s*(?:la\s*)?(?:pagina|página|page|pag)?\s*(\d+)/gi
  ];

  for (const pattern of rangePatterns) {
    const match = pattern.exec(normalizedText);
    if (match) {
      const start = parseInt(match[1], 10);
      const end = parseInt(match[2], 10);
      if (start <= end) {
        slots.page_range = { start, end };
        break;
      }
    }
  }

  // Detect section references (e.g., "section 2", "sección 3", "chapter 1")
  const sectionPatterns = [
    /(?:seccion|sección|section|capitulo|capítulo|chapter|parte|part|abschnitt|chapitre|sezione|قسم|अध्याय|セクション|섹션|章节|раздел|bölüm|bagian)\s*(\d+)/gi,
    /(\d+)(?:ª|°|ª)?\s*(?:seccion|sección|section|capitulo|capítulo|chapter|parte|part)/gi
  ];

  for (const pattern of sectionPatterns) {
    const match = pattern.exec(normalizedText);
    if (match) {
      slots.section_number = parseInt(match[1], 10);
      break;
    }
  }

  // Detect scope qualifiers (all, partial, specific)
  const scopePatterns: Array<{ pattern: RegExp; scope: "all" | "partial" | "specific" }> = [
    { pattern: /\b(todo|todos|todas|all|everything|completo|complete|entire|whole|full|ganz|tout|tutto|كل|सभी|全部|전체|全部|все|tüm|semua)\b/i, scope: "all" },
    { pattern: /\b(parte|partes|partial|solo|only|just|nur|seulement|solo|جزء|भाग|一部|일부|部分|часть|sadece|sebagian)\b/i, scope: "partial" },
    { pattern: /\b(especifico|específico|specific|particular|certain|bestimmt|spécifique|specifico|محدد|विशिष्ट|特定|특정|特定|конкретный|belirli|tertentu)\b/i, scope: "specific" }
  ];

  for (const { pattern, scope } of scopePatterns) {
    if (pattern.test(normalizedText)) {
      slots.scope = scope;
      break;
    }
  }

  // ===================================================================================
  // AGENTIC IMPROVEMENT #24 & #31: File Entity Extraction and Feasibility Validation
  // ===================================================================================

  // Bound match length to reduce worst-case backtracking on pathological input.
  const filePattern = /[a-zA-Z0-9_\-./\\]{1,260}\.(ts|js|jsx|tsx|py|html|css|json|md|txt|csv|xlsx|docx|pdf|ppt|pptx|java|c|cpp|h|go|rb|php|sql|xml|yaml|yml)\b/gi;
  const projectRoot = process.cwd();

  const foundFiles: string[] = [];
  const validationIssues: string[] = [];

  let fileMatch;
  while ((fileMatch = filePattern.exec(originalText)) !== null) {
    const potentialPath = fileMatch[0];
    // Basic filter to avoid common false positives like "node.js" if used as a noun
    if (potentialPath.includes('/') || potentialPath.includes('\\') || potentialPath.split('.').length > 1) {
      try {
        const absolutePath = resolveSafePath(potentialPath);

        if (fs.existsSync(absolutePath)) {
          foundFiles.push(absolutePath);
        } else {
          // Only report if it looks very much like a specific file path request
          // and avoid complaining about output formats like "file.pdf" that we are about to create
          if (!/\.(pdf|docx|xlsx|pptx)$/i.test(potentialPath)) {
            validationIssues.push(`File not found: ${potentialPath}`);
          }
        }
      } catch (e) {
        // Ignore path parsing errors
      }
    }
  }

  if (foundFiles.length > 0) {
    slots.file_paths = Array.from(new Set(foundFiles));
  }

  if (validationIssues.length > 0) {
    slots.validation_issues = Array.from(new Set(validationIssues));
  }

  return slots;
}

function charBigramOverlap(text: string, pattern: string): number {
  if (pattern.length < 2) {
    return text.includes(pattern) ? 1.0 : 0.0;
  }

  const textBigrams = new Set<string>();
  for (let i = 0; i < text.length - 1; i++) {
    textBigrams.add(text.slice(i, i + 2));
  }

  let matches = 0;
  const patternBigramCount = Math.max(1, pattern.length - 1);
  for (let i = 0; i < pattern.length - 1; i++) {
    if (textBigrams.has(pattern.slice(i, i + 2))) {
      matches++;
    }
  }

  return matches / patternBigramCount;
}

export function ruleBasedMatch(
  normalizedText: string,
  locale: SupportedLocale = "es"
): RuleMatchResult {
  const scores: Record<IntentType, { score: number; patterns: string[] }> = {
    CREATE_PRESENTATION: { score: 0, patterns: [] },
    CREATE_DOCUMENT: { score: 0, patterns: [] },
    CREATE_SPREADSHEET: { score: 0, patterns: [] },
    SUMMARIZE: { score: 0, patterns: [] },
    TRANSLATE: { score: 0, patterns: [] },
    SEARCH_WEB: { score: 0, patterns: [] },
    ANALYZE_DOCUMENT: { score: 0, patterns: [] },
    CHAT_GENERAL: { score: 0, patterns: [] },
    NEED_CLARIFICATION: { score: 0, patterns: [] },
    ANALYZE_DATA: { score: 0, patterns: [] },
    EXECUTE_CODE: { score: 0, patterns: [] },
    MANAGE_EMAIL: { score: 0, patterns: [] },
    MANAGE_CALENDAR: { score: 0, patterns: [] },
    MANAGE_TASKS: { score: 0, patterns: [] },
    SEND_MESSAGE: { score: 0, patterns: [] },
    MANAGE_DATABASE: { score: 0, patterns: [] },
    AUTOMATE_WORKFLOW: { score: 0, patterns: [] },
    MANAGE_INFRASTRUCTURE: { score: 0, patterns: [] },
    SECURITY_AUDIT: { score: 0, patterns: [] },
    MEDIA_GENERATE: { score: 0, patterns: [] },
    INTEGRATION_ACTION: { score: 0, patterns: [] }
  };

  const isNonLatin = NON_LATIN_LOCALES.includes(locale);
  const words = normalizedText.split(/\s+/);

  const localeAliases = INTENT_ALIASES[locale] || INTENT_ALIASES.es;
  const englishAliases = INTENT_ALIASES.en;

  for (const [intent, aliases] of Object.entries(localeAliases) as [IntentType, string[]][]) {
    const allAliases = [...aliases, ...(englishAliases[intent] || [])];
    const uniqueAliases = Array.from(new Set(allAliases));

    for (const alias of uniqueAliases) {
      const aliasLower = alias.toLowerCase();

      if (normalizedText.includes(aliasLower)) {
        scores[intent].score += 2;
        scores[intent].patterns.push(alias);
      } else if (isNonLatin) {
        const overlap = charBigramOverlap(normalizedText, aliasLower);
        if (overlap >= 0.70) {
          scores[intent].score += overlap * 2;
          scores[intent].patterns.push(`[bigram:${alias}(${overlap.toFixed(2)})]`);
        }
      } else {
        for (const word of words) {
          const { match, similarity } = fuzzyMatch(word, alias, 0.80);
          if (match && similarity > 0.80) {
            scores[intent].score += similarity;
            scores[intent].patterns.push(`~${alias}(${similarity.toFixed(2)})`);
          }
        }
      }
    }
  }

  const hasCreation = hasCreationVerb(normalizedText, locale);
  if (hasCreation) {
    for (const createIntent of ["CREATE_PRESENTATION", "CREATE_DOCUMENT", "CREATE_SPREADSHEET"] as IntentType[]) {
      if (scores[createIntent].score > 0) {
        scores[createIntent].score += 1.5;
        scores[createIntent].patterns.push("[+creation_verb]");
      }
    }
  }

  const SEARCH_VERBS_STRICT: Record<string, string[]> = {
    es: ["busca", "buscar", "búscame", "buscame", "encuentra", "encontrar", "encuéntrame", "encuentrame", "averigua", "investiga", "consulta"],
    en: ["search", "find", "look up", "lookup"],
    pt: ["busca", "buscar", "encontre", "encontrar", "pesquise", "pesquisar"],
    fr: ["cherche", "chercher", "trouve", "trouver", "recherche", "rechercher"],
    de: ["suche", "suchen", "finde", "finden"],
    it: ["cerca", "cercare", "trova", "trovare"],
    ar: ["ابحث", "أوجد"], hi: ["खोज", "ढूंढ"], ja: ["探して", "検索"], ko: ["찾아", "검색"],
    zh: ["搜索", "查找"], ru: ["найди", "найти", "ищи"], tr: ["bul", "ara"], id: ["cari", "temukan"]
  };
  const searchVerbs = [...(SEARCH_VERBS_STRICT[locale] || SEARCH_VERBS_STRICT.es), ...SEARCH_VERBS_STRICT.en];
  const hasSearchVerb = searchVerbs.some(v => normalizedText.includes(v.toLowerCase()));

  const AMBIGUOUS_CONTENT_NOUNS = /\b(articulos?|artículos?|noticias|papers?|estudios|publicaciones|posts?|entradas)\b/i;
  const hasAmbiguousNoun = AMBIGUOUS_CONTENT_NOUNS.test(normalizedText);

  if (hasSearchVerb && !hasCreation) {
    scores.SEARCH_WEB.score += 2.5;
    scores.SEARCH_WEB.patterns.push("[+search_verb_boost]");
    if (hasAmbiguousNoun) {
      for (const createIntent of ["CREATE_DOCUMENT", "CREATE_PRESENTATION", "CREATE_SPREADSHEET"] as IntentType[]) {
        if (scores[createIntent].score > 0) {
          scores[createIntent].score = Math.max(0, scores[createIntent].score - 3);
          scores[createIntent].patterns.push("[-search_ambiguous_noun_penalty]");
        }
      }
    }
  }

  if (hasCreation && /\b(articulo|artículo|article)\b/i.test(normalizedText)) {
    scores.CREATE_DOCUMENT.score += 2;
    scores.CREATE_DOCUMENT.patterns.push("[+creation_verb_with_article]");
  }

  const outputFormat = detectOutputFormat(normalizedText);
  if (outputFormat) {
    if (["pptx"].includes(outputFormat)) {
      scores.CREATE_PRESENTATION.score += 2;
    } else if (["docx", "pdf", "txt"].includes(outputFormat)) {
      if (!hasSearchVerb || hasCreation) {
        scores.CREATE_DOCUMENT.score += 2;
      }
    } else if (["xlsx", "csv"].includes(outputFormat)) {
      scores.CREATE_SPREADSHEET.score += 2;
    }
  }

  let bestIntent: IntentType = "CHAT_GENERAL";
  let bestScore = 0;

  const priorityOrder: IntentType[] = [
    "CREATE_PRESENTATION",
    "CREATE_DOCUMENT",
    "CREATE_SPREADSHEET",
    "SUMMARIZE",
    "TRANSLATE",
    "SEARCH_WEB",
    "ANALYZE_DOCUMENT",
    "CHAT_GENERAL"
  ];

  for (const intent of priorityOrder) {
    if (scores[intent].score > bestScore) {
      bestScore = scores[intent].score;
      bestIntent = intent;
    }
  }

  let confidence: number;
  if (bestScore === 0) {
    confidence = 0.30;
  } else if (bestScore < 2) {
    confidence = 0.50;
  } else if (bestScore < 4) {
    confidence = 0.65;
  } else if (bestScore < 6) {
    confidence = 0.80;
  } else {
    confidence = Math.min(0.95, 0.80 + (bestScore - 6) * 0.02);
  }

  return {
    intent: bestIntent,
    confidence,
    raw_score: bestScore,
    matched_patterns: scores[bestIntent].patterns,
    output_format: outputFormat,
    has_creation_verb: hasCreation
  };
}

export function getAliasCount(): Record<SupportedLocale, number> {
  const counts: Record<SupportedLocale, number> = {
    es: 0, en: 0, pt: 0, fr: 0, de: 0, it: 0,
    ar: 0, hi: 0, ja: 0, ko: 0, zh: 0, ru: 0, tr: 0, id: 0
  };

  for (const locale of Object.keys(counts) as SupportedLocale[]) {
    const localeAliases = INTENT_ALIASES[locale];
    if (localeAliases) {
      counts[locale] = Object.values(localeAliases).reduce(
        (acc, arr) => acc + arr.length,
        0
      );
    }
  }

  return counts;
}
