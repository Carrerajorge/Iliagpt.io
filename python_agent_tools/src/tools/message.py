from typing import List, Optional, Dict, Any
from pydantic import BaseModel, Field
from enum import Enum
from datetime import datetime
from .base import BaseTool, ToolCategory, Priority, ToolInput, ToolOutput
from ..core.registry import ToolRegistry


class MessageType(str, Enum):
    USER = "user"
    AGENT = "agent"
    SYSTEM = "system"
    TOOL = "tool"
    ERROR = "error"


class MessagePriority(str, Enum):
    LOW = "low"
    NORMAL = "normal"
    HIGH = "high"
    URGENT = "urgent"


class Message(BaseModel):
    id: str
    type: MessageType
    content: str
    priority: MessagePriority = MessagePriority.NORMAL
    metadata: Dict[str, Any] = {}
    timestamp: str


class MessageSendInput(ToolInput):
    recipient: str = Field(..., description="Recipient identifier")
    content: str = Field(..., description="Message content")
    message_type: MessageType = Field(MessageType.AGENT)
    priority: MessagePriority = Field(MessagePriority.NORMAL)
    metadata: Dict[str, Any] = Field(default_factory=dict)
    reply_to: Optional[str] = Field(None, description="ID of message being replied to")


class MessageSendOutput(ToolOutput):
    data: Optional[Dict[str, Any]] = None
    message_id: Optional[str] = None


_message_queue: List[Dict[str, Any]] = []


@ToolRegistry.register
class MessageSendTool(BaseTool[MessageSendInput, MessageSendOutput]):
    name = "message_send"
    description = "Sends messages to users, other agents, or system components"
    category = ToolCategory.COMMUNICATION
    priority = Priority.CRITICAL
    dependencies = []

    async def execute(self, input: MessageSendInput) -> MessageSendOutput:
        self.logger.info(
            "sending_message",
            recipient=input.recipient,
            message_type=input.message_type.value,
            priority=input.priority.value,
        )

        import uuid
        message_id = str(uuid.uuid4())
        timestamp = datetime.utcnow().isoformat()

        message = {
            "id": message_id,
            "recipient": input.recipient,
            "type": input.message_type.value,
            "content": input.content,
            "priority": input.priority.value,
            "metadata": input.metadata,
            "reply_to": input.reply_to,
            "timestamp": timestamp,
        }

        _message_queue.append(message)

        return MessageSendOutput(
            success=True,
            data={"sent": True, "timestamp": timestamp},
            message_id=message_id,
        )


class MessageReceiveInput(ToolInput):
    sender: Optional[str] = Field(None, description="Filter by sender")
    message_type: Optional[MessageType] = Field(None)
    limit: int = Field(10, ge=1, le=100)
    since: Optional[str] = Field(None, description="ISO timestamp to filter from")


class MessageReceiveOutput(ToolOutput):
    data: Optional[List[Dict[str, Any]]] = None
    count: int = 0


@ToolRegistry.register
class MessageReceiveTool(BaseTool[MessageReceiveInput, MessageReceiveOutput]):
    name = "message_receive"
    description = "Receives and retrieves messages from the message queue"
    category = ToolCategory.COMMUNICATION
    priority = Priority.CRITICAL
    dependencies = ["message_send"]

    async def execute(self, input: MessageReceiveInput) -> MessageReceiveOutput:
        self.logger.info(
            "receiving_messages",
            sender=input.sender,
            message_type=input.message_type.value if input.message_type else None,
        )

        results = []
        for msg in _message_queue:
            if input.sender and msg.get("recipient") != input.sender:
                continue
            if input.message_type and msg.get("type") != input.message_type.value:
                continue
            results.append(msg)
            if len(results) >= input.limit:
                break

        return MessageReceiveOutput(
            success=True,
            data=results,
            count=len(results),
        )


class BroadcastInput(ToolInput):
    content: str = Field(..., description="Broadcast message content")
    recipients: List[str] = Field(..., description="List of recipient identifiers")
    priority: MessagePriority = Field(MessagePriority.NORMAL)
    metadata: Dict[str, Any] = Field(default_factory=dict)


class BroadcastOutput(ToolOutput):
    data: Optional[Dict[str, Any]] = None
    sent_count: int = 0
    failed_count: int = 0


@ToolRegistry.register
class BroadcastTool(BaseTool[BroadcastInput, BroadcastOutput]):
    name = "broadcast"
    description = "Broadcasts messages to multiple recipients simultaneously"
    category = ToolCategory.COMMUNICATION
    priority = Priority.HIGH
    dependencies = ["message_send"]

    async def execute(self, input: BroadcastInput) -> BroadcastOutput:
        self.logger.info(
            "broadcasting_message",
            recipient_count=len(input.recipients),
            priority=input.priority.value,
        )

        import uuid
        sent = 0
        failed = 0
        timestamp = datetime.utcnow().isoformat()

        for recipient in input.recipients:
            try:
                message = {
                    "id": str(uuid.uuid4()),
                    "recipient": recipient,
                    "type": MessageType.AGENT.value,
                    "content": input.content,
                    "priority": input.priority.value,
                    "metadata": {**input.metadata, "broadcast": True},
                    "timestamp": timestamp,
                }
                _message_queue.append(message)
                sent += 1
            except Exception as e:
                self.logger.error("broadcast_failed", recipient=recipient, error=str(e))
                failed += 1

        return BroadcastOutput(
            success=failed == 0,
            data={"broadcast_timestamp": timestamp},
            sent_count=sent,
            failed_count=failed,
        )
