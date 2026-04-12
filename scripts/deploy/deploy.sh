#!/usr/bin/env bash
# =============================================================================
# IliaGPT — Production Deploy Script
# Usage: ./scripts/deploy/deploy.sh <image-tag> [--dry-run] [--skip-tests]
# =============================================================================
set -euo pipefail

# ── Colours ───────────────────────────────────────────────────────────────────
RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'
BLUE='\033[0;34m'; NC='\033[0m'
log()  { echo -e "${BLUE}[$(date '+%H:%M:%S')]${NC} $*"; }
ok()   { echo -e "${GREEN}[$(date '+%H:%M:%S')] ✅${NC} $*"; }
warn() { echo -e "${YELLOW}[$(date '+%H:%M:%S')] ⚠️${NC} $*"; }
fail() { echo -e "${RED}[$(date '+%H:%M:%S')] ❌${NC} $*" >&2; exit 1; }

# ── Config ────────────────────────────────────────────────────────────────────
NAMESPACE="${NAMESPACE:-iliagpt}"
DEPLOYMENT="${DEPLOYMENT:-iliagpt}"
REGISTRY="${REGISTRY:-ghcr.io/iliagpt/iliagpt}"
PRODUCTION_URL="${PRODUCTION_URL:-https://iliagpt.io}"
ROLLOUT_TIMEOUT="${ROLLOUT_TIMEOUT:-600s}"
KUBECONFIG="${KUBECONFIG:-$HOME/.kube/config}"

IMAGE_TAG="${1:-}"
DRY_RUN=false
SKIP_TESTS=false

# ── Parse args ────────────────────────────────────────────────────────────────
for arg in "${@:2}"; do
  case "$arg" in
    --dry-run)     DRY_RUN=true ;;
    --skip-tests)  SKIP_TESTS=true ;;
    *) warn "Unknown argument: $arg" ;;
  esac
done

# ── Validation ────────────────────────────────────────────────────────────────
[[ -z "$IMAGE_TAG" ]] && fail "Usage: $0 <image-tag> [--dry-run] [--skip-tests]"
command -v kubectl >/dev/null 2>&1 || fail "kubectl not found in PATH"
command -v curl    >/dev/null 2>&1 || fail "curl not found in PATH"

IMAGE="${REGISTRY}:${IMAGE_TAG}"

log "=== IliaGPT Production Deploy ==="
log "Image:      $IMAGE"
log "Namespace:  $NAMESPACE"
log "Deployment: $DEPLOYMENT"
log "Dry-run:    $DRY_RUN"
echo ""

# ── Safety checks ─────────────────────────────────────────────────────────────
log "Running pre-deploy safety checks..."

# 1. Verify current cluster context
CLUSTER=$(kubectl config current-context)
log "Kubernetes context: $CLUSTER"
if [[ "$CLUSTER" != *"prod"* && "$CLUSTER" != *"production"* ]]; then
  warn "Context '$CLUSTER' does not look like a production cluster."
  read -r -p "Continue anyway? [y/N] " CONFIRM
  [[ "${CONFIRM,,}" == "y" ]] || fail "Aborted by user."
fi

# 2. Check deployment exists
kubectl get deployment "$DEPLOYMENT" -n "$NAMESPACE" >/dev/null 2>&1 || \
  fail "Deployment '$DEPLOYMENT' not found in namespace '$NAMESPACE'"

# 3. Record current image for rollback
PREV_IMAGE=$(kubectl get deployment "$DEPLOYMENT" -n "$NAMESPACE" \
  -o jsonpath='{.spec.template.spec.containers[0].image}')
log "Previous image: $PREV_IMAGE"

# 4. Check production health before deploy
HEALTH=$(curl -sf "${PRODUCTION_URL}/api/health" | jq -r '.status' 2>/dev/null || echo "unreachable")
log "Pre-deploy health: $HEALTH"
if [[ "$HEALTH" == "unreachable" ]]; then
  warn "Production health check returned 'unreachable'. The service may already be down."
fi

# ── Run migrations ─────────────────────────────────────────────────────────────
log "Running database migrations (dry-run first)..."
if [[ "$DRY_RUN" == "false" ]]; then
  docker run --rm \
    -e DATABASE_URL="${DATABASE_URL:?DATABASE_URL must be set}" \
    "$IMAGE" node dist/index.cjs --migrate-dry-run || fail "Migration dry-run failed"
  ok "Migration dry-run passed"

  docker run --rm \
    -e DATABASE_URL="${DATABASE_URL}" \
    "$IMAGE" node dist/index.cjs --migrate-only || fail "Migration failed"
  ok "Migrations applied"
else
  log "[DRY-RUN] Would run migrations with $IMAGE"
fi

# ── Deploy ────────────────────────────────────────────────────────────────────
log "Deploying $IMAGE..."
if [[ "$DRY_RUN" == "false" ]]; then
  kubectl set image "deployment/$DEPLOYMENT" "${DEPLOYMENT}=${IMAGE}" \
    -n "$NAMESPACE" --record
  log "Waiting for rollout (timeout: $ROLLOUT_TIMEOUT)..."
  kubectl rollout status "deployment/$DEPLOYMENT" -n "$NAMESPACE" --timeout="$ROLLOUT_TIMEOUT" || {
    fail "Rollout failed. Run ./scripts/deploy/rollback.sh to revert."
  }
  ok "Rollout complete"
else
  log "[DRY-RUN] Would deploy: kubectl set image deployment/$DEPLOYMENT ${DEPLOYMENT}=${IMAGE}"
fi

# ── Post-deploy health check ──────────────────────────────────────────────────
log "Verifying deployment health..."
sleep 10
if [[ "$DRY_RUN" == "false" ]]; then
  for i in 1 2 3; do
    HEALTH=$(curl -sf "${PRODUCTION_URL}/api/health" | jq -r '.status' 2>/dev/null || echo "unreachable")
    log "Health check $i/3: $HEALTH"
    [[ "$HEALTH" == "healthy" ]] && { ok "Health check passed"; break; }
    [[ "$i" == "3" ]] && fail "Health check failed after 3 attempts. Consider rollback."
    sleep 10
  done
fi

# ── Smoke tests ───────────────────────────────────────────────────────────────
if [[ "$SKIP_TESTS" == "false" && "$DRY_RUN" == "false" ]]; then
  log "Running post-deploy smoke tests..."
  BASE_URL="$PRODUCTION_URL" npm run test:smoke || {
    warn "Smoke tests failed. Consider rollback: ./scripts/deploy/rollback.sh"
  }
  ok "Smoke tests passed"
fi

# ── Done ──────────────────────────────────────────────────────────────────────
echo ""
ok "=== Deployment complete ==="
log "Image deployed: $IMAGE"
log "Previous image: $PREV_IMAGE (use rollback.sh to revert)"
