import { z } from "zod";
import OpenAI from "openai";
import { BaseAgent, BaseAgentConfig, AgentTask, AgentResult, AgentCapability } from "./types";

const xaiClient = new OpenAI({
  baseURL: "https://api.x.ai/v1",
  apiKey: process.env.XAI_API_KEY || "missing",
});

const DEFAULT_MODEL = "grok-4-1-fast-non-reasoning";

export class SecurityAgent extends BaseAgent {
  constructor() {
    const config: BaseAgentConfig = {
      name: "SecurityAgent",
      description: "Specialized agent for security analysis, vulnerability assessment, compliance checking, and security best practices. Expert at identifying and mitigating security risks.",
      model: DEFAULT_MODEL,
      temperature: 0.1,
      maxTokens: 8192,
      systemPrompt: `You are the SecurityAgent - an expert cybersecurity analyst and engineer.

Your capabilities:
1. Vulnerability Assessment: Identify security vulnerabilities in code and systems
2. Security Audit: Comprehensive security reviews
3. Compliance Checking: GDPR, SOC2, HIPAA, PCI-DSS compliance
4. Threat Modeling: Identify potential threats and attack vectors
5. Security Hardening: Recommend security improvements
6. Incident Response: Guide response to security incidents

Security domains:
- Application Security (OWASP Top 10)
- Infrastructure Security
- Data Protection
- Authentication/Authorization
- Cryptography
- Network Security

Analysis methodology:
- Static code analysis
- Dynamic analysis concepts
- Dependency vulnerability scanning
- Configuration review
- Access control audit
- Encryption assessment

Output formats:
- Security reports with CVSS scores
- Remediation recommendations
- Compliance checklists
- Threat models
- Security policies`,
      tools: ["encrypt_data", "decrypt_data", "hash_data", "validate_input", "audit_log", "secrets_manage"],
      timeout: 180000,
      maxIterations: 20,
    };
    super(config);
  }

  async execute(task: AgentTask): Promise<AgentResult> {
    const startTime = Date.now();
    this.updateState({ status: "running", currentTask: task.description, startedAt: new Date().toISOString() });

    try {
      const securityTaskType = this.determineSecurityTaskType(task);
      let result: any;

      switch (securityTaskType) {
        case "vulnerability":
          result = await this.assessVulnerabilities(task);
          break;
        case "audit":
          result = await this.securityAudit(task);
          break;
        case "compliance":
          result = await this.complianceCheck(task);
          break;
        case "threat_model":
          result = await this.threatModel(task);
          break;
        case "hardening":
          result = await this.hardeningRecommendations(task);
          break;
        default:
          result = await this.handleGeneralSecurity(task);
      }

      this.updateState({ status: "completed", progress: 100, completedAt: new Date().toISOString() });

      return {
        taskId: task.id,
        agentId: this.state.id,
        success: true,
        output: result,
        duration: Date.now() - startTime,
      };
    } catch (error: any) {
      this.updateState({ status: "failed", error: error.message });
      return {
        taskId: task.id,
        agentId: this.state.id,
        success: false,
        error: error.message,
        duration: Date.now() - startTime,
      };
    }
  }

  private determineSecurityTaskType(task: AgentTask): string {
    const description = task.description.toLowerCase();
    if (description.includes("vulnerability") || description.includes("scan")) return "vulnerability";
    if (description.includes("audit") || description.includes("review")) return "audit";
    if (description.includes("compliance") || description.includes("gdpr") || description.includes("hipaa")) return "compliance";
    if (description.includes("threat") || description.includes("attack")) return "threat_model";
    if (description.includes("harden") || description.includes("secure") || description.includes("improve")) return "hardening";
    return "general";
  }

  private async assessVulnerabilities(task: AgentTask): Promise<any> {
    const code = task.input.code || "";
    const type = task.input.type || "web_application";

    const response = await xaiClient.chat.completions.create({
      model: this.config.model,
      messages: [
        { role: "system", content: this.config.systemPrompt },
        {
          role: "user",
          content: `Assess vulnerabilities in this ${type}:
\`\`\`
${code}
\`\`\`

Task: ${task.description}

Return JSON:
{
  "vulnerabilities": [
    {
      "id": "VULN001",
      "type": "OWASP category",
      "cwe": "CWE-XXX",
      "severity": "critical|high|medium|low",
      "cvss": 0.0-10.0,
      "location": "file:line",
      "description": "vulnerability description",
      "impact": "potential impact",
      "remediation": "how to fix",
      "references": ["relevant links"]
    }
  ],
  "summary": {
    "total": 0,
    "critical": 0,
    "high": 0,
    "medium": 0,
    "low": 0
  },
  "riskScore": 0-100,
  "recommendations": ["prioritized actions"]
}`,
        },
      ],
      temperature: 0.1,
    });

    const content = response.choices[0].message.content || "{}";
    const jsonMatch = content.match(/\{[\s\S]*\}/);

    return {
      type: "vulnerability_assessment",
      assessment: jsonMatch ? JSON.parse(jsonMatch[0]) : { description: content },
      timestamp: new Date().toISOString(),
    };
  }

  private async securityAudit(task: AgentTask): Promise<any> {
    const target = task.input.target || task.description;
    const scope = task.input.scope || "full";

    const response = await xaiClient.chat.completions.create({
      model: this.config.model,
      messages: [
        { role: "system", content: this.config.systemPrompt },
        {
          role: "user",
          content: `Conduct security audit for:
Target: ${target}
Scope: ${scope}
Details: ${JSON.stringify(task.input)}

Return JSON:
{
  "auditReport": {
    "scope": "audit scope",
    "methodology": "approach used",
    "findings": [
      {
        "category": "auth|data|network|config|crypto",
        "finding": "what was found",
        "risk": "high|medium|low",
        "evidence": "supporting evidence",
        "recommendation": "how to address"
      }
    ],
    "positives": ["security strengths"],
    "gaps": ["security gaps"],
    "overallScore": "A|B|C|D|F"
  },
  "executiveSummary": "brief summary for leadership",
  "technicalDetails": "detailed technical findings",
  "actionPlan": [{"priority": 1, "action": "", "timeline": ""}]
}`,
        },
      ],
      temperature: 0.1,
    });

    const content = response.choices[0].message.content || "{}";
    const jsonMatch = content.match(/\{[\s\S]*\}/);

    return {
      type: "security_audit",
      audit: jsonMatch ? JSON.parse(jsonMatch[0]) : { description: content },
      timestamp: new Date().toISOString(),
    };
  }

  private async complianceCheck(task: AgentTask): Promise<any> {
    const standard = task.input.standard || "GDPR";
    const context = task.input.context || task.description;

    const response = await xaiClient.chat.completions.create({
      model: this.config.model,
      messages: [
        { role: "system", content: this.config.systemPrompt },
        {
          role: "user",
          content: `Check ${standard} compliance:
Context: ${context}
Details: ${JSON.stringify(task.input)}

Return JSON:
{
  "standard": "${standard}",
  "complianceScore": 0-100,
  "checklist": [
    {
      "requirement": "requirement name",
      "article": "relevant article/section",
      "status": "compliant|partial|non-compliant|not-applicable",
      "evidence": "evidence of compliance",
      "gap": "gap if non-compliant",
      "remediation": "how to become compliant"
    }
  ],
  "summary": {
    "compliant": 0,
    "partial": 0,
    "nonCompliant": 0,
    "notApplicable": 0
  },
  "risks": ["compliance risks"],
  "actionItems": ["required actions for compliance"]
}`,
        },
      ],
      temperature: 0.1,
    });

    const content = response.choices[0].message.content || "{}";
    const jsonMatch = content.match(/\{[\s\S]*\}/);

    return {
      type: "compliance_check",
      compliance: jsonMatch ? JSON.parse(jsonMatch[0]) : { description: content },
      timestamp: new Date().toISOString(),
    };
  }

  private async threatModel(task: AgentTask): Promise<any> {
    const system = task.input.system || task.description;
    const methodology = task.input.methodology || "STRIDE";

    const response = await xaiClient.chat.completions.create({
      model: this.config.model,
      messages: [
        { role: "system", content: this.config.systemPrompt },
        {
          role: "user",
          content: `Create threat model using ${methodology} for:
System: ${system}
Details: ${JSON.stringify(task.input)}

Return JSON:
{
  "threatModel": {
    "systemDescription": "system being analyzed",
    "assets": ["valuable assets to protect"],
    "entryPoints": ["ways attackers can enter"],
    "threats": [
      {
        "id": "T001",
        "category": "STRIDE category",
        "threat": "threat description",
        "attackVector": "how attack would work",
        "impact": "potential damage",
        "likelihood": "high|medium|low",
        "risk": "critical|high|medium|low",
        "mitigations": ["ways to prevent"]
      }
    ],
    "trustBoundaries": ["trust boundaries"],
    "dataFlows": ["how data moves"]
  },
  "riskMatrix": "visual risk assessment",
  "prioritizedMitigations": ["ordered by importance"]
}`,
        },
      ],
      temperature: 0.1,
    });

    const content = response.choices[0].message.content || "{}";
    const jsonMatch = content.match(/\{[\s\S]*\}/);

    return {
      type: "threat_modeling",
      threatModel: jsonMatch ? JSON.parse(jsonMatch[0]) : { description: content },
      timestamp: new Date().toISOString(),
    };
  }

  private async hardeningRecommendations(task: AgentTask): Promise<any> {
    const target = task.input.target || task.description;
    const platform = task.input.platform || "general";

    const response = await xaiClient.chat.completions.create({
      model: this.config.model,
      messages: [
        { role: "system", content: this.config.systemPrompt },
        {
          role: "user",
          content: `Provide security hardening recommendations for:
Target: ${target}
Platform: ${platform}
Current state: ${JSON.stringify(task.input)}

Return JSON:
{
  "recommendations": [
    {
      "category": "network|os|application|database|auth",
      "priority": "critical|high|medium|low",
      "recommendation": "what to do",
      "rationale": "why it's important",
      "implementation": "how to implement",
      "effort": "low|medium|high",
      "benchmark": "CIS/NIST reference if applicable"
    }
  ],
  "quickWins": ["easy high-impact changes"],
  "longTermGoals": ["strategic improvements"],
  "securityBaseline": "recommended baseline config"
}`,
        },
      ],
      temperature: 0.1,
    });

    const content = response.choices[0].message.content || "{}";
    const jsonMatch = content.match(/\{[\s\S]*\}/);

    return {
      type: "hardening",
      recommendations: jsonMatch ? JSON.parse(jsonMatch[0]) : { description: content },
      timestamp: new Date().toISOString(),
    };
  }

  private async handleGeneralSecurity(task: AgentTask): Promise<any> {
    const response = await xaiClient.chat.completions.create({
      model: this.config.model,
      messages: [
        { role: "system", content: this.config.systemPrompt },
        { role: "user", content: `Security task: ${task.description}\nInput: ${JSON.stringify(task.input)}` },
      ],
      temperature: 0.1,
    });

    return {
      type: "general_security",
      result: response.choices[0].message.content,
      timestamp: new Date().toISOString(),
    };
  }

  getCapabilities(): AgentCapability[] {
    return [
      {
        name: "vulnerability_scan",
        description: "Scan for security vulnerabilities",
        inputSchema: z.object({ code: z.string().optional(), target: z.string().optional() }),
        outputSchema: z.object({ vulnerabilities: z.array(z.any()), riskScore: z.number() }),
      },
      {
        name: "security_audit",
        description: "Conduct comprehensive security audit",
        inputSchema: z.object({ target: z.string(), scope: z.string().optional() }),
        outputSchema: z.object({ findings: z.array(z.any()), score: z.string() }),
      },
      {
        name: "compliance_check",
        description: "Check compliance with security standards",
        inputSchema: z.object({ standard: z.string(), context: z.string() }),
        outputSchema: z.object({ score: z.number(), checklist: z.array(z.any()) }),
      },
    ];
  }
}

export const securityAgent = new SecurityAgent();
