/**
 * ILIAGPT Multi-Agent Router
 * 
 * Sistema de enrutamiento multi-agente inspirado en OpenClaw.
 * Permite crear y gestionar múltiples agentes especializados.
 */

import { EventEmitter } from 'events';
import { nanoid } from 'nanoid';

// Agent Types
export interface Agent {
  id: string;
  name: string;
  description: string;
  systemPrompt: string;
  model: string;
  tools: string[];
  capabilities: string[];
  settings: AgentSettings;
  status: 'active' | 'idle' | 'busy' | 'offline';
  stats: AgentStats;
  createdAt: Date;
  updatedAt: Date;
}

export interface AgentSettings {
  temperature: number;
  maxTokens: number;
  topP: number;
  streaming: boolean;
  memory: boolean;
  webSearch: boolean;
  codeExecution: boolean;
}

export interface AgentStats {
  messagesProcessed: number;
  tokensUsed: number;
  averageResponseTime: number;
  successRate: number;
  lastActive: Date | null;
}

// Pre-configured Agent Templates
export const AGENT_TEMPLATES: Record<string, Omit<Agent, 'id' | 'stats' | 'createdAt' | 'updatedAt'>> = {
  coder: {
    name: 'Code Master',
    description: 'Experto en programación y desarrollo de software',
    systemPrompt: `Eres un experto programador senior con décadas de experiencia. 
Dominas múltiples lenguajes: Python, JavaScript, TypeScript, Go, Rust, Java, C++.
Siempre escribes código limpio, bien documentado y siguiendo mejores prácticas.
Cuando se te pide código, lo proporcionas completo y funcional.
Explicas tu razonamiento y sugieres mejoras.`,
    model: 'gemini-2.5-flash',
    tools: ['shell', 'file', 'python', 'webdev_init_project'],
    capabilities: ['code-execution', 'file-operations', 'shell', 'debugging'],
    settings: {
      temperature: 0.3,
      maxTokens: 8192,
      topP: 0.95,
      streaming: true,
      memory: true,
      webSearch: false,
      codeExecution: true
    },
    status: 'active'
  },
  researcher: {
    name: 'Deep Researcher',
    description: 'Investigador profundo con acceso a la web',
    systemPrompt: `Eres un investigador académico experto.
Tu trabajo es buscar información precisa y actualizada.
Siempre citas tus fuentes y verificas la información.
Proporcionas análisis profundos y bien estructurados.
Diferencias entre hechos y opiniones.`,
    model: 'gemini-2.5-flash',
    tools: ['search', 'browser', 'research'],
    capabilities: ['web-search', 'deep-research', 'fact-checking'],
    settings: {
      temperature: 0.5,
      maxTokens: 4096,
      topP: 0.9,
      streaming: true,
      memory: true,
      webSearch: true,
      codeExecution: false
    },
    status: 'active'
  },
  writer: {
    name: 'Creative Writer',
    description: 'Escritor creativo para contenido y narrativas',
    systemPrompt: `Eres un escritor creativo talentoso.
Dominas múltiples estilos: narrativa, poesía, guiones, artículos, copywriting.
Tu prosa es cautivadora y tu creatividad ilimitada.
Adaptas tu estilo al público objetivo.
Siempre entregas contenido original y de alta calidad.`,
    model: 'gemini-2.5-flash',
    tools: ['document', 'generate'],
    capabilities: ['creative-writing', 'content-creation', 'storytelling'],
    settings: {
      temperature: 0.8,
      maxTokens: 4096,
      topP: 0.95,
      streaming: true,
      memory: true,
      webSearch: false,
      codeExecution: false
    },
    status: 'active'
  },
  analyst: {
    name: 'Data Analyst',
    description: 'Analista de datos y visualización',
    systemPrompt: `Eres un analista de datos senior experto.
Dominas Excel, SQL, Python para análisis, y visualización de datos.
Transformas datos crudos en insights accionables.
Creas reportes claros y visualizaciones efectivas.
Identificas patrones, tendencias y anomalías.`,
    model: 'gemini-2.5-flash',
    tools: ['python', 'file', 'document'],
    capabilities: ['data-analysis', 'excel', 'visualization', 'reporting'],
    settings: {
      temperature: 0.3,
      maxTokens: 4096,
      topP: 0.9,
      streaming: true,
      memory: true,
      webSearch: false,
      codeExecution: true
    },
    status: 'active'
  },
  assistant: {
    name: 'Personal Assistant',
    description: 'Asistente personal para tareas diarias',
    systemPrompt: `Eres un asistente personal altamente eficiente.
Ayudas con organización, recordatorios, emails y tareas diarias.
Eres proactivo y anticipas las necesidades del usuario.
Mantienes un tono profesional pero amigable.
Priorizar y organizar tareas es tu especialidad.`,
    model: 'gemini-2.5-flash',
    tools: ['message', 'schedule', 'document'],
    capabilities: ['task-management', 'scheduling', 'email-drafting'],
    settings: {
      temperature: 0.5,
      maxTokens: 2048,
      topP: 0.9,
      streaming: true,
      memory: true,
      webSearch: true,
      codeExecution: false
    },
    status: 'active'
  },
  teacher: {
    name: 'Learning Tutor',
    description: 'Tutor educativo para aprendizaje personalizado',
    systemPrompt: `Eres un tutor educativo experto y paciente.
Explicas conceptos complejos de forma simple y clara.
Adaptas tu estilo de enseñanza al nivel del estudiante.
Usas ejemplos prácticos y analogías efectivas.
Fomentas el pensamiento crítico y la curiosidad.`,
    model: 'gemini-2.5-flash',
    tools: ['search', 'document', 'generate'],
    capabilities: ['teaching', 'explanation', 'learning-support'],
    settings: {
      temperature: 0.6,
      maxTokens: 4096,
      topP: 0.9,
      streaming: true,
      memory: true,
      webSearch: true,
      codeExecution: false
    },
    status: 'active'
  }
};

// Agent Manager
export class AgentManager extends EventEmitter {
  private agents: Map<string, Agent> = new Map();
  private activeAgentId: string | null = null;
  
  constructor() {
    super();
    this.initializeDefaultAgents();
  }
  
  private initializeDefaultAgents() {
    // Create default agents from templates
    Object.entries(AGENT_TEMPLATES).forEach(([key, template]) => {
      const agent: Agent = {
        ...template,
        id: key,
        stats: this.createEmptyStats(),
        createdAt: new Date(),
        updatedAt: new Date()
      };
      this.agents.set(key, agent);
    });
    
    // Set default active agent
    this.activeAgentId = 'assistant';
  }
  
  private createEmptyStats(): AgentStats {
    return {
      messagesProcessed: 0,
      tokensUsed: 0,
      averageResponseTime: 0,
      successRate: 100,
      lastActive: null
    };
  }
  
  // Get all agents
  getAgents(): Agent[] {
    return Array.from(this.agents.values());
  }
  
  // Get agent by ID
  getAgent(id: string): Agent | null {
    return this.agents.get(id) || null;
  }
  
  // Get active agent
  getActiveAgent(): Agent | null {
    if (!this.activeAgentId) return null;
    return this.agents.get(this.activeAgentId) || null;
  }
  
  // Set active agent
  setActiveAgent(id: string): Agent | null {
    const agent = this.agents.get(id);
    if (!agent) return null;
    
    this.activeAgentId = id;
    this.emit('agent:activated', { agentId: id, agent });
    return agent;
  }
  
  // Create custom agent
  createAgent(config: Partial<Agent> & { name: string; systemPrompt: string }): Agent {
    const id = nanoid(12);
    const agent: Agent = {
      id,
      name: config.name,
      description: config.description || '',
      systemPrompt: config.systemPrompt,
      model: config.model || 'gemini-2.5-flash',
      tools: config.tools || [],
      capabilities: config.capabilities || [],
      settings: config.settings || {
        temperature: 0.7,
        maxTokens: 4096,
        topP: 0.9,
        streaming: true,
        memory: true,
        webSearch: false,
        codeExecution: false
      },
      status: 'active',
      stats: this.createEmptyStats(),
      createdAt: new Date(),
      updatedAt: new Date()
    };
    
    this.agents.set(id, agent);
    this.emit('agent:created', { agentId: id, agent });
    return agent;
  }
  
  // Update agent
  updateAgent(id: string, updates: Partial<Agent>): Agent | null {
    const agent = this.agents.get(id);
    if (!agent) return null;
    
    const updated: Agent = {
      ...agent,
      ...updates,
      id, // Preserve ID
      updatedAt: new Date()
    };
    
    this.agents.set(id, updated);
    this.emit('agent:updated', { agentId: id, agent: updated });
    return updated;
  }
  
  // Delete agent (only custom agents)
  deleteAgent(id: string): boolean {
    // Don't allow deleting default agents
    if (AGENT_TEMPLATES[id]) {
      return false;
    }
    
    const deleted = this.agents.delete(id);
    if (deleted) {
      this.emit('agent:deleted', { agentId: id });
      
      // If deleted agent was active, switch to default
      if (this.activeAgentId === id) {
        this.activeAgentId = 'assistant';
      }
    }
    return deleted;
  }
  
  // Record agent usage
  recordUsage(id: string, tokens: number, responseTimeMs: number, success: boolean) {
    const agent = this.agents.get(id);
    if (!agent) return;
    
    const stats = agent.stats;
    const totalMessages = stats.messagesProcessed + 1;
    
    stats.messagesProcessed = totalMessages;
    stats.tokensUsed += tokens;
    stats.averageResponseTime = (stats.averageResponseTime * (totalMessages - 1) + responseTimeMs) / totalMessages;
    stats.successRate = ((stats.successRate * (totalMessages - 1)) + (success ? 100 : 0)) / totalMessages;
    stats.lastActive = new Date();
    
    agent.status = 'active';
    this.emit('agent:usage', { agentId: id, stats });
  }
  
  // Get agent recommendations based on query
  recommendAgent(query: string): Agent | null {
    const lowerQuery = query.toLowerCase();
    
    // Check for code-related queries
    if (/\b(código|code|programar|script|función|class|debug|error|bug)\b/i.test(lowerQuery)) {
      return this.getAgent('coder');
    }
    
    // Check for research queries
    if (/\b(busca|investiga|research|información|qué es|cuál es|cómo funciona)\b/i.test(lowerQuery)) {
      return this.getAgent('researcher');
    }
    
    // Check for writing queries
    if (/\b(escribe|redacta|historia|poema|artículo|blog|contenido|creative)\b/i.test(lowerQuery)) {
      return this.getAgent('writer');
    }
    
    // Check for data/analysis queries
    if (/\b(analiza|datos|excel|gráfico|tabla|estadística|reporte|dashboard)\b/i.test(lowerQuery)) {
      return this.getAgent('analyst');
    }
    
    // Check for learning queries
    if (/\b(explica|enseña|aprende|estudia|tutorial|lección|curso)\b/i.test(lowerQuery)) {
      return this.getAgent('teacher');
    }
    
    // Default to assistant
    return this.getAgent('assistant');
  }
}

// Singleton instance
export const agentManager = new AgentManager();

// Get agent for request (with auto-recommendation)
export function getAgentForRequest(query: string, preferredAgentId?: string): Agent {
  // If preferred agent specified and exists, use it
  if (preferredAgentId) {
    const preferred = agentManager.getAgent(preferredAgentId);
    if (preferred) return preferred;
  }
  
  // Try to recommend based on query
  const recommended = agentManager.recommendAgent(query);
  if (recommended) return recommended;
  
  // Fall back to active agent or default
  return agentManager.getActiveAgent() || agentManager.getAgent('assistant')!;
}
