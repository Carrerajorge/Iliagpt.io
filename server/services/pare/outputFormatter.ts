import type { IntentResult, RobustIntent, SubIntent } from "./robustIntentClassifier";
import type { RobustRouteDecision } from "./deterministicRouter";

export interface Traceability {
  route: string;
  confidence: number;
  tools: string[];
  reason: string;
  rule: string;
}

export interface StandardOutput {
  understood: string;
  action: string;
  result: string;
  traceability: Traceability;
  suggestions?: string[];
}

const INTENT_DESCRIPTIONS: Record<RobustIntent, string> = {
  analysis: "analizar contenido",
  artifact: "crear un documento/archivo",
  nav: "buscar/navegar",
  chat: "conversar",
  code: "trabajar con código",
  automation: "automatizar una tarea",
};

const SUB_INTENT_DESCRIPTIONS: Record<SubIntent, string> = {
  summarize: "resumir el contenido",
  extract_table: "extraer datos en formato tabla",
  compare: "comparar contenidos",
  rewrite: "reescribir/mejorar texto",
  translate: "traducir el contenido",
  critique_format: "revisar formato",
  create_report: "crear un informe",
  fill_template: "completar una plantilla",
  debug: "depurar código",
  refactor: "refactorizar código",
  search_web: "buscar en internet",
  find_file: "localizar un archivo",
};

const ACTION_DESCRIPTIONS: Record<RobustIntent, (subIntent: SubIntent | null, tools: string[]) => string> = {
  analysis: (subIntent, tools) => {
    if (subIntent === "summarize") return "He generado un resumen estructurado del contenido.";
    if (subIntent === "extract_table") return "He extraído los datos en formato tabular.";
    if (subIntent === "compare") return "He realizado un análisis comparativo.";
    if (tools.includes("file_read")) return "He leído y analizado el archivo adjunto.";
    return "He analizado el contenido solicitado.";
  },
  artifact: (subIntent, tools) => {
    if (subIntent === "create_report") return "He generado el informe solicitado.";
    if (subIntent === "fill_template") return "He completado la plantilla.";
    if (tools.includes("generate_document")) return "He creado el documento.";
    return "He generado el artefacto solicitado.";
  },
  nav: (subIntent, tools) => {
    if (subIntent === "search_web") return "He buscado en la web y recopilado información.";
    if (subIntent === "find_file") return "He localizado el archivo solicitado.";
    if (tools.includes("browse_url")) return "He navegado y extraído el contenido.";
    return "He encontrado la información solicitada.";
  },
  chat: () => "He respondido a tu consulta.",
  code: (subIntent, tools) => {
    if (subIntent === "debug") return "He analizado el código y encontrado posibles errores.";
    if (subIntent === "refactor") return "He refactorizado el código.";
    if (tools.includes("code_execute")) return "He ejecutado el código.";
    return "He procesado la solicitud de código.";
  },
  automation: () => "He configurado la automatización solicitada.",
};

export function formatStandardOutput(
  intent: IntentResult,
  decision: RobustRouteDecision,
  result: string,
  suggestions?: string[]
): StandardOutput {
  const subIntent = intent.subIntent;
  const baseDescription = INTENT_DESCRIPTIONS[intent.intent];
  const subDescription = subIntent ? SUB_INTENT_DESCRIPTIONS[subIntent] : null;

  const understood = subDescription
    ? `Entendí que quieres ${baseDescription}, específicamente ${subDescription}.`
    : `Entendí que quieres ${baseDescription}.`;

  const actionGenerator = ACTION_DESCRIPTIONS[intent.intent];
  const action = actionGenerator(subIntent, decision.tools);

  const traceability: Traceability = {
    route: decision.route,
    confidence: decision.confidence,
    tools: decision.tools,
    reason: decision.reason,
    rule: decision.ruleApplied,
  };

  return {
    understood,
    action,
    result,
    traceability,
    suggestions,
  };
}

export function formatTraceabilityString(traceability: Traceability): string {
  return (
    `Route: ${traceability.route} | ` +
    `Confidence: ${(traceability.confidence * 100).toFixed(0)}% | ` +
    `Tools: [${traceability.tools.slice(0, 3).join(", ")}${traceability.tools.length > 3 ? "..." : ""}] | ` +
    `Rule: ${traceability.rule}`
  );
}

export function formatOutputAsMarkdown(output: StandardOutput): string {
  let markdown = "";

  markdown += `## ${output.understood}\n\n`;
  markdown += `**${output.action}**\n\n`;
  markdown += `---\n\n`;
  markdown += output.result;
  markdown += "\n\n";

  if (output.suggestions && output.suggestions.length > 0) {
    markdown += `### 💡 Sugerencias\n\n`;
    for (const suggestion of output.suggestions) {
      markdown += `- ${suggestion}\n`;
    }
    markdown += "\n";
  }

  markdown += `<details>\n<summary>🔍 Trazabilidad</summary>\n\n`;
  markdown += `- **Route:** ${output.traceability.route}\n`;
  markdown += `- **Confidence:** ${(output.traceability.confidence * 100).toFixed(0)}%\n`;
  markdown += `- **Tools:** ${output.traceability.tools.join(", ") || "ninguna"}\n`;
  markdown += `- **Rule:** ${output.traceability.rule}\n`;
  markdown += `- **Reason:** ${output.traceability.reason}\n`;
  markdown += `</details>\n`;

  return markdown;
}

export function formatOutputAsJSON(output: StandardOutput): string {
  return JSON.stringify(output, null, 2);
}

export function createMinimalOutput(result: string, decision: RobustRouteDecision): StandardOutput {
  return {
    understood: "Procesando tu solicitud...",
    action: "Acción completada.",
    result,
    traceability: {
      route: decision.route,
      confidence: decision.confidence,
      tools: decision.tools,
      reason: decision.reason,
      rule: decision.ruleApplied,
    },
  };
}

export class OutputFormatter {
  format(
    intent: IntentResult,
    decision: RobustRouteDecision,
    result: string,
    suggestions?: string[]
  ): StandardOutput {
    return formatStandardOutput(intent, decision, result, suggestions);
  }

  toMarkdown(output: StandardOutput): string {
    return formatOutputAsMarkdown(output);
  }

  toJSON(output: StandardOutput): string {
    return formatOutputAsJSON(output);
  }

  toTraceString(output: StandardOutput): string {
    return formatTraceabilityString(output.traceability);
  }
}
