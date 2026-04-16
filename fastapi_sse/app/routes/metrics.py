"""Prometheus metrics endpoint for observability."""
from fastapi import APIRouter, Response

from ..observability import (
    get_prometheus_metrics,
    ACTIVE_SSE_CONNECTIONS,
    EVENTS_PUBLISHED,
    EVENTS_DELIVERED,
    REDIS_OPERATIONS,
    RATE_LIMIT_HITS,
    WORKER_TASKS,
    SSE_CONNECTION_DURATION,
    REQUEST_LATENCY,
)

router = APIRouter(tags=["Monitoring"])


@router.get("/metrics", response_class=Response)
async def prometheus_metrics():
    """
    Prometheus-compatible metrics endpoint.
    
    Returns metrics in Prometheus text format including:
    - active_sse_connections: Gauge of current SSE connections
    - events_published_total: Counter of events published
    - events_delivered_total: Counter of events delivered to clients
    - redis_operations_total: Counter of Redis operations by type and status
    - rate_limit_hits_total: Counter of rate limit hits by endpoint
    - worker_tasks_total: Counter of worker tasks by name and status
    - sse_connection_duration_seconds: Histogram of SSE connection durations
    - http_request_duration_seconds: Histogram of HTTP request latencies
    """
    metrics_output = get_prometheus_metrics()
    return Response(
        content=metrics_output,
        media_type="text/plain; version=0.0.4; charset=utf-8"
    )


@router.get("/metrics/json", tags=["Monitoring"])
async def metrics_json():
    """
    JSON format metrics endpoint for debugging and internal use.
    
    Returns a summary of current metric values.
    """
    return {
        "metrics": {
            "active_sse_connections": "See /metrics for current values",
            "events_published_total": "Counter - total events published",
            "events_delivered_total": "Counter - total events delivered",
            "redis_operations_total": "Counter - Redis operations",
            "rate_limit_hits_total": "Counter - rate limit violations",
            "worker_tasks_total": "Counter - Celery worker tasks",
            "sse_connection_duration_seconds": "Histogram - SSE connection durations",
            "http_request_duration_seconds": "Histogram - HTTP request latencies"
        },
        "endpoints": {
            "prometheus": "GET /metrics",
            "json_summary": "GET /metrics/json"
        }
    }
