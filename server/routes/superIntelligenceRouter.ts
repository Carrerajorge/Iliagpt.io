/**
 * Super Intelligence Router
 *
 * Provides API endpoints for the complete super-intelligence system including:
 * - System status and health
 * - Cognitive processing
 * - User understanding
 * - Meta-agent management
 * - Learning system
 */

import { Router, Request, Response } from 'express';
import {
  superIntelligence,
  getSuperIntelligenceStatus,
  processWithIntelligence,
  initializeSuperIntelligence
} from '../services/superIntelligence';

export function createSuperIntelligenceRouter(): Router {
  const router = Router();

  // ==================== System Status ====================

  /**
   * GET /api/super-intelligence/status
   * Get overall system status
   */
  router.get('/status', (_req: Request, res: Response) => {
    try {
      const status = getSuperIntelligenceStatus();
      res.json({
        success: true,
        data: status
      });
    } catch (error: any) {
      res.status(500).json({
        success: false,
        error: error.message || 'Failed to get system status'
      });
    }
  });

  /**
   * POST /api/super-intelligence/initialize
   * Initialize or re-initialize the system
   */
  router.post('/initialize', async (_req: Request, res: Response) => {
    try {
      const status = await initializeSuperIntelligence();
      res.json({
        success: true,
        data: status
      });
    } catch (error: any) {
      res.status(500).json({
        success: false,
        error: error.message || 'Failed to initialize system'
      });
    }
  });

  /**
   * GET /api/super-intelligence/health
   * Get detailed health report
   */
  router.get('/health', (_req: Request, res: Response) => {
    try {
      const healthReport = superIntelligence.metaAgent.supervisor.generateHealthReport();
      res.json({
        success: true,
        data: healthReport
      });
    } catch (error: any) {
      res.status(500).json({
        success: false,
        error: error.message || 'Failed to get health report'
      });
    }
  });

  // ==================== Cognitive Processing ====================

  /**
   * POST /api/super-intelligence/process
   * Process a query through the cognitive system
   */
  router.post('/process', async (req: Request, res: Response) => {
    try {
      const { userId, sessionId, query, options } = req.body;

      if (!query) {
        return res.status(400).json({
          success: false,
          error: 'Query is required'
        });
      }

      const result = await processWithIntelligence(
        userId || 'anonymous',
        sessionId || `session_${Date.now()}`,
        query,
        options || {}
      );

      res.json({
        success: true,
        data: result
      });
    } catch (error: any) {
      res.status(500).json({
        success: false,
        error: error.message || 'Failed to process query'
      });
    }
  });

  /**
   * POST /api/super-intelligence/cognitive/reason
   * Execute reasoning on a specific problem
   */
  router.post('/cognitive/reason', async (req: Request, res: Response) => {
    try {
      const { type, premises, goal, context } = req.body;

      const result = await superIntelligence.cognitive.reasoning.reason({
        type: type || 'deductive',
        premises: premises || [],
        goal: goal || 'Solve the problem',
        context
      });

      res.json({
        success: true,
        data: result
      });
    } catch (error: any) {
      res.status(500).json({
        success: false,
        error: error.message || 'Failed to reason'
      });
    }
  });

  /**
   * POST /api/super-intelligence/cognitive/plan
   * Create an execution plan
   */
  router.post('/cognitive/plan', async (req: Request, res: Response) => {
    try {
      const { goal, context, constraints } = req.body;

      if (!goal) {
        return res.status(400).json({
          success: false,
          error: 'Goal is required'
        });
      }

      const result = await superIntelligence.cognitive.planning.createPlan({
        goal,
        context,
        constraints
      });

      res.json({
        success: true,
        data: result
      });
    } catch (error: any) {
      res.status(500).json({
        success: false,
        error: error.message || 'Failed to create plan'
      });
    }
  });

  // ==================== User Understanding ====================

  /**
   * POST /api/super-intelligence/understand/intent
   * Detect intent from text
   */
  router.post('/understand/intent', async (req: Request, res: Response) => {
    try {
      const { text, context } = req.body;

      if (!text) {
        return res.status(400).json({
          success: false,
          error: 'Text is required'
        });
      }

      const result = await superIntelligence.understanding.intent.detectIntent(text, context);

      res.json({
        success: true,
        data: result
      });
    } catch (error: any) {
      res.status(500).json({
        success: false,
        error: error.message || 'Failed to detect intent'
      });
    }
  });

  /**
   * POST /api/super-intelligence/understand/emotion
   * Analyze emotion from text
   */
  router.post('/understand/emotion', async (req: Request, res: Response) => {
    try {
      const { text, context } = req.body;

      if (!text) {
        return res.status(400).json({
          success: false,
          error: 'Text is required'
        });
      }

      const result = await superIntelligence.understanding.emotion.analyzeEmotion(text, context);

      res.json({
        success: true,
        data: result
      });
    } catch (error: any) {
      res.status(500).json({
        success: false,
        error: error.message || 'Failed to analyze emotion'
      });
    }
  });

  /**
   * GET /api/super-intelligence/understand/profile/:userId
   * Get user profile
   */
  router.get('/understand/profile/:userId', async (req: Request, res: Response) => {
    try {
      const { userId } = req.params;

      const profile = await superIntelligence.understanding.profile.getProfile(userId);

      if (!profile) {
        return res.status(404).json({
          success: false,
          error: 'Profile not found'
        });
      }

      res.json({
        success: true,
        data: profile
      });
    } catch (error: any) {
      res.status(500).json({
        success: false,
        error: error.message || 'Failed to get profile'
      });
    }
  });

  // ==================== Meta-Agent System ====================

  /**
   * GET /api/super-intelligence/agents
   * List all registered agents
   */
  router.get('/agents', (_req: Request, res: Response) => {
    try {
      const agents = superIntelligence.metaAgent.registry.getAllAgents();

      res.json({
        success: true,
        count: agents.length,
        data: agents.map(a => ({
          id: a.definition.id,
          name: a.definition.name,
          description: a.definition.description,
          capabilities: a.definition.capabilities,
          status: a.status,
          health: a.health,
          metrics: {
            currentTasks: a.currentTasks,
            totalProcessed: a.totalTasksProcessed,
            successRate: a.successRate,
            avgLatency: a.averageLatencyMs
          }
        }))
      });
    } catch (error: any) {
      res.status(500).json({
        success: false,
        error: error.message || 'Failed to list agents'
      });
    }
  });

  /**
   * POST /api/super-intelligence/agents/discover
   * Discover agents by capabilities
   */
  router.post('/agents/discover', (req: Request, res: Response) => {
    try {
      const query = req.body;
      const agents = superIntelligence.metaAgent.registry.discover(query);

      res.json({
        success: true,
        count: agents.length,
        data: agents
      });
    } catch (error: any) {
      res.status(500).json({
        success: false,
        error: error.message || 'Failed to discover agents'
      });
    }
  });

  /**
   * POST /api/super-intelligence/execute
   * Execute a multi-agent task
   */
  router.post('/execute', async (req: Request, res: Response) => {
    try {
      const { name, description, goal, input, context, constraints, qualityRequirements } = req.body;

      if (!goal) {
        return res.status(400).json({
          success: false,
          error: 'Goal is required'
        });
      }

      const result = await superIntelligence.metaAgent.supervisor.executeMultiAgentTask({
        name: name || 'Task',
        description: description || goal,
        goal,
        input: input || {},
        context: {
          userId: context?.userId || 'anonymous',
          sessionId: context?.sessionId || `session_${Date.now()}`,
          priority: context?.priority || 'normal',
          deadline: context?.deadline
        },
        constraints,
        qualityRequirements
      });

      res.json({
        success: true,
        data: result
      });
    } catch (error: any) {
      res.status(500).json({
        success: false,
        error: error.message || 'Failed to execute task'
      });
    }
  });

  /**
   * GET /api/super-intelligence/orchestrator/stats
   * Get task orchestrator statistics
   */
  router.get('/orchestrator/stats', (_req: Request, res: Response) => {
    try {
      const stats = superIntelligence.metaAgent.orchestrator.getStats();

      res.json({
        success: true,
        data: stats
      });
    } catch (error: any) {
      res.status(500).json({
        success: false,
        error: error.message || 'Failed to get orchestrator stats'
      });
    }
  });

  /**
   * GET /api/super-intelligence/conflicts
   * Get active conflicts
   */
  router.get('/conflicts', (_req: Request, res: Response) => {
    try {
      const conflicts = superIntelligence.metaAgent.conflicts.getActiveConflicts();
      const stats = superIntelligence.metaAgent.conflicts.getStats();

      res.json({
        success: true,
        data: {
          active: conflicts,
          stats
        }
      });
    } catch (error: any) {
      res.status(500).json({
        success: false,
        error: error.message || 'Failed to get conflicts'
      });
    }
  });

  // ==================== Learning System ====================

  /**
   * GET /api/super-intelligence/learning/stats
   * Get learning system statistics
   */
  router.get('/learning/stats', (_req: Request, res: Response) => {
    try {
      const stats = superIntelligence.learning.continuous.getStats();

      res.json({
        success: true,
        data: stats
      });
    } catch (error: any) {
      res.status(500).json({
        success: false,
        error: error.message || 'Failed to get learning stats'
      });
    }
  });

  /**
   * POST /api/super-intelligence/learning/feedback
   * Submit feedback for learning
   */
  router.post('/learning/feedback', async (req: Request, res: Response) => {
    try {
      const { sessionId, responseId, feedbackType, data, context } = req.body;

      if (!responseId || !feedbackType || !context) {
        return res.status(400).json({
          success: false,
          error: 'responseId, feedbackType, and context are required'
        });
      }

      const feedbackId = await superIntelligence.learning.continuous.recordFeedback(
        sessionId || `session_${Date.now()}`,
        responseId,
        feedbackType,
        data || {},
        context
      );

      res.json({
        success: true,
        data: { feedbackId }
      });
    } catch (error: any) {
      res.status(500).json({
        success: false,
        error: error.message || 'Failed to record feedback'
      });
    }
  });

  /**
   * POST /api/super-intelligence/learning/critique
   * Critique a response
   */
  router.post('/learning/critique', async (req: Request, res: Response) => {
    try {
      const { query, response, policy } = req.body;

      if (!query || !response) {
        return res.status(400).json({
          success: false,
          error: 'Query and response are required'
        });
      }

      const result = await superIntelligence.learning.critique.critique(query, response, policy);

      res.json({
        success: true,
        data: result
      });
    } catch (error: any) {
      res.status(500).json({
        success: false,
        error: error.message || 'Failed to critique response'
      });
    }
  });

  /**
   * POST /api/super-intelligence/learning/improve
   * Improve a response using learned models
   */
  router.post('/learning/improve', async (req: Request, res: Response) => {
    try {
      const { query, response } = req.body;

      if (!query || !response) {
        return res.status(400).json({
          success: false,
          error: 'Query and response are required'
        });
      }

      const result = await superIntelligence.learning.continuous.improveResponse(query, response);

      res.json({
        success: true,
        data: result
      });
    } catch (error: any) {
      res.status(500).json({
        success: false,
        error: error.message || 'Failed to improve response'
      });
    }
  });

  /**
   * POST /api/super-intelligence/learning/train
   * Trigger a training run
   */
  router.post('/learning/train', async (_req: Request, res: Response) => {
    try {
      const metrics = await superIntelligence.learning.continuous.triggerTraining();

      if (!metrics) {
        return res.status(400).json({
          success: false,
          error: 'Training not executed (not enough examples or already in progress)'
        });
      }

      res.json({
        success: true,
        data: { metrics }
      });
    } catch (error: any) {
      res.status(500).json({
        success: false,
        error: error.message || 'Failed to trigger training'
      });
    }
  });

  /**
   * GET /api/super-intelligence/learning/report
   * Generate learning report
   */
  router.get('/learning/report', (req: Request, res: Response) => {
    try {
      const days = parseInt(req.query.days as string) || 7;
      const report = superIntelligence.learning.continuous.generateReport(days);

      res.json({
        success: true,
        data: report
      });
    } catch (error: any) {
      res.status(500).json({
        success: false,
        error: error.message || 'Failed to generate report'
      });
    }
  });

  /**
   * POST /api/super-intelligence/learning/predict-reward
   * Predict reward for a response
   */
  router.post('/learning/predict-reward', (req: Request, res: Response) => {
    try {
      const { query, response } = req.body;

      if (!query || !response) {
        return res.status(400).json({
          success: false,
          error: 'Query and response are required'
        });
      }

      const prediction = superIntelligence.learning.reward.predict(query, response);

      res.json({
        success: true,
        data: prediction
      });
    } catch (error: any) {
      res.status(500).json({
        success: false,
        error: error.message || 'Failed to predict reward'
      });
    }
  });

  /**
   * POST /api/super-intelligence/learning/compare
   * Compare two responses
   */
  router.post('/learning/compare', (req: Request, res: Response) => {
    try {
      const { query, responseA, responseB } = req.body;

      if (!query || !responseA || !responseB) {
        return res.status(400).json({
          success: false,
          error: 'Query, responseA, and responseB are required'
        });
      }

      const comparison = superIntelligence.learning.reward.compare(query, responseA, responseB);

      res.json({
        success: true,
        data: comparison
      });
    } catch (error: any) {
      res.status(500).json({
        success: false,
        error: error.message || 'Failed to compare responses'
      });
    }
  });

  // ==================== Memory System ====================

  /**
   * POST /api/super-intelligence/memory/store
   * Store item in memory hierarchy
   */
  router.post('/memory/store', async (req: Request, res: Response) => {
    try {
      const { userId, item } = req.body;

      if (!userId || !item) {
        return res.status(400).json({
          success: false,
          error: 'userId and item are required'
        });
      }

      const memoryId = await superIntelligence.cognitive.memory.store(userId, item);

      res.json({
        success: true,
        data: { memoryId }
      });
    } catch (error: any) {
      res.status(500).json({
        success: false,
        error: error.message || 'Failed to store memory'
      });
    }
  });

  /**
   * POST /api/super-intelligence/memory/search
   * Search memory
   */
  router.post('/memory/search', async (req: Request, res: Response) => {
    try {
      const { userId, query, options } = req.body;

      if (!userId || !query) {
        return res.status(400).json({
          success: false,
          error: 'userId and query are required'
        });
      }

      const results = await superIntelligence.cognitive.memory.search(userId, query, options);

      res.json({
        success: true,
        data: results
      });
    } catch (error: any) {
      res.status(500).json({
        success: false,
        error: error.message || 'Failed to search memory'
      });
    }
  });

  /**
   * GET /api/super-intelligence/memory/stats
   * Get memory statistics
   */
  router.get('/memory/stats', (_req: Request, res: Response) => {
    try {
      const stats = superIntelligence.cognitive.memory.getStats();

      res.json({
        success: true,
        data: stats
      });
    } catch (error: any) {
      res.status(500).json({
        success: false,
        error: error.message || 'Failed to get memory stats'
      });
    }
  });

  return router;
}
