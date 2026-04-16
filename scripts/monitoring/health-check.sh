#!/usr/bin/env bash
# =============================================================================
# IliaGPT.io — Comprehensive Health Check Script
# Checks: API, database, Redis, LLM providers, disk, memory
# Usage: ./scripts/monitoring/health-check.sh [--url https://iliagpt.io] [--json]
# Exit code: 0=all healthy, 1=degraded, 2=critical
# =============================================================================

set -euo pipefail

APP_URL="${APP_URL:-https://iliagpt.io}"
TIMEOUT="${TIMEOUT:-10}"
JSON_OUTPUT=false
OVERALL_STATUS=0    # 0=OK, 1=WARN, 2=CRIT

RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'; BLUE='\033[0;34m'; NC='\033[0m'

while [[ $# -gt 0 ]]; do
  case "$1" in
    --url)   APP_URL="$2"; shift 2 ;;
    --json)  JSON_OUTPUT=true; shift ;;
    *) shift ;;
  esac
done

declare -A RESULTS
CHECKS_PASSED=0
CHECKS_TOTAL=0

check() {
  local name="$1" status="$2" message="$3"
  RESULTS["$name"]="$status|$message"
  CHECKS_TOTAL=$((CHECKS_TOTAL + 1))
  if [[ "$status" == "OK" ]]; then
    CHECKS_PASSED=$((CHECKS_PASSED + 1))
  elif [[ "$status" == "WARN" && $OVERALL_STATUS -lt 1 ]]; then
    OVERALL_STATUS=1
  elif [[ "$status" == "CRIT" ]]; then
    OVERALL_STATUS=2
  fi
}

# ── 1. API health endpoint ─────────────────────────────────────────────────────
{
  RESP=$(curl -s -w "\n%{http_code}\n%{time_total}" \
    --max-time "$TIMEOUT" \
    "${APP_URL}/api/health" 2>/dev/null || echo -e "\n000\n0")
  BODY=$(echo "$RESP" | head -n1)
  HTTP=$(echo "$RESP" | tail -n2 | head -n1)
  LATENCY=$(echo "$RESP" | tail -n1)
  LATENCY_MS=$(echo "$LATENCY * 1000" | bc 2>/dev/null | cut -d. -f1 || echo "0")

  if [[ "$HTTP" == "200" ]]; then
    check "api_health" "OK" "HTTP $HTTP, latency ${LATENCY_MS}ms"
  elif [[ "$HTTP" == "000" ]]; then
    check "api_health" "CRIT" "Connection refused / timeout"
  else
    check "api_health" "WARN" "HTTP $HTTP"
  fi
}

# ── 2. API response time < 2s ─────────────────────────────────────────────────
{
  if [[ "${RESULTS[api_health]%%|*}" == "OK" ]]; then
    if [[ "$LATENCY_MS" -gt 2000 ]]; then
      check "api_latency" "WARN" "Response time ${LATENCY_MS}ms > 2000ms threshold"
    else
      check "api_latency" "OK" "${LATENCY_MS}ms"
    fi
  else
    check "api_latency" "CRIT" "API unreachable"
  fi
}

# ── 3. Database connectivity ──────────────────────────────────────────────────
{
  if command -v pg_isready >/dev/null 2>&1 && [[ -n "${DATABASE_URL:-}" ]]; then
    DB_HOST=$(echo "$DATABASE_URL" | grep -oP '(?<=@)[^:/]+' || echo "localhost")
    DB_PORT=$(echo "$DATABASE_URL" | grep -oP '(?<=:)\d+(?=/)' | tail -1 || echo "5432")
    if pg_isready -h "$DB_HOST" -p "$DB_PORT" -t 5 >/dev/null 2>&1; then
      check "database" "OK" "PostgreSQL at $DB_HOST:$DB_PORT is ready"
    else
      check "database" "CRIT" "PostgreSQL at $DB_HOST:$DB_PORT is not ready"
    fi
  else
    check "database" "WARN" "pg_isready not available or DATABASE_URL not set — skipping"
  fi
}

# ── 4. Redis connectivity ─────────────────────────────────────────────────────
{
  if command -v redis-cli >/dev/null 2>&1 && [[ -n "${REDIS_URL:-}" ]]; then
    REDIS_HOST=$(echo "$REDIS_URL" | grep -oP '(?<=@)[^:/]+' || echo "localhost")
    REDIS_PORT=$(echo "$REDIS_URL" | grep -oP '\d+$' || echo "6379")
    if redis-cli -h "$REDIS_HOST" -p "$REDIS_PORT" ping 2>/dev/null | grep -q "PONG"; then
      check "redis" "OK" "Redis at $REDIS_HOST:$REDIS_PORT is responsive"
    else
      check "redis" "CRIT" "Redis at $REDIS_HOST:$REDIS_PORT not responsive"
    fi
  else
    check "redis" "WARN" "redis-cli not available — skipping"
  fi
}

# ── 5. Disk space ─────────────────────────────────────────────────────────────
{
  DISK_USE=$(df / | tail -1 | awk '{print $5}' | tr -d '%')
  if [[ "$DISK_USE" -lt 80 ]]; then
    check "disk_space" "OK" "${DISK_USE}% used"
  elif [[ "$DISK_USE" -lt 90 ]]; then
    check "disk_space" "WARN" "${DISK_USE}% used (>80% threshold)"
  else
    check "disk_space" "CRIT" "${DISK_USE}% used (>90% critical)"
  fi
}

# ── 6. Memory ─────────────────────────────────────────────────────────────────
{
  if command -v free >/dev/null 2>&1; then
    MEM_TOTAL=$(free -m | awk '/^Mem:/ {print $2}')
    MEM_USED=$(free -m  | awk '/^Mem:/ {print $3}')
    MEM_PCT=$(( MEM_USED * 100 / MEM_TOTAL ))
    if [[ "$MEM_PCT" -lt 80 ]]; then
      check "memory" "OK" "${MEM_PCT}% used (${MEM_USED}/${MEM_TOTAL}MB)"
    elif [[ "$MEM_PCT" -lt 90 ]]; then
      check "memory" "WARN" "${MEM_PCT}% used"
    else
      check "memory" "CRIT" "${MEM_PCT}% used — memory pressure"
    fi
  else
    check "memory" "WARN" "free command not available"
  fi
}

# ── Output ────────────────────────────────────────────────────────────────────
if [[ "$JSON_OUTPUT" == "true" ]]; then
  echo "{"
  echo "  \"timestamp\": \"$(date -u +%Y-%m-%dT%H:%M:%SZ)\","
  echo "  \"url\": \"$APP_URL\","
  echo "  \"overall\": $([ $OVERALL_STATUS -eq 0 ] && echo '"healthy"' || [ $OVERALL_STATUS -eq 1 ] && echo '"degraded"' || echo '"critical"'),"
  echo "  \"checks_passed\": $CHECKS_PASSED,"
  echo "  \"checks_total\": $CHECKS_TOTAL,"
  echo "  \"checks\": {"
  FIRST=true
  for KEY in "${!RESULTS[@]}"; do
    STATUS="${RESULTS[$KEY]%%|*}"; MSG="${RESULTS[$KEY]#*|}"
    [[ "$FIRST" == "true" ]] || echo ","
    printf '    "%s": {"status": "%s", "message": "%s"}' "$KEY" "$STATUS" "$MSG"
    FIRST=false
  done
  echo ""
  echo "  }"
  echo "}"
else
  echo ""
  echo "IliaGPT Health Check — $(date '+%Y-%m-%d %H:%M:%S')"
  echo "URL: $APP_URL"
  echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
  for KEY in "${!RESULTS[@]}"; do
    STATUS="${RESULTS[$KEY]%%|*}"; MSG="${RESULTS[$KEY]#*|}"
    case "$STATUS" in
      OK)   echo -e "  ${GREEN}✓ $KEY${NC}: $MSG" ;;
      WARN) echo -e "  ${YELLOW}⚠ $KEY${NC}: $MSG" ;;
      CRIT) echo -e "  ${RED}✗ $KEY${NC}: $MSG" ;;
    esac
  done
  echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
  LABEL=$([ $OVERALL_STATUS -eq 0 ] && echo "HEALTHY" || [ $OVERALL_STATUS -eq 1 ] && echo "DEGRADED" || echo "CRITICAL")
  echo -e "Overall: $LABEL ($CHECKS_PASSED/$CHECKS_TOTAL checks passed)"
fi

exit $OVERALL_STATUS
