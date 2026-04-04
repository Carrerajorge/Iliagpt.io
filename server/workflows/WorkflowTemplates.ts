import * as YAML from "yaml";
import { Logger } from "../lib/logger";
import { workflowEngine, WorkflowDefinition, WorkflowRun, WorkflowStep } from "./WorkflowEngine";

// ─── Types ────────────────────────────────────────────────────────────────────

export interface TemplateParameter {
  name: string;
  type: "string" | "number" | "boolean" | "select";
  description: string;
  default?: any;
  options?: string[];
  required: boolean;
}

export interface WorkflowTemplate {
  id: string;
  name: string;
  description: string;
  category: "research" | "code" | "content" | "data" | "productivity" | "analysis";
  tags: string[];
  parameters: TemplateParameter[];
  definition: WorkflowDefinition;
  estimatedDuration: string;
  requiredTools: string[];
  previewSteps: string[];
}

// ─── Parameter Validation ─────────────────────────────────────────────────────

function validateParameters(params: TemplateParameter[], values: Record<string, any>): void {
  for (const param of params) {
    if (param.required && (values[param.name] === undefined || values[param.name] === null || values[param.name] === "")) {
      throw new Error(`Required parameter missing: ${param.name}`);
    }
    if (param.type === "select" && values[param.name] !== undefined && param.options) {
      if (!param.options.includes(String(values[param.name]))) {
        throw new Error(`Parameter "${param.name}" must be one of: ${param.options.join(", ")}`);
      }
    }
  }
}

// ─── Deep-substitute parameters into a definition ────────────────────────────

function substituteParams(obj: any, params: Record<string, any>): any {
  if (typeof obj === "string") {
    return obj.replace(/\$\{([^}]+)\}/g, (_, name) => {
      const val = params[name.trim()];
      return val !== undefined ? String(val) : "";
    });
  }
  if (Array.isArray(obj)) return obj.map((item) => substituteParams(item, params));
  if (obj !== null && typeof obj === "object") {
    const result: Record<string, any> = {};
    for (const [k, v] of Object.entries(obj)) {
      result[k] = substituteParams(v, params);
    }
    return result;
  }
  return obj;
}

// ─── Template Registry ─────────────────────────────────────────────────────────

class WorkflowTemplates {
  private templates: Map<string, WorkflowTemplate> = new Map();
  private engine = workflowEngine;

  constructor() {
    this.registerTemplate(this.buildResearchDigestTemplate());
    this.registerTemplate(this.buildCodeReviewTemplate());
    this.registerTemplate(this.buildDataPipelineTemplate());
    this.registerTemplate(this.buildContentCreationTemplate());
    this.registerTemplate(this.buildMeetingPrepTemplate());
    Logger.info("[WorkflowTemplates] Initialized", { count: this.templates.size });
  }

  // ── Public API ────────────────────────────────────────────────────────────────

  listTemplates(filter?: { category?: string; tags?: string[] }): WorkflowTemplate[] {
    const all = Array.from(this.templates.values());
    if (!filter) return all;
    return all.filter((t) => {
      if (filter.category && t.category !== filter.category) return false;
      if (filter.tags && filter.tags.length > 0) {
        const hasAllTags = filter.tags.every((tag) => t.tags.includes(tag));
        if (!hasAllTags) return false;
      }
      return true;
    });
  }

  getTemplate(id: string): WorkflowTemplate | null {
    return this.templates.get(id) ?? null;
  }

  async instantiate(templateId: string, parameters: Record<string, any>): Promise<WorkflowDefinition> {
    const template = this.templates.get(templateId);
    if (!template) throw new Error(`Template not found: ${templateId}`);

    // Apply defaults
    const resolvedParams: Record<string, any> = {};
    for (const param of template.parameters) {
      resolvedParams[param.name] = parameters[param.name] ?? param.default;
    }

    validateParameters(template.parameters, resolvedParams);

    // Deep substitute ${param} placeholders in the definition
    const substituted = substituteParams(JSON.parse(JSON.stringify(template.definition)), resolvedParams) as WorkflowDefinition;

    // Give the instance a unique name
    substituted.name = `${template.name} (${new Date().toISOString().slice(0, 10)})`;

    Logger.info("[WorkflowTemplates] Template instantiated", { templateId, name: substituted.name });
    return substituted;
  }

  async runFromTemplate(
    templateId: string,
    parameters: Record<string, any>,
    userId?: string
  ): Promise<WorkflowRun> {
    const definition = await this.instantiate(templateId, parameters);
    const workflowId = await this.engine.registerWorkflow(definition);
    const run = await this.engine.trigger(workflowId, parameters, userId);
    Logger.info("[WorkflowTemplates] Template run started", { templateId, workflowId, runId: run.id, userId });
    return run;
  }

  registerTemplate(template: WorkflowTemplate): void {
    this.templates.set(template.id, template);
    Logger.debug("[WorkflowTemplates] Template registered", { id: template.id, name: template.name });
  }

  removeTemplate(id: string): void {
    this.templates.delete(id);
    Logger.info("[WorkflowTemplates] Template removed", { id });
  }

  async exportTemplate(id: string): Promise<string> {
    const template = this.templates.get(id);
    if (!template) throw new Error(`Template not found: ${id}`);
    Logger.info("[WorkflowTemplates] Exporting template", { id });
    return YAML.stringify({
      templateId: template.id,
      name: template.name,
      description: template.description,
      category: template.category,
      tags: template.tags,
      parameters: template.parameters,
      estimatedDuration: template.estimatedDuration,
      requiredTools: template.requiredTools,
      previewSteps: template.previewSteps,
      definition: template.definition,
    });
  }

  async importTemplate(yaml: string): Promise<WorkflowTemplate> {
    const parsed = YAML.parse(yaml) as WorkflowTemplate;
    if (!parsed.id || !parsed.name || !parsed.definition) {
      throw new Error("Invalid template YAML: missing id, name, or definition");
    }
    this.registerTemplate(parsed);
    Logger.info("[WorkflowTemplates] Template imported", { id: parsed.id, name: parsed.name });
    return parsed;
  }

  // ── Template Builders ─────────────────────────────────────────────────────────

  private buildResearchDigestTemplate(): WorkflowTemplate {
    const definition: WorkflowDefinition = {
      name: "Research Digest",
      version: "1.0",
      description: "Daily research digest on a topic with configurable depth and output format",
      trigger: { type: "manual" },
      steps: [
        {
          id: "generate_queries",
          type: "llm_call",
          model: "claude-opus-4-5",
          prompt:
            'Generate 5 specific, targeted search queries for researching "${topic}". ' +
            "Return them as a JSON array of strings. " +
            "Focus on ${depth === 'quick' ? 'recent news and overviews' : 'academic papers, expert analysis, and deep dives'}.",
        },
        {
          id: "search_primary",
          type: "tool_execute",
          tool: "web_search",
          input: {
            query: "${topic} latest developments 2025",
            maxResults: "${depth === 'quick' ? 3 : 8}",
          },
        },
        {
          id: "search_academic",
          type: "tool_execute",
          tool: "web_search",
          input: {
            query: "${topic} research analysis expert opinion",
            maxResults: "5",
          },
        },
        {
          id: "extract_facts",
          type: "llm_call",
          model: "claude-opus-4-5",
          prompt:
            "Extract and organize the key facts, insights, and developments from these search results:\n\n" +
            "Primary results: {{steps.search_primary.result}}\n" +
            "Academic results: {{steps.search_academic.result}}\n\n" +
            "Organize into: key facts, recent developments, expert perspectives, open questions.",
        },
        {
          id: "write_digest",
          type: "llm_call",
          model: "claude-opus-4-5",
          prompt:
            "Write a comprehensive research digest about '${topic}' based on:\n\n" +
            "{{steps.extract_facts.result}}\n\n" +
            "Target format: ${output_format}.\n" +
            "If 'email': concise, scannable, with a TL;DR.\n" +
            "If 'document': full sections with headers.\n" +
            "If 'bullets': structured bullet points only.",
        },
        {
          id: "format_output",
          type: "transform",
          input: "{{steps.write_digest.result}}",
          transform:
            "Format the digest for '${output_format}' delivery. " +
            "Add metadata: topic='${topic}', depth='${depth}', date={{workflow.name}}.",
        },
      ] as WorkflowStep[],
    };

    return {
      id: "research_digest",
      name: "Research Digest",
      description: "Automatically research a topic and produce a comprehensive digest with configurable depth and format",
      category: "research",
      tags: ["research", "digest", "automation", "daily"],
      estimatedDuration: "5-10 minutes",
      requiredTools: ["web_search"],
      previewSteps: [
        "Generate targeted search queries for the topic",
        "Search for primary sources and recent news",
        "Search for academic and expert content",
        "Extract and organize key facts and insights",
        "Write the research digest",
        "Format output for chosen delivery method",
      ],
      parameters: [
        {
          name: "topic",
          type: "string",
          description: "Topic to research (e.g., 'quantum computing', 'climate policy')",
          required: true,
        },
        {
          name: "depth",
          type: "select",
          description: "How deep to go with research",
          options: ["quick", "deep"],
          default: "quick",
          required: false,
        },
        {
          name: "output_format",
          type: "select",
          description: "Output format for the digest",
          options: ["email", "document", "bullets"],
          default: "document",
          required: false,
        },
      ],
      definition,
    };
  }

  private buildCodeReviewTemplate(): WorkflowTemplate {
    const definition: WorkflowDefinition = {
      name: "Code Review",
      version: "1.0",
      description: "Automated multi-stage code review pipeline",
      trigger: { type: "manual" },
      steps: [
        {
          id: "parse_code",
          type: "llm_call",
          model: "claude-opus-4-5",
          prompt:
            "Analyze this ${language} code structure and identify:\n" +
            "1. Main components and their responsibilities\n" +
            "2. Dependencies and external calls\n" +
            "3. Code complexity metrics (cyclomatic complexity estimate, lines of code, nesting depth)\n" +
            "4. Design patterns used\n\n" +
            "Code:\n```${language}\n${code}\n```\n\n" +
            "Return a structured JSON analysis.",
        },
        {
          id: "check_complexity",
          type: "llm_call",
          model: "claude-opus-4-5",
          prompt:
            "Based on this structure analysis:\n{{steps.parse_code.result}}\n\n" +
            "Evaluate complexity and maintainability of the ${language} code:\n```\n${code}\n```\n\n" +
            "Identify: overly complex functions, deep nesting, unclear naming, missing abstractions. " +
            "Rate complexity 1-10 and explain.",
        },
        {
          id: "scan_vulnerabilities",
          type: "llm_call",
          model: "claude-opus-4-5",
          prompt:
            "Perform a security review of this ${language} code:\n```\n${code}\n```\n\n" +
            "Check for: SQL injection, XSS, insecure dependencies, hardcoded secrets, " +
            "improper error handling, authentication flaws, input validation issues, " +
            "path traversal vulnerabilities.\n\n" +
            "List each finding with severity (critical/high/medium/low) and line reference if possible.",
        },
        {
          id: "check_style",
          type: "llm_call",
          model: "claude-opus-4-5",
          prompt:
            "Review ${language} code style and best practices:\n```\n${code}\n```\n\n" +
            "Focus: ${focus === 'all' ? 'style, performance, security' : focus}.\n" +
            "${strict ? 'Apply strict review standards.' : 'Apply standard review standards.'}\n\n" +
            "Cover: naming conventions, documentation, error handling, test coverage indicators, " +
            "${language}-specific idioms and best practices.",
        },
        {
          id: "generate_report",
          type: "llm_call",
          model: "claude-opus-4-5",
          prompt:
            "Compile a complete code review report for ${language} code.\n\n" +
            "Structure analysis: {{steps.parse_code.result}}\n" +
            "Complexity review: {{steps.check_complexity.result}}\n" +
            "Security findings: {{steps.scan_vulnerabilities.result}}\n" +
            "Style review: {{steps.check_style.result}}\n\n" +
            "Generate a clear report with:\n" +
            "## Summary\n## Critical Issues\n## Security\n## Complexity\n## Style\n## Recommendations\n## Score (0-100)",
        },
      ] as WorkflowStep[],
    };

    return {
      id: "code_review",
      name: "Automated Code Review",
      description: "Multi-stage code review covering complexity, security vulnerabilities, and style best practices",
      category: "code",
      tags: ["code", "review", "security", "quality"],
      estimatedDuration: "3-7 minutes",
      requiredTools: [],
      previewSteps: [
        "Parse code structure and identify components",
        "Evaluate complexity and maintainability",
        "Scan for security vulnerabilities",
        "Check style and best practices",
        "Generate comprehensive review report",
      ],
      parameters: [
        { name: "code", type: "string", description: "Code to review", required: true },
        {
          name: "language",
          type: "string",
          description: "Programming language (e.g., typescript, python, go)",
          default: "typescript",
          required: false,
        },
        {
          name: "focus",
          type: "select",
          description: "Area to focus on",
          options: ["security", "performance", "style", "all"],
          default: "all",
          required: false,
        },
        {
          name: "strict",
          type: "boolean",
          description: "Apply strict review standards",
          default: false,
          required: false,
        },
      ],
      definition,
    };
  }

  private buildDataPipelineTemplate(): WorkflowTemplate {
    const definition: WorkflowDefinition = {
      name: "Data Pipeline",
      version: "1.0",
      description: "ETL pipeline: fetch → validate → transform → analyze → report",
      trigger: { type: "manual" },
      steps: [
        {
          id: "fetch_data",
          type: "http_request",
          method: "GET",
          url: "${source_url}",
          headers: { Accept: "application/json" },
        },
        {
          id: "validate",
          type: "llm_call",
          model: "claude-opus-4-5",
          prompt:
            "Validate this data fetched from ${source_url}:\n\n" +
            "{{steps.fetch_data.result}}\n\n" +
            "Check for: completeness, data types, null values, outliers, schema consistency.\n" +
            "Return a JSON object: { valid: boolean, issues: [], record_count: number, schema: {} }",
        },
        {
          id: "transform",
          type: "transform",
          input: "{{steps.fetch_data.result}}",
          transform:
            "Apply these transformations: ${transform_instructions}. " +
            "Clean null values, normalize data types, flatten nested objects where appropriate.",
        },
        {
          id: "analyze",
          type: "llm_call",
          model: "claude-opus-4-5",
          prompt:
            "Analyze the transformed dataset:\n\n{{steps.transform.result}}\n\n" +
            "Provide: summary statistics, key trends, anomalies, " +
            "data quality score (0-100), key insights, and actionable observations.",
        },
        {
          id: "generate_report",
          type: "llm_call",
          model: "claude-opus-4-5",
          prompt:
            "Generate a data report in ${output_format} format.\n\n" +
            "Validation: {{steps.validate.result}}\n" +
            "Analysis: {{steps.analyze.result}}\n\n" +
            "If 'json': structured JSON with all metrics.\n" +
            "If 'csv': CSV-formatted summary table.\n" +
            "If 'markdown': formatted markdown with sections and tables.",
        },
      ] as WorkflowStep[],
    };

    return {
      id: "data_pipeline",
      name: "Data Pipeline",
      description: "Complete ETL pipeline: fetch data from a URL, validate, transform, analyze, and generate a report",
      category: "data",
      tags: ["data", "etl", "pipeline", "analysis"],
      estimatedDuration: "5-15 minutes",
      requiredTools: ["http_request"],
      previewSteps: [
        "Fetch data from source URL",
        "Validate data quality and schema",
        "Apply transformations",
        "Statistical analysis and insight extraction",
        "Generate formatted report",
      ],
      parameters: [
        { name: "source_url", type: "string", description: "URL to fetch data from", required: true },
        {
          name: "transform_instructions",
          type: "string",
          description: "Instructions for data transformation",
          default: "Normalize fields and clean the data",
          required: false,
        },
        {
          name: "output_format",
          type: "select",
          description: "Output format for the report",
          options: ["json", "csv", "markdown"],
          default: "markdown",
          required: false,
        },
      ],
      definition,
    };
  }

  private buildContentCreationTemplate(): WorkflowTemplate {
    const definition: WorkflowDefinition = {
      name: "Content Creation",
      version: "1.0",
      description: "Research-backed content creation with human review checkpoint",
      trigger: { type: "manual" },
      steps: [
        {
          id: "research_topic",
          type: "tool_execute",
          tool: "web_search",
          input: {
            query: "${topic} ${content_type} examples best practices 2025",
            maxResults: "8",
          },
        },
        {
          id: "create_outline",
          type: "llm_call",
          model: "claude-opus-4-5",
          prompt:
            "Create a detailed outline for a ${content_type} about '${topic}'.\n\n" +
            "Research context:\n{{steps.research_topic.result}}\n\n" +
            "Tone: ${tone}. Target length: approximately ${word_count} words.\n\n" +
            "Provide a structured outline with main sections, subsections, and key points for each. " +
            "Include a hook, main body structure, and conclusion strategy.",
        },
        {
          id: "review_outline",
          type: "human_approval",
          message: "Please review the content outline before drafting:\n\n{{steps.create_outline.result}}",
          timeout: 3600,
        },
        {
          id: "write_draft",
          type: "llm_call",
          model: "claude-opus-4-5",
          prompt:
            "Write a complete ${content_type} about '${topic}' following this outline:\n\n" +
            "{{steps.create_outline.result}}\n\n" +
            "Requirements:\n" +
            "- Tone: ${tone}\n" +
            "- Approximate word count: ${word_count}\n" +
            "- Type-specific requirements:\n" +
            "  - blog: engaging intro, subheadings, SEO-friendly\n" +
            "  - tweet_thread: numbered tweets, each ≤280 chars, hooks and CTAs\n" +
            "  - report: executive summary, data-driven, professional\n" +
            "  - email: subject line, scannable format, clear CTA\n" +
            "Write the full draft now.",
        },
        {
          id: "revise",
          type: "llm_call",
          model: "claude-opus-4-5",
          prompt:
            "Revise and polish this ${content_type} draft:\n\n{{steps.write_draft.result}}\n\n" +
            "Improve: clarity, flow, engagement, grammar, and alignment with ${tone} tone.\n" +
            "Ensure it fits ${word_count} words and is ready for publication.",
        },
        {
          id: "finalize",
          type: "transform",
          input: "{{steps.revise.result}}",
          transform:
            "Finalize the ${content_type} content. Add metadata: " +
            "topic='${topic}', tone='${tone}', word_count_target=${word_count}, type='${content_type}'.",
        },
      ] as WorkflowStep[],
    };

    return {
      id: "content_creation",
      name: "Content Creation Pipeline",
      description: "Research-backed content creation: research → outline → human review → draft → revise → finalize",
      category: "content",
      tags: ["content", "writing", "blog", "marketing"],
      estimatedDuration: "10-20 minutes",
      requiredTools: ["web_search"],
      previewSteps: [
        "Research topic and gather background information",
        "Create structured content outline",
        "Human review of outline (approval checkpoint)",
        "Write full draft based on outline",
        "Revise and polish the draft",
        "Finalize with metadata",
      ],
      parameters: [
        { name: "topic", type: "string", description: "Topic or subject of the content", required: true },
        {
          name: "content_type",
          type: "select",
          description: "Type of content to create",
          options: ["blog", "tweet_thread", "report", "email"],
          default: "blog",
          required: false,
        },
        {
          name: "tone",
          type: "string",
          description: "Tone of voice (e.g., professional, casual, educational, persuasive)",
          default: "professional",
          required: false,
        },
        {
          name: "word_count",
          type: "number",
          description: "Target word count",
          default: 800,
          required: false,
        },
      ],
      definition,
    };
  }

  private buildMeetingPrepTemplate(): WorkflowTemplate {
    const definition: WorkflowDefinition = {
      name: "Meeting Preparation",
      version: "1.0",
      description: "Comprehensive meeting prep: research attendees, topic, agenda, questions, and background brief",
      trigger: { type: "manual" },
      steps: [
        {
          id: "research_attendees",
          type: "tool_execute",
          tool: "web_search",
          input: {
            query: "${attendees} professional background company role LinkedIn",
            maxResults: "6",
          },
        },
        {
          id: "research_topic",
          type: "tool_execute",
          tool: "web_search",
          input: {
            query: "${meeting_title} context background recent news 2025",
            maxResults: "6",
          },
        },
        {
          id: "generate_agenda",
          type: "llm_call",
          model: "claude-opus-4-5",
          prompt:
            "Create a professional meeting agenda for:\n" +
            "Meeting: ${meeting_title}\n" +
            "Duration: ${duration_minutes} minutes\n" +
            "Attendees: ${attendees}\n" +
            "Context: ${context}\n\n" +
            "Attendee background: {{steps.research_attendees.result}}\n\n" +
            "Create a time-blocked agenda with: welcome/intros, main topics with time allocations, " +
            "decision points, next steps, and buffer for questions. Total: ${duration_minutes} minutes.",
        },
        {
          id: "prepare_questions",
          type: "llm_call",
          model: "claude-opus-4-5",
          prompt:
            "Prepare strategic questions for the meeting '${meeting_title}' with ${attendees}.\n\n" +
            "Topic research: {{steps.research_topic.result}}\n" +
            "Context: ${context}\n\n" +
            "Generate:\n" +
            "1. 3-5 opening questions to establish common ground\n" +
            "2. 5-7 key discussion questions aligned with meeting goals\n" +
            "3. 3-5 probing follow-up questions\n" +
            "4. 2-3 closing questions to confirm alignment and next steps",
        },
        {
          id: "background_brief",
          type: "llm_call",
          model: "claude-opus-4-5",
          prompt:
            "Create a concise briefing document for '${meeting_title}'.\n\n" +
            "Agenda: {{steps.generate_agenda.result}}\n" +
            "Questions: {{steps.prepare_questions.result}}\n" +
            "Topic research: {{steps.research_topic.result}}\n" +
            "Attendee info: {{steps.research_attendees.result}}\n\n" +
            "Produce a one-page brief with:\n" +
            "## Meeting Overview\n" +
            "## Key Stakeholders\n" +
            "## Agenda\n" +
            "## Preparation Checklist\n" +
            "## Strategic Questions\n" +
            "## Success Criteria",
        },
      ] as WorkflowStep[],
    };

    return {
      id: "meeting_prep",
      name: "Meeting Preparation",
      description: "Prepare thoroughly for any meeting: research attendees and topic, generate agenda, questions, and a briefing document",
      category: "productivity",
      tags: ["meeting", "productivity", "preparation", "agenda"],
      estimatedDuration: "5-8 minutes",
      requiredTools: ["web_search"],
      previewSteps: [
        "Research attendees' backgrounds and roles",
        "Research meeting topic and recent context",
        "Generate time-blocked meeting agenda",
        "Prepare strategic discussion questions",
        "Compile comprehensive briefing document",
      ],
      parameters: [
        { name: "meeting_title", type: "string", description: "Title or subject of the meeting", required: true },
        {
          name: "attendees",
          type: "string",
          description: "Attendee names, roles, or companies (comma-separated)",
          required: true,
        },
        {
          name: "duration_minutes",
          type: "number",
          description: "Meeting duration in minutes",
          default: 60,
          required: false,
        },
        {
          name: "context",
          type: "string",
          description: "Additional context or goals for the meeting",
          default: "General business discussion",
          required: false,
        },
      ],
      definition,
    };
  }
}

export const workflowTemplates = new WorkflowTemplates();
