# Alert: PAREWorkerPoolExhausted

## Summary
This alert fires when the PARE worker pool has no available workers to process incoming requests. Worker pool exhaustion causes request queuing, increased latency, and eventually request failures if the condition persists.

## Severity
- **Warning threshold**: Active workers >= 8 (of 10) for > 1 min, or queue depth > 50
- **Critical threshold**: Active workers >= 10 (pool exhausted) for > 30s, or queue depth > 100
- **SLO impact**: Queued requests experience degraded latency. Extended exhaustion causes timeouts and availability SLO violations.

## Symptoms
- Document processing requests stuck in "pending" state
- Increasing queue depth visible in metrics
- New uploads taking much longer than usual
- Agent workflows timing out on document analysis
- Workers showing 100% utilization
- Response times increasing linearly with queue depth

## Diagnosis Steps

### 1. Check worker pool status
```bash
curl -s localhost:5000/api/health/ready | jq '.checks.worker_pool'
```

### 2. View detailed worker metrics
```bash
curl -s localhost:5000/api/pare/metrics/prometheus | grep 'pare_active_workers\|pare_queue_depth'
```

### 3. Check current queue depth
```bash
curl -s localhost:5000/api/pare/metrics | jq '.internal.queueDepth'
```

### 4. Monitor processing times
```bash
curl -s localhost:5000/api/pare/metrics/prometheus | grep 'pare_parse_duration_seconds'
```

### 5. Identify long-running tasks
```bash
curl -s localhost:5000/api/pare/admin/workers/status
```

### 6. Check for stuck workers
```bash
grep -i 'worker\|stuck\|timeout\|processing' /var/log/pare/*.log | tail -100
```

### 7. Review resource utilization
```bash
top -bn1 | head -20
ps aux | grep -E 'node|pare' | head -20
```

### 8. Check memory pressure
```bash
curl -s localhost:5000/api/health/ready | jq '.checks.memory'
```

## Resolution

### Immediate mitigation
1. **Scale up worker pool**:
   ```bash
   curl -X POST localhost:5000/api/pare/admin/scale -d '{"workers": 16}'
   ```

2. **Kill stuck workers** if any are unresponsive:
   ```bash
   curl -X POST localhost:5000/api/pare/admin/workers/kill-stuck -d '{"olderThanMinutes": 5}'
   ```

3. **Restart worker pool** if in bad state:
   ```bash
   curl -X POST localhost:5000/api/pare/admin/workers/restart
   ```

4. **Shed load** by limiting new requests:
   ```bash
   curl -X PUT localhost:5000/api/pare/admin/rate-limit -d '{"limit": 50}'
   ```

5. **Reject large files** to free up workers faster:
   ```bash
   curl -X PUT localhost:5000/api/pare/admin/config -d '{"maxFileSizeMB": 2}'
   ```

6. **Clear stale queue items**:
   ```bash
   curl -X POST localhost:5000/api/pare/admin/queue/clear-stale -d '{"olderThanMinutes": 15}'
   ```

### Root cause investigation
1. **Analyze traffic patterns**: Is this a traffic spike or sustained increase?
2. **Check file sizes**: Are large files monopolizing workers?
3. **Review processing times**: Are specific parsers slower than usual?
4. **Look for stuck workers**: Workers that never complete
5. **Check for memory leaks**: Growing memory usage per worker
6. **Examine retry storms**: Failed requests causing retry loops

### Permanent fix
- Implement auto-scaling based on queue depth
- Add worker timeouts to prevent indefinite hangs
- Set per-request timeouts with graceful termination
- Implement file size-based routing (small files fast-path)
- Add queue depth limits with graceful rejection
- Set up predictive scaling based on traffic patterns

## Worker Pool Configuration
- **Default workers**: 4
- **Max workers**: 16
- **Worker timeout**: 300 seconds
- **Queue max depth**: 100

## Scaling Guidelines

| Queue Depth | Recommended Workers |
|-------------|---------------------|
| 0-10 | 4 (default) |
| 10-25 | 8 |
| 25-50 | 12 |
| 50+ | 16 (max) |

## Escalation
- **L1**: On-call SRE - Scale workers, kill stuck jobs, apply rate limits
- **L2**: PARE team lead - Worker optimization, timeout tuning
- **L3**: Platform engineering - Infrastructure scaling, resource allocation

## Related Alerts
- [PAREHighLatency](./PAREHighLatency.md) - Worker exhaustion causes latency spikes
- [PAREHighErrorRate](./PAREHighErrorRate.md) - Queue overflow leads to request failures
- [PAREMemoryPressure](./PAREMemoryPressure.md) - Memory issues can cause worker failures

## History
| Date | Incident | Resolution |
|------|----------|------------|
| 2026-01-09 | Initial runbook creation | Template established |
| Template | Workers exhausted during morning traffic spike | Implemented auto-scaling, increased default workers to 6 |
| Template | Stuck workers from large XLSX files | Added 5-minute timeout, implemented progress tracking |
