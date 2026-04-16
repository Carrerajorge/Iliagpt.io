import { describe, expect, it } from "vitest";

import { matchChatCapabilityRequest } from "../core/chatCapabilityContract";

type CapabilityExpectation = {
  prompt: string;
  capabilityId: string;
  domainId: string;
  workflow: string;
  handler: string;
  renderSurface: string;
  requiresApproval: boolean;
  status: "integrated" | "partial" | "gap";
};

const capabilityCases: CapabilityExpectation[] = [
  {
    prompt: "crea un dashboard de ventas en Excel con formulas SUMIF y VLOOKUP",
    capabilityId: "artifact.xlsx.professional",
    domainId: "artifact_generation",
    workflow: "artifact_generation",
    handler: "production_handler",
    renderSurface: "artifact_card",
    requiresApproval: false,
    status: "integrated",
  },
  {
    prompt: "genera una presentación PowerPoint para directorio con speaker notes",
    capabilityId: "artifact.pptx.professional",
    domainId: "artifact_generation",
    workflow: "artifact_generation",
    handler: "production_handler",
    renderSurface: "artifact_card",
    requiresApproval: false,
    status: "integrated",
  },
  {
    prompt: "redacta un memo en Word con headings y tablas formateadas",
    capabilityId: "artifact.docx.professional",
    domainId: "artifact_generation",
    workflow: "artifact_generation",
    handler: "production_handler",
    renderSurface: "artifact_card",
    requiresApproval: false,
    status: "integrated",
  },
  {
    prompt: "combina PDF y entrega un reporte PDF ejecutivo final",
    capabilityId: "artifact.pdf.professional",
    domainId: "artifact_generation",
    workflow: "artifact_generation",
    handler: "production_handler",
    renderSurface: "artifact_card",
    requiresApproval: false,
    status: "integrated",
  },
  {
    prompt: "exporta el resultado en markdown, html, json y un archivo .py",
    capabilityId: "artifact.structured.outputs",
    domainId: "artifact_generation",
    workflow: "artifact_generation",
    handler: "production_handler",
    renderSurface: "artifact_card",
    requiresApproval: false,
    status: "partial",
  },
  {
    prompt: "organiza mi carpeta, renombra archivos y crea subcarpetas con log de decisiones",
    capabilityId: "files.local.management",
    domainId: "local_file_management",
    workflow: "agent_execution",
    handler: "skill_auto_dispatcher",
    renderSurface: "agent_steps",
    requiresApproval: true,
    status: "partial",
  },
  {
    prompt: "detecta outliers, haz forecasting y visualizacion de datos del dataset",
    capabilityId: "data.analytics.science",
    domainId: "data_science",
    workflow: "agent_execution",
    handler: "skill_auto_dispatcher",
    renderSurface: "agent_steps",
    requiresApproval: false,
    status: "partial",
  },
  {
    prompt: "haz una síntesis con contradicciones entre documentos y cita fuentes",
    capabilityId: "research.synthesis.multisource",
    domainId: "synthesis_research",
    workflow: "agent_execution",
    handler: "skill_auto_dispatcher",
    renderSurface: "agent_steps",
    requiresApproval: false,
    status: "partial",
  },
  {
    prompt: "convierte un CSV a Excel y luego un Word a presentación",
    capabilityId: "conversion.cross.format",
    domainId: "format_conversion",
    workflow: "agent_execution",
    handler: "skill_auto_dispatcher",
    renderSurface: "agent_steps",
    requiresApproval: false,
    status: "partial",
  },
  {
    prompt: "navega un sitio, haz click, llena formulario y extrae contenido de la pagina",
    capabilityId: "browser.automation",
    domainId: "browser_automation",
    workflow: "agent_execution",
    handler: "skill_auto_dispatcher",
    renderSurface: "agent_steps",
    requiresApproval: true,
    status: "partial",
  },
  {
    prompt: "abre Excel en mi computadora y completa formularios web en mi pc",
    capabilityId: "desktop.computer.use",
    domainId: "computer_use",
    workflow: "agent_execution",
    handler: "skill_auto_dispatcher",
    renderSurface: "agent_steps",
    requiresApproval: true,
    status: "gap",
  },
  {
    prompt: "programa una tarea cada mañana y un digest semanal",
    capabilityId: "tasks.scheduled",
    domainId: "scheduled_tasks",
    workflow: "skill_dispatch",
    handler: "skill_auto_dispatcher",
    renderSurface: "agent_steps",
    requiresApproval: false,
    status: "partial",
  },
  {
    prompt: "desde el celular usa dispatch para ejecutar en tu computadora de escritorio",
    capabilityId: "dispatch.mobile.desktop",
    domainId: "dispatch",
    workflow: "conversation",
    handler: "model_stream",
    renderSurface: "conversation_stream",
    requiresApproval: false,
    status: "gap",
  },
  {
    prompt: "busca en Google Drive, Gmail, Slack, Notion y GitHub",
    capabilityId: "connectors.mcp.operations",
    domainId: "connectors",
    workflow: "skill_dispatch",
    handler: "skill_auto_dispatcher",
    renderSurface: "agent_steps",
    requiresApproval: true,
    status: "partial",
  },
  {
    prompt: "crea un skill, configura instrucciones globales y actualiza instrucciones de carpeta",
    capabilityId: "plugins.customization",
    domainId: "plugins_customization",
    workflow: "skill_dispatch",
    handler: "skill_auto_dispatcher",
    renderSurface: "agent_steps",
    requiresApproval: false,
    status: "partial",
  },
  {
    prompt: "ejecuta python con pandas y matplotlib en sandbox seguro",
    capabilityId: "code.execution.sandbox",
    domainId: "code_execution",
    workflow: "skill_dispatch",
    handler: "skill_auto_dispatcher",
    renderSurface: "agent_steps",
    requiresApproval: true,
    status: "partial",
  },
  {
    prompt: "divide esto en sub-agentes y trabaja en paralelo con una todo list interna",
    capabilityId: "agents.subagents.parallel",
    domainId: "subagents",
    workflow: "agent_execution",
    handler: "skill_auto_dispatcher",
    renderSurface: "agent_steps",
    requiresApproval: false,
    status: "partial",
  },
  {
    prompt: "crea un workspace persistente con memoria propia por proyecto",
    capabilityId: "workspace.project.cowork",
    domainId: "project_workspaces",
    workflow: "skill_dispatch",
    handler: "skill_auto_dispatcher",
    renderSurface: "agent_steps",
    requiresApproval: false,
    status: "partial",
  },
  {
    prompt: "explica permisos de red, egress, protección contra borrado e historial local",
    capabilityId: "security.governance.controls",
    domainId: "security_governance",
    workflow: "conversation",
    handler: "model_stream",
    renderSurface: "conversation_stream",
    requiresApproval: false,
    status: "partial",
  },
  {
    prompt: "configura RBAC, analytics de uso, OpenTelemetry y toggles por equipo",
    capabilityId: "enterprise.controls.analytics",
    domainId: "enterprise",
    workflow: "conversation",
    handler: "model_stream",
    renderSurface: "conversation_stream",
    requiresApproval: false,
    status: "partial",
  },
  {
    prompt: "haz revisión de contratos, triage de NDAs y conciliación financiera",
    capabilityId: "domainpacks.functional",
    domainId: "domain_packs",
    workflow: "skill_dispatch",
    handler: "skill_auto_dispatcher",
    renderSurface: "agent_steps",
    requiresApproval: false,
    status: "partial",
  },
  {
    prompt: "está disponible en macOS, Windows, Team y Enterprise con límite de 30MB",
    capabilityId: "availability.platforms",
    domainId: "availability",
    workflow: "conversation",
    handler: "model_stream",
    renderSurface: "conversation_stream",
    requiresApproval: false,
    status: "partial",
  },
];

describe("chat capability matcher", () => {
  it.each(capabilityCases)(
    "matches capability contract for: $capabilityId",
    ({ prompt, capabilityId, domainId, workflow, handler, renderSurface, requiresApproval, status }) => {
      const match = matchChatCapabilityRequest(prompt);

      expect(match).not.toBeNull();
      expect(match?.capability).toMatchObject({
        capabilityId,
        domainId,
        workflow,
        handler,
        renderSurface,
        requiresApproval,
        status,
        multiLlm: true,
      });
      expect(match?.score).toBeGreaterThan(0);
    },
  );

  it("handles accent-insensitive matching for spanish prompts", () => {
    const withAccents = matchChatCapabilityRequest(
      "haz una síntesis y un resumen ejecutivo con investigación web",
    );
    const withoutAccents = matchChatCapabilityRequest(
      "haz una sintesis y un resumen ejecutivo con investigacion web",
    );

    expect(withAccents?.capability.capabilityId).toBe("research.synthesis.multisource");
    expect(withoutAccents?.capability.capabilityId).toBe("research.synthesis.multisource");
  });

  it("returns null for plain general chat without capability intent", () => {
    expect(matchChatCapabilityRequest("hola, cómo estás hoy")).toBeNull();
  });
});
