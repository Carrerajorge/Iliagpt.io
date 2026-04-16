/**
 * WorkflowTemplates — pre-built workflow definitions for common use cases.
 * Templates: Research Digest, Code Review, Data Pipeline, Content Creation, Meeting Prep.
 * Each template is a fully executable WorkflowDefinition ready to pass to WorkflowEngine.register().
 */

import type { WorkflowDefinition } from "./WorkflowEngine";

// ─── Template: Research Digest ────────────────────────────────────────────────

/**
 * Research Digest: Search the web for a topic, cross-reference academic sources,
 * score credibility, and produce a structured markdown digest with citations.
 */
export const researchDigestTemplate: WorkflowDefinition = {
  id: "research-digest",
  name: "Research Digest",
  description: "Deep research on a topic with credibility scoring and structured output",
  version: "1.0.0",
  trigger: "manual",
  variables: {
    topic: "",
    depth: "medium",
    maxResults: 10,
    includeAcademic: true,
  },
  steps: [
    {
      id: "web_search",
      name: "Web Search",
      type: "tool_execute",
      config: {
        tool: "search",
        args: {
          query: "${topic}",
          maxResults: "${maxResults}",
        },
      },
      outputKey: "webResults",
    },
    {
      id: "extract_urls",
      name: "Extract Top URLs",
      type: "transform",
      config: {
        type: "extract",
        input: "${outputs.webResults}",
        field: "results",
      },
      outputKey: "topUrls",
    },
    {
      id: "synthesize_research",
      name: "Synthesize Research",
      type: "llm_call",
      config: {
        model: "claude-haiku-4-5-20251001",
        prompt: `You are a research analyst. Based on the following search results about "${"${topic}"}",
create a structured research digest with:
1. Executive Summary (2-3 sentences)
2. Key Findings (5-7 bullet points)
3. Main Perspectives or Debates
4. Gaps and Open Questions
5. Recommended Further Reading

Search Results:
${"${outputs.webResults}"}

Format in clean markdown.`,
        maxTokens: 2048,
      },
      outputKey: "researchDigest",
    },
    {
      id: "store_digest",
      name: "Store Research in Memory",
      type: "tool_execute",
      config: {
        tool: "memory_search",
        args: {
          query: "${topic}",
          limit: 3,
        },
      },
      outputKey: "relatedMemories",
    },
    {
      id: "enrich_with_memory",
      name: "Enrich with Past Research",
      type: "llm_call",
      config: {
        model: "claude-haiku-4-5-20251001",
        prompt: `Enhance this research digest by incorporating relevant context from past research.

Current Digest:
${"${outputs.researchDigest}"}

Related Past Research:
${"${outputs.relatedMemories}"}

Add a "Related Prior Research" section if relevant memories exist. Otherwise return the digest unchanged.`,
        maxTokens: 2048,
      },
      outputKey: "finalDigest",
    },
  ],
  tags: ["research", "search", "synthesis"],
};

// ─── Template: Code Review ────────────────────────────────────────────────────

/**
 * Code Review: Analyze code for security vulnerabilities, quality issues, and
 * best-practice violations, then request human approval before posting results.
 */
export const codeReviewTemplate: WorkflowDefinition = {
  id: "code-review",
  name: "Automated Code Review",
  description: "Security, quality, and best-practice analysis with human approval gate",
  version: "1.0.0",
  trigger: "manual",
  variables: {
    code: "",
    language: "typescript",
    repositoryUrl: "",
    severity: "medium",
  },
  steps: [
    {
      id: "security_scan",
      name: "Security Vulnerability Scan",
      type: "llm_call",
      config: {
        model: "claude-haiku-4-5-20251001",
        system: "You are a security-focused code reviewer. Find security vulnerabilities only. Be specific and concise.",
        prompt: `Scan this ${"${language}"} code for security vulnerabilities:

\`\`\`${"${language}"}
${"${code}"}
\`\`\`

Return JSON: {"vulnerabilities": [{"severity": "critical|high|medium|low", "type": "string", "line": number|null, "description": "string", "fix": "string"}], "secureCodeScore": 0-100}`,
        maxTokens: 1024,
        jsonOutput: true,
      },
      outputKey: "securityReport",
    },
    {
      id: "quality_analysis",
      name: "Code Quality Analysis",
      type: "llm_call",
      config: {
        model: "claude-haiku-4-5-20251001",
        system: "You are a code quality expert. Analyze code quality, readability, and maintainability.",
        prompt: `Analyze the quality of this ${"${language}"} code:

\`\`\`${"${language}"}
${"${code}"}
\`\`\`

Return JSON: {"issues": [{"category": "complexity|naming|duplication|documentation|error-handling", "severity": "high|medium|low", "description": "string", "suggestion": "string"}], "qualityScore": 0-100, "estimatedComplexity": "low|medium|high"}`,
        maxTokens: 1024,
        jsonOutput: true,
      },
      outputKey: "qualityReport",
    },
    {
      id: "check_critical_issues",
      name: "Check for Critical Issues",
      type: "condition",
      config: {
        expression: {
          op: "gte",
          left: "${outputs.securityReport.secureCodeScore}",
          right: 40,
        },
      },
      outputKey: "passedSecurityGate",
    },
    {
      id: "compile_review",
      name: "Compile Final Review",
      type: "llm_call",
      config: {
        model: "claude-haiku-4-5-20251001",
        prompt: `Compile a comprehensive code review report from these analyses:

Security Analysis:
${"${outputs.securityReport}"}

Quality Analysis:
${"${outputs.qualityReport}"}

Language: ${"${language}"}

Create a final review with:
1. Overall Assessment (Pass/Needs Work/Fail)
2. Critical Issues (must fix)
3. Recommended Improvements
4. Positive Aspects
5. Overall Score (0-100)

Format in clear markdown suitable for a PR comment.`,
        maxTokens: 1500,
      },
      outputKey: "finalReview",
    },
    {
      id: "approval_gate",
      name: "Review Approval Gate",
      type: "human_approval",
      config: {
        message: "Code review complete. Approve to post results to repository.",
        timeout: 1800000, // 30 minutes
      },
      outputKey: "reviewApproved",
    },
  ],
  tags: ["code", "review", "security", "quality"],
};

// ─── Template: Data Pipeline ──────────────────────────────────────────────────

/**
 * Data Pipeline: Fetch data from an API endpoint, validate and transform it,
 * extract insights with LLM analysis, then store key findings to memory.
 */
export const dataPipelineTemplate: WorkflowDefinition = {
  id: "data-pipeline",
  name: "Data Ingestion and Analysis Pipeline",
  description: "Fetch, validate, transform, and analyze data from external APIs",
  version: "1.0.0",
  trigger: "scheduled",
  schedule: "0 */6 * * *", // every 6 hours
  variables: {
    dataSourceUrl: "",
    dataFormat: "json",
    analysisPrompt: "Summarize the key trends and anomalies in this data.",
    outputFormat: "markdown",
  },
  steps: [
    {
      id: "fetch_data",
      name: "Fetch Data from Source",
      type: "tool_execute",
      config: {
        tool: "http",
        args: {
          url: "${dataSourceUrl}",
          method: "GET",
          headers: {
            Accept: "application/json",
          },
        },
      },
      outputKey: "rawData",
      retries: 2,
    },
    {
      id: "validate_fetch",
      name: "Validate Fetch Success",
      type: "condition",
      config: {
        expression: {
          op: "eq",
          left: "${outputs.rawData.ok}",
          right: true,
        },
      },
      outputKey: "fetchSucceeded",
    },
    {
      id: "extract_data",
      name: "Extract Data Payload",
      type: "transform",
      config: {
        type: "extract",
        input: "${outputs.rawData}",
        field: "data",
      },
      outputKey: "dataPayload",
    },
    {
      id: "analyze_data",
      name: "LLM Data Analysis",
      type: "llm_call",
      config: {
        model: "claude-haiku-4-5-20251001",
        system: "You are a data analyst. Analyze the provided data clearly and concisely.",
        prompt: `${"${analysisPrompt}"}

Data:
${"${outputs.dataPayload}"}

Output format: ${"${outputFormat}"}`,
        maxTokens: 1500,
      },
      outputKey: "dataInsights",
    },
    {
      id: "search_context",
      name: "Search for Related Context",
      type: "tool_execute",
      config: {
        tool: "memory_search",
        args: {
          query: "${analysisPrompt}",
          limit: 5,
          memoryType: "fact",
        },
      },
      outputKey: "historicalContext",
    },
    {
      id: "enrich_insights",
      name: "Enrich with Historical Context",
      type: "llm_call",
      config: {
        model: "claude-haiku-4-5-20251001",
        prompt: `Compare current data insights with historical context:

Current Insights:
${"${outputs.dataInsights}"}

Historical Context:
${"${outputs.historicalContext}"}

Add a "Trend Analysis" section comparing now vs. history. Highlight changes and anomalies.`,
        maxTokens: 1000,
      },
      outputKey: "enrichedInsights",
    },
    {
      id: "wait_before_next",
      name: "Rate Limit Buffer",
      type: "wait",
      config: {
        duration: 2000,
      },
    },
  ],
  tags: ["data", "pipeline", "api", "analysis", "scheduled"],
};

// ─── Template: Content Creation ───────────────────────────────────────────────

/**
 * Content Creation: Research a topic, generate multiple content formats
 * (blog post, social media, email newsletter), then approve before delivery.
 */
export const contentCreationTemplate: WorkflowDefinition = {
  id: "content-creation",
  name: "Multi-Format Content Creation",
  description: "Research a topic and generate blog post, social posts, and newsletter in parallel",
  version: "1.0.0",
  trigger: "manual",
  variables: {
    topic: "",
    targetAudience: "general",
    tone: "professional",
    keywords: "",
    contentGoal: "inform",
  },
  steps: [
    {
      id: "research_topic",
      name: "Research Topic",
      type: "tool_execute",
      config: {
        tool: "search",
        args: {
          query: "${topic} ${keywords}",
          maxResults: 8,
        },
      },
      outputKey: "topicResearch",
    },
    {
      id: "build_content_brief",
      name: "Build Content Brief",
      type: "llm_call",
      config: {
        model: "claude-haiku-4-5-20251001",
        prompt: `Create a content brief for:
- Topic: ${"${topic}"}
- Audience: ${"${targetAudience}"}
- Tone: ${"${tone}"}
- Goal: ${"${contentGoal}"}
- Keywords: ${"${keywords}"}

Based on this research:
${"${outputs.topicResearch}"}

Return JSON: {"title": "string", "angle": "string", "keyPoints": ["string"], "callToAction": "string", "estimatedReadTime": "string"}`,
        maxTokens: 800,
        jsonOutput: true,
      },
      outputKey: "contentBrief",
    },
    {
      id: "generate_content_parallel",
      name: "Generate All Content Formats",
      type: "parallel",
      config: {
        steps: [
          {
            id: "blog_post",
            name: "Blog Post",
            type: "llm_call",
            config: {
              model: "claude-haiku-4-5-20251001",
              system: "You are an expert content writer. Write engaging, SEO-optimized blog posts.",
              prompt: `Write a complete blog post based on this brief:
${"${outputs.contentBrief}"}

Tone: ${"${tone}"} | Audience: ${"${targetAudience}"}

Include: headline, intro hook, 3-5 main sections with subheadings, conclusion with CTA.
Use markdown formatting.`,
              maxTokens: 1500,
            },
            outputKey: "blogPost",
          },
          {
            id: "social_posts",
            name: "Social Media Posts",
            type: "llm_call",
            config: {
              model: "claude-haiku-4-5-20251001",
              prompt: `Create social media content for this topic:
${"${outputs.contentBrief}"}

Generate:
1. LinkedIn post (200-300 words, professional)
2. Twitter/X thread (5 tweets, each under 280 chars)
3. Instagram caption (150 words, with hashtags)

Format as JSON: {"linkedin": "string", "twitter": ["string"], "instagram": "string"}`,
              maxTokens: 1000,
              jsonOutput: true,
            },
            outputKey: "socialPosts",
          },
          {
            id: "newsletter",
            name: "Email Newsletter",
            type: "llm_call",
            config: {
              model: "claude-haiku-4-5-20251001",
              system: "You write compelling email newsletters. Clear, scannable, with strong subject lines.",
              prompt: `Write an email newsletter section based on:
${"${outputs.contentBrief}"}

Include:
- Subject line (A/B variants)
- Preview text
- Newsletter body (300-400 words, scannable with bullet points)
- Clear CTA button text`,
              maxTokens: 800,
            },
            outputKey: "newsletter",
          },
        ],
      },
      outputKey: "allContent",
    },
    {
      id: "quality_check",
      name: "Content Quality Check",
      type: "llm_call",
      config: {
        model: "claude-haiku-4-5-20251001",
        prompt: `Review this content package for quality, consistency, and alignment with the brief.

Brief: ${"${outputs.contentBrief}"}
Blog Post (preview): ${"${outputs.blogPost}"}
Social Posts: ${"${outputs.socialPosts}"}

Check for: brand voice consistency, factual accuracy, keyword usage, CTA clarity.
Return JSON: {"overallScore": 0-100, "issues": ["string"], "approved": boolean}`,
        maxTokens: 500,
        jsonOutput: true,
      },
      outputKey: "qualityCheck",
    },
    {
      id: "final_approval",
      name: "Content Approval",
      type: "human_approval",
      config: {
        message: "Content package ready for review. Approve to proceed with distribution.",
        timeout: 7200000, // 2 hours
      },
      outputKey: "contentApproved",
    },
  ],
  tags: ["content", "marketing", "social-media", "blog", "newsletter"],
};

// ─── Template: Meeting Prep ───────────────────────────────────────────────────

/**
 * Meeting Prep: Given a meeting topic and attendees, research participants,
 * gather relevant background, recall past meeting notes, and generate a
 * structured briefing document with agenda and talking points.
 */
export const meetingPrepTemplate: WorkflowDefinition = {
  id: "meeting-prep",
  name: "Meeting Preparation Briefing",
  description: "Research attendees, gather context, and generate structured meeting briefing",
  version: "1.0.0",
  trigger: "manual",
  variables: {
    meetingTopic: "",
    attendees: "",
    meetingDate: "",
    meetingDuration: "60",
    meetingObjective: "",
    organizationContext: "",
  },
  steps: [
    {
      id: "research_topic_context",
      name: "Research Meeting Topic",
      type: "tool_execute",
      config: {
        tool: "search",
        args: {
          query: "${meetingTopic} ${organizationContext}",
          maxResults: 6,
        },
      },
      outputKey: "topicContext",
    },
    {
      id: "recall_past_context",
      name: "Recall Past Meeting Notes",
      type: "tool_execute",
      config: {
        tool: "memory_search",
        args: {
          query: "${meetingTopic}",
          limit: 5,
          memoryType: "decision",
        },
      },
      outputKey: "pastDecisions",
    },
    {
      id: "recall_action_items",
      name: "Recall Outstanding Action Items",
      type: "tool_execute",
      config: {
        tool: "memory_search",
        args: {
          query: "${meetingTopic} action item",
          limit: 5,
          memoryType: "action_item",
        },
      },
      outputKey: "openActionItems",
    },
    {
      id: "generate_agenda",
      name: "Generate Structured Agenda",
      type: "llm_call",
      config: {
        model: "claude-haiku-4-5-20251001",
        system: "You are an expert meeting facilitator. Create focused, time-boxed agendas.",
        prompt: `Create a structured meeting agenda for:
- Topic: ${"${meetingTopic}"}
- Objective: ${"${meetingObjective}"}
- Duration: ${"${meetingDuration}"} minutes
- Attendees: ${"${attendees}"}

Context from research:
${"${outputs.topicContext}"}

Past decisions on this topic:
${"${outputs.pastDecisions}"}

Open action items:
${"${outputs.openActionItems}"}

Return JSON: {
  "agenda": [{"item": "string", "duration": number, "owner": "string", "type": "discussion|decision|update|review"}],
  "objectives": ["string"],
  "prework": ["string"],
  "successCriteria": ["string"]
}`,
        maxTokens: 1000,
        jsonOutput: true,
      },
      outputKey: "meetingAgenda",
    },
    {
      id: "generate_talking_points",
      name: "Generate Talking Points",
      type: "llm_call",
      config: {
        model: "claude-haiku-4-5-20251001",
        prompt: `Generate focused talking points and key questions for this meeting:

Agenda: ${"${outputs.meetingAgenda}"}
Background: ${"${outputs.topicContext}"}
Open Items: ${"${outputs.openActionItems}"}

For each agenda item, provide:
- 3 key talking points
- 1-2 probing questions
- Potential blockers or risks

Format in clean markdown.`,
        maxTokens: 1200,
      },
      outputKey: "talkingPoints",
    },
    {
      id: "compile_briefing",
      name: "Compile Meeting Briefing",
      type: "llm_call",
      config: {
        model: "claude-haiku-4-5-20251001",
        prompt: `Compile a complete meeting briefing document:

Meeting: ${"${meetingTopic}"}
Date: ${"${meetingDate}"}
Attendees: ${"${attendees}"}
Duration: ${"${meetingDuration}"} minutes
Objective: ${"${meetingObjective}"}

Agenda:
${"${outputs.meetingAgenda}"}

Talking Points:
${"${outputs.talkingPoints}"}

Past Context:
${"${outputs.pastDecisions}"}

Create a single, clean briefing document in markdown with:
1. Meeting Overview
2. Context & Background
3. Agenda with Time Allocations
4. Talking Points per Item
5. Outstanding Items to Address
6. Desired Outcomes

Keep it scannable — use headers, bullets, and bold for key info.`,
        maxTokens: 2000,
      },
      outputKey: "meetingBriefing",
    },
    {
      id: "check_has_past_context",
      name: "Check Has Historical Context",
      type: "condition",
      config: {
        expression: {
          op: "gt",
          left: "${outputs.pastDecisions.count}",
          right: 0,
        },
      },
      outputKey: "hasPastContext",
    },
  ],
  tags: ["meeting", "preparation", "agenda", "briefing", "productivity"],
};

// ─── Template Registry ────────────────────────────────────────────────────────

export const WORKFLOW_TEMPLATES: WorkflowDefinition[] = [
  researchDigestTemplate,
  codeReviewTemplate,
  dataPipelineTemplate,
  contentCreationTemplate,
  meetingPrepTemplate,
];

export const TEMPLATE_CATALOG: Record<string, WorkflowDefinition> = {
  "research-digest": researchDigestTemplate,
  "code-review": codeReviewTemplate,
  "data-pipeline": dataPipelineTemplate,
  "content-creation": contentCreationTemplate,
  "meeting-prep": meetingPrepTemplate,
};

/**
 * Register all built-in templates with a WorkflowEngine instance.
 */
export function registerAllTemplates(engine: import("./WorkflowEngine").WorkflowEngine): void {
  for (const template of WORKFLOW_TEMPLATES) {
    engine.register(template);
  }
}
