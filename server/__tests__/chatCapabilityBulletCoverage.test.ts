import { describe, expect, it } from "vitest";

import { matchChatCapabilityRequest } from "../core/chatCapabilityContract";

type CoverageCase = {
  prompt: string;
  capabilityId: string;
};

const coverageCases: CoverageCase[] = [
  { prompt: "crea un xlsx con formulas VLOOKUP para clientes", capabilityId: "artifact.xlsx.professional" },
  { prompt: "arma una hoja con SUMIF y múltiples hojas para presupuesto", capabilityId: "artifact.xlsx.professional" },
  { prompt: "necesito formato condicional y gráficos en excel", capabilityId: "artifact.xlsx.professional" },
  { prompt: "genera un modelo financiero con análisis de escenarios", capabilityId: "artifact.xlsx.professional" },
  { prompt: "haz un tracker de presupuesto con cálculos automáticos", capabilityId: "artifact.xlsx.professional" },
  { prompt: "construye tablas dinámicas para cohortes", capabilityId: "artifact.xlsx.professional" },
  { prompt: "limpieza y transformación de datos en spreadsheet", capabilityId: "artifact.xlsx.professional" },

  { prompt: "crea una presentación desde cero con speaker notes", capabilityId: "artifact.pptx.professional" },
  { prompt: "convierte estas notas de transcripción a slides", capabilityId: "artifact.pptx.professional" },
  { prompt: "necesito layouts con imágenes para una presentación", capabilityId: "artifact.pptx.professional" },
  { prompt: "inserta gifs e imágenes animadas en el powerpoint", capabilityId: "artifact.pptx.professional" },
  { prompt: "aplica watermark en lote a la presentación", capabilityId: "artifact.pptx.professional" },
  { prompt: "que quede editable después con Claude for PowerPoint", capabilityId: "artifact.pptx.professional" },

  { prompt: "redacta un reporte profesional en docx", capabilityId: "artifact.docx.professional" },
  { prompt: "crea una carta en Word con headings", capabilityId: "artifact.docx.professional" },
  { prompt: "genera redlines y sugerencias como un revisor real", capabilityId: "artifact.docx.professional" },
  { prompt: "escribe un documento técnico tipo paper", capabilityId: "artifact.docx.professional" },

  { prompt: "crea un PDF nuevo para comité ejecutivo", capabilityId: "artifact.pdf.professional" },
  { prompt: "haz llenado de formularios PDF", capabilityId: "artifact.pdf.professional" },
  { prompt: "combina y divide pdf según secciones", capabilityId: "artifact.pdf.professional" },
  { prompt: "extrae datos de pdf a otro formato", capabilityId: "artifact.pdf.professional" },

  { prompt: "exporta en markdown y html", capabilityId: "artifact.structured.outputs" },
  { prompt: "devuélvelo como componente react tsx", capabilityId: "artifact.structured.outputs" },
  { prompt: "genera latex para documento matemático", capabilityId: "artifact.structured.outputs" },
  { prompt: "salida csv y tsv", capabilityId: "artifact.structured.outputs" },
  { prompt: "entrega un json estructurado", capabilityId: "artifact.structured.outputs" },
  { prompt: "exporta un chart en png con matplotlib como salida final", capabilityId: "artifact.structured.outputs" },

  { prompt: "gestiona archivos: dame acceso de lectura y escritura a carpetas autorizadas", capabilityId: "files.local.management" },
  { prompt: "haz organización inteligente de carpetas por contenido real", capabilityId: "files.local.management" },
  { prompt: "renombrado masivo con prefijos de fecha YYYY-MM-DD", capabilityId: "files.local.management" },
  { prompt: "clasificación por contenido real del archivo", capabilityId: "files.local.management" },
  { prompt: "deduplicación de archivos y subcarpetas lógicas", capabilityId: "files.local.management" },
  { prompt: "genera log de decisiones de organización", capabilityId: "files.local.management" },
  { prompt: "gestión de archivos con protección contra borrado con permiso explícito", capabilityId: "files.local.management" },

  { prompt: "haz análisis estadístico con detección de outliers", capabilityId: "data.analytics.science" },
  { prompt: "cross-tabulation y series temporales", capabilityId: "data.analytics.science" },
  { prompt: "entrena un modelo predictivo con machine learning", capabilityId: "data.analytics.science" },
  { prompt: "forecasting y modelos financieros", capabilityId: "data.analytics.science" },
  { prompt: "análisis estadístico con visualización de datos y análisis de varianza", capabilityId: "data.analytics.science" },
  { prompt: "análisis de datos: extracción de tablas de PDFs a Excel", capabilityId: "data.analytics.science" },

  { prompt: "investigación: lee múltiples documentos y produce un reporte de síntesis", capabilityId: "research.synthesis.multisource" },
  { prompt: "identifica patrones cruzados entre fuentes", capabilityId: "research.synthesis.multisource" },
  { prompt: "detecta contradicciones entre documentos", capabilityId: "research.synthesis.multisource" },
  { prompt: "cita fuentes específicas", capabilityId: "research.synthesis.multisource" },
  { prompt: "genera resumenes ejecutivos de investigación", capabilityId: "research.synthesis.multisource" },
  { prompt: "haz investigación web integrada con búsqueda", capabilityId: "research.synthesis.multisource" },

  { prompt: "convierte PDF a PowerPoint", capabilityId: "conversion.cross.format" },
  { prompt: "pasa notas de reunión a documento formateado", capabilityId: "conversion.cross.format" },
  { prompt: "conversión: convierte csv a modelo financiero en excel", capabilityId: "conversion.cross.format" },
  { prompt: "convierte word a presentación", capabilityId: "conversion.cross.format" },
  { prompt: "transforma facturas y recibos a spreadsheet", capabilityId: "conversion.cross.format" },
  { prompt: "pasa excel a reporte en word con comentarios", capabilityId: "conversion.cross.format" },

  { prompt: "navegar sitios web y hacer click en elementos", capabilityId: "browser.automation" },
  { prompt: "llenar formularios en paginas web", capabilityId: "browser.automation" },
  { prompt: "tomar screenshots de páginas", capabilityId: "browser.automation" },
  { prompt: "extraer contenido de paginas web", capabilityId: "browser.automation" },
  { prompt: "ejecutar javascript en contexto de pagina", capabilityId: "browser.automation" },
  { prompt: "automatización de navegador para hacer investigación web directa", capabilityId: "browser.automation" },

  { prompt: "abrir aplicaciones en tu escritorio", capabilityId: "desktop.computer.use" },
  { prompt: "navega el navegador desde mi pc", capabilityId: "desktop.computer.use" },
  { prompt: "llena hojas de calculo directamente", capabilityId: "desktop.computer.use" },
  { prompt: "completa formularios web en mi computadora", capabilityId: "desktop.computer.use" },
  { prompt: "haz cualquier accion manual en mi PC", capabilityId: "desktop.computer.use" },

  { prompt: "programa tareas con cadencia diaria", capabilityId: "tasks.scheduled" },
  { prompt: "check de email cada mañana", capabilityId: "tasks.scheduled" },
  { prompt: "métricas semanales recurrentes", capabilityId: "tasks.scheduled" },
  { prompt: "tareas on-demand guardadas para ejecutar luego", capabilityId: "tasks.scheduled" },

  { prompt: "enviar tareas desde iOS al escritorio", capabilityId: "dispatch.mobile.desktop" },
  { prompt: "hilo persistente entre dispositivos con dispatch", capabilityId: "dispatch.mobile.desktop" },
  { prompt: "usa dispatch desde android", capabilityId: "dispatch.mobile.desktop" },

  { prompt: "opera sobre Google Drive y Gmail", capabilityId: "connectors.mcp.operations" },
  { prompt: "conecta Slack, Jira y Asana", capabilityId: "connectors.mcp.operations" },
  { prompt: "usa Notion, GitHub y Linear", capabilityId: "connectors.mcp.operations" },
  { prompt: "integra CRMs y Fellow.ai", capabilityId: "connectors.mcp.operations" },

  { prompt: "marketplace de plugins público y privado", capabilityId: "plugins.customization" },
  { prompt: "plugins por dominio legal y finanzas", capabilityId: "plugins.customization" },
  { prompt: "plugins: skills incorporados para xlsx, pptx, docx y pdf", capabilityId: "plugins.customization" },
  { prompt: "plugin customization con skill-creator para crear tus propios skills", capabilityId: "plugins.customization" },
  { prompt: "instrucciones globales e instrucciones por carpeta", capabilityId: "plugins.customization" },

  { prompt: "python y node en VM aislada", capabilityId: "code.execution.sandbox" },
  { prompt: "ejecuta python y usa pandas y matplotlib", capabilityId: "code.execution.sandbox" },
  { prompt: "ejecuta scripts de automatización", capabilityId: "code.execution.sandbox" },
  { prompt: "todo en sandbox seguro separado del sistema", capabilityId: "code.execution.sandbox" },

  { prompt: "descompone la tarea en subtareas con subagentes", capabilityId: "agents.subagents.parallel" },
  { prompt: "coordina múltiples sub-agentes en paralelo", capabilityId: "agents.subagents.parallel" },
  { prompt: "usa una todo list interna", capabilityId: "agents.subagents.parallel" },
  { prompt: "trabaja por períodos extendidos sin timeout", capabilityId: "agents.subagents.parallel" },

  { prompt: "workspaces persistentes por proyecto", capabilityId: "workspace.project.cowork" },
  { prompt: "workspace con memoria y archivos propios por proyecto", capabilityId: "workspace.project.cowork" },
  { prompt: "ideal para trabajo recurrente de largo plazo en cowork", capabilityId: "workspace.project.cowork" },

  { prompt: "acceso solo a carpetas autorizadas", capabilityId: "security.governance.controls" },
  { prompt: "seguridad y governance con permisos de red configurables", capabilityId: "security.governance.controls" },
  { prompt: "pide aprobación antes de acciones significativas", capabilityId: "security.governance.controls" },
  { prompt: "seguridad y governance con protección contra borrado de archivos y permisos de red", capabilityId: "security.governance.controls" },
  { prompt: "historial almacenado localmente en tu dispositivo", capabilityId: "security.governance.controls" },

  { prompt: "enterprise role-based access controls", capabilityId: "enterprise.controls.analytics" },
  { prompt: "límites de gasto por grupo", capabilityId: "enterprise.controls.analytics" },
  { prompt: "analytics de uso y API de analytics", capabilityId: "enterprise.controls.analytics" },
  { prompt: "OpenTelemetry para observabilidad y SIEM", capabilityId: "enterprise.controls.analytics" },
  { prompt: "control granular por conector y marketplace privado", capabilityId: "enterprise.controls.analytics" },
  { prompt: "toggle on/off por equipo o departamento", capabilityId: "enterprise.controls.analytics" },

  { prompt: "revisión de contratos y triage de NDAs", capabilityId: "domainpacks.functional" },
  { prompt: "asientos contables y conciliación", capabilityId: "domainpacks.functional" },
  { prompt: "análisis de voz de marca", capabilityId: "domainpacks.functional" },
  { prompt: "briefings diarios y tracking de proyectos", capabilityId: "domainpacks.functional" },
  { prompt: "reviews de desempeño y workflows de competencias", capabilityId: "domainpacks.functional" },
  { prompt: "caso de uso de investigación: síntesis de entrevistas y feedback multicanal", capabilityId: "domainpacks.functional" },

  { prompt: "macOS y Windows disponibles", capabilityId: "availability.platforms" },
  { prompt: "incluido en planes Pro, Max, Team y Enterprise", capabilityId: "availability.platforms" },
  { prompt: "se accede desde Claude Desktop junto a Chat y Code", capabilityId: "availability.platforms" },
  { prompt: "disponibilidad: tareas desde móvil via Dispatch iOS Android", capabilityId: "availability.platforms" },
  { prompt: "disponibilidad y límites: archivos máximo 30MB y guardado directo a Google Drive o descarga", capabilityId: "availability.platforms" },
];

describe("chat capability bullet coverage", () => {
  it.each(coverageCases)("routes bullet-level prompt: $prompt", ({ prompt, capabilityId }) => {
    const match = matchChatCapabilityRequest(prompt);

    expect(match).not.toBeNull();
    expect(match?.capability.capabilityId).toBe(capabilityId);
    expect(match?.capability.multiLlm).toBe(true);
  });
});
