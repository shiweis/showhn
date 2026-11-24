# HN Showcase

An AI-powered visual gallery for [Show HN](https://news.ycombinator.com/showhn.html) projects. Browse, filter, and discover the best projects launched on Hacker News — with automated screenshots, AI analysis, and full-text search.

**Live:** [hnshowcase.com](https://hnshowcase.com)

## Features

- **Visual gallery** — Automated screenshots of every Show HN project
- **GitHub-aware** — GitHub repos get metadata cards (stars, language, description) instead of generic screenshots, with on-demand refresh via the GitHub API
- **AI analysis** — Each project gets a tier (gem/banger/solid/mid/pass), vibe tags, highlight, and strengths/weaknesses via LLM. Benchmark-calibrated against real posts, batched (up to 5 posts/call), and records provider-reported cache usage and billed cost
- **Similar projects** — FTS5-powered related project recommendations on every post page, using corpus-analyzed stopwords for relevance
- **Full-text search** — SQLite FTS5 search across titles, AI summaries and the names of the products each project is compared to
- **Daily digest** — Curated view of each day's best projects
- **RSS feed** — The newest gems and bangers at `/feed.xml`
- **AI vs HN** — Divergence page showing where AI ratings and HN crowd votes disagree
- **Filtering** — By time range, category, points, comments, or AI pick score
- **Dark mode** — System-aware with manual toggle
- **Fast** — Server-rendered with SQLite and ISR caching, no external database dependencies

## Tech Stack

- **Frontend:** Next.js 16 (App Router), React 19, Tailwind CSS 4, shadcn/ui
- **Database:** SQLite + Drizzle ORM + FTS5 for search
- **AI:** Configurable LLM pipeline (OpenAI, Anthropic, or OpenRouter) with batch analysis and prompt caching
- **Screenshots:** Playwright (headless Chromium)
- **Data:** Algolia HN Search API for ingestion
- **Analytics:** Self-hosted [Umami](https://umami.is) for privacy-friendly traffic tracking

## Getting Started

### Prerequisites

- Node.js 20+
- A Chromium-compatible environment (for screenshots)
- An Anthropic API key for the default Claude Haiku 5.5 configuration, or an OpenAI/OpenRouter key for another provider

### Setup

```bash
cd app
npm install

# Copy environment config
cp .env.example .env.local
# Edit .env.local with your API keys

# Run versioned database migrations
npm run db:migrate

# Ingest Show HN posts from Algolia
npx tsx scripts/ingest.ts --backfill

# Set up full-text search
npx tsx scripts/setup-fts.ts

# Install Playwright browsers (for screenshots)
npx playwright install chromium

# Start the worker (processes screenshots + AI analysis)
npx tsx scripts/worker.ts &

# Start dev server
npm run dev
```

The app runs on port 3000 by default. Override with `PORT=3333 npm run dev`.

### Scripts

| Script | Description |
|--------|-------------|
| `scripts/ingest.ts` | Fetch Show HN posts from Algolia. Use `--backfill` for 30-day lookback. |
| `scripts/worker.ts` | Persistent task queue worker. Batch-processes screenshots and AI analysis (~5 posts/API call). GitHub URLs skip Playwright and fetch metadata via API instead. |
| `scripts/rescore.ts` | Batch rescore posts using the AI pipeline. Supports `--limit`, `--post`, `--concurrency`, `--dry-run`. |
| `scripts/requeue.ts` | Re-enqueue tasks for reprocessing (e.g. after prompt changes). |
| `scripts/backfill-content.ts` | Backfill page content and README text (HTTP fetch, no AI). |
| `scripts/backfill-content-playwright.ts` | Playwright-based backfill for JS-rendered sites. |
| `scripts/backfill-thumbnails.ts` | Generate thumbnail images from full screenshots. |
| `scripts/setup-fts.ts` | Rebuild the FTS5 search index. Run after ingestion. |
| `scripts/health-check.ts` | Report whether new posts are arriving and getting verdicts. Runs from cron; see [Production Deployment](#production-deployment). |
| `scripts/backup-db.ts` | Write a compressed snapshot of the database to `data/backups` and keep the newest seven. Runs from cron; see [Production Deployment](#production-deployment). |
| `scripts/baseline-migrations.ts` | Adopt migration tracking for a pre-migration database after making a backup. Requires `--yes`. |
| `scripts/analytics.sh` | Pull Umami analytics from CLI. Usage: `./scripts/analytics.sh [site] [period]`. Sites: `all`, `hn`, `shiwei`, `everglades`, `burin`. Periods: `today`, `24h`, `7d`, `30d`. |
| `scripts/analyze-stopwords.sh` | Corpus analysis for FTS stopwords. Finds terms appearing in 15+ of 16 categories. Run every few months to update the stopword list in `queries.ts` as the corpus grows. |

### Environment Variables

See [`.env.example`](app/.env.example) for all available options:

| Variable | Default | Description |
|----------|---------|-------------|
| `DATABASE_PATH` | `./data/showhn.db` | Path to SQLite database |
| `ANALYSIS_PROVIDER` | `anthropic` | LLM provider (`openai`, `anthropic`, or `openrouter`) |
| `ANALYSIS_MODEL` | `claude-haiku-5-5` | Model name for analysis |
| `ANALYSIS_ANTHROPIC_EFFORT` | `medium` | Anthropic effort level (`low` to `max`); unset uses the model default |
| `BATCH_SIZE` | `1` | Posts judged per LLM call |
| `OPENAI_API_KEY` | — | OpenAI API key |
| `ANTHROPIC_API_KEY` | — | Anthropic API key |
| `OPENROUTER_API_KEY` | — | OpenRouter API key (when using `openrouter` provider) |
| `SCREENSHOT_CONCURRENCY` | `4` | Parallel browser instances |
| `SCREENSHOT_TIMEOUT` | `15000` | Screenshot timeout in ms |
| `GITHUB_TOKEN` | — | GitHub API token (optional, raises rate limit from 60 to 5000 req/hr) |
| `REMOVED_POST_IDS` | — | HN post ids removed at their author's request, comma-separated; ingest skips them. Set in `.env.local` only |
| `HEALTH_PING_URL` | — | Where the health check reports: the ping address of a Healthchecks.io check or a compatible service. Set in `.env.local` only |
| `BACKUP_DIR` | `data/backups` | Where the nightly database snapshots go |

### Existing databases

Databases created before versioned migrations already have the current schema but no migration log. Back up the database, then run `npm run db:baseline -- --yes` once. Fresh databases should use `npm run db:migrate` normally.

### Quality checks

Run `npm run check` before deployment. It covers ESLint, application and worker script type checking, and the automated security/queue/AI tests. `npm audit` should also report zero known vulnerabilities.

HTML routes render dynamically because the strict Content Security Policy uses a fresh script nonce on every response. SQLite queries remain local and static assets keep their normal long-lived caching. The views over all time and the AI vs HN page count or sort every post, so their query results are reused for five minutes in the web process.

## Production Deployment

```bash
cd app
npm run build
PORT=3333 npm start -- --hostname 127.0.0.1
```

The site listens on `127.0.0.1` only; a reverse proxy ([`deploy/Caddyfile`](deploy/Caddyfile)) is the one way in. `next start` takes its address from `--hostname` and ignores a `HOSTNAME` variable, so without the flag it listens on every address.

Uses the path-portable root [`ecosystem.config.js`](ecosystem.config.js) for PM2. The compatibility file under [`deploy/`](deploy/) re-exports that canonical configuration. Production should run the screenshot worker as an unprivileged user and deny private/link-local destinations at the worker network boundary in addition to the application URL guard.

PM2 keeps each process's output in `~/.pm2/logs/`, and the cron script appends to `logs/` in the repository root. PM2 writes the date, time and UTC offset in front of every worker line (`log_date_format` in the PM2 configuration), and the cron script starts each ingest and index-rebuild run with a dated `[cron]` line. [`deploy/logrotate.conf`](deploy/logrotate.conf) rotates all of these logs once a month, or sooner when one passes 50 MB, and keeps 12 compressed copies; its first lines say how to install it.

Nothing in PM2 or on the site shows when ingest or analysis stops, so `deploy/cron.sh health` checks every half hour and writes one line to `logs/health.log`. It reports a problem when at least 8 of the 10 newest posts older than two hours have no verdict, or when no new post has arrived for six hours. To get an email, create a check at [Healthchecks.io](https://healthchecks.io) or a compatible service, with a period of 30 minutes and a grace time of 1 hour, and put its ping address in `HEALTH_PING_URL`. The service then mails you when the check reports a problem and when the reports stop coming, which also covers the server being down.

`deploy/cron.sh backup` writes a compressed snapshot of the database to `app/data/backups` every night and keeps the newest seven, with one line per run in `logs/backup.log`. It uses SQLite's own backup, so the site and the worker keep running, and it checks the copy before packing it; at 38,000 posts a snapshot is about 100 MB and takes 15 seconds. The snapshots sit on the same disk as the database: they cover a bad migration, a wrong bulk update or a damaged file, not the loss of the disk, so copy the folder somewhere else as well. To restore one, stop the site and the worker, unpack it over the database with `gunzip -c app/data/backups/showhn-<day>.db.gz > app/data/showhn.db`, delete `showhn.db-wal` and `showhn.db-shm` if they exist, and start both again.

## Project Structure

```
app/
  src/
    app/              # Next.js pages (homepage, search, digest, divergence, post detail)
    components/       # React components (header, post card, filter bar, etc.)
    lib/
      db/             # Database schema, queries, connection
      ai/             # LLM analysis pipeline (prompt, tiers, benchmark calibration)
      queue.ts        # SQLite-backed task queue
      sanitize.ts     # HTML sanitization
  scripts/            # Data pipeline scripts
  data/               # SQLite database (gitignored)
  public/screenshots/ # Project screenshots (gitignored)
legacy/               # Original 2012 Python project (preserved for history)
```

## History

This project started in 2012 as a Python/Pyramid web app backed by MongoDB, originally built to showcase Show HN projects with basic screenshot thumbnails and social sharing buttons (Twitter, Facebook, Tumblr, Google+). The original source lives in [`legacy/`](legacy/).

In 2026 it was rebuilt from the ground up as a modern Next.js application with AI-powered analysis, automated screenshot pipelines, and full-text search — while keeping the same spirit of making Show HN projects more discoverable.

## License

MIT
