"""Code Agent - Code generation, review, debugging, and execution."""

from typing import Any, Dict, List, Optional
from .base_agent import BaseAgent, AgentConfig, AgentResult, AgentState
import structlog


class CodeAgentConfig(AgentConfig):
    """Configuration for the Code Agent."""
    supported_languages: List[str] = ["python", "javascript", "typescript", "bash"]
    enable_execution: bool = True
    sandbox_mode: bool = True
    max_execution_time: int = 30


class CodeAgent(BaseAgent):
    """Agent specialized in code generation, review, debugging, and execution."""
    
    name = "code"
    
    def __init__(
        self,
        config: Optional[CodeAgentConfig] = None,
        tools: Optional[List] = None,
        memory = None,
    ):
        super().__init__(tools=tools, memory=memory)
        self.config = config or CodeAgentConfig(name="code")
        self._execution_history: List[Dict[str, Any]] = []
    
    @property
    def description(self) -> str:
        return "Generates, reviews, debugs, and executes code in multiple programming languages"
    
    @property
    def category(self) -> str:
        return "development"
    
    @property
    def tools_used(self) -> List[str]:
        return ["code_execute", "shell", "file_read", "file_write", "reason"]
    
    def get_system_prompt(self) -> str:
        return """You are the Code Agent, specialized in software development tasks.
Your role is to:
1. Generate clean, efficient, and well-documented code
2. Review code for bugs, security issues, and best practices
3. Debug issues by analyzing error messages and stack traces
4. Execute code safely in sandboxed environments
5. Refactor and optimize existing code
6. Write tests and validate functionality

Coding standards:
- Follow language-specific best practices and conventions
- Write clear comments and documentation
- Handle errors gracefully with proper error messages
- Prioritize security and input validation
- Write testable, modular code

Supported languages: Python, JavaScript, TypeScript, Bash

When generating code:
- Understand requirements fully before coding
- Consider edge cases and error handling
- Provide usage examples when appropriate
- Explain complex logic in comments"""
    
    async def generate_code(self, specification: str, language: str = "python") -> str:
        """Generate code based on a specification."""
        if language not in self.config.supported_languages:
            raise ValueError(f"Language '{language}' not supported")
        
        result = await self.execute_tool("reason", {
            "task": f"Generate {language} code for: {specification}",
            "context": {"language": language}
        })
        
        if result.success and result.data is not None and isinstance(result.data, dict):
            return result.data.get("code", "")
        return ""
    
    async def execute_code(self, code: str, language: str = "python") -> Dict[str, Any]:
        """Execute code in a sandbox."""
        if not self.config.enable_execution:
            return {"error": "Code execution disabled"}
        
        result = await self.execute_tool("code_execute", {
            "code": code,
            "language": language,
            "timeout": self.config.max_execution_time
        })
        
        execution_result = {
            "success": result.success,
            "output": result.data if result.success else None,
            "error": result.error
        }
        
        self._execution_history.append(execution_result)
        return execution_result
    
    async def review_code(self, code: str, language: str = "python") -> Dict[str, Any]:
        """Review code for issues and improvements."""
        result = await self.execute_tool("reason", {
            "task": f"Review this {language} code for bugs, security issues, and improvements",
            "context": {"code": code, "language": language}
        })
        
        if result.success and result.data is not None:
            return result.data if isinstance(result.data, dict) else {"result": result.data}
        return {"error": result.error}
    
    async def debug(self, code: str, error: str, language: str = "python") -> Dict[str, Any]:
        """Debug code given an error message."""
        result = await self.execute_tool("reason", {
            "task": f"Debug this {language} code given the error",
            "context": {"code": code, "error": error, "language": language}
        })
        
        if result.success and result.data is not None:
            return result.data if isinstance(result.data, dict) else {"result": result.data}
        return {"error": result.error}
    
    async def run(self, task: str, context: Optional[Dict[str, Any]] = None) -> Dict[str, Any]:
        """Execute the code agent's main loop."""
        self.state = AgentState.EXECUTING
        context = context or {}
        
        language = context.get("language", "python")
        
        if "generate" in task.lower():
            code = await self.generate_code(task, language)
            return {"action": "generate", "code": code}
        elif "review" in task.lower():
            code = context.get("code", "")
            review = await self.review_code(code, language)
            return {"action": "review", "review": review}
        elif "debug" in task.lower():
            code = context.get("code", "")
            error = context.get("error", "")
            fix = await self.debug(code, error, language)
            return {"action": "debug", "fix": fix}
        elif "execute" in task.lower():
            code = context.get("code", "")
            result = await self.execute_code(code, language)
            return {"action": "execute", "result": result}
        else:
            code = await self.generate_code(task, language)
            return {"action": "generate", "code": code}
    
    async def plan(self, task: str, context: Dict[str, Any]) -> List[str]:
        """Generate a plan for the coding task."""
        return [f"Execute coding task: {task}"]
    
    async def execute(self, task: str, context: Optional[Dict[str, Any]] = None) -> AgentResult:
        """Execute a coding task."""
        self.logger.info("code_execute", task=task[:100] if task else "")
        self.state = AgentState.EXECUTING
        
        try:
            result = await self.run(task, context)
            self.state = AgentState.COMPLETED
            return AgentResult(
                success=True,
                data=result,
                metadata={"executions": len(self._execution_history)}
            )
        except Exception as e:
            self.state = AgentState.ERROR
            self.logger.error("code_error", error=str(e))
            return AgentResult(success=False, error=str(e))
    
    async def initialize(self) -> None:
        """Initialize the code agent."""
        await super().initialize()
        self._execution_history = []
        self.logger.info("code_agent_initialized", languages=self.config.supported_languages)
    
    async def shutdown(self) -> None:
        """Shutdown the code agent."""
        self._execution_history.clear()
        await super().shutdown()
        self.logger.info("code_agent_shutdown")
