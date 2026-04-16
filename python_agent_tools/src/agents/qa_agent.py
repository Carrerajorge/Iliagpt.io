"""QA Agent - Testing, validation, and quality assurance."""

from typing import Any, Dict, List, Optional
from .base_agent import BaseAgent, AgentConfig, AgentResult, AgentState
import structlog


class QAAgentConfig(AgentConfig):
    """Configuration for the QA Agent."""
    test_frameworks: List[str] = ["pytest", "unittest", "jest"]
    coverage_threshold: float = 0.8
    max_test_time_seconds: int = 300
    enable_linting: bool = True
    enable_type_checking: bool = True


class QAAgent(BaseAgent):
    """Agent specialized in testing, validation, and quality assurance."""
    
    name = "qa"
    
    def __init__(
        self,
        config: Optional[QAAgentConfig] = None,
        tools: Optional[List] = None,
        memory = None,
    ):
        super().__init__(tools=tools, memory=memory)
        self.config = config or QAAgentConfig(name="qa")
        self._test_results: List[Dict[str, Any]] = []
    
    @property
    def description(self) -> str:
        return "Performs testing, validation, and quality assurance for code and data"
    
    @property
    def category(self) -> str:
        return "quality"
    
    @property
    def tools_used(self) -> List[str]:
        return ["code_execute", "shell", "file_read", "reason"]
    
    def get_system_prompt(self) -> str:
        return """You are the QA Agent, specialized in testing and quality assurance.
Your role is to:
1. Generate and run unit tests for code
2. Perform integration and end-to-end testing
3. Validate data integrity and correctness
4. Run linting and code quality checks
5. Measure and report test coverage
6. Identify bugs and quality issues

Testing capabilities:
- Unit testing (pytest, unittest, jest)
- Integration testing
- API testing
- Data validation
- Performance testing
- Regression testing

Quality checks:
- Code linting (pylint, eslint)
- Type checking (mypy, typescript)
- Security scanning
- Code complexity analysis
- Style guide compliance

Best practices:
- Test edge cases and error conditions
- Maintain high code coverage
- Write clear, maintainable tests
- Document test scenarios
- Report issues with reproduction steps"""
    
    async def run_tests(
        self,
        test_path: str,
        framework: str = "pytest"
    ) -> Dict[str, Any]:
        """Run tests in a directory or file."""
        if framework not in self.config.test_frameworks:
            return {"error": f"Framework '{framework}' not supported"}
        
        command = f"{framework} {test_path}"
        if framework == "pytest":
            command = f"python -m pytest {test_path} -v"
        elif framework == "jest":
            command = f"npx jest {test_path}"
        
        result = await self.execute_tool("shell", {
            "command": command,
            "timeout": self.config.max_test_time_seconds
        })
        
        test_result = {
            "framework": framework,
            "path": test_path,
            "success": result.success,
            "output": result.data if result.success else result.error
        }
        
        self._test_results.append(test_result)
        return test_result
    
    async def generate_tests(self, code: str, language: str = "python") -> str:
        """Generate tests for the given code."""
        result = await self.execute_tool("reason", {
            "task": f"Generate comprehensive unit tests for this {language} code",
            "context": {"code": code, "language": language}
        })
        
        if result.success and result.data is not None and isinstance(result.data, dict):
            return result.data.get("tests", "")
        return ""
    
    async def validate_data(self, data: Any, schema: Dict[str, Any]) -> Dict[str, Any]:
        """Validate data against a schema."""
        result = await self.execute_tool("reason", {
            "task": "Validate this data against the provided schema",
            "context": {"data": str(data)[:5000], "schema": schema}
        })
        
        if result.success and result.data is not None:
            return result.data if isinstance(result.data, dict) else {"result": result.data}
        return {"valid": False, "errors": [result.error]}
    
    async def run_linter(self, path: str, language: str = "python") -> Dict[str, Any]:
        """Run linting on a file or directory."""
        if not self.config.enable_linting:
            return {"error": "Linting disabled"}
        
        command = ""
        if language == "python":
            command = f"python -m pylint {path}"
        elif language in ["javascript", "typescript"]:
            command = f"npx eslint {path}"
        
        result = await self.execute_tool("shell", {"command": command, "timeout": 60})
        
        return {
            "language": language,
            "path": path,
            "issues": result.data if result.success else result.error
        }
    
    async def check_coverage(self, test_path: str) -> Dict[str, Any]:
        """Check test coverage."""
        result = await self.execute_tool("shell", {
            "command": f"python -m pytest {test_path} --cov --cov-report=json",
            "timeout": self.config.max_test_time_seconds
        })
        
        coverage_data = result.data if result.success else {}
        meets_threshold = coverage_data.get("coverage", 0) >= self.config.coverage_threshold
        
        return {
            "coverage": coverage_data,
            "meets_threshold": meets_threshold,
            "threshold": self.config.coverage_threshold
        }
    
    async def type_check(self, path: str) -> Dict[str, Any]:
        """Run type checking on a file or directory."""
        if not self.config.enable_type_checking:
            return {"error": "Type checking disabled"}
        
        result = await self.execute_tool("shell", {
            "command": f"python -m mypy {path}",
            "timeout": 120
        })
        
        return {
            "path": path,
            "issues": result.data if result.success else result.error,
            "success": result.success
        }
    
    async def run(self, task: str, context: Optional[Dict[str, Any]] = None) -> Dict[str, Any]:
        """Execute the QA agent's main loop."""
        self.state = AgentState.EXECUTING
        context = context or {}
        
        if "test" in task.lower() and "generate" in task.lower():
            code = context.get("code", "")
            tests = await self.generate_tests(code)
            return {"action": "generate_tests", "tests": tests}
        elif "test" in task.lower():
            path = context.get("path", ".")
            framework = context.get("framework", "pytest")
            result = await self.run_tests(path, framework)
            return {"action": "run_tests", "result": result}
        elif "lint" in task.lower():
            path = context.get("path", ".")
            language = context.get("language", "python")
            result = await self.run_linter(path, language)
            return {"action": "lint", "result": result}
        elif "coverage" in task.lower():
            path = context.get("path", ".")
            result = await self.check_coverage(path)
            return {"action": "coverage", "result": result}
        elif "type" in task.lower():
            path = context.get("path", ".")
            result = await self.type_check(path)
            return {"action": "type_check", "result": result}
        elif "validate" in task.lower():
            data = context.get("data")
            schema = context.get("schema", {})
            result = await self.validate_data(data, schema)
            return {"action": "validate", "result": result}
        else:
            path = context.get("path", ".")
            result = await self.run_tests(path)
            return {"action": "run_tests", "result": result}
    
    async def plan(self, task: str, context: Dict[str, Any]) -> List[str]:
        """Generate a plan for the QA task."""
        return [f"Execute QA task: {task}"]
    
    async def execute(self, task: str, context: Optional[Dict[str, Any]] = None) -> AgentResult:
        """Execute a QA task."""
        self.logger.info("qa_execute", task=task[:100] if task else "")
        self.state = AgentState.EXECUTING
        
        try:
            result = await self.run(task, context)
            self.state = AgentState.COMPLETED
            return AgentResult(
                success=True,
                data=result,
                metadata={"tests_run": len(self._test_results)}
            )
        except Exception as e:
            self.state = AgentState.ERROR
            self.logger.error("qa_error", error=str(e))
            return AgentResult(success=False, error=str(e))
    
    async def initialize(self) -> None:
        """Initialize the QA agent."""
        await super().initialize()
        self._test_results = []
        self.logger.info("qa_agent_initialized", frameworks=self.config.test_frameworks)
    
    async def shutdown(self) -> None:
        """Shutdown the QA agent."""
        self._test_results.clear()
        await super().shutdown()
        self.logger.info("qa_agent_shutdown")
