#!/usr/bin/env bash
# Cron jobs for HN Showcase data pipeline
# Add to crontab: crontab -e
#
# Screenshots and AI analysis are now handled by the continuous worker process
# (hn-worker in PM2). Ingestion, the FTS rebuild and the health check run from
# cron.
#
# Suggested schedule:
#   */30 * * * *  /path/to/deploy/cron.sh ingest
#   0 3 * * *     /path/to/deploy/cron.sh fts
#   20,50 * * * * /path/to/deploy/cron.sh health
#   40 3 * * *    /path/to/deploy/cron.sh backup
#
# The health check tells you when ingest or analysis has stopped, once
# HEALTH_PING_URL is set (see app/.env.example). It only reads the database.
#
# The backup writes a compressed copy of the database to app/data/backups and
# keeps the newest seven. It runs while the site and the worker are up.
#
# The worker (pm2 start ecosystem.config.cjs) continuously processes
# screenshot and analyze tasks enqueued by ingest.

set -euo pipefail

export PATH="/usr/local/bin:/usr/bin:/bin:$PATH"

APP_DIR="$(cd "$(dirname "$0")/../app" && pwd)"
LOG_DIR="$APP_DIR/../logs"
mkdir -p "$LOG_DIR"

# Source the trusted local environment without word-splitting or globbing its
# values. The file is gitignored and should be readable only by the app user.
if [ -f "$APP_DIR/.env.local" ]; then
  set -a
  # shellcheck source=/dev/null
  source "$APP_DIR/.env.local"
  set +a
fi

cd "$APP_DIR"

# One dated line per run. Ingest and the index rebuild print no clock time of
# their own, so without it nothing in their logs says when a run happened.
stamp() {
  echo "[cron] $(date -u +%Y-%m-%dT%H:%M:%SZ) $1" >> "$2"
}

case "${1:-}" in
  ingest)
    stamp "ingest starts" "$LOG_DIR/ingest.log"
    ./node_modules/.bin/tsx scripts/ingest.ts >> "$LOG_DIR/ingest.log" 2>&1
    ;;
  fts)
    stamp "search index rebuild starts" "$LOG_DIR/fts.log"
    ./node_modules/.bin/tsx scripts/setup-fts.ts >> "$LOG_DIR/fts.log" 2>&1
    ;;
  health)
    # Exits 1 when it finds a problem; the line it logs says which.
    ./node_modules/.bin/tsx scripts/health-check.ts >> "$LOG_DIR/health.log" 2>&1
    ;;
  backup)
    # Exits 1 when no snapshot could be written; the line it logs says why.
    ./node_modules/.bin/tsx scripts/backup-db.ts >> "$LOG_DIR/backup.log" 2>&1
    ;;
  all)
    stamp "ingest starts" "$LOG_DIR/ingest.log"
    ./node_modules/.bin/tsx scripts/ingest.ts >> "$LOG_DIR/ingest.log" 2>&1
    stamp "search index rebuild starts" "$LOG_DIR/fts.log"
    ./node_modules/.bin/tsx scripts/setup-fts.ts >> "$LOG_DIR/fts.log" 2>&1
    ;;
  *)
    echo "Usage: $0 {ingest|fts|health|backup|all}"
    exit 1
    ;;
esac
