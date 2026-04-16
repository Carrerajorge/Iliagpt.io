"""Celery application for distributed task execution."""
from celery import Celery
from kombu import Queue
from .config import get_settings

settings = get_settings()

celery_app = Celery(
    "iliagpt_workers",
    broker=settings.celery_broker,
    backend=settings.celery_backend,
    include=[
        "fastapi_sse.workers.agent_tasks",
        "fastapi_sse.workers.agent_task",
    ]
)

celery_app.conf.update(
    task_serializer="json",
    result_serializer="json",
    accept_content=["json"],
    timezone="UTC",
    enable_utc=True,
    
    task_acks_late=True,
    task_reject_on_worker_lost=True,
    task_time_limit=settings.agent_task_timeout + 30,
    task_soft_time_limit=settings.agent_task_timeout,
    
    worker_prefetch_multiplier=1,
    worker_concurrency=4,
    
    task_default_retry_delay=5,
    task_max_retries=settings.agent_max_retries,
    
    result_expires=3600,
    result_extended=True,
    
    broker_connection_retry_on_startup=True,
    broker_connection_max_retries=10,
    
    task_track_started=True,
    task_send_sent_event=True,
)

celery_app.conf.task_queues = (
    Queue("default", routing_key="default"),
    Queue("agent_queue", routing_key="agent.#"),
    Queue("agent_priority", routing_key="agent.priority.#"),
    Queue("health_queue", routing_key="health.#"),
)

celery_app.conf.task_routes = {
    "fastapi_sse.workers.agent_tasks.*": {"queue": "agent_queue"},
    "fastapi_sse.workers.agent_task.execute_agent_prompt": {
        "queue": "agent_queue",
        "routing_key": "agent.execute",
    },
    "fastapi_sse.workers.agent_task.execute_agent_prompt_priority": {
        "queue": "agent_priority",
        "routing_key": "agent.priority.execute",
    },
    "fastapi_sse.workers.agent_task.cancel_agent_task": {
        "queue": "agent_queue",
        "routing_key": "agent.cancel",
    },
    "fastapi_sse.workers.agent_tasks.health_check": {
        "queue": "health_queue",
        "routing_key": "health.check",
    },
}

celery_app.conf.task_default_queue = "default"
celery_app.conf.task_default_exchange = "tasks"
celery_app.conf.task_default_routing_key = "default"
