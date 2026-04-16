import { Router, Request, Response } from 'express';
import { pythonToolsClient, PythonToolsClientError } from '../lib/pythonToolsClient';
import { createLogger } from "../lib/structuredLogger";

const PYTHON_TOOL_NAME_RE = /^[a-zA-Z0-9._-]{1,80}$/;
const PYTHON_TASK_MAX_LEN = 4_000;
const PYTHON_TOOL_INPUT_MAX_BYTES = 196_000;
const logger = createLogger("python-tools-router");

function resolveToolName(rawName: unknown): string | null {
  if (typeof rawName !== "string") return null;
  const trimmed = rawName.trim();
  return PYTHON_TOOL_NAME_RE.test(trimmed) ? trimmed : null;
}

function resolveTask(rawTask: unknown): string | null {
  if (typeof rawTask !== "string") return null;
  const normalized = rawTask.replace(/\u0000/g, "").trim();
  if (!normalized) return null;
  if (normalized.length > PYTHON_TASK_MAX_LEN) return null;
  return normalized;
}

function resolveToolInput(rawInput: unknown): Record<string, unknown> {
  if (rawInput == null) {
    return {};
  }
  if (typeof rawInput !== "object" || Array.isArray(rawInput)) {
    throw new Error("Invalid tool input payload");
  }
  try {
    const serialized = JSON.stringify(rawInput);
    if (serialized.length > PYTHON_TOOL_INPUT_MAX_BYTES) {
      throw new Error("Tool input exceeds maximum payload size");
    }
  } catch (error) {
    throw new Error("Invalid tool input payload");
  }
  return rawInput as Record<string, unknown>;
}

function classifyToolInputError(error: unknown): number | null {
  if (!(error instanceof Error)) {
    return null;
  }
  if (error.message === "Tool input exceeds maximum payload size") {
    return 413;
  }
  if (
    error.message === "Invalid tool input payload" ||
    error.message === "Tool input must be a plain object"
  ) {
    return 400;
  }
  return null;
}

export function createPythonToolsRouter(): Router {
  const router = Router();

  router.get('/python-tools/health', async (_req: Request, res: Response) => {
    try {
      const health = await pythonToolsClient.health();
      res.json({
        success: true,
        ...health
      });
    } catch (error) {
      logger.error('[PythonToolsRouter] Health check failed', { error: error instanceof Error ? error.message : String(error) });
      
      if (error instanceof PythonToolsClientError) {
        return res.status(error.statusCode || 503).json({
          success: false,
          error: error.message,
          details: error.details
        });
      }
      
      res.status(503).json({
        success: false,
        error: 'Python Tools API is unavailable',
        message: error instanceof Error ? error.message : 'Unknown error'
      });
    }
  });

  router.get('/python-tools', async (_req: Request, res: Response) => {
    try {
      const tools = await pythonToolsClient.listTools();
      res.json({
        success: true,
        count: tools.length,
        tools
      });
    } catch (error) {
      logger.error('[PythonToolsRouter] List tools failed', { error: error instanceof Error ? error.message : String(error) });
      
      if (error instanceof PythonToolsClientError) {
        return res.status(error.statusCode || 500).json({
          success: false,
          error: error.message,
          details: error.details
        });
      }
      
      res.status(500).json({
        success: false,
        error: 'Failed to list Python tools',
        message: error instanceof Error ? error.message : 'Unknown error'
      });
    }
  });

  router.get('/python-tools/:name', async (req: Request, res: Response) => {
    try {
      const name = resolveToolName(req.params.name);
      if (!name) {
        return res.status(400).json({
          success: false,
          error: 'Invalid tool name',
        });
      }
      const tool = await pythonToolsClient.getTool(name);
      res.json({
        success: true,
        tool
      });
    } catch (error) {
      logger.error('[PythonToolsRouter] Get tool failed', {
        name: req.params.name,
        error: error instanceof Error ? error.message : String(error),
      });
      
      if (error instanceof PythonToolsClientError) {
        return res.status(error.statusCode || 500).json({
          success: false,
          error: error.message,
          details: error.details
        });
      }
      
      res.status(500).json({
        success: false,
        error: `Failed to get tool '${req.params.name}'`,
        message: error instanceof Error ? error.message : 'Unknown error'
      });
    }
  });

  router.post('/python-tools/:name/execute', async (req: Request, res: Response) => {
    try {
      const name = resolveToolName(req.params.name);
      if (!name) {
        return res.status(400).json({
          success: false,
          error: 'Invalid tool name',
        });
      }
      const input = resolveToolInput(req.body?.input);
      
      logger.debug('[PythonToolsRouter] Executing tool', { name });
      
      const result = await pythonToolsClient.executeTool(name, input);
      
      res.json({
        success: true,
        ...result
      });
    } catch (error) {
      const status = classifyToolInputError(error);
      if (status) {
        return res.status(status).json({
          success: false,
          error: error instanceof Error ? error.message : "Invalid tool input",
        });
      }
      logger.error('[PythonToolsRouter] Execute tool failed', {
        name: req.params.name,
        error: error instanceof Error ? error.message : String(error),
      });
      
      if (error instanceof PythonToolsClientError) {
        return res.status(error.statusCode || 500).json({
          success: false,
          error: error.message,
          details: error.details
        });
      }
      
      res.status(500).json({
        success: false,
        error: `Failed to execute tool '${req.params.name}'`,
        message: error instanceof Error ? error.message : 'Unknown error'
      });
    }
  });

  router.get('/python-agents', async (_req: Request, res: Response) => {
    try {
      const agents = await pythonToolsClient.listAgents();
      res.json({
        success: true,
        count: agents.length,
        agents
      });
    } catch (error) {
      logger.error('[PythonToolsRouter] List agents failed', { error: error instanceof Error ? error.message : String(error) });
      
      if (error instanceof PythonToolsClientError) {
        return res.status(error.statusCode || 500).json({
          success: false,
          error: error.message,
          details: error.details
        });
      }
      
      res.status(500).json({
        success: false,
        error: 'Failed to list Python agents',
        message: error instanceof Error ? error.message : 'Unknown error'
      });
    }
  });

  router.get('/python-agents/:name', async (req: Request, res: Response) => {
    try {
      const name = resolveToolName(req.params.name);
      if (!name) {
        return res.status(400).json({
          success: false,
          error: 'Invalid agent name',
        });
      }
      const agent = await pythonToolsClient.getAgent(name);
      res.json({
        success: true,
        agent
      });
    } catch (error) {
      logger.error('[PythonToolsRouter] Get agent failed', {
        name: req.params.name,
        error: error instanceof Error ? error.message : String(error),
      });
      
      if (error instanceof PythonToolsClientError) {
        return res.status(error.statusCode || 500).json({
          success: false,
          error: error.message,
          details: error.details
        });
      }
      
      res.status(500).json({
        success: false,
        error: `Failed to get agent '${req.params.name}'`,
        message: error instanceof Error ? error.message : 'Unknown error'
      });
    }
  });

  router.post('/python-agents/:name/execute', async (req: Request, res: Response) => {
    try {
      const name = resolveToolName(req.params.name);
      if (!name) {
        return res.status(400).json({
          success: false,
          error: 'Invalid agent name',
        });
      }
      const task = resolveTask(req.body?.task);
      const context = resolveToolInput(req.body?.context);
      
      if (!task) {
        return res.status(400).json({
          success: false,
          error: `Missing or invalid task (expected non-empty text up to ${PYTHON_TASK_MAX_LEN} chars)`,
        });
      }
      logger.debug('[PythonToolsRouter] Executing agent', {
        name,
        taskLength: task.length,
      });
      
      const result = await pythonToolsClient.executeAgent(name, task, context);
      
      res.json({
        success: true,
        result
      });
    } catch (error) {
      const status = classifyToolInputError(error);
      if (status) {
        return res.status(status).json({
          success: false,
          error: error instanceof Error ? error.message : "Invalid tool input",
        });
      }
      logger.error('[PythonToolsRouter] Execute agent failed', {
        name: req.params.name,
        error: error instanceof Error ? error.message : String(error),
      });
      
      if (error instanceof PythonToolsClientError) {
        return res.status(error.statusCode || 500).json({
          success: false,
          error: error.message,
          details: error.details
        });
      }
      
      res.status(500).json({
        success: false,
        error: `Failed to execute agent '${req.params.name}'`,
        message: error instanceof Error ? error.message : 'Unknown error'
      });
    }
  });

  return router;
}

export default createPythonToolsRouter;
