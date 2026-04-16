"""Orchestrator Agent - Coordinates and delegates tasks to specialized agents."""

from typing import Any, Dict, List, Optional
from .base_agent import BaseAgent, AgentConfig, AgentResult, AgentState
from ..core.state_manager import state_manager, AgentStatus
from ..core.workflow_engine import (
    workflow_engine, 
    WorkflowDefinition, 
    WorkflowStep,
    ExecutionMode
)
import structlog
import asyncio


class OrchestratorAgentConfig(AgentConfig):
    """Configuration for the Orchestrator Agent."""
    max_delegations: int = 10
    available_agents: List[str] = []
    parallel_execution: bool = True
    retry_failed: bool = True
    track_state: bool = True


class OrchestratorAgent(BaseAgent):
    """Super Agent that coordinates other agents and manages workflows."""
    
    name = "orchestrator"
    
    def __init__(
        self,
        config: Optional[OrchestratorAgentConfig] = None,
        tools: Optional[List] = None,
        memory = None,
    ):
        super().__init__(tools=tools, memory=memory)
        self.config = config or OrchestratorAgentConfig(name="orchestrator")
        self._registered_agents: Dict[str, BaseAgent] = {}
        self._delegation_count = 0
        self._current_workflow_id: Optional[str] = None
    
    @property
    def description(self) -> str:
        return "Coordinates and delegates tasks to specialized agents, manages complex workflows"
    
    @property
    def category(self) -> str:
        return "orchestration"
    
    @property
    def tools_used(self) -> List[str]:
        return ["orchestrate", "plan", "reason", "message"]
    
    def get_system_prompt(self) -> str:
        return """You are the Orchestrator Agent, the central coordinator of the agent system.
Your role is to:
1. Analyze incoming tasks and break them into logical subtasks
2. Delegate subtasks to the most appropriate specialized agents
3. Coordinate parallel execution when tasks are independent
4. Synthesize results from multiple agents into coherent outputs
5. Handle errors gracefully and retry failed operations
6. Track progress and provide status updates

Available specialized agents:
- ResearchAgent: Web search, information gathering, data synthesis
- CodeAgent: Code generation, review, debugging, execution
- DataAgent: Data analysis, transformation, visualization
- ContentAgent: Text generation, editing, summarization
- CommunicationAgent: Messaging, notifications, email
- BrowserAgent: Web navigation, scraping, automation
- DocumentAgent: Document creation, parsing, conversion
- QAAgent: Testing, validation, quality assurance
- SecurityAgent: Security scanning, input validation, secrets

When delegating tasks:
- Match task requirements to agent capabilities
- Provide clear context and requirements
- Set appropriate timeouts and retry policies
- Aggregate and validate results before returning"""
    
    def register_agent(self, agent: BaseAgent) -> None:
        """Register a specialized agent for delegation."""
        self._registered_agents[agent.name] = agent
        workflow_engine.register_agent(agent.name, agent)
        self.logger.info("agent_registered", agent_name=agent.name)
    
    def unregister_agent(self, agent_name: str) -> None:
        """Unregister an agent."""
        if agent_name in self._registered_agents:
            del self._registered_agents[agent_name]
            workflow_engine.unregister_agent(agent_name)
            self.logger.info("agent_unregistered", agent_name=agent_name)
    
    def get_registered_agents(self) -> List[str]:
        """Get list of registered agent names."""
        return list(self._registered_agents.keys())
    
    def get_agent_states(self) -> Dict[str, Dict[str, Any]]:
        """Get current state of all registered agents."""
        states = {}
        for name in self._registered_agents:
            agent_state = state_manager.get_state(name)
            if agent_state:
                states[name] = agent_state.to_dict()
        return states
    
    async def delegate(self, agent_name: str, task: str, context: Optional[Dict[str, Any]] = None) -> AgentResult:
        """Delegate a task to a specific agent with state tracking."""
        if agent_name not in self._registered_agents:
            return AgentResult(
                success=False,
                error=f"Agent '{agent_name}' not registered"
            )
        
        if self._delegation_count >= self.config.max_delegations:
            return AgentResult(
                success=False,
                error="Maximum delegation limit reached"
            )
        
        self._delegation_count += 1
        agent = self._registered_agents[agent_name]
        
        if self.config.track_state:
            state_manager.start_agent(agent_name, task)
        
        try:
            result = await agent.execute(task, context)
            
            if self.config.track_state:
                if result.success:
                    state_manager.complete_agent(agent_name, result.data or {})
                else:
                    state_manager.fail_agent(agent_name, result.error or "Unknown error")
            
            if self._current_workflow_id:
                state_manager.update_workflow(
                    self._current_workflow_id,
                    agent_name,
                    result.data
                )
            
            return result
        except Exception as e:
            self.logger.error("delegation_failed", agent=agent_name, error=str(e))
            
            if self.config.track_state:
                state_manager.fail_agent(agent_name, str(e))
            
            if self.config.retry_failed:
                try:
                    return await agent.execute(task, context)
                except Exception as retry_error:
                    return AgentResult(success=False, error=str(retry_error))
            return AgentResult(success=False, error=str(e))
    
    async def run(self, task: str, context: Optional[Dict[str, Any]] = None) -> Dict[str, Any]:
        """Execute the orchestrator's main loop with state tracking."""
        self.state = AgentState.PLANNING
        context = context or {}
        
        if self.config.track_state:
            state_manager.start_agent(self.name, task)
            state_manager.set_state(self.name, progress=0.1)
        
        plan = await self.plan(task, context)
        
        self.state = AgentState.EXECUTING
        results = []
        total_steps = len(plan)
        
        for idx, step in enumerate(plan):
            result = await self.execute_step(step, context)
            results.append(result)
            
            if self.config.track_state:
                progress = (idx + 1) / total_steps
                state_manager.set_state(self.name, progress=progress)
        
        self.state = AgentState.COMPLETED
        
        if self.config.track_state:
            state_manager.complete_agent(self.name, {"plan": plan, "results": results})
        
        return {"plan": plan, "results": results}
    
    async def plan(self, task: str, context: Dict[str, Any]) -> List[str]:
        """Generate an execution plan for the task."""
        return [f"Execute: {task}"]
    
    async def execute_step(self, step: str, context: Dict[str, Any]) -> Dict[str, Any]:
        """Execute a single step of the plan."""
        self.logger.info("executing_step", step=step[:100])
        return {"step": step, "status": "completed"}
    
    async def create_workflow(
        self,
        name: str,
        steps: List[Dict[str, Any]],
        execution_mode: str = "parallel",
        context: Optional[Dict[str, Any]] = None
    ) -> str:
        """Create a new workflow definition and start it."""
        workflow_steps = []
        for step_def in steps:
            step = WorkflowStep(
                name=step_def["name"],
                agent_name=step_def.get("agent", step_def["name"]),
                task=step_def["task"],
                depends_on=step_def.get("depends_on", []),
                max_retries=step_def.get("max_retries", 3),
                timeout_seconds=step_def.get("timeout", 300),
            )
            workflow_steps.append(step)
        
        definition = WorkflowDefinition(
            name=name,
            steps=workflow_steps,
            execution_mode=ExecutionMode(execution_mode),
        )
        
        workflow_id = await workflow_engine.create_workflow(definition, context)
        self._current_workflow_id = workflow_id
        
        return workflow_id
    
    async def run_workflow(
        self,
        name: str,
        steps: List[Dict[str, Any]],
        execution_mode: str = "parallel",
        context: Optional[Dict[str, Any]] = None
    ) -> Dict[str, Any]:
        """Create and execute a workflow."""
        workflow_steps = []
        for step_def in steps:
            step = WorkflowStep(
                name=step_def["name"],
                agent_name=step_def.get("agent", step_def["name"]),
                task=step_def["task"],
                depends_on=step_def.get("depends_on", []),
                max_retries=step_def.get("max_retries", 3),
                timeout_seconds=step_def.get("timeout", 300),
            )
            workflow_steps.append(step)
        
        definition = WorkflowDefinition(
            name=name,
            steps=workflow_steps,
            execution_mode=ExecutionMode(execution_mode),
        )
        
        for agent in self._registered_agents.values():
            workflow_engine.register_agent(agent.name, agent)
        
        result = await workflow_engine.run_workflow(definition, context)
        
        return {
            "workflow_id": result.workflow_id,
            "status": result.status.value,
            "results": result.results,
            "errors": result.errors,
        }
    
    async def cancel_workflow(self, workflow_id: str) -> bool:
        """Cancel a running workflow."""
        return await workflow_engine.cancel_workflow(workflow_id)
    
    def get_workflow_status(self, workflow_id: str) -> Optional[Dict[str, Any]]:
        """Get status of a workflow."""
        return workflow_engine.get_workflow_status(workflow_id)
    
    def list_workflows(self) -> List[Dict[str, Any]]:
        """List all workflows."""
        return workflow_engine.list_workflows()
    
    async def execute(self, task: str, context: Optional[Dict[str, Any]] = None) -> AgentResult:
        """Execute a task by coordinating specialized agents."""
        self.logger.info("orchestrator_execute", task=task[:100] if task else "")
        self.state = AgentState.EXECUTING
        context = context or {}
        
        try:
            result = await self.run(task, context)
            self.state = AgentState.COMPLETED
            return AgentResult(
                success=True,
                data=result,
                metadata={
                    "delegations": self._delegation_count,
                    "agent_states": self.get_agent_states(),
                }
            )
        except Exception as e:
            self.state = AgentState.ERROR
            self.logger.error("orchestrator_error", error=str(e))
            
            if self.config.track_state:
                state_manager.fail_agent(self.name, str(e))
            
            return AgentResult(success=False, error=str(e))
    
    async def execute_parallel(
        self, 
        tasks: List[Dict[str, Any]]
    ) -> List[AgentResult]:
        """Execute multiple agent tasks in parallel."""
        async def run_task(task_def: Dict[str, Any]) -> AgentResult:
            agent_name = task_def["agent"]
            task = task_def["task"]
            context = task_def.get("context", {})
            return await self.delegate(agent_name, task, context)
        
        results = await asyncio.gather(
            *[run_task(t) for t in tasks],
            return_exceptions=True
        )
        
        return [
            r if isinstance(r, AgentResult) else AgentResult(success=False, error=str(r))
            for r in results
        ]
    
    async def initialize(self) -> None:
        """Initialize the orchestrator agent."""
        await super().initialize()
        self._delegation_count = 0
        self._current_workflow_id = None
        
        if self.config.track_state:
            state_manager.set_state(self.name, status=AgentStatus.IDLE)
        
        self.logger.info("orchestrator_initialized", registered_agents=len(self._registered_agents))
    
    async def shutdown(self) -> None:
        """Shutdown the orchestrator agent."""
        for agent in self._registered_agents.values():
            await agent.shutdown()
        await super().shutdown()
        self.logger.info("orchestrator_shutdown")
