/**
 * ILIAGPT Multi-Agent Router API
 */

import { Router, Request, Response } from 'express';
import { agentManager, AGENT_TEMPLATES, getAgentForRequest } from '../services/agentManager';

export const multiAgentRouter = Router();

// Get all available agents
multiAgentRouter.get('/list', (req: Request, res: Response) => {
  try {
    const agents = agentManager.getAgents().map(agent => ({
      id: agent.id,
      name: agent.name,
      description: agent.description,
      capabilities: agent.capabilities,
      status: agent.status,
      isDefault: !!AGENT_TEMPLATES[agent.id],
      stats: {
        messagesProcessed: agent.stats.messagesProcessed,
        successRate: agent.stats.successRate.toFixed(1) + '%',
        lastActive: agent.stats.lastActive?.toISOString() || null
      }
    }));
    
    res.json({
      agents,
      activeAgentId: agentManager.getActiveAgent()?.id || null,
      total: agents.length
    });
  } catch (error) {
    console.error('[Agents] List error:', error);
    res.status(500).json({ error: 'Failed to list agents' });
  }
});

// Get single agent details
multiAgentRouter.get('/:id', (req: Request, res: Response) => {
  try {
    const agent = agentManager.getAgent(req.params.id);
    if (!agent) {
      return res.status(404).json({ error: 'Agent not found' });
    }
    
    res.json({
      ...agent,
      isDefault: !!AGENT_TEMPLATES[agent.id]
    });
  } catch (error) {
    console.error('[Agents] Get error:', error);
    res.status(500).json({ error: 'Failed to get agent' });
  }
});

// Get active agent
multiAgentRouter.get('/active/current', (req: Request, res: Response) => {
  try {
    const agent = agentManager.getActiveAgent();
    res.json({
      agent: agent || null,
      id: agent?.id || null
    });
  } catch (error) {
    console.error('[Agents] Active agent error:', error);
    res.status(500).json({ error: 'Failed to get active agent' });
  }
});

// Set active agent
multiAgentRouter.post('/active/:id', (req: Request, res: Response) => {
  try {
    const agent = agentManager.setActiveAgent(req.params.id);
    if (!agent) {
      return res.status(404).json({ error: 'Agent not found' });
    }
    
    res.json({
      success: true,
      agent: {
        id: agent.id,
        name: agent.name,
        description: agent.description
      }
    });
  } catch (error) {
    console.error('[Agents] Set active error:', error);
    res.status(500).json({ error: 'Failed to set active agent' });
  }
});

// Create custom agent
multiAgentRouter.post('/create', (req: Request, res: Response) => {
  try {
    const { name, description, systemPrompt, model, tools, capabilities, settings } = req.body;
    
    if (!name || !systemPrompt) {
      return res.status(400).json({ error: 'Name and systemPrompt are required' });
    }
    
    const agent = agentManager.createAgent({
      name,
      description,
      systemPrompt,
      model,
      tools,
      capabilities,
      settings
    });
    
    res.json({
      success: true,
      agent: {
        id: agent.id,
        name: agent.name,
        description: agent.description
      }
    });
  } catch (error) {
    console.error('[Agents] Create error:', error);
    res.status(500).json({ error: 'Failed to create agent' });
  }
});

// Update agent
multiAgentRouter.patch('/:id', (req: Request, res: Response) => {
  try {
    const agent = agentManager.updateAgent(req.params.id, req.body);
    if (!agent) {
      return res.status(404).json({ error: 'Agent not found' });
    }
    
    res.json({
      success: true,
      agent: {
        id: agent.id,
        name: agent.name,
        description: agent.description,
        updatedAt: agent.updatedAt
      }
    });
  } catch (error) {
    console.error('[Agents] Update error:', error);
    res.status(500).json({ error: 'Failed to update agent' });
  }
});

// Delete custom agent
multiAgentRouter.delete('/:id', (req: Request, res: Response) => {
  try {
    const deleted = agentManager.deleteAgent(req.params.id);
    if (!deleted) {
      return res.status(400).json({ 
        error: 'Cannot delete default agents or agent not found' 
      });
    }
    
    res.json({ success: true, deleted: req.params.id });
  } catch (error) {
    console.error('[Agents] Delete error:', error);
    res.status(500).json({ error: 'Failed to delete agent' });
  }
});

// Recommend agent for a query
multiAgentRouter.post('/recommend', (req: Request, res: Response) => {
  try {
    const { query, preferredAgentId } = req.body;
    
    if (!query) {
      return res.status(400).json({ error: 'Query is required' });
    }
    
    const agent = getAgentForRequest(query, preferredAgentId);
    
    res.json({
      recommended: {
        id: agent.id,
        name: agent.name,
        description: agent.description,
        capabilities: agent.capabilities
      },
      reason: getRecommendationReason(query, agent.id)
    });
  } catch (error) {
    console.error('[Agents] Recommend error:', error);
    res.status(500).json({ error: 'Failed to recommend agent' });
  }
});

// Get agent templates
multiAgentRouter.get('/templates/available', (req: Request, res: Response) => {
  try {
    const templates = Object.entries(AGENT_TEMPLATES).map(([id, template]) => ({
      id,
      name: template.name,
      description: template.description,
      capabilities: template.capabilities,
      tools: template.tools
    }));
    
    res.json({ templates });
  } catch (error) {
    console.error('[Agents] Templates error:', error);
    res.status(500).json({ error: 'Failed to get templates' });
  }
});

// Get agent stats
multiAgentRouter.get('/:id/stats', (req: Request, res: Response) => {
  try {
    const agent = agentManager.getAgent(req.params.id);
    if (!agent) {
      return res.status(404).json({ error: 'Agent not found' });
    }
    
    res.json({
      id: agent.id,
      name: agent.name,
      stats: {
        messagesProcessed: agent.stats.messagesProcessed,
        tokensUsed: agent.stats.tokensUsed,
        averageResponseTime: Math.round(agent.stats.averageResponseTime) + 'ms',
        successRate: agent.stats.successRate.toFixed(1) + '%',
        lastActive: agent.stats.lastActive?.toISOString() || null
      }
    });
  } catch (error) {
    console.error('[Agents] Stats error:', error);
    res.status(500).json({ error: 'Failed to get agent stats' });
  }
});

function getRecommendationReason(query: string, agentId: string): string {
  const reasons: Record<string, string> = {
    coder: 'Detected programming or code-related request',
    researcher: 'Detected research or information request',
    writer: 'Detected writing or content creation request',
    analyst: 'Detected data analysis or reporting request',
    teacher: 'Detected learning or explanation request',
    assistant: 'General assistance request'
  };
  return reasons[agentId] || 'Best match for your request';
}

export default multiAgentRouter;
