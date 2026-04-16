from abc import ABC, abstractmethod
from pydantic import BaseModel
from typing import Any, Dict, Optional, TypeVar, Generic
from enum import Enum
import structlog

class ToolCategory(str, Enum):
    ORCHESTRATION = "Orquestación"
    MEMORY = "Memoria"
    REASONING = "Razonamiento"
    COMMUNICATION = "Comunicación"
    SYSTEM = "Sistema"
    FILES = "Archivos"
    RESEARCH = "Investigación"
    WEB = "Web"
    GENERATION = "Generación"
    PROCESSING = "Procesamiento"
    DATA = "Datos"
    APIS = "APIs"
    PROTOCOLS = "Protocolos"
    PRODUCTIVITY = "Productividad"
    AUTOMATION = "Automatización"
    SECURITY = "Seguridad"
    MONITORING = "Monitoreo"
    NLP = "NLP"
    ANALYTICS = "Analytics"

class Priority(str, Enum):
    CRITICAL = "Crítica"
    HIGH = "Alta"
    MEDIUM = "Media"
    LOW = "Baja"

class ToolInput(BaseModel):
    class Config:
        extra = "forbid"

class ToolOutput(BaseModel):
    success: bool
    data: Optional[Any] = None
    error: Optional[str] = None
    metadata: Dict[str, Any] = {}

InputT = TypeVar("InputT", bound=ToolInput)
OutputT = TypeVar("OutputT", bound=ToolOutput)

class BaseTool(ABC, Generic[InputT, OutputT]):
    name: str
    description: str
    category: ToolCategory
    priority: Priority
    dependencies: list[str] = []
    
    def __init__(self):
        self.logger = structlog.get_logger(tool=self.name)
    
    @abstractmethod
    async def execute(self, input: InputT) -> OutputT:
        pass
    
    async def validate_input(self, input: InputT) -> bool:
        return True
    
    def get_metadata(self) -> Dict[str, Any]:
        return {
            "name": self.name,
            "description": self.description,
            "category": self.category.value,
            "priority": self.priority.value,
            "dependencies": self.dependencies,
        }
