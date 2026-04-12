#!/usr/bin/env bash
# =============================================================================
# IliaGPT.io — PostgreSQL Backup Script
# Usage: ./scripts/backup/db-backup.sh [--dest-dir /path] [--s3-bucket bucket]
# Backs up to local dir and optionally uploads to S3.
# Intended to run as a CronJob in Kubernetes.
# =============================================================================

set -euo pipefail

# ── Configuration ─────────────────────────────────────────────────────────────
DB_HOST="${DB_HOST:-localhost}"
DB_PORT="${DB_PORT:-5432}"
DB_NAME="${DB_NAME:-iliagpt}"
DB_USER="${DB_USER:-iliagpt}"
PGPASSWORD="${PGPASSWORD:?PGPASSWORD is required}"
export PGPASSWORD

DEST_DIR="${DEST_DIR:-/backups}"
S3_BUCKET="${S3_BUCKET:-}"
S3_PREFIX="${S3_PREFIX:-backups/postgres}"
RETENTION_DAYS="${RETENTION_DAYS:-30}"
TIMESTAMP=$(date +%Y%m%d_%H%M%S)
BACKUP_FILE="${DEST_DIR}/iliagpt_${TIMESTAMP}.dump"
LOG_FILE="${DEST_DIR}/backup_${TIMESTAMP}.log"

RED='\033[0;31m'; GREEN='\033[0;32m'; BLUE='\033[0;34m'; NC='\033[0m'
log()  { echo -e "${BLUE}[$(date '+%H:%M:%S')] INFO:${NC} $*" | tee -a "$LOG_FILE"; }
ok()   { echo -e "${GREEN}[$(date '+%H:%M:%S')]   OK:${NC} $*" | tee -a "$LOG_FILE"; }
err()  { echo -e "${RED}[$(date '+%H:%M:%S')]  ERR:${NC} $*" | tee -a "$LOG_FILE" >&2; }
die()  { err "$*"; exit 1; }

# ── Setup ─────────────────────────────────────────────────────────────────────
mkdir -p "$DEST_DIR"
log "Starting PostgreSQL backup — $TIMESTAMP"
log "Database: $DB_USER@$DB_HOST:$DB_PORT/$DB_NAME"
log "Destination: $BACKUP_FILE"

# ── Verify connectivity ───────────────────────────────────────────────────────
log "Testing database connection..."
pg_isready -h "$DB_HOST" -p "$DB_PORT" -U "$DB_USER" -d "$DB_NAME" \
  || die "Cannot connect to PostgreSQL at $DB_HOST:$DB_PORT"
ok "Database connection OK"

# ── pg_dump ───────────────────────────────────────────────────────────────────
log "Running pg_dump (custom format, compression level 6)..."
START=$(date +%s)

pg_dump \
  --host="$DB_HOST" \
  --port="$DB_PORT" \
  --username="$DB_USER" \
  --dbname="$DB_NAME" \
  --format=custom \
  --compress=6 \
  --verbose \
  --no-password \
  --file="$BACKUP_FILE" \
  2>> "$LOG_FILE"

END=$(date +%s)
DURATION=$((END - START))
SIZE=$(du -sh "$BACKUP_FILE" | cut -f1)

ok "pg_dump completed in ${DURATION}s, size: $SIZE"

# ── Verify backup integrity ────────────────────────────────────────────────────
log "Verifying backup integrity..."
pg_restore --list "$BACKUP_FILE" > /dev/null \
  || die "Backup integrity check failed — file may be corrupt"
ok "Backup integrity verified"

# ── Checksum ──────────────────────────────────────────────────────────────────
SHA256=$(sha256sum "$BACKUP_FILE" | cut -d' ' -f1)
echo "$SHA256  $BACKUP_FILE" > "${BACKUP_FILE}.sha256"
log "SHA256: $SHA256"

# ── Upload to S3 ──────────────────────────────────────────────────────────────
if [[ -n "$S3_BUCKET" ]]; then
  command -v aws >/dev/null 2>&1 || die "aws CLI not found — cannot upload to S3"
  S3_PATH="s3://${S3_BUCKET}/${S3_PREFIX}/iliagpt_${TIMESTAMP}.dump"
  log "Uploading to S3: $S3_PATH"

  aws s3 cp "$BACKUP_FILE" "$S3_PATH" \
    --storage-class STANDARD_IA \
    --metadata "dbname=$DB_NAME,timestamp=$TIMESTAMP,sha256=$SHA256" \
    --no-progress

  # Upload checksum
  aws s3 cp "${BACKUP_FILE}.sha256" "${S3_PATH}.sha256"

  ok "Uploaded to $S3_PATH"

  # Set S3 lifecycle tag for retention
  aws s3api put-object-tagging \
    --bucket "$S3_BUCKET" \
    --key "${S3_PREFIX}/iliagpt_${TIMESTAMP}.dump" \
    --tagging "TagSet=[{Key=RetainDays,Value=${RETENTION_DAYS}}]" \
    2>/dev/null || true
fi

# ── Prune old local backups ───────────────────────────────────────────────────
log "Pruning local backups older than $RETENTION_DAYS days..."
DELETED=$(find "$DEST_DIR" -name "iliagpt_*.dump" -mtime "+${RETENTION_DAYS}" -print -delete | wc -l)
find "$DEST_DIR" -name "*.sha256" -mtime "+${RETENTION_DAYS}" -delete || true
find "$DEST_DIR" -name "backup_*.log" -mtime "+${RETENTION_DAYS}" -delete || true
log "Deleted $DELETED old backup(s)"

# ── Summary ───────────────────────────────────────────────────────────────────
echo ""
ok "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
ok " Backup completed successfully"
ok " File:     $BACKUP_FILE"
ok " Size:     $SIZE"
ok " Duration: ${DURATION}s"
ok " SHA256:   $SHA256"
[[ -n "$S3_BUCKET" ]] && ok " S3:       $S3_PATH"
ok "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
