import { create } from "zustand";
import { devtools } from "zustand/middleware";

// ============================================
// TYPES
// ============================================

export interface ArtifactVersion {
  id: string;
  content: string;
  language?: string;
  timestamp: number;
  label?: string;
}

export interface Artifact {
  id: string;
  type: "code" | "html" | "table" | "diagram" | "text";
  title: string;
  content: string;
  language?: string;
  versions: ArtifactVersion[];
  currentVersionIndex: number;
  messageId: string;
  createdAt: number;
}

interface ArtifactStore {
  artifacts: Map<string, Artifact>;
  activeArtifactId: string | null;
  isPanelOpen: boolean;

  openArtifact: (
    artifact: Omit<Artifact, "versions" | "currentVersionIndex" | "createdAt">
  ) => void;
  closePanel: () => void;
  addVersion: (artifactId: string, content: string, label?: string) => void;
  navigateVersion: (artifactId: string, index: number) => void;
  setActiveArtifact: (id: string | null) => void;
  detectAndCreateArtifact: (messageId: string, content: string) => void;
}

let artifactCounter = 0;
function generateId(): string {
  return `artifact-${Date.now()}-${++artifactCounter}`;
}

function detectLanguage(info: string): string | undefined {
  const lang = info.trim().toLowerCase();
  if (!lang || lang === "text") return undefined;
  return lang;
}

// ============================================
// STORE
// ============================================

export const useArtifactStore = create<ArtifactStore>()(
  devtools(
    (set, get) => ({
      artifacts: new Map(),
      activeArtifactId: null,
      isPanelOpen: false,

      openArtifact: (partial) => {
        const now = Date.now();
        const artifact: Artifact = {
          ...partial,
          versions: [
            {
              id: generateId(),
              content: partial.content,
              language: partial.language,
              timestamp: now,
              label: "v1",
            },
          ],
          currentVersionIndex: 0,
          createdAt: now,
        };

        set((state) => {
          const next = new Map(state.artifacts);
          next.set(artifact.id, artifact);
          return {
            artifacts: next,
            activeArtifactId: artifact.id,
            isPanelOpen: true,
          };
        });
      },

      closePanel: () => {
        set({ isPanelOpen: false });
      },

      addVersion: (artifactId, content, label) => {
        set((state) => {
          const artifact = state.artifacts.get(artifactId);
          if (!artifact) return state;

          const newVersion: ArtifactVersion = {
            id: generateId(),
            content,
            language: artifact.language,
            timestamp: Date.now(),
            label: label ?? `v${artifact.versions.length + 1}`,
          };

          const updated: Artifact = {
            ...artifact,
            content,
            versions: [...artifact.versions, newVersion],
            currentVersionIndex: artifact.versions.length,
          };

          const next = new Map(state.artifacts);
          next.set(artifactId, updated);
          return { artifacts: next };
        });
      },

      navigateVersion: (artifactId, index) => {
        set((state) => {
          const artifact = state.artifacts.get(artifactId);
          if (!artifact) return state;
          if (index < 0 || index >= artifact.versions.length) return state;

          const version = artifact.versions[index];
          const updated: Artifact = {
            ...artifact,
            content: version.content,
            language: version.language,
            currentVersionIndex: index,
          };

          const next = new Map(state.artifacts);
          next.set(artifactId, updated);
          return { artifacts: next };
        });
      },

      setActiveArtifact: (id) => {
        set({ activeArtifactId: id, isPanelOpen: id !== null });
      },

      detectAndCreateArtifact: (messageId, content) => {
        // Detect HTML documents (including math visualizations)
        if (
          content.includes("<!DOCTYPE") ||
          content.includes("<html") ||
          /```html\s*\n[\s\S]*<html/i.test(content)
        ) {
          const htmlMatch = content.match(/```html?\s*\n([\s\S]*?)```/s);
          if (htmlMatch) {
            const htmlContent = htmlMatch[1].trim();
            // Detect math-specific artifacts for a richer title
            let title = "HTML Preview";
            if (/📈|📊|🌐|🔮|Math\.sin|Math\.cos|evalExpr|evalXY|eval4D|Plotly|THREE\./.test(htmlContent)) {
              if (/<h1[^>]*>.*?(?:📈|2D)/i.test(htmlContent)) title = "2D Math Graph";
              else if (/<h1[^>]*>.*?(?:🌐|3D)/i.test(htmlContent)) title = "3D Math Surface";
              else if (/<h1[^>]*>.*?(?:🔮|4D)/i.test(htmlContent)) title = "4D Math Visualization";
              else if (/<h1[^>]*>.*?(?:📊|\dD)/i.test(htmlContent)) title = "High-Dimensional Visualization";
              else title = "Math Visualization";
            }
            get().openArtifact({
              id: generateId(),
              type: "html",
              title,
              content: htmlContent,
              messageId,
            });
            return;
          }
        }

        // Detect mermaid diagrams
        const mermaidMatch = content.match(/```mermaid\s*\n([\s\S]*?)```/);
        if (mermaidMatch) {
          get().openArtifact({
            id: generateId(),
            type: "diagram",
            title: "Mermaid Diagram",
            content: mermaidMatch[1].trim(),
            messageId,
          });
          return;
        }

        // Detect markdown tables (at least 3 lines: header, separator, data)
        const tableLines = content.split("\n").filter((line) => {
          const trimmed = line.trim();
          return trimmed.startsWith("|") && trimmed.endsWith("|");
        });
        if (tableLines.length >= 3) {
          const tableContent = tableLines.join("\n");
          get().openArtifact({
            id: generateId(),
            type: "table",
            title: "Data Table",
            content: tableContent,
            messageId,
          });
          return;
        }

        // Detect large code blocks (> 15 lines)
        const codeBlockPattern = /```(\w*)\s*\n([\s\S]*?)```/g;
        let match: RegExpExecArray | null;
        while ((match = codeBlockPattern.exec(content)) !== null) {
          const lang = match[1];
          const code = match[2];
          const lineCount = code.split("\n").length;
          if (lineCount > 15) {
            const language = detectLanguage(lang);
            get().openArtifact({
              id: generateId(),
              type: "code",
              title: language ? `${language} code` : "Code",
              content: code.trim(),
              language,
              messageId,
            });
            return;
          }
        }
      },
    }),
    { name: "artifact-store" }
  )
);
