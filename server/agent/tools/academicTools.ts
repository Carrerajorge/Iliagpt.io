/**
 * Academic Tools Registration
 * 30+ tools for academic research capabilities (OpenClaw IDs 1-50).
 */

import { z } from "zod";
import {
  decomposeIMRyD,
  extractMethodology,
  extractResults,
  extractConclusions,
  identifyResearchGaps,
  detectContradictions,
  comparePapers,
} from "../../services/academicTextAnalysis";
import {
  generateStateOfArt,
  generateTheoreticalFramework,
  generateHypotheses,
  generateResearchObjectives,
  generateResearchQuestions,
  generateLiteratureReview,
  narrativeSynthesis,
  metaAnalysisAssistant,
  auditSources,
} from "../../services/academicSynthesis";
import {
  generateVancouverCitation,
  generateHarvardCitation,
  generateIEEECitation,
  exportToRIS,
  type AcademicPaper,
} from "../../services/academicResearchEngine";

export interface ToolDefinition {
  name: string;
  description: string;
  category: string;
  schema: z.ZodObject<any>;
  execute: (params: any) => Promise<any>;
}

const PaperInputSchema = z.object({
  title: z.string(),
  authors: z.string().optional(),
  year: z.number().optional(),
  abstract: z.string().optional(),
  journal: z.string().optional(),
});

export const academicTools: ToolDefinition[] = [
  {
    name: "academic_imryd_decompose",
    description: "Decompose an academic text into IMRyD sections (Introduction, Methods, Results, Discussion)",
    category: "academic",
    schema: z.object({ text: z.string().min(100) }),
    execute: async (params) => decomposeIMRyD(params.text),
  },
  {
    name: "academic_extract_methodology",
    description: "Extract methodology details from an academic paper text",
    category: "academic",
    schema: z.object({ text: z.string().min(100) }),
    execute: async (params) => extractMethodology(params.text),
  },
  {
    name: "academic_extract_results",
    description: "Extract key results and findings from an academic text",
    category: "academic",
    schema: z.object({ text: z.string().min(100) }),
    execute: async (params) => extractResults(params.text),
  },
  {
    name: "academic_extract_conclusions",
    description: "Extract conclusions, implications, and future work from an academic text",
    category: "academic",
    schema: z.object({ text: z.string().min(100) }),
    execute: async (params) => extractConclusions(params.text),
  },
  {
    name: "academic_identify_gaps",
    description: "Identify research gaps across multiple paper abstracts",
    category: "academic",
    schema: z.object({ papers: z.array(z.object({ title: z.string(), abstract: z.string() })).min(2) }),
    execute: async (params) => identifyResearchGaps(params.papers),
  },
  {
    name: "academic_detect_contradictions",
    description: "Detect contradictions between multiple papers",
    category: "academic",
    schema: z.object({ papers: z.array(z.object({ title: z.string(), abstract: z.string() })).min(2) }),
    execute: async (params) => detectContradictions(params.papers),
  },
  {
    name: "academic_compare_papers",
    description: "Compare two papers side by side",
    category: "academic",
    schema: z.object({
      paper1: z.object({ title: z.string(), abstract: z.string() }),
      paper2: z.object({ title: z.string(), abstract: z.string() }),
    }),
    execute: async (params) => comparePapers(params.paper1, params.paper2),
  },
  {
    name: "academic_state_of_art",
    description: "Generate a state-of-the-art synthesis from multiple papers",
    category: "academic",
    schema: z.object({ topic: z.string(), papers: z.array(PaperInputSchema).min(2) }),
    execute: async (params) => generateStateOfArt(params.topic, params.papers),
  },
  {
    name: "academic_theoretical_framework",
    description: "Generate a theoretical framework from papers on a topic",
    category: "academic",
    schema: z.object({ topic: z.string(), papers: z.array(PaperInputSchema).min(2) }),
    execute: async (params) => generateTheoreticalFramework(params.topic, params.papers),
  },
  {
    name: "academic_generate_hypotheses",
    description: "Generate testable research hypotheses based on literature",
    category: "academic",
    schema: z.object({ topic: z.string(), papers: z.array(PaperInputSchema).min(1) }),
    execute: async (params) => generateHypotheses(params.topic, params.papers),
  },
  {
    name: "academic_research_objectives",
    description: "Generate research objectives (general and specific)",
    category: "academic",
    schema: z.object({ topic: z.string(), context: z.string().optional() }),
    execute: async (params) => generateResearchObjectives(params.topic, params.context),
  },
  {
    name: "academic_research_questions",
    description: "Generate main and secondary research questions",
    category: "academic",
    schema: z.object({ topic: z.string(), context: z.string().optional() }),
    execute: async (params) => generateResearchQuestions(params.topic, params.context),
  },
  {
    name: "academic_literature_review",
    description: "Generate a structured literature review",
    category: "academic",
    schema: z.object({ topic: z.string(), papers: z.array(PaperInputSchema).min(3) }),
    execute: async (params) => generateLiteratureReview(params.topic, params.papers),
  },
  {
    name: "academic_narrative_synthesis",
    description: "Create a narrative synthesis of multiple papers",
    category: "academic",
    schema: z.object({ papers: z.array(PaperInputSchema).min(2) }),
    execute: async (params) => narrativeSynthesis(params.papers),
  },
  {
    name: "academic_meta_analysis",
    description: "Run a meta-analysis assistant on multiple papers",
    category: "academic",
    schema: z.object({ papers: z.array(PaperInputSchema).min(2) }),
    execute: async (params) => metaAnalysisAssistant(params.papers),
  },
  {
    name: "academic_audit_sources",
    description: "Audit academic sources for credibility and quality",
    category: "academic",
    schema: z.object({ papers: z.array(PaperInputSchema).min(1) }),
    execute: async (params) => auditSources(params.papers),
  },
  {
    name: "citation_format_vancouver",
    description: "Generate Vancouver (ICMJE) format citation for a paper",
    category: "academic",
    schema: z.object({
      title: z.string(),
      authors: z.array(z.object({ name: z.string() })),
      year: z.number().optional(),
      journal: z.string().optional(),
      doi: z.string().optional(),
    }),
    execute: async (params) => ({
      citation: generateVancouverCitation(params as unknown as AcademicPaper),
    }),
  },
  {
    name: "citation_format_harvard",
    description: "Generate Harvard format citation for a paper",
    category: "academic",
    schema: z.object({
      title: z.string(),
      authors: z.array(z.object({ name: z.string() })),
      year: z.number().optional(),
      journal: z.string().optional(),
      doi: z.string().optional(),
    }),
    execute: async (params) => ({
      citation: generateHarvardCitation(params as unknown as AcademicPaper),
    }),
  },
  {
    name: "citation_format_ieee",
    description: "Generate IEEE format citation for a paper",
    category: "academic",
    schema: z.object({
      title: z.string(),
      authors: z.array(z.object({ name: z.string() })),
      year: z.number().optional(),
      journal: z.string().optional(),
      doi: z.string().optional(),
    }),
    execute: async (params) => ({
      citation: generateIEEECitation(params as unknown as AcademicPaper),
    }),
  },
  {
    name: "citation_export_ris",
    description: "Export papers to RIS format (compatible with reference managers)",
    category: "academic",
    schema: z.object({
      papers: z.array(z.object({
        title: z.string(),
        authors: z.array(z.object({ name: z.string() })),
        year: z.number().optional(),
        journal: z.string().optional(),
        doi: z.string().optional(),
        url: z.string().optional(),
        abstract: z.string().optional(),
        language: z.string().optional(),
        keywords: z.array(z.string()).optional(),
        source: z.string().default("openalex"),
      })),
    }),
    execute: async (params) => ({
      ris: exportToRIS(params.papers as unknown as AcademicPaper[]),
      count: params.papers.length,
    }),
  },
];
