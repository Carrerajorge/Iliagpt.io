#!/usr/bin/env bash
# =============================================================================
# IliaGPT — PostgreSQL Backup to S3/GCS
# Usage: ./scripts/backup/db-backup.sh [--dry-run]
# Env: DATABASE_URL, S3_BUCKET or GCS_BUCKET, BACKUP_ENCRYPTION_KEY
# =============================================================================
set -euo pipefail

RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'
BLUE='\033[0;34m'; NC='\033[0m'
log()  { echo -e "${BLUE}[$(date '+%H:%M:%S')]${NC} $*"; }
ok()   { echo -e "${GREEN}[$(date '+%H:%M:%S')] ✅${NC} $*"; }
warn() { echo -e "${YELLOW}[$(date '+%H:%M:%S')] ⚠️${NC} $*"; }
fail() { echo -e "${RED}[$(date '+%H:%M:%S')] ❌${NC} $*" >&2; exit 1; }

# ── Config ────────────────────────────────────────────────────────────────────
DATABASE_URL="${DATABASE_URL:?DATABASE_URL must be set}"
S3_BUCKET="${S3_BUCKET:-}"
GCS_BUCKET="${GCS_BUCKET:-}"
BACKUP_ENCRYPTION_KEY="${BACKUP_ENCRYPTION_KEY:-}"
BACKUP_DIR="${BACKUP_DIR:-/tmp/iliagpt-backups}"
RETENTION_DAYS="${RETENTION_DAYS:-30}"
DRY_RUN=false
TIMESTAMP=$(date '+%Y%m%d_%H%M%S')
BACKUP_NAME="iliagpt-db-${TIMESTAMP}"
BACKUP_FILE="${BACKUP_DIR}/${BACKUP_NAME}.sql.gz"
BACKUP_FILE_ENC="${BACKUP_FILE}.enc"

[[ "${1:-}" == "--dry-run" ]] && DRY_RUN=true

# ── Validation ────────────────────────────────────────────────────────────────
[[ -z "$S3_BUCKET" && -z "$GCS_BUCKET" ]] && fail "Set S3_BUCKET or GCS_BUCKET"
command -v pg_dump >/dev/null 2>&1 || fail "pg_dump not found"
command -v gzip    >/dev/null 2>&1 || fail "gzip not found"
[[ -n "$BACKUP_ENCRYPTION_KEY" ]] && command -v openssl >/dev/null 2>&1 || \
  { [[ -n "$BACKUP_ENCRYPTION_KEY" ]] && fail "openssl not found but BACKUP_ENCRYPTION_KEY is set"; }

log "=== IliaGPT PostgreSQL Backup ==="
log "Timestamp:  $TIMESTAMP"
log "Dry-run:    $DRY_RUN"
log "Retention:  ${RETENTION_DAYS} days"
echo ""

# ── Create backup dir ─────────────────────────────────────────────────────────
mkdir -p "$BACKUP_DIR"

# ── Extract DB connection params ──────────────────────────────────────────────
DB_HOST=$(echo "$DATABASE_URL" | sed -E 's|.*@([^:/]+).*|\1|')
DB_NAME=$(echo "$DATABASE_URL" | sed -E 's|.*/([^?]+).*|\1|')
log "Backing up database: $DB_NAME on $DB_HOST"

# ── Create dump ───────────────────────────────────────────────────────────────
if [[ "$DRY_RUN" == "false" ]]; then
  log "Running pg_dump..."
  pg_dump \
    --no-password \
    --format=plain \
    --no-owner \
    --no-acl \
    --verbose \
    "$DATABASE_URL" \
    | gzip -9 > "$BACKUP_FILE"
  BACKUP_SIZE=$(du -sh "$BACKUP_FILE" | cut -f1)
  ok "Dump created: $BACKUP_FILE ($BACKUP_SIZE)"
else
  log "[DRY-RUN] Would dump: $DATABASE_URL → $BACKUP_FILE"
fi

# ── Encrypt (optional) ────────────────────────────────────────────────────────
UPLOAD_FILE="$BACKUP_FILE"
if [[ -n "$BACKUP_ENCRYPTION_KEY" ]]; then
  if [[ "$DRY_RUN" == "false" ]]; then
    log "Encrypting backup..."
    openssl enc -aes-256-cbc \
      -salt \
      -pbkdf2 \
      -iter 100000 \
      -pass "pass:${BACKUP_ENCRYPTION_KEY}" \
      -in "$BACKUP_FILE" \
      -out "$BACKUP_FILE_ENC"
    rm -f "$BACKUP_FILE"
    UPLOAD_FILE="$BACKUP_FILE_ENC"
    ok "Encrypted: $UPLOAD_FILE"
  else
    log "[DRY-RUN] Would encrypt backup with AES-256-CBC"
    UPLOAD_FILE="$BACKUP_FILE_ENC"
  fi
fi

# ── Upload to S3 ──────────────────────────────────────────────────────────────
if [[ -n "$S3_BUCKET" ]]; then
  S3_KEY="backups/postgres/${TIMESTAMP:0:8}/${BACKUP_NAME}$(basename "$UPLOAD_FILE" "$BACKUP_FILE")"
  log "Uploading to S3: s3://${S3_BUCKET}/${S3_KEY}"
  if [[ "$DRY_RUN" == "false" ]]; then
    aws s3 cp "$UPLOAD_FILE" "s3://${S3_BUCKET}/${S3_KEY}" \
      --storage-class STANDARD_IA \
      --metadata "created=${TIMESTAMP},database=${DB_NAME},host=${DB_HOST}"
    ok "Uploaded to S3"
  else
    log "[DRY-RUN] Would upload to s3://${S3_BUCKET}/${S3_KEY}"
  fi
fi

# ── Upload to GCS ─────────────────────────────────────────────────────────────
if [[ -n "$GCS_BUCKET" ]]; then
  GCS_KEY="backups/postgres/${TIMESTAMP:0:8}/${BACKUP_NAME}$(basename "$UPLOAD_FILE" "$BACKUP_FILE")"
  log "Uploading to GCS: gs://${GCS_BUCKET}/${GCS_KEY}"
  if [[ "$DRY_RUN" == "false" ]]; then
    gsutil cp "$UPLOAD_FILE" "gs://${GCS_BUCKET}/${GCS_KEY}"
    ok "Uploaded to GCS"
  else
    log "[DRY-RUN] Would upload to gs://${GCS_BUCKET}/${GCS_KEY}"
  fi
fi

# ── Retention policy — delete old backups ─────────────────────────────────────
if [[ -n "$S3_BUCKET" && "$DRY_RUN" == "false" ]]; then
  log "Applying S3 retention policy (${RETENTION_DAYS} days)..."
  aws s3api list-objects \
    --bucket "$S3_BUCKET" \
    --prefix "backups/postgres/" \
    --query "Contents[?LastModified<='$(date -d "-${RETENTION_DAYS} days" '+%Y-%m-%dT%H:%M:%S')'].Key" \
    --output text | tr '\t' '\n' | while read -r key; do
      [[ -n "$key" ]] && {
        log "Deleting old backup: $key"
        aws s3 rm "s3://${S3_BUCKET}/${key}"
      }
    done
  ok "Retention policy applied"
fi

# ── Cleanup local temp files ───────────────────────────────────────────────────
[[ "$DRY_RUN" == "false" ]] && rm -f "$UPLOAD_FILE"

echo ""
ok "=== Backup complete: ${BACKUP_NAME} ==="
