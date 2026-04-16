"""
SSE Load Testing Script
Tests concurrent connections, measures latency, and tracks failures.
"""
import asyncio
import time
import statistics
import json
from dataclasses import dataclass, field
from typing import List, Optional
from collections import defaultdict
import httpx
import argparse

BASE_URL = "http://localhost:8000"


@dataclass
class ConnectionStats:
    """Statistics for a single connection."""
    session_id: str
    connected: bool = False
    events_received: int = 0
    first_event_latency_ms: Optional[float] = None
    total_duration_ms: float = 0
    error: Optional[str] = None
    event_latencies_ms: List[float] = field(default_factory=list)


@dataclass
class LoadTestResults:
    """Aggregated load test results."""
    total_connections: int = 0
    successful_connections: int = 0
    failed_connections: int = 0
    total_events: int = 0
    
    connection_latencies_ms: List[float] = field(default_factory=list)
    first_event_latencies_ms: List[float] = field(default_factory=list)
    event_latencies_ms: List[float] = field(default_factory=list)
    
    errors: List[str] = field(default_factory=list)
    duration_seconds: float = 0
    
    def add_connection(self, stats: ConnectionStats):
        self.total_connections += 1
        if stats.connected:
            self.successful_connections += 1
            if stats.first_event_latency_ms:
                self.first_event_latencies_ms.append(stats.first_event_latency_ms)
            self.event_latencies_ms.extend(stats.event_latencies_ms)
        else:
            self.failed_connections += 1
        
        self.total_events += stats.events_received
        self.connection_latencies_ms.append(stats.total_duration_ms)
        
        if stats.error:
            self.errors.append(stats.error)
    
    def summary(self) -> dict:
        def safe_stats(data: List[float]) -> dict:
            if not data:
                return {"min": 0, "max": 0, "mean": 0, "median": 0, "p95": 0, "p99": 0}
            sorted_data = sorted(data)
            n = len(sorted_data)
            return {
                "min": round(min(data), 2),
                "max": round(max(data), 2),
                "mean": round(statistics.mean(data), 2),
                "median": round(statistics.median(data), 2),
                "p95": round(sorted_data[int(n * 0.95)] if n > 1 else sorted_data[0], 2),
                "p99": round(sorted_data[int(n * 0.99)] if n > 1 else sorted_data[0], 2),
            }
        
        return {
            "summary": {
                "total_connections": self.total_connections,
                "successful_connections": self.successful_connections,
                "failed_connections": self.failed_connections,
                "success_rate": round(self.successful_connections / max(1, self.total_connections) * 100, 2),
                "total_events": self.total_events,
                "events_per_connection": round(self.total_events / max(1, self.successful_connections), 2),
                "duration_seconds": round(self.duration_seconds, 2),
                "connections_per_second": round(self.total_connections / max(0.001, self.duration_seconds), 2),
            },
            "latencies": {
                "first_event_ms": safe_stats(self.first_event_latencies_ms),
                "event_delivery_ms": safe_stats(self.event_latencies_ms),
                "connection_total_ms": safe_stats(self.connection_latencies_ms),
            },
            "errors": {
                "count": len(self.errors),
                "unique": list(set(self.errors))[:10],
            }
        }


async def run_single_connection(
    connection_id: int,
    prompt: str,
    max_events: int,
    timeout: float
) -> ConnectionStats:
    """Run a single SSE connection and collect stats."""
    session_id = f"load-test-{connection_id}-{int(time.time() * 1000)}"
    url = f"{BASE_URL}/chat/stream?session_id={session_id}&prompt={prompt}"
    
    stats = ConnectionStats(session_id=session_id)
    start_time = time.time()
    last_event_time = start_time
    
    try:
        async with httpx.AsyncClient(timeout=timeout) as client:
            async with client.stream("GET", url) as response:
                if response.status_code != 200:
                    stats.error = f"HTTP {response.status_code}"
                    stats.total_duration_ms = (time.time() - start_time) * 1000
                    return stats
                
                event_type = None
                event_data = None
                
                async for line in response.aiter_lines():
                    line = line.strip()
                    
                    if line.startswith("event:"):
                        event_type = line[6:].strip()
                    elif line.startswith("data:"):
                        try:
                            event_data = json.loads(line[5:].strip())
                        except json.JSONDecodeError:
                            event_data = {}
                    elif line == "" and event_type:
                        now = time.time()
                        latency_ms = (now - last_event_time) * 1000
                        last_event_time = now
                        
                        stats.events_received += 1
                        stats.event_latencies_ms.append(latency_ms)
                        
                        if not stats.connected and event_type == "connected":
                            stats.connected = True
                            stats.first_event_latency_ms = (now - start_time) * 1000
                        
                        if stats.events_received >= max_events:
                            break
                        if event_type in ("final", "error", "timeout"):
                            break
                        
                        event_type = None
                        event_data = None
                        
    except httpx.TimeoutException:
        stats.error = "timeout"
    except httpx.ConnectError as e:
        stats.error = f"connect_error: {str(e)[:50]}"
    except Exception as e:
        stats.error = f"{type(e).__name__}: {str(e)[:50]}"
    
    stats.total_duration_ms = (time.time() - start_time) * 1000
    return stats


async def run_load_test(
    concurrent: int,
    total: int,
    prompt: str,
    max_events: int,
    timeout: float,
    ramp_up_seconds: float
) -> LoadTestResults:
    """
    Run load test with specified concurrency.
    
    Args:
        concurrent: Number of concurrent connections
        total: Total number of connections to make
        prompt: Prompt to send with each connection
        max_events: Max events per connection before closing
        timeout: Timeout per connection in seconds
        ramp_up_seconds: Time to ramp up to full concurrency
    """
    results = LoadTestResults()
    start_time = time.time()
    
    semaphore = asyncio.Semaphore(concurrent)
    completed = 0
    
    async def limited_connection(conn_id: int) -> ConnectionStats:
        nonlocal completed
        
        if ramp_up_seconds > 0 and conn_id < concurrent:
            delay = (conn_id / concurrent) * ramp_up_seconds
            await asyncio.sleep(delay)
        
        async with semaphore:
            stats = await run_single_connection(conn_id, prompt, max_events, timeout)
            completed += 1
            
            if completed % 10 == 0:
                print(f"  Progress: {completed}/{total} connections ({completed/total*100:.1f}%)")
            
            return stats
    
    print(f"\n{'='*60}")
    print(f"SSE Load Test")
    print(f"{'='*60}")
    print(f"Concurrent connections: {concurrent}")
    print(f"Total connections: {total}")
    print(f"Max events per connection: {max_events}")
    print(f"Timeout: {timeout}s")
    print(f"Ramp-up: {ramp_up_seconds}s")
    print(f"{'='*60}\n")
    
    tasks = [limited_connection(i) for i in range(total)]
    connection_stats = await asyncio.gather(*tasks, return_exceptions=True)
    
    for stat in connection_stats:
        if isinstance(stat, Exception):
            results.failed_connections += 1
            results.total_connections += 1
            results.errors.append(str(stat)[:100])
        else:
            results.add_connection(stat)
    
    results.duration_seconds = time.time() - start_time
    
    return results


def print_results(results: LoadTestResults):
    """Print formatted test results."""
    summary = results.summary()
    
    print(f"\n{'='*60}")
    print("LOAD TEST RESULTS")
    print(f"{'='*60}")
    
    s = summary["summary"]
    print(f"\n📊 Summary:")
    print(f"  Total Connections:      {s['total_connections']}")
    print(f"  Successful:             {s['successful_connections']} ({s['success_rate']}%)")
    print(f"  Failed:                 {s['failed_connections']}")
    print(f"  Total Events:           {s['total_events']}")
    print(f"  Events/Connection:      {s['events_per_connection']}")
    print(f"  Duration:               {s['duration_seconds']}s")
    print(f"  Connections/Second:     {s['connections_per_second']}")
    
    lat = summary["latencies"]
    print(f"\n⏱️  First Event Latency (ms):")
    fe = lat["first_event_ms"]
    print(f"  Min: {fe['min']}  Max: {fe['max']}  Mean: {fe['mean']}  P95: {fe['p95']}  P99: {fe['p99']}")
    
    print(f"\n⏱️  Event Delivery Latency (ms):")
    ed = lat["event_delivery_ms"]
    print(f"  Min: {ed['min']}  Max: {ed['max']}  Mean: {ed['mean']}  P95: {ed['p95']}  P99: {ed['p99']}")
    
    err = summary["errors"]
    if err["count"] > 0:
        print(f"\n❌ Errors ({err['count']} total):")
        for e in err["unique"]:
            print(f"  - {e}")
    
    print(f"\n{'='*60}\n")


async def main():
    parser = argparse.ArgumentParser(description="SSE Load Testing Tool")
    parser.add_argument("-c", "--concurrent", type=int, default=10,
                       help="Number of concurrent connections (default: 10)")
    parser.add_argument("-n", "--total", type=int, default=50,
                       help="Total number of connections (default: 50)")
    parser.add_argument("-p", "--prompt", type=str, default="load test",
                       help="Prompt to send (default: 'load test')")
    parser.add_argument("-e", "--max-events", type=int, default=10,
                       help="Max events per connection (default: 10)")
    parser.add_argument("-t", "--timeout", type=float, default=30.0,
                       help="Timeout per connection in seconds (default: 30)")
    parser.add_argument("-r", "--ramp-up", type=float, default=2.0,
                       help="Ramp-up time in seconds (default: 2)")
    parser.add_argument("--url", type=str, default=BASE_URL,
                       help=f"Base URL (default: {BASE_URL})")
    parser.add_argument("--json", action="store_true",
                       help="Output results as JSON")
    
    args = parser.parse_args()
    
    global BASE_URL
    BASE_URL = args.url
    
    results = await run_load_test(
        concurrent=args.concurrent,
        total=args.total,
        prompt=args.prompt,
        max_events=args.max_events,
        timeout=args.timeout,
        ramp_up_seconds=args.ramp_up
    )
    
    if args.json:
        print(json.dumps(results.summary(), indent=2))
    else:
        print_results(results)


if __name__ == "__main__":
    asyncio.run(main())
