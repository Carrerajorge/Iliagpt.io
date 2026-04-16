# Alert: PAREHighErrorRate

## Summary
This alert fires when the PARE document parsing service experiences an elevated rate of failed requests. High error rates indicate parsing failures, upstream dependency issues, or invalid input documents that are not being handled gracefully.

## Severity
- **Warning threshold**: Error rate > 0.1% over 5 minutes (burn rate 6x SLO budget)
- **Critical threshold**: Error rate > 1% over 5 minutes (burn rate 14.4x SLO budget)
- **SLO impact**: Directly affects the 99.9% availability SLO for document processing. At critical threshold, the monthly error budget is consumed in ~5 hours.

## Symptoms
- Users report documents failing to parse or upload
- Increased 4xx/5xx responses in API logs
- Document analysis features returning errors or timing out
- Partial or corrupted document outputs
- Agent workflows failing at document extraction step

## Diagnosis Steps

### 1. Check current error rate metrics
```bash
curl -s localhost:5000/api/pare/metrics | jq '.internal.errorRate'
```

### 2. Review error distribution by status code
```bash
curl -s localhost:5000/api/pare/metrics/prometheus | grep 'pare_requests_total' | grep -E '4xx|5xx'
```

### 3. Check recent error logs
```bash
grep -i 'error\|fail\|exception' /var/log/pare/*.log | tail -100
```

### 4. Identify failing parser types
```bash
curl -s localhost:5000/api/pare/metrics/prometheus | grep 'pare_parse_operations_total.*success="false"'
```

### 5. Verify dependencies
- **Database connection**: `curl -s localhost:5000/api/health/ready | jq '.checks.database'`
- **Worker pool status**: `curl -s localhost:5000/api/health/ready | jq '.checks.worker_pool'`
- **Circuit breaker states**: `curl -s localhost:5000/api/pare/metrics | jq '.circuitBreakers'`

### 6. Check for rate limiting
```bash
curl -s localhost:5000/api/pare/metrics/prometheus | grep 'pare_rate_limit_exceeded_total'
```

## Resolution

### Immediate mitigation
1. **Enable graceful degradation**: If specific parser types are failing, temporarily disable them:
   ```bash
   curl -X POST localhost:5000/api/pare/admin/disable-parser -d '{"parser": "pdf"}'
   ```

2. **Scale up workers** if queue is backing up:
   ```bash
   curl -X POST localhost:5000/api/pare/admin/scale -d '{"workers": 8}'
   ```

3. **Reset circuit breakers** if they are stuck open after transient failures:
   ```bash
   curl -X POST localhost:5000/api/pare/admin/circuit-breaker/reset -d '{"parser": "all"}'
   ```

4. **Increase rate limits temporarily** if legitimate traffic is being blocked:
   ```bash
   curl -X PUT localhost:5000/api/pare/admin/rate-limit -d '{"limit": 200}'
   ```

### Root cause investigation
1. **Correlate with deployments**: Check if error spike aligns with recent deployments
2. **Analyze error patterns**: Are errors concentrated on specific file types, sizes, or users?
3. **Check upstream services**: Database, storage, and external APIs
4. **Review memory/CPU usage**: Resource exhaustion can cause parsing failures
5. **Examine input files**: Corrupted or malformed documents may cause systematic failures

### Permanent fix
- Add input validation for problematic document types
- Implement retry logic with exponential backoff
- Add circuit breakers for external dependencies
- Improve error handling and logging granularity
- Set up automated scaling based on queue depth

## Escalation
- **L1**: On-call SRE - Initial triage, basic mitigation steps
- **L2**: PARE team lead - Parser-specific debugging, code-level investigation
- **L3**: Platform engineering - Infrastructure issues, database/storage problems

## Related Alerts
- [PAREHighLatency](./PAREHighLatency.md) - Latency issues often precede error spikes
- [PARECircuitBreakerOpen](./PARECircuitBreakerOpen.md) - Open breakers cause request failures
- [PAREWorkerPoolExhausted](./PAREWorkerPoolExhausted.md) - Resource exhaustion leads to errors

## History
| Date | Incident | Resolution |
|------|----------|------------|
| 2026-01-09 | Initial runbook creation | Template established |
| Template | PDF parser failures after library update | Rolled back pdf-parse dependency to v1.1.1 |
| Template | Spike in 5xx errors during peak load | Scaled worker pool from 4 to 8, implemented request throttling |
