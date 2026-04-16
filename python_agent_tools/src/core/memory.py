"""Memory module for agent state and context management."""

from typing import Any, Dict, List, Optional
from abc import ABC, abstractmethod


class BaseMemory(ABC):
    """Abstract base class for memory implementations."""
    
    @abstractmethod
    async def store(self, key: str, value: Any) -> None:
        """Store a value in memory."""
        pass
    
    @abstractmethod
    async def retrieve(self, key: str) -> Optional[Any]:
        """Retrieve a value from memory."""
        pass
    
    @abstractmethod
    async def search(self, query: str, limit: int = 10) -> List[Any]:
        """Search memory for relevant items."""
        pass


class InMemoryStore(BaseMemory):
    """Simple in-memory storage implementation."""
    
    def __init__(self):
        self._store: Dict[str, Any] = {}
    
    async def store(self, key: str, value: Any) -> None:
        self._store[key] = value
    
    async def retrieve(self, key: str) -> Optional[Any]:
        return self._store.get(key)
    
    async def search(self, query: str, limit: int = 10) -> List[Any]:
        return list(self._store.values())[:limit]
