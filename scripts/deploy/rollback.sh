#!/usr/bin/env bash
# =============================================================================
# IliaGPT.io — Kubernetes Rollback Script
# Usage: ./scripts/deploy/rollback.sh [--to-revision N] [--namespace NS]
# =============================================================================

set -euo pipefail

NAMESPACE="${NAMESPACE:-iliagpt}"
DEPLOYMENT_NAME="${DEPLOYMENT_NAME:-iliagpt-app}"
HEALTH_URL="${HEALTH_URL:-https://iliagpt.io/api/health}"
TO_REVISION="${TO_REVISION:-}"

RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'; BLUE='\033[0;34m'; NC='\033[0m'
log()  { echo -e "${BLUE}[$(date '+%H:%M:%S')] INFO:${NC} $*"; }
ok()   { echo -e "${GREEN}[$(date '+%H:%M:%S')]   OK:${NC} $*"; }
warn() { echo -e "${YELLOW}[$(date '+%H:%M:%S')] WARN:${NC} $*"; }
err()  { echo -e "${RED}[$(date '+%H:%M:%S')]  ERR:${NC} $*" >&2; }
die()  { err "$*"; exit 1; }

while [[ $# -gt 0 ]]; do
  case "$1" in
    --to-revision)  TO_REVISION="$2"; shift 2 ;;
    --namespace)    NAMESPACE="$2";   shift 2 ;;
    --help|-h)
      echo "Usage: $0 [--to-revision N] [--namespace NS]"
      echo "  --to-revision N   Roll back to a specific revision (default: previous)"
      exit 0 ;;
    *) die "Unknown argument: $1" ;;
  esac
done

# ── Pre-flight ────────────────────────────────────────────────────────────────
command -v kubectl >/dev/null 2>&1 || die "kubectl not found"
kubectl cluster-info --request-timeout=10s >/dev/null 2>&1 || die "Cannot connect to cluster"

# ── Show rollout history ──────────────────────────────────────────────────────
log "Rollout history for $DEPLOYMENT_NAME:"
kubectl rollout history deployment/"$DEPLOYMENT_NAME" -n "$NAMESPACE"
echo ""

CURRENT_IMAGE=$(kubectl get deployment "$DEPLOYMENT_NAME" -n "$NAMESPACE" \
  -o jsonpath='{.spec.template.spec.containers[0].image}')
log "Current image: $CURRENT_IMAGE"

# ── Confirm ───────────────────────────────────────────────────────────────────
if [[ -z "${AUTO_CONFIRM:-}" ]]; then
  read -r -p "$(echo -e "${YELLOW}Proceed with rollback? [y/N]: ${NC}")" CONFIRM
  [[ "${CONFIRM:-}" =~ ^[Yy]$ ]] || { warn "Rollback cancelled"; exit 0; }
fi

# ── Execute rollback ──────────────────────────────────────────────────────────
if [[ -n "$TO_REVISION" ]]; then
  log "Rolling back to revision $TO_REVISION..."
  kubectl rollout undo deployment/"$DEPLOYMENT_NAME" \
    -n "$NAMESPACE" \
    --to-revision="$TO_REVISION"
else
  log "Rolling back to previous revision..."
  kubectl rollout undo deployment/"$DEPLOYMENT_NAME" -n "$NAMESPACE"
fi

# ── Wait for rollback to complete ─────────────────────────────────────────────
log "Waiting for rollback rollout..."
kubectl rollout status deployment/"$DEPLOYMENT_NAME" \
  -n "$NAMESPACE" \
  --timeout=300s
ok "Rollback rollout complete"

NEW_IMAGE=$(kubectl get deployment "$DEPLOYMENT_NAME" -n "$NAMESPACE" \
  -o jsonpath='{.spec.template.spec.containers[0].image}')
log "New active image: $NEW_IMAGE"

# ── Health check post-rollback ────────────────────────────────────────────────
log "Verifying health after rollback..."
sleep 15
PASS=0
for i in 1 2 3; do
  STATUS=$(curl -s -o /dev/null -w "%{http_code}" --max-time 10 "$HEALTH_URL" 2>/dev/null || echo "000")
  if [[ "$STATUS" == "200" ]]; then
    PASS=$((PASS + 1))
    ok "Health check $i/3: $STATUS"
  else
    warn "Health check $i/3: $STATUS"
  fi
  sleep 5
done

echo ""
if [[ $PASS -ge 2 ]]; then
  ok "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
  ok " Rollback successful and service healthy"
  ok " Active image: $NEW_IMAGE"
  ok "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
else
  err "Service still unhealthy after rollback ($PASS/3 checks passed)"
  err "Manual investigation required"
  exit 1
fi
