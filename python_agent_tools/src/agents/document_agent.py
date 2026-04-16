"""Document Agent - Document creation, parsing, and conversion."""

from typing import Any, Dict, List, Optional
from .base_agent import BaseAgent, AgentConfig, AgentResult, AgentState
import structlog


class DocumentAgentConfig(AgentConfig):
    """Configuration for the Document Agent."""
    supported_input_formats: List[str] = ["pdf", "docx", "txt", "html", "md"]
    supported_output_formats: List[str] = ["pdf", "docx", "txt", "html", "md"]
    max_document_size_mb: int = 50
    enable_ocr: bool = True


class DocumentAgent(BaseAgent):
    """Agent specialized in document creation, parsing, and conversion."""
    
    name = "document"
    
    def __init__(
        self,
        config: Optional[DocumentAgentConfig] = None,
        tools: Optional[List] = None,
        memory = None,
    ):
        super().__init__(tools=tools, memory=memory)
        self.config = config or DocumentAgentConfig(name="document")
        self._processed_documents: List[str] = []
    
    @property
    def description(self) -> str:
        return "Creates, parses, and converts documents in various formats"
    
    @property
    def category(self) -> str:
        return "documents"
    
    @property
    def tools_used(self) -> List[str]:
        return ["file_read", "file_write", "reason", "code_execute"]
    
    def get_system_prompt(self) -> str:
        return """You are the Document Agent, specialized in document processing.
Your role is to:
1. Create documents in various formats (PDF, DOCX, HTML, Markdown)
2. Parse and extract content from documents
3. Convert documents between formats
4. Apply templates and styling
5. Extract tables, images, and structured data
6. Merge and split documents

Supported formats:
- Input: PDF, DOCX, TXT, HTML, Markdown
- Output: PDF, DOCX, TXT, HTML, Markdown

Capabilities:
- Text extraction with formatting
- Table extraction to structured data
- Image extraction and embedding
- OCR for scanned documents
- Template-based generation
- Batch processing

Best practices:
- Preserve formatting when possible
- Handle encoding properly
- Validate document structure
- Handle large files efficiently"""
    
    async def create_document(
        self,
        content: str,
        format: str = "docx",
        template: Optional[str] = None
    ) -> Dict[str, Any]:
        """Create a new document."""
        if format not in self.config.supported_output_formats:
            return {"error": f"Format '{format}' not supported for output"}
        
        result = await self.execute_tool("reason", {
            "task": f"Generate document content in {format} format",
            "context": {"content": content, "template": template}
        })
        
        output_path = f"/tmp/document.{format}"
        
        write_result = await self.execute_tool("file_write", {
            "path": output_path,
            "content": (result.data.get("document", content) if result.success and result.data is not None and isinstance(result.data, dict) else content)
        })
        
        if write_result.success:
            self._processed_documents.append(output_path)
        
        return {"path": output_path, "success": write_result.success}
    
    async def parse_document(self, path: str) -> Dict[str, Any]:
        """Parse a document and extract its content."""
        result = await self.execute_tool("file_read", {"path": path})
        
        if not result.success:
            return {"error": result.error}
        
        parse_result = await self.execute_tool("reason", {
            "task": "Extract and structure the content from this document",
            "context": {"content": str(result.data)[:10000]}
        })
        
        if parse_result.success and parse_result.data is not None:
            return parse_result.data if isinstance(parse_result.data, dict) else {"result": parse_result.data}
        return {"raw_content": result.data}
    
    async def convert_document(
        self,
        input_path: str,
        output_format: str
    ) -> Dict[str, Any]:
        """Convert a document to a different format."""
        if output_format not in self.config.supported_output_formats:
            return {"error": f"Format '{output_format}' not supported for output"}
        
        read_result = await self.execute_tool("file_read", {"path": input_path})
        
        if not read_result.success:
            return {"error": read_result.error}
        
        convert_result = await self.execute_tool("reason", {
            "task": f"Convert this content to {output_format} format",
            "context": {"content": str(read_result.data)[:10000]}
        })
        
        output_path = input_path.rsplit(".", 1)[0] + f".{output_format}"
        
        write_result = await self.execute_tool("file_write", {
            "path": output_path,
            "content": (convert_result.data.get("converted", str(read_result.data)) if convert_result.success and convert_result.data is not None and isinstance(convert_result.data, dict) else str(read_result.data))
        })
        
        if write_result.success:
            self._processed_documents.append(output_path)
        
        return {"input": input_path, "output": output_path, "success": write_result.success}
    
    async def extract_tables(self, path: str) -> List[Dict[str, Any]]:
        """Extract tables from a document."""
        read_result = await self.execute_tool("file_read", {"path": path})
        
        if not read_result.success:
            return []
        
        extract_result = await self.execute_tool("reason", {
            "task": "Extract all tables from this document as structured data",
            "context": {"content": str(read_result.data)[:10000]}
        })
        
        if extract_result.success and extract_result.data is not None and isinstance(extract_result.data, dict):
            return extract_result.data.get("tables", [])
        return []
    
    async def merge_documents(self, paths: List[str], output_path: str) -> Dict[str, Any]:
        """Merge multiple documents into one."""
        contents = []
        for path in paths:
            result = await self.execute_tool("file_read", {"path": path})
            if result.success:
                contents.append(str(result.data))
        
        merged = "\n\n---\n\n".join(contents)
        
        write_result = await self.execute_tool("file_write", {
            "path": output_path,
            "content": merged
        })
        
        return {"merged_count": len(contents), "output": output_path, "success": write_result.success}
    
    async def run(self, task: str, context: Optional[Dict[str, Any]] = None) -> Dict[str, Any]:
        """Execute the document agent's main loop."""
        self.state = AgentState.EXECUTING
        context = context or {}
        
        if "create" in task.lower():
            content = context.get("content", "")
            format = context.get("format", "docx")
            result = await self.create_document(content, format)
            return {"action": "create", "result": result}
        elif "parse" in task.lower() or "extract" in task.lower():
            path = context.get("path", "")
            result = await self.parse_document(path)
            return {"action": "parse", "result": result}
        elif "convert" in task.lower():
            path = context.get("path", "")
            format = context.get("output_format", "pdf")
            result = await self.convert_document(path, format)
            return {"action": "convert", "result": result}
        elif "merge" in task.lower():
            paths = context.get("paths", [])
            output = context.get("output_path", "/tmp/merged.docx")
            result = await self.merge_documents(paths, output)
            return {"action": "merge", "result": result}
        elif "table" in task.lower():
            path = context.get("path", "")
            tables = await self.extract_tables(path)
            return {"action": "extract_tables", "tables": tables}
        else:
            content = context.get("content", task)
            result = await self.create_document(content)
            return {"action": "create", "result": result}
    
    async def plan(self, task: str, context: Dict[str, Any]) -> List[str]:
        """Generate a plan for the document task."""
        return [f"Execute document task: {task}"]
    
    async def execute(self, task: str, context: Optional[Dict[str, Any]] = None) -> AgentResult:
        """Execute a document task."""
        self.logger.info("document_execute", task=task[:100] if task else "")
        self.state = AgentState.EXECUTING
        
        try:
            result = await self.run(task, context)
            self.state = AgentState.COMPLETED
            return AgentResult(
                success=True,
                data=result,
                metadata={"processed_documents": len(self._processed_documents)}
            )
        except Exception as e:
            self.state = AgentState.ERROR
            self.logger.error("document_error", error=str(e))
            return AgentResult(success=False, error=str(e))
    
    async def initialize(self) -> None:
        """Initialize the document agent."""
        await super().initialize()
        self._processed_documents = []
        self.logger.info("document_agent_initialized", formats=self.config.supported_output_formats)
    
    async def shutdown(self) -> None:
        """Shutdown the document agent."""
        self._processed_documents.clear()
        await super().shutdown()
        self.logger.info("document_agent_shutdown")
