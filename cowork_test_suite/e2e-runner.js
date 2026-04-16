/* eslint-disable no-console */
/**
 * IliaGPT E2E Capability Runner
 * ==============================
 * Drop-in browser-console script that drives 12 prompts × 18 capabilities
 * (216 tests) against https://iliagpt.io using the real /api/chats + SSE
 * stream endpoints.
 *
 * Usage:
 *   1. Log in at https://iliagpt.io
 *   2. Open DevTools → Console
 *   3. Paste the entire contents of this file, then call:
 *        await __iliatests__.runAll()          // all 216 tests
 *        await __iliatests__.runCategory(1)    // just capability 1
 *        __iliatests__.summary()               // aggregated results
 *        copy(JSON.stringify(__iliatests__.results, null, 2))
 *
 * Notes:
 *   - Reads the CSRF token from GET /api/csrf/token (body), the cookie is
 *     HttpOnly so we never touch it directly.
 *   - Does NOT require any fix to be deployed to *issue* prompts, but
 *     categories 4/5 (multi-doc synthesis / format conversion) will only
 *     pass once the f5949c1c docs-reading fix is in production.
 *   - Hard cap: 90 s per prompt, 35 min total per runAll().
 */
(() => {
  if (typeof window === "undefined") return;
  const BASE = location.origin;
  const TIMEOUT_MS = 90_000;
  const PROMPT_GAP_MS = 1500; // breathe between prompts to avoid rate limiter

  /** 18 capability categories, each with 12 complex prompts. */
  const CATEGORIES = [
    {
      id: 1,
      name: "File generation",
      prompts: [
        "Genera un xlsx con 3 hojas: Ventas (10 filas con columnas fecha, producto, cantidad, precio, total), Resumen (SUM por producto con fórmulas), Gráfico (referencia a Resumen).",
        "Crea un docx profesional de 2 páginas con portada, tabla de contenidos, 3 secciones con H1/H2, una tabla 4×4 y footer con número de página.",
        "Genera un pptx de 8 diapositivas sobre 'Arquitectura de microservicios': título, agenda, 5 conceptos con bullets y cierre.",
        "Crea un PDF de 3 páginas con logo en cabecera, tabla de pricing de 5 filas y firma digital simulada al final.",
        "Produce un archivo Markdown de 400+ palabras sobre 'Algoritmos de consenso distribuido' con headings, código y tabla comparativa.",
        "Genera un HTML standalone con CSS embebido que renderice un dashboard con 3 cards de métricas y un gráfico SVG.",
        "Crea un componente React de TypeScript con hooks (useState, useEffect) que muestre una lista paginada con filtro.",
        "Escribe un documento LaTeX con sección de abstract, 2 secciones con ecuaciones inline y display, y bibliografía.",
        "Genera un CSV de 50 filas con datos sintéticos coherentes (nombre, edad, email, país, fecha_registro).",
        "Produce un JSON válido que modele una orden de compra con 3 items, impuestos calculados y totales.",
        "Genera un diagrama PNG simple con matplotlib que muestre una línea temporal de 12 puntos.",
        "Crea un script Python de 30+ líneas que lea un CSV, calcule estadísticas descriptivas y exporte a xlsx."
      ]
    },
    {
      id: 2,
      name: "File management",
      prompts: [
        "Lista los últimos 10 archivos que he subido a mi workspace ordenados por fecha descendente.",
        "Renombra el último docx que subí a 'reporte_final.docx'.",
        "Duplica el último xlsx y añade '_backup' al nombre.",
        "Comprime los 3 archivos más recientes en un zip llamado 'bundle.zip'.",
        "Muestra el tamaño en bytes y mime type de cada archivo subido en las últimas 24 horas.",
        "Agrupa mis archivos por extensión y cuéntame cuántos hay de cada tipo.",
        "Busca entre mis archivos los que contengan 'factura' en el nombre.",
        "Elimina los archivos temporales más antiguos de 30 días (confirma antes).",
        "Muestra el historial de versiones del último docx que edité.",
        "Convierte mi último pptx a pdf y guárdalo con el sufijo '_converted'.",
        "Etiqueta los últimos 5 archivos con la categoría 'proyecto_alpha'.",
        "Genera un índice Markdown con enlaces a mis últimos 20 archivos."
      ]
    },
    {
      id: 3,
      name: "Data science",
      prompts: [
        "Genera 200 filas sintéticas de ventas (fecha, producto, región, cantidad, precio) y calcula el revenue total por región.",
        "Crea un dataset de 100 filas con features numéricas y categóricas, y dame las estadísticas descriptivas (mean, std, min, max, cuartiles).",
        "Simula una serie temporal de 36 meses con tendencia y estacionalidad y calcula la descomposición.",
        "Genera 500 puntos en 2D con 3 clusters y aplica k-means explicando los centroides.",
        "Calcula la correlación de Pearson entre 4 variables de un dataset sintético de 150 filas.",
        "Haz un forecast de 6 meses usando exponential smoothing sobre una serie sintética de 24 puntos.",
        "Genera un histograma de 1000 muestras de una distribución normal(µ=100, σ=15) y calcula skew/kurtosis.",
        "Simula una A/B test con tamaño n=500 por grupo y reporta el p-valor bajo H0: proporciones iguales.",
        "Crea una matriz de confusión sintética para un clasificador binario y calcula precision, recall, F1.",
        "Genera un dataset con outliers, detectalos usando IQR y reporta cuántos hay por columna.",
        "Ejecuta PCA sobre 5 features sintéticas de 300 filas y reporta varianza explicada por componente.",
        "Calcula RMSE, MAE y R² de un modelo lineal simple sobre datos sintéticos."
      ]
    },
    {
      id: 4,
      name: "Multi-doc synthesis (requires fix deployed)",
      prompts: [
        "He subido 3 docx con reportes de Q1, Q2, Q3. Hazme un resumen ejecutivo consolidado.",
        "Compara los 2 pdfs que acabo de subir y lista las diferencias clave en una tabla.",
        "A partir de los 5 archivos en mi workspace extrae los 10 insights más importantes.",
        "Genera una línea temporal cronológica combinando los eventos mencionados en los 3 archivos subidos.",
        "Crea un mapa conceptual (en Mermaid) que relacione los temas tratados en los documentos.",
        "Extrae todas las cifras y estadísticas de los pdfs subidos y ponlas en una tabla con fuente.",
        "Identifica contradicciones entre los 2 reportes subidos y señala cuál documento dice qué.",
        "Haz un resumen en formato bullet points (máximo 15) de los últimos 4 archivos que subí.",
        "Categoriza los documentos subidos por tema principal y dime cuántos hay en cada categoría.",
        "Extrae nombres de personas, empresas y lugares mencionados en los pdfs y agrúpalos.",
        "Haz un diff semántico entre las versiones v1 y v2 del mismo documento que subí.",
        "Genera un índice temático unificado de los 5 últimos archivos subidos."
      ]
    },
    {
      id: 5,
      name: "Format conversion (requires fix deployed)",
      prompts: [
        "Convierte el último docx que subí a PDF manteniendo el formato.",
        "Toma el csv subido y conviértelo a xlsx con una hoja de resumen.",
        "Convierte mi último pptx a markdown con las diapositivas como headings.",
        "Extrae el texto del pdf subido y guárdalo como txt plano.",
        "Convierte el xlsx subido a un JSON estructurado por hoja.",
        "Toma el json de mi workspace y genera una tabla HTML equivalente.",
        "Convierte el markdown subido a un docx con estilos aplicados.",
        "Toma el csv y genera un pdf con una tabla paginada.",
        "Convierte el html subido a un PDF imprimible.",
        "Extrae las tablas del pdf subido y guárdalas como xlsx separadas por pestaña.",
        "Convierte el último docx a HTML responsive.",
        "Toma el xml subido y conviértelo a un yaml equivalente."
      ]
    },
    {
      id: 6,
      name: "Browser automation",
      prompts: [
        "Abre https://news.ycombinator.com y dame los 5 titulares principales.",
        "Busca en Google 'AI agents 2026' y reporta el primer resultado relevante.",
        "Visita wikipedia.org y extrae la definición actual de 'large language model'.",
        "Entra en https://www.python.org/dev/peps/ y cuéntame cuántos PEPs hay activos.",
        "Abre https://arxiv.org/list/cs.AI/new y lista los 3 primeros papers de hoy.",
        "Visita https://github.com/trending?language=typescript y dame los 5 repos top.",
        "Busca en DuckDuckGo 'best cross-platform desktop framework' y resume los 3 primeros hits.",
        "Entra en https://html.duckduckgo.com y busca 'TypeScript 5.7 release notes'.",
        "Abre https://cve.mitre.org/find/ y busca 'Node.js 22'.",
        "Visita https://caniuse.com y reporta el soporte actual de View Transitions API.",
        "Entra en https://status.github.com y reporta el estado actual de los servicios.",
        "Busca en arxiv 'diffusion policy robotics' y dame los 3 papers más citados."
      ]
    },
    {
      id: 7,
      name: "Computer use / Desktop",
      prompts: [
        "¿Puedes tomar una captura de mi pantalla actual?",
        "Abre la calculadora del sistema y dime el resultado de 1234*5678.",
        "Abre mi bloc de notas y escribe 'hola desde IliaGPT'.",
        "Toma una captura, márcala con un círculo rojo y guárdala como png.",
        "Abre el navegador del sistema en https://iliagpt.io.",
        "Muestra las ventanas abiertas actualmente en mi escritorio.",
        "Simula pulsar Ctrl+C en la ventana activa.",
        "Lista los iconos visibles en mi barra de tareas.",
        "Captura solo la región 0,0 a 800,600 de mi pantalla.",
        "Abre el explorador de archivos en mi carpeta de descargas.",
        "Lee el texto visible en la ventana actualmente enfocada.",
        "Mueve el ratón a la coordenada 500,500 y haz clic izquierdo."
      ]
    },
    {
      id: 8,
      name: "Scheduled tasks",
      prompts: [
        "Crea una tarea diaria a las 9:00 AM que me dé un resumen de las noticias de tech.",
        "Programa una tarea semanal los lunes a las 8:30 que me envíe los PRs pendientes de review.",
        "Crea una tarea única para mañana a las 15:00 que me recuerde llamar a un cliente.",
        "Lista todas mis tareas programadas actuales.",
        "Desactiva temporalmente la tarea 'daily_news'.",
        "Modifica la tarea 'weekly_standup' para que corra los martes en vez de los lunes.",
        "Crea una tarea cada hora que monitoree el estado de mi servidor.",
        "Programa una tarea mensual el día 1 a las 00:00 para archivar logs viejos.",
        "Crea una tarea ad-hoc (sin schedule) llamada 'deep_research' que solo se ejecute bajo demanda.",
        "Elimina todas mis tareas deshabilitadas de más de 30 días.",
        "Dame el historial de ejecuciones de la tarea 'daily_news' en las últimas 2 semanas.",
        "Crea una tarea que se ejecute cada 15 minutos entre las 9 y las 18 en días laborables."
      ]
    },
    {
      id: 9,
      name: "Dispatch / Subagents",
      prompts: [
        "Lanza un subagente que investigue en paralelo 3 fuentes sobre 'quantum computing 2026'.",
        "Despacha un agente coder que genere una API REST de usuarios en Node/Express con tests.",
        "Usa el agente browser para verificar si https://anthropic.com está online.",
        "Lanza 2 subagentes en paralelo: uno que genere un xlsx y otro un pdf, y consolida.",
        "Despacha un deep-research agent con 5 queries sobre 'post-quantum cryptography'.",
        "Usa un subagente para leer los 3 pdfs que subí y extraer insights, en paralelo.",
        "Lanza un planner agent que descomponga 'migrar de Postgres 14 a 17' en 10 pasos.",
        "Despacha un agente con Plan Mode: primero planifica, luego ejecuta con mi aprobación.",
        "Usa un verification agent para fact-checkear 5 afirmaciones sobre IA.",
        "Despacha 3 research agents con subtemas diferentes y consolida en un único reporte.",
        "Lanza un code-review agent sobre el último archivo .py que subí.",
        "Usa un critic agent para evaluar un ensayo que te paso de 500 palabras."
      ]
    },
    {
      id: 10,
      name: "MCP connectors",
      prompts: [
        "Lista los conectores MCP disponibles actualmente en mi cuenta.",
        "Si tengo Slack conectado, muéstrame mis 5 mensajes directos más recientes.",
        "Si tengo Google Drive conectado, lista mis 10 archivos modificados hoy.",
        "Si tengo Jira conectado, muéstrame los tickets asignados a mí.",
        "Si tengo Asana conectado, lista mis tareas pendientes.",
        "Si tengo GitHub conectado, muéstrame mis PRs abiertos.",
        "Si tengo Notion conectado, busca páginas que mencionen 'roadmap'.",
        "Si tengo Gmail conectado, dame un resumen de los emails no leídos.",
        "Si tengo Linear conectado, lista mis issues en 'In Progress'.",
        "Si tengo Google Calendar conectado, muéstrame mis reuniones de hoy.",
        "Si tengo Salesforce conectado, dame el top 10 de mi pipeline.",
        "Sugiéreme qué conectores puedo instalar para un flujo de 'weekly standup'."
      ]
    },
    {
      id: 11,
      name: "Plugins",
      prompts: [
        "Lista los plugins instalados actualmente.",
        "Sugiéreme un plugin útil para un data scientist.",
        "Sugiéreme un plugin útil para un PM.",
        "Busca plugins relacionados con 'legal'.",
        "Busca plugins relacionados con 'sales'.",
        "Instala el plugin Cowork por defecto si no está instalado.",
        "Muestra los comandos disponibles del plugin actualmente activo.",
        "Ejecuta el comando /help del plugin activo.",
        "Desinstala el plugin de prueba si existe.",
        "Actualiza todos mis plugins a la última versión.",
        "Muéstrame los plugins que tengo marcados como favoritos.",
        "Exporta mi configuración de plugins a un archivo JSON."
      ]
    },
    {
      id: 12,
      name: "Code execution",
      prompts: [
        "Ejecuta este Python: `print(sum(range(1, 101)))` y dame el resultado.",
        "Corre un script que calcule los primeros 20 números primos.",
        "Ejecuta JavaScript que haga fetch a https://api.github.com/zen y muestra el resultado.",
        "Simula Conway's Game of Life durante 10 generaciones en un grid 20x20.",
        "Ejecuta un script que lea el csv que acabo de subir y haga describe().",
        "Corre un script que genere una imagen matplotlib con una parábola y guárdala.",
        "Ejecuta un script bash que liste los archivos en mi workspace ordenados por tamaño.",
        "Corre un test pytest simple con 3 assertions y muéstrame el output.",
        "Ejecuta SQL sobre un sqlite in-memory: crea tabla users, inserta 5, haz SELECT.",
        "Corre un benchmark simple que mida cuánto tarda Python en ordenar 10^6 enteros.",
        "Ejecuta un script que calcule el hash SHA-256 del último archivo subido.",
        "Corre un script que convierta el csv subido a parquet."
      ]
    },
    {
      id: 13,
      name: "Projects / Workspace",
      prompts: [
        "Crea un proyecto nuevo llamado 'Proyecto Alpha'.",
        "Lista todos mis proyectos actuales.",
        "Añade el último archivo subido al 'Proyecto Alpha'.",
        "Muestra el contexto compartido del 'Proyecto Alpha'.",
        "Exporta el 'Proyecto Alpha' completo a un zip.",
        "Invita a un colaborador al proyecto por email (simulado, no envíes).",
        "Archiva el proyecto 'legacy_2024' si existe.",
        "Cambia el nombre del proyecto 'Proyecto Alpha' a 'Alpha v2'.",
        "Muéstrame el historial de cambios del proyecto actual.",
        "Define las instrucciones personalizadas del proyecto con un prompt del sistema.",
        "Busca en todos mis proyectos chats que mencionen 'roadmap'.",
        "Duplica el proyecto actual como plantilla."
      ]
    },
    {
      id: 14,
      name: "Security / Governance",
      prompts: [
        "Muéstrame qué datos personales tienes guardados sobre mí.",
        "Quiero eliminar todas mis memorias de largo plazo, ¿cómo lo hago?",
        "Lista las API keys que he creado y cuándo se usaron por última vez.",
        "Revoca todas mis API keys activas.",
        "Exporta todos mis datos a un zip (GDPR data export).",
        "Muéstrame el log de auditoría de mis últimas 20 acciones sensibles.",
        "Configura la retención de logs a 30 días.",
        "Habilita 2FA en mi cuenta (explica el flujo).",
        "Muestra qué integraciones tienen acceso a mis datos ahora mismo.",
        "Revoca el acceso OAuth de la aplicación 'test_app' si existe.",
        "Dame el resumen de la política de privacidad de IliaGPT.",
        "Muestra las acciones que requieren confirmación explícita en mi cuenta."
      ]
    },
    {
      id: 15,
      name: "Enterprise",
      prompts: [
        "¿Cuál es mi plan actual y qué incluye?",
        "Muéstrame el consumo de tokens de esta semana por modelo.",
        "Dame el reporte de uso de la organización en el último mes.",
        "Lista los miembros del equipo actual y sus roles.",
        "Muestra los límites de rate limit de mi tier.",
        "Dame el SLA de uptime actual de IliaGPT.",
        "¿Puedo tener un deployment self-hosted? Explica opciones enterprise.",
        "Muestra las integraciones SSO disponibles (Okta, Azure AD, Google Workspace).",
        "Dame el changelog de IliaGPT de las últimas 2 semanas.",
        "¿Cómo configuro single-sign-on para mi organización?",
        "Muestra el estado de los jobs en background de la plataforma.",
        "¿Qué regiones de despliegue soporta IliaGPT?"
      ]
    },
    {
      id: 16,
      name: "Domain use cases",
      prompts: [
        "Actúa como analista legal: resume en 5 bullets la Ley de IA de la UE (AI Act).",
        "Actúa como PM técnico: escribe el PRD de un feature 'dark mode' en 400 palabras.",
        "Actúa como SDR: redacta un email de cold outreach para un CTO de fintech.",
        "Actúa como data analyst: interpreta la correlación 0.72 entre variables X e Y.",
        "Actúa como devops: dame el Dockerfile de un servicio Node.js 22 con pnpm.",
        "Actúa como recruiter técnico: genera 10 preguntas de system design para un senior SWE.",
        "Actúa como UX writer: rediseña este microcopy '404 Not Found' en 3 variantes.",
        "Actúa como abogado laboralista: explica los 3 puntos clave del despido procedente en España.",
        "Actúa como profesor de mates: explica el teorema de Bayes con un ejemplo real.",
        "Actúa como consultor de marketing: escribe un plan de 90 días para un SaaS B2B early-stage.",
        "Actúa como doctor: explica los síntomas típicos de la apnea del sueño (no diagnóstico).",
        "Actúa como chef profesional: dame 3 recetas mediterráneas con <30 min de prep."
      ]
    },
    {
      id: 17,
      name: "Synthesis / Validation",
      prompts: [
        "Fact-check esta afirmación: 'La Gran Muralla China es visible desde el espacio'. Cita fuentes.",
        "Verifica si 'GPT-4 fue lanzado en marzo de 2023' es correcto con fuentes.",
        "Dame pros y contras de usar Rust vs Go para microservicios, con 3 puntos cada uno.",
        "Resume en 100 palabras las 3 principales críticas al modelo Transformer.",
        "Compara las licencias MIT, Apache 2.0 y GPL v3 en una tabla.",
        "Desmiente o confirma: 'El carbono es el segundo elemento más abundante en el cuerpo humano'.",
        "Valida si 'Python es siempre más lento que Java' es una afirmación precisa y matiza.",
        "Dame un análisis balanceado de los argumentos a favor y contra UBI (renta básica universal).",
        "Resume en 5 líneas el paper 'Attention is All You Need' sin inventar detalles.",
        "Verifica los números de revenue de OpenAI para 2024 con fuentes públicas.",
        "Compara las arquitecturas x86 y ARM en eficiencia energética, rendimiento y ecosistema.",
        "Sintetiza los 5 conceptos más importantes del libro 'Thinking Fast and Slow' en 200 palabras."
      ]
    },
    {
      id: 18,
      name: "Availability",
      prompts: [
        "Confirma que puedes responder a consultas en tiempo real.",
        "¿Cuál es tu latencia actual p50 y p95 aproximada?",
        "¿Qué modelos LLM tengo disponibles en este momento?",
        "Muéstrame el estado de los proveedores LLM (OpenAI, Anthropic, Gemini, xAI).",
        "¿Cuántas requests puedo hacer por minuto en mi tier?",
        "¿Estás caído en alguna región ahora mismo?",
        "Dame el uptime de las últimas 24h del servicio.",
        "¿Qué pasa si mi proveedor principal cae? Explica el fallback.",
        "¿Cuánto es el tiempo de streaming típico para una respuesta de 500 tokens?",
        "Confirma que puedes usar el modelo más reciente disponible en mi cuenta.",
        "Dame el hash del build actual de IliaGPT si es posible.",
        "¿Soportas WebSocket además de SSE?"
      ]
    }
  ];

  // ---------- state ----------
  const state = {
    csrfToken: null,
    results: [],
    running: false,
  };

  async function getCsrfToken() {
    if (state.csrfToken) return state.csrfToken;
    const r = await fetch(`${BASE}/api/csrf/token`, { credentials: "include" });
    if (!r.ok) throw new Error(`csrf fetch ${r.status}`);
    const body = await r.json();
    if (!body?.csrfToken) throw new Error("no csrfToken in /api/csrf/token body");
    state.csrfToken = body.csrfToken;
    return state.csrfToken;
  }

  async function createChat() {
    const token = await getCsrfToken();
    const r = await fetch(`${BASE}/api/chats`, {
      method: "POST",
      credentials: "include",
      headers: {
        "Content-Type": "application/json",
        "x-csrf-token": token,
      },
      body: JSON.stringify({ title: "E2E capability run" }),
    });
    if (!r.ok) throw new Error(`createChat ${r.status}: ${await r.text()}`);
    const body = await r.json();
    return body?.id || body?.chat?.id || body?.data?.id;
  }

  async function sendPrompt(chatId, prompt) {
    const token = await getCsrfToken();
    const start = Date.now();
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
    try {
      const r = await fetch(`${BASE}/api/chats/${chatId}/messages/stream`, {
        method: "POST",
        credentials: "include",
        headers: {
          "Content-Type": "application/json",
          "x-csrf-token": token,
          Accept: "text/event-stream",
        },
        body: JSON.stringify({ content: prompt, role: "user" }),
        signal: ctrl.signal,
      });
      if (!r.ok || !r.body) {
        return { ok: false, status: r.status, elapsedMs: Date.now() - start };
      }
      const reader = r.body.getReader();
      const decoder = new TextDecoder();
      let buf = "";
      let text = "";
      let sawError = null;
      let sawDone = false;
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        buf += decoder.decode(value, { stream: true });
        const frames = buf.split("\n\n");
        buf = frames.pop() ?? "";
        for (const frame of frames) {
          const lines = frame.split("\n");
          let ev = "message";
          let data = "";
          for (const ln of lines) {
            if (ln.startsWith("event:")) ev = ln.slice(6).trim();
            else if (ln.startsWith("data:")) data += ln.slice(5).trim();
          }
          if (!data) continue;
          try {
            const parsed = JSON.parse(data);
            if (ev === "delta" || ev === "message" || ev === "content") {
              if (typeof parsed.text === "string") text += parsed.text;
              else if (typeof parsed.content === "string") text += parsed.content;
              else if (typeof parsed.delta === "string") text += parsed.delta;
            } else if (ev === "error" || ev === "production_error") {
              sawError = parsed;
            } else if (ev === "done" || ev === "end" || ev === "stop") {
              sawDone = true;
            }
          } catch {
            if (ev === "delta") text += data;
          }
        }
      }
      return {
        ok: sawError == null && (sawDone || text.length > 0),
        status: 200,
        elapsedMs: Date.now() - start,
        chars: text.length,
        error: sawError,
        preview: text.slice(0, 240),
      };
    } catch (e) {
      return { ok: false, status: 0, elapsedMs: Date.now() - start, error: String(e) };
    } finally {
      clearTimeout(timer);
    }
  }

  async function runCategory(id) {
    const cat = CATEGORIES.find((c) => c.id === id);
    if (!cat) throw new Error(`unknown category ${id}`);
    console.log(`\n▶ Capability ${cat.id} — ${cat.name}`);
    const chatId = await createChat();
    const catResults = [];
    for (let i = 0; i < cat.prompts.length; i++) {
      const p = cat.prompts[i];
      const r = await sendPrompt(chatId, p);
      catResults.push({ idx: i + 1, prompt: p.slice(0, 80), ...r });
      const mark = r.ok ? "✔" : "✘";
      console.log(`  ${mark} ${i + 1}/${cat.prompts.length} ${r.elapsedMs}ms ${r.chars || 0}ch`);
      await new Promise((res) => setTimeout(res, PROMPT_GAP_MS));
    }
    const passed = catResults.filter((x) => x.ok).length;
    const entry = {
      category: cat.id,
      name: cat.name,
      passed,
      total: cat.prompts.length,
      pct: Math.round((passed / cat.prompts.length) * 100),
      chatId,
      results: catResults,
    };
    state.results.push(entry);
    console.log(`  → ${passed}/${cat.prompts.length} passed (${entry.pct}%)`);
    return entry;
  }

  async function runAll() {
    if (state.running) throw new Error("already running");
    state.running = true;
    state.results = [];
    const t0 = Date.now();
    try {
      for (const cat of CATEGORIES) {
        await runCategory(cat.id);
      }
    } finally {
      state.running = false;
    }
    const elapsed = ((Date.now() - t0) / 1000).toFixed(1);
    console.log(`\n══════ runAll finished in ${elapsed}s ══════`);
    return summary();
  }

  function summary() {
    const rows = state.results.map((r) => ({
      cap: r.category,
      name: r.name,
      passed: `${r.passed}/${r.total}`,
      pct: `${r.pct}%`,
    }));
    console.table(rows);
    const totalPassed = state.results.reduce((s, r) => s + r.passed, 0);
    const totalRun = state.results.reduce((s, r) => s + r.total, 0);
    console.log(`TOTAL: ${totalPassed}/${totalRun} (${Math.round((totalPassed / Math.max(totalRun, 1)) * 100)}%)`);
    return { totalPassed, totalRun, rows };
  }

  window.__iliatests__ = {
    categories: CATEGORIES,
    state,
    get results() {
      return state.results;
    },
    getCsrfToken,
    createChat,
    sendPrompt,
    runCategory,
    runAll,
    summary,
  };
  console.log("✅ __iliatests__ cargado. Uso:");
  console.log("   await __iliatests__.runAll()        // los 216 tests");
  console.log("   await __iliatests__.runCategory(1)  // solo capacidad 1");
  console.log("   __iliatests__.summary()             // tabla consolidada");
})();
