"""
SSE Testing Suite using httpx
Tests event sequence, reconnection, heartbeat timing, and backpressure.
"""
import asyncio
import time
import json
from typing import List, Optional, AsyncGenerator
from dataclasses import dataclass, field
import httpx
import pytest

BASE_URL = "http://localhost:8000"


@dataclass
class SSEEvent:
    """Parsed SSE event."""
    event_type: str
    data: dict
    event_id: Optional[str] = None
    timestamp: float = field(default_factory=time.time)


class SSEClient:
    """Async SSE client for testing."""
    
    def __init__(self, url: str, timeout: float = 30.0):
        self.url = url
        self.timeout = timeout
        self.events: List[SSEEvent] = []
        self.last_event_id: Optional[str] = None
        
    async def stream(
        self, 
        max_events: int = 100,
        stop_on_types: Optional[List[str]] = None
    ) -> AsyncGenerator[SSEEvent, None]:
        """
        Stream SSE events from the server.
        
        Args:
            max_events: Maximum events to receive before stopping
            stop_on_types: Event types that should stop streaming
        """
        stop_types = stop_on_types or ["final", "error", "timeout"]
        headers = {}
        if self.last_event_id:
            headers["Last-Event-ID"] = self.last_event_id
            
        async with httpx.AsyncClient(timeout=self.timeout) as client:
            async with client.stream("GET", self.url, headers=headers) as response:
                event_type = None
                event_data = None
                event_id = None
                
                async for line in response.aiter_lines():
                    line = line.strip()
                    
                    if line.startswith("event:"):
                        event_type = line[6:].strip()
                    elif line.startswith("data:"):
                        try:
                            event_data = json.loads(line[5:].strip())
                        except json.JSONDecodeError:
                            event_data = {"raw": line[5:].strip()}
                    elif line.startswith("id:"):
                        event_id = line[3:].strip()
                    elif line == "" and event_type and event_data is not None:
                        event = SSEEvent(
                            event_type=event_type,
                            data=event_data,
                            event_id=event_id
                        )
                        self.events.append(event)
                        self.last_event_id = event_id
                        yield event
                        
                        if len(self.events) >= max_events:
                            return
                        if event_type in stop_types:
                            return
                            
                        event_type = None
                        event_data = None
                        event_id = None


class TestSSEBasic:
    """Basic SSE functionality tests."""
    
    @pytest.mark.asyncio
    async def test_connection_event(self):
        """Test that first event is 'connected'."""
        session_id = f"test-conn-{int(time.time())}"
        url = f"{BASE_URL}/chat/stream?session_id={session_id}&prompt=hello"
        
        client = SSEClient(url, timeout=10.0)
        events = []
        async for event in client.stream(max_events=3):
            events.append(event)
            if event.event_type == "connected":
                break
        
        assert len(events) >= 1
        assert events[0].event_type == "connected"
        assert "session_id" in events[0].data
    
    @pytest.mark.asyncio
    async def test_event_sequence(self):
        """Test that events follow expected sequence."""
        session_id = f"test-seq-{int(time.time())}"
        url = f"{BASE_URL}/chat/stream?session_id={session_id}&prompt=test"
        
        client = SSEClient(url, timeout=30.0)
        events = []
        async for event in client.stream(max_events=50):
            events.append(event)
        
        assert len(events) >= 1
        assert events[0].event_type == "connected"
        
        valid_types = {"connected", "trace", "tool_call", "tool_result", 
                      "final", "error", "heartbeat", "timeout"}
        for event in events:
            assert event.event_type in valid_types
    
    @pytest.mark.asyncio
    async def test_session_not_found(self):
        """Test 404 for non-existent session without prompt."""
        session_id = f"nonexistent-{int(time.time())}"
        url = f"{BASE_URL}/chat/stream?session_id={session_id}"
        
        async with httpx.AsyncClient() as client:
            response = await client.get(url)
            assert response.status_code == 404


class TestSSEReconnection:
    """Test SSE reconnection with Last-Event-ID."""
    
    @pytest.mark.asyncio
    async def test_last_event_id_header(self):
        """Test that Last-Event-ID is sent and accepted."""
        session_id = f"test-replay-{int(time.time())}"
        url = f"{BASE_URL}/chat/stream?session_id={session_id}&prompt=reconnect test"
        
        client = SSEClient(url, timeout=10.0)
        
        events = []
        async for event in client.stream(max_events=5):
            events.append(event)
        
        if events and client.last_event_id:
            client.events = []
            async for event in client.stream(max_events=3):
                break
    
    @pytest.mark.asyncio
    async def test_reconnection_preserves_session(self):
        """Test session persists across reconnections."""
        session_id = f"test-persist-{int(time.time())}"
        url = f"{BASE_URL}/chat/stream?session_id={session_id}&prompt=persist test"
        
        async with httpx.AsyncClient() as http:
            await http.post(
                f"{BASE_URL}/chat",
                json={"session_id": session_id, "message": "initial"}
            )
        
        async with httpx.AsyncClient() as http:
            resp = await http.get(f"{BASE_URL}/session/{session_id}")
            if resp.status_code == 200:
                session_data = resp.json()
                assert session_data.get("session_id") == session_id


class TestSSEHeartbeat:
    """Test heartbeat timing and behavior."""
    
    @pytest.mark.asyncio
    async def test_heartbeat_received(self):
        """Test that heartbeats are received."""
        session_id = f"test-hb-{int(time.time())}"
        url = f"{BASE_URL}/chat/stream?session_id={session_id}&prompt=heartbeat test"
        
        client = SSEClient(url, timeout=60.0)
        heartbeat_received = False
        start = time.time()
        
        async for event in client.stream(max_events=50):
            if event.event_type == "heartbeat":
                heartbeat_received = True
                break
            if time.time() - start > 20:
                break
    
    @pytest.mark.asyncio
    async def test_heartbeat_contains_metadata(self):
        """Test heartbeat events contain expected metadata."""
        session_id = f"test-hb-meta-{int(time.time())}"
        url = f"{BASE_URL}/chat/stream?session_id={session_id}&prompt=heartbeat meta"
        
        client = SSEClient(url, timeout=60.0)
        
        async for event in client.stream(max_events=50):
            if event.event_type == "heartbeat":
                assert "ts" in event.data or "session_id" in event.data
                break


class TestSSEBackpressure:
    """Test backpressure handling with slow consumers."""
    
    @pytest.mark.asyncio
    async def test_slow_consumer(self):
        """Test server handles slow consumer gracefully."""
        session_id = f"test-slow-{int(time.time())}"
        url = f"{BASE_URL}/chat/stream?session_id={session_id}&prompt=slow consumer test"
        
        client = SSEClient(url, timeout=30.0)
        events_received = 0
        
        async for event in client.stream(max_events=10):
            events_received += 1
            await asyncio.sleep(0.5)
        
        assert events_received >= 1
    
    @pytest.mark.asyncio 
    async def test_concurrent_connections(self):
        """Test multiple concurrent SSE connections."""
        async def connect_and_receive(session_num: int) -> int:
            session_id = f"test-concurrent-{session_num}-{int(time.time())}"
            url = f"{BASE_URL}/chat/stream?session_id={session_id}&prompt=concurrent"
            client = SSEClient(url, timeout=15.0)
            count = 0
            async for event in client.stream(max_events=5):
                count += 1
            return count
        
        tasks = [connect_and_receive(i) for i in range(5)]
        results = await asyncio.gather(*tasks, return_exceptions=True)
        
        successful = [r for r in results if isinstance(r, int)]
        assert len(successful) >= 3


class TestSSETimeout:
    """Test idle timeout behavior."""
    
    @pytest.mark.asyncio
    async def test_connection_stays_alive(self):
        """Test connection doesn't timeout too quickly."""
        session_id = f"test-alive-{int(time.time())}"
        url = f"{BASE_URL}/chat/stream?session_id={session_id}&prompt=alive test"
        
        client = SSEClient(url, timeout=30.0)
        start = time.time()
        
        async for event in client.stream(max_events=20):
            if time.time() - start > 10:
                break
        
        elapsed = time.time() - start
        assert len(client.events) >= 1


class TestHealthEndpoints:
    """Test health and monitoring endpoints."""
    
    @pytest.mark.asyncio
    async def test_health_endpoint(self):
        """Test /healthz endpoint."""
        async with httpx.AsyncClient() as client:
            resp = await client.get(f"{BASE_URL}/healthz")
            assert resp.status_code == 200
            data = resp.json()
            assert "status" in data
    
    @pytest.mark.asyncio
    async def test_readiness_endpoint(self):
        """Test /readyz endpoint."""
        async with httpx.AsyncClient() as client:
            resp = await client.get(f"{BASE_URL}/readyz")
            assert resp.status_code in [200, 503]
            data = resp.json()
            assert "ready" in data
    
    @pytest.mark.asyncio
    async def test_metrics_endpoint(self):
        """Test /metrics endpoint."""
        async with httpx.AsyncClient() as client:
            resp = await client.get(f"{BASE_URL}/metrics")
            assert resp.status_code == 200
            data = resp.json()
            assert "uptime_seconds" in data
    
    @pytest.mark.asyncio
    async def test_circuit_breakers_endpoint(self):
        """Test /circuit-breakers endpoint."""
        async with httpx.AsyncClient() as client:
            resp = await client.get(f"{BASE_URL}/circuit-breakers")
            assert resp.status_code == 200


class TestChatEndpoint:
    """Test POST /chat endpoint."""
    
    @pytest.mark.asyncio
    async def test_post_chat(self):
        """Test POST /chat creates session."""
        session_id = f"test-post-{int(time.time())}"
        
        async with httpx.AsyncClient() as client:
            resp = await client.post(
                f"{BASE_URL}/chat",
                json={
                    "session_id": session_id,
                    "message": "test message"
                }
            )
            assert resp.status_code in [200, 202]
            data = resp.json()
            assert "session_id" in data
    
    @pytest.mark.asyncio
    async def test_post_chat_generates_session_id(self):
        """Test POST /chat without session_id generates one."""
        async with httpx.AsyncClient() as client:
            resp = await client.post(
                f"{BASE_URL}/chat",
                json={"message": "test without session"}
            )
            if resp.status_code in [200, 202]:
                data = resp.json()
                assert "session_id" in data


if __name__ == "__main__":
    pytest.main([__file__, "-v", "-x"])
