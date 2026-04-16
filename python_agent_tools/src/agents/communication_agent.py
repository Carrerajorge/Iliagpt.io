"""Communication Agent - Messaging, notifications, and email handling."""

from typing import Any, Dict, List, Optional
from .base_agent import BaseAgent, AgentConfig, AgentResult, AgentState
import structlog


class CommunicationAgentConfig(AgentConfig):
    """Configuration for the Communication Agent."""
    default_sender: str = "agent@system.local"
    max_recipients: int = 50
    enable_email: bool = True
    enable_notifications: bool = True
    rate_limit_per_minute: int = 30


class CommunicationAgent(BaseAgent):
    """Agent specialized in messaging, notifications, and email handling."""
    
    name = "communication"
    
    def __init__(
        self,
        config: Optional[CommunicationAgentConfig] = None,
        tools: Optional[List] = None,
        memory = None,
    ):
        super().__init__(tools=tools, memory=memory)
        self.config = config or CommunicationAgentConfig(name="communication")
        self._message_queue: List[Dict[str, Any]] = []
        self._sent_count = 0
    
    @property
    def description(self) -> str:
        return "Handles messaging, notifications, email composition and delivery"
    
    @property
    def category(self) -> str:
        return "communication"
    
    @property
    def tools_used(self) -> List[str]:
        return ["message", "api_call", "reason"]
    
    def get_system_prompt(self) -> str:
        return """You are the Communication Agent, specialized in messaging and notifications.
Your role is to:
1. Compose and send emails with proper formatting
2. Send notifications to various channels
3. Queue and manage message delivery
4. Handle message templates and personalization
5. Track delivery status and handle failures
6. Manage communication preferences

Communication channels:
- Email (SMTP, API-based)
- Push notifications
- SMS (via API)
- Webhooks
- Internal messaging

Best practices:
- Respect rate limits
- Validate recipients before sending
- Use proper formatting for each channel
- Handle delivery failures gracefully
- Log all communications for audit"""
    
    async def send_email(
        self,
        to: List[str],
        subject: str,
        body: str,
        html: bool = False
    ) -> Dict[str, Any]:
        """Send an email."""
        if not self.config.enable_email:
            return {"error": "Email disabled"}
        
        if len(to) > self.config.max_recipients:
            return {"error": f"Too many recipients (max {self.config.max_recipients})"}
        
        result = await self.execute_tool("message", {
            "type": "email",
            "to": to,
            "subject": subject,
            "body": body,
            "html": html,
            "from": self.config.default_sender
        })
        
        if result.success:
            self._sent_count += len(to)
        
        if result.success and result.data is not None:
            return result.data if isinstance(result.data, dict) else {"result": result.data}
        return {"error": result.error}
    
    async def send_notification(
        self,
        channel: str,
        message: str,
        data: Optional[Dict[str, Any]] = None
    ) -> Dict[str, Any]:
        """Send a notification to a channel."""
        if not self.config.enable_notifications:
            return {"error": "Notifications disabled"}
        
        result = await self.execute_tool("message", {
            "type": "notification",
            "channel": channel,
            "message": message,
            "data": data or {}
        })
        
        if result.success:
            self._sent_count += 1
        
        if result.success and result.data is not None:
            return result.data if isinstance(result.data, dict) else {"result": result.data}
        return {"error": result.error}
    
    async def compose_message(self, template: str, context: Dict[str, Any]) -> str:
        """Compose a message using a template and context."""
        result = await self.execute_tool("reason", {
            "task": f"Compose a message using this template: {template}",
            "context": context
        })
        
        if result.success and result.data is not None and isinstance(result.data, dict):
            return result.data.get("message", template)
        return template
    
    async def queue_message(self, message: Dict[str, Any]) -> str:
        """Add a message to the queue."""
        message_id = f"msg_{len(self._message_queue)}"
        message["id"] = message_id
        message["status"] = "queued"
        self._message_queue.append(message)
        return message_id
    
    async def process_queue(self) -> List[Dict[str, Any]]:
        """Process all queued messages."""
        results = []
        for message in self._message_queue:
            if message["status"] == "queued":
                if message.get("type") == "email":
                    result = await self.send_email(
                        message.get("to", []),
                        message.get("subject", ""),
                        message.get("body", "")
                    )
                else:
                    result = await self.send_notification(
                        message.get("channel", "default"),
                        message.get("message", "")
                    )
                message["status"] = "sent" if "error" not in result else "failed"
                results.append({"id": message["id"], "result": result})
        
        self._message_queue = [m for m in self._message_queue if m["status"] != "sent"]
        return results
    
    async def run(self, task: str, context: Optional[Dict[str, Any]] = None) -> Dict[str, Any]:
        """Execute the communication agent's main loop."""
        self.state = AgentState.EXECUTING
        context = context or {}
        
        if "email" in task.lower():
            result = await self.send_email(
                context.get("to", []),
                context.get("subject", ""),
                context.get("body", "")
            )
            return {"action": "email", "result": result}
        elif "notify" in task.lower() or "notification" in task.lower():
            result = await self.send_notification(
                context.get("channel", "default"),
                context.get("message", task)
            )
            return {"action": "notification", "result": result}
        elif "compose" in task.lower():
            template = context.get("template", task)
            message = await self.compose_message(template, context)
            return {"action": "compose", "message": message}
        elif "queue" in task.lower():
            message_id = await self.queue_message(context)
            return {"action": "queue", "message_id": message_id}
        elif "process" in task.lower():
            results = await self.process_queue()
            return {"action": "process_queue", "results": results}
        else:
            message = await self.compose_message(task, context)
            return {"action": "compose", "message": message}
    
    async def plan(self, task: str, context: Dict[str, Any]) -> List[str]:
        """Generate a plan for the communication task."""
        return [f"Execute communication task: {task}"]
    
    async def execute(self, task: str, context: Optional[Dict[str, Any]] = None) -> AgentResult:
        """Execute a communication task."""
        self.logger.info("communication_execute", task=task[:100] if task else "")
        self.state = AgentState.EXECUTING
        
        try:
            result = await self.run(task, context)
            self.state = AgentState.COMPLETED
            return AgentResult(
                success=True,
                data=result,
                metadata={"total_sent": self._sent_count, "queued": len(self._message_queue)}
            )
        except Exception as e:
            self.state = AgentState.ERROR
            self.logger.error("communication_error", error=str(e))
            return AgentResult(success=False, error=str(e))
    
    async def initialize(self) -> None:
        """Initialize the communication agent."""
        await super().initialize()
        self._message_queue = []
        self._sent_count = 0
        self.logger.info("communication_agent_initialized")
    
    async def shutdown(self) -> None:
        """Shutdown the communication agent."""
        if self._message_queue:
            self.logger.warning("messages_in_queue", count=len(self._message_queue))
        await super().shutdown()
        self.logger.info("communication_agent_shutdown")
