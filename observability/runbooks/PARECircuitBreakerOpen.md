# Alert: PARECircuitBreakerOpen

## Summary
This alert fires when one or more circuit breakers in the PARE service have opened due to repeated failures. Circuit breakers protect the system from cascading failures by stopping requests to unhealthy dependencies, but open breakers mean that parser functionality is degraded or unavailable.

## Severity
- **Warning threshold**: Circuit breaker in HALF_OPEN state > 2 min, or trip rate > 0.1/min for 5 min
- **Critical threshold**: Any circuit breaker OPEN for > 30s, or 2+ parsers OPEN simultaneously
- **SLO impact**: Open circuit breakers cause immediate request failures for affected parser types, directly impacting availability SLO.

## Symptoms
- Specific document types failing consistently (e.g., all PDFs failing)
- Fast failures (immediate rejections) instead of timeouts
- Error messages mentioning "circuit breaker open" or "service unavailable"
- Partial functionality - some document types work, others don't
- Agent workflows failing for specific file types

## Diagnosis Steps

### 1. Check circuit breaker states
```bash
curl -s localhost:5000/api/pare/metrics | jq '.circuitBreakers'
```

### 2. View detailed circuit breaker status
```bash
curl -s localhost:5000/api/pare/metrics/prometheus | grep 'pare_circuit_breaker'
```

### 3. Check circuit breaker trip count
```bash
curl -s localhost:5000/api/pare/metrics/prometheus | grep 'pare_circuit_breaker_trips_total'
```

### 4. Identify which parsers are affected
```bash
curl -s localhost:5000/api/health/ready | jq '.checks.circuit_breakers'
```

### 5. Review recent failures that triggered the breaker
```bash
grep -i 'circuit\|breaker\|trip' /var/log/pare/*.log | tail -50
```

### 6. Check underlying dependency health
```bash
curl -s localhost:5000/api/health/ready | jq '.'
```

### 7. Test individual parser health
```bash
curl -X POST localhost:5000/api/pare/admin/test-parser -d '{"parser": "pdf"}'
curl -X POST localhost:5000/api/pare/admin/test-parser -d '{"parser": "xlsx"}'
curl -X POST localhost:5000/api/pare/admin/test-parser -d '{"parser": "docx"}'
```

## Resolution

### Immediate mitigation
1. **Check if underlying issue is resolved** before resetting:
   ```bash
   curl -s localhost:5000/api/health/ready | jq '.checks'
   ```

2. **Force circuit breaker to HALF_OPEN** to test recovery:
   ```bash
   curl -X POST localhost:5000/api/pare/admin/circuit-breaker/half-open -d '{"parser": "pdf"}'
   ```

3. **Reset specific circuit breaker** (only if root cause is fixed):
   ```bash
   curl -X POST localhost:5000/api/pare/admin/circuit-breaker/reset -d '{"parser": "pdf"}'
   ```

4. **Reset all circuit breakers** (use with caution):
   ```bash
   curl -X POST localhost:5000/api/pare/admin/circuit-breaker/reset -d '{"parser": "all"}'
   ```

5. **Disable problematic parser** to prevent cascading failures:
   ```bash
   curl -X POST localhost:5000/api/pare/admin/disable-parser -d '{"parser": "pdf"}'
   ```

### Root cause investigation
1. **Identify failure pattern**: What errors triggered the circuit breaker?
2. **Check dependency health**: Database, file storage, memory, external services
3. **Review parser logs**: Look for exceptions, timeouts, or resource issues
4. **Analyze timing**: Did breaker trip after deployment, traffic spike, or external event?
5. **Check for library issues**: Parser library bugs, version incompatibilities

### Permanent fix
- Tune circuit breaker thresholds based on observed patterns
- Add better health checks for parser dependencies
- Implement graceful degradation with fallback parsers
- Add retry logic with exponential backoff before tripping
- Set up proactive monitoring before breakers trip
- Document and automate recovery procedures

## Circuit Breaker States

| State | Description | Behavior |
|-------|-------------|----------|
| CLOSED | Normal operation | All requests pass through |
| OPEN | Failures exceeded threshold | All requests fail immediately |
| HALF_OPEN | Testing recovery | Limited requests allowed to test health |

## Circuit Breaker Configuration
- **Failure threshold**: 5 failures in 60 seconds
- **Reset timeout**: 30 seconds before trying HALF_OPEN
- **Success threshold**: 3 successes in HALF_OPEN to return to CLOSED

## Escalation
- **L1**: On-call SRE - Verify root cause, reset breakers if safe
- **L2**: PARE team lead - Parser-specific debugging, threshold tuning
- **L3**: Platform engineering - Dependency issues, infrastructure problems

## Related Alerts
- [PAREHighErrorRate](./PAREHighErrorRate.md) - High errors often trigger circuit breakers
- [PAREHighLatency](./PAREHighLatency.md) - Timeouts can trigger circuit breakers
- [PAREWorkerPoolExhausted](./PAREWorkerPoolExhausted.md) - Resource exhaustion may cause parser failures

## History
| Date | Incident | Resolution |
|------|----------|------------|
| 2026-01-09 | Initial runbook creation | Template established |
| Template | PDF circuit breaker tripping on large files | Increased timeout threshold, added file size pre-check |
| Template | All breakers open after database failover | Reset breakers after confirming DB recovery, reduced failure threshold |
