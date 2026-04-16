"""Performance metrics using prometheus-client."""

from typing import Any, Callable, Dict, Optional
from functools import wraps
import time
from prometheus_client import (
    Counter,
    Histogram,
    Gauge,
    Summary,
    CollectorRegistry,
    generate_latest,
    CONTENT_TYPE_LATEST,
)
import structlog

logger = structlog.get_logger(__name__)


class MetricsCollector:
    """Centralized metrics collection for agent tools."""
    
    def __init__(self, registry: Optional[CollectorRegistry] = None):
        self.registry = registry or CollectorRegistry()
        
        self.tool_executions = Counter(
            "agent_tool_executions_total",
            "Total number of tool executions",
            ["tool_name", "status"],
            registry=self.registry,
        )
        
        self.tool_duration = Histogram(
            "agent_tool_duration_seconds",
            "Tool execution duration in seconds",
            ["tool_name"],
            buckets=[0.01, 0.05, 0.1, 0.5, 1.0, 5.0, 10.0, 30.0, 60.0],
            registry=self.registry,
        )
        
        self.agent_tasks = Counter(
            "agent_tasks_total",
            "Total number of agent tasks",
            ["agent_name", "status"],
            registry=self.registry,
        )
        
        self.agent_iterations = Histogram(
            "agent_iterations_count",
            "Number of iterations per task",
            ["agent_name"],
            buckets=[1, 2, 3, 5, 10, 20, 50, 100],
            registry=self.registry,
        )
        
        self.llm_requests = Counter(
            "llm_requests_total",
            "Total number of LLM API requests",
            ["provider", "model", "status"],
            registry=self.registry,
        )
        
        self.llm_tokens = Counter(
            "llm_tokens_total",
            "Total tokens used",
            ["provider", "model", "token_type"],
            registry=self.registry,
        )
        
        self.llm_latency = Histogram(
            "llm_request_latency_seconds",
            "LLM request latency",
            ["provider", "model"],
            buckets=[0.1, 0.5, 1.0, 2.0, 5.0, 10.0, 30.0],
            registry=self.registry,
        )
        
        self.active_agents = Gauge(
            "active_agents",
            "Number of currently active agents",
            registry=self.registry,
        )
        
        self.memory_usage = Gauge(
            "agent_memory_items",
            "Number of items in agent memory",
            ["agent_name"],
            registry=self.registry,
        )
    
    def record_tool_execution(
        self,
        tool_name: str,
        success: bool,
        duration: float,
    ) -> None:
        """Record a tool execution."""
        status = "success" if success else "error"
        self.tool_executions.labels(tool_name=tool_name, status=status).inc()
        self.tool_duration.labels(tool_name=tool_name).observe(duration)
    
    def record_agent_task(
        self,
        agent_name: str,
        success: bool,
        iterations: int,
    ) -> None:
        """Record an agent task completion."""
        status = "success" if success else "error"
        self.agent_tasks.labels(agent_name=agent_name, status=status).inc()
        self.agent_iterations.labels(agent_name=agent_name).observe(iterations)
    
    def record_llm_request(
        self,
        provider: str,
        model: str,
        success: bool,
        latency: float,
        input_tokens: int = 0,
        output_tokens: int = 0,
    ) -> None:
        """Record an LLM API request."""
        status = "success" if success else "error"
        self.llm_requests.labels(provider=provider, model=model, status=status).inc()
        self.llm_latency.labels(provider=provider, model=model).observe(latency)
        
        if input_tokens > 0:
            self.llm_tokens.labels(
                provider=provider, model=model, token_type="input"
            ).inc(input_tokens)
        if output_tokens > 0:
            self.llm_tokens.labels(
                provider=provider, model=model, token_type="output"
            ).inc(output_tokens)
    
    def get_metrics(self) -> bytes:
        """Get metrics in Prometheus format."""
        return generate_latest(self.registry)
    
    def get_content_type(self) -> str:
        """Get the content type for metrics response."""
        return CONTENT_TYPE_LATEST


def track_execution(metrics: MetricsCollector, tool_name: str) -> Callable:
    """Decorator to track tool execution metrics."""
    
    def decorator(func: Callable) -> Callable:
        @wraps(func)
        async def wrapper(*args, **kwargs) -> Any:
            start_time = time.perf_counter()
            success = True
            try:
                result = await func(*args, **kwargs)
                return result
            except Exception:
                success = False
                raise
            finally:
                duration = time.perf_counter() - start_time
                metrics.record_tool_execution(tool_name, success, duration)
        return wrapper
    return decorator
