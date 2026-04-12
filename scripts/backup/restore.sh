#!/usr/bin/env bash
# =============================================================================
# IliaGPT — Database Restore from Backup
# Usage: ./scripts/backup/restore.sh <backup-key> [--dry-run]
# Env:   DATABASE_URL, S3_BUCKET or GCS_BUCKET, BACKUP_ENCRYPTION_KEY
# =============================================================================
set -euo pipefail

RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'
BLUE='\033[0;34m'; NC='\033[0m'
log()  { echo -e "${BLUE}[$(date '+%H:%M:%S')]${NC} $*"; }
ok()   { echo -e "${GREEN}[$(date '+%H:%M:%S')] ✅${NC} $*"; }
warn() { echo -e "${YELLOW}[$(date '+%H:%M:%S')] ⚠️${NC} $*"; }
fail() { echo -e "${RED}[$(date '+%H:%M:%S')] ❌${NC} $*" >&2; exit 1; }

DATABASE_URL="${DATABASE_URL:?DATABASE_URL must be set}"
S3_BUCKET="${S3_BUCKET:-}"
GCS_BUCKET="${GCS_BUCKET:-}"
BACKUP_ENCRYPTION_KEY="${BACKUP_ENCRYPTION_KEY:-}"
RESTORE_DIR="${RESTORE_DIR:-/tmp/iliagpt-restore}"
BACKUP_KEY="${1:-}"
DRY_RUN=false
[[ "${2:-}" == "--dry-run" ]] && DRY_RUN=true

[[ -z "$BACKUP_KEY" ]] && fail "Usage: $0 <backup-key> [--dry-run]"
[[ -z "$S3_BUCKET" && -z "$GCS_BUCKET" ]] && fail "Set S3_BUCKET or GCS_BUCKET"
command -v psql    >/dev/null 2>&1 || fail "psql not found"
command -v gunzip  >/dev/null 2>&1 || fail "gunzip not found"

log "=== IliaGPT Database Restore ==="
log "Backup key: $BACKUP_KEY"
log "Dry-run:    $DRY_RUN"

DB_NAME=$(echo "$DATABASE_URL" | sed -E 's|.*/([^?]+).*|\1|')
DB_HOST=$(echo "$DATABASE_URL" | sed -E 's|.*@([^:/]+).*|\1|')
warn "This will OVERWRITE the database: $DB_NAME on $DB_HOST"
read -r -p "Type 'RESTORE' to confirm: " CONFIRM
[[ "$CONFIRM" == "RESTORE" ]] || fail "Restore aborted."

mkdir -p "$RESTORE_DIR"
LOCAL_FILE="${RESTORE_DIR}/$(basename "$BACKUP_KEY")"

# ── Download backup ────────────────────────────────────────────────────────────
if [[ -n "$S3_BUCKET" ]]; then
  log "Downloading from S3: s3://${S3_BUCKET}/${BACKUP_KEY}"
  if [[ "$DRY_RUN" == "false" ]]; then
    aws s3 cp "s3://${S3_BUCKET}/${BACKUP_KEY}" "$LOCAL_FILE"
    ok "Downloaded: $LOCAL_FILE"
  else
    log "[DRY-RUN] Would download from S3"
  fi
elif [[ -n "$GCS_BUCKET" ]]; then
  log "Downloading from GCS: gs://${GCS_BUCKET}/${BACKUP_KEY}"
  if [[ "$DRY_RUN" == "false" ]]; then
    gsutil cp "gs://${GCS_BUCKET}/${BACKUP_KEY}" "$LOCAL_FILE"
    ok "Downloaded: $LOCAL_FILE"
  else
    log "[DRY-RUN] Would download from GCS"
  fi
fi

# ── Decrypt (if encrypted) ────────────────────────────────────────────────────
SQL_GZ="${RESTORE_DIR}/restore.sql.gz"
if [[ "$LOCAL_FILE" == *.enc ]]; then
  [[ -z "$BACKUP_ENCRYPTION_KEY" ]] && fail "Backup is encrypted but BACKUP_ENCRYPTION_KEY is not set"
  log "Decrypting backup..."
  if [[ "$DRY_RUN" == "false" ]]; then
    openssl enc -d -aes-256-cbc \
      -pbkdf2 -iter 100000 \
      -pass "pass:${BACKUP_ENCRYPTION_KEY}" \
      -in "$LOCAL_FILE" \
      -out "$SQL_GZ"
    ok "Decrypted"
  else
    log "[DRY-RUN] Would decrypt backup"
  fi
else
  SQL_GZ="$LOCAL_FILE"
fi

# ── Decompress ────────────────────────────────────────────────────────────────
SQL_FILE="${RESTORE_DIR}/restore.sql"
if [[ "$DRY_RUN" == "false" ]]; then
  log "Decompressing..."
  gunzip -c "$SQL_GZ" > "$SQL_FILE"
  SQL_SIZE=$(du -sh "$SQL_FILE" | cut -f1)
  ok "Decompressed: $SQL_SIZE"
else
  log "[DRY-RUN] Would decompress backup"
fi

# ── Restore to database ────────────────────────────────────────────────────────
if [[ "$DRY_RUN" == "false" ]]; then
  log "Restoring to $DB_NAME..."

  # Drop and recreate schema
  psql "$DATABASE_URL" -c "DROP SCHEMA public CASCADE; CREATE SCHEMA public;" || \
    warn "Schema reset failed — attempting restore anyway"

  # Run restore
  psql --no-password "$DATABASE_URL" < "$SQL_FILE"
  ok "Restore complete"
else
  log "[DRY-RUN] Would restore SQL to $DB_NAME"
fi

# ── Run migrations to ensure schema is up-to-date ─────────────────────────────
if [[ "$DRY_RUN" == "false" ]]; then
  log "Running migrations to ensure schema is current..."
  DATABASE_URL="$DATABASE_URL" npm run db:migrate || warn "Migrations failed — manual inspection needed"
  ok "Migrations applied"
fi

# ── Cleanup ───────────────────────────────────────────────────────────────────
[[ "$DRY_RUN" == "false" ]] && rm -rf "$RESTORE_DIR"

echo ""
ok "=== Restore complete ==="
