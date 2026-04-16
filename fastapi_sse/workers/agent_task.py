"""Celery task for executing agent prompts with Redis Stream events."""
import time
from typing import Optional, Dict, Any
from datetime import datetime
from celery import Task
from celery.exceptions import SoftTimeLimitExceeded
import structlog
import redis

from fastapi_sse.app.celery_app import celery_app
from fastapi_sse.app.config import get_settings
from .event_publisher import StreamEventPublisher, EventMetadata, get_event_publisher
from .mock_agent import MockAgent, MockAgentConfig, create_mock_agent

logger = structlog.get_logger(__name__)


class AgentTask(Task):
    """Base task class with shared resources."""
    
    _publisher: Optional[StreamEventPublisher] = None
    _redis: Optional[redis.Redis] = None
    
    @property
    def publisher(self) -> StreamEventPublisher:
        if self._publisher is None:
            self._publisher = StreamEventPublisher()
        return self._publisher
    
    @property
    def redis_client(self) -> redis.Redis:
        if self._redis is None:
            settings = get_settings()
            self._redis = redis.from_url(settings.redis_url, decode_responses=True)
        return self._redis
    
    def update_session_state(self, session_id: str, updates: Dict[str, Any]) -> None:
        """Update session state in Redis."""
        import json
        settings = get_settings()
        key = f"session:{session_id}"
        
        data = self.redis_client.get(key)
        state = json.loads(data) if data else {}
        state.update(updates)
        state["updated_at"] = datetime.utcnow().isoformat()
        
        self.redis_client.setex(key, settings.session_ttl_seconds, json.dumps(state))


@celery_app.task(
    bind=True,
    base=AgentTask,
    name="fastapi_sse.workers.agent_task.execute_agent_prompt",
    max_retries=3,
    default_retry_delay=5,
    autoretry_for=(ConnectionError, redis.RedisError),
    retry_backoff=True,
    retry_backoff_max=60,
    retry_jitter=True,
    soft_time_limit=120,
    time_limit=150,
    acks_late=True,
    reject_on_worker_lost=True,
    track_started=True
)
def execute_agent_prompt(
    self: AgentTask,
    session_id: str,
    prompt: str,
    user_id: Optional[str] = None,
    context: Optional[Dict[str, Any]] = None,
    model: Optional[str] = None,
    use_mock: bool = True
) -> Dict[str, Any]:
    """
    Execute an agent prompt and publish events to Redis Stream.
    
    Args:
        session_id: Session identifier
        prompt: User prompt to process
        user_id: Optional user identifier
        context: Optional context dictionary
        model: Optional model name
        use_mock: Use mock agent for testing (default True)
        
    Returns:
        Execution result dictionary
    """
    start_time = time.time()
    task_id = self.request.id
    
    metadata = EventMetadata(
        session_id=session_id,
        user_id=user_id,
        task_id=task_id,
        source="celery_worker",
        extra={"model": model, "retry": self.request.retries}
    )
    
    logger.info(
        "agent_task_started",
        session_id=session_id,
        task_id=task_id,
        user_id=user_id,
        prompt_length=len(prompt)
    )
    
    try:
        self.update_session_state(session_id, {
            "status": "processing",
            "task_id": task_id,
            "started_at": datetime.utcnow().isoformat()
        })
        
        if self.publisher.is_cancelled(session_id):
            logger.info("agent_task_cancelled_early", session_id=session_id, task_id=task_id)
            self.publisher.publish_error(
                session_id,
                "Task cancelled before execution",
                metadata,
                error_type="CancellationError"
            )
            self.update_session_state(session_id, {"status": "cancelled"})
            return {"status": "cancelled", "session_id": session_id}
        
        if use_mock:
            config = MockAgentConfig(
                base_delay_ms=200.0,
                trace_count=2,
                tools_to_call=["web_search", "calculator"]
            )
            agent = MockAgent(self.publisher, config)
            result = agent.execute(session_id, prompt, user_id, task_id)
        else:
            result = _execute_real_agent(
                self.publisher,
                session_id,
                prompt,
                user_id,
                task_id,
                context,
                model,
                metadata
            )
        
        total_duration = (time.time() - start_time) * 1000
        
        if result.get("status") == "completed":
            self.update_session_state(session_id, {
                "status": "completed",
                "completed_at": datetime.utcnow().isoformat(),
                "duration_ms": total_duration
            })
        elif result.get("status") == "cancelled":
            self.update_session_state(session_id, {"status": "cancelled"})
        else:
            self.update_session_state(session_id, {"status": "error"})
        
        logger.info(
            "agent_task_finished",
            session_id=session_id,
            task_id=task_id,
            status=result.get("status"),
            duration_ms=total_duration
        )
        
        return {
            "session_id": session_id,
            "task_id": task_id,
            **result,
            "total_duration_ms": total_duration
        }
        
    except SoftTimeLimitExceeded:
        logger.error("agent_task_timeout", session_id=session_id, task_id=task_id)
        
        self.publisher.publish_error(
            session_id,
            "Agent execution timed out",
            metadata,
            error_type="TimeoutError",
            recoverable=False
        )
        self.update_session_state(session_id, {"status": "timeout"})
        
        raise
        
    except Exception as e:
        logger.exception("agent_task_error", session_id=session_id, task_id=task_id, error=str(e))
        
        if self.request.retries < self.max_retries:
            self.publisher.publish_trace(
                session_id,
                f"Retrying after error (attempt {self.request.retries + 1}/{self.max_retries}): {str(e)}",
                metadata,
                stage="retry"
            )
            raise self.retry(exc=e)
        
        self.publisher.publish_error(
            session_id,
            f"Agent failed after {self.max_retries} retries: {str(e)}",
            metadata,
            error_type=type(e).__name__,
            recoverable=False
        )
        self.update_session_state(session_id, {"status": "error"})
        
        raise


@celery_app.task(
    bind=True,
    base=AgentTask,
    name="fastapi_sse.workers.agent_task.execute_agent_prompt_priority",
    max_retries=2,
    soft_time_limit=60,
    time_limit=90,
    acks_late=True
)
def execute_agent_prompt_priority(
    self: AgentTask,
    session_id: str,
    prompt: str,
    user_id: Optional[str] = None,
    context: Optional[Dict[str, Any]] = None
) -> Dict[str, Any]:
    """
    Priority queue version of agent execution with lower timeout.
    
    For premium users or time-sensitive operations.
    """
    return execute_agent_prompt.apply(
        args=(session_id, prompt),
        kwargs={"user_id": user_id, "context": context, "use_mock": True},
        task_id=self.request.id
    ).get(disable_sync_subtasks=False)


@celery_app.task(
    bind=True,
    base=AgentTask,
    name="fastapi_sse.workers.agent_task.cancel_agent_task"
)
def cancel_agent_task(
    self: AgentTask,
    session_id: str,
    reason: Optional[str] = None
) -> Dict[str, Any]:
    """
    Cancel an agent task by setting the cancellation flag.
    
    Args:
        session_id: Session identifier
        reason: Optional cancellation reason
        
    Returns:
        Cancellation result
    """
    logger.info("agent_task_cancel_requested", session_id=session_id, reason=reason)
    
    self.publisher.set_cancel_flag(session_id)
    self.update_session_state(session_id, {
        "status": "cancelling",
        "cancel_reason": reason
    })
    
    return {
        "session_id": session_id,
        "cancelled": True,
        "reason": reason
    }


def _execute_real_agent(
    publisher: StreamEventPublisher,
    session_id: str,
    prompt: str,
    user_id: Optional[str],
    task_id: str,
    context: Optional[Dict[str, Any]],
    model: Optional[str],
    metadata: EventMetadata
) -> Dict[str, Any]:
    """
    Execute a real agent (placeholder for integration with actual agent).
    
    This function should be replaced with actual agent integration.
    """
    start_time = time.time()
    
    publisher.publish_trace(
        session_id,
        f"Processing prompt with model: {model or 'default'}",
        metadata,
        stage="init"
    )
    
    time.sleep(0.5)
    
    if publisher.is_cancelled(session_id):
        return {"status": "cancelled"}
    
    publisher.publish_trace(
        session_id,
        "Generating response...",
        metadata,
        stage="generation"
    )
    
    time.sleep(0.5)
    
    response = f"Processed: {prompt[:100]}..."
    
    publisher.publish_final(
        session_id,
        response,
        metadata,
        total_duration_ms=(time.time() - start_time) * 1000
    )
    
    return {
        "status": "completed",
        "response": response,
        "events": 3
    }


@celery_app.task(name="fastapi_sse.workers.agent_task.health_check")
def health_check() -> Dict[str, Any]:
    """Health check task for agent worker."""
    settings = get_settings()
    
    try:
        client = redis.from_url(settings.redis_url, decode_responses=True)
        client.ping()
        redis_ok = True
    except Exception as e:
        redis_ok = False
        logger.error("health_check_redis_failed", error=str(e))
    
    return {
        "status": "healthy" if redis_ok else "degraded",
        "timestamp": datetime.utcnow().isoformat(),
        "redis": redis_ok
    }
