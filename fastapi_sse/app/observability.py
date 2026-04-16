"""OpenTelemetry observability setup with tracing, metrics, and structured logging."""
import os
import logging
from typing import Optional, Any
from contextlib import contextmanager
from functools import wraps

import structlog
from opentelemetry import trace, metrics
from opentelemetry.sdk.trace import TracerProvider
from opentelemetry.sdk.trace.export import BatchSpanProcessor
from opentelemetry.sdk.metrics import MeterProvider
from opentelemetry.sdk.metrics.export import PeriodicExportingMetricReader
from opentelemetry.sdk.resources import Resource, SERVICE_NAME, SERVICE_VERSION
from opentelemetry.exporter.otlp.proto.grpc.trace_exporter import OTLPSpanExporter
from opentelemetry.exporter.otlp.proto.grpc.metric_exporter import OTLPMetricExporter
from opentelemetry.instrumentation.fastapi import FastAPIInstrumentor
from opentelemetry.instrumentation.redis import RedisInstrumentor
from opentelemetry.propagate import set_global_textmap
from opentelemetry.propagators.b3 import B3MultiFormat
from opentelemetry.trace import Status, StatusCode, Span
from opentelemetry.trace.propagation.tracecontext import TraceContextTextMapPropagator
from prometheus_client import Counter, Gauge, Histogram, CollectorRegistry, generate_latest


REGISTRY = CollectorRegistry()

ACTIVE_SSE_CONNECTIONS = Gauge(
    "active_sse_connections",
    "Number of active SSE connections",
    ["session_id"],
    registry=REGISTRY
)

EVENTS_PUBLISHED = Counter(
    "events_published_total",
    "Total number of events published",
    ["event_type"],
    registry=REGISTRY
)

EVENTS_DELIVERED = Counter(
    "events_delivered_total",
    "Total number of events delivered to clients",
    ["session_id", "event_type"],
    registry=REGISTRY
)

REDIS_OPERATIONS = Counter(
    "redis_operations_total",
    "Total number of Redis operations",
    ["operation", "status"],
    registry=REGISTRY
)

RATE_LIMIT_HITS = Counter(
    "rate_limit_hits_total",
    "Total number of rate limit hits",
    ["endpoint", "client_ip"],
    registry=REGISTRY
)

WORKER_TASKS = Counter(
    "worker_tasks_total",
    "Total number of worker tasks",
    ["task_name", "status"],
    registry=REGISTRY
)

SSE_CONNECTION_DURATION = Histogram(
    "sse_connection_duration_seconds",
    "Duration of SSE connections in seconds",
    ["session_id"],
    buckets=[1, 5, 10, 30, 60, 120, 300, 600],
    registry=REGISTRY
)

REQUEST_LATENCY = Histogram(
    "http_request_duration_seconds",
    "HTTP request latency in seconds",
    ["method", "endpoint", "status_code"],
    buckets=[0.01, 0.05, 0.1, 0.25, 0.5, 1.0, 2.5, 5.0, 10.0],
    registry=REGISTRY
)


class TelemetryManager:
    """Manages OpenTelemetry tracing and metrics setup."""
    
    _instance: Optional["TelemetryManager"] = None
    _initialized: bool = False
    
    def __new__(cls) -> "TelemetryManager":
        if cls._instance is None:
            cls._instance = super().__new__(cls)
        return cls._instance
    
    def __init__(self):
        if TelemetryManager._initialized:
            return
        
        self.service_name = os.getenv("OTEL_SERVICE_NAME", "fastapi-sse")
        self.service_version = os.getenv("OTEL_SERVICE_VERSION", "1.0.0")
        self.otlp_endpoint = os.getenv("OTEL_EXPORTER_OTLP_ENDPOINT", "")
        self.log_level = os.getenv("LOG_LEVEL", "INFO").upper()
        
        self.tracer: Optional[trace.Tracer] = None
        self.meter: Optional[metrics.Meter] = None
        
        TelemetryManager._initialized = True
    
    def setup(self) -> None:
        """Initialize OpenTelemetry tracing and metrics."""
        resource = Resource.create({
            SERVICE_NAME: self.service_name,
            SERVICE_VERSION: self.service_version,
            "deployment.environment": os.getenv("ENVIRONMENT", "development"),
        })
        
        self._setup_tracing(resource)
        self._setup_metrics(resource)
        self._setup_logging()
        self._setup_propagation()
    
    def _setup_tracing(self, resource: Resource) -> None:
        """Configure OpenTelemetry tracing with OTLP exporter."""
        tracer_provider = TracerProvider(resource=resource)
        
        if self.otlp_endpoint:
            otlp_exporter = OTLPSpanExporter(
                endpoint=self.otlp_endpoint,
                insecure=os.getenv("OTEL_EXPORTER_OTLP_INSECURE", "true").lower() == "true"
            )
            span_processor = BatchSpanProcessor(otlp_exporter)
            tracer_provider.add_span_processor(span_processor)
        
        trace.set_tracer_provider(tracer_provider)
        self.tracer = trace.get_tracer(self.service_name, self.service_version)
    
    def _setup_metrics(self, resource: Resource) -> None:
        """Configure OpenTelemetry metrics with Prometheus exporter."""
        if self.otlp_endpoint:
            otlp_metric_exporter = OTLPMetricExporter(
                endpoint=self.otlp_endpoint,
                insecure=os.getenv("OTEL_EXPORTER_OTLP_INSECURE", "true").lower() == "true"
            )
            metric_reader = PeriodicExportingMetricReader(
                otlp_metric_exporter,
                export_interval_millis=int(os.getenv("OTEL_METRIC_EXPORT_INTERVAL", "60000"))
            )
            meter_provider = MeterProvider(resource=resource, metric_readers=[metric_reader])
        else:
            meter_provider = MeterProvider(resource=resource)
        
        metrics.set_meter_provider(meter_provider)
        self.meter = metrics.get_meter(self.service_name, self.service_version)
    
    def _setup_logging(self) -> None:
        """Configure structured logging with structlog."""
        logging.basicConfig(
            format="%(message)s",
            level=getattr(logging, self.log_level, logging.INFO)
        )
        
        structlog.configure(
            processors=[
                structlog.stdlib.filter_by_level,
                structlog.stdlib.add_logger_name,
                structlog.stdlib.add_log_level,
                structlog.stdlib.PositionalArgumentsFormatter(),
                structlog.processors.TimeStamper(fmt="iso"),
                structlog.processors.StackInfoRenderer(),
                structlog.processors.format_exc_info,
                structlog.processors.UnicodeDecoder(),
                self._add_trace_context,
                structlog.processors.JSONRenderer()
            ],
            wrapper_class=structlog.stdlib.BoundLogger,
            context_class=dict,
            logger_factory=structlog.stdlib.LoggerFactory(),
            cache_logger_on_first_use=True,
        )
    
    def _setup_propagation(self) -> None:
        """Configure trace context propagation."""
        set_global_textmap(TraceContextTextMapPropagator())
    
    @staticmethod
    def _add_trace_context(logger: Any, method_name: str, event_dict: dict) -> dict:
        """Add trace context to log entries."""
        span = trace.get_current_span()
        if span and span.is_recording():
            ctx = span.get_span_context()
            event_dict["trace_id"] = format(ctx.trace_id, "032x")
            event_dict["span_id"] = format(ctx.span_id, "016x")
        return event_dict
    
    def instrument_fastapi(self, app) -> None:
        """Instrument FastAPI application."""
        FastAPIInstrumentor.instrument_app(
            app,
            excluded_urls="healthz,readyz,metrics,docs,openapi.json"
        )
    
    def instrument_redis(self) -> None:
        """Instrument Redis client."""
        RedisInstrumentor().instrument()
    
    def get_tracer(self) -> trace.Tracer:
        """Get the configured tracer."""
        if self.tracer is None:
            self.setup()
        return self.tracer
    
    def get_meter(self) -> metrics.Meter:
        """Get the configured meter."""
        if self.meter is None:
            self.setup()
        return self.meter


def get_telemetry() -> TelemetryManager:
    """Get the telemetry manager singleton."""
    return TelemetryManager()


@contextmanager
def create_span(
    name: str,
    session_id: Optional[str] = None,
    attributes: Optional[dict] = None
):
    """Create a custom span with optional session_id for correlation."""
    telemetry = get_telemetry()
    tracer = telemetry.get_tracer()
    
    span_attributes = attributes or {}
    if session_id:
        span_attributes["session.id"] = session_id
    
    with tracer.start_as_current_span(name, attributes=span_attributes) as span:
        try:
            yield span
        except Exception as e:
            span.set_status(Status(StatusCode.ERROR, str(e)))
            span.record_exception(e)
            raise


def trace_sse_connection(session_id: str):
    """Decorator to trace SSE connection lifecycle."""
    def decorator(func):
        @wraps(func)
        async def wrapper(*args, **kwargs):
            with create_span(
                "sse.connection",
                session_id=session_id,
                attributes={"sse.type": "connection"}
            ) as span:
                ACTIVE_SSE_CONNECTIONS.labels(session_id=session_id).inc()
                try:
                    result = await func(*args, **kwargs)
                    span.set_status(Status(StatusCode.OK))
                    return result
                finally:
                    ACTIVE_SSE_CONNECTIONS.labels(session_id=session_id).dec()
        return wrapper
    return decorator


def trace_redis_operation(operation: str):
    """Decorator to trace Redis operations."""
    def decorator(func):
        @wraps(func)
        async def wrapper(*args, **kwargs):
            session_id = kwargs.get("session_id", "unknown")
            with create_span(
                f"redis.{operation}",
                session_id=session_id,
                attributes={"redis.operation": operation}
            ) as span:
                try:
                    result = await func(*args, **kwargs)
                    REDIS_OPERATIONS.labels(operation=operation, status="success").inc()
                    span.set_status(Status(StatusCode.OK))
                    return result
                except Exception as e:
                    REDIS_OPERATIONS.labels(operation=operation, status="error").inc()
                    span.set_status(Status(StatusCode.ERROR, str(e)))
                    raise
        return wrapper
    return decorator


def record_event_published(event_type: str) -> None:
    """Record an event being published."""
    EVENTS_PUBLISHED.labels(event_type=event_type).inc()


def record_event_delivered(session_id: str, event_type: str) -> None:
    """Record an event being delivered to a client."""
    EVENTS_DELIVERED.labels(session_id=session_id, event_type=event_type).inc()


def record_rate_limit_hit(endpoint: str, client_ip: str) -> None:
    """Record a rate limit hit."""
    RATE_LIMIT_HITS.labels(endpoint=endpoint, client_ip=client_ip).inc()


def record_worker_task(task_name: str, status: str) -> None:
    """Record a worker task execution."""
    WORKER_TASKS.labels(task_name=task_name, status=status).inc()


def get_prometheus_metrics() -> bytes:
    """Generate Prometheus metrics output."""
    return generate_latest(REGISTRY)


logger = structlog.get_logger(__name__)
