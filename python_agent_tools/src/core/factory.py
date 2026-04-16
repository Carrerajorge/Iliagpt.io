from typing import Dict, Any, Optional
from .registry import ToolRegistry, registry
from ..tools.base import BaseTool
import structlog

logger = structlog.get_logger(__name__)

class ToolFactory:
    """Factory for creating tool instances with dependency injection."""
    
    def __init__(self, registry: ToolRegistry = registry):
        self._registry = registry
        self._instances: Dict[str, BaseTool] = {}
        self._config: Dict[str, Any] = {}
    
    def configure(self, config: Dict[str, Any]) -> None:
        """Set configuration for tool creation."""
        self._config = config
    
    def create(self, name: str, **kwargs) -> Optional[BaseTool]:
        """Create a tool instance by name."""
        tool_class = self._registry.get(name)
        if not tool_class:
            logger.error("tool_not_found", tool=name)
            return None
        
        merged_config = {**self._config, **kwargs}
        try:
            instance = tool_class(**merged_config)
            logger.info("tool_created", tool=name)
            return instance
        except Exception as e:
            logger.error("tool_creation_failed", tool=name, error=str(e))
            return None
    
    def get_or_create(self, name: str, **kwargs) -> Optional[BaseTool]:
        """Get cached instance or create new one."""
        if name not in self._instances:
            instance = self.create(name, **kwargs)
            if instance:
                self._instances[name] = instance
        return self._instances.get(name)
    
    def create_with_dependencies(self, name: str, **kwargs) -> Dict[str, BaseTool]:
        """Create a tool and all its dependencies."""
        result: Dict[str, BaseTool] = {}
        dependencies = self._registry.get_dependencies(name)
        
        for dep in dependencies:
            if dep not in result:
                dep_tools = self.create_with_dependencies(dep, **kwargs)
                result.update(dep_tools)
        
        tool = self.get_or_create(name, **kwargs)
        if tool:
            result[name] = tool
        
        return result
