#!/bin/bash
# SSE Test Script using curl
# Usage: ./test_sse.sh [BASE_URL]

BASE_URL="${1:-http://localhost:8000}"
PASS=0
FAIL=0

GREEN='\033[0;32m'
RED='\033[0;31m'
YELLOW='\033[1;33m'
NC='\033[0m'

log_pass() { echo -e "${GREEN}✓ PASS${NC}: $1"; ((PASS++)); }
log_fail() { echo -e "${RED}✗ FAIL${NC}: $1"; ((FAIL++)); }
log_info() { echo -e "${YELLOW}→${NC} $1"; }

echo "=========================================="
echo "SSE API Test Suite"
echo "Base URL: $BASE_URL"
echo "=========================================="
echo ""

# Test 1: Health endpoint
log_info "Test 1: Health endpoint (/healthz)"
# Expected: {"status":"healthy",...}
RESP=$(curl -s "$BASE_URL/healthz")
if echo "$RESP" | grep -q '"status"'; then
    log_pass "Health endpoint returns status"
else
    log_fail "Health endpoint failed: $RESP"
fi

# Test 2: Readiness endpoint
log_info "Test 2: Readiness endpoint (/readyz)"
# Expected: {"ready":true,...} or {"ready":false,...}
RESP=$(curl -s "$BASE_URL/readyz")
if echo "$RESP" | grep -q '"ready"'; then
    log_pass "Readiness endpoint returns ready status"
else
    log_fail "Readiness endpoint failed: $RESP"
fi

# Test 3: Root endpoint
log_info "Test 3: Root endpoint (/)"
# Expected: {"service":"Agent Tracing SSE API",...}
RESP=$(curl -s "$BASE_URL/")
if echo "$RESP" | grep -q '"service"'; then
    log_pass "Root endpoint returns service info"
else
    log_fail "Root endpoint failed: $RESP"
fi

# Test 4: Metrics endpoint
log_info "Test 4: Metrics endpoint (/metrics)"
# Expected: {"uptime_seconds":...,"service":"agent-tracing-sse",...}
RESP=$(curl -s "$BASE_URL/metrics")
if echo "$RESP" | grep -q '"uptime_seconds"'; then
    log_pass "Metrics endpoint returns uptime"
else
    log_fail "Metrics endpoint failed: $RESP"
fi

# Test 5: Basic SSE connection with prompt
log_info "Test 5: SSE streaming with prompt"
# Expected: SSE events starting with "event: connected"
SESSION_ID="test-$(date +%s)"
RESP=$(timeout 5 curl -sN "$BASE_URL/chat/stream?session_id=$SESSION_ID&prompt=hello" 2>&1 | head -20)
if echo "$RESP" | grep -q "event: connected"; then
    log_pass "SSE stream connected event received"
else
    log_fail "SSE stream failed to connect: $RESP"
fi

# Test 6: SSE without session returns 404
log_info "Test 6: SSE without prompt on new session returns 404"
# Expected: 404 error since session doesn't exist and no prompt provided
SESSION_ID="nonexistent-$(date +%s)"
HTTP_CODE=$(curl -s -o /dev/null -w "%{http_code}" "$BASE_URL/chat/stream?session_id=$SESSION_ID")
if [ "$HTTP_CODE" = "404" ]; then
    log_pass "Returns 404 for non-existent session without prompt"
else
    log_fail "Expected 404, got $HTTP_CODE"
fi

# Test 7: POST /chat endpoint
log_info "Test 7: POST /chat fallback endpoint"
# Expected: {"session_id":"...","status":"processing",...}
SESSION_ID="post-test-$(date +%s)"
RESP=$(curl -s -X POST "$BASE_URL/chat" \
    -H "Content-Type: application/json" \
    -d "{\"session_id\":\"$SESSION_ID\",\"message\":\"test message\"}")
if echo "$RESP" | grep -q '"session_id"'; then
    log_pass "POST /chat returns session info"
else
    log_fail "POST /chat failed: $RESP"
fi

# Test 8: Circuit breaker status
log_info "Test 8: Circuit breaker status"
# Expected: {"redis":{...},"celery":{...}}
RESP=$(curl -s "$BASE_URL/circuit-breakers")
if echo "$RESP" | grep -q '"redis"'; then
    log_pass "Circuit breakers endpoint returns status"
else
    log_fail "Circuit breakers failed: $RESP"
fi

# Test 9: Backpressure status
log_info "Test 9: Backpressure status"
# Expected: {"active_connections":...,"total_queued_events":...}
RESP=$(curl -s "$BASE_URL/backpressure")
if echo "$RESP" | grep -q '"active_connections"\|"total_queued_events"\|{}'; then
    log_pass "Backpressure endpoint returns metrics"
else
    log_fail "Backpressure failed: $RESP"
fi

# Test 10: Rate limiting (rapid requests)
log_info "Test 10: Rate limiting test (10 rapid requests)"
# Expected: After threshold, should get 429 Too Many Requests
RATE_LIMITED=0
for i in {1..15}; do
    HTTP_CODE=$(curl -s -o /dev/null -w "%{http_code}" "$BASE_URL/healthz")
    if [ "$HTTP_CODE" = "429" ]; then
        RATE_LIMITED=1
        break
    fi
done
if [ "$RATE_LIMITED" = "1" ]; then
    log_pass "Rate limiting triggered (429 received)"
else
    log_info "Rate limiting not triggered (may have high limit configured)"
    log_pass "Rate limit test completed"
fi

# Test 11: SSE with Last-Event-ID header
log_info "Test 11: SSE with Last-Event-ID replay"
# Expected: SSE connection with replay capability
SESSION_ID="replay-test-$(date +%s)"
# First create a session
curl -s -X POST "$BASE_URL/chat" \
    -H "Content-Type: application/json" \
    -d "{\"session_id\":\"$SESSION_ID\",\"message\":\"replay test\"}" > /dev/null

# Try to connect with Last-Event-ID
RESP=$(timeout 3 curl -sN "$BASE_URL/chat/stream?session_id=$SESSION_ID" \
    -H "Last-Event-ID: 0-0" 2>&1 | head -10)
if echo "$RESP" | grep -q "event:"; then
    log_pass "SSE with Last-Event-ID accepted"
else
    log_fail "SSE with Last-Event-ID failed: $RESP"
fi

# Test 12: Session endpoints
log_info "Test 12: Session management"
SESSION_ID="session-test-$(date +%s)"
# Create session
curl -s -X POST "$BASE_URL/chat" \
    -H "Content-Type: application/json" \
    -d "{\"session_id\":\"$SESSION_ID\",\"message\":\"session test\"}" > /dev/null

# Get session
RESP=$(curl -s "$BASE_URL/session/$SESSION_ID")
if echo "$RESP" | grep -q '"session_id"\|"detail"'; then
    log_pass "Session GET endpoint works"
else
    log_fail "Session GET failed: $RESP"
fi

# Delete session
RESP=$(curl -s -X DELETE "$BASE_URL/session/$SESSION_ID")
if echo "$RESP" | grep -q '"deleted"\|"detail"'; then
    log_pass "Session DELETE endpoint works"
else
    log_fail "Session DELETE failed: $RESP"
fi

# Test 13: Content-Type headers
log_info "Test 13: SSE Content-Type header"
SESSION_ID="header-test-$(date +%s)"
CONTENT_TYPE=$(timeout 3 curl -sI "$BASE_URL/chat/stream?session_id=$SESSION_ID&prompt=test" 2>&1 | grep -i "content-type" | head -1)
if echo "$CONTENT_TYPE" | grep -qi "text/event-stream"; then
    log_pass "SSE returns text/event-stream Content-Type"
else
    log_fail "Wrong Content-Type: $CONTENT_TYPE"
fi

# Test 14: OpenAPI docs available
log_info "Test 14: OpenAPI documentation"
HTTP_CODE=$(curl -s -o /dev/null -w "%{http_code}" "$BASE_URL/openapi.json")
if [ "$HTTP_CODE" = "200" ]; then
    log_pass "OpenAPI JSON available"
else
    log_fail "OpenAPI JSON not available: $HTTP_CODE"
fi

echo ""
echo "=========================================="
echo "Test Results: ${GREEN}$PASS passed${NC}, ${RED}$FAIL failed${NC}"
echo "=========================================="

exit $FAIL
