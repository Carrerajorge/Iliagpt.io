from typing import Optional, List
from pydantic import Field
from .base import BaseTool, ToolCategory, Priority, ToolInput, ToolOutput
from ..core.registry import ToolRegistry
import os
import aiofiles

ALLOWED_BASE_PATHS = [
    "/tmp",
    os.path.expanduser("~"),
    os.getcwd(),
]

MAX_FILE_SIZE = 10 * 1024 * 1024  # 10MB

BLOCKED_EXTENSIONS = [".exe", ".dll", ".so", ".dylib", ".sh", ".bash", ".zsh"]

def validate_path(path: str) -> Optional[str]:
    try:
        abs_path = os.path.abspath(os.path.expanduser(path))
    except Exception as e:
        return f"Invalid path: {e}"
    
    if ".." in path:
        return "Path traversal detected: '..' not allowed"
    
    normalized = os.path.normpath(abs_path)
    if normalized != abs_path.rstrip('/'):
        return "Path contains traversal sequences"
    
    allowed = False
    for base in ALLOWED_BASE_PATHS:
        try:
            base_abs = os.path.abspath(base)
            if normalized.startswith(base_abs):
                allowed = True
                break
        except Exception:
            continue
    
    if not allowed:
        return f"Path not in allowed directories: {ALLOWED_BASE_PATHS}"
    
    return None

class FileReadInput(ToolInput):
    path: str = Field(..., description="File path to read")
    encoding: str = Field("utf-8", description="File encoding")
    max_size: int = Field(MAX_FILE_SIZE, description="Maximum file size to read")

class FileReadOutput(ToolOutput):
    content: Optional[str] = None
    size: Optional[int] = None
    path: Optional[str] = None

@ToolRegistry.register
class FileReadTool(BaseTool[FileReadInput, FileReadOutput]):
    name = "file_read"
    description = "Reads file content safely with path validation"
    category = ToolCategory.FILES
    priority = Priority.CRITICAL
    dependencies = []
    
    async def execute(self, input: FileReadInput) -> FileReadOutput:
        self.logger.info("file_read", path=input.path)
        
        path_error = validate_path(input.path)
        if path_error:
            return FileReadOutput(success=False, error=path_error)
        
        abs_path = os.path.abspath(os.path.expanduser(input.path))
        
        if not os.path.exists(abs_path):
            return FileReadOutput(success=False, error=f"File not found: {abs_path}")
        
        if not os.path.isfile(abs_path):
            return FileReadOutput(success=False, error=f"Not a file: {abs_path}")
        
        try:
            file_size = os.path.getsize(abs_path)
            if file_size > input.max_size:
                return FileReadOutput(
                    success=False, 
                    error=f"File too large: {file_size} bytes (max: {input.max_size})"
                )
            
            async with aiofiles.open(abs_path, 'r', encoding=input.encoding) as f:
                content = await f.read()
            
            return FileReadOutput(
                success=True,
                content=content,
                size=file_size,
                path=abs_path
            )
            
        except UnicodeDecodeError as e:
            return FileReadOutput(success=False, error=f"Encoding error: {e}")
        except PermissionError:
            return FileReadOutput(success=False, error=f"Permission denied: {abs_path}")
        except Exception as e:
            return FileReadOutput(success=False, error=str(e))

class FileWriteInput(ToolInput):
    path: str = Field(..., description="File path to write")
    content: str = Field(..., description="Content to write")
    encoding: str = Field("utf-8", description="File encoding")
    create_dirs: bool = Field(False, description="Create parent directories if needed")
    overwrite: bool = Field(False, description="Allow overwriting existing files")

class FileWriteOutput(ToolOutput):
    bytes_written: Optional[int] = None
    path: Optional[str] = None

@ToolRegistry.register
class FileWriteTool(BaseTool[FileWriteInput, FileWriteOutput]):
    name = "file_write"
    description = "Writes content to file safely with path validation"
    category = ToolCategory.FILES
    priority = Priority.CRITICAL
    dependencies = []
    
    async def execute(self, input: FileWriteInput) -> FileWriteOutput:
        self.logger.info("file_write", path=input.path, size=len(input.content))
        
        path_error = validate_path(input.path)
        if path_error:
            return FileWriteOutput(success=False, error=path_error)
        
        abs_path = os.path.abspath(os.path.expanduser(input.path))
        
        _, ext = os.path.splitext(abs_path)
        if ext.lower() in BLOCKED_EXTENSIONS:
            return FileWriteOutput(success=False, error=f"File extension not allowed: {ext}")
        
        if os.path.exists(abs_path) and not input.overwrite:
            return FileWriteOutput(
                success=False, 
                error=f"File exists and overwrite=False: {abs_path}"
            )
        
        parent_dir = os.path.dirname(abs_path)
        if not os.path.exists(parent_dir):
            if input.create_dirs:
                try:
                    os.makedirs(parent_dir, exist_ok=True)
                except Exception as e:
                    return FileWriteOutput(success=False, error=f"Cannot create directory: {e}")
            else:
                return FileWriteOutput(
                    success=False, 
                    error=f"Parent directory does not exist: {parent_dir}"
                )
        
        if len(input.content) > MAX_FILE_SIZE:
            return FileWriteOutput(
                success=False,
                error=f"Content too large: {len(input.content)} bytes (max: {MAX_FILE_SIZE})"
            )
        
        try:
            async with aiofiles.open(abs_path, 'w', encoding=input.encoding) as f:
                await f.write(input.content)
            
            return FileWriteOutput(
                success=True,
                bytes_written=len(input.content.encode(input.encoding)),
                path=abs_path
            )
            
        except PermissionError:
            return FileWriteOutput(success=False, error=f"Permission denied: {abs_path}")
        except Exception as e:
            return FileWriteOutput(success=False, error=str(e))
