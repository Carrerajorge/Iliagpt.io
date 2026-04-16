import { v4 as uuidv4 } from "uuid";
import {
  Stage, StageContext, QualityGateResult, SourceRef, EvidenceChunk,
  NormalizedFact, NormalizedFactSchema
} from "../contracts";
import { openai } from "../../../lib/openai";

interface AnalyzerInput {
  evidence: EvidenceChunk[];
  sources: SourceRef[];
}

interface AnalyzerOutput {
  facts: NormalizedFact[];
}

const EXTRACTION_PATTERNS = {
  number: /(\d{1,3}(?:[.,]\d{3})*(?:[.,]\d+)?)\s*(%|USD|EUR|MXN|millones?|miles?|billion|million|k)?/gi,
  date: /(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{2,4})|(\d{4})[\/\-](\d{1,2})[\/\-](\d{1,2})/g,
  currency: /\$\s*(\d{1,3}(?:[.,]\d{3})*(?:[.,]\d+)?)|(\d{1,3}(?:[.,]\d{3})*(?:[.,]\d+)?)\s*(?:USD|EUR|MXN|dollars?|euros?)/gi,
  percentage: /(\d+(?:[.,]\d+)?)\s*%/g,
};

export class SemanticAnalyzerStage implements Stage<AnalyzerInput, AnalyzerOutput> {
  id = "analyzer";
  name = "Semantic Analyzer (Hybrid)";

  async execute(input: AnalyzerInput, context: StageContext): Promise<AnalyzerOutput> {
    const facts: NormalizedFact[] = [];

    context.emitEvent({
      eventType: "stage.progress",
      stageId: this.id,
      stageName: this.name,
      progress: 0.1,
      message: "Extracting facts with regex patterns",
    });

    for (const chunk of input.evidence) {
      const regexFacts = this.extractWithRegex(chunk);
      facts.push(...regexFacts);
    }

    context.emitEvent({
      eventType: "stage.progress",
      stageId: this.id,
      stageName: this.name,
      progress: 0.5,
      message: `Found ${facts.length} facts with regex, running LLM extraction`,
    });

    const llmFacts = await this.extractWithLLM(input.evidence, context);
    
    const mergedFacts = this.mergeFacts(facts, llmFacts);

    context.emitEvent({
      eventType: "stage.progress",
      stageId: this.id,
      stageName: this.name,
      progress: 1.0,
      message: `Extracted ${mergedFacts.length} unique facts`,
    });

    return { facts: mergedFacts };
  }

  private extractWithRegex(chunk: EvidenceChunk): NormalizedFact[] {
    const facts: NormalizedFact[] = [];
    const text = chunk.text;

    let match;
    
    const percentPattern = new RegExp(EXTRACTION_PATTERNS.percentage);
    while ((match = percentPattern.exec(text)) !== null) {
      facts.push(NormalizedFactSchema.parse({
        id: uuidv4(),
        key: `percentage_${facts.length}`,
        value: parseFloat(match[1].replace(",", ".")),
        unit: "%",
        sourceId: chunk.sourceId,
        evidenceChunkIds: [chunk.id],
        confidence: 0.85,
        provenance: {
          extractedAt: new Date().toISOString(),
          extractionMethod: "regex",
        },
        locale: chunk.lang,
        dataType: "percentage",
      }));
    }

    const currencyPattern = new RegExp(EXTRACTION_PATTERNS.currency);
    while ((match = currencyPattern.exec(text)) !== null) {
      const value = match[1] || match[2];
      if (value) {
        facts.push(NormalizedFactSchema.parse({
          id: uuidv4(),
          key: `currency_${facts.length}`,
          value: parseFloat(value.replace(/[.,](?=\d{3})/g, "").replace(",", ".")),
          unit: "USD",
          sourceId: chunk.sourceId,
          evidenceChunkIds: [chunk.id],
          confidence: 0.80,
          provenance: {
            extractedAt: new Date().toISOString(),
            extractionMethod: "regex",
          },
          locale: chunk.lang,
          dataType: "currency",
        }));
      }
    }

    return facts;
  }

  private async extractWithLLM(evidence: EvidenceChunk[], context: StageContext): Promise<NormalizedFact[]> {
    if (evidence.length === 0) return [];

    const combinedText = evidence.slice(0, 5).map(e => e.text).join("\n\n---\n\n");
    
    try {
      const response = await openai.chat.completions.create({
        model: "grok-3-fast",
        temperature: 0.1,
        max_tokens: 2000,
        messages: [
          {
            role: "system",
            content: `You are a fact extraction assistant. Extract key facts from the text and return them as a JSON array.
Each fact should have:
- key: descriptive name for the fact
- value: the extracted value (number, string, or date)
- unit: unit if applicable (%, USD, EUR, years, etc.)
- dataType: one of "number", "currency", "percentage", "date", "text", "entity", "metric"
- confidence: your confidence in the extraction (0.0 to 1.0)

Return ONLY a valid JSON array of facts.`,
          },
          { role: "user", content: combinedText },
        ],
        response_format: { type: "json_object" },
      });

      const content = response.choices[0]?.message?.content;
      if (content) {
        const parsed = JSON.parse(content);
        const factsArray = parsed.facts || parsed.data || (Array.isArray(parsed) ? parsed : []);
        
        return factsArray.map((f: any) => NormalizedFactSchema.parse({
          id: uuidv4(),
          key: f.key || "extracted_fact",
          value: f.value,
          unit: f.unit,
          sourceId: evidence[0].sourceId,
          evidenceChunkIds: [evidence[0].id],
          confidence: f.confidence || 0.7,
          provenance: {
            extractedAt: new Date().toISOString(),
            extractionMethod: "llm",
          },
          locale: context.locale,
          dataType: f.dataType || "text",
        }));
      }
    } catch (error) {
      console.warn("[SemanticAnalyzer] LLM extraction failed:", error);
    }

    return [];
  }

  private mergeFacts(regexFacts: NormalizedFact[], llmFacts: NormalizedFact[]): NormalizedFact[] {
    const seen = new Set<string>();
    const merged: NormalizedFact[] = [];

    for (const fact of [...regexFacts, ...llmFacts]) {
      const key = `${fact.key}:${fact.value}:${fact.unit}`;
      if (!seen.has(key)) {
        seen.add(key);
        merged.push(fact);
      }
    }

    return merged;
  }

  validate(output: AnalyzerOutput): QualityGateResult {
    const issues: QualityGateResult["issues"] = [];
    let score = 1.0;

    if (output.facts.length === 0) {
      issues.push({ severity: "warning", message: "No facts extracted from evidence" });
      score -= 0.3;
    }

    const avgConfidence = output.facts.reduce((sum, f) => sum + f.confidence, 0) / Math.max(1, output.facts.length);
    if (avgConfidence < 0.6) {
      issues.push({ severity: "warning", message: "Low average fact confidence" });
      score -= 0.1;
    }

    const llmFacts = output.facts.filter(f => f.provenance.extractionMethod === "llm").length;
    const regexFacts = output.facts.filter(f => f.provenance.extractionMethod === "regex").length;
    
    if (llmFacts === 0 && output.facts.length > 0) {
      issues.push({ severity: "info", message: "No LLM-extracted facts, only regex" });
    }

    return {
      gateId: "analyzer_quality",
      gateName: "Semantic Analysis Quality",
      passed: score >= 0.6,
      score: Math.max(0, score),
      threshold: 0.6,
      issues,
      checkedAt: new Date().toISOString(),
    };
  }

  async fallback(input: AnalyzerInput, context: StageContext): Promise<AnalyzerOutput> {
    const facts: NormalizedFact[] = [];
    
    for (const chunk of input.evidence) {
      facts.push(...this.extractWithRegex(chunk));
    }

    return { facts };
  }
}

export const semanticAnalyzerStage = new SemanticAnalyzerStage();
