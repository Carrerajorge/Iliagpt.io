import { v4 as uuidv4 } from "uuid";
import {
  Stage, StageContext, QualityGateResult, DocumentPlan,
  SourceRef, SourceRefSchema, EvidenceChunk, EvidenceChunkSchema, SupportedLocale
} from "../contracts";

interface EvidenceInput {
  plan: DocumentPlan | undefined;
  query: string;
}

interface EvidenceOutput {
  sources: SourceRef[];
  evidence: EvidenceChunk[];
}

export class EvidenceBuilderStage implements Stage<EvidenceInput, EvidenceOutput> {
  id = "evidence";
  name = "Evidence Builder (RAG)";

  async execute(input: EvidenceInput, context: StageContext): Promise<EvidenceOutput> {
    const sources: SourceRef[] = [];
    const evidence: EvidenceChunk[] = [];

    context.emitEvent({
      eventType: "stage.progress",
      stageId: this.id,
      stageName: this.name,
      progress: 0.1,
      message: "Searching for sources",
    });

    try {
      const { searchWeb } = await import("../../../services/webSearch");
      const searchQuery = input.plan?.title || input.query;
      const webResults = await searchWeb(searchQuery, 10);

      for (const result of webResults.results || []) {
        const sourceId = uuidv4();
        sources.push(SourceRefSchema.parse({
          id: sourceId,
          url: result.url,
          title: result.title || "Unknown",
          accessedAt: new Date().toISOString(),
          type: "web",
          reliability: 0.7,
          locale: context.locale,
        }));

        if (result.snippet) {
          evidence.push(EvidenceChunkSchema.parse({
            id: uuidv4(),
            sourceId,
            span: { start: 0, end: result.snippet.length },
            text: result.snippet,
            score: 0.8,
            lang: context.locale,
          }));
        }
      }

      context.emitEvent({
        eventType: "stage.progress",
        stageId: this.id,
        stageName: this.name,
        progress: 0.6,
        message: `Found ${sources.length} sources`,
      });

      if (input.plan?.audience === "academic") {
        try {
          const { searchScholar } = await import("../../../services/webSearch");
          const scholarResults = await searchScholar(searchQuery, 5);
          
          for (const result of scholarResults) {
            const sourceId = uuidv4();
            sources.push(SourceRefSchema.parse({
              id: sourceId,
              url: result.url,
              title: result.title || "Academic Source",
              author: result.author,
              publishedDate: result.year?.toString(),
              accessedAt: new Date().toISOString(),
              type: "web",
              reliability: 0.9,
              locale: context.locale,
            }));

            if (result.snippet) {
              evidence.push(EvidenceChunkSchema.parse({
                id: uuidv4(),
                sourceId,
                span: { start: 0, end: result.snippet.length },
                text: result.snippet,
                score: 0.9,
                lang: context.locale,
              }));
            }
          }
        } catch (e) {
          console.warn("[EvidenceBuilder] Scholar search failed:", e);
        }
      }

    } catch (error) {
      console.warn("[EvidenceBuilder] Search error:", error);
    }

    context.emitEvent({
      eventType: "stage.progress",
      stageId: this.id,
      stageName: this.name,
      progress: 1.0,
      message: `Collected ${evidence.length} evidence chunks from ${sources.length} sources`,
    });

    return { sources, evidence };
  }

  validate(output: EvidenceOutput): QualityGateResult {
    const issues: QualityGateResult["issues"] = [];
    let score = 1.0;

    if (output.sources.length === 0) {
      issues.push({ severity: "error", message: "No sources found" });
      score -= 0.5;
    } else if (output.sources.length < 3) {
      issues.push({ severity: "warning", message: "Less than 3 sources found" });
      score -= 0.2;
    }

    if (output.evidence.length === 0) {
      issues.push({ severity: "error", message: "No evidence chunks extracted" });
      score -= 0.4;
    }

    const avgReliability = output.sources.reduce((sum, s) => sum + s.reliability, 0) / Math.max(1, output.sources.length);
    if (avgReliability < 0.6) {
      issues.push({ severity: "warning", message: "Low average source reliability" });
      score -= 0.1;
    }

    return {
      gateId: "evidence_quality",
      gateName: "Evidence Quality",
      passed: score >= 0.5,
      score: Math.max(0, score),
      threshold: 0.5,
      issues,
      checkedAt: new Date().toISOString(),
    };
  }

  async fallback(_input: EvidenceInput, context: StageContext): Promise<EvidenceOutput> {
    const sourceId = uuidv4();
    return {
      sources: [SourceRefSchema.parse({
        id: sourceId,
        title: "Internal Knowledge",
        accessedAt: new Date().toISOString(),
        type: "user_input",
        reliability: 0.5,
        locale: context.locale,
      })],
      evidence: [EvidenceChunkSchema.parse({
        id: uuidv4(),
        sourceId,
        span: { start: 0, end: 100 },
        text: "Generated from internal knowledge base",
        score: 0.5,
        lang: context.locale,
      })],
    };
  }
}

export const evidenceBuilderStage = new EvidenceBuilderStage();
