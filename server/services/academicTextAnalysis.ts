/**
 * Academic Text Analysis Service
 * LLM-powered extraction of academic paper structure.
 * Capabilities: IMRyD decomposition, methodology extraction, results, conclusions.
 */

import { llmGateway } from "../lib/llmGateway";

export interface IMRyDResult {
  introduction: string;
  methods: string;
  results: string;
  discussion: string;
  conclusion?: string;
  confidence: number;
}

export interface MethodologyExtraction {
  type: string; // qualitative, quantitative, mixed
  design: string;
  sample: string;
  instruments: string[];
  procedures: string;
  dataAnalysis: string;
  limitations: string[];
}

export interface ResultsExtraction {
  keyFindings: string[];
  statistics?: string[];
  tables?: string[];
  figures?: string[];
  significance: string;
}

export interface ConclusionsExtraction {
  mainConclusion: string;
  implications: string[];
  futureWork: string[];
  limitations: string[];
}

export interface ResearchGapsResult {
  gaps: Array<{
    description: string;
    severity: "high" | "medium" | "low";
    suggestedResearch: string;
  }>;
  overallAssessment: string;
}

export interface ContradictionResult {
  contradictions: Array<{
    claim1: string;
    source1: string;
    claim2: string;
    source2: string;
    description: string;
  }>;
  consensusAreas: string[];
}

async function llmExtract<T>(systemPrompt: string, userInput: string, requestId: string): Promise<T> {
  const res = await llmGateway.chat(
    [
      { role: "system", content: systemPrompt },
      { role: "user", content: userInput },
    ],
    {
      requestId,
      temperature: 0,
      maxTokens: 2000,
      enableFallback: true,
    }
  );

  let raw = (res.content || "").trim();
  if (raw.startsWith("```")) {
    raw = raw.replace(/^```(?:json)?\s*\n?/, "").replace(/\n?```\s*$/, "");
  }
  return JSON.parse(raw) as T;
}

/**
 * Decompose an academic text into IMRyD sections.
 */
export async function decomposeIMRyD(text: string): Promise<IMRyDResult> {
  const systemPrompt = `You are an academic text analyzer. Given an academic paper text, decompose it into IMRyD sections.
Return ONLY a JSON object with these fields:
{
  "introduction": "extracted introduction text",
  "methods": "extracted methodology text",
  "results": "extracted results text",
  "discussion": "extracted discussion text",
  "conclusion": "extracted conclusion text (if separate from discussion)",
  "confidence": 0.0-1.0
}
If a section is not clearly present, provide your best interpretation based on context. No markdown, no commentary.`;

  return llmExtract<IMRyDResult>(
    systemPrompt,
    `Analyze this academic text and extract IMRyD sections:\n\n${text.substring(0, 8000)}`,
    `imryd_${Date.now()}`
  );
}

/**
 * Extract methodology details from academic text.
 */
export async function extractMethodology(text: string): Promise<MethodologyExtraction> {
  const systemPrompt = `You are a research methodology expert. Extract the methodology from this academic text.
Return ONLY a JSON object:
{
  "type": "qualitative|quantitative|mixed",
  "design": "research design description",
  "sample": "sample/population description",
  "instruments": ["list of instruments/tools used"],
  "procedures": "data collection procedures",
  "dataAnalysis": "analysis methods used",
  "limitations": ["methodological limitations"]
}
No markdown, no commentary.`;

  return llmExtract<MethodologyExtraction>(
    systemPrompt,
    `Extract the methodology from this academic text:\n\n${text.substring(0, 8000)}`,
    `methodology_${Date.now()}`
  );
}

/**
 * Extract key results from academic text.
 */
export async function extractResults(text: string): Promise<ResultsExtraction> {
  const systemPrompt = `You are a research results analyst. Extract the key results from this academic text.
Return ONLY a JSON object:
{
  "keyFindings": ["finding 1", "finding 2", ...],
  "statistics": ["p < 0.05, r = 0.82", ...],
  "significance": "overall significance assessment"
}
No markdown, no commentary.`;

  return llmExtract<ResultsExtraction>(
    systemPrompt,
    `Extract the results from this academic text:\n\n${text.substring(0, 8000)}`,
    `results_${Date.now()}`
  );
}

/**
 * Extract conclusions from academic text.
 */
export async function extractConclusions(text: string): Promise<ConclusionsExtraction> {
  const systemPrompt = `You are an academic conclusions analyst. Extract conclusions from this academic text.
Return ONLY a JSON object:
{
  "mainConclusion": "the primary conclusion",
  "implications": ["practical/theoretical implication 1", ...],
  "futureWork": ["suggested future research direction 1", ...],
  "limitations": ["study limitation 1", ...]
}
No markdown, no commentary.`;

  return llmExtract<ConclusionsExtraction>(
    systemPrompt,
    `Extract the conclusions from this academic text:\n\n${text.substring(0, 8000)}`,
    `conclusions_${Date.now()}`
  );
}

/**
 * Identify research gaps across multiple paper abstracts.
 */
export async function identifyResearchGaps(
  papers: Array<{ title: string; abstract: string }>
): Promise<ResearchGapsResult> {
  const systemPrompt = `You are a research gap analyst. Given multiple paper abstracts on a topic, identify research gaps.
Return ONLY a JSON object:
{
  "gaps": [
    { "description": "gap description", "severity": "high|medium|low", "suggestedResearch": "what research could fill this gap" }
  ],
  "overallAssessment": "overview of the field's gaps"
}
No markdown, no commentary.`;

  const input = papers
    .map((p, i) => `PAPER ${i + 1}: ${p.title}\nAbstract: ${p.abstract}`)
    .join("\n\n");

  return llmExtract<ResearchGapsResult>(
    systemPrompt,
    `Identify research gaps from these papers:\n\n${input.substring(0, 10000)}`,
    `gaps_${Date.now()}`
  );
}

/**
 * Detect contradictions between papers.
 */
export async function detectContradictions(
  papers: Array<{ title: string; abstract: string }>
): Promise<ContradictionResult> {
  const systemPrompt = `You are a research contradiction detector. Given multiple paper abstracts, find contradictions.
Return ONLY a JSON object:
{
  "contradictions": [
    { "claim1": "claim from paper X", "source1": "paper title", "claim2": "contradicting claim from paper Y", "source2": "paper title", "description": "nature of contradiction" }
  ],
  "consensusAreas": ["areas where papers agree"]
}
No markdown, no commentary.`;

  const input = papers
    .map((p, i) => `PAPER ${i + 1}: ${p.title}\nAbstract: ${p.abstract}`)
    .join("\n\n");

  return llmExtract<ContradictionResult>(
    systemPrompt,
    `Detect contradictions between these papers:\n\n${input.substring(0, 10000)}`,
    `contradictions_${Date.now()}`
  );
}

/**
 * Compare two papers side by side.
 */
export async function comparePapers(
  paper1: { title: string; abstract: string },
  paper2: { title: string; abstract: string }
): Promise<{
  similarities: string[];
  differences: string[];
  complementarity: string;
  recommendation: string;
}> {
  const systemPrompt = `You are an academic paper comparator. Compare two papers and provide analysis.
Return ONLY a JSON object:
{
  "similarities": ["similarity 1", ...],
  "differences": ["difference 1", ...],
  "complementarity": "how the papers complement each other",
  "recommendation": "recommendation for researchers"
}
No markdown, no commentary.`;

  return llmExtract(
    systemPrompt,
    `Compare these two papers:\n\nPAPER 1: ${paper1.title}\n${paper1.abstract}\n\nPAPER 2: ${paper2.title}\n${paper2.abstract}`,
    `compare_${Date.now()}`
  );
}
