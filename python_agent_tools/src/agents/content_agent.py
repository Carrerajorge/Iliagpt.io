"""Content Agent - Text generation, editing, and summarization."""

from typing import Any, Dict, List, Optional
from .base_agent import BaseAgent, AgentConfig, AgentResult, AgentState
import structlog


class ContentAgentConfig(AgentConfig):
    """Configuration for the Content Agent."""
    default_tone: str = "professional"
    max_output_length: int = 4000
    supported_formats: List[str] = ["text", "markdown", "html"]
    enable_translation: bool = True


class ContentAgent(BaseAgent):
    """Agent specialized in text generation, editing, and summarization."""
    
    name = "content"
    
    def __init__(
        self,
        config: Optional[ContentAgentConfig] = None,
        tools: Optional[List] = None,
        memory = None,
    ):
        super().__init__(tools=tools, memory=memory)
        self.config = config or ContentAgentConfig(name="content")
    
    @property
    def description(self) -> str:
        return "Generates, edits, and summarizes text content in various formats and styles"
    
    @property
    def category(self) -> str:
        return "content"
    
    @property
    def tools_used(self) -> List[str]:
        return ["reason", "file_read", "file_write"]
    
    def get_system_prompt(self) -> str:
        return """You are the Content Agent, specialized in text content creation and editing.
Your role is to:
1. Generate high-quality written content for various purposes
2. Edit and proofread text for clarity, grammar, and style
3. Summarize long documents into concise overviews
4. Adapt content for different audiences and formats
5. Translate content between languages (if enabled)
6. Maintain consistent tone and voice

Content types:
- Articles and blog posts
- Technical documentation
- Marketing copy
- Reports and summaries
- Emails and communications
- Social media content

Quality standards:
- Clear and concise language
- Proper grammar and spelling
- Logical structure and flow
- Engaging and readable style
- Factually accurate content

Output formats:
- Plain text
- Markdown
- HTML"""
    
    async def generate(self, prompt: str, format: str = "text", tone: Optional[str] = None) -> str:
        """Generate content based on a prompt."""
        tone = tone or self.config.default_tone
        
        result = await self.execute_tool("reason", {
            "task": f"Generate {format} content with {tone} tone: {prompt}",
            "context": {"format": format, "tone": tone, "max_length": self.config.max_output_length}
        })
        
        if result.success and result.data is not None and isinstance(result.data, dict):
            return result.data.get("content", "")
        return ""
    
    async def edit(self, text: str, instructions: str) -> str:
        """Edit text based on instructions."""
        result = await self.execute_tool("reason", {
            "task": f"Edit the following text: {instructions}",
            "context": {"original_text": text}
        })
        
        if result.success and result.data is not None and isinstance(result.data, dict):
            return result.data.get("edited_text", text)
        return text
    
    async def summarize(self, text: str, max_length: int = 500) -> str:
        """Summarize text to a specified length."""
        result = await self.execute_tool("reason", {
            "task": f"Summarize the following text in {max_length} characters or less",
            "context": {"text": text}
        })
        
        if result.success and result.data is not None and isinstance(result.data, dict):
            return result.data.get("summary", "")
        return ""
    
    async def translate(self, text: str, target_language: str) -> str:
        """Translate text to a target language."""
        if not self.config.enable_translation:
            return text
        
        result = await self.execute_tool("reason", {
            "task": f"Translate the following text to {target_language}",
            "context": {"text": text}
        })
        
        if result.success and result.data is not None and isinstance(result.data, dict):
            return result.data.get("translation", text)
        return text
    
    async def proofread(self, text: str) -> Dict[str, Any]:
        """Proofread text and suggest corrections."""
        result = await self.execute_tool("reason", {
            "task": "Proofread the following text and identify errors",
            "context": {"text": text}
        })
        
        if result.success and result.data is not None:
            return result.data if isinstance(result.data, dict) else {"result": result.data}
        return {"original": text, "corrections": []}
    
    async def run(self, task: str, context: Optional[Dict[str, Any]] = None) -> Dict[str, Any]:
        """Execute the content agent's main loop."""
        self.state = AgentState.EXECUTING
        context = context or {}
        
        text = context.get("text", "")
        format = context.get("format", "text")
        
        if "generate" in task.lower() or "write" in task.lower() or "create" in task.lower():
            content = await self.generate(task, format)
            return {"action": "generate", "content": content}
        elif "edit" in task.lower():
            edited = await self.edit(text, task)
            return {"action": "edit", "edited_text": edited}
        elif "summarize" in task.lower():
            summary = await self.summarize(text)
            return {"action": "summarize", "summary": summary}
        elif "translate" in task.lower():
            target = context.get("target_language", "english")
            translation = await self.translate(text, target)
            return {"action": "translate", "translation": translation}
        elif "proofread" in task.lower():
            result = await self.proofread(text)
            return {"action": "proofread", "result": result}
        else:
            content = await self.generate(task, format)
            return {"action": "generate", "content": content}
    
    async def plan(self, task: str, context: Dict[str, Any]) -> List[str]:
        """Generate a plan for the content task."""
        return [f"Execute content task: {task}"]
    
    async def execute(self, task: str, context: Optional[Dict[str, Any]] = None) -> AgentResult:
        """Execute a content task."""
        self.logger.info("content_execute", task=task[:100] if task else "")
        self.state = AgentState.EXECUTING
        
        try:
            result = await self.run(task, context)
            self.state = AgentState.COMPLETED
            return AgentResult(
                success=True,
                data=result,
                metadata={"format": context.get("format", "text") if context else "text"}
            )
        except Exception as e:
            self.state = AgentState.ERROR
            self.logger.error("content_error", error=str(e))
            return AgentResult(success=False, error=str(e))
    
    async def initialize(self) -> None:
        """Initialize the content agent."""
        await super().initialize()
        self.logger.info("content_agent_initialized", tone=self.config.default_tone)
    
    async def shutdown(self) -> None:
        """Shutdown the content agent."""
        await super().shutdown()
        self.logger.info("content_agent_shutdown")
