"""Security Agent - Security scanning, input validation, and secrets management."""

from typing import Any, Dict, List, Optional
from .base_agent import BaseAgent, AgentConfig, AgentResult, AgentState
import structlog


class SecurityAgentConfig(AgentConfig):
    """Configuration for the Security Agent."""
    scan_depth: str = "standard"
    enable_secrets_detection: bool = True
    vulnerability_threshold: str = "medium"
    allowed_domains: List[str] = []
    blocked_patterns: List[str] = []


class SecurityAgent(BaseAgent):
    """Agent specialized in security scanning, input validation, and secrets management."""
    
    name = "security"
    
    def __init__(
        self,
        config: Optional[SecurityAgentConfig] = None,
        tools: Optional[List] = None,
        memory = None,
    ):
        super().__init__(tools=tools, memory=memory)
        self.config = config or SecurityAgentConfig(name="security")
        self._scan_results: List[Dict[str, Any]] = []
        self._blocked_attempts: int = 0
    
    @property
    def description(self) -> str:
        return "Performs security scanning, input validation, and secrets management"
    
    @property
    def category(self) -> str:
        return "security"
    
    @property
    def tools_used(self) -> List[str]:
        return ["sanitize_input", "secrets_manage", "shell", "reason", "file_read"]
    
    def get_system_prompt(self) -> str:
        return """You are the Security Agent, specialized in security and protection.
Your role is to:
1. Scan code and systems for vulnerabilities
2. Validate and sanitize user inputs
3. Manage secrets and credentials securely
4. Detect and prevent security threats
5. Enforce security policies and best practices
6. Generate security reports and recommendations

Security capabilities:
- Vulnerability scanning (OWASP, CVE)
- Secrets detection in code
- Input validation and sanitization
- SQL injection prevention
- XSS protection
- Access control verification

Threat detection:
- Malicious patterns
- Data exfiltration attempts
- Unauthorized access
- Injection attacks
- Credential exposure

Best practices:
- Defense in depth
- Principle of least privilege
- Input validation at all boundaries
- Secure secret storage
- Regular security audits"""
    
    async def scan_code(self, path: str) -> Dict[str, Any]:
        """Scan code for security vulnerabilities."""
        read_result = await self.execute_tool("file_read", {"path": path})
        
        if not read_result.success:
            return {"error": read_result.error}
        
        scan_result = await self.execute_tool("reason", {
            "task": "Analyze this code for security vulnerabilities",
            "context": {"code": str(read_result.data)[:10000]}
        })
        
        vulnerabilities: List[Any] = []
        severity = "error"
        if scan_result.success and scan_result.data is not None and isinstance(scan_result.data, dict):
            vulnerabilities = scan_result.data.get("vulnerabilities", [])
            severity = scan_result.data.get("severity", "unknown")
        
        result = {
            "path": path,
            "vulnerabilities": vulnerabilities,
            "severity": severity
        }
        
        self._scan_results.append(result)
        return result
    
    async def validate_input(self, input_data: str, input_type: str = "text") -> Dict[str, Any]:
        """Validate and sanitize user input."""
        result = await self.execute_tool("sanitize_input", {
            "input": input_data,
            "type": input_type,
            "blocked_patterns": self.config.blocked_patterns
        })
        
        if not result.success:
            self._blocked_attempts += 1
        
        sanitized = None
        threats_detected: List[Any] = [result.error] if result.error else []
        if result.success and result.data is not None and isinstance(result.data, dict):
            sanitized = result.data.get("sanitized", input_data)
            threats_detected = result.data.get("threats", [])
        
        return {
            "original": input_data,
            "sanitized": sanitized,
            "is_safe": result.success,
            "threats_detected": threats_detected
        }
    
    async def manage_secret(
        self,
        action: str,
        key: str,
        value: Optional[str] = None
    ) -> Dict[str, Any]:
        """Manage secrets (get, set, delete)."""
        if not self.config.enable_secrets_detection:
            return {"error": "Secrets management disabled"}
        
        result = await self.execute_tool("secrets_manage", {
            "action": action,
            "key": key,
            "value": value
        })
        
        if result.success and result.data is not None:
            return result.data if isinstance(result.data, dict) else {"result": result.data}
        return {"error": result.error}
    
    async def detect_secrets(self, content: str) -> List[Dict[str, Any]]:
        """Detect exposed secrets in content."""
        result = await self.execute_tool("reason", {
            "task": "Detect any exposed secrets, API keys, passwords, or credentials in this content",
            "context": {"content": content[:10000]}
        })
        
        if result.success and result.data is not None and isinstance(result.data, dict):
            return result.data.get("secrets_found", [])
        return []
    
    async def check_dependencies(self, path: str) -> Dict[str, Any]:
        """Check dependencies for known vulnerabilities."""
        result = await self.execute_tool("shell", {
            "command": f"pip-audit || npm audit",
            "timeout": 120
        })
        
        return {
            "path": path,
            "vulnerabilities": result.data if result.success else result.error,
            "success": result.success
        }
    
    async def generate_report(self) -> Dict[str, Any]:
        """Generate a security report from scan results."""
        total_vulns = sum(len(r.get("vulnerabilities", [])) for r in self._scan_results)
        
        return {
            "total_scans": len(self._scan_results),
            "total_vulnerabilities": total_vulns,
            "blocked_attempts": self._blocked_attempts,
            "results": self._scan_results,
            "recommendations": await self._generate_recommendations()
        }
    
    async def _generate_recommendations(self) -> List[str]:
        """Generate security recommendations based on scan results."""
        if not self._scan_results:
            return ["No scans performed yet"]
        
        result = await self.execute_tool("reason", {
            "task": "Generate security recommendations based on these scan results",
            "context": {"results": self._scan_results}
        })
        
        if result.success and result.data is not None and isinstance(result.data, dict):
            return result.data.get("recommendations", [])
        return []
    
    async def run(self, task: str, context: Optional[Dict[str, Any]] = None) -> Dict[str, Any]:
        """Execute the security agent's main loop."""
        self.state = AgentState.EXECUTING
        context = context or {}
        
        if "scan" in task.lower():
            path = context.get("path", ".")
            result = await self.scan_code(path)
            return {"action": "scan", "result": result}
        elif "validate" in task.lower() or "sanitize" in task.lower():
            input_data = context.get("input", "")
            input_type = context.get("type", "text")
            result = await self.validate_input(input_data, input_type)
            return {"action": "validate", "result": result}
        elif "secret" in task.lower():
            action = context.get("action", "get")
            key = context.get("key", "")
            value = context.get("value")
            result = await self.manage_secret(action, key, value)
            return {"action": "manage_secret", "result": result}
        elif "detect" in task.lower():
            content = context.get("content", "")
            secrets = await self.detect_secrets(content)
            return {"action": "detect_secrets", "secrets": secrets}
        elif "dependencies" in task.lower() or "audit" in task.lower():
            path = context.get("path", ".")
            result = await self.check_dependencies(path)
            return {"action": "check_dependencies", "result": result}
        elif "report" in task.lower():
            report = await self.generate_report()
            return {"action": "report", "report": report}
        else:
            path = context.get("path", ".")
            result = await self.scan_code(path)
            return {"action": "scan", "result": result}
    
    async def plan(self, task: str, context: Dict[str, Any]) -> List[str]:
        """Generate a plan for the security task."""
        return [f"Execute security task: {task}"]
    
    async def execute(self, task: str, context: Optional[Dict[str, Any]] = None) -> AgentResult:
        """Execute a security task."""
        self.logger.info("security_execute", task=task[:100] if task else "")
        self.state = AgentState.EXECUTING
        
        try:
            result = await self.run(task, context)
            self.state = AgentState.COMPLETED
            return AgentResult(
                success=True,
                data=result,
                metadata={
                    "scans_performed": len(self._scan_results),
                    "blocked_attempts": self._blocked_attempts
                }
            )
        except Exception as e:
            self.state = AgentState.ERROR
            self.logger.error("security_error", error=str(e))
            return AgentResult(success=False, error=str(e))
    
    async def initialize(self) -> None:
        """Initialize the security agent."""
        await super().initialize()
        self._scan_results = []
        self._blocked_attempts = 0
        self.logger.info("security_agent_initialized", threshold=self.config.vulnerability_threshold)
    
    async def shutdown(self) -> None:
        """Shutdown the security agent."""
        self._scan_results.clear()
        await super().shutdown()
        self.logger.info("security_agent_shutdown")
