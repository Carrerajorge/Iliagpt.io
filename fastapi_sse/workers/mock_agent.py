"""Mock agent for testing that produces realistic event sequences."""
import time
import random
from typing import Optional, List, Dict, Any, Callable
from dataclasses import dataclass, field
import structlog

from .event_publisher import StreamEventPublisher, EventMetadata, generate_event_id

logger = structlog.get_logger(__name__)


@dataclass
class MockToolDefinition:
    """Definition of a mock tool."""
    name: str
    description: str
    mock_result: Any
    delay_ms: float = 100.0
    failure_rate: float = 0.0


@dataclass
class MockAgentConfig:
    """Configuration for mock agent behavior."""
    base_delay_ms: float = 200.0
    delay_variance_ms: float = 50.0
    trace_count: int = 2
    tools_to_call: List[str] = field(default_factory=lambda: ["web_search", "calculator"])
    final_response_template: str = "Based on my analysis: {summary}"
    simulate_errors: bool = False
    error_probability: float = 0.1
    cancellation_check_interval: int = 2


DEFAULT_MOCK_TOOLS: Dict[str, MockToolDefinition] = {
    "web_search": MockToolDefinition(
        name="web_search",
        description="Search the web for information",
        mock_result={
            "results": [
                {"title": "Sample Result 1", "url": "https://example.com/1", "snippet": "This is a sample search result."},
                {"title": "Sample Result 2", "url": "https://example.com/2", "snippet": "Another relevant result."},
            ],
            "total_results": 2
        },
        delay_ms=150.0
    ),
    "calculator": MockToolDefinition(
        name="calculator",
        description="Perform mathematical calculations",
        mock_result={"expression": "2 + 2", "result": 4},
        delay_ms=50.0
    ),
    "file_reader": MockToolDefinition(
        name="file_reader",
        description="Read contents of a file",
        mock_result={"content": "Sample file content...", "size_bytes": 1024},
        delay_ms=100.0
    ),
    "code_executor": MockToolDefinition(
        name="code_executor",
        description="Execute Python code",
        mock_result={"output": "Hello, World!\n", "exit_code": 0},
        delay_ms=200.0,
        failure_rate=0.05
    ),
}


class MockAgent:
    """
    Simulated agent for testing that produces realistic event sequences.
    
    Event sequence: trace -> tool_call -> tool_result -> trace -> final
    """
    
    def __init__(
        self,
        publisher: StreamEventPublisher,
        config: Optional[MockAgentConfig] = None,
        tools: Optional[Dict[str, MockToolDefinition]] = None
    ):
        """
        Initialize mock agent.
        
        Args:
            publisher: Event publisher for emitting events
            config: Agent configuration
            tools: Available mock tools
        """
        self.publisher = publisher
        self.config = config or MockAgentConfig()
        self.tools = tools or DEFAULT_MOCK_TOOLS
        self._cancelled = False
    
    def _get_delay(self, base_ms: Optional[float] = None) -> float:
        """Get delay with variance in seconds."""
        base = base_ms if base_ms is not None else self.config.base_delay_ms
        variance = random.uniform(-self.config.delay_variance_ms, self.config.delay_variance_ms)
        return max(0, (base + variance) / 1000.0)
    
    def _sleep_with_cancel_check(
        self,
        session_id: str,
        delay_seconds: float,
        check_interval: int = 0
    ) -> bool:
        """
        Sleep with periodic cancellation checks.
        
        Returns:
            True if cancelled, False if completed normally
        """
        interval = check_interval or self.config.cancellation_check_interval
        if delay_seconds <= 0:
            return self.publisher.is_cancelled(session_id)
        
        steps = max(1, int(delay_seconds / (interval / 10.0)))
        step_delay = delay_seconds / steps
        
        for _ in range(steps):
            if self.publisher.is_cancelled(session_id):
                return True
            time.sleep(step_delay)
        
        return self.publisher.is_cancelled(session_id)
    
    def execute(
        self,
        session_id: str,
        prompt: str,
        user_id: Optional[str] = None,
        task_id: Optional[str] = None
    ) -> Dict[str, Any]:
        """
        Execute mock agent with realistic event sequence.
        
        Args:
            session_id: Session identifier
            prompt: User prompt
            user_id: Optional user identifier
            task_id: Optional task identifier
            
        Returns:
            Execution result dictionary
        """
        start_time = time.time()
        metadata = EventMetadata(
            session_id=session_id,
            user_id=user_id,
            task_id=task_id,
            source="mock_agent"
        )
        
        events_emitted = 0
        tool_results = []
        
        try:
            if self.publisher.is_cancelled(session_id):
                self._emit_cancelled(session_id, metadata)
                return {"status": "cancelled", "events": events_emitted}
            
            self.publisher.publish_trace(
                session_id,
                f"Analyzing prompt: '{prompt[:100]}...' - Identifying required tools and approach.",
                metadata,
                stage="planning"
            )
            events_emitted += 1
            
            if self._sleep_with_cancel_check(session_id, self._get_delay()):
                self._emit_cancelled(session_id, metadata)
                return {"status": "cancelled", "events": events_emitted}
            
            for i, tool_name in enumerate(self.config.tools_to_call):
                tool_def = self.tools.get(tool_name)
                if not tool_def:
                    continue
                
                if self.publisher.is_cancelled(session_id):
                    self._emit_cancelled(session_id, metadata)
                    return {"status": "cancelled", "events": events_emitted}
                
                call_id = generate_event_id()
                tool_input = {"query": prompt, "index": i}
                
                self.publisher.publish_tool_call(
                    session_id,
                    tool_name,
                    tool_input,
                    metadata,
                    call_id
                )
                events_emitted += 1
                
                tool_start = time.time()
                if self._sleep_with_cancel_check(session_id, self._get_delay(tool_def.delay_ms)):
                    self._emit_cancelled(session_id, metadata)
                    return {"status": "cancelled", "events": events_emitted}
                
                tool_success = True
                tool_result = tool_def.mock_result
                
                if tool_def.failure_rate > 0 and random.random() < tool_def.failure_rate:
                    tool_success = False
                    tool_result = {"error": f"Mock failure in {tool_name}"}
                
                tool_duration = (time.time() - tool_start) * 1000
                
                self.publisher.publish_tool_result(
                    session_id,
                    tool_name,
                    tool_result,
                    metadata,
                    call_id,
                    success=tool_success,
                    duration_ms=tool_duration
                )
                events_emitted += 1
                tool_results.append({"tool": tool_name, "result": tool_result, "success": tool_success})
            
            if self.publisher.is_cancelled(session_id):
                self._emit_cancelled(session_id, metadata)
                return {"status": "cancelled", "events": events_emitted}
            
            for i in range(self.config.trace_count):
                if self.publisher.is_cancelled(session_id):
                    self._emit_cancelled(session_id, metadata)
                    return {"status": "cancelled", "events": events_emitted}
                
                thinking_messages = [
                    f"Processing tool results ({len(tool_results)} collected)...",
                    "Synthesizing information from multiple sources...",
                    "Formulating comprehensive response...",
                    "Validating conclusions against available data...",
                ]
                thinking = thinking_messages[min(i, len(thinking_messages) - 1)]
                
                self.publisher.publish_trace(
                    session_id,
                    thinking,
                    metadata,
                    stage="synthesis"
                )
                events_emitted += 1
                
                if self._sleep_with_cancel_check(session_id, self._get_delay()):
                    self._emit_cancelled(session_id, metadata)
                    return {"status": "cancelled", "events": events_emitted}
            
            if self.config.simulate_errors and random.random() < self.config.error_probability:
                raise RuntimeError("Simulated agent error for testing")
            
            successful_tools = [r["tool"] for r in tool_results if r.get("success")]
            summary = f"Used {len(successful_tools)} tools: {', '.join(successful_tools)}"
            final_response = self.config.final_response_template.format(summary=summary)
            
            total_duration = (time.time() - start_time) * 1000
            
            self.publisher.publish_final(
                session_id,
                final_response,
                metadata,
                total_duration_ms=total_duration,
                token_usage={"prompt_tokens": 100, "completion_tokens": 50, "total_tokens": 150}
            )
            events_emitted += 1
            
            logger.info(
                "mock_agent_completed",
                session_id=session_id,
                events=events_emitted,
                duration_ms=total_duration
            )
            
            return {
                "status": "completed",
                "response": final_response,
                "events": events_emitted,
                "duration_ms": total_duration,
                "tool_results": tool_results
            }
            
        except Exception as e:
            logger.exception(
                "mock_agent_error",
                session_id=session_id,
                error=str(e)
            )
            
            self.publisher.publish_error(
                session_id,
                str(e),
                metadata,
                error_type=type(e).__name__,
                recoverable=False,
                details={"events_before_error": events_emitted}
            )
            events_emitted += 1
            
            return {
                "status": "error",
                "error": str(e),
                "events": events_emitted,
                "duration_ms": (time.time() - start_time) * 1000
            }
    
    def _emit_cancelled(self, session_id: str, metadata: EventMetadata) -> None:
        """Emit cancellation event."""
        self.publisher.publish_error(
            session_id,
            "Task was cancelled by user",
            metadata,
            error_type="CancellationError",
            recoverable=False
        )
        logger.info("mock_agent_cancelled", session_id=session_id)


def create_mock_agent(
    publisher: Optional[StreamEventPublisher] = None,
    config: Optional[MockAgentConfig] = None
) -> MockAgent:
    """
    Factory function to create a mock agent.
    
    Args:
        publisher: Optional event publisher (creates new if not provided)
        config: Optional configuration
        
    Returns:
        Configured MockAgent instance
    """
    from .event_publisher import get_event_publisher
    
    pub = publisher or get_event_publisher()
    return MockAgent(pub, config)
