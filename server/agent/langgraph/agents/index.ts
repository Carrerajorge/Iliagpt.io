import { registerAgent, getAllAgents, getAgent, AGENT_REGISTRY } from "./types";
import { orchestratorAgent, OrchestratorAgent } from "./OrchestratorAgent";
import { researchAgent, ResearchAssistantAgent } from "./ResearchAssistantAgent";
import { codeAgent, CodeAgent } from "./CodeAgent";
import { dataAgent, DataAnalystAgent } from "./DataAnalystAgent";
import { contentAgent, ContentAgent } from "./ContentAgent";
import { communicationAgent, CommunicationAgent } from "./CommunicationAgent";
import { browserAgent, BrowserAgent } from "./BrowserAgent";
import { documentAgent, DocumentAgent } from "./DocumentAgent";
import { qaAgent, QAAgent } from "./QAAgent";
import { securityAgent, SecurityAgent } from "./SecurityAgent";
import { criticAgent, CriticAgent } from "./CriticAgent";

export {
  registerAgent,
  getAllAgents,
  getAgent,
  AGENT_REGISTRY,
};

export {
  OrchestratorAgent,
  orchestratorAgent,
  ResearchAssistantAgent,
  researchAgent,
  CodeAgent,
  codeAgent,
  DataAnalystAgent,
  dataAgent,
  ContentAgent,
  contentAgent,
  CommunicationAgent,
  communicationAgent,
  BrowserAgent,
  browserAgent,
  DocumentAgent,
  documentAgent,
  QAAgent,
  qaAgent,
  SecurityAgent,
  securityAgent,
  CriticAgent,
  criticAgent,
};

export function initializeAgents(): void {
  registerAgent(orchestratorAgent);
  registerAgent(researchAgent);
  registerAgent(codeAgent);
  registerAgent(dataAgent);
  registerAgent(contentAgent);
  registerAgent(communicationAgent);
  registerAgent(browserAgent);
  registerAgent(documentAgent);
  registerAgent(qaAgent);
  registerAgent(securityAgent);
  registerAgent(criticAgent);

  console.log(`[AgentRegistry] Initialized ${AGENT_REGISTRY.size} specialized agents`);
}

export function getAgentsByCapability(capability: string): any[] {
  const agents: any[] = [];
  for (const agent of AGENT_REGISTRY.values()) {
    const capabilities = agent.getCapabilities();
    if (capabilities.some((c: any) => c.name.includes(capability))) {
      agents.push(agent);
    }
  }
  return agents;
}

export function getAgentSummary(): Record<string, any> {
  const summary: Record<string, any> = {};
  for (const [name, agent] of AGENT_REGISTRY.entries()) {
    summary[name] = {
      description: agent.getDescription(),
      state: agent.getState(),
      capabilities: agent.getCapabilities().map((c: any) => c.name),
    };
  }
  return summary;
}

export const SPECIALIZED_AGENTS = [
  {
    name: "OrchestratorAgent",
    description: "Super agent for coordinating multi-agent workflows",
    capabilities: ["plan_execution", "delegate_task", "coordinate_workflow"],
    tools: ["plan", "orchestrate", "decide", "reflect"],
  },
  {
    name: "ResearchAssistantAgent",
    description: "Web research, information gathering, fact-checking",
    capabilities: ["web_search", "deep_research", "fact_check"],
    tools: ["search_web", "research_deep", "fetch_url", "browser_extract"],
  },
  {
    name: "CodeAgent",
    description: "Code generation, review, refactoring, debugging",
    capabilities: ["generate_code", "review_code", "debug_code"],
    tools: ["code_generate", "code_review", "code_refactor", "code_test", "code_debug"],
  },
  {
    name: "DataAnalystAgent",
    description: "Data analysis, transformation, visualization",
    capabilities: ["analyze_data", "transform_data", "visualize_data"],
    tools: ["data_analyze", "data_visualize", "data_transform", "data_query"],
  },
  {
    name: "ContentAgent",
    description: "Content creation, document generation, writing",
    capabilities: ["write_article", "create_document", "create_marketing"],
    tools: ["doc_create", "slides_create", "generate_text"],
  },
  {
    name: "CommunicationAgent",
    description: "Email, notifications, messaging management",
    capabilities: ["compose_email", "create_notification"],
    tools: ["email_send", "notification_push", "message"],
  },
  {
    name: "BrowserAgent",
    description: "Autonomous web browsing and automation",
    capabilities: ["navigate", "scrape", "automate"],
    tools: ["browser_navigate", "browser_interact", "browser_extract", "browser_session", "fetch_url"],
  },
  {
    name: "DocumentAgent",
    description: "Document processing, conversion, analysis",
    capabilities: ["parse_document", "convert_document", "analyze_document"],
    tools: ["doc_create", "pdf_manipulate", "spreadsheet_create", "slides_create", "ocr_extract"],
  },
  {
    name: "QAAgent",
    description: "Testing, validation, quality assurance",
    capabilities: ["generate_tests", "validate", "find_bugs"],
    tools: ["code_test", "code_review", "verify", "health_check"],
  },
  {
    name: "SecurityAgent",
    description: "Security analysis, vulnerability assessment, compliance",
    capabilities: ["vulnerability_scan", "security_audit", "compliance_check"],
    tools: ["encrypt_data", "decrypt_data", "hash_data", "validate_input", "audit_log", "secrets_manage"],
  },
  {
    name: "CriticAgent",
    description: "Rigorous evaluator and verifier. Audits the work of other agents.",
    capabilities: ["verify_output", "fact_check"],
    tools: ["verify_output", "fact_check"],
  },
];

initializeAgents();
