from typing import Optional, Dict, Any, List
from pydantic import Field
from .base import BaseTool, ToolCategory, Priority, ToolInput, ToolOutput
from ..core.registry import ToolRegistry
import asyncio
import tempfile
import os
import sys

class CodeExecuteInput(ToolInput):
    code: str = Field(..., description="Python code to execute")
    timeout: int = Field(30, ge=1, le=120, description="Execution timeout in seconds")
    allowed_imports: Optional[List[str]] = Field(
        default=["math", "json", "datetime", "re", "collections", "itertools", "functools"],
        description="List of allowed module imports"
    )

class CodeExecuteOutput(ToolOutput):
    stdout: Optional[str] = None
    stderr: Optional[str] = None
    return_value: Optional[Any] = None
    execution_time: Optional[float] = None

DANGEROUS_BUILTINS = [
    "exec", "eval", "compile", "__import__", "open", "input",
    "breakpoint", "memoryview", "globals", "locals", "vars"
]

DANGEROUS_PATTERNS = [
    "import os", "import sys", "import subprocess", "import shutil",
    "from os", "from sys", "from subprocess", "from shutil",
    "__builtins__", "__class__", "__bases__", "__subclasses__",
    "getattr", "setattr", "delattr", "hasattr",
    "importlib", "pickle", "marshal", "ctypes", "multiprocessing"
]

@ToolRegistry.register
class CodeExecuteTool(BaseTool[CodeExecuteInput, CodeExecuteOutput]):
    name = "code_execute"
    description = "Executes Python code in a sandboxed environment"
    category = ToolCategory.SYSTEM
    priority = Priority.CRITICAL
    dependencies = []
    
    def _validate_code(self, code: str, allowed_imports: List[str]) -> Optional[str]:
        for pattern in DANGEROUS_PATTERNS:
            if pattern in code:
                return f"Dangerous pattern detected: {pattern}"
        
        lines = code.split('\n')
        for line in lines:
            stripped = line.strip()
            if stripped.startswith('import ') or stripped.startswith('from '):
                parts = stripped.replace('from ', '').replace('import ', '').split()[0]
                module = parts.split('.')[0]
                if module not in allowed_imports:
                    return f"Import not allowed: {module}"
        
        return None
    
    def _create_safe_globals(self, allowed_imports: List[str]) -> Dict[str, Any]:
        safe_builtins = {
            k: v for k, v in __builtins__.items() 
            if isinstance(__builtins__, dict) and k not in DANGEROUS_BUILTINS
        } if isinstance(__builtins__, dict) else {
            k: getattr(__builtins__, k) for k in dir(__builtins__)
            if not k.startswith('_') and k not in DANGEROUS_BUILTINS
        }
        
        safe_globals = {
            "__builtins__": safe_builtins,
            "__name__": "__sandbox__",
            "__doc__": None,
        }
        
        for module_name in allowed_imports:
            try:
                safe_globals[module_name] = __import__(module_name)
            except ImportError:
                pass
        
        return safe_globals
    
    async def execute(self, input: CodeExecuteInput) -> CodeExecuteOutput:
        self.logger.info("code_execute", code_length=len(input.code))
        
        allowed = input.allowed_imports or []
        validation_error = self._validate_code(input.code, allowed)
        if validation_error:
            return CodeExecuteOutput(success=False, error=validation_error)
        
        import time
        start_time = time.time()
        
        try:
            with tempfile.NamedTemporaryFile(mode='w', suffix='.py', delete=False) as f:
                f.write(input.code)
                temp_file = f.name
            
            try:
                proc = await asyncio.create_subprocess_exec(
                    sys.executable, '-u', temp_file,
                    stdout=asyncio.subprocess.PIPE,
                    stderr=asyncio.subprocess.PIPE,
                    env={**os.environ, "PYTHONDONTWRITEBYTECODE": "1"}
                )
                
                stdout, stderr = await asyncio.wait_for(
                    proc.communicate(), 
                    timeout=input.timeout
                )
                
                execution_time = time.time() - start_time
                
                return CodeExecuteOutput(
                    success=proc.returncode == 0,
                    stdout=stdout.decode() if stdout else None,
                    stderr=stderr.decode() if stderr else None,
                    execution_time=execution_time,
                    error=stderr.decode() if proc.returncode != 0 and stderr else None
                )
                
            finally:
                try:
                    os.unlink(temp_file)
                except OSError:
                    pass
                    
        except asyncio.TimeoutError:
            return CodeExecuteOutput(
                success=False, 
                error=f"Execution timed out after {input.timeout} seconds",
                execution_time=input.timeout
            )
        except Exception as e:
            return CodeExecuteOutput(success=False, error=str(e))
