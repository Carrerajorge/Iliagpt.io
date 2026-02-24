import { getOpenClawConfig } from "../openclaw/config";
import { buildClawiCapabilitiesSummary } from "../openclaw/fusion/clawiCatalog";
import { initSkills } from "../openclaw/skills/skillLoader";
import { skillRegistry } from "../openclaw/skills/skillRegistry";
import { orchestrationEngine } from "../services/orchestrationEngine";
import { RAGService } from "../services/ragService";

const ragService = new RAGService();
let skillsInitPromise: Promise<void> | null = null;

const planningSignalRegex =
  /\b(plan|planifica|planificar|pasos|step[- ]by[- ]step|orquesta|orquesta|workflow|estrategia|desglosa|divide|roadmap)\b/i;
const memorySignalRegex =
  /\b(recuerda|recordar|historial|contexto|anterior|previo|seguimiento|continuamos|como dijimos|based on previous|remember)\b/i;
const skillsSignalRegex = /\$[a-z0-9_-]{2,80}|\b(skill|skills|habilidad|habilidades|subagente|subagentes|tool|tools|herramienta|herramientas)\b/i;
const channelsSignalRegex =
  /\b(channel|channels|canal|canales|telegram|whatsapp|slack|discord|imessage|line|signal|matrix|teams|googlechat|feishu|mattermost|irc|twitch)\b/i;
const localFsSignalRegex =
  /\b(?:carpetas?|caprteas?|careptas?|carpteas?|folders?|directorios?|directories?|archivos?|files?)\b.*\b(?:mac|computadora|pc|laptop|sistema|escritorio|desktop|descargas|downloads|documentos|documents|home|disco)\b|\b(?:analiza|explora|listar|list|revisa|cuenta|count|cu[aá]ntas?)\b.*\b(?:mi\s+(?:mac|computadora|pc)|desktop|escritorio|home)\b|\b(?:cu[aá]ntas?|how\s+many|cantidad(?:\s+de)?|n[uú]mero(?:\s+de)?)\s+(?:carpetas?|caprteas?|careptas?|carpteas?|folders?|directorios?|directories?|archivos?|files?)\b/i;

const MAX_PROMPT_APPENDIX_CHARS = 8000;
const MAX_SKILL_PROMPT_CHARS = 2400;

type NativeFusionInput = {
  userId: string;
  chatId: string;
  message: string;
};

export type NativeFusionResult = {
  appliedModules: Array<"memory" | "orchestrator" | "skills" | "clawi_catalog">;
  promptAddendum: string;
};

function normalizeComplexity(objective: string): number {
  return Math.min(10, Math.max(1, Math.ceil(objective.length / 120)));
}

export function hasNativeAgenticSignal(rawMessage: string): boolean {
  const message = String(rawMessage || "").trim();
  if (message.length < 12) return false;
  return (
    planningSignalRegex.test(message) ||
    memorySignalRegex.test(message) ||
    skillsSignalRegex.test(message) ||
    localFsSignalRegex.test(message)
  );
}

async function ensureSkillsReady(): Promise<void> {
  if (skillRegistry.list().length > 0) {
    return;
  }
  if (!skillsInitPromise) {
    skillsInitPromise = initSkills(getOpenClawConfig()).catch((error) => {
      skillsInitPromise = null;
      throw error;
    });
  }
  await skillsInitPromise;
}

function tokenize(raw: string): string[] {
  return String(raw || "")
    .toLowerCase()
    .split(/[^a-z0-9áéíóúñ_-]+/i)
    .map((token) => token.trim())
    .filter((token) => token.length >= 3);
}

function explicitSkillIdsFromMessage(message: string): string[] {
  const ids = new Set<string>();

  const mentionRegex = /\$([a-z0-9][a-z0-9_-]{1,79})/gi;
  for (const match of message.matchAll(mentionRegex)) {
    ids.add(match[1].toLowerCase());
  }

  const namedSkillRegex = /\b(?:skill|skills|habilidad|habilidades)\s*[:=]?\s*([a-z0-9][a-z0-9_-]{1,79})\b/gi;
  for (const match of message.matchAll(namedSkillRegex)) {
    ids.add(match[1].toLowerCase());
  }

  return Array.from(ids);
}

function inferRelevantSkills(message: string, maxSkills = 3): string[] {
  const skills = skillRegistry.list();
  if (skills.length === 0) return [];

  const explicit = explicitSkillIdsFromMessage(message);
  if (explicit.length > 0) {
    const explicitSet = new Set(explicit);
    return skills
      .filter((skill) => explicitSet.has(skill.id.toLowerCase()))
      .slice(0, maxSkills)
      .map((skill) => skill.id);
  }

  const tokens = tokenize(message);
  if (tokens.length === 0) return [];

  const scored = skills
    .map((skill) => {
      const haystack = `${skill.id} ${skill.name} ${skill.description || ""}`.toLowerCase();
      let score = 0;
      for (const token of tokens) {
        if (haystack.includes(token)) {
          score += 1;
        }
      }
      return { id: skill.id, score };
    })
    .filter((entry) => entry.score > 0)
    .sort((a, b) => b.score - a.score);

  return scored.slice(0, maxSkills).map((entry) => entry.id);
}

function truncate(value: string, maxChars: number): string {
  if (value.length <= maxChars) return value;
  return `${value.slice(0, maxChars)}\n...(recortado)`;
}

export async function buildNativeAgenticFusion(input: NativeFusionInput): Promise<NativeFusionResult> {
  const message = String(input.message || "").trim();
  if (!message) {
    return { appliedModules: [], promptAddendum: "" };
  }

  const appliedModules: NativeFusionResult["appliedModules"] = [];
  const sections: string[] = [];

  const needsPlanning = planningSignalRegex.test(message);
  const needsMemory = memorySignalRegex.test(message);
  const needsSkills = skillsSignalRegex.test(message);
  const needsClawiCatalog = needsSkills || channelsSignalRegex.test(message);

  if (needsMemory) {
    try {
      const context = await ragService.getContextForMessage(input.userId, message, input.chatId);
      if (context.trim().length > 0) {
        appliedModules.push("memory");
        sections.push(`[Memoria RAG]\n${context.trim()}`);
      }
    } catch {
      // Optional enrichment only.
    }
  }

  if (needsPlanning) {
    try {
      const complexity = normalizeComplexity(message);
      const subtasks = await orchestrationEngine.decomposeTask(message, complexity);
      const plan = orchestrationEngine.buildExecutionPlan(subtasks);
      appliedModules.push("orchestrator");
      sections.push(
        `[Plan Previo]\n${JSON.stringify(
          {
            objective: message,
            complexity,
            subtasks: subtasks.map((task) => ({
              id: task.id,
              description: task.description,
              toolId: task.toolId,
              dependencies: task.dependencies,
              priority: task.priority,
            })),
            waves: plan.waves.length,
            maxParallelism: plan.maxParallelism,
          },
          null,
          2,
        )}`,
      );
    } catch {
      // Optional enrichment only.
    }
  }

  if (needsSkills) {
    try {
      await ensureSkillsReady();
      const selectedSkillIds = inferRelevantSkills(message);
      if (selectedSkillIds.length > 0) {
        const resolved = skillRegistry.resolve(selectedSkillIds);
        if (resolved.skills.length > 0) {
          appliedModules.push("skills");
          const listedSkills = resolved.skills
            .map((skill) => `- ${skill.name} (${skill.id})`)
            .join("\n");
          const toolHints = resolved.tools.length > 0 ? resolved.tools.join(", ") : "(sin tools específicas)";
          sections.push(
            `[Skills Relevantes]\n${listedSkills}\nTools sugeridas: ${toolHints}\n\n${truncate(
              resolved.prompt,
              MAX_SKILL_PROMPT_CHARS,
            )}`,
          );
        }
      }
    } catch {
      // Optional enrichment only.
    }
  }

  if (needsClawiCatalog) {
    try {
      const summary = await buildClawiCapabilitiesSummary({ maxItems: 18 });
      if (summary.trim().length > 0) {
        appliedModules.push("clawi_catalog");
        sections.push(summary);
      }
    } catch {
      // Optional enrichment only.
    }
  }

  if (sections.length === 0) {
    return { appliedModules: [], promptAddendum: "" };
  }

  const promptAddendum = truncate(
    `\n\n[Contexto Agentico Nativo]\nUsa este contexto como apoyo para responder con coherencia y ejecutar pasos cuando corresponda.\n\n${sections.join(
      "\n\n",
    )}`,
    MAX_PROMPT_APPENDIX_CHARS,
  );

  return { appliedModules, promptAddendum };
}
