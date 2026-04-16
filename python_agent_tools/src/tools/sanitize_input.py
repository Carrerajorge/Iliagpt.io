from typing import Optional, List
from pydantic import Field
from .base import BaseTool, ToolCategory, Priority, ToolInput, ToolOutput
from ..core.registry import ToolRegistry
import re
import html

class SanitizeInput(ToolInput):
    text: str
    sanitize_html: bool = True
    check_sql_injection: bool = True
    check_path_traversal: bool = True
    check_command_injection: bool = True

class SanitizeOutput(ToolOutput):
    sanitized_text: Optional[str] = None
    warnings: List[str] = []
    is_safe: bool = True

@ToolRegistry.register
class SanitizeInputTool(BaseTool[SanitizeInput, SanitizeOutput]):
    name = "sanitize_input"
    description = "Sanitizes and validates user input for security"
    category = ToolCategory.SECURITY
    priority = Priority.CRITICAL
    dependencies = []
    
    SQL_PATTERNS = [r"('|\")\s*(or|and)\s*('|\"|\d)", r";\s*(drop|delete|update|insert)", r"union\s+select"]
    PATH_PATTERNS = [r"\.\./", r"\.\.\\", r"%2e%2e"]
    CMD_PATTERNS = [r"[;&|`$]", r"\$\(", r"`"]
    
    async def execute(self, input: SanitizeInput) -> SanitizeOutput:
        self.logger.info("sanitize_input", length=len(input.text))
        warnings = []
        text = input.text
        is_safe = True
        
        if input.sanitize_html:
            text = html.escape(text)
        
        if input.check_sql_injection:
            for pattern in self.SQL_PATTERNS:
                if re.search(pattern, input.text, re.IGNORECASE):
                    warnings.append(f"Potential SQL injection detected")
                    is_safe = False
                    break
        
        if input.check_path_traversal:
            for pattern in self.PATH_PATTERNS:
                if re.search(pattern, input.text, re.IGNORECASE):
                    warnings.append("Path traversal attempt detected")
                    is_safe = False
                    break
        
        if input.check_command_injection:
            for pattern in self.CMD_PATTERNS:
                if re.search(pattern, input.text):
                    warnings.append("Command injection attempt detected")
                    is_safe = False
                    break
        
        return SanitizeOutput(
            success=True,
            sanitized_text=text,
            warnings=warnings,
            is_safe=is_safe
        )
