"""WebSocket handler for real-time updates."""

from fastapi import WebSocket, WebSocketDisconnect
from typing import Dict, Set, Optional, Any
import json
import asyncio
import structlog

logger = structlog.get_logger(__name__)


class ConnectionManager:
    """Manages WebSocket connections for real-time updates."""
    
    def __init__(self):
        self.active_connections: Dict[str, Set[WebSocket]] = {}
    
    async def connect(self, websocket: WebSocket, channel: str = "default"):
        """Accept a new WebSocket connection and add to channel."""
        await websocket.accept()
        if channel not in self.active_connections:
            self.active_connections[channel] = set()
        self.active_connections[channel].add(websocket)
        logger.info("websocket_connected", channel=channel)
    
    def disconnect(self, websocket: WebSocket, channel: str = "default"):
        """Remove a WebSocket connection from channel."""
        if channel in self.active_connections:
            self.active_connections[channel].discard(websocket)
        logger.info("websocket_disconnected", channel=channel)
    
    async def broadcast(self, message: dict, channel: str = "default"):
        """Broadcast message to all connections in a channel."""
        if channel in self.active_connections:
            for connection in list(self.active_connections[channel]):
                try:
                    await connection.send_json(message)
                except Exception:
                    self.active_connections[channel].discard(connection)
    
    async def send_personal(self, websocket: WebSocket, message: dict):
        """Send message to a specific connection."""
        await websocket.send_json(message)
    
    def get_connection_count(self, channel: Optional[str] = None) -> int:
        """Get the number of active connections."""
        if channel:
            return len(self.active_connections.get(channel, set()))
        return sum(len(conns) for conns in self.active_connections.values())
    
    def get_channels(self) -> list:
        """Get list of active channels."""
        return list(self.active_connections.keys())


manager = ConnectionManager()


async def publish_agent_update(agent_name: str, status: str, data: Optional[Dict[str, Any]] = None):
    """Publish agent status update to WebSocket clients."""
    message = {
        "type": "agent_update",
        "agent_name": agent_name,
        "status": status,
        "data": data or {},
    }
    await manager.broadcast(message, channel="agents")
    logger.debug("agent_update_published", agent=agent_name, status=status)


async def publish_workflow_update(workflow_id: str, status: str, progress: float = 0.0, data: Optional[Dict[str, Any]] = None):
    """Publish workflow progress update to WebSocket clients."""
    message = {
        "type": "workflow_update",
        "workflow_id": workflow_id,
        "status": status,
        "progress": progress,
        "data": data or {},
    }
    await manager.broadcast(message, channel="workflows")
    logger.debug("workflow_update_published", workflow_id=workflow_id, status=status)
