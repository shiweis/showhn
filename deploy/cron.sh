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
#
# The health check tells you when ingest or analysis has stopped, once
# HEALTH_PING_URL is set (see app/.env.example). It only reads the database.
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

case "${1:-}" in
  ingest)
    ./node_modules/.bin/tsx scripts/ingest.ts >> "$LOG_DIR/ingest.log" 2>&1
    ;;
  fts)
    ./node_modules/.bin/tsx scripts/setup-fts.ts >> "$LOG_DIR/fts.log" 2>&1
    ;;
  health)
    # Exits 1 when it finds a problem; the line it logs says which.
    ./node_modules/.bin/tsx scripts/health-check.ts >> "$LOG_DIR/health.log" 2>&1
    ;;
  all)
    ./node_modules/.bin/tsx scripts/ingest.ts >> "$LOG_DIR/ingest.log" 2>&1
    ./node_modules/.bin/tsx scripts/setup-fts.ts >> "$LOG_DIR/fts.log" 2>&1
    ;;
  *)
    echo "Usage: $0 {ingest|fts|health|all}"
    exit 1
    ;;
esac
