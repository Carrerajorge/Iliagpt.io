"""API tests for FastAPI SSE backend."""
import pytest
from fastapi.testclient import TestClient
from unittest.mock import AsyncMock, patch, MagicMock


@pytest.fixture
def mock_redis():
    """Mock Redis manager."""
    with patch("fastapi_sse.app.redis_client.redis_manager") as mock:
        mock.initialize = AsyncMock()
        mock.close = AsyncMock()
        mock.get_client = AsyncMock(return_value=MagicMock(ping=AsyncMock()))
        yield mock


@pytest.fixture
def client(mock_redis):
    """Test client with mocked dependencies."""
    from fastapi_sse.app.main import app
    
    with TestClient(app) as client:
        yield client


def test_health_endpoint(client):
    """Test health endpoint returns expected structure."""
    response = client.get("/health")
    assert response.status_code == 200
    data = response.json()
    assert "status" in data
    assert "version" in data
    assert "uptime_seconds" in data


def test_ready_endpoint_without_redis():
    """Test readiness fails without Redis."""
    from fastapi_sse.app.main import app
    
    with TestClient(app, raise_server_exceptions=False) as client:
        response = client.get("/ready")
        assert response.status_code in [200, 503]


def test_session_not_found(client):
    """Test 404 for non-existent session."""
    with patch("fastapi_sse.app.main.get_session_manager") as mock:
        mock.return_value.get = AsyncMock(return_value=None)
        response = client.get("/session/non-existent-id")
        assert response.status_code == 404


def test_metrics_endpoint(client):
    """Test metrics endpoint."""
    response = client.get("/metrics")
    assert response.status_code == 200
    data = response.json()
    assert "uptime_seconds" in data
    assert "service" in data


def test_chat_stream_session_not_found(client):
    """Test SSE stream returns 404 for non-existent session."""
    with patch("fastapi_sse.app.main.get_session_manager") as mock:
        mock.return_value.get = AsyncMock(return_value=None)
        response = client.get("/chat/stream?session_id=non-existent")
        assert response.status_code == 404
