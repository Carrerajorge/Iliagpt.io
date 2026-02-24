/**
 * Academic Synthesis Service
 * LLM-powered generators for state of the art, theoretical frameworks,
 * hypotheses, objectives, questions, literature reviews, and narrative synthesis.
 */

import { llmGateway } from "../lib/llmGateway";

interface PaperInput {
  title: string;
  authors?: string;
  year?: number;
  abstract?: string;
  journal?: string;
}

async function llmGenerate<T>(systemPrompt: string, userInput: string, requestId: string): Promise<T> {
  const res = await llmGateway.chat(
    [
      { role: "system", content: systemPrompt },
      { role: "user", content: userInput },
    ],
    {
      requestId,
      temperature: 0.3,
      maxTokens: 3000,
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
 * Generate state of the art synthesis from multiple papers.
 */
export async function generateStateOfArt(
  topic: string,
  papers: PaperInput[]
): Promise<{
  synthesis: string;
  themes: string[];
  timeline: Array<{ period: string; developments: string }>;
  currentTrends: string[];
  keyAuthors: string[];
}> {
  const systemPrompt = `You are an academic writer specializing in literature reviews.
Generate a state-of-the-art synthesis for the given topic based on the provided papers.
Write in formal academic Spanish.
Return ONLY a JSON object:
{
  "synthesis": "comprehensive state of the art text (500-1000 words)",
  "themes": ["theme 1", "theme 2", ...],
  "timeline": [{ "period": "2020-2022", "developments": "key developments" }],
  "currentTrends": ["trend 1", ...],
  "keyAuthors": ["Author1 (Year)", ...]
}
No markdown, no commentary.`;

  const input = `Topic: ${topic}\n\nPapers:\n${papers
    .map((p, i) => `${i + 1}. ${p.title} (${p.authors || "Unknown"}, ${p.year || "n.d."})\nAbstract: ${p.abstract || "N/A"}`)
    .join("\n\n")}`;

  return llmGenerate(systemPrompt, input.substring(0, 12000), `state_of_art_${Date.now()}`);
}

/**
 * Generate a theoretical framework from papers.
 */
export async function generateTheoreticalFramework(
  topic: string,
  papers: PaperInput[]
): Promise<{
  framework: string;
  theories: Array<{ name: string; author: string; description: string }>;
  concepts: Array<{ concept: string; definition: string; source: string }>;
  relationships: string[];
  diagram: string;
}> {
  const systemPrompt = `You are a research methodology expert.
Generate a theoretical framework for the given topic based on the provided papers.
Write in formal academic Spanish.
Return ONLY a JSON object:
{
  "framework": "comprehensive theoretical framework text (300-600 words)",
  "theories": [{ "name": "Theory Name", "author": "Author (Year)", "description": "brief description" }],
  "concepts": [{ "concept": "Key Concept", "definition": "operational definition", "source": "Author (Year)" }],
  "relationships": ["relationship between concept A and B", ...],
  "diagram": "text description of how concepts relate (for diagram generation)"
}
No markdown, no commentary.`;

  const input = `Topic: ${topic}\n\nPapers:\n${papers
    .map((p, i) => `${i + 1}. ${p.title} (${p.authors || "Unknown"}, ${p.year || "n.d."})\n${p.abstract || ""}`)
    .join("\n\n")}`;

  return llmGenerate(systemPrompt, input.substring(0, 12000), `framework_${Date.now()}`);
}

/**
 * Generate research hypotheses.
 */
export async function generateHypotheses(
  topic: string,
  papers: PaperInput[]
): Promise<{
  hypotheses: Array<{
    id: string;
    statement: string;
    type: "directional" | "non-directional" | "null";
    variables: { independent: string; dependent: string; control?: string };
    justification: string;
  }>;
  researchModel: string;
}> {
  const systemPrompt = `You are a research methodology expert.
Generate testable research hypotheses for the given topic based on the provided papers.
Write in formal academic Spanish.
Return ONLY a JSON object:
{
  "hypotheses": [
    {
      "id": "H1",
      "statement": "hypothesis statement",
      "type": "directional|non-directional|null",
      "variables": { "independent": "var", "dependent": "var", "control": "var" },
      "justification": "why this hypothesis is proposed based on the literature"
    }
  ],
  "researchModel": "description of the proposed research model"
}
No markdown, no commentary.`;

  const input = `Topic: ${topic}\n\nPapers:\n${papers
    .map((p, i) => `${i + 1}. ${p.title}\n${p.abstract || ""}`)
    .join("\n\n")}`;

  return llmGenerate(systemPrompt, input.substring(0, 10000), `hypotheses_${Date.now()}`);
}

/**
 * Generate research objectives.
 */
export async function generateResearchObjectives(
  topic: string,
  context?: string
): Promise<{
  general: string;
  specific: string[];
  justification: string;
}> {
  const systemPrompt = `You are a research methodology expert.
Generate research objectives (general and specific) for the given topic.
Write in formal academic Spanish.
Return ONLY a JSON object:
{
  "general": "general research objective",
  "specific": ["specific objective 1", "specific objective 2", "specific objective 3"],
  "justification": "brief justification for these objectives"
}
No markdown, no commentary.`;

  return llmGenerate(
    systemPrompt,
    `Topic: ${topic}\n${context ? `Context: ${context}` : ""}`,
    `objectives_${Date.now()}`
  );
}

/**
 * Generate research questions.
 */
export async function generateResearchQuestions(
  topic: string,
  context?: string
): Promise<{
  main: string;
  secondary: string[];
  methodology: string;
}> {
  const systemPrompt = `You are a research methodology expert.
Generate research questions (main and secondary) for the given topic.
Write in formal academic Spanish.
Return ONLY a JSON object:
{
  "main": "main research question",
  "secondary": ["secondary question 1", "secondary question 2", "secondary question 3"],
  "methodology": "suggested methodology to answer these questions"
}
No markdown, no commentary.`;

  return llmGenerate(
    systemPrompt,
    `Topic: ${topic}\n${context ? `Context: ${context}` : ""}`,
    `questions_${Date.now()}`
  );
}

/**
 * Generate automated literature review from papers.
 */
export async function generateLiteratureReview(
  topic: string,
  papers: PaperInput[]
): Promise<{
  review: string;
  sections: Array<{ title: string; content: string; sources: string[] }>;
  conclusions: string;
  gaps: string[];
}> {
  const systemPrompt = `You are an academic writer specializing in systematic literature reviews.
Generate a structured literature review for the given topic based on the provided papers.
Write in formal academic Spanish. Each section should cite sources by (Author, Year).
Return ONLY a JSON object:
{
  "review": "full literature review text (800-1500 words)",
  "sections": [
    { "title": "section title", "content": "section text with citations", "sources": ["Author (Year)"] }
  ],
  "conclusions": "synthesis of the literature review",
  "gaps": ["identified gap 1", ...]
}
No markdown, no commentary.`;

  const input = `Topic: ${topic}\n\nPapers:\n${papers
    .map((p, i) => `${i + 1}. ${p.title} (${p.authors || "Unknown"}, ${p.year || "n.d."})\n${p.abstract || ""}`)
    .join("\n\n")}`;

  return llmGenerate(systemPrompt, input.substring(0, 12000), `lit_review_${Date.now()}`);
}

/**
 * Narrative synthesis of multiple papers.
 */
export async function narrativeSynthesis(
  papers: PaperInput[]
): Promise<{
  narrative: string;
  themes: Array<{ theme: string; papers: string[]; summary: string }>;
  agreements: string[];
  disagreements: string[];
  overallConclusion: string;
}> {
  const systemPrompt = `You are an academic synthesis expert.
Create a narrative synthesis of the provided papers, identifying common themes, agreements, and disagreements.
Write in formal academic Spanish.
Return ONLY a JSON object:
{
  "narrative": "narrative synthesis text (500-1000 words)",
  "themes": [{ "theme": "theme name", "papers": ["Paper1 (Year)"], "summary": "theme summary" }],
  "agreements": ["area of agreement 1", ...],
  "disagreements": ["area of disagreement 1", ...],
  "overallConclusion": "overall synthesis conclusion"
}
No markdown, no commentary.`;

  const input = papers
    .map((p, i) => `${i + 1}. ${p.title} (${p.authors || "Unknown"}, ${p.year || "n.d."})\n${p.abstract || ""}`)
    .join("\n\n");

  return llmGenerate(systemPrompt, input.substring(0, 12000), `narrative_${Date.now()}`);
}

/**
 * Meta-analysis assistant — extracts and synthesizes effect sizes.
 */
export async function metaAnalysisAssistant(
  papers: PaperInput[]
): Promise<{
  effectSizes: Array<{
    paper: string;
    measure: string;
    value: string;
    significance: string;
  }>;
  pooledEstimate: string;
  heterogeneity: string;
  qualityAssessment: Array<{ paper: string; score: string; concerns: string[] }>;
  conclusion: string;
}> {
  const systemPrompt = `You are a meta-analysis expert.
Extract and synthesize effect sizes from the provided papers.
Return ONLY a JSON object:
{
  "effectSizes": [{ "paper": "title", "measure": "type (d, r, OR)", "value": "numeric value or range", "significance": "p-value or CI" }],
  "pooledEstimate": "estimated pooled effect size and interpretation",
  "heterogeneity": "assessment of heterogeneity across studies",
  "qualityAssessment": [{ "paper": "title", "score": "high/medium/low", "concerns": ["concern1"] }],
  "conclusion": "meta-analytic conclusion"
}
No markdown, no commentary.`;

  const input = papers
    .map((p, i) => `${i + 1}. ${p.title} (${p.year || "n.d."})\n${p.abstract || ""}`)
    .join("\n\n");

  return llmGenerate(systemPrompt, input.substring(0, 12000), `meta_analysis_${Date.now()}`);
}

/**
 * Audit academic sources for credibility and validity.
 */
export async function auditSources(
  papers: PaperInput[]
): Promise<{
  assessments: Array<{
    paper: string;
    credibility: "high" | "medium" | "low";
    peerReviewed: boolean;
    concerns: string[];
    recommendation: string;
  }>;
  overallQuality: string;
  recommendations: string[];
}> {
  const systemPrompt = `You are an academic source auditor.
Assess the credibility and quality of the provided sources.
Return ONLY a JSON object:
{
  "assessments": [
    {
      "paper": "paper title",
      "credibility": "high|medium|low",
      "peerReviewed": true/false,
      "concerns": ["concern 1"],
      "recommendation": "include/exclude/review"
    }
  ],
  "overallQuality": "assessment of overall source quality",
  "recommendations": ["recommendation 1", ...]
}
No markdown, no commentary.`;

  const input = papers
    .map((p, i) => `${i + 1}. ${p.title} (${p.authors || "Unknown"}, ${p.year || "n.d."}) - ${p.journal || "Unknown journal"}\n${p.abstract || ""}`)
    .join("\n\n");

  return llmGenerate(systemPrompt, input.substring(0, 12000), `audit_${Date.now()}`);
}
