#!/usr/bin/env bash
# =============================================================================
# IliaGPT.io — PostgreSQL Restore Script
# Usage: ./scripts/backup/restore.sh --backup-file <path> [--confirm]
#        ./scripts/backup/restore.sh --s3-key backups/postgres/iliagpt_20260101_120000.dump
# =============================================================================

set -euo pipefail

DB_HOST="${DB_HOST:-localhost}"
DB_PORT="${DB_PORT:-5432}"
DB_NAME="${DB_NAME:-iliagpt}"
DB_USER="${DB_USER:-iliagpt}"
PGPASSWORD="${PGPASSWORD:?PGPASSWORD is required}"
export PGPASSWORD

BACKUP_FILE=""
S3_BUCKET="${S3_BUCKET:-}"
S3_KEY=""
CONFIRM=false
PARALLEL_JOBS="${PARALLEL_JOBS:-4}"
TEMP_DIR=$(mktemp -d)

RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'; BLUE='\033[0;34m'; NC='\033[0m'
log()  { echo -e "${BLUE}[$(date '+%H:%M:%S')] INFO:${NC} $*"; }
ok()   { echo -e "${GREEN}[$(date '+%H:%M:%S')]   OK:${NC} $*"; }
warn() { echo -e "${YELLOW}[$(date '+%H:%M:%S')] WARN:${NC} $*"; }
err()  { echo -e "${RED}[$(date '+%H:%M:%S')]  ERR:${NC} $*" >&2; }
die()  { err "$*"; exit 1; }

cleanup() { rm -rf "$TEMP_DIR"; }
trap cleanup EXIT

while [[ $# -gt 0 ]]; do
  case "$1" in
    --backup-file) BACKUP_FILE="$2"; shift 2 ;;
    --s3-key)      S3_KEY="$2";      shift 2 ;;
    --confirm)     CONFIRM=true;     shift   ;;
    --help|-h)
      echo "Usage: $0 --backup-file FILE [--confirm]"
      echo "       $0 --s3-key S3_KEY [--confirm]"
      exit 0 ;;
    *) die "Unknown argument: $1" ;;
  esac
done

# ── Download from S3 if needed ────────────────────────────────────────────────
if [[ -n "$S3_KEY" ]]; then
  [[ -n "$S3_BUCKET" ]] || die "--s3-key requires S3_BUCKET env var"
  command -v aws >/dev/null 2>&1 || die "aws CLI not found"
  BACKUP_FILE="${TEMP_DIR}/restore.dump"
  log "Downloading from s3://${S3_BUCKET}/${S3_KEY}..."
  aws s3 cp "s3://${S3_BUCKET}/${S3_KEY}" "$BACKUP_FILE" --no-progress
  ok "Download complete: $(du -sh "$BACKUP_FILE" | cut -f1)"
fi

[[ -n "$BACKUP_FILE" ]] || die "Provide --backup-file or --s3-key"
[[ -f "$BACKUP_FILE" ]] || die "Backup file not found: $BACKUP_FILE"

# ── Verify backup ─────────────────────────────────────────────────────────────
log "Verifying backup: $BACKUP_FILE"
pg_restore --list "$BACKUP_FILE" > /dev/null || die "Backup file is corrupt or invalid"
SIZE=$(du -sh "$BACKUP_FILE" | cut -f1)
ok "Backup valid, size: $SIZE"

# Verify checksum if present
CHECKSUM_FILE="${BACKUP_FILE}.sha256"
if [[ -f "$CHECKSUM_FILE" ]]; then
  sha256sum -c "$CHECKSUM_FILE" || die "Checksum mismatch — backup may be corrupted"
  ok "Checksum verified"
fi

# ── Confirm destructive operation ─────────────────────────────────────────────
warn "⚠  This will DESTROY and recreate database: $DB_NAME @ $DB_HOST:$DB_PORT"
warn "⚠  All existing data will be PERMANENTLY DELETED"
echo ""

if [[ "$CONFIRM" != "true" ]]; then
  read -r -p "$(echo -e "${RED}Type the database name '$DB_NAME' to confirm: ${NC}")" INPUT
  [[ "$INPUT" == "$DB_NAME" ]] || { warn "Confirmation failed. Aborting."; exit 1; }
fi

# ── Test connectivity ─────────────────────────────────────────────────────────
pg_isready -h "$DB_HOST" -p "$DB_PORT" -U "$DB_USER" \
  || die "Cannot connect to PostgreSQL"

# ── Terminate active connections ──────────────────────────────────────────────
log "Terminating active connections to $DB_NAME..."
psql -h "$DB_HOST" -p "$DB_PORT" -U "$DB_USER" -d postgres -c \
  "SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname='${DB_NAME}' AND pid <> pg_backend_pid();" \
  > /dev/null

# ── Drop and recreate database ────────────────────────────────────────────────
log "Dropping database $DB_NAME..."
psql -h "$DB_HOST" -p "$DB_PORT" -U "$DB_USER" -d postgres \
  -c "DROP DATABASE IF EXISTS ${DB_NAME};" > /dev/null

log "Creating fresh database $DB_NAME..."
psql -h "$DB_HOST" -p "$DB_PORT" -U "$DB_USER" -d postgres \
  -c "CREATE DATABASE ${DB_NAME} OWNER ${DB_USER} ENCODING 'UTF8';" > /dev/null

# ── Restore ───────────────────────────────────────────────────────────────────
log "Restoring from backup (${PARALLEL_JOBS} parallel jobs)..."
START=$(date +%s)

pg_restore \
  --host="$DB_HOST" \
  --port="$DB_PORT" \
  --username="$DB_USER" \
  --dbname="$DB_NAME" \
  --jobs="$PARALLEL_JOBS" \
  --verbose \
  --no-password \
  --exit-on-error \
  "$BACKUP_FILE"

END=$(date +%s)
ok "Restore completed in $((END - START))s"

# ── Post-restore: verify table count ─────────────────────────────────────────
TABLE_COUNT=$(psql -h "$DB_HOST" -p "$DB_PORT" -U "$DB_USER" -d "$DB_NAME" \
  -t -c "SELECT count(*) FROM information_schema.tables WHERE table_schema='public';" | tr -d ' ')
ok "Restored $TABLE_COUNT tables"

# ── Analyze ───────────────────────────────────────────────────────────────────
log "Running ANALYZE to update planner statistics..."
psql -h "$DB_HOST" -p "$DB_PORT" -U "$DB_USER" -d "$DB_NAME" \
  -c "ANALYZE;" > /dev/null

echo ""
ok "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
ok " Restore completed successfully"
ok " Database: $DB_NAME"
ok " Tables:   $TABLE_COUNT"
ok "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
