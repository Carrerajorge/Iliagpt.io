# Alert: PAREMemoryPressure

## Summary
This alert fires when the PARE service is experiencing high memory utilization. Memory pressure causes garbage collection pauses, increased latency, and can eventually lead to out-of-memory crashes if not addressed.

## Severity
- **Warning threshold**: Process memory > 80% of available (5 min), or heap > 85% of heap total (5 min)
- **Critical threshold**: Process memory > 90% of available (2 min sustained)
- **SLO impact**: Memory pressure causes GC pauses that degrade latency. OOM crashes cause availability SLO violations.

## Symptoms
- Intermittent latency spikes (GC pauses)
- Process restarts due to OOM killer
- Increased error rates during memory pressure periods
- Workers becoming unresponsive
- Gradual performance degradation over time
- Node.js process consuming excessive RAM

## Diagnosis Steps

### 1. Check current memory status
```bash
curl -s localhost:5000/api/health/ready | jq '.checks.memory'
```

### 2. View detailed memory metrics
```bash
curl -s localhost:5000/api/pare/metrics | jq '.internal.memory'
```

### 3. Check Node.js heap usage
```bash
curl -s localhost:5000/api/pare/metrics/prometheus | grep 'nodejs_heap'
```

### 4. Monitor system memory
```bash
free -m
cat /proc/meminfo | grep -E 'MemTotal|MemFree|MemAvailable|Buffers|Cached'
```

### 5. Check process memory usage
```bash
ps aux --sort=-%mem | head -10
```

### 6. Look for memory growth patterns
```bash
grep -i 'heap\|memory\|oom' /var/log/pare/*.log | tail -50
```

### 7. Check for large file processing
```bash
grep -i 'size\|bytes\|large' /var/log/pare/*.log | tail -50
```

### 8. Review garbage collection logs
```bash
grep -i 'gc\|garbage' /var/log/pare/*.log | tail -50
```

## Resolution

### Immediate mitigation
1. **Force garbage collection** (if V8 flags enabled):
   ```bash
   curl -X POST localhost:5000/api/pare/admin/gc
   ```

2. **Reduce worker count** to lower memory footprint:
   ```bash
   curl -X POST localhost:5000/api/pare/admin/scale -d '{"workers": 2}'
   ```

3. **Reject large files** to prevent memory spikes:
   ```bash
   curl -X PUT localhost:5000/api/pare/admin/config -d '{"maxFileSizeMB": 2}'
   ```

4. **Clear in-memory caches**:
   ```bash
   curl -X POST localhost:5000/api/pare/admin/cache/clear
   ```

5. **Restart workers** to reclaim memory:
   ```bash
   curl -X POST localhost:5000/api/pare/admin/workers/restart
   ```

6. **Graceful restart** if memory is critically high:
   ```bash
   curl -X POST localhost:5000/api/pare/admin/restart -d '{"graceful": true}'
   ```

### Root cause investigation
1. **Identify memory leaks**: Check for growing heap over time without traffic
2. **Analyze file processing**: Large files can cause temporary memory spikes
3. **Review caching behavior**: Unbounded caches grow indefinitely
4. **Check for circular references**: Can prevent garbage collection
5. **Profile memory usage**: Use heap snapshots to identify leaks
6. **Review recent code changes**: New features may have memory regressions

### Memory Profiling
```bash
node --inspect localhost:5000
curl -X POST localhost:5000/api/pare/admin/heap-snapshot
```

### Permanent fix
- Implement streaming parsers for large files
- Add memory limits per worker process
- Set up automatic worker recycling after N requests
- Implement bounded LRU caches with TTL
- Add file size limits based on available memory
- Set up Node.js memory limits with `--max-old-space-size`
- Implement memory-based auto-scaling

## Memory Configuration
- **Node.js heap limit**: 512MB (default)
- **Max heap per worker**: 128MB
- **Cache TTL**: 5 minutes
- **Cache max entries**: 1000

## Memory Thresholds

| Heap Usage | Status | Action |
|------------|--------|--------|
| < 50% | Healthy | Normal operation |
| 50-75% | Elevated | Monitor closely |
| 75-90% | Warning | Reduce load, prepare mitigation |
| > 90% | Critical | Immediate intervention required |

## Escalation
- **L1**: On-call SRE - Restart workers, reduce load, clear caches
- **L2**: PARE team lead - Memory profiling, leak identification
- **L3**: Platform engineering - Infrastructure scaling, container limits

## Related Alerts
- [PAREHighLatency](./PAREHighLatency.md) - GC pauses cause latency spikes
- [PAREHighErrorRate](./PAREHighErrorRate.md) - OOM conditions cause errors
- [PAREWorkerPoolExhausted](./PAREWorkerPoolExhausted.md) - Memory pressure can cause worker failures

## History
| Date | Incident | Resolution |
|------|----------|------------|
| 2026-01-09 | Initial runbook creation | Template established |
| Template | Memory leak in XLSX parser | Upgraded exceljs, added worker recycling |
| Template | OOM during large PDF batch processing | Implemented streaming parser, added file size limits |
