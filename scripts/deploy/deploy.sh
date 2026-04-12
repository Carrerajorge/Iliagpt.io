#!/usr/bin/env bash
# =============================================================================
# IliaGPT.io — Kubernetes Deployment Script
# Usage: ./scripts/deploy/deploy.sh [--image-tag <tag>] [--namespace <ns>]
#        [--dry-run] [--skip-migration] [--skip-healthcheck]
# =============================================================================

set -euo pipefail

# ── Defaults ──────────────────────────────────────────────────────────────────
NAMESPACE="${NAMESPACE:-iliagpt}"
IMAGE_REPO="${IMAGE_REPO:-ghcr.io/carrerajorge/iliagpt}"
IMAGE_TAG="${IMAGE_TAG:-latest}"
DEPLOYMENT_NAME="${DEPLOYMENT_NAME:-iliagpt-app}"
ROLLOUT_TIMEOUT="${ROLLOUT_TIMEOUT:-600}"
HEALTH_URL="${HEALTH_URL:-https://iliagpt.io/api/health}"
DRY_RUN=false
SKIP_MIGRATION=false
SKIP_HEALTHCHECK=false

# ── Colors ────────────────────────────────────────────────────────────────────
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

log()  { echo -e "${BLUE}[$(date '+%H:%M:%S')] INFO:${NC} $*"; }
ok()   { echo -e "${GREEN}[$(date '+%H:%M:%S')]   OK:${NC} $*"; }
warn() { echo -e "${YELLOW}[$(date '+%H:%M:%S')] WARN:${NC} $*"; }
err()  { echo -e "${RED}[$(date '+%H:%M:%S')]  ERR:${NC} $*" >&2; }

die() { err "$*"; exit 1; }

# ── Argument parsing ──────────────────────────────────────────────────────────
while [[ $# -gt 0 ]]; do
  case "$1" in
    --image-tag)       IMAGE_TAG="$2";       shift 2 ;;
    --namespace)       NAMESPACE="$2";       shift 2 ;;
    --dry-run)         DRY_RUN=true;         shift   ;;
    --skip-migration)  SKIP_MIGRATION=true;  shift   ;;
    --skip-healthcheck) SKIP_HEALTHCHECK=true; shift  ;;
    --help|-h)
      echo "Usage: $0 [--image-tag TAG] [--namespace NS] [--dry-run] [--skip-migration] [--skip-healthcheck]"
      exit 0
      ;;
    *) die "Unknown argument: $1" ;;
  esac
done

FULL_IMAGE="${IMAGE_REPO}:${IMAGE_TAG}"

# ── Pre-flight checks ─────────────────────────────────────────────────────────
log "Pre-flight checks..."
command -v kubectl >/dev/null 2>&1 || die "kubectl not found in PATH"
kubectl cluster-info --request-timeout=10s >/dev/null 2>&1 || die "Cannot connect to Kubernetes cluster"
kubectl get namespace "$NAMESPACE" >/dev/null 2>&1 || die "Namespace $NAMESPACE not found"
ok "Pre-flight checks passed"

# ── Capture rollback snapshot ─────────────────────────────────────────────────
CURRENT_IMAGE=$(kubectl get deployment "$DEPLOYMENT_NAME" -n "$NAMESPACE" \
  -o jsonpath='{.spec.template.spec.containers[0].image}' 2>/dev/null || echo "")
CURRENT_REVISION=$(kubectl get deployment "$DEPLOYMENT_NAME" -n "$NAMESPACE" \
  -o jsonpath='{.metadata.annotations.deployment\.kubernetes\.io/revision}' 2>/dev/null || echo "1")
log "Current image:    ${CURRENT_IMAGE:-<none>}"
log "Current revision: ${CURRENT_REVISION}"
log "Target image:     ${FULL_IMAGE}"

if [[ "$DRY_RUN" == "true" ]]; then
  warn "DRY RUN mode — no changes will be made"
fi

# ── Database migrations ───────────────────────────────────────────────────────
if [[ "$SKIP_MIGRATION" == "false" ]]; then
  log "Running database migrations..."
  JOB_NAME="db-migrate-$(date +%s)"

  if [[ "$DRY_RUN" == "false" ]]; then
    kubectl run "$JOB_NAME" \
      --image="$FULL_IMAGE" \
      --restart=Never \
      --namespace="$NAMESPACE" \
      --command -- node -e "require('./dist/index.cjs').runMigrations()" \
      --pod-running-timeout=120s

    # Wait for migration to complete
    MIGRATION_TIMEOUT=120
    ELAPSED=0
    while [[ $ELAPSED -lt $MIGRATION_TIMEOUT ]]; do
      STATUS=$(kubectl get pod "$JOB_NAME" -n "$NAMESPACE" -o jsonpath='{.status.phase}' 2>/dev/null || echo "Unknown")
      case "$STATUS" in
        Succeeded)
          ok "Migration completed successfully"
          kubectl logs "$JOB_NAME" -n "$NAMESPACE" | tail -20
          kubectl delete pod "$JOB_NAME" -n "$NAMESPACE" --ignore-not-found=true
          break
          ;;
        Failed)
          err "Migration failed!"
          kubectl logs "$JOB_NAME" -n "$NAMESPACE"
          kubectl delete pod "$JOB_NAME" -n "$NAMESPACE" --ignore-not-found=true
          die "Aborting deployment due to migration failure"
          ;;
        *)
          sleep 5
          ELAPSED=$((ELAPSED + 5))
          ;;
      esac
    done
  else
    warn "[DRY RUN] Would run migration job: $JOB_NAME"
  fi
fi

# ── Deploy ────────────────────────────────────────────────────────────────────
log "Deploying $FULL_IMAGE to namespace $NAMESPACE..."
if [[ "$DRY_RUN" == "false" ]]; then
  kubectl set image deployment/"$DEPLOYMENT_NAME" \
    app="$FULL_IMAGE" \
    -n "$NAMESPACE"

  # Annotate with deployment metadata
  kubectl annotate deployment "$DEPLOYMENT_NAME" -n "$NAMESPACE" \
    "deployment.iliagpt.io/image=$FULL_IMAGE" \
    "deployment.iliagpt.io/deployed-by=${USER:-ci}" \
    "deployment.iliagpt.io/timestamp=$(date -u +%Y-%m-%dT%H:%M:%SZ)" \
    --overwrite
else
  warn "[DRY RUN] Would update image to: $FULL_IMAGE"
fi

# ── Wait for rollout ──────────────────────────────────────────────────────────
log "Waiting for rollout (timeout: ${ROLLOUT_TIMEOUT}s)..."
if [[ "$DRY_RUN" == "false" ]]; then
  if ! kubectl rollout status deployment/"$DEPLOYMENT_NAME" \
      -n "$NAMESPACE" \
      --timeout="${ROLLOUT_TIMEOUT}s"; then
    err "Rollout timed out or failed — rolling back"
    kubectl rollout undo deployment/"$DEPLOYMENT_NAME" -n "$NAMESPACE"
    kubectl rollout status deployment/"$DEPLOYMENT_NAME" -n "$NAMESPACE" --timeout=300s
    die "Deployment failed — rolled back to revision $CURRENT_REVISION"
  fi
  ok "Rollout complete"
fi

# ── Health check ──────────────────────────────────────────────────────────────
if [[ "$SKIP_HEALTHCHECK" == "false" && "$DRY_RUN" == "false" ]]; then
  log "Running health checks (3 attempts, 10s apart)..."
  PASS=0
  for i in 1 2 3; do
    sleep 10
    STATUS=$(curl -s -o /dev/null -w "%{http_code}" --max-time 10 "$HEALTH_URL" 2>/dev/null || echo "000")
    if [[ "$STATUS" == "200" ]]; then
      PASS=$((PASS + 1))
      ok "Health check $i/3: HTTP $STATUS"
    else
      warn "Health check $i/3: HTTP $STATUS"
    fi
  done

  if [[ $PASS -lt 2 ]]; then
    err "Health checks failed ($PASS/3) — rolling back"
    kubectl rollout undo deployment/"$DEPLOYMENT_NAME" -n "$NAMESPACE"
    die "Deployment unhealthy — rolled back"
  fi
  ok "Health checks passed ($PASS/3)"
fi

# ── Summary ───────────────────────────────────────────────────────────────────
echo ""
ok "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
ok " Deployment successful!"
ok " Namespace:  $NAMESPACE"
ok " Image:      $FULL_IMAGE"
ok " Health URL: $HEALTH_URL"
ok "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
