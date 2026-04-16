"""Secure shell command execution with strict whitelisting."""
from typing import Optional, List, Tuple, Dict, Callable, Awaitable
from pydantic import Field
from .base import BaseTool, ToolCategory, Priority, ToolInput, ToolOutput
from ..core.registry import ToolRegistry
import asyncio
import shlex
import os
import re

class ShellInput(ToolInput):
    command: str = Field(..., description="Command to execute", max_length=1000)
    timeout: int = Field(30, ge=1, le=300)
    working_dir: Optional[str] = Field(None, max_length=500)

class ShellOutput(ToolOutput):
    stdout: Optional[str] = None
    stderr: Optional[str] = None
    return_code: Optional[int] = None


class SecureCommandExecutor:
    """
    Secure command executor with hardcoded paths and strict validation.
    Each command has a dedicated execution method to prevent injection.
    """
    
    FORBIDDEN_CHARS = re.compile(r'[;&|`$<>\\]|\.\.')
    MAX_ARG_LEN = 500
    ALLOWED_DIRS: Tuple[str, ...] = ("/tmp", "/home", "/var/log")
    
    @staticmethod
    def _sanitize_arg(arg: str) -> Optional[str]:
        """Validate and sanitize a single argument. Returns None if invalid."""
        if not arg or len(arg) > SecureCommandExecutor.MAX_ARG_LEN:
            return None
        if SecureCommandExecutor.FORBIDDEN_CHARS.search(arg):
            return None
        return arg
    
    @staticmethod
    def _validate_args(args: List[str]) -> Tuple[bool, List[str]]:
        """Validate all arguments. Returns (success, sanitized_args)."""
        sanitized = []
        for arg in args:
            clean = SecureCommandExecutor._sanitize_arg(arg)
            if clean is None:
                return False, []
            sanitized.append(clean)
        return True, sanitized
    
    @staticmethod
    def _validate_cwd(cwd: Optional[str]) -> Optional[str]:
        """Validate and normalize working directory."""
        if cwd is None:
            return None
        try:
            normalized = os.path.normpath(os.path.abspath(cwd))
        except (ValueError, TypeError):
            return None
        if not any(normalized.startswith(d) for d in SecureCommandExecutor.ALLOWED_DIRS):
            return None
        if not os.path.isdir(normalized):
            return None
        return normalized
    
    @staticmethod
    def _prepare_execution(
        args: List[str],
        cwd: Optional[str]
    ) -> Tuple[bool, List[str], Optional[str], Optional[str]]:
        """Validate arguments and working directory before execution.
        
        Returns: (success, clean_args, safe_cwd, error_message)
        """
        valid, clean_args = SecureCommandExecutor._validate_args(args)
        if not valid:
            return False, [], None, "Invalid arguments"
        
        safe_cwd = SecureCommandExecutor._validate_cwd(cwd)
        if cwd is not None and safe_cwd is None:
            return False, [], None, "Invalid working directory"
        
        return True, clean_args, safe_cwd, None

    @staticmethod
    async def _execute_process(
        proc: asyncio.subprocess.Process,
        timeout: int
    ) -> Tuple[bool, Optional[str], Optional[str], Optional[int]]:
        """Handle process communication and result extraction."""
        try:
            stdout, stderr = await asyncio.wait_for(
                proc.communicate(), 
                timeout=timeout
            )
            return (
                proc.returncode == 0,
                stdout.decode(errors='replace') if stdout else None,
                stderr.decode(errors='replace') if stderr else None,
                proc.returncode
            )
        except asyncio.TimeoutError:
            return False, None, "Command timed out", None

    @staticmethod
    async def exec_ls(args: List[str], cwd: Optional[str], timeout: int):
        """Execute /bin/ls with validated arguments."""
        valid, clean_args, safe_cwd, error = SecureCommandExecutor._prepare_execution(args, cwd)
        if not valid:
            return False, None, error, None
        try:
            proc = await asyncio.create_subprocess_exec(
                "/bin/ls",
                *clean_args,
                stdout=asyncio.subprocess.PIPE,
                stderr=asyncio.subprocess.PIPE,
                cwd=safe_cwd,
                env={"PATH": "/bin:/usr/bin", "HOME": "/tmp", "LANG": "C.UTF-8"}
            )
            return await SecureCommandExecutor._execute_process(proc, timeout)
        except (FileNotFoundError, PermissionError, OSError) as e:
            return False, None, str(e), None
    
    @staticmethod
    async def exec_cat(args: List[str], cwd: Optional[str], timeout: int):
        """Execute /bin/cat with validated arguments."""
        valid, clean_args, safe_cwd, error = SecureCommandExecutor._prepare_execution(args, cwd)
        if not valid:
            return False, None, error, None
        try:
            proc = await asyncio.create_subprocess_exec(
                "/bin/cat",
                *clean_args,
                stdout=asyncio.subprocess.PIPE,
                stderr=asyncio.subprocess.PIPE,
                cwd=safe_cwd,
                env={"PATH": "/bin:/usr/bin", "HOME": "/tmp", "LANG": "C.UTF-8"}
            )
            return await SecureCommandExecutor._execute_process(proc, timeout)
        except (FileNotFoundError, PermissionError, OSError) as e:
            return False, None, str(e), None
    
    @staticmethod
    async def exec_grep(args: List[str], cwd: Optional[str], timeout: int):
        """Execute /bin/grep with validated arguments."""
        valid, clean_args, safe_cwd, error = SecureCommandExecutor._prepare_execution(args, cwd)
        if not valid:
            return False, None, error, None
        try:
            proc = await asyncio.create_subprocess_exec(
                "/bin/grep",
                *clean_args,
                stdout=asyncio.subprocess.PIPE,
                stderr=asyncio.subprocess.PIPE,
                cwd=safe_cwd,
                env={"PATH": "/bin:/usr/bin", "HOME": "/tmp", "LANG": "C.UTF-8"}
            )
            return await SecureCommandExecutor._execute_process(proc, timeout)
        except (FileNotFoundError, PermissionError, OSError) as e:
            return False, None, str(e), None
    
    @staticmethod
    async def exec_find(args: List[str], cwd: Optional[str], timeout: int):
        """Execute /usr/bin/find with validated arguments."""
        valid, clean_args, safe_cwd, error = SecureCommandExecutor._prepare_execution(args, cwd)
        if not valid:
            return False, None, error, None
        try:
            proc = await asyncio.create_subprocess_exec(
                "/usr/bin/find",
                *clean_args,
                stdout=asyncio.subprocess.PIPE,
                stderr=asyncio.subprocess.PIPE,
                cwd=safe_cwd,
                env={"PATH": "/bin:/usr/bin", "HOME": "/tmp", "LANG": "C.UTF-8"}
            )
            return await SecureCommandExecutor._execute_process(proc, timeout)
        except (FileNotFoundError, PermissionError, OSError) as e:
            return False, None, str(e), None
    
    @staticmethod
    async def exec_echo(args: List[str], cwd: Optional[str], timeout: int):
        """Execute /bin/echo with validated arguments."""
        valid, clean_args, safe_cwd, error = SecureCommandExecutor._prepare_execution(args, cwd)
        if not valid:
            return False, None, error, None
        try:
            proc = await asyncio.create_subprocess_exec(
                "/bin/echo",
                *clean_args,
                stdout=asyncio.subprocess.PIPE,
                stderr=asyncio.subprocess.PIPE,
                cwd=safe_cwd,
                env={"PATH": "/bin:/usr/bin", "HOME": "/tmp", "LANG": "C.UTF-8"}
            )
            return await SecureCommandExecutor._execute_process(proc, timeout)
        except (FileNotFoundError, PermissionError, OSError) as e:
            return False, None, str(e), None
    
    @staticmethod
    async def exec_pwd(args: List[str], cwd: Optional[str], timeout: int):
        """Execute /bin/pwd with validated arguments."""
        valid, clean_args, safe_cwd, error = SecureCommandExecutor._prepare_execution(args, cwd)
        if not valid:
            return False, None, error, None
        try:
            proc = await asyncio.create_subprocess_exec(
                "/bin/pwd",
                *clean_args,
                stdout=asyncio.subprocess.PIPE,
                stderr=asyncio.subprocess.PIPE,
                cwd=safe_cwd,
                env={"PATH": "/bin:/usr/bin", "HOME": "/tmp", "LANG": "C.UTF-8"}
            )
            return await SecureCommandExecutor._execute_process(proc, timeout)
        except (FileNotFoundError, PermissionError, OSError) as e:
            return False, None, str(e), None
    
    @staticmethod
    async def exec_head(args: List[str], cwd: Optional[str], timeout: int):
        """Execute /usr/bin/head with validated arguments."""
        valid, clean_args, safe_cwd, error = SecureCommandExecutor._prepare_execution(args, cwd)
        if not valid:
            return False, None, error, None
        try:
            proc = await asyncio.create_subprocess_exec(
                "/usr/bin/head",
                *clean_args,
                stdout=asyncio.subprocess.PIPE,
                stderr=asyncio.subprocess.PIPE,
                cwd=safe_cwd,
                env={"PATH": "/bin:/usr/bin", "HOME": "/tmp", "LANG": "C.UTF-8"}
            )
            return await SecureCommandExecutor._execute_process(proc, timeout)
        except (FileNotFoundError, PermissionError, OSError) as e:
            return False, None, str(e), None
    
    @staticmethod
    async def exec_tail(args: List[str], cwd: Optional[str], timeout: int):
        """Execute /usr/bin/tail with validated arguments."""
        valid, clean_args, safe_cwd, error = SecureCommandExecutor._prepare_execution(args, cwd)
        if not valid:
            return False, None, error, None
        try:
            proc = await asyncio.create_subprocess_exec(
                "/usr/bin/tail",
                *clean_args,
                stdout=asyncio.subprocess.PIPE,
                stderr=asyncio.subprocess.PIPE,
                cwd=safe_cwd,
                env={"PATH": "/bin:/usr/bin", "HOME": "/tmp", "LANG": "C.UTF-8"}
            )
            return await SecureCommandExecutor._execute_process(proc, timeout)
        except (FileNotFoundError, PermissionError, OSError) as e:
            return False, None, str(e), None
    
    @staticmethod
    async def exec_wc(args: List[str], cwd: Optional[str], timeout: int):
        """Execute /usr/bin/wc with validated arguments."""
        valid, clean_args, safe_cwd, error = SecureCommandExecutor._prepare_execution(args, cwd)
        if not valid:
            return False, None, error, None
        try:
            proc = await asyncio.create_subprocess_exec(
                "/usr/bin/wc",
                *clean_args,
                stdout=asyncio.subprocess.PIPE,
                stderr=asyncio.subprocess.PIPE,
                cwd=safe_cwd,
                env={"PATH": "/bin:/usr/bin", "HOME": "/tmp", "LANG": "C.UTF-8"}
            )
            return await SecureCommandExecutor._execute_process(proc, timeout)
        except (FileNotFoundError, PermissionError, OSError) as e:
            return False, None, str(e), None


# Command dispatcher mapping - only these commands can be executed
COMMAND_DISPATCH: Dict[str, Callable[[List[str], Optional[str], int], Awaitable]] = {
    "ls": SecureCommandExecutor.exec_ls,
    "cat": SecureCommandExecutor.exec_cat,
    "grep": SecureCommandExecutor.exec_grep,
    "find": SecureCommandExecutor.exec_find,
    "echo": SecureCommandExecutor.exec_echo,
    "pwd": SecureCommandExecutor.exec_pwd,
    "head": SecureCommandExecutor.exec_head,
    "tail": SecureCommandExecutor.exec_tail,
    "wc": SecureCommandExecutor.exec_wc,
}


@ToolRegistry.register
class ShellTool(BaseTool[ShellInput, ShellOutput]):
    """
    Secure shell command execution tool.
    
    Security features:
    - Strict command whitelist with hardcoded paths
    - Dedicated execution methods per command (no dynamic path resolution)
    - Argument validation and sanitization
    - Restricted environment variables
    - Working directory validation
    - Timeout enforcement
    """
    
    name = "shell"
    description = "Executes shell commands safely with strict whitelisting"
    category = ToolCategory.SYSTEM
    priority = Priority.CRITICAL
    dependencies = []
    
    async def execute(self, input: ShellInput) -> ShellOutput:
        self.logger.info("shell_execute", command=input.command[:50])
        
        try:
            cmd_parts = shlex.split(input.command)
        except ValueError as e:
            return ShellOutput(success=False, error=f"Invalid command syntax: {e}")
        
        if not cmd_parts:
            return ShellOutput(success=False, error="Empty command")
        
        cmd_name = os.path.basename(cmd_parts[0])
        executor = COMMAND_DISPATCH.get(cmd_name)
        
        if executor is None:
            allowed = ", ".join(sorted(COMMAND_DISPATCH.keys()))
            return ShellOutput(
                success=False, 
                error=f"Command not allowed: {cmd_name}. Allowed: {allowed}"
            )
        
        args = cmd_parts[1:] if len(cmd_parts) > 1 else []
        
        success, stdout, stderr, return_code = await executor(
            args, 
            input.working_dir, 
            input.timeout
        )
        
        if not success and stderr:
            return ShellOutput(
                success=False,
                error=stderr,
                stdout=stdout,
                return_code=return_code
            )
        
        return ShellOutput(
            success=success,
            stdout=stdout,
            stderr=stderr,
            return_code=return_code
        )
