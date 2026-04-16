from typing import Dict, Type, Optional, List
from ..tools.base import BaseTool, ToolCategory, Priority
import structlog

logger = structlog.get_logger(__name__)

class ToolRegistry:
    """Singleton registry for all agent tools."""
    _instance: Optional["ToolRegistry"] = None
    _tools: Dict[str, Type[BaseTool]] = {}
    
    def __new__(cls) -> "ToolRegistry":
        if cls._instance is None:
            cls._instance = super().__new__(cls)
            cls._tools = {}
        return cls._instance
    
    @classmethod
    def register(cls, tool_class: Type[BaseTool]) -> Type[BaseTool]:
        """Decorator to register a tool class."""
        instance = cls()
        name = tool_class.name
        if name in instance._tools:
            logger.warning("tool_already_registered", tool=name)
        instance._tools[name] = tool_class
        logger.info("tool_registered", tool=name, category=tool_class.category.value)
        return tool_class
    
    def get(self, name: str) -> Optional[Type[BaseTool]]:
        """Get a tool class by name."""
        return self._tools.get(name)
    
    def list_all(self) -> List[str]:
        """List all registered tool names."""
        return list(self._tools.keys())
    
    def list_by_category(self, category: ToolCategory) -> List[str]:
        """List tools by category."""
        return [name for name, tool in self._tools.items() if tool.category == category]
    
    def list_by_priority(self, priority: Priority) -> List[str]:
        """List tools by priority."""
        return [name for name, tool in self._tools.items() if tool.priority == priority]
    
    def get_dependencies(self, name: str) -> List[str]:
        """Get dependencies for a tool."""
        tool = self._tools.get(name)
        return tool.dependencies if tool else []
    
    def clear(self) -> None:
        """Clear all registered tools (for testing)."""
        self._tools.clear()

registry = ToolRegistry()
