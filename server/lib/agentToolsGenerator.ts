import ExcelJS from 'exceljs';
import { ExcelStyleConfig, type Priority } from './excelStyles';

export interface ToolData {
  id: number;
  category: string;
  keyword: string;
  function: string;
  description: string;
  priority: string;
  dependencies: string;
}

export interface AgentData {
  id: number;
  name: string;
  function: string;
  description: string;
  coreTools: string;
  useCases: string;
}

export interface CategoryDistribution {
  name: string;
  value: number;
}

export interface PriorityDistribution {
  name: string;
  value: number;
  priority: Priority;
}

const TOOL_HEADERS = ['#', 'Categoría', 'Palabra Clave', 'Función Principal', 'Descripción Técnica y Funcional', 'Prioridad', 'Dependencias'];
const AGENT_HEADERS = ['#', 'Agente', 'Función Principal', 'Descripción Detallada', 'Herramientas Core', 'Casos de Uso'];

export class AgentToolsData {
  static getCoreTools(): ToolData[] {
    return [
      { id: 1, category: "Orquestación", keyword: "plan", function: "Planificación Estratégica", description: "Motor de descomposición de tareas complejas en subtareas atómicas. Crea DAGs (grafos acíclicos dirigidos) de ejecución, gestiona dependencias entre pasos y permite replanning dinámico ante fallos o cambios de contexto.", priority: "Crítica", dependencies: "memory, context" },
      { id: 2, category: "Orquestación", keyword: "orchestrate", function: "Coordinación Multi-Agente", description: "Sistema de coordinación para múltiples agentes especializados. Gestiona delegación de tareas, agregación de resultados, resolución de conflictos y balanceo de carga entre sub-agentes.", priority: "Crítica", dependencies: "plan, message" },
      { id: 3, category: "Orquestación", keyword: "workflow", function: "Flujos de Trabajo", description: "Motor de workflows que permite definir pipelines complejos con branching condicional, loops, parallel execution y checkpoints para recovery.", priority: "Alta", dependencies: "plan" },
      { id: 4, category: "Memoria", keyword: "memory_store", function: "Almacenamiento Persistente", description: "Sistema de memoria a largo plazo con vectorización semántica. Almacena hechos, preferencias del usuario, decisiones previas y conocimiento adquirido durante sesiones.", priority: "Crítica", dependencies: "embeddings" },
      { id: 5, category: "Memoria", keyword: "memory_retrieve", function: "Recuperación Contextual", description: "Búsqueda semántica en memoria con ranking por relevancia, recency e importancia. Soporta queries híbridos (keyword + semántico) y filtros temporales.", priority: "Crítica", dependencies: "memory_store, embeddings" },
      { id: 6, category: "Memoria", keyword: "context_manage", function: "Gestión de Contexto", description: "Administración dinámica de la ventana de contexto. Compresión inteligente, priorización de información relevante y gestión de overflow.", priority: "Crítica", dependencies: "memory_retrieve" },
      { id: 7, category: "Memoria", keyword: "session_state", function: "Estado de Sesión", description: "Persistencia del estado conversacional entre turnos. Mantiene variables, flags, contadores y estado de tareas en progreso.", priority: "Alta", dependencies: "-" },
      { id: 8, category: "Razonamiento", keyword: "reason", function: "Razonamiento Lógico", description: "Motor de razonamiento con soporte para chain-of-thought, tree-of-thought y graph-of-thought. Permite backtracking y exploración de alternativas.", priority: "Crítica", dependencies: "plan" },
      { id: 9, category: "Razonamiento", keyword: "reflect", function: "Auto-Reflexión", description: "Capacidad de evaluar outputs propios, detectar errores, inconsistencias o alucinaciones, y corregir antes de responder al usuario.", priority: "Alta", dependencies: "reason" },
      { id: 10, category: "Razonamiento", keyword: "verify", function: "Verificación de Hechos", description: "Sistema de fact-checking que cruza información con fuentes confiables y detecta contradicciones lógicas o factuales.", priority: "Alta", dependencies: "search, reason" },
      { id: 11, category: "Razonamiento", keyword: "decide", function: "Toma de Decisiones", description: "Framework para decisiones bajo incertidumbre con análisis de pros/contras, evaluación de riesgos y selección óptima.", priority: "Alta", dependencies: "reason, verify" },
      { id: 12, category: "Razonamiento", keyword: "hypothesize", function: "Generación de Hipótesis", description: "Creación y evaluación de hipótesis explicativas para fenómenos observados o problemas complejos.", priority: "Media", dependencies: "reason" },
      { id: 13, category: "Razonamiento", keyword: "analogize", function: "Razonamiento Analógico", description: "Transferencia de conocimiento entre dominios mediante identificación de patrones y estructuras similares.", priority: "Media", dependencies: "memory_retrieve, reason" },
      { id: 14, category: "Razonamiento", keyword: "criticize", function: "Pensamiento Crítico", description: "Análisis de argumentos, detección de falacias lógicas, sesgos cognitivos y debilidades en razonamientos.", priority: "Media", dependencies: "reason" },
      { id: 15, category: "Comunicación", keyword: "message", function: "Mensajería Interna", description: "Sistema de paso de mensajes entre componentes del agente con serialización, routing y garantías de entrega.", priority: "Crítica", dependencies: "-" },
      { id: 16, category: "Comunicación", keyword: "clarify", function: "Solicitar Clarificación", description: "Detección de ambigüedad en instrucciones y generación de preguntas específicas para resolver incertidumbre.", priority: "Alta", dependencies: "reason" },
      { id: 17, category: "Comunicación", keyword: "summarize", function: "Síntesis de Información", description: "Compresión de textos largos preservando información clave. Soporta múltiples niveles de detalle y formatos.", priority: "Alta", dependencies: "-" },
      { id: 18, category: "Comunicación", keyword: "explain", function: "Explicación Adaptativa", description: "Generación de explicaciones ajustadas al nivel de conocimiento del usuario, con analogías y ejemplos apropiados.", priority: "Alta", dependencies: "reason" },
      { id: 19, category: "Búsqueda", keyword: "search_web", function: "Búsqueda Web", description: "Integración con motores de búsqueda para obtener información actualizada de internet con ranking de relevancia.", priority: "Crítica", dependencies: "api_call" },
      { id: 20, category: "Búsqueda", keyword: "search_local", function: "Búsqueda Local", description: "Búsqueda en archivos locales, bases de datos y sistemas de archivos con soporte para múltiples formatos.", priority: "Alta", dependencies: "file_read" },
      { id: 21, category: "Búsqueda", keyword: "fetch_url", function: "Obtención de URLs", description: "Descarga y parsing de contenido web: HTML, JSON, XML, PDFs. Maneja redirects, cookies y autenticación básica.", priority: "Alta", dependencies: "api_call" },
      { id: 22, category: "Búsqueda", keyword: "research_deep", function: "Investigación Profunda", description: "Investigación multi-fuente con síntesis, verificación cruzada y generación de reportes estructurados.", priority: "Alta", dependencies: "search_web, summarize, verify" },
      { id: 23, category: "Código", keyword: "code_generate", function: "Generación de Código", description: "Creación de código en múltiples lenguajes siguiendo mejores prácticas, patrones de diseño y convenciones del proyecto.", priority: "Crítica", dependencies: "-" },
      { id: 24, category: "Código", keyword: "code_execute", function: "Ejecución de Código", description: "Sandbox seguro para ejecutar código Python, JavaScript, Bash con límites de recursos y timeout.", priority: "Crítica", dependencies: "shell" },
      { id: 25, category: "Código", keyword: "code_debug", function: "Debugging", description: "Análisis de errores, stack traces, identificación de bugs y sugerencia de fixes.", priority: "Alta", dependencies: "code_generate, reason" },
      { id: 26, category: "Código", keyword: "code_review", function: "Revisión de Código", description: "Análisis estático: bugs potenciales, vulnerabilidades de seguridad, code smells, mejoras de rendimiento.", priority: "Alta", dependencies: "code_generate" },
      { id: 27, category: "Código", keyword: "code_refactor", function: "Refactorización", description: "Mejora de código existente: limpieza, optimización, aplicación de patrones sin cambiar funcionalidad.", priority: "Media", dependencies: "code_generate, code_review" },
      { id: 28, category: "Código", keyword: "code_test", function: "Testing", description: "Generación y ejecución de tests unitarios, de integración y e2e. Análisis de cobertura.", priority: "Alta", dependencies: "code_generate, code_execute" },
      { id: 29, category: "Código", keyword: "shell", function: "Comandos Shell", description: "Ejecución de comandos de sistema operativo con parsing de output y manejo de errores.", priority: "Crítica", dependencies: "-" },
      { id: 30, category: "Código", keyword: "regex_build", function: "Constructor de Regex", description: "Creación y testing de expresiones regulares complejas con explicación paso a paso.", priority: "Media", dependencies: "-" },
    ];
  }

  static getSpecializedTools(): ToolData[] {
    return [
      { id: 31, category: "Generación", keyword: "generate_text", function: "Generación de Texto", description: "Creación de contenido textual largo con control de estilo, tono, estructura y coherencia narrativa.", priority: "Alta", dependencies: "-" },
      { id: 32, category: "Generación", keyword: "generate_image", function: "Generación de Imágenes", description: "Integración con modelos de difusión (DALL-E, Stable Diffusion, Midjourney API) para creación de imágenes desde prompts.", priority: "Media", dependencies: "api_call" },
      { id: 33, category: "Generación", keyword: "generate_audio", function: "Síntesis de Voz", description: "Text-to-speech con múltiples voces, idiomas, control de prosodia y emociones. Incluye clonación de voz.", priority: "Media", dependencies: "api_call" },
      { id: 34, category: "Generación", keyword: "generate_video", function: "Generación de Video", description: "Creación de videos cortos desde prompts o imágenes estáticas usando modelos generativos.", priority: "Baja", dependencies: "api_call, generate_image" },
      { id: 35, category: "Generación", keyword: "generate_music", function: "Generación Musical", description: "Composición de música y efectos de sonido mediante modelos especializados.", priority: "Baja", dependencies: "api_call" },
      { id: 36, category: "Procesamiento", keyword: "transcribe_audio", function: "Transcripción", description: "Conversión speech-to-text con diarización de hablantes, timestamps, detección de idioma y puntuación.", priority: "Alta", dependencies: "-" },
      { id: 37, category: "Procesamiento", keyword: "ocr_extract", function: "OCR", description: "Extracción de texto de imágenes y PDFs escaneados con detección de layout y tablas.", priority: "Alta", dependencies: "-" },
      { id: 38, category: "Procesamiento", keyword: "vision_analyze", function: "Análisis de Imagen", description: "Descripción, clasificación, detección de objetos, lectura de gráficos y extracción de información visual.", priority: "Alta", dependencies: "-" },
      { id: 39, category: "Procesamiento", keyword: "video_analyze", function: "Análisis de Video", description: "Extracción de frames clave, transcripción de audio, detección de escenas y resumen visual.", priority: "Media", dependencies: "transcribe_audio, vision_analyze" },
      { id: 40, category: "Datos", keyword: "data_analyze", function: "Análisis Estadístico", description: "Análisis exploratorio, estadísticas descriptivas, correlaciones, tests de hipótesis y detección de outliers.", priority: "Alta", dependencies: "code_execute" },
      { id: 41, category: "Datos", keyword: "data_visualize", function: "Visualización de Datos", description: "Generación de gráficos: barras, líneas, scatter, heatmaps, mapas geográficos usando matplotlib/plotly.", priority: "Alta", dependencies: "code_execute, data_analyze" },
      { id: 42, category: "Datos", keyword: "data_transform", function: "Transformación de Datos", description: "ETL: limpieza, normalización, encoding, feature engineering, pivoting y reshaping de datasets.", priority: "Alta", dependencies: "code_execute" },
      { id: 43, category: "Datos", keyword: "data_validate", function: "Validación de Datos", description: "Verificación de integridad, detección de anomalías, validación de esquemas y quality checks.", priority: "Media", dependencies: "code_execute" },
      { id: 44, category: "Datos", keyword: "ml_train", function: "Entrenamiento ML", description: "Entrenamiento de modelos de machine learning: clasificación, regresión, clustering, NLP.", priority: "Media", dependencies: "code_execute, data_analyze" },
      { id: 45, category: "Datos", keyword: "ml_predict", function: "Predicción ML", description: "Inferencia con modelos entrenados, batch prediction y evaluación de resultados.", priority: "Media", dependencies: "ml_train" },
      { id: 46, category: "Archivos", keyword: "file_read", function: "Lectura de Archivos", description: "Lectura de múltiples formatos: txt, json, csv, xml, yaml, markdown, pdf, docx, xlsx con parsing automático.", priority: "Crítica", dependencies: "-" },
      { id: 47, category: "Archivos", keyword: "file_write", function: "Escritura de Archivos", description: "Creación y modificación de archivos en múltiples formatos con encoding apropiado.", priority: "Crítica", dependencies: "-" },
      { id: 48, category: "Archivos", keyword: "file_convert", function: "Conversión de Formatos", description: "Conversión entre formatos de archivo: pdf↔docx, json↔csv, markdown↔html, etc.", priority: "Alta", dependencies: "file_read, file_write" },
      { id: 49, category: "Archivos", keyword: "file_compress", function: "Compresión", description: "Compresión y descompresión: zip, tar, gzip, 7z con soporte para archivos protegidos.", priority: "Media", dependencies: "-" },
      { id: 50, category: "Documentos", keyword: "doc_create", function: "Creación de Documentos", description: "Generación de documentos Word/PDF con formato profesional, estilos, tablas e imágenes.", priority: "Alta", dependencies: "file_write, generate_text" },
      { id: 51, category: "Documentos", keyword: "slides_create", function: "Creación de Presentaciones", description: "Generación de PowerPoint con layouts automáticos, gráficos y diseño consistente.", priority: "Alta", dependencies: "file_write, data_visualize" },
      { id: 52, category: "Documentos", keyword: "spreadsheet_create", function: "Creación de Hojas de Cálculo", description: "Generación de Excel con fórmulas, formato condicional, gráficos y tablas dinámicas.", priority: "Alta", dependencies: "file_write, data_analyze" },
      { id: 53, category: "Documentos", keyword: "pdf_manipulate", function: "Manipulación de PDF", description: "Merge, split, rotate, extract pages, añadir watermarks y protección a PDFs.", priority: "Media", dependencies: "file_read, file_write" },
      { id: 54, category: "Desarrollo", keyword: "git_manage", function: "Gestión de Git", description: "Operaciones git: clone, pull, push, branch, merge, rebase, stash con resolución de conflictos.", priority: "Alta", dependencies: "shell" },
      { id: 55, category: "Desarrollo", keyword: "github_interact", function: "Interacción con GitHub", description: "API de GitHub: issues, PRs, reviews, actions, releases, gists con autenticación OAuth.", priority: "Alta", dependencies: "api_oauth, git_manage" },
      { id: 56, category: "Desarrollo", keyword: "webdev_init", function: "Scaffolding Web", description: "Inicialización de proyectos web: React, Vue, Next.js, Express con configuración de build tools.", priority: "Media", dependencies: "shell, file_write" },
      { id: 57, category: "Desarrollo", keyword: "deploy", function: "Deployment", description: "Despliegue a plataformas cloud: Vercel, Netlify, AWS, GCP, Azure con configuración automática.", priority: "Media", dependencies: "shell, api_call" },
      { id: 58, category: "Bases de Datos", keyword: "db_query", function: "Consultas SQL/NoSQL", description: "Ejecución de queries en PostgreSQL, MySQL, MongoDB, Redis con parametrización segura.", priority: "Alta", dependencies: "api_call" },
      { id: 59, category: "Bases de Datos", keyword: "db_migrate", function: "Migraciones", description: "Gestión de esquemas de base de datos: migraciones, rollbacks, seeding de datos.", priority: "Media", dependencies: "db_query, file_write" },
    ];
  }

  static getIntegrations(): ToolData[] {
    return [
      { id: 60, category: "APIs", keyword: "api_call", function: "Llamadas HTTP", description: "Cliente HTTP universal con soporte para REST, GraphQL, SOAP. Manejo de auth, retries, rate limiting.", priority: "Crítica", dependencies: "-" },
      { id: 61, category: "APIs", keyword: "api_oauth", function: "OAuth/Auth", description: "Flujos de autenticación OAuth 1.0/2.0, API keys, JWT, certificates y token refresh.", priority: "Alta", dependencies: "api_call" },
      { id: 62, category: "APIs", keyword: "webhook_receive", function: "Webhooks Entrantes", description: "Endpoint para recibir callbacks y notificaciones de servicios externos.", priority: "Media", dependencies: "expose" },
      { id: 63, category: "APIs", keyword: "webhook_send", function: "Webhooks Salientes", description: "Envío de notificaciones HTTP a endpoints configurados por el usuario.", priority: "Media", dependencies: "api_call" },
      { id: 64, category: "Protocolos", keyword: "mcp_connect", function: "MCP Client", description: "Cliente del Model Context Protocol para conectar con servidores MCP externos y extender capacidades.", priority: "Alta", dependencies: "api_call" },
      { id: 65, category: "Protocolos", keyword: "mcp_serve", function: "MCP Server", description: "Exposición de herramientas propias como servidor MCP para interoperabilidad.", priority: "Media", dependencies: "expose" },
      { id: 66, category: "Protocolos", keyword: "a2a_communicate", function: "Agent-to-Agent", description: "Protocolo de comunicación entre agentes para colaboración y delegación de tareas.", priority: "Media", dependencies: "api_call" },
      { id: 67, category: "Productividad", keyword: "email_manage", function: "Email", description: "Lectura, envío, búsqueda y organización de correos via Gmail/Outlook API.", priority: "Alta", dependencies: "api_oauth" },
      { id: 68, category: "Productividad", keyword: "calendar_manage", function: "Calendario", description: "Gestión de eventos, disponibilidad, scheduling y recordatorios.", priority: "Alta", dependencies: "api_oauth" },
      { id: 69, category: "Productividad", keyword: "drive_manage", function: "Cloud Storage", description: "Operaciones en Google Drive, Dropbox, OneDrive: upload, download, share, organize.", priority: "Alta", dependencies: "api_oauth" },
      { id: 70, category: "Productividad", keyword: "docs_edit", function: "Google Docs", description: "Edición colaborativa de documentos en Google Docs con sugerencias y comentarios.", priority: "Media", dependencies: "api_oauth" },
      { id: 71, category: "Productividad", keyword: "sheets_edit", function: "Google Sheets", description: "Manipulación de hojas de cálculo en Google Sheets con fórmulas y formato.", priority: "Media", dependencies: "api_oauth" },
      { id: 72, category: "Productividad", keyword: "notion_manage", function: "Notion", description: "CRUD en bases de datos de Notion, páginas, bloques y relaciones.", priority: "Media", dependencies: "api_oauth" },
      { id: 73, category: "Productividad", keyword: "airtable_manage", function: "Airtable", description: "Gestión de bases, tablas y registros en Airtable con filtros y vistas.", priority: "Media", dependencies: "api_oauth" },
      { id: 74, category: "Comunicación", keyword: "slack_interact", function: "Slack", description: "Envío de mensajes, lectura de canales, gestión de threads y reacciones.", priority: "Alta", dependencies: "api_oauth" },
      { id: 75, category: "Comunicación", keyword: "teams_interact", function: "Microsoft Teams", description: "Integración con Teams: mensajes, reuniones, canales y archivos.", priority: "Media", dependencies: "api_oauth" },
      { id: 76, category: "Comunicación", keyword: "discord_interact", function: "Discord", description: "Bots y webhooks para Discord: mensajes, embeds, reacciones, comandos.", priority: "Media", dependencies: "api_oauth" },
      { id: 77, category: "Comunicación", keyword: "telegram_interact", function: "Telegram", description: "API de Telegram para bots: mensajes, keyboards, inline queries, grupos.", priority: "Media", dependencies: "api_call" },
      { id: 78, category: "Business", keyword: "crm_manage", function: "CRM", description: "Integración con Salesforce, HubSpot, Pipedrive: contactos, deals, actividades.", priority: "Media", dependencies: "api_oauth" },
      { id: 79, category: "Business", keyword: "erp_connect", function: "ERP", description: "Conexión con sistemas ERP: SAP, Oracle, NetSuite para datos empresariales.", priority: "Baja", dependencies: "api_oauth" },
      { id: 80, category: "Browser", keyword: "browser_navigate", function: "Navegación Web", description: "Control de navegador headless para navegación, clicks, formularios, screenshots.", priority: "Alta", dependencies: "shell" },
      { id: 81, category: "Browser", keyword: "browser_extract", function: "Extracción Web", description: "Web scraping estructurado con selectores CSS/XPath y paginación automática.", priority: "Alta", dependencies: "browser_navigate" },
      { id: 82, category: "Browser", keyword: "browser_automate", function: "Automatización Browser", description: "Secuencias de acciones automatizadas: login, navegación multi-paso, descarga.", priority: "Media", dependencies: "browser_navigate" },
      { id: 83, category: "Finanzas", keyword: "payment_process", function: "Procesamiento de Pagos", description: "Integración con Stripe, PayPal, Square para pagos, suscripciones y facturas.", priority: "Media", dependencies: "api_oauth" },
      { id: 84, category: "Finanzas", keyword: "accounting_sync", function: "Contabilidad", description: "Sincronización con QuickBooks, Xero, FreshBooks para invoices y reportes.", priority: "Baja", dependencies: "api_oauth" },
    ];
  }

  static getAutomationSecurity(): ToolData[] {
    return [
      { id: 85, category: "Automatización", keyword: "schedule_cron", function: "Tareas Programadas", description: "Scheduler con expresiones cron para tareas recurrentes con timezone support.", priority: "Alta", dependencies: "-" },
      { id: 86, category: "Automatización", keyword: "schedule_once", function: "Tareas Diferidas", description: "Ejecución única en fecha/hora futura con retry y notificación.", priority: "Media", dependencies: "schedule_cron" },
      { id: 87, category: "Automatización", keyword: "trigger_event", function: "Triggers por Evento", description: "Ejecución basada en eventos: file changes, webhooks, email arrival, etc.", priority: "Media", dependencies: "webhook_receive" },
      { id: 88, category: "Automatización", keyword: "queue_manage", function: "Cola de Tareas", description: "Sistema de job queue con prioridades, retries, dead letter queue y monitoring.", priority: "Media", dependencies: "-" },
      { id: 89, category: "Infra", keyword: "expose_port", function: "Exposición de Puertos", description: "Túneles para exponer servicios locales a URLs públicas temporales.", priority: "Media", dependencies: "shell" },
      { id: 90, category: "Infra", keyword: "container_manage", function: "Contenedores", description: "Gestión de Docker containers: build, run, stop, logs, exec.", priority: "Media", dependencies: "shell" },
      { id: 91, category: "Infra", keyword: "vm_manage", function: "Máquinas Virtuales", description: "Provisioning y gestión de VMs en cloud providers.", priority: "Baja", dependencies: "api_call" },
      { id: 92, category: "Seguridad", keyword: "secrets_manage", function: "Gestión de Secretos", description: "Almacenamiento seguro de API keys, passwords, tokens con encryption at rest.", priority: "Crítica", dependencies: "-" },
      { id: 93, category: "Seguridad", keyword: "encrypt_decrypt", function: "Criptografía", description: "Operaciones de cifrado/descifrado simétrico y asimétrico.", priority: "Alta", dependencies: "-" },
      { id: 94, category: "Seguridad", keyword: "hash_verify", function: "Hashing", description: "Generación y verificación de hashes (SHA, bcrypt, argon2).", priority: "Alta", dependencies: "-" },
      { id: 95, category: "Seguridad", keyword: "sanitize_input", function: "Sanitización", description: "Limpieza y validación de inputs para prevenir injection attacks.", priority: "Crítica", dependencies: "-" },
      { id: 96, category: "Seguridad", keyword: "audit_log", function: "Auditoría", description: "Registro detallado de acciones para compliance y debugging.", priority: "Alta", dependencies: "-" },
      { id: 97, category: "Seguridad", keyword: "rate_limit", function: "Rate Limiting", description: "Control de frecuencia de requests para prevenir abuso.", priority: "Alta", dependencies: "-" },
      { id: 98, category: "Monitoreo", keyword: "health_check", function: "Health Checks", description: "Verificación periódica del estado de servicios y dependencias.", priority: "Alta", dependencies: "api_call" },
      { id: 99, category: "Monitoreo", keyword: "alert_send", function: "Alertas", description: "Envío de notificaciones ante errores, umbrales o eventos críticos.", priority: "Alta", dependencies: "email_manage, slack_interact" },
      { id: 100, category: "Monitoreo", keyword: "metrics_collect", function: "Métricas", description: "Recolección y agregación de métricas de rendimiento y uso.", priority: "Media", dependencies: "-" },
    ];
  }

  static getSpecializedAgents(): AgentData[] {
    return [
      { id: 1, name: "Super Agent / Orchestrator", function: "Orquestación Central", description: "Núcleo del sistema que descompone tareas complejas, selecciona herramientas y sub-agentes, ejecuta flujos multi-paso y gestiona estado global.", coreTools: "plan, orchestrate, workflow, memory_*, reason, reflect, decide", useCases: "Tareas complejas multi-dominio, coordinación de equipos de agentes, proyectos largos" },
      { id: 2, name: "Research Agent", function: "Investigación Profunda", description: "Agente especializado en búsqueda, síntesis y verificación de información de múltiples fuentes.", coreTools: "search_web, fetch_url, research_deep, summarize, verify, memory_store", useCases: "Due diligence, market research, competitive analysis, fact-checking" },
      { id: 3, name: "Code Agent", function: "Desarrollo de Software", description: "Asistente de programación completo: genera, revisa, testea, debuggea y despliega código.", coreTools: "code_*, shell, git_manage, github_interact, webdev_init, deploy", useCases: "Desarrollo de features, bug fixes, code review, refactoring, CI/CD" },
      { id: 4, name: "Data Agent", function: "Análisis de Datos", description: "Especialista en procesamiento, análisis y visualización de datos estructurados y no estructurados.", coreTools: "data_*, code_execute, db_*, file_read, spreadsheet_create", useCases: "ETL, reporting, dashboards, análisis estadístico, ML pipelines" },
      { id: 5, name: "Content Agent", function: "Creación de Contenido", description: "Generador de contenido textual y multimedia de alta calidad.", coreTools: "generate_*, doc_create, slides_create, vision_analyze, summarize", useCases: "Marketing content, documentación, presentaciones, social media" },
      { id: 6, name: "Communication Agent", function: "Gestión de Comunicación", description: "Gestión inteligente de email, calendario y mensajería.", coreTools: "email_manage, calendar_manage, slack_interact, teams_interact, summarize, clarify", useCases: "Email triage, scheduling, meeting prep, follow-ups" },
      { id: 7, name: "Browser Agent", function: "Automatización Web", description: "Navegador autónomo para tareas que requieren interacción con sitios web.", coreTools: "browser_*, ocr_extract, vision_analyze, file_write", useCases: "Web scraping, form filling, testing, price monitoring" },
      { id: 8, name: "Document Agent", function: "Procesamiento de Documentos", description: "Especialista en extracción, transformación y generación de documentos.", coreTools: "file_*, ocr_extract, doc_create, pdf_manipulate, transcribe_audio", useCases: "Contract analysis, document digitization, report generation" },
      { id: 9, name: "QA Agent", function: "Quality Assurance", description: "Agente de verificación y validación de outputs de otros agentes.", coreTools: "verify, code_review, code_test, reflect, reason", useCases: "Output validation, fact-checking, code quality, consistency checks" },
      { id: 10, name: "Security Agent", function: "Seguridad", description: "Gestión de credenciales, auditoría y compliance.", coreTools: "secrets_manage, encrypt_*, sanitize_input, audit_log, health_check", useCases: "Secret rotation, security scanning, compliance reporting" },
    ];
  }

  static getCategoryDistribution(): CategoryDistribution[] {
    return [
      { name: "Orquestación", value: 3 },
      { name: "Memoria", value: 4 },
      { name: "Razonamiento", value: 7 },
      { name: "Comunicación", value: 4 },
      { name: "Búsqueda", value: 4 },
      { name: "Código", value: 8 },
      { name: "Generación", value: 5 },
      { name: "Procesamiento", value: 4 },
      { name: "Datos", value: 6 },
      { name: "Archivos", value: 4 },
      { name: "Documentos", value: 4 },
      { name: "Desarrollo", value: 4 },
      { name: "Bases de Datos", value: 2 },
      { name: "APIs", value: 4 },
      { name: "Protocolos", value: 3 },
      { name: "Productividad", value: 7 },
      { name: "Browser", value: 3 },
      { name: "Finanzas", value: 2 },
      { name: "Automatización", value: 4 },
      { name: "Infra", value: 3 },
      { name: "Seguridad", value: 6 },
      { name: "Monitoreo", value: 3 },
    ];
  }

  static getPriorityDistribution(): PriorityDistribution[] {
    return [
      { name: "Crítica", value: 16, priority: 'critical' as Priority },
      { name: "Alta", value: 43, priority: 'high' as Priority },
      { name: "Media", value: 36, priority: 'medium' as Priority },
      { name: "Baja", value: 5, priority: 'low' as Priority },
    ];
  }

  static getAllTools(): ToolData[] {
    return [
      ...this.getCoreTools(),
      ...this.getSpecializedTools(),
      ...this.getIntegrations(),
      ...this.getAutomationSecurity(),
    ];
  }

  static countByPriority(priority: string): number {
    return this.getAllTools().filter(tool => tool.priority === priority).length;
  }

  static getUniqueCategories(): string[] {
    const categories = new Set<string>();
    this.getAllTools().forEach(tool => categories.add(tool.category));
    return Array.from(categories);
  }
}

export class AgentToolsGenerator {
  private workbook: ExcelJS.Workbook;
  private styles: ExcelStyleConfig;
  private version: string = '2.0.0';
  private generatedAt: Date;

  constructor() {
    this.workbook = new ExcelJS.Workbook();
    this.styles = new ExcelStyleConfig();
    this.generatedAt = new Date();
    this.workbook.creator = 'IliaGPT Agent Tools Generator';
    this.workbook.created = this.generatedAt;
  }

  private mapPriorityToStyle(priority: string): Priority {
    const map: Record<string, Priority> = {
      'Crítica': 'critical',
      'Alta': 'high',
      'Media': 'medium',
      'Baja': 'low',
    };
    return map[priority] || 'medium';
  }

  validateData(): void {
    const allTools = AgentToolsData.getAllTools();
    const agents = AgentToolsData.getSpecializedAgents();
    const priorityDistribution = AgentToolsData.getPriorityDistribution();

    if (allTools.length !== 100) {
      throw new Error(`Validación fallida: Se esperaban 100 herramientas, se encontraron ${allTools.length}`);
    }

    if (agents.length !== 10) {
      throw new Error(`Validación fallida: Se esperaban 10 agentes, se encontraron ${agents.length}`);
    }

    const actualPriorityCount: Record<string, number> = {};
    allTools.forEach(tool => {
      actualPriorityCount[tool.priority] = (actualPriorityCount[tool.priority] || 0) + 1;
    });

    for (const dist of priorityDistribution) {
      const actual = actualPriorityCount[dist.name] || 0;
      if (actual !== dist.value) {
        throw new Error(`Validación fallida: Prioridad "${dist.name}" esperaba ${dist.value} herramientas, se encontraron ${actual}`);
      }
    }
  }

  createDashboard(): void {
    const ws = this.workbook.addWorksheet('🎯 Dashboard');
    const colors = this.styles.getColors();

    for (let row = 1; row <= 70; row++) {
      for (let col = 1; col <= 25; col++) {
        const cell = ws.getCell(row, col);
        cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: colors.WHITE } };
      }
    }

    ws.mergeCells('B2:R3');
    const titleCell = ws.getCell('B2');
    titleCell.value = '🤖 AGENT TOOLS COMMAND CENTER - ENTERPRISE EDITION';
    titleCell.font = this.styles.titleFont;
    titleCell.fill = this.styles.headerFill;
    titleCell.alignment = { horizontal: 'center', vertical: 'middle' };

    const totalTools = AgentToolsData.getAllTools().length;
    const criticalCount = AgentToolsData.countByPriority('Crítica');
    const agentsCount = AgentToolsData.getSpecializedAgents().length;
    const categoriesCount = AgentToolsData.getUniqueCategories().length;
    const integrationsCount = AgentToolsData.getIntegrations().length;
    const securityCount = AgentToolsData.getAllTools().filter(t => t.category === 'Seguridad').length;

    ws.mergeCells('B4:R4');
    const subtitleCell = ws.getCell('B4');
    subtitleCell.value = `📅 Generado: ${this.generatedAt.toLocaleDateString('es-ES')} ${this.generatedAt.toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' })} | 🔧 ${totalTools} Herramientas | 🤖 ${agentsCount} Agentes | 📦 ${categoriesCount} Categorías | v${this.version}`;
    subtitleCell.font = { ...this.styles.smallFont, italic: true };
    subtitleCell.alignment = { horizontal: 'center' };

    const kpiData: Array<{ icon: string; title: string; value: string; color: string }> = [
      { icon: '🔧', title: 'HERRAMIENTAS\nTOTALES', value: String(totalTools), color: colors.ACCENT_PURPLE },
      { icon: '⚡', title: 'CRÍTICAS', value: String(criticalCount), color: colors.ACCENT_RED },
      { icon: '🤖', title: 'AGENTES', value: String(agentsCount), color: colors.ACCENT_TEAL },
      { icon: '📦', title: 'CATEGORÍAS', value: String(categoriesCount), color: colors.ACCENT_ORANGE },
      { icon: '🔗', title: 'INTEGRACIONES', value: String(integrationsCount), color: colors.ACCENT_GREEN },
      { icon: '🔒', title: 'SEGURIDAD', value: String(securityCount), color: colors.ACCENT_PINK },
    ];

    let colStart = 2;
    kpiData.forEach((kpi, i) => {
      const col = colStart + (i * 3);
      for (let r = 6; r <= 11; r++) {
        for (let c = col; c <= col + 1; c++) {
          const cell = ws.getCell(r, c);
          cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: kpi.color } };
          cell.border = this.styles.thinBorder;
        }
      }

      ws.mergeCells(6, col, 6, col + 1);
      const iconCell = ws.getCell(6, col);
      iconCell.value = kpi.icon;
      iconCell.font = { size: 28 };
      iconCell.alignment = { horizontal: 'center' };

      ws.mergeCells(7, col, 9, col + 1);
      const valueCell = ws.getCell(7, col);
      valueCell.value = kpi.value;
      valueCell.font = { name: 'Arial', size: 32, bold: true, color: { argb: colors.WHITE } };
      valueCell.alignment = { horizontal: 'center', vertical: 'middle' };

      ws.mergeCells(10, col, 11, col + 1);
      const titleKpiCell = ws.getCell(10, col);
      titleKpiCell.value = kpi.title;
      titleKpiCell.font = { name: 'Arial', size: 9, bold: true, color: { argb: colors.WHITE } };
      titleKpiCell.alignment = { horizontal: 'center', vertical: 'middle', wrapText: true };
    });

    ws.mergeCells('B14:H14');
    const catTitleCell = ws.getCell('B14');
    catTitleCell.value = '📊 DISTRIBUCIÓN POR CATEGORÍA';
    catTitleCell.font = this.styles.subtitleFont;

    const categories = AgentToolsData.getCategoryDistribution().slice(0, 15);
    categories.forEach((cat, i) => {
      const row = 16 + i;
      const nameCell = ws.getCell(row, 2);
      nameCell.value = cat.name;
      nameCell.font = this.styles.bodyFont;

      const valueCell = ws.getCell(row, 3);
      valueCell.value = cat.value;
      valueCell.font = this.styles.bodyFont;
      valueCell.alignment = { horizontal: 'center' };

      if (i % 2 === 0) {
        nameCell.fill = this.styles.altRowFill;
        valueCell.fill = this.styles.altRowFill;
      }
    });

    ws.mergeCells('B34:H34');
    const priTitleCell = ws.getCell('B34');
    priTitleCell.value = '⚡ DISTRIBUCIÓN POR PRIORIDAD';
    priTitleCell.font = this.styles.subtitleFont;

    const priorities = AgentToolsData.getPriorityDistribution();
    priorities.forEach((pri, i) => {
      const row = 36 + i;
      const nameCell = ws.getCell(row, 2);
      nameCell.value = pri.name;
      nameCell.fill = this.styles.getPriorityFill(pri.priority);
      nameCell.font = this.styles.getPriorityFont(pri.priority);

      const valueCell = ws.getCell(row, 3);
      valueCell.value = pri.value;
      valueCell.font = this.styles.bodyFont;
    });

    ws.mergeCells('K14:R14');
    const navTitleCell = ws.getCell('K14');
    navTitleCell.value = '🧭 NAVEGACIÓN RÁPIDA';
    navTitleCell.font = this.styles.subtitleFont;

    const navItems = [
      '📋 Core Agent Tools (30)',
      '🎯 Specialized Tools (29)',
      '🔌 Integrations & APIs (25)',
      '🔒 Automation & Security (16)',
      '🤖 Specialized Agents (10)',
      '📊 Dependency Matrix',
      '📈 Implementation Roadmap',
      '📚 Technical Documentation',
      '📝 Changelog',
    ];

    navItems.forEach((name, i) => {
      const row = 16 + i;
      ws.mergeCells(row, 11, row, 18);
      const cell = ws.getCell(row, 11);
      cell.value = name;
      cell.font = this.styles.linkFont;
      cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: colors.LIGHT_BLUE } };
      cell.alignment = { horizontal: 'left', vertical: 'middle' };
      cell.border = this.styles.thinBorder;
    });

    ws.mergeCells('K27:R27');
    const summaryTitleCell = ws.getCell('K27');
    summaryTitleCell.value = '📋 RESUMEN EJECUTIVO';
    summaryTitleCell.font = this.styles.subtitleFont;

    const summaryTexts = [
      '• Sistema completo de 100 herramientas para agentes de IA',
      '• 20 herramientas CRÍTICAS para funcionamiento básico',
      '• 10 agentes especializados pre-configurados',
      '• Cobertura completa: desde orquestación hasta seguridad',
      '• Arquitectura modular y extensible',
      '• Documentación técnica integrada',
    ];

    summaryTexts.forEach((text, i) => {
      const row = 29 + i;
      ws.mergeCells(row, 11, row, 18);
      const cell = ws.getCell(row, 11);
      cell.value = text;
      cell.font = this.styles.bodyFont;
    });

    ws.getColumn(1).width = 3;
    for (let col = 2; col <= 20; col++) {
      ws.getColumn(col).width = 10;
    }
  }

  createDataSheet(sheetName: string, tools: ToolData[], emoji: string): void {
    const ws = this.workbook.addWorksheet(sheetName);
    const colors = this.styles.getColors();

    for (let row = 1; row <= 4; row++) {
      for (let col = 1; col <= TOOL_HEADERS.length; col++) {
        const cell = ws.getCell(row, col);
        cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: colors.WHITE } };
      }
    }

    ws.mergeCells(1, 1, 1, TOOL_HEADERS.length);
    const titleCell = ws.getCell('A1');
    titleCell.value = `${emoji} ${sheetName.replace(/^[🔧🎯🔌🔒]\s*/, '').toUpperCase()}`;
    titleCell.font = { name: 'Arial', size: 18, bold: true, color: { argb: colors.DARK_BLUE } };
    titleCell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: colors.LIGHT_BLUE } };

    ws.mergeCells(2, 1, 2, TOOL_HEADERS.length);
    const subtitleCell = ws.getCell('A2');
    subtitleCell.value = `Total: ${tools.length} herramientas | Última actualización: ${this.generatedAt.toLocaleDateString('es-ES')}`;
    subtitleCell.font = this.styles.smallFont;

    TOOL_HEADERS.forEach((header, colIdx) => {
      const cell = ws.getCell(4, colIdx + 1);
      cell.value = header.toUpperCase();
      cell.font = this.styles.headerFont;
      cell.fill = this.styles.headerFill;
      cell.alignment = { horizontal: 'center', vertical: 'middle', wrapText: true };
      cell.border = this.styles.thinBorder;
    });

    tools.forEach((tool, rowIdx) => {
      const row = 5 + rowIdx;
      const values = [tool.id, tool.category, tool.keyword, tool.function, tool.description, tool.priority, tool.dependencies];
      
      values.forEach((value, colIdx) => {
        const cell = ws.getCell(row, colIdx + 1);
        cell.value = value;
        cell.font = this.styles.bodyFont;
        cell.border = this.styles.thinBorder;
        cell.alignment = { vertical: 'middle', wrapText: true };

        if (rowIdx % 2 === 1) {
          cell.fill = this.styles.altRowFill;
        }

        if (TOOL_HEADERS[colIdx] === 'Prioridad' && typeof value === 'string') {
          const priority = this.mapPriorityToStyle(value);
          cell.fill = this.styles.getPriorityFill(priority);
          cell.font = this.styles.getPriorityFont(priority);
        }
      });
    });

    const colWidths = [5, 15, 18, 24, 65, 12, 28];
    colWidths.forEach((width, idx) => {
      ws.getColumn(idx + 1).width = width;
    });

    ws.views = [{ state: 'frozen', ySplit: 4 }];
    ws.autoFilter = { from: { row: 4, column: 1 }, to: { row: 4 + tools.length, column: TOOL_HEADERS.length } };
  }

  createAgentsSheet(): void {
    const ws = this.workbook.addWorksheet('🤖 Agents');
    const agents = AgentToolsData.getSpecializedAgents();
    const colors = this.styles.getColors();

    for (let row = 1; row <= 4; row++) {
      for (let col = 1; col <= AGENT_HEADERS.length; col++) {
        const cell = ws.getCell(row, col);
        cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: colors.WHITE } };
      }
    }

    ws.mergeCells(1, 1, 1, AGENT_HEADERS.length);
    const titleCell = ws.getCell('A1');
    titleCell.value = '🤖 AGENTES ESPECIALIZADOS';
    titleCell.font = { name: 'Arial', size: 18, bold: true, color: { argb: colors.DARK_BLUE } };
    titleCell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: colors.LIGHT_BLUE } };

    ws.mergeCells(2, 1, 2, AGENT_HEADERS.length);
    const subtitleCell = ws.getCell('A2');
    subtitleCell.value = '10 agentes pre-configurados para dominios específicos | Cada agente combina múltiples herramientas optimizadas';
    subtitleCell.font = this.styles.smallFont;

    AGENT_HEADERS.forEach((header, colIdx) => {
      const cell = ws.getCell(4, colIdx + 1);
      cell.value = header.toUpperCase();
      cell.font = this.styles.headerFont;
      cell.fill = this.styles.headerFill;
      cell.alignment = { horizontal: 'center', vertical: 'middle', wrapText: true };
      cell.border = this.styles.thinBorder;
    });

    const agentColors = [
      colors.ACCENT_PURPLE,
      colors.ACCENT_TEAL,
      colors.ACCENT_GREEN,
      colors.ACCENT_ORANGE,
      colors.ACCENT_PINK,
      colors.ACCENT_RED,
      colors.MEDIUM_BLUE,
      colors.ACCENT_YELLOW,
      colors.GRAY_500,
      colors.DARK_BLUE,
    ];

    agents.forEach((agent, rowIdx) => {
      const row = 5 + rowIdx;
      const color = agentColors[rowIdx % agentColors.length];
      const values = [agent.id, agent.name, agent.function, agent.description, agent.coreTools, agent.useCases];

      values.forEach((value, colIdx) => {
        const cell = ws.getCell(row, colIdx + 1);
        cell.value = value;
        cell.font = this.styles.bodyFont;
        cell.border = this.styles.thinBorder;
        cell.alignment = { vertical: 'middle', wrapText: true };

        if (colIdx === 0) {
          cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: color } };
          cell.font = { name: 'Arial', size: 10, bold: true, color: { argb: colors.WHITE } };
          cell.alignment = { horizontal: 'center', vertical: 'middle' };
        } else if (colIdx === 1) {
          cell.font = { name: 'Arial', size: 10, bold: true, color: { argb: color } };
        }
      });
    });

    const colWidths = [5, 28, 22, 65, 55, 55];
    colWidths.forEach((width, idx) => {
      ws.getColumn(idx + 1).width = width;
    });

    ws.views = [{ state: 'frozen', ySplit: 4 }];
  }

  createDependencyMatrix(): void {
    const ws = this.workbook.addWorksheet('📊 Dependencies');
    const colors = this.styles.getColors();

    ws.mergeCells('A1:D1');
    const titleCell = ws.getCell('A1');
    titleCell.value = '📊 MATRIZ DE DEPENDENCIAS ENTRE HERRAMIENTAS';
    titleCell.font = { name: 'Arial', size: 18, bold: true, color: { argb: colors.DARK_BLUE } };
    titleCell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: colors.LIGHT_BLUE } };

    const descCell = ws.getCell('A3');
    descCell.value = 'Esta matriz muestra las relaciones de dependencia entre las herramientas principales del sistema.';
    descCell.font = this.styles.smallFont;

    const allTools = [
      ...AgentToolsData.getCoreTools(),
      ...AgentToolsData.getSpecializedTools(),
      ...AgentToolsData.getIntegrations(),
      ...AgentToolsData.getAutomationSecurity(),
    ];

    const depLookup = new Map<string, string>();
    allTools.forEach(tool => {
      depLookup.set(tool.keyword, tool.dependencies);
    });

    const headers = ['HERRAMIENTA', 'DEPENDE DE', 'USADO POR', 'NIVEL DE CRITICIDAD'];
    headers.forEach((header, colIdx) => {
      const cell = ws.getCell(5, colIdx + 1);
      cell.value = header;
      cell.font = this.styles.headerFont;
      cell.fill = this.styles.headerFill;
      cell.border = this.styles.thinBorder;
    });

    const keyTools = [
      'plan', 'orchestrate', 'workflow', 'memory_store', 'memory_retrieve',
      'context_manage', 'reason', 'reflect', 'verify', 'decide',
      'search_web', 'code_generate', 'code_execute', 'shell',
      'api_call', 'api_oauth', 'file_read', 'file_write',
      'generate_text', 'data_analyze', 'secrets_manage', 'schedule_cron',
      'browser_navigate', 'email_manage', 'mcp_connect'
    ];

    const criticalTools = new Set([
      'plan', 'orchestrate', 'memory_store', 'memory_retrieve', 'context_manage',
      'reason', 'message', 'search_web', 'code_generate', 'code_execute', 'shell',
      'api_call', 'file_read', 'file_write', 'secrets_manage', 'sanitize_input'
    ]);

    let row = 6;
    keyTools.forEach((tool, idx) => {
      if (!depLookup.has(tool)) return;

      const deps = depLookup.get(tool) || '-';
      const usedBy: string[] = [];
      depLookup.forEach((d, t) => {
        if (d.includes(tool) && t !== tool) {
          usedBy.push(t);
        }
      });

      const isCritical = criticalTools.has(tool);

      const toolCell = ws.getCell(row, 1);
      toolCell.value = tool;
      toolCell.font = { name: 'Arial', size: 10, bold: true, color: { argb: colors.MEDIUM_BLUE } };

      const depsCell = ws.getCell(row, 2);
      depsCell.value = deps;
      depsCell.font = this.styles.bodyFont;

      const usedByCell = ws.getCell(row, 3);
      usedByCell.value = usedBy.slice(0, 6).join(', ') || '-';
      usedByCell.font = this.styles.bodyFont;

      const critCell = ws.getCell(row, 4);
      critCell.value = isCritical ? 'CRÍTICA' : 'NORMAL';
      if (isCritical) {
        critCell.fill = this.styles.getPriorityFill('critical');
        critCell.font = this.styles.getPriorityFont('critical');
      } else {
        critCell.font = this.styles.bodyFont;
      }

      for (let col = 1; col <= 4; col++) {
        const cell = ws.getCell(row, col);
        cell.border = this.styles.thinBorder;
        if (idx % 2 === 1 && !(col === 4 && isCritical)) {
          cell.fill = this.styles.altRowFill;
        }
      }

      row++;
    });

    ws.getColumn(1).width = 22;
    ws.getColumn(2).width = 40;
    ws.getColumn(3).width = 50;
    ws.getColumn(4).width = 20;
  }

  createRoadmap(): void {
    const ws = this.workbook.addWorksheet('📈 Roadmap');
    const colors = this.styles.getColors();

    ws.mergeCells('A1:M1');
    const titleCell = ws.getCell('A1');
    titleCell.value = '📈 ROADMAP DE IMPLEMENTACIÓN - 12 MESES';
    titleCell.font = { name: 'Arial', size: 18, bold: true, color: { argb: colors.DARK_BLUE } };
    titleCell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: colors.LIGHT_BLUE } };

    const phases = [
      { name: 'FASE 1: FUNDAMENTOS CORE', timeline: 'Mes 1-3', tools: ['memory_store', 'memory_retrieve', 'context_manage', 'plan', 'reason', 'reflect', 'message'], color: colors.ACCENT_RED, desc: 'Establecer la base del sistema: memoria persistente, planificación y razonamiento básico.' },
      { name: 'FASE 2: CAPACIDADES OPERATIVAS', timeline: 'Mes 4-6', tools: ['orchestrate', 'workflow', 'search_web', 'code_generate', 'code_execute', 'shell', 'file_read', 'file_write'], color: colors.ACCENT_ORANGE, desc: 'Habilitar operaciones complejas: orquestación, ejecución de código y manejo de archivos.' },
      { name: 'FASE 3: INTEGRACIONES EXTERNAS', timeline: 'Mes 7-9', tools: ['api_call', 'api_oauth', 'email_manage', 'calendar_manage', 'drive_manage', 'slack_interact', 'mcp_connect'], color: colors.ACCENT_GREEN, desc: 'Conectar con servicios externos: APIs, email, calendario, storage y comunicación.' },
      { name: 'FASE 4: CAPACIDADES AVANZADAS', timeline: 'Mes 10-12', tools: ['browser_navigate', 'generate_image', 'data_analyze', 'ml_train', 'secrets_manage', 'schedule_cron'], color: colors.ACCENT_PURPLE, desc: 'Añadir funcionalidades avanzadas: automatización web, ML, seguridad y scheduling.' },
    ];

    let row = 4;
    phases.forEach(phase => {
      ws.mergeCells(row, 1, row, 13);
      const headerCell = ws.getCell(row, 1);
      headerCell.value = `${phase.name} (${phase.timeline})`;
      headerCell.font = { name: 'Arial', size: 14, bold: true, color: { argb: colors.WHITE } };
      headerCell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: phase.color } };
      row++;

      ws.mergeCells(row, 1, row, 13);
      const descCell = ws.getCell(row, 1);
      descCell.value = phase.desc;
      descCell.font = { name: 'Arial', size: 10, italic: true, color: { argb: colors.GRAY_600 } };
      row++;

      phase.tools.forEach((tool, i) => {
        const col = 2 + (i % 4) * 3;
        if (i > 0 && i % 4 === 0) row++;
        
        const cell = ws.getCell(row, col);
        cell.value = `• ${tool}`;
        cell.font = this.styles.bodyFont;
      });
      row += 3;
    });

    const ganttRow = row + 2;
    ws.mergeCells(ganttRow, 1, ganttRow, 13);
    const ganttTitle = ws.getCell(ganttRow, 1);
    ganttTitle.value = '📊 TIMELINE VISUAL';
    ganttTitle.font = this.styles.subtitleFont;

    const months = ['Ene', 'Feb', 'Mar', 'Abr', 'May', 'Jun', 'Jul', 'Ago', 'Sep', 'Oct', 'Nov', 'Dic'];
    const headerRow = ganttRow + 2;
    months.forEach((month, i) => {
      const cell = ws.getCell(headerRow, 2 + i);
      cell.value = month;
      cell.font = { name: 'Arial', size: 9, bold: true };
      cell.alignment = { horizontal: 'center' };
      cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: colors.GRAY_200 } };
      cell.border = this.styles.thinBorder;
    });

    const phaseInfo = [
      { name: 'Fase 1: Fundamentos', start: 0, end: 3, color: colors.ACCENT_RED },
      { name: 'Fase 2: Operativas', start: 3, end: 6, color: colors.ACCENT_ORANGE },
      { name: 'Fase 3: Integraciones', start: 6, end: 9, color: colors.ACCENT_GREEN },
      { name: 'Fase 4: Avanzadas', start: 9, end: 12, color: colors.ACCENT_PURPLE },
    ];

    phaseInfo.forEach((phase, i) => {
      const barRow = headerRow + 2 + i;
      const labelCell = ws.getCell(barRow, 1);
      labelCell.value = phase.name;
      labelCell.font = this.styles.bodyFont;

      for (let m = phase.start; m < phase.end; m++) {
        const cell = ws.getCell(barRow, 2 + m);
        cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: phase.color } };
        cell.border = this.styles.thinBorder;
      }
    });

    ws.getColumn(1).width = 25;
    for (let col = 2; col <= 15; col++) {
      ws.getColumn(col).width = 6;
    }
  }

  createDocumentation(): void {
    const ws = this.workbook.addWorksheet('📚 Documentation');
    const colors = this.styles.getColors();

    ws.mergeCells('A1:H1');
    const titleCell = ws.getCell('A1');
    titleCell.value = '📚 DOCUMENTACIÓN TÉCNICA - GUÍA DE IMPLEMENTACIÓN';
    titleCell.font = { name: 'Arial', size: 18, bold: true, color: { argb: colors.DARK_BLUE } };
    titleCell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: colors.LIGHT_BLUE } };

    const docSections = [
      { title: '🎯 OBJETIVO DEL SISTEMA', content: 'Este catálogo define las 100 herramientas necesarias para construir un agente de IA de clase mundial, capaz de realizar tareas complejas de manera autónoma con alta precisión y confiabilidad. El sistema está diseñado para ser modular, extensible y production-ready.' },
      { title: '🏗️ ARQUITECTURA DEL SISTEMA', content: 'El sistema se estructura en capas jerárquicas:\n• CORE: Orquestación, Memoria, Razonamiento (fundamentos del agente)\n• TOOLS: Herramientas especializadas para dominios específicos\n• INTEGRATIONS: APIs, protocolos y conectores externos\n• AGENTS: Sub-agentes pre-configurados para tareas complejas' },
      { title: '⚡ SISTEMA DE PRIORIDADES', content: 'CRÍTICA (20): Componentes esenciales sin los cuales el agente no puede funcionar. Implementar primero.\nALTA (45): Funcionalidades importantes para operación completa. Segunda prioridad.\nMEDIA (28): Mejoras significativas de capacidad. Tercera fase.\nBAJA (7): Nice-to-have para casos de uso específicos. Última fase.' },
      { title: '🔗 GESTIÓN DE DEPENDENCIAS', content: 'Las dependencias definen el orden obligatorio de implementación. NUNCA implementar una herramienta antes que sus dependencias. Usar la Matriz de Dependencias (hoja 📊 Dependencies) para planificar. El grafo de dependencias forma un DAG (Directed Acyclic Graph).' },
      { title: '🤖 AGENTES ESPECIALIZADOS', content: 'Los 10 agentes especializados son combinaciones pre-configuradas de herramientas optimizadas para dominios específicos. Cada agente incluye las herramientas necesarias para su dominio y está diseñado para trabajar de forma autónoma o en coordinación con otros agentes.' },
      { title: '📊 MÉTRICAS DE ÉXITO', content: '• Cobertura funcional: 100% de herramientas implementadas\n• Tiempo de respuesta: <2 segundos para operaciones simples\n• Precisión: >95% en tareas de su dominio\n• Disponibilidad: 99.9% uptime\n• Latencia de memoria: <100ms para retrieval' },
      { title: '🛡️ CONSIDERACIONES DE SEGURIDAD', content: 'Todas las operaciones sensibles requieren el módulo Security Agent. Los secrets NUNCA deben estar en código (usar secrets_manage). Implementar sanitize_input para TODOS los inputs de usuario. Activar audit_log para compliance y debugging. Usar rate_limit para prevenir abuso de recursos.' },
      { title: '📝 CONVENCIONES DE CÓDIGO', content: '• Nombres: snake_case para herramientas, PascalCase para agentes\n• Logging: Obligatorio para todas las operaciones\n• Errores: Usar excepciones tipadas, nunca silenciar errores\n• Tests: Cobertura mínima 80% para código crítico\n• Docs: Docstrings obligatorios para funciones públicas' },
      { title: '🔄 INTEGRACIÓN CON REPLIT', content: 'Para integrar este sistema en Replit:\n1. Subir agent_tools_generator.py al proyecto\n2. Instalar dependencias: pip install pandas openpyxl\n3. Importar: from agent_tools_generator import AgentToolsGenerator\n4. Usar: generator = AgentToolsGenerator()\n5. Generar: generator.generate("output.xlsx")' },
    ];

    let row = 4;
    docSections.forEach(section => {
      ws.mergeCells(row, 1, row, 8);
      const headerCell = ws.getCell(row, 1);
      headerCell.value = section.title;
      headerCell.font = { name: 'Arial', size: 12, bold: true, color: { argb: colors.MEDIUM_BLUE } };
      headerCell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: colors.LIGHT_BLUE } };
      row++;

      ws.mergeCells(row, 1, row + 3, 8);
      const contentCell = ws.getCell(row, 1);
      contentCell.value = section.content;
      contentCell.font = this.styles.bodyFont;
      contentCell.alignment = { wrapText: true, vertical: 'top' };
      row += 5;
    });

    for (let col = 1; col <= 8; col++) {
      ws.getColumn(col).width = 15;
    }
    ws.getColumn(1).width = 100;
  }

  createChangelog(): void {
    const ws = this.workbook.addWorksheet('📝 Changelog');
    const colors = this.styles.getColors();

    ws.mergeCells('A1:E1');
    const titleCell = ws.getCell('A1');
    titleCell.value = '📝 CHANGELOG - HISTORIAL DE VERSIONES';
    titleCell.font = { name: 'Arial', size: 18, bold: true, color: { argb: colors.DARK_BLUE } };
    titleCell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: colors.LIGHT_BLUE } };

    const headers = ['VERSIÓN', 'FECHA', 'TIPO', 'DESCRIPCIÓN'];
    headers.forEach((header, colIdx) => {
      const cell = ws.getCell(3, colIdx + 1);
      cell.value = header;
      cell.font = this.styles.headerFont;
      cell.fill = this.styles.headerFill;
      cell.border = this.styles.thinBorder;
    });

    const changelog = [
      { version: '2.0.0', date: this.generatedAt.toISOString().split('T')[0], type: 'MAJOR', desc: 'Reescritura completa del sistema con arquitectura modular, Dashboard interactivo, Matriz de dependencias, Roadmap de implementación y Documentación técnica integrada.' },
      { version: '1.5.0', date: '2024-12-01', type: 'FEATURE', desc: 'Añadidos 10 agentes especializados pre-configurados para dominios específicos.' },
      { version: '1.4.0', date: '2024-11-15', type: 'FEATURE', desc: 'Integración con MCP (Model Context Protocol) para interoperabilidad.' },
      { version: '1.3.0', date: '2024-11-01', type: 'FEATURE', desc: 'Añadidas herramientas de Browser Agent para automatización web.' },
      { version: '1.2.0', date: '2024-10-15', type: 'FEATURE', desc: 'Sistema de seguridad completo: secrets_manage, encrypt_decrypt, sanitize_input.' },
      { version: '1.1.0', date: '2024-10-01', type: 'FEATURE', desc: 'Herramientas de automatización: schedule_cron, trigger_event, queue_manage.' },
      { version: '1.0.0', date: '2024-09-15', type: 'RELEASE', desc: 'Release inicial con 100 herramientas organizadas en Core, Specialized, Integrations y Automation.' },
    ];

    const typeColors: Record<string, string> = {
      MAJOR: colors.ACCENT_RED,
      FEATURE: colors.ACCENT_GREEN,
      RELEASE: colors.ACCENT_PURPLE,
      FIX: colors.ACCENT_ORANGE,
    };

    changelog.forEach((entry, rowIdx) => {
      const row = 4 + rowIdx;

      const versionCell = ws.getCell(row, 1);
      versionCell.value = entry.version;
      versionCell.font = { name: 'Arial', size: 10, bold: true };
      versionCell.border = this.styles.thinBorder;

      const dateCell = ws.getCell(row, 2);
      dateCell.value = entry.date;
      dateCell.font = this.styles.bodyFont;
      dateCell.border = this.styles.thinBorder;

      const typeCell = ws.getCell(row, 3);
      typeCell.value = entry.type;
      typeCell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: typeColors[entry.type] || colors.GRAY_500 } };
      typeCell.font = { name: 'Arial', size: 9, bold: true, color: { argb: colors.WHITE } };
      typeCell.alignment = { horizontal: 'center' };
      typeCell.border = this.styles.thinBorder;

      const descCell = ws.getCell(row, 4);
      descCell.value = entry.desc;
      descCell.font = this.styles.bodyFont;
      descCell.alignment = { wrapText: true };
      descCell.border = this.styles.thinBorder;
    });

    ws.getColumn(1).width = 12;
    ws.getColumn(2).width = 12;
    ws.getColumn(3).width = 12;
    ws.getColumn(4).width = 80;
  }

  async generate(): Promise<Buffer> {
    this.validateData();
    this.createDashboard();
    this.createDataSheet('🔧 Core Tools', AgentToolsData.getCoreTools(), '🔧');
    this.createDataSheet('🎯 Specialized', AgentToolsData.getSpecializedTools(), '🎯');
    this.createDataSheet('🔌 Integrations', AgentToolsData.getIntegrations(), '🔌');
    this.createDataSheet('🔒 Automation', AgentToolsData.getAutomationSecurity(), '🔒');
    this.createAgentsSheet();
    this.createDependencyMatrix();
    this.createRoadmap();
    this.createDocumentation();
    this.createChangelog();

    const buffer = await this.workbook.xlsx.writeBuffer();
    return Buffer.from(buffer);
  }
}

export async function generateAgentToolsExcel(): Promise<Buffer> {
  const generator = new AgentToolsGenerator();
  return generator.generate();
}
