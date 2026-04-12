#!/usr/bin/env bash
# =============================================================================
# IliaGPT — Quick Health Check Script
# Usage: ./scripts/monitoring/health-check.sh [URL] [--json] [--verbose]
# =============================================================================
set -euo pipefail

RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'
BLUE='\033[0;34m'; NC='\033[0m'
log()  { echo -e "${BLUE}[$(date '+%H:%M:%S')]${NC} $*"; }
ok()   { echo -e "${GREEN}✅${NC} $*"; }
warn() { echo -e "${YELLOW}⚠️${NC} $*"; }
fail() { echo -e "${RED}❌${NC} $*"; }

BASE_URL="${1:-${APP_URL:-https://iliagpt.io}}"
OUTPUT_JSON=false
VERBOSE=false
OVERALL_PASS=true

for arg in "${@:2}"; do
  case "$arg" in
    --json)    OUTPUT_JSON=true ;;
    --verbose) VERBOSE=true ;;
  esac
done

check() {
  local name="$1" url="$2" expected_status="${3:-200}"
  local start end duration status body

  start=$(date +%s%N)
  body=$(curl -sf -o /tmp/hc_body -w "%{http_code}" "$url" 2>/dev/null || echo "000")
  end=$(date +%s%N)
  duration=$(( (end - start) / 1000000 ))  # ms
  status="$body"

  if [[ "$status" == "$expected_status" ]]; then
    ok "$name — HTTP $status — ${duration}ms"
    [[ "$VERBOSE" == "true" ]] && cat /tmp/hc_body | jq . 2>/dev/null || true
    echo "PASS:$name:$status:$duration" >> /tmp/hc_results
  else
    fail "$name — HTTP $status (expected $expected_status) — ${duration}ms"
    OVERALL_PASS=false
    echo "FAIL:$name:$status:$duration" >> /tmp/hc_results
  fi
}

log "=== IliaGPT Health Check: $BASE_URL ==="
rm -f /tmp/hc_results /tmp/hc_body

# ── API Endpoints ─────────────────────────────────────────────────────────────
check "App Health"        "${BASE_URL}/api/health"     200
check "App Ready"         "${BASE_URL}/api/ready"       200
check "API Root"          "${BASE_URL}/api"             200
check "Auth Check"        "${BASE_URL}/api/user"        401  # Unauthenticated = 401, not 500
check "OpenAI-compat API" "${BASE_URL}/v1/models"       401  # Requires API key
check "Static Assets"     "${BASE_URL}/"                200

# ── Full Health Response ───────────────────────────────────────────────────────
log ""
log "Full health response:"
HEALTH_JSON=$(curl -sf "${BASE_URL}/api/health" 2>/dev/null || echo '{"status":"unreachable"}')
echo "$HEALTH_JSON" | jq . 2>/dev/null || echo "$HEALTH_JSON"

# ── Summary ───────────────────────────────────────────────────────────────────
echo ""
PASS_COUNT=$(grep -c "^PASS" /tmp/hc_results 2>/dev/null || echo 0)
FAIL_COUNT=$(grep -c "^FAIL" /tmp/hc_results 2>/dev/null || echo 0)
TOTAL=$((PASS_COUNT + FAIL_COUNT))
AVG_MS=$(awk -F: '{sum += $4; count++} END {if (count > 0) printf "%.0f", sum/count}' /tmp/hc_results 2>/dev/null || echo "N/A")

log "Results: ${PASS_COUNT}/${TOTAL} checks passed — avg ${AVG_MS}ms"

if [[ "$OUTPUT_JSON" == "true" ]]; then
  jq -n \
    --arg url "$BASE_URL" \
    --argjson pass "$PASS_COUNT" \
    --argjson fail "$FAIL_COUNT" \
    --argjson total "$TOTAL" \
    --arg avg_ms "$AVG_MS" \
    --arg status "$([[ "$OVERALL_PASS" == "true" ]] && echo healthy || echo unhealthy)" \
    '{url: $url, status: $status, checks: {pass: $pass, fail: $fail, total: $total}, avg_latency_ms: ($avg_ms | tonumber)}'
fi

rm -f /tmp/hc_results /tmp/hc_body

if [[ "$OVERALL_PASS" == "true" ]]; then
  ok "All health checks passed"
  exit 0
else
  fail "One or more health checks failed"
  exit 1
fi
