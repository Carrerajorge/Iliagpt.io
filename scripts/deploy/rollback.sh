#!/usr/bin/env bash
# =============================================================================
# IliaGPT — Emergency Rollback Script
# Usage: ./scripts/deploy/rollback.sh [--revision N]
# =============================================================================
set -euo pipefail

RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'
BLUE='\033[0;34m'; NC='\033[0m'
log()  { echo -e "${BLUE}[$(date '+%H:%M:%S')]${NC} $*"; }
ok()   { echo -e "${GREEN}[$(date '+%H:%M:%S')] ✅${NC} $*"; }
warn() { echo -e "${YELLOW}[$(date '+%H:%M:%S')] ⚠️${NC} $*"; }
fail() { echo -e "${RED}[$(date '+%H:%M:%S')] ❌${NC} $*" >&2; exit 1; }

NAMESPACE="${NAMESPACE:-iliagpt}"
DEPLOYMENT="${DEPLOYMENT:-iliagpt}"
PRODUCTION_URL="${PRODUCTION_URL:-https://iliagpt.io}"
REVISION=""

for arg in "$@"; do
  case "$arg" in
    --revision) shift; REVISION="$1" ;;
    *) warn "Unknown argument: $arg" ;;
  esac
done

command -v kubectl >/dev/null 2>&1 || fail "kubectl not found in PATH"

log "=== IliaGPT Emergency Rollback ==="
log "Namespace:  $NAMESPACE"
log "Deployment: $DEPLOYMENT"
echo ""

# Show rollout history
log "Rollout history:"
kubectl rollout history "deployment/$DEPLOYMENT" -n "$NAMESPACE" || true
echo ""

# Get current image
CURRENT=$(kubectl get deployment "$DEPLOYMENT" -n "$NAMESPACE" \
  -o jsonpath='{.spec.template.spec.containers[0].image}')
log "Current image: $CURRENT"

# Confirm rollback
warn "This will roll back the production deployment!"
read -r -p "Confirm rollback? Type 'ROLLBACK' to proceed: " CONFIRM
[[ "$CONFIRM" == "ROLLBACK" ]] || fail "Rollback aborted by user."

# Execute rollback
if [[ -n "$REVISION" ]]; then
  log "Rolling back to revision $REVISION..."
  kubectl rollout undo "deployment/$DEPLOYMENT" -n "$NAMESPACE" --to-revision="$REVISION"
else
  log "Rolling back to previous revision..."
  kubectl rollout undo "deployment/$DEPLOYMENT" -n "$NAMESPACE"
fi

# Wait for rollout
log "Waiting for rollback rollout..."
kubectl rollout status "deployment/$DEPLOYMENT" -n "$NAMESPACE" --timeout=300s || \
  fail "Rollback rollout did not complete successfully"
ok "Rollback rollout complete"

# Verify health
log "Verifying health after rollback..."
sleep 10
for i in 1 2 3; do
  HEALTH=$(curl -sf "${PRODUCTION_URL}/api/health" | jq -r '.status' 2>/dev/null || echo "unreachable")
  log "Health check $i/3: $HEALTH"
  [[ "$HEALTH" == "healthy" ]] && { ok "Health restored"; break; }
  [[ "$i" == "3" ]] && fail "Health check still failing after rollback. Manual intervention required."
  sleep 10
done

# Show new state
NEW=$(kubectl get deployment "$DEPLOYMENT" -n "$NAMESPACE" \
  -o jsonpath='{.spec.template.spec.containers[0].image}')
echo ""
ok "=== Rollback complete ==="
log "Previous image: $CURRENT"
log "Current image:  $NEW"
