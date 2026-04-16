# Alert: PAREHighLatency

## Summary
This alert fires when the PARE document parsing service response times exceed acceptable thresholds. High latency degrades user experience and can cascade into timeouts, retries, and eventual failures throughout the system.

## Severity
- **Warning threshold**: P99 latency > 3 seconds over 5 minutes
- **Critical threshold**: P99 latency > 5 seconds over 5 minutes (SLO breach)
- **SLO impact**: Violates the P99 < 5s latency SLO for document processing. Extended latency causes client timeouts and retry storms.

## Symptoms
- Users report slow document uploads and analysis
- Chat responses involving documents are delayed
- Browser requests timing out (30s default)
- Agent workflows stuck in "processing" state
- Increased retry traffic visible in request logs
- Queue depth increasing without clearing

## Diagnosis Steps

### 1. Check current latency metrics
```bash
curl -s localhost:5000/api/pare/metrics | jq '.internal.latency'
```

### 2. Review latency histogram by endpoint
```bash
curl -s localhost:5000/api/pare/metrics/prometheus | grep 'pare_request_duration_seconds'
```

### 3. Check parser-specific latency
```bash
curl -s localhost:5000/api/pare/metrics/prometheus | grep 'pare_parse_duration_seconds'
```

### 4. Monitor queue depth
```bash
curl -s localhost:5000/api/pare/metrics/prometheus | grep 'pare_queue_depth'
```

### 5. Check worker pool utilization
```bash
curl -s localhost:5000/api/health/ready | jq '.checks.worker_pool'
```

### 6. Verify database latency
```bash
curl -s localhost:5000/api/health/ready | jq '.checks.database.duration_ms'
```

### 7. Check for large file processing
```bash
grep -i 'processing\|size\|bytes' /var/log/pare/*.log | tail -50
```

### 8. Monitor system resources
```bash
top -bn1 | head -20
free -m
df -h
```

## Resolution

### Immediate mitigation
1. **Scale up worker pool**:
   ```bash
   curl -X POST localhost:5000/api/pare/admin/scale -d '{"workers": 12}'
   ```

2. **Shed load** by rejecting large files temporarily:
   ```bash
   curl -X PUT localhost:5000/api/pare/admin/config -d '{"maxFileSizeMB": 5}'
   ```

3. **Enable request prioritization** for smaller documents:
   ```bash
   curl -X PUT localhost:5000/api/pare/admin/config -d '{"priorityMode": "size-based"}'
   ```

4. **Clear stuck jobs** from the queue:
   ```bash
   curl -X POST localhost:5000/api/pare/admin/queue/clear-stale -d '{"olderThanMinutes": 10}'
   ```

5. **Restart workers** if they're in a bad state:
   ```bash
   curl -X POST localhost:5000/api/pare/admin/workers/restart
   ```

### Root cause investigation
1. **Identify slow parsers**: Check `pare_parse_duration_seconds` histogram for outliers
2. **Analyze file characteristics**: Large files, complex documents, or specific formats
3. **Check for resource contention**: CPU, memory, I/O bottlenecks
4. **Review database queries**: Slow queries or connection pool exhaustion
5. **Examine external dependencies**: S3/storage latency, API rate limits
6. **Check for memory leaks**: Growing heap usage causing GC pauses

### Permanent fix
- Implement streaming parsing for large documents
- Add file size limits with clear user feedback
- Set up horizontal auto-scaling based on queue depth
- Optimize hot-path database queries
- Add caching for frequently accessed documents
- Implement request coalescing for duplicate files

## Escalation
- **L1**: On-call SRE - Worker scaling, load shedding
- **L2**: PARE team lead - Parser optimization, code-level profiling
- **L3**: Platform engineering - Infrastructure scaling, database tuning

## Related Alerts
- [PAREHighErrorRate](./PAREHighErrorRate.md) - Timeouts eventually cause error rate increases
- [PAREWorkerPoolExhausted](./PAREWorkerPoolExhausted.md) - No available workers causes queuing
- [PAREMemoryPressure](./PAREMemoryPressure.md) - Memory pressure causes GC pauses and slowdowns

## History
| Date | Incident | Resolution |
|------|----------|------------|
| 2026-01-09 | Initial runbook creation | Template established |
| Template | P95 latency spike to 8s during traffic surge | Scaled workers to 16, implemented request prioritization |
| Template | XLSX parser latency regression | Identified memory leak in exceljs, upgraded to patched version |
