/**
 * Workflow Router - Automation workflow management API
 *
 * Endpoints for creating, executing, and managing
 * automated workflows that chain browser + terminal actions.
 */

import { Router, Request, Response } from "express";
import { workflowEngine, WorkflowDefinition } from "../agent/workflowEngine";

export function createWorkflowRouter(): Router {
  const router = Router();

  /** Register a reusable workflow */
  router.post("/register", (req: Request, res: Response) => {
    try {
      const workflow = req.body as WorkflowDefinition;
      if (!workflow.name || !workflow.steps) {
        return res.status(400).json({ error: "name and steps are required" });
      }
      const id = workflowEngine.registerWorkflow(workflow);
      res.json({ id, name: workflow.name });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  /** List registered workflows */
  router.get("/", (_req: Request, res: Response) => {
    try {
      const workflows = workflowEngine.listWorkflows();
      res.json({ workflows });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  /** Get a workflow by ID */
  router.get("/:id", (req: Request, res: Response) => {
    try {
      const workflow = workflowEngine.getWorkflow(req.params.id);
      if (!workflow) return res.status(404).json({ error: "Workflow not found" });
      res.json({ workflow });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  /** Delete a workflow */
  router.delete("/:id", (req: Request, res: Response) => {
    try {
      const deleted = workflowEngine.deleteWorkflow(req.params.id);
      res.json({ deleted });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  /** Execute a workflow (by ID or inline definition) */
  router.post("/execute", async (req: Request, res: Response) => {
    try {
      const { workflowId, workflow, variables } = req.body;

      let workflowDef: WorkflowDefinition;

      if (workflowId) {
        const registered = workflowEngine.getWorkflow(workflowId);
        if (!registered) return res.status(404).json({ error: "Workflow not found" });
        workflowDef = registered;
      } else if (workflow) {
        workflowDef = workflow;
      } else {
        return res.status(400).json({ error: "workflowId or workflow definition required" });
      }

      const execution = await workflowEngine.executeWorkflow(workflowDef, variables);

      res.json({
        executionId: execution.id,
        status: execution.status,
        stepsCompleted: execution.completedSteps,
        totalSteps: execution.totalSteps,
        duration: execution.endTime ? execution.endTime - execution.startTime : 0,
        error: execution.error,
        variables: Object.keys(execution.variables),
      });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  /** Get execution status */
  router.get("/executions/:executionId", (req: Request, res: Response) => {
    try {
      const execution = workflowEngine.getExecution(req.params.executionId);
      if (!execution) return res.status(404).json({ error: "Execution not found" });
      res.json(execution);
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  /** Cancel an execution */
  router.post("/executions/:executionId/cancel", (req: Request, res: Response) => {
    try {
      const cancelled = workflowEngine.cancelExecution(req.params.executionId);
      res.json({ cancelled });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  /** List all executions */
  router.get("/executions", (_req: Request, res: Response) => {
    try {
      const executions = workflowEngine.listExecutions().map((e) => ({
        id: e.id,
        workflowName: e.workflowName,
        status: e.status,
        progress: e.progress,
        startTime: e.startTime,
        endTime: e.endTime,
      }));
      res.json({ executions });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  return router;
}
