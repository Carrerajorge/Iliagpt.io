"""Celery tasks for agent execution."""
import time
import uuid
import asyncio
from datetime import datetime
from typing import Any, Optional
from celery import shared_task
from celery.exceptions import SoftTimeLimitExceeded
import structlog
import redis

from fastapi_sse.app.config import get_settings

logger = structlog.get_logger(__name__)


def get_sync_redis():
    """Get synchronous Redis client for Celery workers."""
    settings = get_settings()
    return redis.from_url(settings.redis_url, decode_responses=True)


def publish_event(session_id: str, event_type: str, data: Any) -> None:
    """Publish event to Redis Pub/Sub channel."""
    import json
    client = get_sync_redis()
    channel = f"events:{session_id}"
    message = json.dumps({"type": event_type, "data": data})
    client.publish(channel, message)


def update_session_state(session_id: str, updates: dict) -> None:
    """Update session state in Redis."""
    import json
    settings = get_settings()
    client = get_sync_redis()
    key = f"session:{session_id}"
    
    data = client.get(key)
    state = json.loads(data) if data else {}
    state.update(updates)
    state["updated_at"] = datetime.utcnow().isoformat()
    
    client.setex(key, settings.session_ttl_seconds, json.dumps(state))


@shared_task(
    bind=True,
    name="fastapi_sse.workers.agent_tasks.execute_agent",
    max_retries=3,
    default_retry_delay=5,
    autoretry_for=(Exception,),
    retry_backoff=True,
    retry_jitter=True
)
def execute_agent(
    self,
    session_id: str,
    message: str,
    context: Optional[dict] = None,
    model: Optional[str] = None
) -> dict:
    """
    Execute agent task with trace events.
    
    This task:
    1. Publishes trace events as it progresses
    2. Publishes final result or error
    3. Updates session state throughout
    """
    start_time = time.time()
    trace_count = 0
    
    try:
        update_session_state(session_id, {
            "status": "processing",
            "task_id": self.request.id
        })
        
        stages = [
            ("parse", "Parsing input message"),
            ("plan", "Planning execution strategy"),
            ("execute", "Executing agent actions"),
            ("synthesize", "Synthesizing response"),
        ]
        
        for stage_name, stage_desc in stages:
            stage_start = time.time()
            event_id = str(uuid.uuid4())
            
            publish_event(session_id, "trace", {
                "event_id": event_id,
                "timestamp": datetime.utcnow().isoformat(),
                "event_type": "stage_start",
                "stage": stage_name,
                "data": {"description": stage_desc}
            })
            trace_count += 1
            
            time.sleep(0.5)
            
            stage_duration = (time.time() - stage_start) * 1000
            publish_event(session_id, "trace", {
                "event_id": str(uuid.uuid4()),
                "timestamp": datetime.utcnow().isoformat(),
                "event_type": "stage_complete",
                "stage": stage_name,
                "duration_ms": stage_duration
            })
            trace_count += 1
        
        result = {
            "response": f"Processed: {message[:100]}...",
            "model": model or "default",
            "context_used": bool(context)
        }
        
        total_duration = (time.time() - start_time) * 1000
        
        publish_event(session_id, "final", {
            "session_id": session_id,
            "success": True,
            "result": result,
            "total_duration_ms": total_duration,
            "trace_count": trace_count
        })
        
        update_session_state(session_id, {
            "status": "completed",
            "message_count": 1
        })
        
        return {
            "success": True,
            "session_id": session_id,
            "result": result,
            "duration_ms": total_duration
        }
        
    except SoftTimeLimitExceeded:
        logger.error("task_timeout", session_id=session_id, task_id=self.request.id)
        
        publish_event(session_id, "error", {
            "message": "Task execution timed out"
        })
        
        update_session_state(session_id, {"status": "error"})
        
        raise
        
    except Exception as e:
        logger.exception("task_error", session_id=session_id, error=str(e))
        
        if self.request.retries < self.max_retries:
            publish_event(session_id, "trace", {
                "event_id": str(uuid.uuid4()),
                "timestamp": datetime.utcnow().isoformat(),
                "event_type": "retry",
                "data": {
                    "attempt": self.request.retries + 1,
                    "max_retries": self.max_retries,
                    "error": str(e)
                }
            })
            raise self.retry(exc=e)
        
        publish_event(session_id, "error", {
            "message": f"Task failed after {self.max_retries} retries: {str(e)}"
        })
        
        update_session_state(session_id, {"status": "error"})
        
        raise


@shared_task(name="fastapi_sse.workers.agent_tasks.health_check")
def health_check() -> dict:
    """Health check task to verify worker connectivity."""
    return {
        "status": "healthy",
        "timestamp": datetime.utcnow().isoformat()
    }
